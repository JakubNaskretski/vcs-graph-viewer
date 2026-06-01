import { Graph } from "../graph/types";

/**
 * A source of graph data. Everything downstream (the panel, the webview, the
 * renderer) depends only on the {@link Graph} this produces — never on where it
 * came from.
 *
 * Today the only implementation is {@link FileGraphSource} (reads a graph.json).
 * This is the deliberate extension point for step 2: an in-plugin builder will
 * add a `BuilderGraphSource` that constructs a Graph directly from a Salesforce
 * source folder, and nothing else in the viewer has to change.
 */
export interface GraphSource {
  /** Stable identity for persistence / change-watching (e.g. an fsPath). */
  readonly id: string;
  /** Short human label shown in the panel title (e.g. a file name). */
  readonly label: string;
  /** A filesystem path to watch for live reload, if this source is file-backed. */
  readonly watchPath?: string;
  load(): Promise<Graph>;
}
