import { readFile, writeFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { HeadlessClient } from "../dist/bridge/headless.js";
import assert from "node:assert/strict";
import { analyzeRegion, compareMeasurements } from "../dist/lib/analysis.js";
const path = process.argv[2];
if (!process.env.ASEPRITE_PATH) throw new Error("ASEPRITE_PATH must point to a scripting-enabled Aseprite executable");
const fixture = JSON.parse(await readFile(new URL("../benchmarks/agent-edit/tasks.json", import.meta.url), "utf8"));
const live = new HeadlessClient({
  asepritePath: process.env.ASEPRITE_PATH,
  root: new URL("../", import.meta.url).pathname,
  allowLua: false,
});
const results = [];
try {
  for (const task of fixture.tasks) {
    const start = performance.now();
    let calls = 0;
    const call = (cmd, args) => {
      calls++;
      return live.call(cmd, args);
    };
    const created = await call("sprite.manage", {
      op: "new",
      width: task.canvas[0],
      height: task.canvas[1],
      colorMode: "rgb",
    });
    const sprite = created.id ? `#${created.id}` : created.sprite;
    const target = { sprite, frame: 1 };
    await call("draw.batch", { ...target, paletteLock: false, ops: task.setup });
    const before = await call("pixels.read", { ...target, composite: false });
    const args = {
      ...target,
      paletteLock: false,
      guard: {
        expectedRegionFingerprint: before.fingerprint,
        allowedRegion: task.allowedRegion,
        maxChangedPixels: task.maxChangedPixels,
      },
      ops: [{ kind: "grid_patch", points: task.patch }],
    };
    const preview = await call("draw.batch", { ...args, mode: "preview" });
    const still = await call("pixels.read", { ...target, composite: false });
    assert.equal(still.fingerprint, before.fingerprint);
    const result = await call("draw.batch", args);
    assert.equal(result.pixelsChanged, preview.pixelsChanged);
    assert.equal(result.outsideAllowedRegionChanged, 0);
    assert.equal(result.pixelsChanged, task.maxChangedPixels);
    let staleRejected = false;
    try {
      await call("draw.batch", args);
    } catch (e) {
      staleRejected = e.code === "stale_region";
    }
    assert(staleRejected);
    results.push({
      id: task.id,
      hardConstraintPass: true,
      collateralPixels: 0,
      staleRejected,
      previewCommitParity: true,
      toolCalls: calls,
      runtimeMs: performance.now() - start,
      tokens: null,
      model: null,
    });
  }

  const animation = JSON.parse(await readFile(new URL("../benchmarks/animation/tasks.json", import.meta.url), "utf8"));
  for (const task of animation.tasks) {
    const created = await live.call("sprite.manage", { op: "new", width: 32, height: 32, colorMode: "rgb" });
    const sprite = `#${created.id}`;
    await live.call("frame.apply", { sprite, op: "add", count: task.frames.length - 1 });
    const samples = [];
    for (let i = 0; i < task.frames.length; i++) {
      const [x, y, width, height] = task.frames[i];
      await live.call("draw.batch", {
        sprite,
        frame: i + 1,
        paletteLock: false,
        ops: [{ kind: "clear" }, { kind: "rect", color: "#ffffff", fill: "#ffffff", rect: { x, y, width, height } }],
      });
      samples.push(analyzeRegion(await live.call("pixels.read", { sprite, frame: i + 1, composite: false })));
    }
    let warnings = 0;
    for (let i = 0; i < samples.length; i++) {
      const area = compareMeasurements(samples[0], samples[i]).areaChangePercent;
      if (area !== null && Math.abs(area) > task.maxAreaDriftPercent) warnings++;
      if (i) {
        const d = compareMeasurements(samples[i - 1], samples[i]).centroidDelta;
        if (d && Math.hypot(d.x, d.y) > task.maxCentroidJumpPx) warnings++;
      }
    }
    assert.equal(warnings, task.expectedWarnings, task.id);
    results.push({
      id: task.id,
      expectedWarnings: task.expectedWarnings,
      observedWarnings: warnings,
      hardConstraintPass: true,
      model: null,
      tokens: null,
    });
  }
} finally {
  live.close();
}
const report = {
  schemaVersion: 1,
  kind: "deterministic-reference",
  note: "Reference tool sequence, not a model evaluation. Tokens, craft scores and model improvements are unmeasured.",
  createdAt: new Date().toISOString(),
  results,
};
if (path) await writeFile(path, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
