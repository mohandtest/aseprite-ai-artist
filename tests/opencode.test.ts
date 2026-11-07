import { strict as assert } from "node:assert";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
// @ts-ignore — plain .mjs on purpose: loaded from a clone, no build step.
import plugin, { isPixelMutation, resolveSkillsDir } from "../opencode/index.mjs";
// @ts-ignore
import { LOOK_NUDGE } from "../hooks/shared.mjs";

// Nothing listens here, so the status probe answers fast and never touches a
// real Aseprite session.
process.env.ASEPRITE_AI_CONTROL_PORT = "19971";

type Any = Record<string, any>;

function load(ext: Any = plugin) {
  const commands: Any[] = [];
  const skills: Any[] = [];
  const toolHooks = new Map<string, Any>();
  const sessionHooks = new Map<string, Any>();
  const sent: Any[] = [];
  const ctx = {
    command: { transform: async (cb: Any) => cb({ add: (c: Any) => commands.push(c) }) },
    skill: { transform: async (cb: Any) => cb({ add: (s: Any) => skills.push(s) }) },
    tool: { hook: async (name: string, cb: Any) => void toolHooks.set(name, cb) },
    session: {
      hook: async (name: string, cb: Any) => void sessionHooks.set(name, cb),
      prompt: async (p: Any) => void sent.push(p),
    },
  };
  return { ready: ext.setup(ctx), commands, skills, toolHooks, sessionHooks, sent };
}

const result = (sessionID: string, tool: string, content: Any[] | undefined = [{ type: "text", text: "412 pixels changed" }]) => ({
  status: "completed",
  sessionID,
  tool,
  result: content === undefined ? {} : { content },
});

test("every skill becomes a command and a skill entry", async () => {
  const { ready, commands, skills } = load();
  await ready;
  const onDisk = readdirSync(new URL("../skills/", import.meta.url)).filter((n) =>
    existsSync(new URL(`../skills/${n}/SKILL.md`, import.meta.url)),
  );
  assert.deepEqual(commands.map((c) => c.name).sort(), onDisk.map((n) => `aseprite:${n}`).sort());
  assert.deepEqual(skills.map((s) => s.id).sort(), [...onDisk].sort());
  const draw = commands.find((c) => c.name === "aseprite:draw");
  assert.ok(draw);
  assert.ok(!draw.description.startsWith("description"), "frontmatter parsed");
});

test("a command sends the skill body with the typed request", async () => {
  const { ready, commands, sent } = load();
  await ready;
  const draw = commands.find((c) => c.name === "aseprite:draw");
  await draw.execute({ sessionID: "s1", delivery: "steer", prompt: { text: " a knight " } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sessionID, "s1");
  assert.equal(sent[0].delivery, "steer");
  assert.ok(sent[0].text.includes("User request: a knight"));
  await draw.execute({ sessionID: "s1", delivery: "steer", prompt: { text: "" } });
  assert.ok(!sent[1].text.includes("User request"), "no empty request line");
});

test("the look nudge lands in the next context call, once per session", async () => {
  const { ready, toolHooks, sessionHooks } = load();
  await ready;
  const after = toolHooks.get("execute.after");
  const context = sessionHooks.get("context");

  // A completed mutation queues the nudge, delivered on the next model call.
  await after(result("s1", "aseprite-ai-artist_draw"));
  const first = { sessionID: "s1", system: [] };
  await context(first);
  assert.equal(first.system.length, 2, "status message plus the nudge");
  assert.ok(first.system.some((p: Any) => p.text === LOOK_NUDGE));

  // The same session is never nudged again, no matter how many draws follow.
  await after(result("s1", "aseprite_recolor"));
  const again = { sessionID: "s1", system: [] };
  await context(again);
  assert.equal(again.system.length, 0, "once per session");

  // A new session is nudged once more.
  await after(result("s2", "aseprite_transform"));
  const other = { sessionID: "s2", system: [] };
  await context(other);
  assert.ok(other.system.some((p: Any) => p.text === LOOK_NUDGE));
});

test("non-mutations, failures and odd results never nudge", async () => {
  const { ready, toolHooks, sessionHooks } = load();
  await ready;
  const after = toolHooks.get("execute.after");
  const context = sessionHooks.get("context");

  await after(result("s3", "aseprite_look")); // not a mutation
  await after({ ...result("s3", "aseprite_draw"), status: "error" }); // failed
  await after({ status: "completed", sessionID: "s3", tool: "aseprite_draw", result: {} }); // no content
  // Non-array content must not throw and must not spend the session's one nudge.
  await after({ status: "completed", sessionID: "s3", tool: "aseprite_draw", result: { content: "a string" } });

  // None of the above queued a nudge; the next context call is status-only.
  const first = { sessionID: "s3", system: [] };
  await context(first);
  assert.equal(first.system.length, 1);
  assert.ok(first.system.every((p: Any) => p.text !== LOOK_NUDGE));

  // A well-formed mutation afterwards still nudges — the odd ones did not spend it.
  await after(result("s3", "aseprite_draw"));
  const second = { sessionID: "s3", system: [] };
  await context(second);
  assert.ok(second.system.some((p: Any) => p.text === LOOK_NUDGE));
});

test("status lands once per session on the first context call", async () => {
  const { ready, sessionHooks } = load();
  await ready;
  const context = sessionHooks.get("context");
  const a = { sessionID: "s1", system: [] };
  await context(a);
  assert.equal(a.system.length, 1);
  assert.match(a.system[0].text, /no bridge on :19971/);
  const again = { sessionID: "s1", system: [] };
  await context(again);
  assert.equal(again.system.length, 0);
  const fresh = { sessionID: "s2", system: [] };
  await context(fresh);
  assert.equal(fresh.system.length, 1);
});

test("isPixelMutation matches OpenCode tool ids, not Claude's", () => {
  for (const name of ["aseprite-ai-artist_draw", "aseprite_recolor", "aseprite_transform"]) {
    assert.equal(isPixelMutation(name), true, name);
  }
  for (const name of ["aseprite-ai-artist_look", "aseprite_draw_extra", "write", undefined]) {
    assert.equal(isPixelMutation(name), false, String(name));
  }
});

test("resolveSkillsDir finds the checkout skills and fails softly elsewhere", () => {
  const here = path.dirname(fileURLToPath(new URL("../opencode/index.mjs", import.meta.url)));
  assert.equal(resolveSkillsDir(here), path.resolve(here, "..", "skills"));
  assert.equal(resolveSkillsDir(mkdtempSync(path.join(tmpdir(), "aia-nowhere-"))), null);
});

test("loads from an installed layout where only the published package sits beside it", async () => {
  // `opencode plugin add …::path:opencode` keeps only this subdirectory in its
  // cache; hooks/ and skills/ exist only in the published package, which the
  // plugin declares as a dependency. Reproduce that layout with no sibling tree.
  const tmp = mkdtempSync(path.join(tmpdir(), "aia-plugin-installed-"));
  const self = path.join(tmp, "node_modules", "opencode-aseprite-ai-artist");
  const pkg = path.join(tmp, "node_modules", "@pebbly", "aseprite-ai-artist");
  mkdirSync(path.join(pkg, "hooks"), { recursive: true });
  mkdirSync(path.join(pkg, "skills", "studio"), { recursive: true });
  mkdirSync(self, { recursive: true });
  const repo = path.dirname(fileURLToPath(new URL("../opencode/index.mjs", import.meta.url)));
  copyFileSync(path.join(repo, "index.mjs"), path.join(self, "index.mjs"));
  copyFileSync(path.join(repo, "package.json"), path.join(self, "package.json"));
  writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@pebbly/aseprite-ai-artist", version: "0.0.0" }));
  copyFileSync(new URL("../hooks/shared.mjs", import.meta.url), path.join(pkg, "hooks", "shared.mjs"));
  copyFileSync(new URL("../skills/studio/SKILL.md", import.meta.url), path.join(pkg, "skills", "studio", "SKILL.md"));

  const mod: Any = await import(pathToFileURL(path.join(self, "index.mjs")).href);
  const { ready, commands, skills, toolHooks, sessionHooks } = load(mod.default);
  await ready;
  assert.deepEqual(commands.map((c) => c.name), ["aseprite:studio"]);
  assert.deepEqual(skills.map((s) => s.id), ["studio"]);
  assert.ok(toolHooks.has("execute.after"), "the nudge hook registers");
  assert.ok(sessionHooks.has("context"), "the status/nudge hook registers");
});

test("stays inert with one warning when no shared tree is available", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "aia-plugin-bare-"));
  const file = path.join(tmp, "index.mjs");
  copyFileSync(new URL("../opencode/index.mjs", import.meta.url), file);

  const mod: Any = await import(pathToFileURL(file).href);
  const warnings: string[] = [];
  const realWrite = process.stderr.write;
  process.stderr.write = ((chunk: unknown) => {
    warnings.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const { ready, commands } = load(mod.default);
    await ready;
    assert.equal(commands.length, 0, "no commands without the shared tree");
  } finally {
    process.stderr.write = realWrite;
  }
  assert.ok(
    warnings.some((w) => w.includes("shared code not found")),
    `expected one clear warning, got: ${warnings.join("")}`,
  );
});

test("opencode/package.json tracks the root package version", () => {
  const root = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const plugin = JSON.parse(readFileSync(new URL("../opencode/package.json", import.meta.url), "utf8"));
  assert.equal(plugin.version, root.version, "bump both together or drift releases silently");

  // Local use must never install the upstream registry package as a fallback.
  assert.equal(plugin.private,true);
  assert.equal(plugin.dependencies?.["@pebbly/aseprite-ai-artist"],"file:..");
});
