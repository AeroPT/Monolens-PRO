import React, { memo, useEffect, useMemo, useRef } from 'react';
import { FilterSettings, PeakingColorId } from '../types';
import { generateLut } from '../utils/imageProcessing';
import { getBwChannelWeights } from '../utils/bwFilters';
import {
  PreviewMediaElement,
  getPreviewDimensions,
  isPreviewReady,
} from '../utils/previewMedia';

export interface PeakingColorDef {
  id: PeakingColorId;
  label: string;
  hex: string;
  rgb: [number, number, number];
}

export const PEAKING_COLORS: PeakingColorDef[] = [
  { id: 'yellow', label: 'Amarelo', hex: '#facc15', rgb: [250, 204, 21] },
  { id: 'red', label: 'Vermelho', hex: '#ef4444', rgb: [239, 68, 68] },
  { id: 'cyan', label: 'Ciano', hex: '#22d3ee', rgb: [34, 211, 238] },
  { id: 'green', label: 'Verde', hex: '#4ade80', rgb: [74, 222, 128] },
  { id: 'white', label: 'Branco', hex: '#ffffff', rgb: [255, 255, 255] },
];

export const getPeakingColorDef = (id?: PeakingColorId): PeakingColorDef => {
  return PEAKING_COLORS.find(c => c.id === id) ?? PEAKING_COLORS[0];
};

interface AssistOverlayProps {
  videoRef: React.RefObject<PreviewMediaElement | null>;
  settings: FilterSettings;
  zoom: number;
  supportsNativeZoom: boolean;
  peakingEnabled: boolean;
  peakingColor?: PeakingColorId;
  peakingIntensity?: number; // 10..100
  zebrasEnabled: boolean;
  visible: boolean;
}

const AssistOverlay: React.FC<AssistOverlayProps> = ({
  videoRef,
  settings,
  zoom,
  supportsNativeZoom,
  peakingEnabled,
  peakingColor = 'yellow' as PeakingColorId,
  peakingIntensity = 55,
  zebrasEnabled,
  visible,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const grayBufferRef = useRef<Float32Array | null>(null);
  const outImageRef = useRef<ImageData | null>(null);
  const containerSizeRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const lut = useMemo(() => generateLut(settings), [settings]);
  const [wr, wg, wb] = getBwChannelWeights(settings.colorFilter);
  const active = visible && (peakingEnabled || zebrasEnabled);
  const colorDef = getPeakingColorDef(peakingColor);
  const clampedIntensity = Math.max(10, Math.min(100, peakingIntensity));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;

    const updateSize = () => {
      containerSizeRef.current = {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      };
    };
    updateSize();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      containerSizeRef.current = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    if (!active) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    if (!sampleCanvasRef.current) {
      sampleCanvasRef.current = document.createElement('canvas');
    }
    const sampleCanvas = sampleCanvasRef.current;
    const sCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!sCtx) return;

    const norm = (clampedIntensity - 10) / 90; // 0..1
    const thresholdSq = Math.round(52000 * Math.pow(1 - norm * 0.85, 2) + 3600);
    const peakAlpha = Math.round(165 + norm * 85);
    const [pr, pg, pb] = colorDef.rgb;

    let rafId = 0;
    let lastDraw = 0;

    const render = (now: number) => {
      rafId = requestAnimationFrame(render);
      if (now - lastDraw < 80) return; // ~12fps smooth & low-power
      lastDraw = now;

      const media = videoRef.current;
      if (!isPreviewReady(media)) {
        return;
      }

      const { width: vw, height: vh } = getPreviewDimensions(media);
      if (!vw || !vh) return;

      const cw = containerSizeRef.current.width || canvas.clientWidth;
      const ch = containerSizeRef.current.height || canvas.clientHeight;
      if (cw <= 0 || ch <= 0) return;

      const aspect = cw / ch;
      const targetW = aspect >= 1 ? 300 : Math.max(140, Math.round(300 * aspect));
      const targetH = aspect >= 1 ? Math.max(140, Math.round(300 / aspect)) : 300;

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        sampleCanvas.width = targetW;
        sampleCanvas.height = targetH;
        grayBufferRef.current = new Float32Array(targetW * targetH);
        outImageRef.current = ctx.createImageData(targetW, targetH);
      }

      const videoAspect = vw / vh;

      let srcW = vw;
      let srcH = vh;
      if (videoAspect > aspect) {
        srcH = vh;
        srcW = vh * aspect;
      } else {
        srcW = vw;
        srcH = vw / aspect;
      }

      if (!supportsNativeZoom && zoom > 1) {
        srcW /= zoom;
        srcH /= zoom;
      }

      const sx = (vw - srcW) * 0.5;
      const sy = (vh - srcH) * 0.5;

      let srcData: Uint8ClampedArray;
      try {
        sCtx.drawImage(media!, sx, sy, srcW, srcH, 0, 0, targetW, targetH);
        srcData = sCtx.getImageData(0, 0, targetW, targetH).data;
      } catch {
        return;
      }

      const grayBuf = grayBufferRef.current!;
      const outImg = outImageRef.current!;
      const outData = outImg.data;
      outData.fill(0);

      const pixelCount = targetW * targetH;
      for (let p = 0; p < pixelCount; p++) {
        const idx = p * 4;
        const g = wr * srcData[idx] + wg * srcData[idx + 1] + wb * srcData[idx + 2];
        grayBuf[p] = g;

        if (zebrasEnabled) {
          let gi = (g + 0.5) | 0;
          if (gi < 0) gi = 0;
          else if (gi > 255) gi = 255;
          if (lut[gi] >= 248) {
            const x = p % targetW;
            const y = (p / targetW) | 0;
            if (((x + y) & 7) < 3) {
              outData[idx] = 239;
              outData[idx + 1] = 68;
              outData[idx + 2] = 68;
              outData[idx + 3] = 185;
            }
          }
        }
      }

      if (peakingEnabled) {
        for (let y = 1; y < targetH - 1; y++) {
          const row = y * targetW;
          const prevRow = row - targetW;
          const nextRow = row + targetW;

          for (let x = 1; x < targetW - 1; x++) {
            const tl = grayBuf[prevRow + x - 1];
            const tc = grayBuf[prevRow + x];
            const tr = grayBuf[prevRow + x + 1];
            const ml = grayBuf[row + x - 1];
            const mr = grayBuf[row + x + 1];
            const bl = grayBuf[nextRow + x - 1];
            const bc = grayBuf[nextRow + x];
            const br = grayBuf[nextRow + x + 1];

            const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
            const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
            const magSq = gx * gx + gy * gy;

            if (magSq > thresholdSq) {
              const idx = (row + x) * 4;
              outData[idx] = pr;
              outData[idx + 1] = pg;
              outData[idx + 2] = pb;
              outData[idx + 3] = peakAlpha;
            }
          }
        }
      }

      ctx.putImageData(outImg, 0, 0);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [
    active,
    videoRef,
    lut,
    wr,
    wg,
    wb,
    zoom,
    supportsNativeZoom,
    peakingEnabled,
    colorDef,
    clampedIntensity,
    zebrasEnabled,
  ]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-[5]"
      aria-hidden="true"
    />
  );
};

export default memo(AssistOverlay);
