import React, { memo } from 'react';
import { X } from 'lucide-react';
import { CaptureMode } from '../types';
import { CAPTURE_MODES, isProCaptureSupported } from '../utils/proCapture';
import { Translations } from '../utils/i18n';

interface ModeMeta {
  label: string;
  pillLabel: string;
  resolutionHint: string;
  description: string;
}

interface CaptureModeMenuProps {
  captureMode: CaptureMode;
  onSelectMode: (mode: CaptureMode) => void;
  onClose: () => void;
  getModeMeta: (mode: CaptureMode) => ModeMeta;
  t: Translations;
}

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

const CaptureModeMenu: React.FC<CaptureModeMenuProps> = ({
  captureMode,
  onSelectMode,
  onClose,
  getModeMeta,
  t,
}) => {
  const nativeAndroid = isProCaptureSupported();

  return (
    <div
      onClick={stopPropagation}
      onTouchStart={stopPropagation}
      onTouchMove={stopPropagation}
      onTouchEnd={stopPropagation}
      className="absolute top-[236px] left-5 z-[115] w-72 bg-black/88 backdrop-blur-2xl border border-white/20 rounded-2xl p-3.5 shadow-2xl pointer-events-auto space-y-2.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-400">
          {t.captureModeTitle}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.cancel}
          className="p-1 rounded-full text-zinc-400 hover:text-white active:scale-90"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-1.5">
        {CAPTURE_MODES.map(mode => {
          const isSelected = captureMode === mode.id;
          const isSensorMax = mode.id === 'sensor_max';
          const modeMeta = getModeMeta(mode.id);
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => onSelectMode(mode.id)}
              className={`w-full text-left p-2.5 rounded-xl border transition-all active:scale-[0.98] ${
                isSelected
                  ? isSensorMax
                    ? 'bg-yellow-400/15 border-yellow-400/70'
                    : 'bg-white/15 border-white/60'
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-xs font-semibold ${
                    isSelected
                      ? isSensorMax
                        ? 'text-yellow-300'
                        : 'text-white'
                      : 'text-zinc-200'
                  }`}
                >
                  {modeMeta.label}
                </span>
                <span className="text-[9px] font-mono text-zinc-400 shrink-0">
                  {modeMeta.resolutionHint}
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-snug text-zinc-400">
                {modeMeta.description}
              </p>
              {isSensorMax && !nativeAndroid && (
                <p className="mt-1 text-[9px] font-mono text-yellow-400/80">
                  {t.sensorMaxBrowserNote}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default memo(CaptureModeMenu);
