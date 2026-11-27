import React, { memo } from 'react';
import { FocusMode } from '../hooks/useCamera';

interface FocusReticleProps {
  reticleRef: React.RefObject<HTMLDivElement | null>;
  initialX: number;
  initialY: number;
  working: boolean;
  tracking: boolean;
  focusMode: FocusMode;
  hidden: boolean;
}

const FocusReticle: React.FC<FocusReticleProps> = ({
  reticleRef,
  initialX,
  initialY,
  working,
  tracking,
  focusMode,
  hidden,
}) => {
  const isHighlighted = focusMode === 'single-shot' || tracking;

  return (
    <div
      ref={reticleRef}
      className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-opacity ${
        working ? 'duration-150' : 'duration-75 ease-out'
      } ${hidden ? 'opacity-0' : 'opacity-100'}`}
      style={{ left: `${initialX}%`, top: `${initialY}%` }}
    >
      <div
        className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-transform duration-300 ease-out ${
          working ? 'scale-125' : 'scale-100'
        }`}
      >
        <div
          className={`absolute inset-0 rounded-full border-2 transition-colors duration-200 ${
            isHighlighted
              ? 'border-yellow-400 shadow-[0_0_14px_rgba(250,204,21,0.55)]'
              : 'border-white/90 shadow-[0_0_12px_rgba(255,255,255,0.35)]'
          }`}
        />
        <div
          className={`w-1.5 h-1.5 rounded-full ${
            isHighlighted
              ? 'bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.8)]'
              : 'bg-white'
          }`}
        />

        {/* Pixel 4-Tick Concentric Marks */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-0.5 h-1.5 bg-yellow-400/90 rounded-full" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 w-0.5 h-1.5 bg-yellow-400/90 rounded-full" />
        <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-1.5 h-0.5 bg-yellow-400/90 rounded-full" />
        <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1 w-1.5 h-0.5 bg-yellow-400/90 rounded-full" />

        {tracking && !working && (
          <div className="absolute inset-[-4px] rounded-full border border-yellow-400/40 animate-ping pointer-events-none" />
        )}
      </div>

      {tracking && !working && (
        <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap px-1.5 py-0.5 bg-black/60 backdrop-blur-md rounded-full border border-yellow-400/40 text-[9px] font-mono uppercase tracking-wider text-yellow-400 flex items-center gap-1 shadow-md">
          <span className="w-1 h-1 rounded-full bg-yellow-400 animate-pulse" />
          TRACK
        </div>
      )}
    </div>
  );
};

export default memo(FocusReticle);
