/**
 * Local ROI Contrast-Detection AutoFocus (CDAF) via WebRTC focusDistance sweep.
 * Used when tapping a circular focus zone so Android Camera2 locks onto the exact
 * selected area instead of defaulting to closest-subject continuous AF.
 */

const ROI_SIZE = 84;

const waitFrames = (video: HTMLVideoElement, settleMs: number): Promise<void> => {
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const timer = setTimeout(finish, settleMs + 60);

    setTimeout(() => {
      const anyVideo = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
      if (typeof anyVideo.requestVideoFrameCallback === 'function') {
        anyVideo.requestVideoFrameCallback(() => {
          clearTimeout(timer);
          finish();
        });
      } else {
        requestAnimationFrame(() => {
          clearTimeout(timer);
          finish();
        });
      }
    }, settleMs);
  });
};

const measureRoiSharpness = (
  video: HTMLVideoElement,
  normX: number,
  normY: number,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): number => {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return 0;

  const patchW = Math.min(ROI_SIZE, vw);
  const patchH = Math.min(ROI_SIZE, vh);
  const sx = Math.max(0, Math.min(vw - patchW, Math.round(normX * vw - patchW / 2)));
  const sy = Math.max(0, Math.min(vh - patchH, Math.round(normY * vh - patchH / 2)));

  ctx.drawImage(video, sx, sy, patchW, patchH, 0, 0, ROI_SIZE, ROI_SIZE);
  const { data } = ctx.getImageData(0, 0, ROI_SIZE, ROI_SIZE);

  // Compute grayscale luminance buffer
  const gray = new Float32Array(ROI_SIZE * ROI_SIZE);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }

  // Tenengrad gradient energy restricted to circular ROI radius
  const cx = ROI_SIZE / 2;
  const cy = ROI_SIZE / 2;
  const maxR2 = (ROI_SIZE * 0.45) * (ROI_SIZE * 0.45);
  let energy = 0;

  for (let y = 1; y < ROI_SIZE - 1; y++) {
    const dy = y - cy;
    const rowOff = y * ROI_SIZE;
    for (let x = 1; x < ROI_SIZE - 1; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy > maxR2) continue;

      const idx = rowOff + x;
      const gx =
        -gray[idx - ROI_SIZE - 1] +
        gray[idx - ROI_SIZE + 1] -
        2 * gray[idx - 1] +
        2 * gray[idx + 1] -
        gray[idx + ROI_SIZE - 1] +
        gray[idx + ROI_SIZE + 1];
      const gy =
        -gray[idx - ROI_SIZE - 1] -
        2 * gray[idx - ROI_SIZE] -
        gray[idx - ROI_SIZE + 1] +
        gray[idx + ROI_SIZE - 1] +
        2 * gray[idx + ROI_SIZE] +
        gray[idx + ROI_SIZE + 1];

      energy += gx * gx + gy * gy;
    }
  }

  return energy;
};

export interface ContrastSweepParams {
  video: HTMLVideoElement;
  normPoint: { x: number; y: number };
  minDist: number;
  maxDist: number;
  applyFocusDistance: (distance: number) => Promise<void>;
  isCancelled: () => boolean;
}

export const runContrastAutofocusSweep = async ({
  video,
  normPoint,
  minDist,
  maxDist,
  applyFocusDistance,
  isCancelled,
}: ContrastSweepParams): Promise<number | null> => {
  if (maxDist <= minDist || video.readyState < 2) return null;

  const canvas = document.createElement('canvas');
  canvas.width = ROI_SIZE;
  canvas.height = ROI_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  // Perceptual distribution: denser near infinity..mid-range (0..2.5 diopters), still covering macro
  const coarseSteps = 10;
  const span = maxDist - minDist;
  const candidates: number[] = [];
  for (let i = 0; i < coarseSteps; i++) {
    const t = i / (coarseSteps - 1);
    candidates.push(minDist + span * Math.pow(t, 1.65));
  }

  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < candidates.length; i++) {
    if (isCancelled()) return null;
    await applyFocusDistance(candidates[i]);
    await waitFrames(video, 50);
    if (isCancelled()) return null;

    const score = measureRoiSharpness(
      video,
      normPoint.x,
      normPoint.y,
      canvas,
      ctx
    );
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  // Fine refinement pass around the coarse peak
  const lowBracket = candidates[Math.max(0, bestIdx - 1)];
  const highBracket = candidates[Math.min(candidates.length - 1, bestIdx + 1)];
  let bestDist = candidates[bestIdx];
  const fineSteps = 5;

  for (let i = 0; i < fineSteps; i++) {
    if (isCancelled()) return null;
    const t = i / (fineSteps - 1);
    const d = lowBracket + (highBracket - lowBracket) * t;
    await applyFocusDistance(d);
    await waitFrames(video, 50);
    if (isCancelled()) return null;

    const score = measureRoiSharpness(
      video,
      normPoint.x,
      normPoint.y,
      canvas,
      ctx
    );
    if (score > bestScore) {
      bestScore = score;
      bestDist = d;
    }
  }

  if (isCancelled()) return null;
  await applyFocusDistance(bestDist);
  return bestDist;
};
