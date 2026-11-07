---
name: fix
title: Fix or iterate on existing art
description: Change a sprite that already exists — the user's own work or your earlier output — without destroying what is already right. Use for edits, touch-ups, style corrections and "make it more X" requests.
---

# Fix or iterate on existing art

Editing someone's work has a failure mode that drawing from scratch does not:
breaking something that was already correct. The whole procedure is built around
not doing that.

## Procedure

### 1. Understand what is there before changing it

```
preflight
sprite_info
look op="preview"
```

For a targeted edit, also `look op="ascii"` on the region. You cannot edit
pixels precisely from a description.

**Never assume layer names, frame counts or the palette.** Drawing into the
wrong layer is the most common way an agent damages someone's file. When two
groups hold same-named layers (`left/arm`, `right/arm`), a bare name is refused
— pass the group path rather than renaming the user's layers.

### 2. Say what you are about to change

For anything beyond a small touch-up, state the plan in one line and let the
user stop you. Especially before: changing the palette, resizing the canvas,
merging layers, or editing a layer you did not create.

### 3. Scope the edit as tightly as you can

- A **selection** limits `draw`, `recolor` and `transform` to one area.
- A **layer** target keeps you out of everything else.
- A **region** on `recolor` avoids touching the whole cel.

Scoping is cheaper than repairing.

### 4. Make the change in one call

One `draw` with all its ops, one `recolor`. That is one Ctrl+Z for the user if
they dislike it. Use `label` to describe the intent — it becomes their undo
entry.

For a pixel-level fix, edit the text, not coordinates: `look op="ascii"
layer=… rulers=false region=…` gives bare rows, the legend and `origin`; change
the wrong cells and send the same rows back as one `draw` kind `grid` at that
origin. Only that rectangle is touched, and its transparent cells erase — pass
`transparent:"skip"` when you mean to add pixels without clearing any. Glyphs
are palette indices, so pieces read separately share one legend: merge their
legends when rows from one piece land in another. Only glyphs listed in
`offPalette` (colours outside the palette) can change between reads.

### 5. Verify what actually changed

```
look op="diff" fromFrame=… toFrame=…
```

for animation work, or `look op="ascii"` on the region for a static edit. A
preview shows you the result; a diff shows you the *change*, including the parts
you did not intend. The diff's `changedBounds` is the quick test: if you edited
the hand and the box spans the whole sprite, something else moved.

### 6. Validate and report

```
validate
```

Report what changed and what you deliberately left alone.

## Interpreting vague requests

| Request | Usually means |
|---------|---------------|
| "more contrast" | Widen the value range of the ramps, not the hue |
| "cleaner" | Remove strays, even out line runs, merge near-duplicate colours |
| "more detail" | Usually wrong at small sizes — ask what should read better |
| "pop more" | Contrast against the background, or a brighter accent |
| "less flat" | Shading exists but does not hue-shift, or has no light direction |
| "muddy colours" | Too many near-duplicates — `palette op="extract"` on a copy, or `analyze` + `snap` |
| "add a label / score / title" | `draw` kind `text`; measure with `measureOnly` first so it lands centred |
| "closer to the reference / concept" | `look op="compare"`, list the three to five largest mismatches, fix only those |
| "off / uncanny" | Run `aseprite:review`; name the specific cause |

Reflect your reading back before acting on it. "More detail" on a 16×16 sprite
usually means the sprite needs to be bigger, and that is worth one question.

## What not to do

- Do not redraw a sprite from scratch because it is easier than editing it,
  unless the user asked for that.
- Do not "improve" things nobody mentioned.
- Do not widen the palette to fit a colour you chose. Say the palette lacks it.
- Do not flatten, resize or re-index without being asked.

## Related

`aseprite:review`, `rules://00-core-principles`, `rules://92-generated-art-tells`
for what makes art read as machine-made, and the subject file for the part you
are fixing (`skill://studio`, *Subject rules*) — "fix the hands" starts at
`rules://34-hands-and-feet`.

## Verified editing protocol

For local edits, inspect the exact layer/frame with `look analyze` or `read_pixels`; retain its fingerprint and region. Read `art_spec get` and the relevant `rules://guide/{topic}` excerpts. Use `draw mode="preview"` with `guard.expectedRegionFingerprint`, matching `guard.fingerprintRegion`, an `allowedRegion`, and `maxChangedPixels`. Preview uses the same raster engine as commit. If acceptable, repeat with mode="apply" and the same guard. A stale_region response means inspect again, never drop the guard to force the edit. Review `look action_diff actionId=...`, then focused validation.

Keep a versioned PixelSpec with explicit user constraints and provenance; export it explicitly to an absolute `.aseprite-ai.json` path for persistence. Session specs are lost when Aseprite exits. Protected regions and hard draw constraints are enforced; preferences remain advisory. `validate mode="plan_repairs"` only suggests fixes, and never applies them. Temporal checks need explicit layer, frames and pose-appropriate tolerances; squash/stretch must not be treated as accidental drift.

At a specialist handoff pass sprite ID, PixelSpec, goal, target layer/frame/region, fingerprint, action IDs, remaining findings and allowed scope. Limit local fix loops to three rounds. Critic first reads artwork without the creator's explanation, then checks the brief; keep blind A/B comparison for aesthetic decisions. Any mutation after final critique requires another review. A local pixel request does not need a full concept workflow. Live disconnect never authorizes headless fallback or disk editing.
