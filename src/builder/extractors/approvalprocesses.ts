// Port of graph-builder's extractors/approvalprocesses.py. Approval process node;
// on -> object; reads -> field (criteria formula __c tokens); uses -> emailtemplate;
// references -> queue.
import * as path from "path";
import { Extractor } from "../core";
import { node, rawEdge, RawEdge, RawNode } from "../model";
import { iterElements, iterText, parseXmlFile, text } from "../xml";

const SUFFIX = ".approvalProcess-meta.xml";
const FIELD_TOKEN = /\b([A-Za-z][A-Za-z0-9_]*__c)\b/g;
const FORMULA_TAGS = ["entryCriteria", "criteria", "formula", "filterFormula"];

class ApprovalProcessExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return filePath.endsWith(SUFFIX);
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    const base = path.basename(filePath);
    const stem = base.slice(0, base.length - SUFFIX.length);
    if (!stem.includes(".")) return [[], []];
    const obj = stem.slice(0, stem.indexOf("."));
    const process = stem.slice(stem.indexOf(".") + 1);
    if (!obj || !process) return [[], []];

    const apid = `approvalprocess/${obj}.${process}`;
    const nodes: RawNode[] = [node(apid, "approvalprocess", `${obj}.${process}`)];
    const edges: RawEdge[] = [rawEdge(apid, "on", "object", obj)];

    const root = parseXmlFile(filePath);
    if (!root) return [nodes, edges];

    const fields = new Set<string>();
    for (const tag of FORMULA_TAGS) {
      for (const formula of iterText(root, tag)) {
        if (formula.trim()) for (const m of formula.matchAll(FIELD_TOKEN)) fields.add(m[1]);
      }
    }
    for (const fname of [...fields].sort()) edges.push(rawEdge(apid, "reads", "field", `${obj}.${fname}`));

    const seenT = new Set<string>();
    for (const tname of iterText(root, "emailTemplate")) {
      const t = tname.trim();
      if (t && !seenT.has(t)) {
        seenT.add(t);
        edges.push(rawEdge(apid, "uses", "emailtemplate", t));
      }
    }

    const seenQ = new Set<string>();
    for (const ap of iterElements(root, "approver")) {
      if (text(ap, "type").toLowerCase() !== "queue") continue;
      const qname = text(ap, "name").trim();
      if (qname && !seenQ.has(qname)) {
        seenQ.add(qname);
        edges.push(rawEdge(apid, "references", "queue", qname));
      }
    }

    return [nodes, edges];
  }
}

export const APPROVALPROCESS_EXTRACTORS: Extractor[] = [new ApprovalProcessExtractor()];
