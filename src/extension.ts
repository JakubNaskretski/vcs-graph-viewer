import * as path from "path";
import { Worker } from "worker_threads";
import * as vscode from "vscode";
import { normalizeGraph } from "./graph/validate";
import { GraphEntry, GraphLibrary, GraphLibraryProvider } from "./library";
import { GraphPanel } from "./panel";
import { FileGraphSource, resolveGraphSource } from "./sources";

export function activate(context: vscode.ExtensionContext): void {
  const library = new GraphLibrary(context);
  const libraryView = new GraphLibraryProvider(library);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("graphViewer.library", libraryView),

    // --- open an ad-hoc file (not in the library) ---
    vscode.commands.registerCommand("graphViewer.open", async (uri?: vscode.Uri) => {
      const source = await resolveGraphSource(uri instanceof vscode.Uri ? uri : undefined);
      if (source) await GraphPanel.createOrShow(context, source);
    }),

    vscode.commands.registerCommand("graphViewer.selectFile", async () => {
      const source = await resolveGraphSource(undefined, { forcePick: true });
      if (source) await GraphPanel.createOrShow(context, source);
    }),

    vscode.commands.registerCommand("graphViewer.reload", async () => {
      await GraphPanel.current?.reload();
    }),

    // --- the library (stored in global storage) ---
    vscode.commands.registerCommand("graphViewer.import", async (uri?: vscode.Uri) => {
      const target =
        uri instanceof vscode.Uri
          ? uri
          : (
              await vscode.window.showOpenDialog({
                title: "Import a graph.json into the library",
                canSelectMany: false,
                filters: { "Graph JSON": ["json"], "All files": ["*"] },
                defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
              })
            )?.[0];
      if (!target) return;
      try {
        const entry = await library.importFile(target);
        libraryView.refresh();
        const choice = await vscode.window.showInformationMessage(
          `Imported "${entry.name}" — ${entry.nodeCount} nodes, ${entry.edgeCount} edges.`,
          "Open",
        );
        if (choice === "Open") await openStored(context, library, entry);
      } catch (err) {
        void vscode.window.showErrorMessage(`Graph Viewer: import failed — ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand("graphViewer.generate", async (uri?: vscode.Uri) => {
      const folder =
        uri instanceof vscode.Uri
          ? uri
          : (
              await vscode.window.showOpenDialog({
                title: "Select a source folder to build a graph from (e.g. force-app)",
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: "Build graph",
                defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
              })
            )?.[0];
      if (!folder) return;
      try {
        const entry = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Building graph from "${path.basename(folder.fsPath)}"…`,
            cancellable: true,
          },
          async (_progress, token) => {
            const raw = await runBuildWorker(context, folder.fsPath, token);
            if (raw === undefined) return undefined; // cancelled
            return library.add(path.basename(folder.fsPath), normalizeGraph(raw), folder.fsPath);
          },
        );
        if (!entry) return; // cancelled
        libraryView.refresh();
        const choice = await vscode.window.showInformationMessage(
          `Built "${entry.name}" — ${entry.nodeCount} nodes, ${entry.edgeCount} edges.`,
          "Open",
        );
        if (choice === "Open") await openStored(context, library, entry);
      } catch (err) {
        void vscode.window.showErrorMessage(`Graph Viewer: build failed — ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand("graphViewer.openStored", async (entry: GraphEntry) => {
      if (entry) await openStored(context, library, entry);
    }),

    vscode.commands.registerCommand("graphViewer.deleteStored", async (entry: GraphEntry) => {
      if (!entry) return;
      const choice = await vscode.window.showWarningMessage(
        `Delete "${entry.name}" from the graph library? This removes only the stored copy.`,
        { modal: true },
        "Delete",
      );
      if (choice !== "Delete") return;
      await library.remove(entry.id);
      libraryView.refresh();
    }),

    vscode.commands.registerCommand("graphViewer.refreshLibrary", () => libraryView.refresh()),
  );
}

async function openStored(
  context: vscode.ExtensionContext,
  library: GraphLibrary,
  entry: GraphEntry,
): Promise<void> {
  await GraphPanel.createOrShow(context, new FileGraphSource(library.pathFor(entry.id), entry.name));
}

/** Run the graph build in a worker thread. Resolves the raw graph, or `undefined`
 *  if cancelled. Keeps the extension host (and UI) responsive during the build. */
function runBuildWorker(
  context: vscode.ExtensionContext,
  root: string,
  token: vscode.CancellationToken,
): Promise<unknown | undefined> {
  return new Promise((resolve, reject) => {
    const workerPath = vscode.Uri.joinPath(context.extensionUri, "dist", "builder.worker.js").fsPath;
    const worker = new Worker(workerPath);
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      fn();
    };
    token.onCancellationRequested(() => finish(() => resolve(undefined)));
    worker.once("message", (msg: { ok: boolean; graph?: unknown; error?: string }) =>
      finish(() => (msg.ok ? resolve(msg.graph) : reject(new Error(msg.error ?? "build failed")))),
    );
    worker.once("error", (err) => finish(() => reject(err)));
    worker.postMessage(root);
  });
}

export function deactivate(): void {
  // The panel manages its own disposables.
}
