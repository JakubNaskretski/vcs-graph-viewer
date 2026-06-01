// Port of graph-builder's extractors/rules.py. Assignment / escalation / duplicate
// / matching rules -> nodes + on/reads/references/uses edges.
import * as path from "path";
import { Extractor } from "../core";
import { node, rawEdge, RawEdge, RawNode } from "../model";
import { iterElements, iterText, parseXmlFile, text } from "../xml";

const ASSIGNMENT = ".assignmentRules-meta.xml";
const ESCALATION = ".escalationRules-meta.xml";
const DUPLICATE = ".duplicateRule-meta.xml";
const MATCHING = ".matchingRule-meta.xml";

function qualField(name: string, obj: string): string {
  if (!name) return "";
  if (name.includes(".")) return name;
  return obj ? `${obj}.${name}` : name;
}

function fieldsUnder(rule: Record<string, unknown>, itemTag: string, fieldTag: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of iterElements(rule, itemTag)) {
    const f = text(it, fieldTag);
    if (f && !seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  return out;
}

/** Every descendant element object (for assignedToType scanning). */
function allEls(n: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!n || typeof n !== "object") return out;
  if (Array.isArray(n)) {
    for (const i of n) allEls(i, out);
    return out;
  }
  out.push(n as Record<string, unknown>);
  for (const v of Object.values(n as Record<string, unknown>)) {
    for (const vv of Array.isArray(v) ? v : [v]) if (vv && typeof vv === "object") allEls(vv, out);
  }
  return out;
}

function actionEdges(rule: Record<string, unknown>, rid: string, edges: RawEdge[]): void {
  const queues = new Set<string>();
  const templates = new Set<string>();
  for (const el of allEls(rule)) {
    if (text(el, "assignedToType") === "Queue") {
      const q = text(el, "assignedTo");
      if (q) queues.add(q);
    }
  }
  for (const t of iterText(rule, "template")) {
    const tn = t.trim();
    if (tn) templates.add(tn);
  }
  for (const q of [...queues].sort()) edges.push(rawEdge(rid, "references", "queue", q));
  for (const tmpl of [...templates].sort()) edges.push(rawEdge(rid, "uses", "emailtemplate", tmpl));
}

class RuleExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return [ASSIGNMENT, ESCALATION, DUPLICATE, MATCHING].some((s) => filePath.endsWith(s));
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    const name = path.basename(filePath);
    if (name.endsWith(ASSIGNMENT)) return this.multi(filePath, ASSIGNMENT, "assignmentRule", "assignmentrule", "criteriaItems", "field");
    if (name.endsWith(ESCALATION)) return this.multi(filePath, ESCALATION, "escalationRule", "escalationrule", "criteriaItems", "field");
    if (name.endsWith(MATCHING)) return this.multi(filePath, MATCHING, "matchingRules", "matchingrule", "matchingRuleItems", "fieldName");
    if (name.endsWith(DUPLICATE)) return this.duplicate(filePath);
    return [[], []];
  }

  private multi(
    filePath: string,
    suffix: string,
    wrapper: string,
    nodeType: string,
    itemTag: string,
    fieldTag: string,
  ): [RawNode[], RawEdge[]] {
    const obj = path.basename(filePath).slice(0, path.basename(filePath).length - suffix.length);
    const nodes: RawNode[] = [];
    const edges: RawEdge[] = [];
    const root = parseXmlFile(filePath);
    if (!root) return [nodes, edges];

    for (const rule of iterElements(root, wrapper)) {
      const full = text(rule, "fullName");
      if (!full) continue;
      const rid = `${nodeType}/${obj}.${full}`;
      nodes.push(node(rid, nodeType, full));
      if (obj) edges.push(rawEdge(rid, "on", "object", obj));
      for (const f of fieldsUnder(rule, itemTag, fieldTag)) {
        const qual = qualField(f, obj);
        if (qual) edges.push(rawEdge(rid, "reads", "field", qual));
      }
      if (nodeType === "assignmentrule" || nodeType === "escalationrule") actionEdges(rule, rid, edges);
    }
    return [nodes, edges];
  }

  private duplicate(filePath: string): [RawNode[], RawEdge[]] {
    const stem = path.basename(filePath).slice(0, path.basename(filePath).length - DUPLICATE.length);
    const nodes: RawNode[] = [];
    const edges: RawEdge[] = [];
    const root = parseXmlFile(filePath);
    if (!root) return [nodes, edges];

    const full = text(root, "fullName") || stem;
    if (!full) return [nodes, edges];
    let obj = full.includes(".") ? full.slice(0, full.indexOf(".")) : "";
    if (!obj) obj = text(root, "sobjectType");
    if (!obj) {
      for (const mr of iterElements(root, "duplicateRuleMatchRules")) {
        const t = text(mr, "matchRuleSObjectType");
        if (t) {
          obj = t;
          break;
        }
      }
    }

    const rid = `duplicaterule/${full}`;
    nodes.push(node(rid, "duplicaterule", full));
    if (obj) edges.push(rawEdge(rid, "on", "object", obj));
    for (const f of fieldsUnder(root, "duplicateRuleFilterItems", "field")) {
      const qual = qualField(f, obj);
      if (qual) edges.push(rawEdge(rid, "reads", "field", qual));
    }
    const seen = new Set<string>();
    for (const mr of iterElements(root, "duplicateRuleMatchRules")) {
      const mname = text(mr, "matchingRules");
      if (!mname) continue;
      const mobj = text(mr, "matchRuleSObjectType") || obj;
      const target = mobj ? `${mobj}.${mname}` : mname;
      if (!seen.has(target)) {
        seen.add(target);
        edges.push(rawEdge(rid, "references", "matchingrule", target));
      }
    }
    return [nodes, edges];
  }
}

export const RULE_EXTRACTORS: Extractor[] = [new RuleExtractor()];
