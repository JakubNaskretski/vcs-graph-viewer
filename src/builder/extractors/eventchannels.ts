// Port of graph-builder's extractors/eventchannels.py. Platform-event / CDC
// channel node; a member binds an object to a channel via references.
import * as path from "path";
import { Extractor } from "../core";
import { node, rawEdge, RawEdge, RawNode } from "../model";
import { parseXmlFile, text } from "../xml";

const CHANNEL_SUFFIX = ".platformEventChannel-meta.xml";
const MEMBER_SUFFIX = ".platformEventChannelMember-meta.xml";

class EventChannelExtractor implements Extractor {
  source = "salesforce";

  handles(filePath: string): boolean {
    return filePath.endsWith(MEMBER_SUFFIX) || filePath.endsWith(CHANNEL_SUFFIX);
  }

  extract(filePath: string): [RawNode[], RawEdge[]] {
    if (filePath.endsWith(MEMBER_SUFFIX)) return this.member(filePath);
    return this.channel(filePath);
  }

  private channel(filePath: string): [RawNode[], RawEdge[]] {
    const base = path.basename(filePath);
    const name = base.slice(0, base.length - CHANNEL_SUFFIX.length);
    if (!name) return [[], []];
    const attrs: Record<string, unknown> = {};
    const root = parseXmlFile(filePath);
    if (root) {
      const ctype = text(root, "channelType");
      if (ctype) attrs.channel_type = ctype;
    }
    return [[node(`platformeventchannel/${name}`, "platformeventchannel", name, attrs)], []];
  }

  private member(filePath: string): [RawNode[], RawEdge[]] {
    const root = parseXmlFile(filePath);
    if (!root) return [[], []];
    const channel = text(root, "eventChannel");
    const entity = text(root, "selectedEntity");
    if (!channel) return [[], []];
    const cid = `platformeventchannel/${channel}`;
    const nodes: RawNode[] = [node(cid, "platformeventchannel", channel)];
    const edges: RawEdge[] = [];
    if (entity) edges.push(rawEdge(cid, "references", "object", entity));
    return [nodes, edges];
  }
}

export const EVENTCHANNEL_EXTRACTORS: Extractor[] = [new EventChannelExtractor()];
