import React, { useMemo } from 'react';
import { CapabilityRange, formatExposureTime } from '../hooks/useCamera';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { useDoubleTap } from '../utils/useDoubleTap';
import { useI18n } from '../utils/i18n';

interface ExposureControlProps {
  mode: 'auto' | 'manual';
  exposureTime: number; // 100µs units
  exposureTimeRange: CapabilityRange;
  supportsExposureTime: boolean;
  iso: number;
  isoRange: CapabilityRange;
  supportsIso: boolean;
  onModeChange: (mode: 'auto' | 'manual') => void;
  onExposureTimeChange: (units100us: number) => void;
  onIsoChange: (iso: number) => void;
  onReset: () => void;
  onInteractionStateChange?: (isInteracting: boolean) => void;
  isAdjusting?: boolean;
}

const STANDARD_SHUTTER_UNITS = [
  3,     // ~1/3333s
  5,     // 1/2000s
  10,    // 1/1000s
  20,    // 1/500s
  40,    // 1/250s
  80,    // 1/125s
  167,   // 1/60s
  333,   // 1/30s
  667,   // 1/15s
  1250,  // 1/8s
  2500,  // 1/4s
  5000,  // 1/2s
  10000, // 1.0s
];

const STANDARD_ISO_STOPS = [50, 100, 200, 400, 800, 1600, 3200, 6400];

const triggerLightHaptic = () => {
  try {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  } catch {
    // Ignore on web
  }
};

const ExposureControl: React.FC<ExposureControlProps> = ({
  mode,
  exposureTime,
  exposureTimeRange,
  supportsExposureTime,
  iso,
  isoRange,
  supportsIso,
  onModeChange,
  onExposureTimeChange,
  onIsoChange,
  onReset,
  onInteractionStateChange,
  isAdjusting = false,
}) => {
  const { t } = useI18n();
  const shutterStops = useMemo(() => {
    const filtered = STANDARD_SHUTTER_UNITS.filter(
      u => u >= exposureTimeRange.min && u <= exposureTimeRange.max
    );
    if (filtered.length >= 3) return filtered;
    // Generate evenly spaced stops if sensor reports a tighter range
    const count = 6;
    const minLog = Math.log2(Math.max(1, exposureTimeRange.min));
    const maxLog = Math.log2(Math.max(2, exposureTimeRange.max));
    return Array.from({ length: count }, (_, idx) =>
      Math.round(Math.pow(2, minLog + ((maxLog - minLog) * idx) / (count - 1)))
    );
  }, [exposureTimeRange.min, exposureTimeRange.max]);

  const isoStops = useMemo(() => {
    const filtered = STANDARD_ISO_STOPS.filter(
      v => v >= isoRange.min && v <= isoRange.max
    );
    if (filtered.length >= 3) return filtered;
    const count = 5;
    return Array.from({ length: count }, (_, idx) =>
      Math.round(
        isoRange.min + ((isoRange.max - isoRange.min) * idx) / (count - 1)
      )
    );
  }, [isoRange.min, isoRange.max]);

  // Logarithmic mapping for shutter slider so 1/2000s..1/2s feels perceptually linear in EV stops
  const minLogTime = Math.log2(Math.max(1, exposureTimeRange.min));
  const maxLogTime = Math.log2(
    Math.max(exposureTimeRange.min + 1, exposureTimeRange.max)
  );
  const currentLogTime = Math.min(
    maxLogTime,
    Math.max(minLogTime, Math.log2(Math.max(1, exposureTime)))
  );

  // Logarithmic mapping for ISO slider
  const minLogIso = Math.log2(Math.max(25, isoRange.min));
  const maxLogIso = Math.log2(Math.max(isoRange.min + 10, isoRange.max));
  const currentLogIso = Math.min(
    maxLogIso,
    Math.max(minLogIso, Math.log2(Math.max(25, iso)))
  );

  const nudgeShutter = (dir: -1 | 1) => {
    const idx = shutterStops.reduce((bestIdx, val, i) => {
      return Math.abs(val - exposureTime) <
        Math.abs(shutterStops[bestIdx] - exposureTime)
        ? i
        : bestIdx;
    }, 0);
    const nextIdx = Math.min(shutterStops.length - 1, Math.max(0, idx + dir));
    triggerLightHaptic();
    onExposureTimeChange(shutterStops[nextIdx]);
  };

  const nudgeIso = (dir: -1 | 1) => {
    const idx = isoStops.reduce((bestIdx, val, i) => {
      return Math.abs(val - iso) < Math.abs(isoStops[bestIdx] - iso)
        ? i
        : bestIdx;
    }, 0);
    const nextIdx = Math.min(isoStops.length - 1, Math.max(0, idx + dir));
    triggerLightHaptic();
    onIsoChange(isoStops[nextIdx]);
  };

  const evDelta =
    Math.log2(Math.max(25, iso) / 200) +
    Math.log2(Math.max(1, exposureTime) / 80);

  const defaultShutter = Math.min(
    exposureTimeRange.max,
    Math.max(exposureTimeRange.min, 80)
  );
  const defaultIso = Math.min(isoRange.max, Math.max(isoRange.min, 200));

  const handleResetShutter = useDoubleTap(() =>
    onExposureTimeChange(defaultShutter)
  );
  const handleResetIso = useDoubleTap(() => onIsoChange(defaultIso));

  return (
    <div
      className="w-full max-w-sm mx-auto flex flex-col gap-4 select-none"
      onTouchStart={e => e.stopPropagation()}
      onTouchMove={e => e.stopPropagation()}
      onTouchEnd={e => e.stopPropagation()}
    >
      {/* Top Mode Row */}
      <div
        className={`flex items-center justify-between gap-3 transition-opacity duration-200 ${
          isAdjusting ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
          <button
            type="button"
            onClick={() => {
              triggerLightHaptic();
              onModeChange('auto');
            }}
            className={`min-h-[34px] px-3.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              mode === 'auto'
                ? 'bg-white text-black shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Auto
          </button>
          <button
            type="button"
            onClick={() => {
              triggerLightHaptic();
              onModeChange('manual');
            }}
            className={`min-h-[34px] px-3.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              mode === 'manual'
                ? 'bg-yellow-400 text-black shadow-sm font-semibold'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Manual
          </button>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400 tabular-nums">
          <span>
            {supportsExposureTime || supportsIso
              ? t.exposureNativeSensor
              : t.exposureEvMode}
          </span>
          {mode === 'manual' && (
            <button
              type="button"
              onClick={() => {
                triggerLightHaptic();
                onReset();
              }}
              aria-label={t.resetDefaultHint}
              className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 active:scale-90 transition-transform"
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 1. Tempo de Exposição (Shutter Speed) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div
            onPointerUp={handleResetShutter}
            title={t.resetDefaultHint}
            className="flex items-baseline gap-2 cursor-pointer"
          >
            <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
              {t.shutterSpeed}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => nudgeShutter(-1)}
              aria-label="Diminuir tempo de exposição"
              className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-zinc-300 active:scale-90 transition-transform"
            >
              <Minus size={13} />
            </button>
            <span
              onPointerUp={handleResetShutter}
              className={`min-w-[68px] text-center text-sm font-mono font-semibold tabular-nums cursor-pointer ${
                mode === 'manual' ? 'text-yellow-400' : 'text-white'
              }`}
            >
              {mode === 'auto' ? 'AUTO' : formatExposureTime(exposureTime)}
            </span>
            <button
              type="button"
              onClick={() => nudgeShutter(1)}
              aria-label="Aumentar tempo de exposição"
              className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-zinc-300 active:scale-90 transition-transform"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>

        {/* Fine Shutter Slider (Logarithmic Stops) */}
        <input
          type="range"
          min={minLogTime}
          max={maxLogTime}
          step={0.05}
          value={currentLogTime}
          onPointerDown={() => onInteractionStateChange?.(true)}
          onPointerUp={e => {
            onInteractionStateChange?.(false);
            handleResetShutter(e);
          }}
          onPointerCancel={() => onInteractionStateChange?.(false)}
          onTouchStart={() => onInteractionStateChange?.(true)}
          onTouchEnd={() => onInteractionStateChange?.(false)}
          onChange={e => {
            const units = Math.round(Math.pow(2, parseFloat(e.target.value)));
            onExposureTimeChange(
              Math.min(
                exposureTimeRange.max,
                Math.max(exposureTimeRange.min, units)
              )
            );
          }}
          className="w-full h-2 bg-white/15 rounded-full appearance-none cursor-pointer range-thumb-style"
          aria-label="Selecionar tempo de exposição"
        />

        {/* Quick Shutter Stops */}
        <div
          className={`flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5 transition-opacity duration-200 ${
            isAdjusting ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          {shutterStops.map(stop => {
            const isSelected =
              mode === 'manual' &&
              Math.abs(Math.log2(stop) - Math.log2(Math.max(1, exposureTime))) <
                0.28;
            return (
              <button
                key={stop}
                type="button"
                onClick={() => {
                  triggerLightHaptic();
                  onExposureTimeChange(stop);
                }}
                className={`shrink-0 min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-mono tabular-nums whitespace-nowrap transition-all active:scale-95 ${
                  isSelected
                    ? 'bg-white text-black font-semibold'
                    : 'bg-white/5 text-zinc-300 border border-white/10 hover:bg-white/10'
                }`}
              >
                {formatExposureTime(stop)}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. ISO Manual */}
      <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
        <div className="flex items-center justify-between">
          <span
            onPointerUp={handleResetIso}
            title={t.resetDefaultHint}
            className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 cursor-pointer"
          >
            {t.manualIso}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => nudgeIso(-1)}
              aria-label="Diminuir ISO"
              className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-zinc-300 active:scale-90 transition-transform"
            >
              <Minus size={13} />
            </button>
            <span
              onPointerUp={handleResetIso}
              className={`min-w-[68px] text-center text-sm font-mono font-semibold tabular-nums cursor-pointer ${
                mode === 'manual' ? 'text-yellow-400' : 'text-white'
              }`}
            >
              {mode === 'auto' ? 'AUTO' : `ISO ${Math.round(iso)}`}
            </span>
            <button
              type="button"
              onClick={() => nudgeIso(1)}
              aria-label="Aumentar ISO"
              className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-zinc-300 active:scale-90 transition-transform"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>

        {/* Fine ISO Slider */}
        <input
          type="range"
          min={minLogIso}
          max={maxLogIso}
          step={0.05}
          value={currentLogIso}
          onPointerDown={() => onInteractionStateChange?.(true)}
          onPointerUp={e => {
            onInteractionStateChange?.(false);
            handleResetIso(e);
          }}
          onPointerCancel={() => onInteractionStateChange?.(false)}
          onTouchStart={() => onInteractionStateChange?.(true)}
          onTouchEnd={() => onInteractionStateChange?.(false)}
          onChange={e => {
            const rawIso = Math.pow(2, parseFloat(e.target.value));
            const step = Math.max(10, isoRange.step || 10);
            const snapped = Math.round(rawIso / step) * step;
            onIsoChange(
              Math.min(isoRange.max, Math.max(isoRange.min, snapped))
            );
          }}
          className="w-full h-2 bg-white/15 rounded-full appearance-none cursor-pointer range-thumb-style"
          aria-label="Selecionar sensibilidade ISO"
        />

        {/* Quick ISO Stops */}
        <div
          className={`flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5 transition-opacity duration-200 ${
            isAdjusting ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          {isoStops.map(stop => {
            const isSelected =
              mode === 'manual' && Math.abs(iso - stop) <= Math.max(15, stop * 0.18);
            return (
              <button
                key={stop}
                type="button"
                onClick={() => {
                  triggerLightHaptic();
                  onIsoChange(stop);
                }}
                className={`shrink-0 min-h-[34px] px-3 py-1 rounded-lg text-[11px] font-mono tabular-nums whitespace-nowrap transition-all active:scale-95 ${
                  isSelected
                    ? 'bg-white text-black font-semibold'
                    : 'bg-white/5 text-zinc-300 border border-white/10 hover:bg-white/10'
                }`}
              >
                {stop}
              </button>
            );
          })}
        </div>
      </div>

      {/* Relative Light Entry Summary */}
      <div
        className={`flex items-center justify-between text-[11px] font-mono text-zinc-400 tabular-nums pt-1 transition-opacity duration-200 ${
          isAdjusting ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <span>{t.lightInput}</span>
        <span className="text-zinc-200">
          {mode === 'auto'
            ? t.lightAuto
            : `${evDelta > 0 ? '+' : ''}${evDelta.toFixed(1)} EV (ref. 1/125s · ISO 200)`}
        </span>
      </div>
    </div>
  );
};

export default ExposureControl;
