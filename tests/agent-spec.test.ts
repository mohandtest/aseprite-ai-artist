import { test } from "node:test";
import assert from "node:assert/strict";
import { artSpecSchema, mergeSpec } from "../src/lib/art-spec.ts";
import { actionableFinding } from "../src/lib/repair.ts";
test("spec versions, unknown fields and nested patch contracts", () => {
  assert.throws(() => artSpecSchema.parse({ schemaVersion: 2 }));
  assert.throws(() => artSpecSchema.parse({ schemaVersion: 1, pretend: true }));
  assert.deepEqual(
    mergeSpec({ schemaVersion: 1, goal: { subject: "knight", view: "side" } }, { goal: { view: "front" } }).goal,
    { subject: "knight", view: "front" },
  );
  assert.throws(() => mergeSpec({ schemaVersion: 1 }, { hard: { unused: true } }));
});
test("repairs remain report-only and carry real operation names", () => {
  const finding = { check: "animation", severity: "error", message: "Missing cel", layer: "arm", frame: 4 };
  assert.equal(actionableFinding(finding, false).fixes.length, 0);
  const fix = actionableFinding(finding, true).fixes[0]!;
  assert.equal(fix.tool, "cel");
  assert.equal(fix.autoSafe, false);
});

test("unsupported versions and unrecognized hard constraints cannot be accepted silently", () => {
  assert.throws(() => artSpecSchema.parse({ schemaVersion: 1, hard: { preserveFace: true } }));
  assert.throws(() => artSpecSchema.parse({ schemaVersion: 1, animation: { layer: "body", frames: [1] } }));
});
