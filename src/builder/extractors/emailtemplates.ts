// Port of graph-builder's extractors/emailtemplates.py. Email template node with
// folder/template_type attrs; references -> object; reads -> field (merge tokens in
// safe structural fields only). Subject/body are never read.
import * as path from "path";
import { Extractor } from "../core";
import { node, rawEdge, RawEdge, RawNode } from "../model";
import { iterTextCI, parseXmlFile } from "../xml";

const SUFFIX = ".email-meta.xml";
const ENTITY_TAGS = ["relatedentitytype", "relatedentity", "entitytype"];
const MERGE_SCAN_TAGS = ["relatedentitytype", "relatedentity", "entitytype", "field", "fieldname", "mergefield", "sortfield"];
const MERGE = /\{?!?\s*([A-Za-z]\w*)\.([A-Za-z]\w*)\s*\}?/g;

function firstCI(root: unknown, tagLower: string): string {
  const all = iterTextCI(root, tagLower);
  return all.length ? all[0].trim() : "";
}

function folderFromPath(filePath: string): string {
  const parts = filePath.split(path.sep);
  let idx = -1;
  for (let i = 0; i < parts.length; i++) if (parts[i].toLowerCase() === "email") idx = i;
  if (idx >= 0 && idx + 1 < parts.length - 1) return parts[idx + 1];
  return "";
}

class EmailTemplateExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return filePath.endsWith(SUFFIX);
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    const base = path.basename(filePath);
    const name = base.slice(0, base.length - SUFFIX.length);
    const eid = `emailtemplate/${name}`;
    const attrs: Record<string, unknown> = {};
    const folder = folderFromPath(filePath);
    if (folder) attrs.folder = folder;
    const nodes: RawNode[] = [node(eid, "emailtemplate", name, attrs)];
    const edges: RawEdge[] = [];

    const root = parseXmlFile(filePath);
    if (!root) return [nodes, edges];

    const templateType = firstCI(root, "type");
    if (templateType) nodes[0].template_type = templateType;

    let onObject = "";
    for (const tag of ENTITY_TAGS) {
      onObject = firstCI(root, tag);
      if (onObject) break;
    }
    if (onObject) edges.push(rawEdge(eid, "references", "object", onObject));

    const seenFields = new Set<string>();
    for (const tag of MERGE_SCAN_TAGS) {
      for (const txt of iterTextCI(root, tag)) {
        for (const m of txt.matchAll(MERGE)) {
          const fq = `${m[1]}.${m[2]}`;
          if (seenFields.has(fq)) continue;
          seenFields.add(fq);
          edges.push(rawEdge(eid, "reads", "field", fq));
        }
      }
    }
    return [nodes, edges];
  }
}

export const EMAILTEMPLATE_EXTRACTORS: Extractor[] = [new EmailTemplateExtractor()];
