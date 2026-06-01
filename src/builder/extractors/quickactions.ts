// Port of graph-builder's extractors/quickactions.py. Quick action node; on ->
// object; embeds -> lwc/vfpage; calls -> flow; reads -> field.
import * as path from "path";
import { Extractor } from "../core";
import { node, rawEdge, RawEdge, RawNode } from "../model";
import { iterElements, iterText, parseXmlFile, text } from "../xml";

const SUFFIX = ".quickAction-meta.xml";

class QuickActionExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return filePath.endsWith(SUFFIX);
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    const base = path.basename(filePath);
    const name = base.slice(0, base.length - SUFFIX.length);
    const objCtx = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : "";

    const qid = `quickaction/${name}`;
    const nodes: RawNode[] = [node(qid, "quickaction", name)];
    const edges: RawEdge[] = [];

    const root = parseXmlFile(filePath);
    if (!root) return [nodes, edges];

    const onObject = text(root, "targetObject") || objCtx;
    if (onObject) edges.push(rawEdge(qid, "on", "object", onObject));

    const lwc = text(root, "lightningComponent");
    if (lwc) edges.push(rawEdge(qid, "embeds", "lwc", lwc));
    const page = text(root, "page");
    if (page) edges.push(rawEdge(qid, "embeds", "vfpage", page));
    const flow = text(root, "flowDefinition");
    if (flow) edges.push(rawEdge(qid, "calls", "flow", flow));

    const qaType = text(root, "type");
    if (qaType) nodes[0].action_type = qaType;

    const seenFields = new Set<string>();
    for (const layout of iterElements(root, "quickActionLayout")) {
      for (const fname of iterText(layout, "field")) {
        const f = fname.trim();
        if (!f) continue;
        const qualified = f.includes(".") ? f : onObject ? `${onObject}.${f}` : f;
        if (seenFields.has(qualified)) continue;
        seenFields.add(qualified);
        edges.push(rawEdge(qid, "reads", "field", qualified));
      }
    }

    return [nodes, edges];
  }
}

export const QUICKACTION_EXTRACTORS: Extractor[] = [new QuickActionExtractor()];
