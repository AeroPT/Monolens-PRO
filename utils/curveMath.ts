import { Point } from '../types';

export type CurvePresetId = 'linear' | 'contrast' | 'shadows' | 'noir';

export interface CurvePreset {
  id: CurvePresetId;
  label: string;
  points: Point[];
}

export const CURVE_PRESETS: CurvePreset[] = [
  {
    id: 'linear',
    label: 'Linear',
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  },
  {
    id: 'contrast',
    label: 'Contraste S',
    points: [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.16 },
      { x: 0.75, y: 0.84 },
      { x: 1, y: 1 },
    ],
  },
  {
    id: 'shadows',
    label: 'Sombras +',
    points: [
      { x: 0, y: 0.08 },
      { x: 0.26, y: 0.36 },
      { x: 0.68, y: 0.72 },
      { x: 1, y: 1 },
    ],
  },
  {
    id: 'noir',
    label: 'Noir',
    points: [
      { x: 0, y: 0 },
      { x: 0.28, y: 0.09 },
      { x: 0.72, y: 0.90 },
      { x: 1, y: 1 },
    ],
  },
];

/**
 * Builds a clean 4-point tone curve from intuitive Shadow (-1..1) and Contrast (-1..1) controls.
 */
export const buildToneCurveFromControls = (
  shadowsAdjust: number,
  contrastAdjust: number
): Point[] => {
  const s = Math.max(-1, Math.min(1, shadowsAdjust));
  const c = Math.max(-1, Math.min(1, contrastAdjust));

  if (Math.abs(s) < 0.01 && Math.abs(c) < 0.01) {
    return [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
  }

  // Positive shadows lifts black floor slightly and raises quarter-tone;
  // negative shadows deepens the shadow quarter-tone.
  const blackLift = s > 0 ? s * 0.12 : 0;
  const shadowY = Math.max(
    0,
    Math.min(0.6, 0.25 + s * 0.16 - c * 0.12)
  );
  const highlightY = Math.max(
    shadowY + 0.08,
    Math.min(1, 0.75 + c * 0.12 + s * 0.03)
  );

  return [
    { x: 0, y: Number(blackLift.toFixed(3)) },
    { x: 0.25, y: Number(shadowY.toFixed(3)) },
    { x: 0.75, y: Number(highlightY.toFixed(3)) },
    { x: 1, y: 1 },
  ];
};

/**
 * Estimates intuitive Shadow (-1..1) and Contrast (-1..1) values from any curve.
 */
export const estimateToneMetrics = (
  points: Point[]
): { shadows: number; contrast: number } => {
  const lut = getCurveLut(points);
  const y0 = lut[0];
  const y25 = lut[64];  // x ~ 0.25 (shadows)
  const y75 = lut[191]; // x ~ 0.75 (highlights)

  // Contrast relates to the slope between highlights (0.75) and shadows (0.25).
  // Neutral span is 0.50.
  const span = y75 - y25;
  const contrast = Math.max(-1, Math.min(1, (span - 0.5) / 0.24));

  // Shadow shift combines black lift and quarter-tone deviation after accounting for contrast.
  const neutralShadowAtContrast = 0.25 - contrast * 0.12;
  const shadowDelta = (y25 - neutralShadowAtContrast) + y0 * 0.6;
  const shadows = Math.max(-1, Math.min(1, shadowDelta / 0.16));

  return { shadows, contrast };
};

export const isCurveNeutral = (points: Point[]): boolean => {
  if (points.length === 0) return true;
  if (
    points.length === 2 &&
    Math.abs(points[0].x) < 0.005 &&
    Math.abs(points[0].y) < 0.005 &&
    Math.abs(points[1].x - 1) < 0.005 &&
    Math.abs(points[1].y - 1) < 0.005
  ) {
    return true;
  }
  const lut = getCurveLut(points);
  for (let i = 0; i < 256; i += 8) {
    if (Math.abs(lut[i] - i / 255) > 0.015) return false;
  }
  return true;
};

/**
 * Calculates a Look-Up Table (LUT) of 256 values (0-1 range) based on control points
 * using Fritsch-Carlson Monotone Cubic Spline interpolation (prevents overshoot).
 */
export const getCurveLut = (points: Point[]): number[] => {
  if (!points || points.length === 0) {
    return Array.from({ length: 256 }, (_, i) => i / 255);
  }

  // 1. Sort points by X and deduplicate close X coordinates
  const rawSorted = [...points]
    .map(p => ({
      x: Math.max(0, Math.min(1, p.x)),
      y: Math.max(0, Math.min(1, p.y)),
    }))
    .sort((a, b) => a.x - b.x);

  const sorted: Point[] = [];
  for (const p of rawSorted) {
    if (sorted.length === 0 || p.x - sorted[sorted.length - 1].x > 0.001) {
      sorted.push(p);
    } else {
      sorted[sorted.length - 1] = p;
    }
  }

  // Ensure start and end points cover 0 and 1
  if (sorted[0].x > 0) sorted.unshift({ x: 0, y: sorted[0].y });
  if (sorted[sorted.length - 1].x < 1) {
    sorted.push({ x: 1, y: sorted[sorted.length - 1].y });
  }

  const n = sorted.length;
  if (n < 2) {
    return Array.from({ length: 256 }, (_, i) => i / 255);
  }

  const x = sorted.map(p => p.x);
  const y = sorted.map(p => p.y);

  // 2. Calculate Secants and Tangents (Fritsch-Carlson)
  const d = new Array<number>(n - 1);
  const m = new Array<number>(n);

  for (let i = 0; i < n - 1; i++) {
    const dx = x[i + 1] - x[i];
    d[i] = dx === 0 ? 0 : (y[i + 1] - y[i]) / dx;
  }

  m[0] = d[0];
  m[n - 1] = d[n - 2];

  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m[i] = 0;
    } else {
      m[i] = (d[i - 1] + d[i]) / 2;
    }
  }

  // Enforce monotonicity to eliminate cubic overshoot
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(d[i]) < 1e-6) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / d[i];
      const beta = m[i + 1] / d[i];
      const sq = alpha * alpha + beta * beta;
      if (sq > 9) {
        const tau = 3 / Math.sqrt(sq);
        m[i] = tau * alpha * d[i];
        m[i + 1] = tau * beta * d[i];
      }
    }
  }

  // 3. Interpolate 256 values
  const lut: number[] = new Array(256);
  let currentSegment = 0;

  for (let i = 0; i < 256; i++) {
    const t = i / 255;

    while (currentSegment < n - 2 && t > x[currentSegment + 1]) {
      currentSegment++;
    }

    const x0 = x[currentSegment];
    const x1 = x[currentSegment + 1];
    const y0 = y[currentSegment];
    const y1 = y[currentSegment + 1];
    const m0 = m[currentSegment];
    const m1 = m[currentSegment + 1];

    const h = x1 - x0;

    if (h <= 0) {
      lut[i] = y0;
      continue;
    }

    const tNorm = (t - x0) / h;
    const t2 = tNorm * tNorm;
    const t3 = t2 * tNorm;

    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + tNorm;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    const val = h00 * y0 + h10 * h * m0 + h01 * y1 + h11 * h * m1;

    lut[i] = Math.max(0, Math.min(1, val));
  }

  return lut;
};