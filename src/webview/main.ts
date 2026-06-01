import cytoscape, { Core, ElementDefinition, Layouts, NodeSingular } from "cytoscape";
import fcose from "cytoscape-fcose";
import cola from "cytoscape-cola";
import { Graph, GraphNode } from "../graph/types";
import { typeColor } from "../graph/labels";
import { renderDetail } from "./render";

cytoscape.use(fcose);
cytoscape.use(cola);

interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscodeApi = acquireVsCodeApi();

interface Settings {
  physics: boolean;
  spacing: number;
  animateOnHover: boolean;
}

const accent =
  getComputedStyle(document.body).getPropertyValue("--vscode-focusBorder").trim() || "#4C8DFF";

// ---- DOM handles ----
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const cyEl = $<HTMLDivElement>("#cy");
const detailEl = $<HTMLElement>("#detail");
const nodeFiltersEl = $<HTMLDivElement>("#node-filters");
const edgeFiltersEl = $<HTMLDivElement>("#edge-filters");
const searchEl = $<HTMLInputElement>("#search");
const statusEl = $<HTMLSpanElement>("#status");

// ---- state ----
let cy: Core | undefined;
let graph: Graph | undefined;
let byId = new Map<string, GraphNode>();
const enabledNodeTypes = new Set<string>();
const enabledEdgeTypes = new Set<string>();
let selectedId: string | undefined;
let settings: Settings = { physics: true, spacing: 100, animateOnHover: true };
let sim: Layouts | undefined; // the running continuous (cola) simulation, when physics is on

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg?.type === "setGraph") {
    if (msg.settings) settings = msg.settings as Settings;
    graph = msg.graph as Graph;
    build(graph);
  } else if (msg?.type === "updateSettings") {
    applySettings(msg.settings as Settings);
  }
});

vscodeApi.postMessage({ type: "ready" });

// ---- build ----
function build(g: Graph): void {
  byId = new Map(g.nodes.map((n) => [n.id, n]));
  selectedId = undefined;
  clearDetail();

  const degree = new Map<string, number>();
  for (const e of g.edges) {
    degree.set(e.src, (degree.get(e.src) ?? 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1);
  }
  let maxDeg = 1;
  for (const d of degree.values()) maxDeg = Math.max(maxDeg, d);

  const elements: ElementDefinition[] = [];
  for (const n of g.nodes) {
    elements.push({
      data: {
        id: n.id,
        label: n.label,
        type: n.type,
        color: typeColor(n.type),
        deg: degree.get(n.id) ?? 0,
        external: n.external ? 1 : 0,
      },
    });
  }
  g.edges.forEach((e, i) => {
    elements.push({ data: { id: `e${i}`, source: e.src, target: e.dst, type: e.type } });
  });

  stopSim();
  cy?.destroy();
  cy = cytoscape({
    container: cyEl,
    elements,
    wheelSensitivity: 0.2,
    style: buildStyle(maxDeg),
  });

  cy.on("tap", "node", (evt) => select((evt.target as NodeSingular).id()));
  cy.on("tap", (evt) => {
    if (evt.target === cy) clearSelection();
  });
  cy.on("mouseover", "node", (evt) => onHover(evt.target as NodeSingular));
  cy.on("mouseout", "node", (evt) => offHover(evt.target as NodeSingular));
  // Wake the simulation while the user manipulates a node so neighbors react;
  // it settles and stops on its own afterward.
  cy.on("grab", "node", () => wakePhysics());
  cy.on("drag", "node", () => {
    if (settings.physics && !sim) startSettle();
  });

  buildFilters(g);
  applyFilters();
  runLayout();
  updateStatus();
}

// ---- layout & physics ----
function runLayout(): void {
  if (!cy) return;
  stopSim();
  const count = cy.nodes().length;
  const layout = cy.layout(fcoseOptions(settings.spacing, count));
  // After the initial force layout, let physics settle the graph once — it then
  // stops on its own, so an idle graph costs nothing. Interaction re-wakes it.
  layout.one("layoutstop", () => {
    if (settings.physics && !document.hidden) startSettle();
  });
  layout.run();
}

// Run a finite physics pass that settles the graph and then stops itself.
// `sim` holds the handle only while it is actually running.
function startSettle(): void {
  if (!cy || !settings.physics) return;
  stopSim();
  const layout = cy.layout(colaOptions(settings.spacing));
  sim = layout;
  layout.one("layoutstop", () => {
    if (sim === layout) sim = undefined;
  });
  layout.run();
}

// Re-energize physics on interaction, optionally absorbing a small hover nudge.
function wakePhysics(node?: NodeSingular): void {
  if (!settings.physics || !cy) return;
  if (node && settings.animateOnHover) {
    const p = node.position();
    node.position({ x: p.x + (Math.random() * 14 - 7), y: p.y + (Math.random() * 14 - 7) });
  }
  if (!sim) startSettle();
}

function stopSim(): void {
  if (sim) {
    sim.stop();
    sim = undefined;
  }
}

function fcoseOptions(spacing: number, count: number): cytoscape.LayoutOptions {
  return {
    name: "fcose",
    quality: "default",
    animate: count <= 200,
    randomize: true,
    fit: true,
    padding: 40,
    nodeRepulsion: 4500 + spacing * 30,
    idealEdgeLength: spacing,
    nodeSeparation: Math.max(20, spacing * 0.85),
    packComponents: true,
  } as unknown as cytoscape.LayoutOptions;
}

function colaOptions(spacing: number): cytoscape.LayoutOptions {
  return {
    name: "cola",
    infinite: false, // settle, then stop — re-woken on interaction (low idle cost)
    fit: false,
    animate: true,
    randomize: false, // continue from the fcose positions
    maxSimulationTime: 2000,
    convergenceThreshold: 0.01,
    edgeLength: spacing,
    nodeSpacing: Math.max(8, spacing * 0.4),
    avoidOverlap: true,
    handleDisconnected: true,
  } as unknown as cytoscape.LayoutOptions;
}

function buildStyle(maxDeg: number): cytoscape.StylesheetStyle[] {
  return [
    {
      selector: "node",
      style: {
        "background-color": "data(color)",
        label: "data(label)",
        width: `mapData(deg, 0, ${maxDeg}, 14, 52)`,
        height: `mapData(deg, 0, ${maxDeg}, 14, 52)`,
        "font-size": 7,
        color: "#c8c8c8",
        "text-valign": "bottom",
        "text-halign": "center",
        "text-margin-y": 2,
        "min-zoomed-font-size": 8,
        "border-width": 0,
        "transition-property": "border-width border-color background-blacken",
        "transition-duration": 120,
      } as cytoscape.Css.Node,
    },
    {
      selector: "node[external = 1]",
      style: { "background-opacity": 0.5, "border-width": 1, "border-style": "dashed", "border-color": "#888" },
    },
    {
      selector: "edge",
      style: {
        width: 1,
        "line-color": "#5a5a5a",
        "line-opacity": 0.5,
        "curve-style": "straight",
        "target-arrow-shape": "triangle",
        "target-arrow-color": "#5a5a5a",
        "arrow-scale": 0.6,
      },
    },
    { selector: "node.hover", style: { "border-width": 2, "border-color": accent, "border-opacity": 0.7, "background-blacken": -0.15 } },
    { selector: "node.sel", style: { "border-width": 3, "border-color": accent, "border-style": "solid", "border-opacity": 1 } },
    { selector: "node.hl", style: { "border-width": 2, "border-color": accent, "border-style": "solid", "border-opacity": 1 } },
    { selector: "edge.hl", style: { "line-color": accent, "target-arrow-color": accent, "line-opacity": 1, width: 2, "z-index": 9 } },
    { selector: ".dim", style: { opacity: 0.12 } },
  ];
}

// ---- hover ----
function onHover(node: NodeSingular): void {
  node.addClass("hover");
  node.neighborhood("node").addClass("hover");
  // A tiny perturbation + a brief physics wake makes the neighborhood ripple and
  // resettle (gated on animateOnHover, and on physics inside wakePhysics).
  if (settings.animateOnHover) wakePhysics(node);
}

function offHover(_node: NodeSingular): void {
  cy?.nodes().removeClass("hover");
}

// ---- selection ----
function select(id: string): void {
  if (!cy) return;
  selectedId = id;
  cy.batch(() => {
    cy!.elements().removeClass("sel hl");
    const node = cy!.getElementById(id);
    if (node.empty()) return;
    node.addClass("sel");
    const incident = node.connectedEdges();
    incident.addClass("hl");
    incident.connectedNodes().not(node).addClass("hl");
  });
  if (graph) detailEl.innerHTML = renderDetail(graph, byId, id);
}

function focusNode(id: string): void {
  if (!cy) return;
  const node = cy.getElementById(id);
  if (node.empty()) return;
  cy.animate({ center: { eles: node }, duration: 200 });
  select(id);
}

function clearSelection(): void {
  selectedId = undefined;
  cy?.elements().removeClass("sel hl");
  clearDetail();
}

function clearDetail(): void {
  detailEl.innerHTML = `<div class="placeholder">Select a node to see its details.</div>`;
}

// Detail-panel link navigation (event delegation).
detailEl.addEventListener("click", (e) => {
  const link = (e.target as HTMLElement).closest(".node-link") as HTMLElement | null;
  if (link?.dataset.id) {
    e.preventDefault();
    focusNode(link.dataset.id);
  }
});

// ---- settings ----
function applySettings(next: Settings): void {
  const prev = settings;
  settings = next;
  if (!cy) return;
  if (prev.spacing !== next.spacing) {
    runLayout(); // re-space everything (re-runs the initial layout, then physics)
  } else if (prev.physics !== next.physics) {
    if (next.physics) startSettle();
    else stopSim();
  }
}

// Pause the simulation while the tab is hidden so it doesn't burn CPU in the
// background; resume when shown again.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopSim();
});

// ---- filters ----
function buildFilters(g: Graph): void {
  const nodeCounts = countBy(g.nodes.map((n) => n.type));
  const edgeCounts = countBy(g.edges.map((e) => e.type));

  enabledNodeTypes.clear();
  enabledEdgeTypes.clear();
  for (const t of nodeCounts.keys()) enabledNodeTypes.add(t);
  for (const t of edgeCounts.keys()) enabledEdgeTypes.add(t);

  nodeFiltersEl.innerHTML = "";
  for (const [type, count] of sortedEntries(nodeCounts)) {
    nodeFiltersEl.appendChild(filterRow(type, count, typeColor(type), enabledNodeTypes, type, applyFilters));
  }
  edgeFiltersEl.innerHTML = "";
  for (const [type, count] of sortedEntries(edgeCounts)) {
    edgeFiltersEl.appendChild(filterRow(type, count, undefined, enabledEdgeTypes, type, applyFilters));
  }
}

function filterRow(
  label: string,
  count: number,
  color: string | undefined,
  set: Set<string>,
  key: string,
  onChange: () => void,
): HTMLElement {
  const row = document.createElement("label");
  row.className = "filter-row";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = set.has(key);
  cb.addEventListener("change", () => {
    if (cb.checked) set.add(key);
    else set.delete(key);
    onChange();
  });
  row.appendChild(cb);
  if (color) {
    const dot = document.createElement("span");
    dot.className = "dot sm";
    dot.style.background = color;
    row.appendChild(dot);
  }
  const name = document.createElement("span");
  name.className = "filter-name";
  name.textContent = label;
  row.appendChild(name);
  const cnt = document.createElement("span");
  cnt.className = "count";
  cnt.textContent = String(count);
  row.appendChild(cnt);
  return row;
}

function applyFilters(): void {
  if (!cy) return;
  cy.batch(() => {
    cy!.nodes().forEach((n) => {
      n.style("display", enabledNodeTypes.has(n.data("type")) ? "element" : "none");
    });
    cy!.edges().forEach((e) => {
      const ok =
        enabledEdgeTypes.has(e.data("type")) &&
        enabledNodeTypes.has(e.source().data("type")) &&
        enabledNodeTypes.has(e.target().data("type"));
      e.style("display", ok ? "element" : "none");
    });
  });
  applySearch();
  updateStatus();
}

// "all / none" quick toggles.
document.querySelectorAll<HTMLElement>("[data-all]").forEach((el) => {
  el.addEventListener("click", () => {
    const action = el.dataset.all;
    const nodeOn = action === "node-on";
    const nodeOff = action === "node-off";
    const edgeOn = action === "edge-on";
    if (nodeOn || nodeOff) {
      enabledNodeTypes.clear();
      if (nodeOn && graph) graph.nodes.forEach((n) => enabledNodeTypes.add(n.type));
      syncChecks(nodeFiltersEl, nodeOn);
    } else if (graph) {
      enabledEdgeTypes.clear();
      if (edgeOn) graph.edges.forEach((e) => enabledEdgeTypes.add(e.type));
      syncChecks(edgeFiltersEl, edgeOn);
    }
    applyFilters();
  });
});

function syncChecks(container: HTMLElement, checked: boolean): void {
  container.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb) => {
    cb.checked = checked;
  });
}

// ---- search ----
searchEl.addEventListener("input", () => applySearch());

function applySearch(): void {
  if (!cy) return;
  const term = searchEl.value.trim().toLowerCase();
  cy.batch(() => {
    if (!term) {
      cy!.nodes().removeClass("dim");
      return;
    }
    cy!.nodes().forEach((n) => {
      const hit = String(n.data("label")).toLowerCase().includes(term);
      if (hit) n.removeClass("dim");
      else n.addClass("dim");
    });
  });
  updateStatus();
}

// ---- toolbar ----
$<HTMLButtonElement>("#relayout").addEventListener("click", () => runLayout());
$<HTMLButtonElement>("#fit").addEventListener("click", () => cy?.fit(undefined, 30));
$<HTMLButtonElement>("#toggle-filters").addEventListener("click", () => {
  document.getElementById("app")?.classList.toggle("filters-hidden");
  setTimeout(() => cy?.resize(), 0);
});

// ---- helpers ----
function updateStatus(): void {
  if (!cy || !graph) return;
  const visibleNodes = cy.nodes().filter((n) => n.style("display") !== "none").length;
  const total = graph.nodes.length;
  const shown = visibleNodes === total ? `${total} nodes` : `${visibleNodes}/${total} nodes`;
  statusEl.textContent = `${shown} · ${graph.edges.length} edges`;
}

function countBy(items: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
  return m;
}

function sortedEntries(m: Map<string, number>): [string, number][] {
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
