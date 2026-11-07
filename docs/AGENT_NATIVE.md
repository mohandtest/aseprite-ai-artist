# Agent-native editing: local fork

This fork runs from a local checkout. No npm publication, releases, web deployment or GitHub Actions are required. Run Node 22.6+ and Aseprite 1.3+. The generated MCP client configuration points to the absolute local `dist/cli.js` and Node paths. Keep the checkout in place, or rerun `install` after moving it.

## Four milestones

| Milestone | Implemented surface |
| --- | --- |
| 1. Observe | `look.analyze`, per-frame measurements, connected components, foreground symmetry, optional row widths, region fingerprints, annotated previews and action history |
| 2. Edit safely | Shared in-memory raster engine for preview/apply, unique final-pixel counts, protected regions, change budgets, expected-state fingerprints and exact sparse patches |
| 3. Remember and repair | Versioned PixelSpec, shared document session state, explicit sidecar export/import, hard draw constraints, typed validation findings, proposed repairs and temporal validation |
| 4. Work smarter | Isometric boxes, stamp outlines, opt-in scale tweening, bitmap font discovery, focused rule retrieval, specialist handoffs and a reference safety benchmark |

Existing grid, palette, validation, critic, bridge and headless implementations are retained. The default tool surface has 19 tools (20 with the opt-in raw Lua escape hatch), within the repository's 24-tool limit.

## Local setup

```sh
npm ci --ignore-scripts
npm run build
node dist/cli.js install-extension
node dist/cli.js install codex
node dist/cli.js doctor
```

Replace `codex` with your supported client. Restart Aseprite after installing the extension. To update, pull, install dependencies, rebuild, and reinstall the extension if its Lua changed. This local fork replaces the upstream extension and uses the same default bridge ports; do not run both extensions together.

`private: true` blocks npm publication. The old GitHub Actions workflows are removed. Historical upstream docs or changelog entries may mention publishing; they are not the local fork's distribution instructions.

## Observe exact state

```json
{"op":"analyze","sprite":"#7","layer":"body","frame":1,"connectivity":8,"maxComponents":20,"rowWidths":true}
```

`look.analyze` reports:

- Global occupied bounds, presence-weighted center of mass and opaque-pixel count. Partial alpha counts as occupied; fully transparent RGB does not.
- Exact component count plus the largest bounded component summaries; connectivity is explicitly 4 or 8.
- Actual color frequencies (up to 32 entries), optional per-row occupied spans, and foreground-mask mirror match around the crop's center axis.
- A non-cryptographic fingerprint computed by Aseprite, including document, layer, frame, region, raw pixels and palette. This is an accidental-state-conflict token, not a security hash.

Use `frames:[1,2,3,4]` for per-frame measurements and deltas in supplied order. Up to 64 frames can be requested per call. Summary output is bounded; avoid reading every pixel when measurements suffice. Full raster analysis is capped at four million pixels per region.

`look.ascii` and `read_pixels` also return a fingerprint. A draw fingerprint must come from the same **single layer**, frame and region; a composite fingerprint is deliberately a different target.

Annotated image preview:

```json
{"op":"preview","sprite":"#7","layer":"body","region":{"x":8,"y":8,"width":16,"height":16},"overlays":{"grid":true,"rulers":true,"checkerboard":true,"bounds":true}}
```

Ruler labels use sprite-global coordinates after cropping. Grid lines appear at scales of at least four. Annotation is rendered to a throwaway image and never changes the artwork. Plain previews retain their old default appearance.

## Preview and apply one bounded edit

Read target pixels, retain `fingerprint`, then preview:

```json
{
  "sprite":"#7", "layer":"face", "frame":1,
  "mode":"preview", "paletteLock":true,
  "guard":{
    "expectedRegionFingerprint":"reg_...",
    "fingerprintRegion":{"x":12,"y":9,"width":6,"height":4},
    "allowedRegion":{"x":13,"y":10,"width":4,"height":2},
    "maxChangedPixels":8
  },
  "ops":[{"kind":"grid_patch","points":[
    {"x":14,"y":10,"expectedColor":"#24243b","newColor":"#ffffff"}
  ]}]
}
```

Repeat with `mode:"apply"` and the same guard to commit. There is no preview authorization token to bypass a new state check. If `fingerprintRegion` is omitted, the fingerprint is for the entire target layer on that frame.

The shared raster implementation resolves operations, selection clipping, palette lock, transparency and operation ordering on a detached `Image`. It computes the exact final diff against the original. Only after all operations and guards succeed does it assign the image in one named Aseprite transaction. Preview and rejected edits never mutate the original. Repeated writes to the same pixel count once; writes subsequently restored to the original color count zero. Accepted no-ops produce no undo entry.

Guard fields:

| Field | Meaning |
| --- | --- |
| `expectedRegionFingerprint` | Reject if content, target identity or palette changed since observation |
| `fingerprintRegion` | Exact crop used when the fingerprint was read; omitted means full layer |
| `allowedRegion` | Reject any actual changed pixel outside this rectangle |
| `maxChangedPixels` | Limit exact unique final changes, including erasures and alpha |
| `maxChangedFractionOfOpaqueTarget` | Limit changes relative to original whole-cel occupied pixels; a blank target permits zero |

Guarded/preview calls use the distinct `draw.guarded` wire command. Older extensions reject it explicitly instead of ignoring safety fields. Annotated previews likewise use a distinct wire command. All guard fields are optional for compatibility. Skills use them for local edits. Aseprite rechecks state at its synchronous execution boundary, so another client cannot interleave an edit between the check and commit. The scratch raster is bounded before allocation; oversized and tilemap edits fail explicitly. A successful preview returns a predicted PNG plus at most 4096 changed-pixel records and a `truncated` indicator.

Errors include `stale_region`, `protected_region_changed`, `change_budget_exceeded`, `invalid_patch`, `preview_unsupported` and `spec_constraint_failed`. A stale response means inspect again and revise. Never remove the guard simply to force an edit through.

Sparse `grid_patch` points check `expectedColor` in operation order and paint `newColor`; transparent is `#00000000`. A mismatched point rejects the whole batch, including any earlier points. Palette snapping applies to the new color, not the precondition. Indexed colors are compared using the document palette.

## Inspect the last action

Committed edits return `actionId`, `beforeFingerprint`, `afterFingerprint`, exact `pixelsChanged`, `bounds`, `outsideAllowedRegionChanged` and the existing palette snapping report.

```json
{"op":"action_diff","sprite":"#7","actionId":"act_17"}
```

This differs from existing `look.diff`, which continues comparing two frames. Action history contains before/after pixel records for the same frame, bounded to the most recent 16 changed actions and at most 4096 pixels each. Expired or wrong-document actions return `action_not_found`. It is a diagnostic cache, not an undo engine, and does not record human edits.

## Shared PixelSpec

`art_spec` operations: `get`, `set`, `patch`, `validate`, `export`, `import`.

```json
{
 "op":"set", "sprite":"#7",
 "spec":{
  "schemaVersion":1,
  "goal":{"subject":"knight","view":"three-quarter","size":[32,32]},
  "design":{"lightDirection":"upper-left","outline":"selective"},
  "paletteRoles":{"outline":"#24243b"},
  "layers":{"face":{"role":"expression"}},
  "landmarks":{"groundY":29,"eye":{"x":14,"y":10}},
  "protectedRegions":[{"layer":"helmet","region":{"x":8,"y":2,"width":16,"height":9}}],
  "hard":{"canvasSize":[32,32],"paletteOnly":true},
  "animation":{"layer":"body","frames":[1,2,3,4],"groundY":29,"groundContactFrames":[1,3],"maxAreaDriftPercent":8,"maxCentroidJumpPx":2,"loop":true},
  "mustNot":["change the character identity"],
  "provenance":{"origin":"user-and-agent","confirmedFields":["goal.size"]}
 }
}
```

Partial specs are valid. Unknown fields and unsupported versions fail validation. `patch` merges nested objects and replaces arrays. Preferences and semantic landmarks are advisory; the model must distinguish user-confirmed facts from guesses. `hard` and `protectedRegions` are enforced by **draw**; other existing mutation tools do not gain a universal constraint sandbox. `art_spec.validate` reports canvas, missing layer and out-of-range animation-frame mismatches. Avoid other mutation tools when guarded local drawing meets the goal.

State is shared in the extension by open document identity, survives MCP server restarts, and is cleaned when documents close. It is lost when Aseprite exits. Cross-session persistence is **explicit**:

```json
{"op":"export","sprite":"#7","path":"/absolute/project/knight.aseprite-ai.json"}
{"op":"import","sprite":"#7","path":"/absolute/project/knight.aseprite-ai.json"}
```

Export refuses an existing file unless `overwrite:true`. Import validates schema/version and attaches to the explicitly selected open document. No automatic sidecar writes occur during drawing or disconnection recovery.

## Validation and proposed repairs

`validate mode:"report"` is the default. `mode:"plan_repairs"` adds stable codes, evidence and suggested existing tool calls. It never applies fixes. Missing cels may suggest copying the prior frame; off-palette colors may suggest recolor snapping. These are medium-risk, `autoSafe:false` proposals requiring the agent to inspect whether the change is appropriate. First-frame missing cels have no guessed source frame.

The mechanical score remains distinct from the visual critic's craft rating. Geometry cannot prove that artwork looks good.

Motion checks use `motion` on `validate`, or default to the current PixelSpec's `animation`:

```json
{"sprite":"#7","checks":["animation"],"motion":{"layer":"body","frames":[1,2,3,4],"maxAreaDriftPercent":8,"maxCentroidJumpPx":2,"groundY":29,"groundContactFrames":[1,3],"loop":true}}
```

Area compares with the first explicit frame, centroid jump with the preceding sampled frame, and `loop:true` includes last-to-first centroid continuity. Ground contact is checked only on listed contact frames. All temporal checks are warnings with evidence, not universal aesthetic failures. Use pose-appropriate tolerances for jumps, squash/stretch, perspective changes, particles and effects.

## Drawing additions

`draw.kind:"iso_box"` uses integer 2:1 isometric edges. `x,y` is the top back corner, width/depth are slope steps and height is vertical pixels. Specify `top`, `left` and `right` face colors. It compiles to existing filled polylines and uses the same palette, preview and guard machinery.

A `grid` can specify `outlineColor` for a four-neighbor outside stamp outline. It can affect pixels one cell beyond the supplied rectangle, so enlarge `allowedRegion` appropriately. Existing `transform.outline` remains available.

`cel op:"tween",property:"scale"` accepts `to` between 0.125 and 8, `allowLossy:true`, existing easing, and an optional fixed sprite-coordinate `anchor`. Source pixels are frozen and resampled nearest-neighbor for each frame rather than repeatedly scaling intermediates. Do not use this for tiny sprites unless deliberate resampling is acceptable. Existing position/opacity tweening and oscillation remain.

`knowledge://fonts` lists installed JSON bitmap fonts. Put licensed bitmap font JSON in `knowledge/fonts` before starting the server. Font names cannot be paths. TrueType/OpenType rasterization remains deferred: the original plan explicitly made that conditional on need, platform determinism and licensing.

## Focused rules and handoffs

Read `rules://guide/eyes`, `rules://guide/jitter`, or `rules://guide/palette_drift` for at most four ranked excerpts with canonical source URIs. Retrieval is deterministic, lexical and alias-based. It adds no embedding service, database, network dependency or preload of all 62 rules. `rules://metadata` exposes compact topic, size and template metadata computed from the installed rulebook. Full rule resources remain available.

Updated skills retain their specialist workflows but use inspect -> spec -> scoped preview -> guarded apply -> action diff -> targeted validation -> visual critique. Handoffs carry sprite identity, goal, PixelSpec, exact target, fingerprint, action IDs and unresolved findings. Limit fix loops to three rounds, use cold/blind critique, and review again after any post-critique mutation.

## Local verification

```sh
npm run typecheck
npm run build
npm test
npm run test:agent
# Real Aseprite, same Lua handlers as the live extension:
ASEPRITE_PATH=/path/to/aseprite npm run test:agent
/path/to/aseprite -b --script-param root=. --script tests/extension.test.lua
# Existing full live editor E2E, only with an isolated editor:
npm run test:e2e
# Deterministic reference safety tasks:
ASEPRITE_PATH=/path/to/aseprite npm run benchmark:agent -- /tmp/agent-report.json
```

The optional MCP integration test skips without `ASEPRITE_PATH`; pure measurements and schema/retrieval tests always run. The existing live E2E still requires a UI-enabled isolated Aseprite, `ASEPRITE_USER_FOLDER`, and explicit `ASEPRITE_AI_ALLOW_LUA=1`; a headless CLI cannot prove UI focus/selection behavior.

The reference benchmark measures deterministic safety/parity, tool calls and time. It does **not** claim model token savings, artistic improvements or the proposed 95%/20% model targets. Matched strong/small-model runs with retained transcripts and blind judges remain necessary for those claims.

Live disconnection still refuses with `not_connected`/`doNotFallBackToDisk`. Headless mode is always explicit. Local use does not change these guarantees.

## Verification snapshot

The implementation was checked against a scripting-enabled CLI built from Aseprite's `v1.3.17` source tag:

- Existing Node suite: 112 passed, none skipped with the native executable available.
- New agent suite: 15 passed, including a full MCP round trip covering preview PNGs, guarded commit, stale rejection, PixelSpec export/import, rule retrieval, overlays, and spec-driven motion warnings.
- Real Lua handler suite: 109 passed. Includes one-undo behavior, no undo on preview/rejection, selection clipping, nonzero indexed transparency, frozen-source scale tweening and protected regions.
- Aseprite-free Lua suite: 12 passed.
- Seven deterministic reference scenarios: three guarded local edits and four animation cases passed. See [reference.json](../benchmarks/reports/reference.json).
- All four cumulative milestone source snapshots independently typechecked.

A GUI-enabled live-window run and matched multi-model artistic/cost evaluations were not performed in this environment. The native CLI exercises the same handlers, but cannot establish all UI behavior. The reference report intentionally leaves model/token fields unmeasured.
