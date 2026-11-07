import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeRegion, compareMeasurements } from "../src/lib/analysis.ts";
const raster = (grid: number[]) => ({ x: 8, y: 12, width: 2, height: 2, colors: ["#00000000", "#ff0000"], grid });
test("bounds use global coordinates; connectivity is explicit", () => {
  const a = analyzeRegion(raster([1, 0, 0, 1]), { connectivity: 4, rowWidths: true });
  assert.equal(a.componentCount, 2);
  assert.equal(a.opaquePixels, 2);
  assert.deepEqual(a.occupiedBounds, { x: 8, y: 12, width: 2, height: 2 });
  assert.deepEqual(a.rowWidths, [1, 1]);
  assert.deepEqual(a.centerOfMass, { x: 8.5, y: 12.5 });
  assert.equal(analyzeRegion(raster([1, 0, 0, 1])).componentCount, 1);
});
test("empty, hidden RGB under alpha zero, partial alpha and malformed rasters", () => {
  assert.equal(analyzeRegion(raster([0, 0, 0, 0])).occupiedBounds, null);
  assert.equal(analyzeRegion({ ...raster([1, 1, 1, 1]), colors: ["#00000000", "#ff000000"] }).opaquePixels, 0);
  assert.equal(analyzeRegion({ ...raster([1, 1, 1, 1]), colors: ["#00000000", "#ff000080"] }).opaquePixels, 4);
  assert.throws(() => analyzeRegion(raster([1])));
});
test("temporal comparisons preserve explicit growth and displacement", () => {
  const delta = compareMeasurements(analyzeRegion(raster([1, 0, 0, 0])), analyzeRegion(raster([0, 0, 1, 1])));
  assert.equal(delta.areaChangePercent, 100);
  assert.deepEqual(delta.centroidDelta, { x: 0.5, y: 1 });
});
test("component summaries stay bounded while total count remains exact", () => {
  const a = analyzeRegion(raster([1, 0, 0, 1]), { connectivity: 4, maxComponents: 1 });
  assert.equal(a.componentCount, 2);
  assert.equal(a.components.length, 1);
  assert.equal(analyzeRegion(raster([1, 0, 0, 0])).symmetry.matchRatio, 0);
});
