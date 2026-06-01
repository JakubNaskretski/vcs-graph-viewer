// Port of graph-builder's extractors/flexipages.py. Flexipage node; page-for ->
// object; embeds -> lwc.
import { Extractor } from "../core";
import { node, rawEdge, RawEdge, RawNode } from "../model";
import { parseFlexipage } from "../salesforce";

class FlexiPageExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return filePath.endsWith(".flexipage-meta.xml");
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    const fp = parseFlexipage(filePath);
    const fid = `flexipage/${fp.name}`;
    const nodes: RawNode[] = [node(fid, "flexipage", fp.name)];
    const edges: RawEdge[] = [];
    if (fp.sobject) edges.push(rawEdge(fid, "page-for", "object", fp.sobject));
    for (const lwc of [...fp.lwcRefs].sort()) if (lwc) edges.push(rawEdge(fid, "embeds", "lwc", lwc));
    return [nodes, edges];
  }
}

export const FLEXIPAGE_EXTRACTORS: Extractor[] = [new FlexiPageExtractor()];
