
import React from 'react';

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  isAdjusting?: boolean;
  className?: string;
}

const SliderControl: React.FC<SliderControlProps> = ({ 
  label, 
  value, 
  min, 
  max, 
  step = 1, 
  onChange,
  onInteractionStart,
  onInteractionEnd,
  isAdjusting = false,
  className = ""
}) => {
  // Calcular percentagem para a barra de progresso visual
  const percent = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

  return (
    <div className={`flex flex-col space-y-3 ${className}`}>
      {/* Rótulos com leve fade durante ajuste, mas legíveis */}
      <div className={`flex justify-between text-[10px] font-mono font-bold tracking-widest text-zinc-500 uppercase transition-opacity duration-300 ${isAdjusting ? 'opacity-50' : 'opacity-100'}`}>
        <span>{label}</span>
        <span className="text-white">{value.toFixed(2)}</span>
      </div>
      
      <div className="relative h-6 flex items-center">
        {/* Track Background (Linha Cinza) - Alterado para white/20 para visibilidade */}
        <div className="absolute w-full h-0.5 bg-white/20 rounded-full overflow-hidden">
             {/* Progress Bar (Linha Branca) */}
            <div 
                className="h-full bg-white transition-all duration-75 ease-out" 
                style={{ width: `${percent}%` }}
            />
        </div>
        
        {/* Input Invisível mas Funcional (Thumb estilizado via CSS global) */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onPointerDown={onInteractionStart}
          onPointerUp={onInteractionEnd}
          onPointerCancel={onInteractionEnd}
          onTouchStart={onInteractionStart}
          onTouchEnd={onInteractionEnd}
          className="relative w-full h-6 bg-transparent appearance-none cursor-pointer range-thumb-style z-10 outline-none"
          style={{ touchAction: 'none' }}
        />
      </div>
    </div>
  );
};

export default SliderControl;
