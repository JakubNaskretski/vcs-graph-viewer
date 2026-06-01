// Port of graph-builder's extractors/omnistudio.py. OmniScript / Integration
// Procedure / Data Mapper / FlexCard component nodes + their refs, plus element-
// level flowelement nodes. Emits only the active/highest version per component.
import * as fs from "fs";
import * as path from "path";
import { Extractor } from "../core";
import { node, rawEdge, RawEdge, RawNode } from "../model";
import {
  classifyVlocity,
  collectRefs,
  component,
  JSON_FIELDS,
  OmniComponent,
  OUTPUT_FORMATS,
  parseStandardMeta,
  REF_KEYS,
  SUFFIX_TYPE,
  walk,
} from "../omnistudio";
import { iterElements, iterTextCI, parseXmlFile } from "../xml";
import { readText } from "../salesforce";

const CARD_TARGET_KEYS = new Set([
  "cardname", "childcardname", "targetcardname", "flexcardname", "card", "targetcard", "childcard",
]);
const FIELD_NAME_KEYS = new Set([
  "outputfieldname", "targetfieldname", "fieldname", "domainobjectfieldapiname", "vlocitydatafieldname",
]);

type Blob = unknown;
type ElementTriple = [string, string, Blob[]];

function suffixOtype(filePath: string): string | null {
  for (const [suffix, otype] of Object.entries(SUFFIX_TYPE)) {
    if (filePath.endsWith(`.${suffix}-meta.xml`)) return otype;
  }
  return null;
}

function clean(value: unknown): string | null {
  if (typeof value === "string") {
    const s = value.trim();
    if (s) return s;
  }
  return null;
}

function looksLikeField(name: string): boolean {
  if (!name || name.includes(" ")) return false;
  const parts = name.split(".");
  return parts.length === 2 && parts.every(Boolean);
}

function gt(a: OmniComponent, b: OmniComponent): boolean {
  if (a.active !== b.active) return a.active && !b.active;
  return a.version > b.version;
}

class OmniStudioExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return suffixOtype(filePath) !== null || filePath.endsWith("_DataPack.json");
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    let comp: OmniComponent | null;
    let elementBlobs: ElementTriple[];
    try {
      if (filePath.endsWith("_DataPack.json")) {
        comp = this.parseDatapack(filePath);
        elementBlobs = this.datapackElements(filePath);
      } else {
        comp = this.bestVersion(filePath);
        elementBlobs = this.metaElements(filePath);
      }
    } catch {
      return [[], []];
    }
    if (comp === null) return [[], []]; // this file lost the version race

    const [nodes, edges] = this.emit(comp);
    try {
      const [enodes, eedges] = this.emitElements(comp, elementBlobs);
      nodes.push(...enodes);
      edges.push(...eedges);
    } catch {
      /* element fidelity must never break the base */
    }
    return [nodes, edges];
  }

  private bestVersion(filePath: string): OmniComponent | null {
    const otype = suffixOtype(filePath);
    if (!otype) return null;
    const self = parseStandardMeta(filePath, otype);
    const suffix = Object.entries(SUFFIX_TYPE).find(([, t]) => t === otype)?.[0] as string;

    let winner = self;
    let winnerPath = filePath;
    const dir = path.dirname(filePath);
    let siblings: string[];
    try {
      siblings = fs.readdirSync(dir).filter((n) => n.endsWith(`.${suffix}-meta.xml`)).sort();
    } catch {
      siblings = [];
    }
    for (const sibName of siblings) {
      const sib = path.join(dir, sibName);
      if (sib === filePath) continue;
      let other: OmniComponent;
      try {
        other = parseStandardMeta(sib, otype);
      } catch {
        continue;
      }
      if (other.name !== self.name) continue;
      if (gt(other, winner)) {
        winner = other;
        winnerPath = sib;
      }
    }
    return winnerPath !== filePath ? null : self;
  }

  private parseDatapack(filePath: string): OmniComponent | null {
    let definition: unknown;
    try {
      definition = JSON.parse(readText(filePath));
    } catch {
      return null;
    }
    const name =
      (definition && typeof definition === "object" && !Array.isArray(definition)
        ? clean((definition as Record<string, unknown>).name)
        : null) ?? path.basename(filePath).replace(/_DataPack\.json$/, "").replace(/\.json$/, "");
    return component(name, classifyVlocity(definition), collectRefs(definition), "vlocity");
  }

  private metaElements(filePath: string): ElementTriple[] {
    const out: ElementTriple[] = [];
    const root = parseXmlFile(filePath);
    if (!root) return out;
    for (const el of iterElements(root, "omniProcessElements")) {
      const name = clean(iterTextCI(el, "name")[0]);
      const etype = clean(iterTextCI(el, "type")[0]) ?? "";
      const blobs: Blob[] = [];
      for (const jf of JSON_FIELDS) {
        for (const txt of iterTextCI(el, jf)) {
          const t = txt.trim();
          if (t[0] === "{" || t[0] === "[") {
            try {
              blobs.push(JSON.parse(t));
            } catch {
              /* skip */
            }
          }
        }
      }
      if (name) out.push([name, etype, blobs]);
    }
    return out;
  }

  private datapackElements(filePath: string): ElementTriple[] {
    const out: ElementTriple[] = [];
    let definition: unknown;
    try {
      definition = JSON.parse(readText(filePath));
    } catch {
      return out;
    }
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) return out;
    const def = definition as Record<string, unknown>;
    for (const key of ["items", "elements", "childItems"]) {
      const seq = def[key];
      if (!Array.isArray(seq)) continue;
      for (const item of seq) {
        if (!item || typeof item !== "object") continue;
        const it = item as Record<string, unknown>;
        const name = clean(it.name) ?? clean(it.Name);
        const etype = clean(it.type) ?? clean(it.Type) ?? clean(it.eleType) ?? "";
        if (name) out.push([name, etype, [item]]);
      }
    }
    return out;
  }

  private emit(comp: OmniComponent): [RawNode[], RawEdge[]] {
    const oid = `${comp.otype}/${comp.name}`;
    const nodes: RawNode[] = [node(oid, comp.otype, comp.name, { model: comp.model, active: comp.active, version: comp.version })];
    const edges: RawEdge[] = [];
    const add = (refs: Set<string>, etype: string, toKind: string) => {
      for (const ref of [...refs].sort()) if (typeof ref === "string" && ref.trim()) edges.push(rawEdge(oid, etype, toKind, ref.trim()));
    };
    add(comp.ipRefs, "calls", "integrationprocedure");
    add(comp.dmRefs, "uses", "datamapper");
    add(comp.apexRefs, "calls", "apexclass");
    add(comp.lwcRefs, "embeds", "lwc");
    add(comp.objectRefs, comp.otype === "datamapper" ? "maps" : "touches", "object");
    return [nodes, edges];
  }

  private emitElements(comp: OmniComponent, elementBlobs: ElementTriple[]): [RawNode[], RawEdge[]] {
    const oid = `${comp.otype}/${comp.name}`;
    const nodes: RawNode[] = [];
    const edges: RawEdge[] = [];
    const seen = new Set<string>();

    for (const [ename0, etype, blobs] of elementBlobs) {
      const ename = clean(ename0);
      if (!ename) continue;
      const eid = `flowelement/${comp.name}.${ename}`;
      if (seen.has(eid)) continue;
      seen.add(eid);
      nodes.push(node(eid, "flowelement", ename, { element_type: etype || "" }));
      edges.push(rawEdge(oid, "contains", "flowelement", `${comp.name}.${ename}`));

      const refs = this.elementRefs(blobs);
      for (const name of [...refs.apex].sort()) edges.push(rawEdge(eid, "calls", "apexclass", name));
      for (const name of [...refs.ip].sort()) edges.push(rawEdge(eid, "calls", "integrationprocedure", name));
      for (const name of [...refs.datamapper].sort()) edges.push(rawEdge(eid, "uses", "datamapper", name));
      for (const name of [...refs.lwc].sort()) edges.push(rawEdge(eid, "embeds", "lwc", name));
      for (const name of [...refs.card].sort()) edges.push(rawEdge(eid, "embeds", "flexcard", name));

      if (comp.otype === "datamapper") {
        const [fields, objects] = this.mappingTargets(blobs);
        for (const fname of [...fields].sort()) edges.push(rawEdge(eid, "maps", "field", fname));
        for (const obj of [...objects].sort()) edges.push(rawEdge(eid, "maps", "object", obj));
      }
    }
    return [nodes, edges];
  }

  private elementRefs(blobs: Blob[]): Record<string, Set<string>> {
    const out: Record<string, Set<string>> = { apex: new Set(), ip: new Set(), datamapper: new Set(), lwc: new Set(), card: new Set() };
    for (const blob of blobs) {
      for (const [k, v] of walk(blob)) {
        const val = clean(v);
        if (!val) continue;
        if (REF_KEYS.apex.has(k)) out.apex.add(val);
        else if (REF_KEYS.ip.has(k)) out.ip.add(val);
        else if (REF_KEYS.datamapper.has(k)) out.datamapper.add(val);
        else if (REF_KEYS.lwc.has(k)) out.lwc.add(val);
        else if (CARD_TARGET_KEYS.has(k)) out.card.add(val);
      }
    }
    return out;
  }

  private mappingTargets(blobs: Blob[]): [Set<string>, Set<string>] {
    const fields = new Set<string>();
    const objects = new Set<string>();
    for (const blob of blobs) {
      for (const [k, v] of walk(blob)) {
        const val = clean(v);
        if (!val) continue;
        if (REF_KEYS.object.has(k) && !OUTPUT_FORMATS.has(val.toLowerCase())) objects.add(val);
        else if (FIELD_NAME_KEYS.has(k) && looksLikeField(val)) {
          fields.add(val);
          objects.add(val.slice(0, val.indexOf(".")));
        }
      }
    }
    return [fields, objects];
  }
}

export const OMNISTUDIO_EXTRACTORS: Extractor[] = [new OmniStudioExtractor()];
