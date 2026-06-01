// Port of graph-builder's extractors/listviews.py. ListView node + references ->
// owning object + reads -> each column/filter field. Filter <value> is never read.
import * as path from "path";
import { Extractor } from "../core";
import { node, rawEdge, RawEdge, RawNode } from "../model";
import { iterElements, iterText, parseXmlFile, text } from "../xml";

const SUFFIX = ".listView-meta.xml";
const FIELD = /^[A-Za-z][A-Za-z0-9_]*(?:__c)?(?:\.[A-Za-z][A-Za-z0-9_]*(?:__c)?)?$/;

function objectName(filePath: string): string {
  const parent = path.dirname(filePath);
  return path.basename(parent) === "listViews" ? path.basename(path.dirname(parent)) : "";
}

function fieldRef(token: string, objName: string): string {
  token = (token || "").trim();
  if (!token || !FIELD.test(token)) return "";
  if (token === token.toUpperCase()) return ""; // NAME, RECORDTYPE, CREATED_DATE, ...
  if (token.includes(".")) return token;
  return objName ? `${objName}.${token}` : "";
}

class ListViewExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return filePath.endsWith(SUFFIX);
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    const base = path.basename(filePath);
    const name = base.slice(0, base.length - SUFFIX.length);
    if (!name) return [[], []];
    const objName = objectName(filePath);
    const lid = objName ? `listview/${objName}.${name}` : `listview/${name}`;
    const label = objName ? `${objName}.${name}` : name;
    const nodes: RawNode[] = [node(lid, "listview", label)];
    const edges: RawEdge[] = [];
    if (objName) edges.push(rawEdge(lid, "references", "object", objName));

    const root = parseXmlFile(filePath);
    if (!root) return [nodes, edges];

    const seen = new Set<string>();
    const readField = (token: string) => {
      const ref = fieldRef(token, objName);
      if (ref && !seen.has(ref)) {
        seen.add(ref);
        edges.push(rawEdge(lid, "reads", "field", ref));
      }
    };
    for (const col of iterText(root, "columns")) readField(col);
    for (const filt of iterElements(root, "filters")) readField(text(filt, "field"));

    return [nodes, edges];
  }
}

export const LISTVIEW_EXTRACTORS: Extractor[] = [new ListViewExtractor()];
