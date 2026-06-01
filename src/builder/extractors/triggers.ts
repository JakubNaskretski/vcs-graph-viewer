// Port of graph-builder's extractors/triggers.py. Trigger node + `on` object,
// plus handler-delegation `calls` edges parsed from the trigger body.
import { Extractor } from "../core";
import { node, rawEdge, RawEdge, RawNode } from "../model";
import { parseTrigger, stripApex } from "../salesforce";

const KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "try", "catch", "finally",
  "return", "throw", "new", "system", "trigger", "insert", "update", "delete",
  "upsert", "undelete", "merge", "and", "or", "not", "null", "true", "false",
  "this", "super", "instanceof", "void", "static", "public", "private",
  "protected", "global", "override", "virtual", "abstract", "final", "with",
  "without", "sharing", "on",
]);

const DOTTED_CALL = /\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.([A-Za-z_]\w*)\s*\(/g;
const NEW_CALL = /\bnew\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/g;

function splitEvents(events: string): string[] {
  const out: string[] = [];
  for (const part of events.split(",")) {
    const norm = part.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
    if (norm) out.push(norm);
  }
  return out;
}

function bodyAfterHeader(stripped: string): string {
  const m = stripped.match(/\btrigger\b[\s\S]*?\)/);
  return m ? stripped.slice((m.index ?? 0) + m[0].length) : stripped;
}

class TriggerExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return filePath.endsWith(".trigger");
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    const t = parseTrigger(filePath);
    const tid = `trigger/${t.name}`;
    const attrs: Record<string, unknown> = { events: t.events };
    const eventList = splitEvents(t.events);
    if (eventList.length) attrs.event_list = eventList;
    const nodes: RawNode[] = [node(tid, "trigger", t.name, attrs)];
    const edges: RawEdge[] = [];

    if (t.sobject) edges.push(rawEdge(tid, "on", "object", t.sobject));
    for (const cls of [...t.classRefs].sort()) edges.push(rawEdge(tid, "calls", "apexclass", cls));

    const seenMethod = new Set<string>();
    const seenClass = new Set<string>();
    let body = "";
    try {
      body = bodyAfterHeader(stripApex(t.source || ""));
    } catch {
      body = "";
    }

    for (const m of body.matchAll(NEW_CALL)) {
      const cls = m[1].split(".").pop() as string;
      if (!cls || KEYWORDS.has(cls.toLowerCase())) continue;
      if (!seenClass.has(cls)) {
        seenClass.add(cls);
        edges.push(rawEdge(tid, "calls", "apexclass", cls));
      }
    }

    for (const m of body.matchAll(DOTTED_CALL)) {
      const head = m[1];
      const method = m[2];
      const cls = head.split(".").pop() as string;
      if (!cls || !method) continue;
      if (KEYWORDS.has(cls.toLowerCase()) || KEYWORDS.has(method.toLowerCase())) continue;
      const qualified = `${cls}.${method}`;
      if (!seenMethod.has(qualified)) {
        seenMethod.add(qualified);
        edges.push(rawEdge(tid, "calls", "apexmethod", qualified));
      }
      if (!seenClass.has(cls)) {
        seenClass.add(cls);
        edges.push(rawEdge(tid, "calls", "apexclass", cls));
      }
    }

    return [nodes, edges];
  }
}

export const TRIGGER_EXTRACTORS: Extractor[] = [new TriggerExtractor()];
