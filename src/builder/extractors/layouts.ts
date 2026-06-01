// Port of graph-builder's extractors/layouts.py. Layout node; page-for -> object;
// reads -> field; uses -> quickaction.
import * as path from "path";
import { Extractor } from "../core";
import { node, rawEdge, RawEdge, RawNode } from "../model";
import { iterText, parseXmlFile } from "../xml";

const LAYOUT_SUFFIX = ".layout-meta.xml";
const COMPACT_SUFFIX = ".compactLayout-meta.xml";

class LayoutExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return filePath.endsWith(LAYOUT_SUFFIX) || filePath.endsWith(COMPACT_SUFFIX);
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    const base = path.basename(filePath);
    const suffix = base.endsWith(LAYOUT_SUFFIX) ? LAYOUT_SUFFIX : COMPACT_SUFFIX;
    const stem = base.slice(0, base.length - suffix.length);
    const lid = `layout/${stem}`;
    const nodes: RawNode[] = [node(lid, "layout", stem)];
    const edges: RawEdge[] = [];

    const obj = stem.includes("-") ? stem.slice(0, stem.indexOf("-")) : stem;
    if (obj) edges.push(rawEdge(lid, "page-for", "object", obj));

    const root = parseXmlFile(filePath);
    if (!root) return [nodes, edges];

    const seenFields = new Set<string>();
    for (const fname of iterText(root, "field")) {
      const f = fname.trim();
      if (!f || seenFields.has(f)) continue;
      seenFields.add(f);
      edges.push(rawEdge(lid, "reads", "field", obj ? `${obj}.${f}` : f));
    }

    const seenActions = new Set<string>();
    for (const tag of ["actionName", "quickActionName"]) {
      for (const aname of iterText(root, tag)) {
        const a = aname.trim();
        if (!a || seenActions.has(a)) continue;
        seenActions.add(a);
        edges.push(rawEdge(lid, "uses", "quickaction", a));
      }
    }

    return [nodes, edges];
  }
}

export const LAYOUT_EXTRACTORS: Extractor[] = [new LayoutExtractor()];
