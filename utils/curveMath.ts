import { Point } from '../types';

/**
 * Calculates a Look-Up Table (LUT) of 256 values (0-1 range) based on control points
 * using Monotone Cubic Spline interpolation.
 */
export const getCurveLut = (points: Point[]): number[] => {
  // 1. Sort points by X
  const sorted = [...points].sort((a, b) => a.x - b.x);

  // Ensure start and end points cover 0 and 1
  if (sorted[0].x > 0) sorted.unshift({ x: 0, y: 0 });
  if (sorted[sorted.length - 1].x < 1) sorted.push({ x: 1, y: 1 });

  const n = sorted.length;
  const x = sorted.map(p => p.x);
  const y = sorted.map(p => p.y);

  // 2. Calculate Secants and Tangents
  const d = new Array(n - 1);
  const m = new Array(n);

  // Secants
  for (let i = 0; i < n - 1; i++) {
    const dx = x[i + 1] - x[i];
    if (dx === 0) d[i] = 0;
    else d[i] = (y[i + 1] - y[i]) / dx;
  }

  // Tangents (Monotone)
  m[0] = d[0];
  m[n - 1] = d[n - 2];

  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m[i] = 0;
    } else {
      m[i] = (d[i - 1] + d[i]) / 2; // Simple averaging usually sufficient for curves
    }
  }

  // 3. Interpolate 256 values
  const lut: number[] = [];
  let currentSegment = 0;

  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    
    // Find segment
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
    
    // Check for vertical line or single point
    if (h <= 0) {
        lut.push(y0);
        continue;
    }

    const tNorm = (t - x0) / h;
    const t2 = tNorm * tNorm;
    const t3 = t2 * tNorm;

    // Hermite Basis Functions
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + tNorm;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    const val = h00 * y0 + h10 * h * m0 + h01 * y1 + h11 * h * m1;
    
    lut.push(Math.max(0, Math.min(1, val)));
  }

  return lut;
};