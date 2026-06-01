// Runs the (CPU-bound) graph build off the extension's main thread so the UI
// never freezes. The extension posts a source-folder path; we post back the graph.
import { parentPort } from "worker_threads";
import { buildGraph } from "./index";

parentPort?.on("message", (root: string) => {
  try {
    parentPort?.postMessage({ ok: true, graph: buildGraph(root) });
  } catch (err) {
    parentPort?.postMessage({ ok: false, error: (err as Error).message });
  }
});
