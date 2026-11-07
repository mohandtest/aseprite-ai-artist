# Working on this repository

Guidance for agents and humans changing this code. For using the tool, see the
[README](README.md).

## Shape

| Path | What |
|------|------|
| `src/` | The MCP server, bridge, control client and CLI (TypeScript) |
| `extension/ai-artist.lua` | Everything that runs inside Aseprite — every command handler, for both modes |
| `headless/runner.lua` | Headless mode's stdin/stdout loop around the same extension, run by `aseprite -b` ([ADR-0008](docs/adr/0008-headless-mode.md)) |
| `rules/` | Pixel-art craft, served as `rules://` resources |
| `skills/` | Workflows, served as `skill://` resources and MCP prompts |
| `agents/`, `hooks/` | Claude Code plugin surface; omp reads the same tree as a marketplace plugin |
| `omp/` | omp extension replaying `hooks/hooks.json` with omp's event API; hook text lives in `hooks/shared.mjs` |
| `opencode/` | OpenCode V2 plugin: the fourteen commands, skills and the two hooks, from the same SKILL.md files the omp extension reads |
| `tests/` | Node tests, plus a Lua harness that runs inside `aseprite -b` |
| `docs/adr/` | Why things are the way they are. Read these before arguing with them. |
| `gallery/` | Workspace package: community generations, benchmark prompts, and the zod schema + checker both are held to ([ADR-0006](docs/adr/0006-gallery-and-benchmark.md)) |
| `apps/web/` | The SvelteKit site that renders the gallery and the benchmark; deploys from `main` only. Feature-Sliced Design under `src/` ([ADR-0007](docs/adr/0007-web-feature-sliced-design.md)); `routes/` stays a thin router and `pnpm --filter @pebbly/web run lint:fsd` enforces the layer rules |

The repository is a pnpm workspace driven by turborepo. The plugin stays the
root package on purpose — the marketplace installs from `./` — and `gallery/`
and `apps/web/` are outside the published `files` list, so they never ship.
`pnpm-lock.yaml` is the workspace lockfile; the root `package-lock.json` is
kept only for `bin/aseprite-ai-artist.mjs`, which builds a git install with
`npm install`. After changing root dependencies, refresh it with
`npm install --package-lock-only --ignore-scripts` — CI's `npm ci` job fails
when it drifts.

## The rules that are not negotiable

**Nothing may be declared and not implemented.** A schema field, an `op` value
or a check name that the Lua side never reads is worse than a missing feature:
the call validates, succeeds, and does nothing. A 2026-09-08 audit found six of
these at once — `transform.scope`, `gradient.dither`, `validate`'s `outline` and
`banding` checks, `tag`'s `repeat`, and a `linked` flag hardcoded to false. If
you add a field, add the branch that reads it in the same change, and a test
that fails without it.

**The tool count stays at or under 24.** A test enforces it. The whole design is
in [ADR-0003](docs/adr/0003-compact-tool-surface.md): every tool schema costs
context on every turn of every conversation, including the ones that never touch
Aseprite. If you need new behaviour, add an `op` to an existing noun.

**Never let a failure become a disk edit.** When Aseprite is not attached, tools
refuse with `not_connected` and `doNotFallBackToDisk`. An agent that "recovers"
by editing the `.aseprite` file makes changes the user cannot see and their next
save destroys. This is the single most important behaviour in the project.
Headless mode ([ADR-0008](docs/adr/0008-headless-mode.md)) writes files because
someone chose it — the operator at startup, or the user through `preflight
mode="headless"`; nothing may ever switch into it as a recovery from a failed
live call, and it refuses any file a live window has open.

**Every mutation goes inside `app.transaction`.** One agent action must be one
Ctrl+Z for the user.

**Never leave the user's active sprite, layer or frame changed** as a side
effect. Use `preserving_site`.

**Unsupported means unsupported.** An unknown command returns
`unsupported_command`. Never no-op silently.

## Lua gotchas that have already cost a day

Aseprite's Lua environment is not plain Lua, and its deviations fail silently:

- **`json.decode` returns `userdata`, not a table.** Everything from the wire
  goes through `to_plain()` at the boundary. Do not skip it.
- **A decoded JSON array yields nothing from `pairs`** but answers `#` and
  `ipairs`. A decoded JSON *object* also answers `#` — with its key count. Only
  `value[1] ~= nil` distinguishes them. Getting this wrong turns a 40-op draw
  batch into zero ops that report success.
- **`print()` inside a WebSocket callback does not reach stdout.** Trace through
  the status file instead.
- **`function t["key"]()` is not valid Lua.** Use `t["key"] = function()`.
- **A Lua table cannot hold a `nil` value**, so an absent field is a missing key
  and never an explicit null. Output schemas use `.nullish()`, not `.nullable()`.
- **Assigning `cel.image` invalidates the old handle.** Read `img.width`/`height`
  into locals before the swap or the next line raises "Tried to access a deleted
  'ImageObj'".
- **`cel.image` returns a fresh wrapper each read**, so `rawequal` never matches.
  Compare `cel.image.id` to tell whether two cels share one image.
- **`Sprite:newFrame()` bypasses the command machinery**, and `LinkCels` will not
  link a frame made that way. Create through `app.command.NewFrame` when the
  frame has to be linkable. `NewFrameLink` does not exist in 1.3.
- **A scratch `Sprite` must be created inside `preserving_site`**, not before it.
- **Global `print` must be restored on every path** — `lua.run` hijacks it to
  capture output, and a throw that skips the restore leaves every other script's
  output swallowed for the rest of the session.
- **A tilemap cel needs a `ColorMode.TILEMAP` image**, built from an `ImageSpec`.
  The generic cel helper hands back an RGB image and every stamp is silently
  lost.
- **Tile index 0 is Aseprite's reserved empty tile.** Engines index their atlas
  from 0, so leaving it in an exported atlas shifts every real tile by one and
  the map renders one tile off everywhere. The exporter drops it; `get` keeps it
  so atlas position still matches the index you pass to `stamp`.

## Testing

```bash
pnpm test              # colour, rendering, bridge transport, MCP surface
pnpm run test:extension # the real Lua handlers, headless, against a real sprite
pnpm run test:e2e      # the whole chain; needs a live Aseprite (see tests/e2e.mjs)
pnpm gallery:check     # every generation and benchmark prompt against gallery/src/schema.ts
pnpm --filter @pebbly/gallery test # the checker's own rules
```

The unit tests will not catch an Aseprite API misunderstanding. Every one of the
gotchas above was found by `test:e2e` after the isolated tests were green. Run
it before claiming a change to the Lua side works.

Use an isolated Aseprite for e2e — `ASEPRITE_USER_FOLDER` pointed at a scratch
directory — so a test never touches someone's real documents. Start it with
`ASEPRITE_AI_ALLOW_LUA=1` too: the e2e undo checks use `run_lua`, and the
extension refuses it otherwise.

## Style

Comments explain *why*, especially where the code looks wrong but is not. The
Lua gotchas above are all documented at their call sites for exactly that
reason. Do not add comments that restate the code.

## Local distribution

This fork is private for npm (`private: true`) and is used from a local checkout. GitHub Actions and publishing/deployment workflows have been removed at the owner's request. Do not restore them or publish packages/releases as part of ordinary development. Build locally with `npm run build`, run local tests, and reinstall the extension when its Lua changes. The CLI installer must point clients at the local checkout, never the upstream npm package.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
