// Port of graph-builder's extractors/globalvaluesets.py. Name-only node; the
// file body holds picklist values, which are never read.
import * as path from "path";
import { Extractor } from "../core";
import { node, RawEdge, RawNode } from "../model";

const SUFFIX = ".globalValueSet-meta.xml";

class GlobalValueSetExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return filePath.endsWith(SUFFIX);
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    const base = path.basename(filePath);
    const name = base.slice(0, base.length - SUFFIX.length);
    if (!name) return [[], []];
    return [[node(`globalvalueset/${name}`, "globalvalueset", name)], []];
  }
}

export const GLOBALVALUESET_EXTRACTORS: Extractor[] = [new GlobalValueSetExtractor()];
