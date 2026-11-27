import React from 'react';
import { useDoubleTap } from '../utils/useDoubleTap';
import { useI18n } from '../utils/i18n';

interface SliderControlProps {
  label: string;
  value: number;
  defaultValue?: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
  onReset?: () => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  isAdjusting?: boolean;
  className?: string;
}

const SliderControl: React.FC<SliderControlProps> = ({
  label,
  value,
  defaultValue,
  min,
  max,
  step = 1,
  onChange,
  onReset,
  onInteractionStart,
  onInteractionEnd,
  isAdjusting = false,
  className = '',
}) => {
  const { t } = useI18n();
  const percent = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

  const handleReset = () => {
    if (onReset) {
      onReset();
    } else if (defaultValue !== undefined) {
      onChange(defaultValue);
    }
  };

  const handleDoubleTap = useDoubleTap(handleReset);

  return (
    <div className={`flex flex-col space-y-2.5 ${className}`}>
      {/* Label & tabular value — double-tap resets to default */}
      <div
        onPointerUp={handleDoubleTap}
        title={t.resetDefaultHint}
        className={`flex justify-between text-[11px] font-mono font-bold tracking-widest text-zinc-400 uppercase cursor-pointer transition-opacity duration-300 ${
          isAdjusting ? 'opacity-50' : 'opacity-100'
        }`}
      >
        <span>{label}</span>
        <span className="text-white tabular-nums">
          {Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}
        </span>
      </div>

      <div className="relative h-7 flex items-center">
        <div className="absolute w-full h-0.5 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-white transition-all duration-75 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>

        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          onPointerDown={onInteractionStart}
          onPointerUp={e => {
            onInteractionEnd?.();
            handleDoubleTap(e);
          }}
          onPointerCancel={onInteractionEnd}
          onTouchStart={onInteractionStart}
          onTouchEnd={onInteractionEnd}
          className="relative w-full h-7 bg-transparent appearance-none cursor-pointer range-thumb-style z-10 outline-none"
          style={{ touchAction: 'none' }}
          aria-label={label}
        />
      </div>
    </div>
  );
};

export default SliderControl;
