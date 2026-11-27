/**
 * Lightweight real-time visual object tracker for live HTMLVideoElement or MJPEG HTMLImageElement feeds.
 * Uses mean-normalized Sum of Absolute Differences (SAD) template matching on a
 * downsampled luminance buffer, with object-cover viewport coordinate mapping.
 */
import {
  PreviewMediaElement,
  getPreviewDimensions,
  isPreviewReady,
} from './previewMedia';

export interface NormalizedPoint {
  x: number; // 0..1 in video frame or container space
  y: number; // 0..1 in video frame or container space
}

export interface TrackResult {
  screenX: number; // 0..100 (%) in container
  screenY: number; // 0..100 (%) in container
  videoX: number;  // 0..1 in video frame
  videoY: number;  // 0..1 in video frame
  confidence: number; // 0..1
}

const PROC_W = 160;
const PROC_H = 120;
const PATCH_RADIUS = 8; // 17x17 patch
const SEARCH_RADIUS = 14; // +/- 14px search window per frame

/**
 * Maps a screen tap (percentage 0..100 inside an `object-cover` container)
 * to normalized video sensor coordinates (0..1).
 */
export const screenPercentToVideoNorm = (
  screenPctX: number,
  screenPctY: number,
  containerW: number,
  containerH: number,
  videoW: number,
  videoH: number
): NormalizedPoint => {
  if (!containerW || !containerH || !videoW || !videoH) {
    return { x: screenPctX / 100, y: screenPctY / 100 };
  }

  const containerAspect = containerW / containerH;
  const videoAspect = videoW / videoH;

  let visibleW = 1;
  let visibleH = 1;
  let offsetX = 0;
  let offsetY = 0;

  if (videoAspect > containerAspect) {
    // Video is wider -> cropped horizontally
    visibleW = containerAspect / videoAspect;
    offsetX = (1 - visibleW) / 2;
  } else {
    // Video is taller -> cropped vertically
    visibleH = videoAspect / containerAspect;
    offsetY = (1 - visibleH) / 2;
  }

  return {
    x: Math.max(0.02, Math.min(0.98, offsetX + (screenPctX / 100) * visibleW)),
    y: Math.max(0.02, Math.min(0.98, offsetY + (screenPctY / 100) * visibleH)),
  };
};

/**
 * Maps normalized video coordinates (0..1) back to container percentage (0..100).
 */
export const videoNormToScreenPercent = (
  videoX: number,
  videoY: number,
  containerW: number,
  containerH: number,
  videoW: number,
  videoH: number
): { x: number; y: number } => {
  if (!containerW || !containerH || !videoW || !videoH) {
    return { x: videoX * 100, y: videoY * 100 };
  }

  const containerAspect = containerW / containerH;
  const videoAspect = videoW / videoH;

  let visibleW = 1;
  let visibleH = 1;
  let offsetX = 0;
  let offsetY = 0;

  if (videoAspect > containerAspect) {
    visibleW = containerAspect / videoAspect;
    offsetX = (1 - visibleW) / 2;
  } else {
    visibleH = videoAspect / containerAspect;
    offsetY = (1 - visibleH) / 2;
  }

  return {
    x: Math.max(4, Math.min(96, ((videoX - offsetX) / visibleW) * 100)),
    y: Math.max(4, Math.min(96, ((videoY - offsetY) / visibleH) * 100)),
  };
};

export class VisualObjectTracker {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private template: Float32Array | null = null;
  private templateMean = 0;
  private posX = 0.5; // normalized 0..1 in video space
  private posY = 0.5;
  private isActive = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = PROC_W;
    this.canvas.height = PROC_H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  private sampleGrayscale(media: PreviewMediaElement): Uint8Array | null {
    if (!this.ctx || !isPreviewReady(media)) return null;
    try {
      this.ctx.drawImage(media, 0, 0, PROC_W, PROC_H);
      const rgba = this.ctx.getImageData(0, 0, PROC_W, PROC_H).data;
      const gray = new Uint8Array(PROC_W * PROC_H);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
        gray[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
      }
      return gray;
    } catch {
      return null;
    }
  }

  private extractPatch(
    gray: Uint8Array,
    cx: number,
    cy: number
  ): { patch: Float32Array; mean: number; variance: number } {
    const size = PATCH_RADIUS * 2 + 1;
    const patch = new Float32Array(size * size);
    let sum = 0;
    let idx = 0;

    for (let dy = -PATCH_RADIUS; dy <= PATCH_RADIUS; dy++) {
      const py = Math.max(0, Math.min(PROC_H - 1, cy + dy));
      for (let dx = -PATCH_RADIUS; dx <= PATCH_RADIUS; dx++) {
        const px = Math.max(0, Math.min(PROC_W - 1, cx + dx));
        const val = gray[py * PROC_W + px];
        patch[idx++] = val;
        sum += val;
      }
    }

    const mean = sum / patch.length;
    let varSum = 0;
    for (let i = 0; i < patch.length; i++) {
      const diff = patch[i] - mean;
      varSum += diff * diff;
    }
    return { patch, mean, variance: varSum / patch.length };
  }

  public initAtVideoNorm(
    media: PreviewMediaElement,
    videoX: number,
    videoY: number
  ): boolean {
    const gray = this.sampleGrayscale(media);
    if (!gray) return false;

    const cx = Math.round(
      Math.max(PATCH_RADIUS, Math.min(PROC_W - 1 - PATCH_RADIUS, videoX * PROC_W))
    );
    const cy = Math.round(
      Math.max(PATCH_RADIUS, Math.min(PROC_H - 1 - PATCH_RADIUS, videoY * PROC_H))
    );

    const { patch, mean } = this.extractPatch(gray, cx, cy);
    this.template = patch;
    this.templateMean = mean;
    this.posX = videoX;
    this.posY = videoY;
    this.isActive = true;
    return true;
  }

  public stop() {
    this.isActive = false;
    this.template = null;
  }

  public getIsActive(): boolean {
    return this.isActive;
  }

  public update(
    media: PreviewMediaElement,
    containerW: number,
    containerH: number
  ): TrackResult | null {
    if (!this.isActive || !this.template) return null;
    const gray = this.sampleGrayscale(media);
    if (!gray) return null;

    const prevCx = Math.round(this.posX * PROC_W);
    const prevCy = Math.round(this.posY * PROC_H);

    const minX = Math.max(PATCH_RADIUS, prevCx - SEARCH_RADIUS);
    const maxX = Math.min(PROC_W - 1 - PATCH_RADIUS, prevCx + SEARCH_RADIUS);
    const minY = Math.max(PATCH_RADIUS, prevCy - SEARCH_RADIUS);
    const maxY = Math.min(PROC_H - 1 - PATCH_RADIUS, prevCy + SEARCH_RADIUS);

    const tpl = this.template;
    const tplMean = this.templateMean;
    const patchLen = tpl.length;

    let bestSad = Infinity;
    let bestX = prevCx;
    let bestY = prevCy;

    // Coarse 2px stride search first for speed on mobile WebView
    for (let cy = minY; cy <= maxY; cy += 2) {
      for (let cx = minX; cx <= maxX; cx += 2) {
        let sum = 0;
        let idx = 0;
        for (let dy = -PATCH_RADIUS; dy <= PATCH_RADIUS; dy++) {
          const rowOffset = (cy + dy) * PROC_W;
          for (let dx = -PATCH_RADIUS; dx <= PATCH_RADIUS; dx++) {
            sum += gray[rowOffset + cx + dx];
            idx++;
          }
        }
        const candMean = sum / patchLen;
        let sad = 0;
        idx = 0;
        for (let dy = -PATCH_RADIUS; dy <= PATCH_RADIUS; dy++) {
          const rowOffset = (cy + dy) * PROC_W;
          for (let dx = -PATCH_RADIUS; dx <= PATCH_RADIUS; dx++) {
            const diff = (gray[rowOffset + cx + dx] - candMean) - (tpl[idx++] - tplMean);
            sad += diff < 0 ? -diff : diff;
          }
        }
        // Subtle spatial anchor penalty to avoid jumping on uniform backgrounds
        const dist = Math.abs(cx - prevCx) + Math.abs(cy - prevCy);
        const score = sad / patchLen + dist * 0.25;
        if (score < bestSad) {
          bestSad = score;
          bestX = cx;
          bestY = cy;
        }
      }
    }

    // Fine 1px refinement around best coarse location
    const refMinX = Math.max(minX, bestX - 1);
    const refMaxX = Math.min(maxX, bestX + 1);
    const refMinY = Math.max(minY, bestY - 1);
    const refMaxY = Math.min(maxY, bestY + 1);

    for (let cy = refMinY; cy <= refMaxY; cy++) {
      for (let cx = refMinX; cx <= refMaxX; cx++) {
        let sum = 0;
        for (let dy = -PATCH_RADIUS; dy <= PATCH_RADIUS; dy++) {
          const rowOffset = (cy + dy) * PROC_W;
          for (let dx = -PATCH_RADIUS; dx <= PATCH_RADIUS; dx++) {
            sum += gray[rowOffset + cx + dx];
          }
        }
        const candMean = sum / patchLen;
        let sad = 0;
        let idx = 0;
        for (let dy = -PATCH_RADIUS; dy <= PATCH_RADIUS; dy++) {
          const rowOffset = (cy + dy) * PROC_W;
          for (let dx = -PATCH_RADIUS; dx <= PATCH_RADIUS; dx++) {
            const diff = (gray[rowOffset + cx + dx] - candMean) - (tpl[idx++] - tplMean);
            sad += diff < 0 ? -diff : diff;
          }
        }
        const dist = Math.abs(cx - prevCx) + Math.abs(cy - prevCy);
        const score = sad / patchLen + dist * 0.25;
        if (score < bestSad) {
          bestSad = score;
          bestX = cx;
          bestY = cy;
        }
      }
    }

    // Confidence in [0..1] (lower mean SAD error => higher confidence)
    const confidence = Math.max(0, Math.min(1, 1 - bestSad / 40));

    if (confidence > 0.35) {
      const targetX = bestX / PROC_W;
      const targetY = bestY / PROC_H;
      // Smooth exponential tracking filter
      this.posX = this.posX * 0.45 + targetX * 0.55;
      this.posY = this.posY * 0.45 + targetY * 0.55;

      // Gentle template adaptation when confidence is high
      if (confidence > 0.65) {
        const fresh = this.extractPatch(gray, bestX, bestY);
        if (fresh.variance > 25) {
          for (let i = 0; i < tpl.length; i++) {
            tpl[i] = tpl[i] * 0.92 + fresh.patch[i] * 0.08;
          }
          this.templateMean = this.templateMean * 0.92 + fresh.mean * 0.08;
        }
      }
    }

    const { width: mediaW, height: mediaH } = getPreviewDimensions(media);
    const screen = videoNormToScreenPercent(
      this.posX,
      this.posY,
      containerW,
      containerH,
      mediaW,
      mediaH
    );

    return {
      screenX: screen.x,
      screenY: screen.y,
      videoX: this.posX,
      videoY: this.posY,
      confidence,
    };
  }
}
