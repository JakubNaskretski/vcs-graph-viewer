// Default resolvers — port of graph-builder's resolvers.py. A StubResolver maps
// (kind, name) → "kind/name", creating an external stub node when the target is
// not already in the registry. Labels use prefix/namespace normalization.
import { NODE_TYPES, RawNode } from "./model";
import { Resolver } from "./core";

export class StubResolver implements Resolver {
  constructor(
    public readonly kind: string,
    private readonly stub: boolean = true,
  ) {}

  resolve(name: string, registry: Map<string, RawNode>): string | null {
    const nid = `${this.kind}/${name}`;
    if (registry.has(nid)) return nid;
    if (!this.stub) return null;
    registry.set(nid, { id: nid, type: this.kind, label: name, external: true });
    return nid;
  }
}

export class LabelResolver implements Resolver {
  readonly kind = "label";
  private static readonly PREFIXES = ["$Label.", "System.Label.", "Label."];

  resolve(name: string, registry: Map<string, RawNode>): string | null {
    let bare = name;
    for (const p of LabelResolver.PREFIXES) {
      if (bare.startsWith(p)) {
        bare = bare.slice(p.length);
        break;
      }
    }
    if (bare.includes(".")) bare = bare.slice(bare.indexOf(".") + 1); // drop a leading namespace
    const nid = `label/${bare}`;
    if (registry.has(nid)) return nid;
    registry.set(nid, { id: nid, type: "label", label: bare, external: true });
    return nid;
  }
}

/** Every node kind gets a stub resolver except `label` (handled by LabelResolver). */
export function defaultResolvers(): Resolver[] {
  const kinds = [...NODE_TYPES].filter((k) => k !== "label").sort();
  return [...kinds.map((k) => new StubResolver(k)), new LabelResolver()];
}
