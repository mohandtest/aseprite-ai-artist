export function isoBox(op: {
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
  top: string;
  left: string;
  right: string;
}) {
  const { x, y, width: w, depth: d, height: h } = op;
  const a = { x, y },
    b = { x: x + 2 * w, y: y + w },
    c = { x: x + 2 * w - 2 * d, y: y + w + d },
    e = { x: x - 2 * d, y: y + d };
  const down = (p: { x: number; y: number }) => ({ x: p.x, y: p.y + h });
  return [
    { kind: "polyline", closed: true, color: op.left, fill: op.left, points: [e, c, down(c), down(e)] },
    { kind: "polyline", closed: true, color: op.right, fill: op.right, points: [c, b, down(b), down(c)] },
    { kind: "polyline", closed: true, color: op.top, fill: op.top, points: [a, b, c, e] },
  ];
}
export function gridOutline(op: {
  x: number;
  y: number;
  rows: string[];
  legend: Record<string, string | null>;
  outlineColor?: string;
}) {
  if (!op.outlineColor) return [];
  const ink = new Set<string>();
  op.rows.forEach((row, y) =>
    Array.from(row).forEach((glyph, x) => {
      if ((glyph in op.legend ? op.legend[glyph] : null) && !/^#?[0-9a-f]{6}00$/i.test(op.legend[glyph]!))
        ink.add(`${x},${y}`);
    }),
  );
  const border = new Set<string>();
  for (const key of ink) {
    const [x, y] = key.split(",").map(Number);
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const k = `${x! + dx!},${y! + dy!}`;
      if (!ink.has(k)) border.add(k);
    }
  }
  return [...border].map((k) => {
    const [x, y] = k.split(",").map(Number);
    return { x: x! + op.x, y: y! + op.y, color: op.outlineColor! };
  });
}
