import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";

test(
  "full MCP observe-preview-commit-spec-review loop in real Aseprite",
  { skip: !process.env.ASEPRITE_PATH },
  async () => {
    const { server, live } = createServer({
      headless: true,
      asepritePath: process.env.ASEPRITE_PATH,
      autoSpawnBridge: false,
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "agent-e2e", version: "1" });
    const directory = await mkdtemp(path.join(tmpdir(), "agent-spec-"));
    try {
      await Promise.all([client.connect(a), server.connect(b)]);
      const call = async (name: string, args: Record<string, unknown> = {}) => {
        const reply = await client.callTool({ name, arguments: args });
        assert(!reply.isError, JSON.stringify(reply));
        return reply;
      };
      const created = await call("sprite_manage", { op: "new", width: 16, height: 16 });
      const sprite = `#${created.structuredContent!.id}`;
      const info = await call("sprite_info", { sprite });
      const layer = (info.structuredContent!.layers as { name: string }[])[0]!.name;
      const target = { sprite, layer, frame: 1 };
      await call("draw", {
        ...target,
        paletteLock: false,
        ops: [{ kind: "grid", x: 4, y: 4, rows: ["AA", "AA"], legend: { A: "#ff0000" } }],
      });
      const before = await call("read_pixels", { ...target, composite: false });
      const fingerprint = before.structuredContent!.fingerprint;
      assert.equal(typeof fingerprint, "string");
      const analysis = await call("look", { ...target, op: "analyze", rowWidths: true });
      assert.equal((analysis.structuredContent!.analysis as { opaquePixels: number }).opaquePixels, 4);
      const edit = {
        ...target,
        paletteLock: false,
        guard: {
          expectedRegionFingerprint: fingerprint,
          allowedRegion: { x: 4, y: 4, width: 1, height: 1 },
          maxChangedPixels: 1,
        },
        ops: [{ kind: "grid_patch", points: [{ x: 4, y: 4, expectedColor: "#ff0000", newColor: "#ffffff" }] }],
      };
      const preview = await call("draw", { ...edit, mode: "preview" });
      assert(preview.content.some((c: unknown) => (c as { type: string }).type === "image"));
      assert.equal(
        (await call("read_pixels", { ...target, composite: false })).structuredContent!.fingerprint,
        fingerprint,
      );
      const applied = await call("draw", edit);
      assert.equal(applied.structuredContent!.pixelsChanged, 1);
      await call("look", { sprite, op: "action_diff", actionId: applied.structuredContent!.actionId });
      assert((await client.callTool({ name: "draw", arguments: edit })).isError);
      await call("art_spec", {
        sprite,
        op: "set",
        spec: { schemaVersion: 1, goal: { subject: "knight" }, hard: { canvasSize: [16, 16] } },
      });
      const specPath = path.join(directory, "knight.aseprite-ai.json");
      await call("art_spec", { sprite, op: "export", path: specPath });
      await call("art_spec", { sprite, op: "patch", patch: { goal: { view: "front" } } });
      await call("art_spec", { sprite, op: "import", path: specPath });
      assert.equal((await call("art_spec", { sprite, op: "get" })).structuredContent!.spec !== undefined, true);
      await call("validate", { sprite, checks: ["animation"], mode: "plan_repairs" });
      const rules = await client.readResource({ uri: "rules://guide/eyes" });
      assert(JSON.parse(String(rules.contents[0]!.text)).length > 0);
      await call("look", {
        sprite,
        layer,
        op: "preview",
        overlays: { grid: true, rulers: true, checkerboard: true, bounds: true },
      });
      await call("frame", { sprite, op: "add", count: 2 });
      await call("draw", {
        ...target,
        frame: 2,
        paletteLock: false,
        ops: [{ kind: "clear" }, { kind: "pixels", color: "#ffffff", points: [{ x: 4, y: 4 }] }],
      });
      await call("art_spec", {
        sprite,
        op: "patch",
        patch: { animation: { layer, frames: [1, 2], maxAreaDriftPercent: 0 } },
      });
      const qa = await call("validate", { sprite, checks: ["animation"] });
      assert((qa.structuredContent!.findings as { check: string }[]).some((f) => f.check === "motion"));
      await call("draw", {
        ...target,
        mode: "preview",
        paletteLock: false,
        ops: [
          {
            kind: "iso_box",
            x: 8,
            y: 1,
            width: 1,
            depth: 1,
            height: 3,
            top: "#ffffff",
            left: "#777777",
            right: "#333333",
          },
        ],
      });
    } finally {
      live.close();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
