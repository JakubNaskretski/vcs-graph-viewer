// Port of graph-builder's extractors/custommetadata.py. A custom-metadata record
// -> custommetadatarecord node + references -> its __mdt type object. Values never read.
import * as path from "path";
import { Extractor } from "../core";
import { node, rawEdge, RawEdge, RawNode } from "../model";
import { parseXmlFile, text } from "../xml";

const SUFFIX = ".md-meta.xml";

class CustomMetadataExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return filePath.endsWith(SUFFIX);
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    const base = path.basename(filePath);
    const fullName = base.slice(0, base.length - SUFFIX.length);
    if (!fullName || !fullName.includes(".")) return [[], []];
    const typeDevName = fullName.slice(0, fullName.indexOf("."));
    if (!typeDevName) return [[], []];

    const rid = `custommetadatarecord/${fullName}`;
    const attrs: Record<string, unknown> = {};
    const root = parseXmlFile(filePath);
    if (root) {
      const protectedVal = text(root, "protected").toLowerCase();
      if (protectedVal === "true" || protectedVal === "false") attrs.protected = protectedVal === "true";
    }
    const nodes: RawNode[] = [node(rid, "custommetadatarecord", fullName, attrs)];
    const edges: RawEdge[] = [rawEdge(rid, "references", "object", `${typeDevName}__mdt`)];
    return [nodes, edges];
  }
}

export const CUSTOMMETADATA_EXTRACTORS: Extractor[] = [new CustomMetadataExtractor()];
