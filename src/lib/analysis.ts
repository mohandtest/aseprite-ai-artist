import type { PixelRegion } from "./render.js";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface AnalysisOptions {
  connectivity?: 4 | 8;
  maxComponents?: number;
  rowWidths?: boolean;
}

/** Presence-based measurements: partial alpha counts as occupied, not extra mass. */
export function analyzeRegion(r: PixelRegion, options: AnalysisOptions = {}) {
  const n = r.width * r.height;
  if (r.grid.length !== n || n > 4_000_000) throw new Error("Invalid or oversized raster");
  if (r.grid.some((i) => !Number.isInteger(i) || i < 0 || i >= r.colors.length)) throw new Error("Invalid color index");
  const occupied = (i: number) => {
    const c = r.colors[r.grid[i]!]!;
    return r.grid[i] !== 0 && !/^#[0-9a-f]{6}00$/i.test(c);
  };
  let count = 0,
    sx = 0,
    sy = 0,
    minX = r.width,
    minY = r.height,
    maxX = -1,
    maxY = -1;
  const colors = new Map<string, number>();
  const rowWidths: number[] = [];
  let mirrorMatches = 0,
    mirrorCompared = 0;
  for (let y = 0; y < r.height; y++) {
    let lo = r.width,
      hi = -1;
    for (let x = 0; x < r.width; x++) {
      const i = y * r.width + x;
      const present = occupied(i),
        mirrored = occupied(y * r.width + r.width - 1 - x);
      if (present || mirrored) {
        mirrorCompared++;
        if (present === mirrored) mirrorMatches++;
      }
      if (!occupied(i)) continue;
      count++;
      sx += x + r.x;
      sy += y + r.y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      const c = r.colors[r.grid[i]!]!.toLowerCase();
      colors.set(c, (colors.get(c) ?? 0) + 1);
    }
    if (options.rowWidths) rowWidths.push(hi < lo ? 0 : hi - lo + 1);
  }
  const visited = new Uint8Array(n);
  const components: { size: number; bounds: Bounds }[] = [];
  let componentCount = 0;
  const componentLimit = options.maxComponents ?? 20;
  const dirs =
    options.connectivity === 4
      ? [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]
      : [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [-1, 1],
          [1, -1],
          [-1, -1],
        ];
  for (let start = 0; start < n; start++) {
    if (visited[start] || !occupied(start)) continue;
    const queue = [start];
    visited[start] = 1;
    let x0 = r.width,
      y0 = r.height,
      x1 = -1,
      y1 = -1;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!,
        x = i % r.width,
        y = Math.floor(i / r.width);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      for (const [dx, dy] of dirs) {
        const nx = x + dx!,
          ny = y + dy!;
        if (nx < 0 || nx >= r.width || ny < 0 || ny >= r.height) continue;
        const j = ny * r.width + nx;
        if (!visited[j] && occupied(j)) {
          visited[j] = 1;
          queue.push(j);
        }
      }
    }
    componentCount++;
    if (componentLimit > 0) {
      components.push({
        size: queue.length,
        bounds: { x: x0 + r.x, y: y0 + r.y, width: x1 - x0 + 1, height: y1 - y0 + 1 },
      });
      components.sort((a, b) => b.size - a.size);
      if (components.length > componentLimit) components.pop();
    }
  }
  components.sort((a, b) => b.size - a.size);
  return {
    opaquePixels: count,
    occupiedBounds: count ? { x: minX + r.x, y: minY + r.y, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    centerOfMass: count ? { x: sx / count, y: sy / count } : null,
    componentCount,
    components: components.slice(0, options.maxComponents ?? 20),
    colors: {
      unique: colors.size,
      top: [...colors]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 32)
        .map(([hex, count]) => ({ hex, count })),
    },
    symmetry: { axisX: r.x + (r.width - 1) / 2, matchRatio: mirrorCompared ? mirrorMatches / mirrorCompared : 1 },
    ...(options.rowWidths ? { rowWidths } : {}),
  };
}

export function compareMeasurements(before: ReturnType<typeof analyzeRegion>, after: ReturnType<typeof analyzeRegion>) {
  return {
    areaChangePercent: before.opaquePixels
      ? ((after.opaquePixels - before.opaquePixels) / before.opaquePixels) * 100
      : null,
    centroidDelta:
      before.centerOfMass && after.centerOfMass
        ? { x: after.centerOfMass.x - before.centerOfMass.x, y: after.centerOfMass.y - before.centerOfMass.y }
        : null,
    groundDelta:
      before.occupiedBounds && after.occupiedBounds
        ? after.occupiedBounds.y + after.occupiedBounds.height - before.occupiedBounds.y - before.occupiedBounds.height
        : null,
  };
}
