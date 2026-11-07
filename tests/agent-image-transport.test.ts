import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { captureImage } from "../dist/lib/image-transport.js";
import { registerDrawTools } from "../dist/tools/draw.js";
import { registerLookTools } from "../dist/tools/look.js";
import { LiveError } from "../dist/lib/protocol.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=";

function windowsEditor() {
  const requests: { cmd: string; args: Record<string, any> }[] = [];
  return {
    requests,
    mode: "live",
    call: async (cmd: string, args: Record<string, any>) => {
      requests.push({ cmd, args });
      assert.equal(cmd, "image.capture", "A Windows editor must not be asked to write a WSL temp path");
      assert.match(args.token, /^[0-9a-f-]{36}$/);
      assert(!("path" in args.args));
      assert(!("previewPath" in args.args));
      const common = { sprite: "#7", width: 8, height: 8, sourceWidth: 8, sourceHeight: 8, scale: 1, frame: 1 };
      const meta =
        args.command === "draw.guarded"
          ? { sprite: "#7", layer: "body", frame: 1, opsApplied: 1, pixelsChanged: 1, preview: true, applied: false }
          : args.command === "look.onion"
            ? { ...common, frames: [1] }
            : args.command === "look.filmstrip"
              ? { ...common, frames: 1 }
              : args.command === "look.compare"
                ? { ...common, reference: "reference" }
                : common;
      // This host has no server-readable file; only the wire image is available.
      return { meta, image: { data: PNG, mimeType: "image/png" } };
    },
  };
}

for (const scenario of ["preview", "annotated", "filmstrip", "onion", "compare", "draw"]) {
  test(`WSL server receives ${scenario} bytes from a separate Windows filesystem`, async () => {
    const tools = new Map<string, any>();
    const server = { registerTool: (name: string, config: any, handler: any) => tools.set(name, { config, handler }) };
    const editor = windowsEditor();
    registerLookTools(server as never, editor as never);
    registerDrawTools(server as never, editor as never);
    const name = scenario === "draw" ? "draw" : "look";
    const tool = tools.get(name);
    const args = z
      .object(tool.config.inputSchema)
      .parse(
        name === "draw"
          ? {
              sprite: "#7",
              layer: "body",
              mode: "preview",
              paletteLock: false,
              ops: [{ kind: "pixels", color: "#ffffff", points: [{ x: 0, y: 0 }] }],
            }
          : {
              sprite: "#7",
              op: scenario === "annotated" ? "preview" : scenario,
              ...(scenario === "annotated" ? { overlays: { grid: true } } : {}),
            },
      );
    const result = await tool.handler(args);
    assert(!result.isError, JSON.stringify(result));
    assert.equal(result.content.find((c: any) => c.type === "image").data, PNG);
    assert.equal(editor.requests.length, 1);
    if (name === "draw") assert.equal(result.structuredContent.applied, false);
  });
}

test("old extensions fail explicitly without falling back to filesystem previews", async () => {
  const editor = {
    call: async () => {
      throw new LiveError("unsupported_command", "Unknown image.capture");
    },
  };
  await assert.rejects(captureImage(editor as never, "look.preview", {}), (e) => {
    assert(e instanceof LiveError);
    assert.equal(e.details.doNotFallBackToDisk, true);
    assert.match(String(e.details.remediation), /Reinstall/);
    return true;
  });
});

for (const image of [
  { data: "!bad", mimeType: "image/png" },
  { data: "AAAA", mimeType: "image/png" },
  { data: PNG, mimeType: "image/jpeg" },
]) {
  test(`invalid transport payload is rejected (${image.data.slice(0, 8)}, ${image.mimeType})`, async () => {
    const editor = { call: async () => ({ meta: {}, image }) };
    await assert.rejects(captureImage(editor as never, "look.preview", {}), /invalid/);
  });
}

test("image metadata is validated inside the transport envelope", async () => {
  const editor = { call: async () => ({ meta: {}, image: { data: PNG, mimeType: "image/png" } }) };
  await assert.rejects(captureImage(editor as never, "look.preview", {}, { expect: ["sourceWidth"] }), /sourceWidth/);
});
