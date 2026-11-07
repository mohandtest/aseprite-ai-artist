import { test } from "node:test";
import assert from "node:assert/strict";
import { isoBox, gridOutline } from "../src/lib/primitives.ts";
import { retrieveRules } from "../src/lib/retrieval.ts";
test("isometric faces share corners at exact 2:1 pitch", () => {
  const faces = isoBox({
    x: 10,
    y: 0,
    width: 2,
    depth: 3,
    height: 5,
    top: "#ffffff",
    left: "#777777",
    right: "#333333",
  });
  assert.deepEqual(faces[2]!.points, [
    { x: 10, y: 0 },
    { x: 14, y: 2 },
    { x: 8, y: 5 },
    { x: 4, y: 3 },
  ]);
  assert.deepEqual(faces[0]!.points[2], { x: 8, y: 10 });
});
test("grid outline is outside occupied stamps, no diagonal growth", () => {
  const points = gridOutline({ x: 4, y: 5, rows: ["A"], legend: { A: "#ffffff" }, outlineColor: "#000000" });
  assert.equal(points.length, 4);
  assert(!points.some((p) => p.x === 4 && p.y === 5));
});
test("retrieval returns bounded relevant excerpts and no unrelated results", () => {
  const rules = [
    { name: "face", title: "Eyes", body: "Eyes are readable.\n\nUse clear pupils.", file: "x" },
    { name: "grass", title: "Foliage", body: "Grass clusters.", file: "y" },
  ];
  assert.equal(retrieveRules(rules, "eye")[0]!.uri, "rules://face");
  assert.deepEqual(retrieveRules(rules, "spaceship"), []);
});
