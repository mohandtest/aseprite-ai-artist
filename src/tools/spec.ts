import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AsepriteLink } from "../bridge/link.js";
import { artSpecSchema, mergeSpec } from "../lib/art-spec.js";
import { fail, ok, targetShape } from "./kit.js";
export function registerSpecTools(server: McpServer, live: AsepriteLink) {
  server.registerTool(
    "art_spec",
    {
      title: "Art specification",
      description:
        "Shared versioned design contract for one open sprite. get/set/patch/validate are session operations; export/import explicitly save/load a .aseprite-ai.json sidecar at an absolute path. Arrays replace on patch. Hard draw constraints and protectedRegions are enforced by draw; artistic preferences remain advisory. Session state is lost when Aseprite exits: export explicitly for persistence. validate checks canvas, named layers and animation frame ranges. No automatic sidecar writes.",
      inputSchema: {
        op: z.enum(["get", "set", "patch", "validate", "export", "import"]),
        sprite: targetShape.sprite,
        spec: artSpecSchema.optional(),
        patch: z.record(z.unknown()).optional(),
        path: z.string().optional(),
        overwrite: z.boolean().default(false),
      },
      outputSchema: {
        sprite: z.string(),
        spec: artSpecSchema.nullish(),
        issues: z.array(z.string()).optional(),
        path: z.string().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const current = await live.call<{ sprite: string; spec?: z.infer<typeof artSpecSchema> }>("spec.get", {
          sprite: args.sprite,
        });
        if (args.op === "get") return ok(current);
        if (args.op === "set" || args.op === "patch") {
          if (args.op === "set" && !args.spec) throw new Error("set requires spec");
          if (args.op === "patch" && !args.patch) throw new Error("patch requires patch");
          const spec = args.op === "set" ? args.spec! : mergeSpec(current.spec ?? { schemaVersion: 1 }, args.patch!);
          return ok(await live.call<Record<string, unknown>>("spec.set", { sprite: args.sprite, spec }));
        }
        if (args.op === "validate")
          return ok(await live.call<Record<string, unknown>>("spec.validate", { sprite: args.sprite }));
        if (!args.path || !path.isAbsolute(args.path) || !args.path.endsWith(".aseprite-ai.json"))
          throw new Error("An absolute .aseprite-ai.json path is required");
        if (args.op === "export") {
          if (!current.spec) throw new Error("No spec to export");
          await writeFile(args.path, JSON.stringify(artSpecSchema.parse(current.spec), null, 2) + "\n", {
            flag: args.overwrite ? "w" : "wx",
          });
          return ok({ ...current, path: args.path });
        }
        const raw = await readFile(args.path, "utf8");
        if (raw.length > 1_000_000) throw new Error("Spec file exceeds one MB");
        const spec = artSpecSchema.parse(JSON.parse(raw));
        return ok(await live.call<Record<string, unknown>>("spec.set", { sprite: args.sprite, spec }));
      } catch (err) {
        return fail(err);
      }
    },
  );
}
