import React, { memo } from 'react';
import { X } from 'lucide-react';
import { PeakingColorId } from '../types';
import { PEAKING_COLORS, getPeakingColorDef } from './AssistOverlay';
import { Translations } from '../utils/i18n';

interface PeakSettingsMenuProps {
  peakingColor: PeakingColorId;
  peakingIntensity: number;
  onSelectColor: (color: PeakingColorId) => void;
  onIntensityChange: (val: number) => void;
  onDoubleTapReset: (e: React.PointerEvent) => void;
  onClose: () => void;
  t: Translations;
}

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

const PeakSettingsMenu: React.FC<PeakSettingsMenuProps> = ({
  peakingColor,
  peakingIntensity,
  onSelectColor,
  onIntensityChange,
  onDoubleTapReset,
  onClose,
  t,
}) => {
  return (
    <div
      onClick={stopPropagation}
      onTouchStart={stopPropagation}
      onTouchMove={stopPropagation}
      onTouchEnd={stopPropagation}
      className="absolute top-[192px] right-5 z-[115] w-60 bg-black/85 backdrop-blur-2xl border border-white/20 rounded-2xl p-3.5 shadow-2xl pointer-events-auto space-y-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-400">
          Focus Peaking
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
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider">
          <span className="text-zinc-400">{t.colorLabel}</span>
          <span
            className="font-semibold"
            style={{ color: getPeakingColorDef(peakingColor).hex }}
          >
            {t.peakingColors[peakingColor]}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {PEAKING_COLORS.map(color => {
            const isSelected = peakingColor === color.id;
            return (
              <button
                key={color.id}
                type="button"
                onClick={() => onSelectColor(color.id)}
                aria-label={`${t.colorLabel} ${t.peakingColors[color.id]}`}
                className={`h-8 rounded-xl flex items-center justify-center border transition-all active:scale-90 ${
                  isSelected
                    ? 'bg-white/15 border-white shadow-sm'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                <span
                  className="w-4 h-4 rounded-full border border-black/40"
                  style={{ backgroundColor: color.hex }}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5 pt-1 border-t border-white/10">
        <div
          onPointerUp={onDoubleTapReset}
          title={t.resetDefaultHint}
          className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider cursor-pointer"
        >
          <span className="text-zinc-400">{t.intensityLabel}</span>
          <span className="text-white font-semibold tabular-nums">
            {peakingIntensity}%
          </span>
        </div>
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={peakingIntensity}
          onPointerUp={onDoubleTapReset}
          onChange={e => onIntensityChange(parseInt(e.target.value, 10))}
          className="w-full h-2 bg-white/20 rounded-full appearance-none cursor-pointer range-thumb-style"
          aria-label={t.peakingIntensity}
        />
      </div>
    </div>
  );
};

export default memo(PeakSettingsMenu);
