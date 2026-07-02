import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Graph } from "./types";
import { normalizeGraph } from "./validate";
import {
  containerId,
  exploreTotals,
  expandedView,
  parentMapFromEdges,
  rollupToContainers,
  topConnectedSlice,
} from "./rollup";

// Mirrors what src/builder/extractors/omnistudio.ts actually emits: a component
// node `<otype>/<Name>`, element nodes `flowelement/<Name>.<Element>`, a `contains`
// edge from the component to each element, and per-element refs on the flowelement
// (e.g. `calls -> apexclass`). Because the extractor DELIBERATELY skips duplicating
// element refs on the component, an OmniScript's call to an Apex class exists ONLY on
// the flowelement — so if the rollup sends that element to the wrong parent, the edge
// vanishes entirely and the OmniScript renders disconnected from the class it calls.
function omniScriptGraph(): Graph {
  return {
    version: 1,
    nodes: [
      { id: "omniscript/MyScript", type: "omniscript", label: "MyScript" },
      { id: "flowelement/MyScript.Step1", type: "flowelement", label: "Step1" },
      { id: "apexclass/DoWork", type: "apexclass", label: "DoWork" },
    ],
    edges: [
      { src: "omniscript/MyScript", dst: "flowelement/MyScript.Step1", type: "contains" },
      { src: "flowelement/MyScript.Step1", dst: "apexclass/DoWork", type: "calls" },
    ],
  };
}

test("parentMapFromEdges derives the real parent of an OmniStudio flowelement", () => {
  const parents = parentMapFromEdges(omniScriptGraph());
  assert.equal(parents.get("flowelement/MyScript.Step1"), "omniscript/MyScript");
});

test("containerId without a parent map falls back to the flow guess (the old bug)", () => {
  // Documents WHY the parent map exists: the id alone can only guess `flow/`, which is
  // wrong for OmniStudio. This is the pre-fix behavior, kept as the fallback.
  assert.equal(containerId("flowelement/MyScript.Step1"), "flow/MyScript");
});

test("containerId with the parent map rolls the element up to its OmniScript", () => {
  const parents = parentMapFromEdges(omniScriptGraph());
  assert.equal(containerId("flowelement/MyScript.Step1", parents), "omniscript/MyScript");
});

test("rollupToContainers keeps the OmniScript -> apexclass edge (regression: it used to vanish)", () => {
  const rolled = rollupToContainers(omniScriptGraph());
  const ids = new Set(rolled.nodes.map((n) => n.id));
  // The element is gone (rolled up) and its container survives.
  assert.ok(ids.has("omniscript/MyScript"), "OmniScript node present");
  assert.ok(ids.has("apexclass/DoWork"), "Apex class node present");
  assert.ok(!ids.has("flowelement/MyScript.Step1"), "flowelement rolled away");
  // No phantom flow container was created.
  assert.ok(!ids.has("flow/MyScript"), "no phantom flow/<Name> container");
  // The critical assertion: the calls edge, which lived only on the element, now
  // connects the OmniScript to the Apex class. Before the fix this edge was dropped
  // (it rolled up to flow/MyScript, which isn't a node, so the edge failed the
  // `ids.has(...)` guard in rollupToContainers).
  const edge = rolled.edges.find(
    (e) => e.src === "omniscript/MyScript" && e.dst === "apexclass/DoWork" && e.type === "calls",
  );
  assert.ok(edge, "OmniScript -> apexclass calls edge survived the rollup");
  // The OmniScript is credited with its one child.
  const os = rolled.nodes.find((n) => n.id === "omniscript/MyScript");
  assert.equal((os as { childCount?: number }).childCount, 1);
});

test("exploreTotals counts the OmniScript's members and neighbours via the real parent", () => {
  const totals = exploreTotals(omniScriptGraph(), "omniscript/MyScript");
  assert.equal(totals.members, 1, "one flowelement member");
  assert.equal(totals.neighbors, 1, "the Apex class it calls is a neighbour");
});

// A real Flow (parent kind `flow`) must still roll up correctly — the fix must not
// regress the type-based fallback for Flows, whose flowelements ALSO look like
// `flowelement/<Name>.<Element>` but genuinely belong to `flow/<Name>`.
test("rollupToContainers still rolls a real Flow's element into its flow", () => {
  const graph: Graph = {
    version: 1,
    nodes: [
      { id: "flow/OrderFlow", type: "flow", label: "OrderFlow" },
      { id: "flowelement/OrderFlow.Assign1", type: "flowelement", label: "Assign1" },
      { id: "apexclass/Helper", type: "apexclass", label: "Helper" },
    ],
    edges: [
      { src: "flow/OrderFlow", dst: "flowelement/OrderFlow.Assign1", type: "contains" },
      { src: "flowelement/OrderFlow.Assign1", dst: "apexclass/Helper", type: "invocable" },
    ],
  };
  const rolled = rollupToContainers(graph);
  const edge = rolled.edges.find(
    (e) => e.src === "flow/OrderFlow" && e.dst === "apexclass/Helper",
  );
  assert.ok(edge, "Flow -> apexclass edge survived");
  assert.ok(!rolled.nodes.some((n) => n.id === "flowelement/OrderFlow.Assign1"), "element rolled away");
});

// Sanity-load the bundled example graph(s) through the real validate -> rollup ->
// slice/expand path so a coding error in any of those crashes here rather than in the
// live webview. The example .graph.json files are gitignored dev fixtures at the repo
// root; skip cleanly if they aren't present (clean checkout / CI).
test("bundled example graphs load and roll up without throwing", () => {
  const root = path.resolve(__dirname, "..", ".."); // out-test/graph -> repo root
  const candidates = ["example-org-small.graph.json", "example-org-large.graph.json"];
  let loadedAny = false;
  for (const name of candidates) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    loadedAny = true;
    const graph = normalizeGraph(JSON.parse(fs.readFileSync(p, "utf8")));
    assert.ok(graph.nodes.length > 0, `${name} has nodes`);
    // Rollup must not throw and must not invent container ids that aren't real nodes.
    const rolled = rollupToContainers(graph);
    const ids = new Set(rolled.nodes.map((n) => n.id));
    for (const e of rolled.edges) {
      assert.ok(ids.has(e.src) && ids.has(e.dst), `${name}: rolled edge endpoints exist`);
    }
    // The slice + expand paths the panel uses must also survive the real data.
    const sliced = topConnectedSlice(rolled, 1500, 6000);
    assert.ok(sliced.graph.nodes.length <= rolled.nodes.length);
    const firstMain = rolled.nodes[0]?.id;
    if (firstMain) {
      const expanded = expandedView(graph, sliced.graph, new Map([[firstMain, { members: true, neighbors: 5, sources: 5 }]]), 6000);
      assert.ok(expanded.nodes.length >= sliced.graph.nodes.length, `${name}: expand is additive`);
    }
  }
  if (!loadedAny) {
    // Not a failure: the fixtures are local-only. Note it so the skip is visible.
    console.log("  (example graph fixtures not present — sanity-load skipped)");
  }
});
