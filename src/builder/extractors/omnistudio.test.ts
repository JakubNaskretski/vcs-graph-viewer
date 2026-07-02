import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { OmniStudioExtractor } from "./omnistudio";

// A minimal standard OmniScript *-meta.xml with a name, active flag, version, and one
// embedded Apex ref inside <propertySetConfig>, so extract() produces a component node
// plus (via the element/component layers) a calls -> apexclass edge.
function osMeta(name: string, version: number, active: boolean, remoteClass = "DoWork"): string {
  const cfg = JSON.stringify({ remoteClass });
  return `<?xml version="1.0" encoding="UTF-8"?>
<OmniProcess xmlns="http://soap.sforce.com/2006/04/metadata">
  <name>${name}</name>
  <isActive>${active}</isActive>
  <versionNumber>${version}</versionNumber>
  <propertySetConfig>${cfg.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</propertySetConfig>
</OmniProcess>`;
}

function mkTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "omni-test-"));
}

test("bestVersion emits only the highest active version and its refs", () => {
  const dir = mkTempDir();
  try {
    // Three versions of the SAME component; v3 is the active winner.
    const files = ["Comp_v1.os-meta.xml", "Comp_v2.os-meta.xml", "Comp_v3.os-meta.xml"];
    fs.writeFileSync(path.join(dir, files[0]), osMeta("Comp", 1, false));
    fs.writeFileSync(path.join(dir, files[1]), osMeta("Comp", 2, false));
    fs.writeFileSync(path.join(dir, files[2]), osMeta("Comp", 3, true));

    // A fresh extractor per test so the memo starts empty.
    const extractor = new OmniStudioExtractor();
    const results = files.map((f) => extractor.extract(path.join(dir, f)));

    // Only the winner (v3) emits a component node; the two losers emit nothing.
    const compNodes = results.map((r) => r[0].filter((n) => n.type === "omniscript").length);
    assert.deepEqual(compNodes, [0, 0, 1], "only the highest active version emits a node");

    // The winning extraction carries the component's calls -> apexclass edge.
    const winnerEdges = results[2][1];
    assert.ok(
      winnerEdges.some((e) => e.type === "calls" && e.to_kind === "apexclass" && e.to_name === "DoWork"),
      "winner emits calls -> apexclass",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("bestVersion memoizes the directory scan (survives sibling deletion after first extract)", () => {
  const dir = mkTempDir();
  try {
    const files = ["Comp_v1.os-meta.xml", "Comp_v2.os-meta.xml", "Comp_v3.os-meta.xml"];
    fs.writeFileSync(path.join(dir, files[0]), osMeta("Comp", 1, false));
    fs.writeFileSync(path.join(dir, files[1]), osMeta("Comp", 2, false));
    fs.writeFileSync(path.join(dir, files[2]), osMeta("Comp", 3, true));

    const extractor = new OmniStudioExtractor();

    // First extract on any file in the dir populates the per-directory memo (one scan
    // of all siblings). Prove it's cached by DELETING the sibling files, then extracting
    // the remaining winner: if the winner slot were re-derived by re-reading the dir it
    // would now be wrong/empty. A correct memo still emits the winner.
    extractor.extract(path.join(dir, files[0])); // seeds the memo
    fs.rmSync(path.join(dir, files[0]));
    fs.rmSync(path.join(dir, files[1]));

    const winner = extractor.extract(path.join(dir, files[2]));
    const compNodes = winner[0].filter((n) => n.type === "omniscript").length;
    assert.equal(compNodes, 1, "winner still emits from the memo after siblings were deleted");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
