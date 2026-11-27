import { FilterSettings } from '../types';
import { getCurveLut, isCurveNeutral } from './curveMath';
import { getBwChannelWeights } from './bwFilters';
import { encodeDngFromImageData, DngMetadata } from './dngEncoder';
import { PreviewMediaElement, getPreviewDimensions } from './previewMedia';

const HIGH_PREC_STEPS = 4096;

/**
 * Generates an 8-bit 256-entry Look-Up Table (used by live Histogram and Zebras).
 */
export const generateLut = (settings: FilterSettings): Uint8Array => {
  const lutFloat = generateHighPrecisionLut(settings);
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const idx = Math.round((i / 255) * (HIGH_PREC_STEPS - 1));
    lut[i] = Math.max(0, Math.min(255, Math.round(lutFloat[idx])));
  }
  return lut;
};

/**
 * Generates a 12-bit (4096-entry) continuous float LUT matching the SVG filter
 * pipeline 1:1 with smooth linear curve interpolation.
 */
const generateHighPrecisionLut = (settings: FilterSettings): Float32Array => {
  const { blackPoint, whitePoint, midTone, contrast, outputBlack, outputWhite, curvePoints } =
    settings;
  const exposureGain = settings.exposureGain ?? 1.0;

  const neutralCurve = isCurveNeutral(curvePoints);
  const curveLutFloat = neutralCurve ? null : getCurveLut(curvePoints);
  const lut = new Float32Array(HIGH_PREC_STEPS);

  const bpNorm = blackPoint / 255;
  const wpNorm = whitePoint / 255;
  const spanNorm = Math.max(1 / 255, wpNorm - bpNorm);
  const outSpan = outputWhite - outputBlack;

  for (let i = 0; i < HIGH_PREC_STEPS; i++) {
    const grayNorm = i / (HIGH_PREC_STEPS - 1);

    // 0. Exposure gain (when software fallback is active)
    const exposed = exposureGain === 1.0 ? grayNorm : Math.min(1, grayNorm * exposureGain);

    // 1. Input levels
    let val = (exposed - bpNorm) / spanNorm;
    val = Math.max(0, Math.min(1, val));

    // 2. Gamma (Midtone)
    if (midTone !== 1 && val > 0) {
      val = Math.pow(val, 1 / midTone);
    }

    // 3. Contrast (pivot around 0.5)
    if (contrast !== 1) {
      val = (val - 0.5) * contrast + 0.5;
      val = Math.max(0, Math.min(1, val));
    }

    // 4. Smoothly interpolated Tone Curve (matches SVG feFunc type="table")
    if (curveLutFloat) {
      const curvePos = val * 255;
      const lo = Math.floor(curvePos);
      const hi = Math.min(255, lo + 1);
      const frac = curvePos - lo;
      val = curveLutFloat[lo] * (1 - frac) + curveLutFloat[hi] * frac;
    }

    // 5. Output levels (float 0..255)
    lut[i] = Math.max(0, Math.min(255, val * outSpan + outputBlack));
  }

  return lut;
};

/**
 * Applies optical B&W channel weights, 12-bit tone LUT, optical vignette, and organic film grain.
 */
const applyFiltersToImageData = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  settings: FilterSettings,
  lutFloat: Float32Array
) => {
  const maxIdx = HIGH_PREC_STEPS - 1;
  const lumScale = maxIdx / 255;
  const [wr, wg, wb] = getBwChannelWeights(settings.colorFilter);
  const grainAmount = Math.max(0, Math.min(1, settings.grain ?? 0));
  const vignetteAmount = Math.max(0, Math.min(1, settings.vignette ?? 0));

  const halfW = width * 0.5;
  const halfH = height * 0.5;
  const invDiag = 1 / Math.hypot(halfW, halfH);
  const hasEffects = grainAmount > 0.005 || vignetteAmount > 0.005;
  const seed = (Date.now() & 0xffff) | 1;

  for (let y = 0; y < height; y++) {
    const dy = y - halfH;
    const dy2 = dy * dy;
    const rowOff = y * width;

    for (let x = 0; x < width; x++) {
      const p = rowOff + x;
      const i = p * 4;

      const gray = wr * data[i] + wg * data[i + 1] + wb * data[i + 2];
      let lutIdx = (gray * lumScale + 0.5) | 0;
      if (lutIdx < 0) lutIdx = 0;
      else if (lutIdx > maxIdx) lutIdx = maxIdx;
      let outVal = lutFloat[lutIdx];

      if (hasEffects) {
        if (vignetteAmount > 0.005) {
          const dx = x - halfW;
          const rNorm = Math.sqrt(dx * dx + dy2) * invDiag;
          if (rNorm > 0.44) {
            const t = Math.min(1, (rNorm - 0.44) / 0.56);
            const smooth = t * t * (3 - 2 * t);
            outVal *= 1 - vignetteAmount * 0.88 * smooth;
          }
        }

        if (grainAmount > 0.005) {
          // Fast triangular-distributed deterministic grain modulated by midtone silver density
          let h = (p * 374761393 + seed * 668265263) | 0;
          h = Math.imul(h ^ (h >>> 13), 1274126177);
          h = h ^ (h >>> 16);
          const u1 = (h & 0xff) / 255;
          const u2 = ((h >>> 8) & 0xff) / 255;
          const tri = u1 + u2 - 1; // [-1, 1] peaked at 0
          const vNorm = outVal / 255;
          const midWeight = 0.35 + 0.65 * (4 * vNorm * (1 - vNorm));
          outVal += tri * grainAmount * 24 * midWeight;
        }
      }

      let finalByte = (outVal + 0.5) | 0;
      if (finalByte < 0) finalByte = 0;
      else if (finalByte > 255) finalByte = 255;
      data[i] = finalByte;
      data[i + 1] = finalByte;
      data[i + 2] = finalByte;
    }
  }
};

export const createThumbnailDataUrl = (
  sourceCanvas: HTMLCanvasElement,
  maxDim = 320
): string => {
  const scale = Math.min(1, maxDim / Math.max(sourceCanvas.width, sourceCanvas.height));
  const tw = Math.max(1, Math.round(sourceCanvas.width * scale));
  const th = Math.max(1, Math.round(sourceCanvas.height * scale));
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = tw;
  thumbCanvas.height = th;
  const tCtx = thumbCanvas.getContext('2d');
  if (!tCtx) return '';
  tCtx.imageSmoothingEnabled = true;
  tCtx.imageSmoothingQuality = 'high';
  tCtx.drawImage(sourceCanvas, 0, 0, tw, th);
  return thumbCanvas.toDataURL('image/jpeg', 0.82);
};

export interface ProcessedCaptureResult {
  url: string;
  thumbnailUrl: string;
  originalUrl?: string;
  dngBuffer?: ArrayBuffer;
  width: number;
  height: number;
}

const finalizeCanvasCapture = (
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  settings: FilterSettings,
  captureDng: boolean,
  dngMeta?: DngMetadata
): ProcessedCaptureResult => {
  const originalUrl = captureDng ? canvas.toDataURL('image/jpeg', 0.96) : undefined;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const dngBuffer = captureDng
    ? encodeDngFromImageData(imageData, dngMeta)
    : undefined;

  const lutFloat = generateHighPrecisionLut(settings);
  applyFiltersToImageData(imageData.data, canvas.width, canvas.height, settings, lutFloat);
  ctx.putImageData(imageData, 0, 0);

  return {
    url: canvas.toDataURL('image/jpeg', 0.98),
    thumbnailUrl: createThumbnailDataUrl(canvas),
    originalUrl,
    dngBuffer,
    width: canvas.width,
    height: canvas.height,
  };
};

export const snapshotVideoCanvas = (
  media: PreviewMediaElement,
  zoom: number,
  isNativeZoom: boolean
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null => {
  const { width, height } = getPreviewDimensions(media);
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (isNativeZoom || zoom <= 1) {
    ctx.drawImage(media, 0, 0, width, height);
  } else {
    const cropW = width / zoom;
    const cropH = height / zoom;
    const sx = (width - cropW) / 2;
    const sy = (height - cropH) / 2;
    ctx.drawImage(media, sx, sy, cropW, cropH, 0, 0, width, height);
  }

  return { canvas, ctx };
};

export const processCanvasSnapshot = (
  snapshot: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D },
  settings: FilterSettings,
  captureDng = false,
  dngMeta?: DngMetadata
): ProcessedCaptureResult => {
  return finalizeCanvasCapture(
    snapshot.canvas,
    snapshot.ctx,
    settings,
    captureDng,
    dngMeta
  );
};

const processCanvasSource = (
  source: CanvasImageSource,
  width: number,
  height: number,
  settings: FilterSettings,
  zoom: number,
  isNativeZoom: boolean,
  captureDng: boolean,
  dngMeta?: DngMetadata
): ProcessedCaptureResult | null => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (isNativeZoom || zoom <= 1) {
    ctx.drawImage(source, 0, 0, width, height);
  } else {
    const cropW = width / zoom;
    const cropH = height / zoom;
    const sx = (width - cropW) / 2;
    const sy = (height - cropH) / 2;
    ctx.drawImage(source, sx, sy, cropW, cropH, 0, 0, width, height);
  }

  return finalizeCanvasCapture(canvas, ctx, settings, captureDng, dngMeta);
};

/**
 * Capture directly from Video Element (Exact live HDR/exposure/focus preview frame)
 */
export const processImage = (
  media: PreviewMediaElement,
  settings: FilterSettings,
  zoom: number,
  isNativeZoom: boolean,
  captureDng = false,
  dngMeta?: DngMetadata
): ProcessedCaptureResult => {
  const { width, height } = getPreviewDimensions(media);
  return (
    processCanvasSource(
      media,
      width,
      height,
      settings,
      zoom,
      isNativeZoom,
      captureDng,
      dngMeta
    ) ?? { url: '', thumbnailUrl: '', width: 0, height: 0 }
  );
};

/**
 * Process an uncompressed ImageBitmap from ImageCapture.grabFrame()
 * Preserves live preview HDR+, manual exposure, and locked tap-focus distance.
 */
export const processBitmap = (
  bitmap: ImageBitmap,
  settings: FilterSettings,
  zoom: number,
  isNativeZoom: boolean,
  captureDng = false,
  dngMeta?: DngMetadata
): ProcessedCaptureResult => {
  const result = processCanvasSource(
    bitmap,
    bitmap.width,
    bitmap.height,
    settings,
    zoom,
    isNativeZoom,
    captureDng,
    dngMeta
  );
  if (!result) throw new Error('Context creation failed');
  return result;
};

/**
 * Non-destructive re-edit or Camera2 full-sensor JPEG -> B&W processing.
 */
export const reprocessImageFromUrl = (
  sourceUrl: string,
  settings: FilterSettings,
  options?: { includeColorCopyMaxDim?: number }
): Promise<{
  url: string;
  thumbnailUrl: string;
  originalUrl?: string;
  width: number;
  height: number;
}> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0);

      let originalUrl: string | undefined;
      if (options?.includeColorCopyMaxDim && options.includeColorCopyMaxDim > 0) {
        const scale = Math.min(
          1,
          options.includeColorCopyMaxDim / Math.max(canvas.width, canvas.height)
        );
        if (scale < 1) {
          const origCanvas = document.createElement('canvas');
          origCanvas.width = Math.max(1, Math.round(canvas.width * scale));
          origCanvas.height = Math.max(1, Math.round(canvas.height * scale));
          const oCtx = origCanvas.getContext('2d');
          if (oCtx) {
            oCtx.imageSmoothingEnabled = true;
            oCtx.imageSmoothingQuality = 'high';
            oCtx.drawImage(canvas, 0, 0, origCanvas.width, origCanvas.height);
            originalUrl = origCanvas.toDataURL('image/jpeg', 0.92);
          }
        } else {
          originalUrl = canvas.toDataURL('image/jpeg', 0.94);
        }
      }

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const lutFloat = generateHighPrecisionLut(settings);
      applyFiltersToImageData(
        imageData.data,
        canvas.width,
        canvas.height,
        settings,
        lutFloat
      );
      ctx.putImageData(imageData, 0, 0);
      resolve({
        url: canvas.toDataURL('image/jpeg', 0.96),
        thumbnailUrl: createThumbnailDataUrl(canvas),
        originalUrl,
        width: canvas.width,
        height: canvas.height,
      });
    };
    img.onerror = () => reject(new Error('Falha ao carregar imagem para edição.'));
    img.src = sourceUrl;
  });
};