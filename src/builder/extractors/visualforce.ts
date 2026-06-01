// Port of graph-builder's extractors/visualforce.py. VF page/component node;
// references -> object (standardController); calls -> apexclass; uses-component.
// Tolerant tag-opener scan (VF markup is often not well-formed XML).
import * as path from "path";
import { Extractor } from "../core";
import { node, rawEdge, RawEdge, RawNode } from "../model";
import { readText } from "../salesforce";

const TAG = /<(?![/!?])\s*([A-Za-z_][\w-]*)(?::([A-Za-z_][\w-]*))?([^<>]*)>/g;
const ATTR = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/g;
const ROOT_TAGS = new Set(["page", "component"]);

function parseAttrs(span: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of span.matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

function splitClasses(value: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    let cls = part.trim();
    if (!cls) continue;
    cls = (cls.split(".").pop() as string).trim();
    if (cls && !seen.has(cls)) {
      seen.add(cls);
      out.push(cls);
    }
  }
  return out;
}

class VisualforceExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return filePath.endsWith(".page") || filePath.endsWith(".component");
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    const isPage = filePath.endsWith(".page");
    const kind = isPage ? "vfpage" : "vfcomponent";
    const name = path.basename(filePath).replace(/\.(page|component)$/, "");
    const nid = `${kind}/${name}`;
    const nodes: RawNode[] = [node(nid, kind, name)];
    const edges: RawEdge[] = [];

    const src = readText(filePath);
    const seenClass = new Set<string>();
    const seenComp = new Set<string>();
    let seenObject = false;

    for (const m of src.matchAll(TAG)) {
      const prefix = m[1] || "";
      const local = m[2];
      const ns = local ? prefix.toLowerCase() : "";
      const tag = (local || prefix).toLowerCase();
      const span = m[3] || "";

      if (ns === "c" && local) {
        if (!seenComp.has(local)) {
          seenComp.add(local);
          edges.push(rawEdge(nid, "uses-component", "vfcomponent", local));
        }
        continue;
      }
      if (ns === "apex" && ROOT_TAGS.has(tag)) {
        const a = parseAttrs(span);
        const sc = (a["standardcontroller"] || "").trim();
        if (sc && !seenObject) {
          seenObject = true;
          edges.push(rawEdge(nid, "references", "object", sc));
        }
        for (const key of ["controller", "extensions"]) {
          for (const cls of splitClasses(a[key] || "")) {
            if (!seenClass.has(cls)) {
              seenClass.add(cls);
              edges.push(rawEdge(nid, "calls", "apexclass", cls));
            }
          }
        }
      }
    }
    return [nodes, edges];
  }
}

export const VISUALFORCE_EXTRACTORS: Extractor[] = [new VisualforceExtractor()];
