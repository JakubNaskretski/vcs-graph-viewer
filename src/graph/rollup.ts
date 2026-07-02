// Collapse the fine-grained "nested" nodes (fields, apex methods, flow elements,
// record types, list views) into their parent container (object / apexclass /
// flow), rolling their edges up to the container level. This turns a huge
// hairball into a readable, far smaller "module map" — and it's computed in the
// extension host so the webview never has to hold the full graph.
import { Graph, GraphEdge, GraphNode } from "./types";

// A nested node's id is "<type>/<Parent>.<child>"; its container is
// "<parentType>/<Parent>". This default mapping is the fallback: it assumes the
// container type can be inferred from the child type alone, which is true for
// field/recordtype/listview (-> object) and apexmethod (-> apexclass) but NOT for
// `flowelement`. A flowelement id is "flowelement/<ParentName>.<Element>", and the
// SAME shape is emitted by two different parent kinds — real Flows (parent
// "flow/<Name>") AND OmniStudio components (parent "omniscript/" |
// "integrationprocedure/" | "datamapper/" | "flexcard/"). The id alone can't tell
// them apart, so `flow` here is only a last-resort guess; the real parent is taken
// from the node's `contains` edge (see parentMapFromEdges / containerId's `parents`
// argument), which encodes the true parent type in its src id.
const NESTED_PARENT: Record<string, string> = {
  field: "object",
  recordtype: "object",
  listview: "object",
  apexmethod: "apexclass",
  flowelement: "flow",
};

export function isNestedType(type: string): boolean {
  return type in NESTED_PARENT;
}

/** True when an id's type prefix is a nested kind (field/apexmethod/…), i.e. the
 *  node rolls up into a parent. Works off the id alone (edges reference ids). */
export function isNestedId(id: string): boolean {
  const slash = id.indexOf("/");
  return slash > 0 && id.slice(0, slash) in NESTED_PARENT;
}

/** Map from a nested node id to its REAL parent (container) id, derived from the
 *  `contains` edges in a graph. This is the authoritative source of a nested node's
 *  parent: the emitting extractor always writes `<parentId> --contains--> <nestedId>`,
 *  and the parent id carries the true parent type (e.g. `omniscript/Foo`), which the
 *  nested id itself does not. Only `contains` edges whose dst is a nested id are kept
 *  (a Flow can also `contains` non-nested things in theory; nested-only keeps this
 *  strictly a rollup index). */
export function parentMapFromEdges(graph: Graph): Map<string, string> {
  const parents = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.type === "contains" && isNestedId(e.dst)) parents.set(e.dst, e.src);
  }
  return parents;
}

/** Map any node id to its container id (nested -> parent; container -> itself).
 *  When a `parents` map (from {@link parentMapFromEdges}) is supplied and knows this
 *  id, its `contains`-derived parent wins — this is what makes OmniStudio elements
 *  (omniscript/integrationprocedure/datamapper/flexcard) roll up correctly instead of
 *  to a nonexistent `flow/<Name>`. Without a `parents` entry it falls back to the
 *  type-based {@link NESTED_PARENT} guess (Flow elements, or graphs missing the
 *  `contains` edge). */
export function containerId(id: string, parents?: Map<string, string>): string {
  const fromEdge = parents?.get(id);
  if (fromEdge) return fromEdge;
  const slash = id.indexOf("/");
  if (slash < 0) return id;
  const parentType = NESTED_PARENT[id.slice(0, slash)];
  if (!parentType) return id; // already a container
  const name = id.slice(slash + 1);
  const dot = name.indexOf(".");
  return `${parentType}/${dot >= 0 ? name.slice(0, dot) : name}`;
}

/** Collapse nested nodes into their containers and roll edges up. Self-edges and
 *  edges to a missing container are dropped; parallel edges are de-duplicated. */
export function rollupToContainers(graph: Graph): Graph {
  const parents = parentMapFromEdges(graph);
  const containers: GraphNode[] = [];
  const childCounts = new Map<string, number>();
  for (const n of graph.nodes) {
    if (isNestedType(n.type)) {
      const parent = containerId(n.id, parents);
      childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1);
    } else {
      containers.push(n);
    }
  }
  const ids = new Set(containers.map((n) => n.id));
  const nodes: GraphNode[] = containers.map((n) => {
    const c = childCounts.get(n.id);
    return c ? { ...n, childCount: c } : n;
  });

  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const e of graph.edges) {
    const s = containerId(e.src, parents);
    const d = containerId(e.dst, parents);
    if (s === d || !ids.has(s) || !ids.has(d)) continue;
    const key = `${s} ${e.type} ${d}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ src: s, dst: d, type: e.type });
  }
  return { version: graph.version, nodes, edges, unresolved: [], errors: [] };
}

/** Resolve an edge endpoint to how it should appear given which containers are
 *  expanded: a nested node stays itself when its container is expanded, otherwise
 *  rolls up to that container; a container/main always resolves to itself. */
function resolveEndpoint(id: string, expanded: Set<string>, parents?: Map<string, string>): string {
  if (!isNestedId(id)) return id;
  const cont = containerId(id, parents);
  return expanded.has(cont) ? id : cont;
}

export interface ExploreResult {
  graph: Graph;
  /** Per expanded container, how many related mains were dropped past the cap. */
  truncated: Map<string, number>;
}

/** Reduce a too-big view to its `cap` most-connected nodes (degree desc, id asc
 *  for determinism), keeping only edges among the kept nodes. The top-connected
 *  slice of a huge graph is its DENSEST corner, so the edge count is bounded
 *  too: the node set shrinks until the surviving edges fit `edgeBudget` —
 *  without this, 1,500 interconnected hubs can carry enough edges to freeze the
 *  layout. The full graph stays on the host; search and drill-in still reach
 *  everything. Returns the input unchanged when it's already within both caps. */
export function topConnectedSlice(
  graph: Graph,
  cap: number,
  edgeBudget = Infinity,
  pin?: string,
): { graph: Graph; dropped: number } {
  if (graph.nodes.length <= cap && graph.edges.length <= edgeBudget) {
    return { graph, dropped: 0 };
  }
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.src, (degree.get(e.src) ?? 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1);
  }
  const ranked = [...graph.nodes].sort(
    (a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id),
  );
  let kept = ranked.slice(0, Math.min(cap, ranked.length));
  // Force-keep a pinned id (the focus root): a low-degree root can rank out, which
  // would strip the focus view of its own selection + scope controls. Swap it in for
  // the lowest-ranked kept node so the kept count (and `dropped`) is unchanged.
  if (pin && !kept.some((n) => n.id === pin)) {
    const pinned = graph.nodes.find((n) => n.id === pin);
    if (pinned) kept = [pinned, ...kept.slice(0, Math.max(0, kept.length - 1))];
  }
  let edges = edgesAmong(graph, kept);
  // Dropping the tail (lowest-degree kept nodes) prunes edges fast; floor of 100
  // nodes keeps the view meaningful even on pathologically dense graphs. The pin
  // (if any) rides at the head so the tail-trim never drops it.
  while (edges.length > edgeBudget && kept.length > 100) {
    const head = pin ? kept.filter((n) => n.id === pin) : [];
    const tail = pin ? kept.filter((n) => n.id !== pin) : kept;
    kept = [...head, ...tail.slice(0, Math.max(100 - head.length, Math.floor(tail.length * 0.85)))];
    edges = edgesAmong(graph, kept);
  }
  if (edges.length > edgeBudget) {
    // A near-complete hub core can exceed the budget even at the node floor —
    // trim edges deterministically (input order is stable) rather than render
    // an unbounded set. The status line already marks the view as capped.
    edges = edges.slice(0, edgeBudget);
  }
  return {
    graph: { version: graph.version, nodes: kept, edges, unresolved: [], errors: [] },
    dropped: graph.nodes.length - kept.length,
  };
}

function edgesAmong(graph: Graph, kept: GraphNode[]): GraphEdge[] {
  const ids = new Set(kept.map((n) => n.id));
  return graph.edges.filter((e) => ids.has(e.src) && ids.has(e.dst));
}

/** Focus "hide" mode: the induced subgraph of every node within `depth` hops of
 *  `root` over the RAW full graph (node-level, NOT container-rolled — the flat view
 *  shows real method/field nodes), honoring direction (out = what it depends on, in =
 *  what depends on it, both). `total` is the full neighborhood size before any render
 *  cap, so the caller can show "+N beyond cap". This is what makes a 36k-node org
 *  usable in the flat view: render the K-hop neighborhood, not everything. */
export function neighborhood(
  full: Graph,
  root: string,
  depth: number,
  direction: "out" | "in" | "both",
): { graph: Graph; total: number } {
  const byId = new Map(full.nodes.map((n) => [n.id, n]));
  const empty = { version: full.version, nodes: [], edges: [], unresolved: [], errors: [] };
  if (!byId.has(root)) return { graph: empty, total: 0 };

  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string): void => {
    const a = m.get(k);
    if (a) a.push(v);
    else m.set(k, [v]);
  };
  for (const e of full.edges) {
    push(out, e.src, e.dst);
    push(inc, e.dst, e.src);
  }
  const step = (n: string): string[] =>
    direction === "out"
      ? out.get(n) ?? []
      : direction === "in"
        ? inc.get(n) ?? []
        : [...(out.get(n) ?? []), ...(inc.get(n) ?? [])];

  const seen = new Set<string>([root]);
  let frontier = [root];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const n of frontier) {
      for (const nb of step(n)) {
        if (byId.has(nb) && !seen.has(nb)) {
          seen.add(nb);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  const nodes = [...seen].map((id) => byId.get(id)!);
  return { graph: { version: full.version, nodes, edges: edgesAmong(full, nodes), unresolved: [], errors: [] }, total: seen.size };
}

/** The "drill-in" view: starting from a rolled overview, fully expand the given
 *  `expanded` containers into their child nodes, and around each show up to
 *  `maxRelated` of its most-connected neighbouring containers (kept collapsed, so
 *  they can be expanded in turn). Edges are rendered child-level for expanded
 *  containers and rolled-up for everything else. Computed in the host so the
 *  webview only ever holds this small focused slice, never the full graph. */
export function exploreView(full: Graph, expanded: Set<string>, maxRelated: number): ExploreResult {
  const parents = parentMapFromEdges(full);
  const allById = new Map(full.nodes.map((n) => [n.id, n]));
  const childCounts = new Map<string, number>();
  const childrenByContainer = new Map<string, GraphNode[]>();
  const mainIds = new Set<string>();
  for (const n of full.nodes) {
    if (isNestedType(n.type)) {
      const c = containerId(n.id, parents);
      childCounts.set(c, (childCounts.get(c) ?? 0) + 1);
      const list = childrenByContainer.get(c);
      if (list) list.push(n);
      else childrenByContainer.set(c, [n]);
    } else {
      mainIds.add(n.id);
    }
  }

  // Node set: expanded containers + their children, plus each container's capped
  // ring of related mains.
  const nodeIds = new Set<string>();
  for (const c of expanded) {
    if (mainIds.has(c)) nodeIds.add(c);
    for (const ch of childrenByContainer.get(c) ?? []) nodeIds.add(ch.id);
  }
  const truncated = new Map<string, number>();
  for (const c of expanded) {
    const weight = new Map<string, number>();
    for (const e of full.edges) {
      const sc = isNestedId(e.src) ? containerId(e.src, parents) : e.src;
      const dc = isNestedId(e.dst) ? containerId(e.dst, parents) : e.dst;
      const other = sc === c && dc !== c ? dc : dc === c && sc !== c ? sc : undefined;
      if (other && mainIds.has(other)) weight.set(other, (weight.get(other) ?? 0) + 1);
    }
    const ranked = [...weight.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const keep = maxRelated > 0 ? ranked.slice(0, maxRelated) : [];
    for (const [id] of keep) nodeIds.add(id);
    if (ranked.length > keep.length) truncated.set(c, ranked.length - keep.length);
  }

  const nodes: GraphNode[] = [];
  for (const id of nodeIds) {
    const n = allById.get(id);
    if (!n) continue;
    const c = !isNestedType(n.type) ? childCounts.get(id) : undefined;
    nodes.push(c ? { ...n, childCount: c } : n);
  }

  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const e of full.edges) {
    const s = resolveEndpoint(e.src, expanded, parents);
    const d = resolveEndpoint(e.dst, expanded, parents);
    if (s === d || !nodeIds.has(s) || !nodeIds.has(d)) continue;
    const key = `${s} ${e.type} ${d}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ src: s, dst: d, type: e.type });
  }
  return { graph: { version: full.version, nodes, edges, unresolved: [], errors: [] }, truncated };
}

// ---- Selection-driven additive "Explore" (the detail-panel block) -------------
// Each selected node can reveal, around itself, a chosen amount of: its rolled-up
// MEMBERS (children), its most-connected NEIGHBOUR mains (either direction), and the
// mains that point INTO it (SOURCES). Reveals are ADDITIVE — they're layered on top
// of the current capped overview, the rest of the map stays — and computed host-side
// from the full graph, so the webview never needs to hold everything.

export interface ExploreSpec {
  /** Reveal this node's rolled-up children. */
  members: boolean;
  /** How many most-connected neighbour mains to reveal (either direction). */
  neighbors: number;
  /** How many incoming-edge mains (sources) to reveal. */
  sources: number;
}

export interface ExploreTotals {
  members: number;
  neighbors: number;
  sources: number;
}

/** How much is available to reveal around `id` (computed from the full graph), so the
 *  Explore block can show counts and stop `+` at the maximum. */
export function exploreTotals(full: Graph, id: string): ExploreTotals {
  const parents = parentMapFromEdges(full);
  const mainIds = new Set<string>();
  let members = 0;
  for (const n of full.nodes) {
    if (isNestedType(n.type)) {
      if (containerId(n.id, parents) === id) members++;
    } else {
      mainIds.add(n.id);
    }
  }
  const neighbors = new Set<string>();
  const sources = new Set<string>();
  for (const e of full.edges) {
    const sc = isNestedId(e.src) ? containerId(e.src, parents) : e.src;
    const dc = isNestedId(e.dst) ? containerId(e.dst, parents) : e.dst;
    if (sc === id && dc !== id && mainIds.has(dc)) neighbors.add(dc);
    if (dc === id && sc !== id && mainIds.has(sc)) {
      neighbors.add(sc);
      sources.add(sc);
    }
  }
  return { members, neighbors: neighbors.size, sources: sources.size };
}

/** A root's neighbour mains ranked by edge weight (desc, id asc for determinism),
 *  split into all-directions and incoming-only. */
function rankedNeighbors(
  full: Graph,
  id: string,
  mainIds: Set<string>,
  parents: Map<string, string>,
): { both: string[]; incoming: string[] } {
  const w = new Map<string, number>();
  const inc = new Map<string, number>();
  for (const e of full.edges) {
    const sc = isNestedId(e.src) ? containerId(e.src, parents) : e.src;
    const dc = isNestedId(e.dst) ? containerId(e.dst, parents) : e.dst;
    if (sc === id && dc !== id && mainIds.has(dc)) w.set(dc, (w.get(dc) ?? 0) + 1);
    if (dc === id && sc !== id && mainIds.has(sc)) {
      w.set(sc, (w.get(sc) ?? 0) + 1);
      inc.set(sc, (inc.get(sc) ?? 0) + 1);
    }
  }
  const sort = (m: Map<string, number>): string[] =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  return { both: sort(w), incoming: sort(inc) };
}

/** Additive explore view: the `base` (capped overview) PLUS, around each explored
 *  root, its members / neighbour mains / source mains per its spec. Edges render at
 *  child level for member-expanded roots, rolled-up otherwise. The base stays.
 *
 *  `maxNodes` bounds the total node count: member expansion (which can add thousands
 *  of children at once) stops adding once the view reaches the cap, so a single
 *  "Expand members" on a huge container can't bypass `graphViewer.maxRenderNodes` and
 *  freeze the layout. `Infinity` disables the cap. Neighbour/source reveals are
 *  already bounded per step by the caller (maxRelatedNodes) so they aren't re-capped
 *  here — but they still count against the budget that members see. */
export function expandedView(
  full: Graph,
  base: Graph,
  explore: Map<string, ExploreSpec>,
  maxNodes = Infinity,
): Graph {
  const parents = parentMapFromEdges(full);
  const allById = new Map(full.nodes.map((n) => [n.id, n]));
  const childCounts = new Map<string, number>();
  const childrenByContainer = new Map<string, GraphNode[]>();
  const mainIds = new Set<string>();
  for (const n of full.nodes) {
    if (isNestedType(n.type)) {
      const c = containerId(n.id, parents);
      childCounts.set(c, (childCounts.get(c) ?? 0) + 1);
      let list = childrenByContainer.get(c);
      if (!list) {
        list = [];
        childrenByContainer.set(c, list);
      }
      list.push(n);
    } else {
      mainIds.add(n.id);
    }
  }

  const nodeIds = new Set<string>(base.nodes.map((n) => n.id));
  const memberExpanded = new Set<string>();
  // Reveal neighbour/source mains first (small, per-step bounded), then members.
  // Members are what can explode, so they consume whatever node budget is left after
  // the base + the ring reveals — keeping the total under `maxNodes`.
  for (const [root, spec] of explore) {
    if (mainIds.has(root)) nodeIds.add(root);
    if (spec.neighbors > 0 || spec.sources > 0) {
      const { both, incoming } = rankedNeighbors(full, root, mainIds, parents);
      for (const m of both.slice(0, Math.max(0, spec.neighbors))) nodeIds.add(m);
      for (const m of incoming.slice(0, Math.max(0, spec.sources))) nodeIds.add(m);
    }
  }
  for (const [root, spec] of explore) {
    if (!spec.members) continue;
    memberExpanded.add(root);
    for (const ch of childrenByContainer.get(root) ?? []) {
      if (nodeIds.size >= maxNodes && !nodeIds.has(ch.id)) break; // budget spent — stop adding children
      nodeIds.add(ch.id);
    }
  }

  const nodes: GraphNode[] = [];
  for (const id of nodeIds) {
    const n = allById.get(id);
    if (!n) continue;
    const c = !isNestedType(n.type) ? childCounts.get(id) : undefined;
    nodes.push(c ? { ...n, childCount: c } : n);
  }

  const resolve = (eid: string): string =>
    isNestedId(eid) && !memberExpanded.has(containerId(eid, parents)) ? containerId(eid, parents) : eid;
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const e of full.edges) {
    const s = resolve(e.src);
    const d = resolve(e.dst);
    if (s === d || !nodeIds.has(s) || !nodeIds.has(d)) continue;
    const key = `${s} ${e.type} ${d}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ src: s, dst: d, type: e.type });
  }
  return { version: full.version, nodes, edges, unresolved: [], errors: [] };
}
