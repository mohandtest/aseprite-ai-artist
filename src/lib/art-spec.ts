import { z } from "zod";
const rect = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export const artSpecSchema = z
  .object({
    schemaVersion: z.literal(1),
    goal: z
      .object({
        subject: z.string().max(2000).optional(),
        view: z.string().max(200).optional(),
        size: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
      })
      .strict()
      .optional(),
    design: z.record(z.string().max(2000)).optional(),
    paletteRoles: z.record(z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i)).optional(),
    layers: z.record(z.object({ role: z.string() }).strict()).optional(),
    landmarks: z.record(z.union([z.number(), z.object({ x: z.number(), y: z.number() }).strict()])).optional(),
    protectedRegions: z
      .array(z.object({ layer: z.string(), frame: z.number().int().positive().optional(), region: rect }).strict())
      .max(100)
      .optional(),
    hard: z
      .object({
        canvasSize: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
        paletteOnly: z.boolean().optional(),
      })
      .strict()
      .optional(),
    animation: z
      .object({
        layer: z.string(),
        frames: z.array(z.number().int().positive()).min(2).max(64),
        groundY: z.number().optional(),
        groundContactFrames: z.array(z.number().int().positive()).optional(),
        maxAreaDriftPercent: z.number().min(0).optional(),
        maxCentroidJumpPx: z.number().min(0).optional(),
        loop: z.boolean().optional(),
      })
      .strict()
      .optional(),
    mustNot: z.array(z.string().max(2000)).optional(),
    provenance: z
      .object({ origin: z.enum(["user", "agent", "user-and-agent"]), confirmedFields: z.array(z.string()) })
      .strict()
      .optional(),
  })
  .strict();
export type ArtSpec = z.infer<typeof artSpecSchema>;
export function mergeSpec(current: ArtSpec, patch: Record<string, unknown>): ArtSpec {
  const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      [...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [
        k,
        k in b
          ? b[k] &&
            typeof b[k] === "object" &&
            !Array.isArray(b[k]) &&
            a[k] &&
            typeof a[k] === "object" &&
            !Array.isArray(a[k])
            ? merge(a[k] as Record<string, unknown>, b[k] as Record<string, unknown>)
            : b[k]
          : a[k],
      ]),
    );
  if (Object.keys(patch).some((k) => ["__proto__", "constructor", "prototype"].includes(k)))
    throw new Error("Unsafe patch key");
  return artSpecSchema.parse(merge(current, patch));
}
