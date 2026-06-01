// Port of graph-builder's omnistudio.py parser — OmniScripts, Integration
// Procedures, Data Mappers, FlexCards. Standard *-meta.xml carry the definition as
// embedded JSON (in <propertySetConfig>); Vlocity ships *_DataPack.json.
import * as path from "path";
import { iterTextCI, parseXmlFile, text } from "./xml";

export const REF_KEYS: Record<string, Set<string>> = {
  ip: new Set(["integrationprocedurekey", "integrationproceduretype", "ipmethod"]),
  datamapper: new Set(["bundle", "dataraptorbundlename", "drbundlename", "dataraptorinputbundle", "dataraptoroutputbundle"]),
  apex: new Set(["remoteclass"]),
  lwc: new Set(["lwcname", "lwccomponentname", "lwccomponentoverride"]),
  object: new Set(["objectname", "interfaceobjectname", "objectapiname", "inputobjectname", "outputobjectname", "contextobject"]),
};

export const SUFFIX_TYPE: Record<string, string> = {
  os: "omniscript",
  oip: "integrationprocedure",
  rpt: "datamapper",
  ouc: "flexcard",
};

export const JSON_FIELDS = ["propertysetconfig", "datasourceconfig", "propertysetconfigchunks"];
const XML_REF_FIELDS: Record<string, string> = { inputobjectname: "object", outputobjectname: "object" };
export const OUTPUT_FORMATS = new Set(["json", "xml", "csv", "custom", ""]);

export interface OmniComponent {
  name: string;
  otype: string;
  model: string;
  active: boolean;
  version: number;
  ipRefs: Set<string>;
  dmRefs: Set<string>;
  apexRefs: Set<string>;
  lwcRefs: Set<string>;
  objectRefs: Set<string>;
}

/** Recursively yield [keyLower, value] pairs over a parsed JSON definition. */
export function walk(obj: unknown, out: Array<[string, unknown]> = []): Array<[string, unknown]> {
  if (Array.isArray(obj)) {
    for (const item of obj) walk(item, out);
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      out.push([k.toLowerCase(), v]);
      walk(v, out);
    }
  }
  return out;
}

export function collectRefs(definition: unknown): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const k of Object.keys(REF_KEYS)) out[k] = new Set();
  for (const [k, v] of walk(definition)) {
    if (typeof v === "string" && v.trim()) {
      for (const [kind, keys] of Object.entries(REF_KEYS)) if (keys.has(k)) out[kind].add(v.trim());
    }
  }
  return out;
}

export function component(
  name: string,
  otype: string,
  refs: Record<string, Set<string>>,
  model: string,
  active = true,
  version = 0,
): OmniComponent {
  return {
    name,
    otype,
    model,
    active,
    version,
    ipRefs: refs.ip,
    dmRefs: refs.datamapper,
    apexRefs: refs.apex,
    lwcRefs: refs.lwc,
    objectRefs: refs.object,
  };
}

export function parseStandardMeta(filePath: string, otype: string): OmniComponent {
  let filestem = path.basename(filePath);
  for (const suf of [".os-meta.xml", ".oip-meta.xml", ".rpt-meta.xml", ".ouc-meta.xml"]) {
    if (filestem.endsWith(suf)) {
      filestem = filestem.slice(0, -suf.length);
      break;
    }
  }
  const refs: Record<string, Set<string>> = {};
  for (const k of Object.keys(REF_KEYS)) refs[k] = new Set();

  const root = parseXmlFile(filePath);
  if (!root) return component(filestem, otype, refs, "standard");

  const typ = text(root, "type");
  const sub = text(root, "subType");
  const nm = text(root, "name");
  const cname = (otype === "omniscript" || otype === "integrationprocedure") && typ && sub ? `${typ}_${sub}` : nm || filestem;
  const active = (text(root, "isActive") || "true").trim().toLowerCase() !== "false";
  const version = parseFloat(text(root, "versionNumber") || "0") || 0;

  for (const jf of JSON_FIELDS) {
    for (const txt of iterTextCI(root, jf)) {
      const t = txt.trim();
      if (t[0] === "{" || t[0] === "[") {
        try {
          const parsed = collectRefs(JSON.parse(t));
          for (const kind of Object.keys(refs)) for (const x of parsed[kind]) refs[kind].add(x);
        } catch {
          /* not valid embedded JSON — skip */
        }
      }
    }
  }
  for (const [xf, kind] of Object.entries(XML_REF_FIELDS)) {
    for (const txt of iterTextCI(root, xf)) {
      const t = txt.trim();
      if (t && !OUTPUT_FORMATS.has(t.toLowerCase())) refs[kind].add(t);
    }
  }

  return component(cname, otype, refs, "standard", active, version);
}

export function classifyVlocity(definition: unknown): string {
  for (const [k, v] of walk(definition)) {
    if ((k === "omniprocesstype" || k === "type" || k === "vlocityrecordsobjecttype") && typeof v === "string") {
      const vl = v.toLowerCase();
      if (vl.includes("integration")) return "integrationprocedure";
      if (vl.includes("dataraptor") || vl.includes("datamapper")) return "datamapper";
      if (vl.includes("omniscript") || vl.includes("script")) return "omniscript";
    }
  }
  const blob = JSON.stringify(definition).toLowerCase();
  if (blob.includes("dataraptor") && !blob.includes("omniscript")) return "datamapper";
  return "omniscript";
}
