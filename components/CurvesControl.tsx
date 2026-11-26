
import React, { useRef, useState, useMemo } from 'react';
import { Point } from '../types';
import { getCurveLut } from '../utils/curveMath';

interface CurvesControlProps {
  points: Point[];
  onChange: (points: Point[]) => void;
  onInteractionStateChange?: (isInteracting: boolean) => void;
  onInteractionStart?: () => void;
}

const CurvesControl: React.FC<CurvesControlProps> = ({ points, onChange, onInteractionStateChange, onInteractionStart }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
  const isInteracting = activePointIndex !== null;
  
  // Refs for manual double-tap detection
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  // Visual configuration
  const VIEW_SIZE = 100;
  const PADDING = 12; 
  const GRAPH_SIZE = VIEW_SIZE - (PADDING * 2);

  const toViewX = (val: number) => PADDING + val * GRAPH_SIZE;
  const toViewY = (val: number) => (VIEW_SIZE - PADDING) - val * GRAPH_SIZE;

  const toDataX = (svgX: number) => (svgX - PADDING) / GRAPH_SIZE;
  const toDataY = (svgY: number) => ((VIEW_SIZE - PADDING) - svgY) / GRAPH_SIZE;

  const pathData = useMemo(() => {
    const lut = getCurveLut(points);
    let d = `M ${toViewX(0)} ${toViewY(lut[0])}`;
    for (let i = 1; i < 256; i += 2) {
      const dataX = i / 255;
      const dataY = lut[i];
      d += ` L ${toViewX(dataX).toFixed(1)} ${toViewY(dataY).toFixed(1)}`;
    }
    return d;
  }, [points]);

  const getPointerDataCoords = (e: React.PointerEvent | React.MouseEvent) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    const svgX = relX * VIEW_SIZE;
    const svgY = relY * VIEW_SIZE;
    const dataX = toDataX(svgX);
    const dataY = toDataY(svgY);
    return { x: dataX, y: dataY };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);

    const coords = getPointerDataCoords(e);
    if (!coords) return;

    onInteractionStart?.();

    const now = Date.now();
    const THRESHOLD = 0.15;

    let isDoubleTap = false;
    if (lastTapRef.current) {
        const timeDiff = now - lastTapRef.current.time;
        const distDiff = Math.hypot(lastTapRef.current.x - coords.x, lastTapRef.current.y - coords.y);
        if (timeDiff < 300 && distDiff < 0.1) {
            isDoubleTap = true;
        }
    }

    lastTapRef.current = { time: now, x: coords.x, y: coords.y };

    if (isDoubleTap) {
        const indexToDelete = points.findIndex(p => 
            Math.hypot(p.x - coords.x, p.y - coords.y) < THRESHOLD
        );
        if (indexToDelete !== -1 && points.length > 2) {
            const newPoints = points.filter((_, i) => i !== indexToDelete);
            onChange(newPoints);
            setActivePointIndex(null);
            onInteractionStateChange?.(false);
            lastTapRef.current = null;
            return;
        }
    }

    onInteractionStateChange?.(true);

    let closestIndex = -1;
    let minDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.hypot(p.x - coords.x, p.y - coords.y);
      if (dist < minDist) {
        minDist = dist;
        closestIndex = i;
      }
    });

    if (closestIndex !== -1 && minDist < THRESHOLD) {
      setActivePointIndex(closestIndex);
    } else {
      if (coords.x >= -0.05 && coords.x <= 1.05 && coords.y >= -0.05 && coords.y <= 1.05) {
        const newX = Math.max(0, Math.min(1, coords.x));
        const newY = Math.max(0, Math.min(1, coords.y));
        const newPoint = { x: newX, y: newY };
        const newPoints = [...points, newPoint].sort((a, b) => a.x - b.x);
        onChange(newPoints);
        setActivePointIndex(newPoints.findIndex(p => p.x === newX && p.y === newY));
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (activePointIndex === null) return;
    const coords = getPointerDataCoords(e);
    if (!coords) return;
    const x = Math.max(0, Math.min(1, coords.x));
    const y = Math.max(0, Math.min(1, coords.y));
    const newPoints = [...points];
    newPoints[activePointIndex] = { x, y };
    onChange(newPoints);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture(e.pointerId);
    if (activePointIndex !== null) {
        setActivePointIndex(null);
        const sorted = [...points].sort((a, b) => a.x - b.x);
        onChange(sorted);
    }
    onInteractionStateChange?.(false);
  };

  return (
    <div className={`w-full aspect-square relative select-none touch-none transition-all duration-300 rounded-lg overflow-hidden ${isInteracting ? 'bg-transparent border-transparent shadow-none' : 'bg-black/50 border border-white/10 shadow-xl'}`}>
        <svg 
            ref={svgRef}
            viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} 
            className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            preserveAspectRatio="none"
        >
            {/* Grade que faz fade out durante a interação */}
            <g stroke="#27272a" strokeWidth="1" className={`transition-opacity duration-300 ${isInteracting ? 'opacity-0' : 'opacity-100'}`}>
                {[0, 0.25, 0.5, 0.75, 1].map(t => (
                    <line key={`v-${t}`} x1={toViewX(t)} y1={toViewY(0)} x2={toViewX(t)} y2={toViewY(1)} />
                ))}
                {[0, 0.25, 0.5, 0.75, 1].map(t => (
                    <line key={`h-${t}`} x1={toViewX(0)} y1={toViewY(t)} x2={toViewX(1)} y2={toViewY(t)} />
                ))}
            </g>

            {/* Linha Diagonal Guia (fade out também) */}
            <line 
                x1={toViewX(0)} y1={toViewY(0)} 
                x2={toViewX(1)} y2={toViewY(1)} 
                stroke="white" 
                strokeWidth="1" 
                strokeDasharray="4" 
                className={`transition-opacity duration-300 pointer-events-none ${isInteracting ? 'opacity-0' : 'opacity-20'}`}
            />

            {/* A Curva (Sempre Visível) */}
            <path 
                d={`${pathData} L ${toViewX(1)} ${toViewY(0)} L ${toViewX(0)} ${toViewY(0)} Z`} 
                fill="url(#gradient)" 
                className={`transition-opacity duration-300 pointer-events-none ${isInteracting ? 'opacity-10' : 'opacity-20'}`}
                vectorEffect="non-scaling-stroke"
            />
            <path 
                d={pathData} 
                fill="none" 
                stroke="white" 
                strokeWidth="2" 
                vectorEffect="non-scaling-stroke"
                className="drop-shadow-md pointer-events-none"
            />

            <defs>
                <linearGradient id="gradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="white" />
                    <stop offset="100%" stopColor="transparent" />
                </linearGradient>
            </defs>

            {/* Pontos de Controle (Sempre Visíveis) */}
            {points.map((p, i) => {
                const isActive = activePointIndex === i;
                return (
                    <g key={i} transform={`translate(${toViewX(p.x)}, ${toViewY(p.y)})`}>
                        <circle r="12" fill="transparent" /> 
                        <circle
                            r={isActive ? 6 : 4}
                            fill={isActive ? "#facc15" : "white"}
                            stroke="black"
                            strokeWidth="1.5"
                            className="transition-all duration-75"
                        />
                    </g>
                );
            })}
        </svg>
        
        <div className={`absolute bottom-2 right-2 text-[10px] text-zinc-500 font-mono pointer-events-none transition-opacity duration-200 ${isInteracting ? 'opacity-100' : 'opacity-0'}`}>
            In: {(activePointIndex !== null ? points[activePointIndex].x * 255 : 0).toFixed(0)} Out: {(activePointIndex !== null ? points[activePointIndex].y * 255 : 0).toFixed(0)}
        </div>
    </div>
  );
};

export default CurvesControl;
