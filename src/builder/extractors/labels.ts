// Port of graph-builder's extractors/labels.py. Each <labels> entry -> a
// label/<fullName> node with structural category/language attrs. <value> (the
// displayed text) is never read. Turns stubbed label refs into real nodes.
import { Extractor } from "../core";
import { node, RawEdge, RawNode } from "../model";
import { asArrayObj, parseXmlFile, text } from "../xml";

class LabelExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return filePath.endsWith(".labels-meta.xml");
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    const nodes: RawNode[] = [];
    const root = parseXmlFile(filePath);
    if (!root) return [nodes, []];
    const seen = new Set<string>();
    for (const entry of asArrayObj(root["labels"])) {
      const fullName = text(entry, "fullName");
      if (!fullName || seen.has(fullName)) continue;
      seen.add(fullName);
      const attrs: Record<string, unknown> = {};
      const category = text(entry, "categories");
      if (category) attrs.category = category;
      const language = text(entry, "language");
      if (language) attrs.language = language;
      nodes.push(node(`label/${fullName}`, "label", fullName, attrs));
    }
    return [nodes, []];
  }
}

export const LABEL_EXTRACTORS: Extractor[] = [new LabelExtractor()];
