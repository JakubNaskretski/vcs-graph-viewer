import * as fs from "fs/promises";
import * as path from "path";
import { Graph } from "../graph/types";
import { normalizeGraph } from "../graph/validate";
import { GraphSource } from "./graphSource";

/** A {@link GraphSource} backed by a graph.json file produced by graph-builder. */
export class FileGraphSource implements GraphSource {
  constructor(
    public readonly fsPath: string,
    private readonly displayLabel?: string,
  ) {}

  get id(): string {
    return this.fsPath;
  }

  get label(): string {
    return this.displayLabel ?? path.basename(this.fsPath);
  }

  get watchPath(): string {
    return this.fsPath;
  }

  async load(): Promise<Graph> {
    let text: string;
    try {
      text = await fs.readFile(this.fsPath, "utf8");
    } catch (err) {
      throw new Error(`Cannot read graph file "${this.fsPath}": ${(err as Error).message}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(`"${path.basename(this.fsPath)}" is not valid JSON: ${(err as Error).message}`);
    }
    return normalizeGraph(data);
  }
}
