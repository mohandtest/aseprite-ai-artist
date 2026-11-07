export interface Finding {
  check: string;
  severity: string;
  message: string;
  layer?: string | null;
  frame?: number | null;
  at?: { x: number; y: number } | null;
  count?: number | null;
}
export function actionableFinding(f: Finding, plans: boolean) {
  const missing = f.check === "animation" && /missing|no cel/i.test(f.message);
  const code = missing ? "missing_expected_cel" : `${f.check}_${f.severity}`;
  const fixes: Record<string, unknown>[] = [];
  if (plans && missing && f.layer && f.frame && f.frame > 1)
    fixes.push({
      id: "copy_previous_cel",
      risk: "medium",
      autoSafe: false,
      tool: "cel",
      arguments: { op: "copy", layer: f.layer, frame: f.frame - 1, toFrame: f.frame },
    });
  if (plans && f.check === "palette" && /not in the palette/i.test(f.message))
    fixes.push({ id: "snap_to_palette", risk: "medium", autoSafe: false, tool: "recolor", arguments: { op: "snap" } });
  return { ...f, code, evidence: { ...f }, fixes };
}
