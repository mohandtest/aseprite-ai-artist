import { test } from "node:test";
import assert from "node:assert/strict";
import { registerDrawTools } from "../dist/tools/draw.js";
import { LiveError } from "../dist/lib/protocol.js";
import { loadFont } from "../dist/lib/text.js";

for (const scenario of ["preview", "guard", "patch"]) {
  test(`${scenario} cannot be silently ignored by an old extension`, async () => {
    const handlers = new Map();
    const calls: string[] = [];
    const server = { registerTool: (name: string, _config: unknown, handler: unknown) => handlers.set(name, handler) };
    const link = {
      call: async (cmd: string) => {
        calls.push(cmd);
        throw new LiveError("unsupported_command", "Old extension does not support this command");
      },
    };
    registerDrawTools(server as never, link as never);
    const reply = await handlers.get("draw")({
      ops:
        scenario === "patch"
          ? [{ kind: "grid_patch", points: [{ x: 0, y: 0, expectedColor: "#00000000", newColor: "#ffffff" }] }]
          : [{ kind: "pixels", color: "#ffffff", points: [{ x: 0, y: 0 }] }],
      mode: scenario === "preview" ? "preview" : "apply",
      guard: scenario === "guard" ? { maxChangedPixels: 1 } : undefined,
      paletteLock: false,
      selectionOnly: false,
      createCel: true,
      measureOnly: false,
    });
    assert(reply.isError);
    assert.deepEqual(calls, ["draw.guarded"]);
  });
}
test("font identifiers cannot escape the bitmap font directory", () => {
  assert.throws(() => loadFont("../../package"));
  assert.throws(() => loadFont("/tmp/font"));
});
