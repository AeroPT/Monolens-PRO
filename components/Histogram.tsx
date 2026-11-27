import React, { memo, useRef, useEffect, useMemo } from 'react';
import { FilterSettings } from '../types';
import { generateLut } from '../utils/imageProcessing';
import { getBwChannelWeights } from '../utils/bwFilters';

interface HistogramProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  settings: FilterSettings;
  visible: boolean;
}

const Histogram: React.FC<HistogramProps> = ({ videoRef, settings, visible }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const processCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const lut = useMemo(() => generateLut(settings), [settings]);
  const [wr, wg, wb] = getBwChannelWeights(settings.colorFilter);

  useEffect(() => {
    if (!processCanvasRef.current) {
      processCanvasRef.current = document.createElement('canvas');
      processCanvasRef.current.width = 64;
      processCanvasRef.current.height = 64;
    }

    const canvas = canvasRef.current;
    const processCanvas = processCanvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: true }) ?? null;
    const processCtx =
      processCanvas?.getContext('2d', { willReadFrequently: true }) ?? null;

    if (!visible || !canvas || !processCanvas || !ctx || !processCtx) {
      return;
    }

    let lastRenderTime = 0;

    const render = (now: number) => {
      animationRef.current = requestAnimationFrame(render);
      if (now - lastRenderTime < 66) return;
      lastRenderTime = now;

      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        processCtx.drawImage(video, 0, 0, processCanvas.width, processCanvas.height);

        const frame = processCtx.getImageData(0, 0, processCanvas.width, processCanvas.height);
        const data = frame.data;

        const bins = new Uint32Array(256);
        let maxCount = 1;

        for (let i = 0; i < data.length; i += 4) {
          let gray = (wr * data[i] + wg * data[i + 1] + wb * data[i + 2] + 0.5) | 0;
          if (gray < 0) gray = 0;
          else if (gray > 255) gray = 255;
          const val = lut[gray];
          const count = ++bins[val];
          if (count > maxCount) maxCount = count;
        }

        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        if (bins[0] > 0) {
          ctx.fillStyle = 'rgba(0, 100, 255, 0.5)';
          ctx.fillRect(0, 0, 4, height);
        }
        if (bins[255] > 0) {
          ctx.fillStyle = 'rgba(255, 50, 50, 0.5)';
          ctx.fillRect(width - 4, 0, 4, height);
        }

        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.beginPath();
        ctx.moveTo(0, height);

        for (let i = 0; i < 256; i++) {
          const x = (i / 255) * width;
          const barHeight = (bins[i] / maxCount) * height;
          ctx.lineTo(x, height - barHeight);
        }

        ctx.lineTo(width, height);
        ctx.fill();
      }
    };

    animationRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [videoRef, lut, visible, wr, wg, wb]);

  return (
    <div
      className={`pointer-events-none transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] transform origin-top-left ${
        visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-4 scale-90'
      }`}
    >
      <div className="bg-black/40 backdrop-blur-md rounded border border-white/10 p-1 shadow-2xl">
        <canvas
          ref={canvasRef}
          width={100}
          height={50}
          className="w-[100px] h-[50px]"
        />
      </div>
      <div className="flex justify-between px-1 mt-0.5 opacity-60">
        <span className="text-[8px] font-mono text-white">BLK</span>
        <span className="text-[8px] font-mono text-white">WHT</span>
      </div>
    </div>
  );
};

export default memo(Histogram);