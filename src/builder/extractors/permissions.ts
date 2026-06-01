// Port of graph-builder's extractors/permissions.py. Custom permissions (with
// `requires` edges) and custom notification types.
import { Extractor } from "../core";
import { node, rawEdge, RawEdge, RawNode } from "../model";
import { iterText, parseXmlFile } from "../xml";

const CUSTOM_PERMISSION_SUFFIX = ".customPermission-meta.xml";
const CUSTOM_NOTIFICATION_SUFFIX = ".customNotificationType-meta.xml";

function apiName(filePath: string, suffix: string): string {
  const name = filePath.split("/").pop() ?? filePath;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

class CustomPermissionExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return filePath.endsWith(CUSTOM_PERMISSION_SUFFIX);
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    const name = apiName(filePath, CUSTOM_PERMISSION_SUFFIX);
    const nid = `custompermission/${name}`;
    const nodes: RawNode[] = [node(nid, "custompermission", name)];
    const edges: RawEdge[] = [];
    const root = parseXmlFile(filePath);
    if (!root) return [nodes, edges];
    const seen = new Set<string>();
    for (const ref of iterText(root, "requiredPermission")) {
      const r = ref.trim();
      if (r && !seen.has(r)) {
        seen.add(r);
        edges.push(rawEdge(nid, "requires", "custompermission", r));
      }
    }
    return [nodes, edges];
  }
}

class CustomNotificationTypeExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return filePath.endsWith(CUSTOM_NOTIFICATION_SUFFIX);
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    const name = apiName(filePath, CUSTOM_NOTIFICATION_SUFFIX);
    return [[node(`customnotificationtype/${name}`, "customnotificationtype", name)], []];
  }
}

export const PERMISSION_EXTRACTORS: Extractor[] = [
  new CustomPermissionExtractor(),
  new CustomNotificationTypeExtractor(),
];
