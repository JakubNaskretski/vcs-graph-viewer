// Port of graph-builder's extractors/sharingrules.py. Sharing rule nodes; on ->
// object; reads -> field; references -> role/publicgroup principal.
import * as path from "path";
import { Extractor } from "../core";
import { node, rawEdge, RawEdge, RawNode } from "../model";
import { child, iterElements, parseXmlFile, text } from "../xml";

const SUFFIX = ".sharingRules-meta.xml";
const RULE_TAGS: Record<string, string> = {
  sharingCriteriaRules: "criteria",
  sharingOwnerRules: "owner",
  sharingGuestRules: "guest",
};
const PRINCIPAL_KIND: Record<string, string> = {
  group: "publicgroup",
  role: "role",
  roleAndSubordinates: "role",
  roleAndSubordinatesInternal: "role",
};
const TARGET_TAGS = ["group", "role", "roleAndSubordinates", "roleAndSubordinatesInternal", "territory", "territoryAndSubordinates"];

function principal(container: Record<string, unknown> | null): [string, string] | null {
  if (!container) return null;
  for (const tag of TARGET_TAGS) {
    const val = text(container, tag);
    if (val) {
      const kind = PRINCIPAL_KIND[tag];
      return kind ? [kind, val] : null;
    }
  }
  return null;
}

function sharedTo(rule: Record<string, unknown>): string {
  const shared = child(rule, "sharedTo");
  if (!shared) return "";
  for (const tag of TARGET_TAGS) {
    const val = text(shared, tag);
    if (val) return val;
  }
  return "";
}

class SharingRulesExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return filePath.endsWith(SUFFIX);
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    const base = path.basename(filePath);
    const obj = base.slice(0, base.length - SUFFIX.length);
    const nodes: RawNode[] = [];
    const edges: RawEdge[] = [];
    const root = parseXmlFile(filePath);
    if (!root) return [nodes, edges];

    for (const [wrapper, ruleType] of Object.entries(RULE_TAGS)) {
      for (const rule of iterElements(root, wrapper)) {
        const full = text(rule, "fullName");
        if (!full) continue;
        const rid = `sharingrule/${obj}.${full}`;
        const attrs: Record<string, unknown> = { rule_type: ruleType };
        const st = sharedTo(rule);
        if (st) attrs.shared_to = st;
        nodes.push(node(rid, "sharingrule", full, attrs));

        if (obj) edges.push(rawEdge(rid, "on", "object", obj));
        for (const tag of ["sharedTo", "sharedFrom"]) {
          const p = principal(child(rule, tag));
          if (p) edges.push(rawEdge(rid, "references", p[0], p[1]));
        }
        const seen = new Set<string>();
        for (const ci of iterElements(rule, "criteriaItems")) {
          const f = text(ci, "field");
          if (f && !seen.has(f)) {
            seen.add(f);
            const qual = f.includes(".") ? f : obj ? `${obj}.${f}` : f;
            edges.push(rawEdge(rid, "reads", "field", qual));
          }
        }
      }
    }
    return [nodes, edges];
  }
}

export const SHARINGRULE_EXTRACTORS: Extractor[] = [new SharingRulesExtractor()];
