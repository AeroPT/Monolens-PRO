import React, { useRef, useEffect } from 'react';
import { FilterSettings } from '../types';
import { generateLut } from '../utils/imageProcessing';

interface HistogramProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  settings: FilterSettings;
  visible: boolean;
}

const Histogram: React.FC<HistogramProps> = ({ videoRef, settings, visible }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  
  // Processing canvas (not visible) used for downsampling
  const processCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!processCanvasRef.current) {
        processCanvasRef.current = document.createElement('canvas');
        // Low resolution is sufficient for histogram and much faster
        processCanvasRef.current.width = 64; 
        processCanvasRef.current.height = 64;
    }

    const render = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const processCanvas = processCanvasRef.current;

      if (visible && video && canvas && processCanvas && video.readyState >= 2) {
        const ctx = canvas.getContext('2d', { alpha: true });
        const processCtx = processCanvas.getContext('2d', { willReadFrequently: true });
        
        if (ctx && processCtx) {
          // 1. Draw downsampled video frame
          processCtx.drawImage(video, 0, 0, processCanvas.width, processCanvas.height);
          
          // 2. Get Pixels
          const frame = processCtx.getImageData(0, 0, processCanvas.width, processCanvas.height);
          const data = frame.data;
          
          // 3. Generate LUT based on current settings
          const lut = generateLut(settings);
          
          // 4. Calculate Histogram Bins
          const bins = new Uint32Array(256);
          let maxCount = 0;
          
          // Optimization: Sample every 4th pixel if performance is tight, 
          // but with 64x64 resolution, iterating all is fast enough.
          for (let i = 0; i < data.length; i += 4) {
            // Calculate perceived brightness (Rec 709)
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];
            const gray = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
            
            // Map through the LUT (Simulate the filters)
            const val = lut[gray];
            
            bins[val]++;
            if (bins[val] > maxCount) maxCount = bins[val];
          }

          // 5. Draw Histogram
          const width = canvas.width;
          const height = canvas.height;
          
          ctx.clearRect(0, 0, width, height);
          
          // Clipping Indicators Background
          if (bins[0] > 0) {
             ctx.fillStyle = 'rgba(0, 100, 255, 0.5)'; // Blue tint for blacks
             ctx.fillRect(0, 0, 4, height);
          }
          if (bins[255] > 0) {
             ctx.fillStyle = 'rgba(255, 50, 50, 0.5)'; // Red tint for whites
             ctx.fillRect(width - 4, 0, 4, height);
          }

          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.beginPath();
          ctx.moveTo(0, height);

          // Draw Bars
          for (let i = 0; i < 256; i++) {
             const x = (i / 255) * width;
             // Logarithmic scaling helps visualize shadow detail better than linear
             const count = bins[i];
             const percent = count / maxCount;
             const barHeight = percent * height;
             
             ctx.lineTo(x, height - barHeight);
          }
          
          ctx.lineTo(width, height);
          ctx.fill();
        }
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [videoRef, settings, visible]);

  return (
    <div className={`
        pointer-events-none transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] transform origin-top-left
        ${visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-4 scale-90'}
    `}>
        <div className="bg-black/40 backdrop-blur-md rounded border border-white/10 p-1 shadow-2xl">
            <canvas 
                ref={canvasRef} 
                width={100} 
                height={50} 
                className="w-[100px] h-[50px]"
            />
        </div>
        {/* Simple Labels */}
        <div className="flex justify-between px-1 mt-0.5 opacity-60">
            <span className="text-[8px] font-mono text-white">BLK</span>
            <span className="text-[8px] font-mono text-white">WHT</span>
        </div>
    </div>
  );
};

export default Histogram;