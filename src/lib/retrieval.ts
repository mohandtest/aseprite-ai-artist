import type { RuleDoc } from "./skills.js";
const aliases: Record<string, string> = {
  eye: "eyes face",
  jitter: "animation spacing timing",
  palette_drift: "palette color ramps",
  missing_expected_cel: "animation rig frame",
  isometric: "isometric perspective",
  banding: "banding clusters",
  detached_component: "silhouette clusters",
};
export function retrieveRules(rules: readonly RuleDoc[], query: string, limit = 3) {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 2 || /^\d{2,3}$/.test(t));
  const terms = [...new Set(tokens.flatMap((t) => [t, ...(aliases[t] ?? "").split(" ")]).filter(Boolean))];
  return rules
    .map((r) => {
      const title = (r.name + " " + r.title).toLowerCase();
      const paragraphs = r.body.split(/\n\s*\n/);
      const ranked = paragraphs
        .map((text, index) => ({
          text,
          index,
          score: terms.reduce((n, t) => n + (text.toLowerCase().includes(t) ? 1 : 0), 0),
        }))
        .sort((a, b) => b.score - a.score || a.index - b.index);
      const score = terms.reduce((n, t) => n + (title.includes(t) ? 5 : 0), 0) + (ranked[0]?.score ?? 0);
      return {
        uri: `rules://${r.name}`,
        title: r.title,
        score,
        excerpt: ranked
          .slice(0, 3)
          .sort((a, b) => a.index - b.index)
          .map((p) => p.text)
          .join("\n\n")
          .slice(0, 2400),
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.uri.localeCompare(b.uri))
    .slice(0, Math.min(4, limit));
}

export function ruleMetadata(rules: readonly RuleDoc[]) {
  return rules.map((r) => ({
    uri: `rules://${r.name}`,
    title: r.title,
    topics: [
      ...new Set(
        r.title
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter((s) => s.length > 2),
      ),
    ],
    sizes: [...new Set(r.body.match(/\b\d{1,3}[x×]\d{1,3}\b/gi) ?? [])].slice(0, 16),
    templates: (r.body.match(/```(?:json|grid)/g) ?? []).length,
    characters: r.body.length,
  }));
}
