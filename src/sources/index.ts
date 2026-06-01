import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { FileGraphSource } from "./fileGraphSource";
import { GraphSource } from "./graphSource";

export { GraphSource } from "./graphSource";
export { FileGraphSource } from "./fileGraphSource";

const CONFIG_SECTION = "graphViewer";
const PATH_KEY = "graphPath";

/**
 * Decide which {@link GraphSource} to open.
 *
 * Order: an explicit `uri` (e.g. from the explorer context menu) wins; otherwise
 * the configured `graphViewer.graphPath`; otherwise we prompt for a file. When
 * `forcePick` is set we always prompt. A freshly picked file is remembered in the
 * configuration so the next "Open Graph Viewer" is one click.
 *
 * This is the single place that maps user intent to a source — when the step-2
 * builder lands, the "build from a Salesforce folder" choice is added here.
 */
export async function resolveGraphSource(
  uri?: vscode.Uri,
  opts: { forcePick?: boolean } = {},
): Promise<GraphSource | undefined> {
  if (uri && !opts.forcePick) {
    return new FileGraphSource(uri.fsPath);
  }

  if (!opts.forcePick) {
    const configured = resolveConfiguredPath();
    if (configured && fs.existsSync(configured)) {
      return new FileGraphSource(configured);
    }
  }

  const picked = await promptForGraphFile();
  if (!picked) {
    return undefined;
  }
  await rememberPath(picked.fsPath);
  return new FileGraphSource(picked.fsPath);
}

/** Resolve `graphViewer.graphPath`, expanding a workspace-relative path. */
function resolveConfiguredPath(): string | undefined {
  const raw = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>(PATH_KEY)?.trim();
  if (!raw) {
    return undefined;
  }
  if (path.isAbsolute(raw)) {
    return raw;
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? path.join(folder.uri.fsPath, raw) : raw;
}

async function promptForGraphFile(): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    title: "Select a graph.json produced by graph-builder",
    canSelectMany: false,
    filters: { "Graph JSON": ["json"], "All files": ["*"] },
    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
  });
  return picked?.[0];
}

async function rememberPath(fsPath: string): Promise<void> {
  // Store workspace-relative when inside the workspace, so the setting travels
  // with the project; otherwise store the absolute path globally.
  const folder = vscode.workspace.workspaceFolders?.[0];
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  if (folder && fsPath.startsWith(folder.uri.fsPath + path.sep)) {
    const rel = path.relative(folder.uri.fsPath, fsPath);
    await config.update(PATH_KEY, rel, vscode.ConfigurationTarget.Workspace);
  } else {
    await config.update(PATH_KEY, fsPath, vscode.ConfigurationTarget.Global);
  }
}
