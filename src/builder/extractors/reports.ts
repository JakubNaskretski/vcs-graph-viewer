// Port of graph-builder's extractors/reports.py. Report/dashboard nodes; report
// on -> object + reads -> field; dashboard uses -> report. Values never read.
import * as path from "path";
import { Extractor } from "../core";
import { node, rawEdge, RawEdge, RawNode } from "../model";
import { iterElements, iterText, parseXmlFile, text } from "../xml";

const REPORT_SUFFIX = ".report-meta.xml";
const DASHBOARD_SUFFIX = ".dashboard-meta.xml";
const NON_OBJECT_REPORTTYPES = new Set(["", "tabular", "summary", "matrix", "joined"]);

function nameFromPath(filePath: string, suffix: string): string {
  const base = path.basename(filePath);
  return base.endsWith(suffix) ? base.slice(0, base.length - suffix.length) : base;
}

function baseObjectFromReportType(rt: string): string | null {
  if (!rt) return null;
  const head = rt.split(".")[0].trim();
  if (!head || NON_OBJECT_REPORTTYPES.has(head.toLowerCase())) return null;
  return head;
}

function splitFieldToken(token: string): [string, string] | null {
  token = (token || "").trim();
  if (!token.includes(".")) return null;
  const parts = token.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  const obj = parts[0];
  const field = parts[parts.length - 1];
  return obj && field ? [obj, field] : null;
}

class ReportExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return filePath.endsWith(REPORT_SUFFIX) || filePath.endsWith(DASHBOARD_SUFFIX);
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    return filePath.endsWith(DASHBOARD_SUFFIX) ? this.dashboard(filePath) : this.report(filePath);
  }

  private report(filePath: string): [RawNode[], RawEdge[]] {
    const name = nameFromPath(filePath, REPORT_SUFFIX);
    const rid = `report/${name}`;
    const nodes: RawNode[] = [node(rid, "report", name)];
    const edges: RawEdge[] = [];
    const root = parseXmlFile(filePath);
    if (!root) return [nodes, edges];

    const baseObj = baseObjectFromReportType(text(root, "reportType"));
    if (baseObj) edges.push(rawEdge(rid, "on", "object", baseObj));

    const seen = new Set<string>();
    for (const container of ["columns", "groupingsDown", "groupingsAcross"]) {
      for (const c of iterElements(root, container)) {
        for (const txt of iterText(c, "field")) {
          const split = splitFieldToken(txt);
          if (!split) continue;
          const fq = `${split[0]}.${split[1]}`;
          if (seen.has(fq)) continue;
          seen.add(fq);
          edges.push(rawEdge(rid, "reads", "field", fq));
        }
      }
    }
    return [nodes, edges];
  }

  private dashboard(filePath: string): [RawNode[], RawEdge[]] {
    const name = nameFromPath(filePath, DASHBOARD_SUFFIX);
    const did = `dashboard/${name}`;
    const nodes: RawNode[] = [node(did, "dashboard", name)];
    const edges: RawEdge[] = [];
    const root = parseXmlFile(filePath);
    if (!root) return [nodes, edges];

    const seen = new Set<string>();
    for (const ref of iterText(root, "report")) {
      const repName = ref.trim().replace(/\/+$/, "").split("/").pop() ?? "";
      if (!repName || seen.has(repName)) continue;
      seen.add(repName);
      edges.push(rawEdge(did, "uses", "report", repName));
    }
    return [nodes, edges];
  }
}

export const REPORT_EXTRACTORS: Extractor[] = [new ReportExtractor()];
