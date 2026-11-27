import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { BwColorFilterId, Point } from '../types';
import {
  getCurveLut,
  CURVE_PRESETS,
  CurvePresetId,
  buildToneCurveFromControls,
  estimateToneMetrics,
  isCurveNeutral,
} from '../utils/curveMath';
import { getBwChannelWeights } from '../utils/bwFilters';
import { Trash2, RotateCcw } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { useDoubleTap } from '../utils/useDoubleTap';
import { useI18n } from '../utils/i18n';

interface CurvesControlProps {
  points: Point[];
  onChange: (points: Point[]) => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  colorFilter?: BwColorFilterId;
  onInteractionStateChange?: (isInteracting: boolean) => void;
  onInteractionStart?: () => void;
}

const MAX_POINTS = 7;

const triggerLightHaptic = () => {
  try {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  } catch {
    // Ignore on non-native web preview
  }
};

const CurvesControl: React.FC<CurvesControlProps> = ({
  points,
  onChange,
  videoRef,
  colorFilter,
  onInteractionStateChange,
  onInteractionStart,
}) => {
  const { t } = useI18n();
  const [wr, wg, wb] = getBwChannelWeights(colorFilter);
  const svgRef = useRef<SVGSVGElement>(null);
  const histCanvasRef = useRef<HTMLCanvasElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const isInteracting = activePointIndex !== null;
  const isInteractingRef = useRef(isInteracting);
  isInteractingRef.current = isInteracting;

  // Refs for manual double-tap detection & live points during drag
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const hasSavedHistoryForSlider = useRef(false);

  // Visual configuration (aligned percentages so canvas histogram matches SVG plot area)
  const VIEW_SIZE = 240;
  const PADDING = 16; // 6.6667% inset
  const GRAPH_SIZE = VIEW_SIZE - PADDING * 2;

  const toViewX = (val: number) => PADDING + val * GRAPH_SIZE;
  const toViewY = (val: number) => VIEW_SIZE - PADDING - val * GRAPH_SIZE;
  const toDataX = (svgX: number) => (svgX - PADDING) / GRAPH_SIZE;
  const toDataY = (svgY: number) => (VIEW_SIZE - PADDING - svgY) / GRAPH_SIZE;

  const sortedPoints = useMemo(() => {
    return [...points].sort((a, b) => a.x - b.x);
  }, [points]);

  // Derived shadow & contrast values (-50..+50) for quick sliders & telemetry
  const toneMetrics = useMemo(() => estimateToneMetrics(sortedPoints), [sortedPoints]);
  const shadowsPct = Math.round(toneMetrics.shadows * 50);
  const contrastPct = Math.round(toneMetrics.contrast * 50);

  // Detect if current curve matches one of the 4 presets
  const activePresetId: CurvePresetId | null = useMemo(() => {
    for (const preset of CURVE_PRESETS) {
      if (preset.points.length !== sortedPoints.length) continue;
      const matches = preset.points.every(
        (pp, i) =>
          Math.abs(pp.x - sortedPoints[i].x) < 0.02 &&
          Math.abs(pp.y - sortedPoints[i].y) < 0.02
      );
      if (matches) return preset.id;
    }
    return null;
  }, [sortedPoints]);

  const pathData = useMemo(() => {
    const lut = getCurveLut(sortedPoints);
    let d = `M ${toViewX(0).toFixed(1)} ${toViewY(lut[0]).toFixed(1)}`;
    for (let i = 2; i < 256; i += 2) {
      const dataX = i / 255;
      const dataY = lut[i];
      d += ` L ${toViewX(dataX).toFixed(1)} ${toViewY(dataY).toFixed(1)}`;
    }
    d += ` L ${toViewX(1).toFixed(1)} ${toViewY(lut[255]).toFixed(1)}`;
    return d;
  }, [sortedPoints]);

  // Live Input Luminance Histogram inside the curve graph (~12fps)
  useEffect(() => {
    if (!videoRef) return;
    if (!sampleCanvasRef.current) {
      sampleCanvasRef.current = document.createElement('canvas');
      sampleCanvasRef.current.width = 48;
      sampleCanvasRef.current.height = 48;
    }

    const canvas = histCanvasRef.current;
    const sampleCanvas = sampleCanvasRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    const sCtx =
      sampleCanvas?.getContext('2d', { willReadFrequently: true }) ?? null;
    if (!canvas || !sampleCanvas || !ctx || !sCtx) return;

    let rafId = 0;
    let lastDraw = 0;

    const drawHistogram = (now: number) => {
      if (now - lastDraw >= 80) {
        lastDraw = now;
        const video = videoRef.current;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (video && video.readyState >= 2) {
          sCtx.drawImage(video, 0, 0, sampleCanvas.width, sampleCanvas.height);
          const data = sCtx.getImageData(
            0,
            0,
            sampleCanvas.width,
            sampleCanvas.height
          ).data;

          // 64 smooth bins for clean visual curve backdrop
          const bins = new Float32Array(64);
          let maxBin = 1;
          for (let i = 0; i < data.length; i += 4) {
            const gray = wr * data[i] + wg * data[i + 1] + wb * data[i + 2];
            const binIdx = Math.min(63, Math.floor((gray / 255) * 63));
            bins[binIdx] += 1;
            if (bins[binIdx] > maxBin) maxBin = bins[binIdx];
          }

          const w = canvas.width;
          const h = canvas.height;
          ctx.beginPath();
          ctx.moveTo(0, h);
          for (let b = 0; b < 64; b++) {
            const x = (b / 63) * w;
            const norm = Math.sqrt(bins[b] / maxBin);
            const y = h - norm * h * 0.85;
            ctx.lineTo(x, y);
          }
          ctx.lineTo(w, h);
          ctx.closePath();

          const interacting = isInteractingRef.current;
          ctx.fillStyle = interacting
            ? 'rgba(255, 255, 255, 0.08)'
            : 'rgba(255, 255, 255, 0.14)';
          ctx.fill();

          ctx.strokeStyle = interacting
            ? 'rgba(255, 255, 255, 0.16)'
            : 'rgba(255, 255, 255, 0.25)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      rafId = requestAnimationFrame(drawHistogram);
    };

    rafId = requestAnimationFrame(drawHistogram);
    return () => cancelAnimationFrame(rafId);
  }, [videoRef, wr, wg, wb]);

  const getPointerDataCoords = (e: React.PointerEvent | React.MouseEvent) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    const svgX = relX * VIEW_SIZE;
    const svgY = relY * VIEW_SIZE;
    return { x: toDataX(svgX), y: toDataY(svgY) };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);

    const coords = getPointerDataCoords(e);
    if (!coords) return;

    const now = Date.now();
    const THRESHOLD = 0.14;

    let isDoubleTap = false;
    if (lastTapRef.current) {
      const timeDiff = now - lastTapRef.current.time;
      const distDiff = Math.hypot(
        lastTapRef.current.x - coords.x,
        lastTapRef.current.y - coords.y
      );
      if (timeDiff < 320 && distDiff < 0.11) {
        isDoubleTap = true;
      }
    }
    lastTapRef.current = { time: now, x: coords.x, y: coords.y };

    // Find closest existing point
    let closestIndex = -1;
    let minDist = Infinity;
    sortedPoints.forEach((p, i) => {
      const dist = Math.hypot(p.x - coords.x, p.y - coords.y);
      if (dist < minDist) {
        minDist = dist;
        closestIndex = i;
      }
    });

    // Double-tap interior point deletes it; double-tap endpoint resets it to (0,0) or (1,1)
    if (isDoubleTap && closestIndex !== -1 && minDist < THRESHOLD) {
      onInteractionStart?.();
      if (closestIndex === 0) {
        const nextPoints = [...sortedPoints];
        nextPoints[0] = { x: 0, y: 0 };
        onChange(nextPoints);
      } else if (closestIndex === sortedPoints.length - 1) {
        const nextPoints = [...sortedPoints];
        nextPoints[nextPoints.length - 1] = { x: 1, y: 1 };
        onChange(nextPoints);
      } else {
        const nextPoints = sortedPoints.filter((_, i) => i !== closestIndex);
        onChange(nextPoints);
        setSelectedPointIndex(null);
      }
      setActivePointIndex(null);
      onInteractionStateChange?.(false);
      lastTapRef.current = null;
      triggerLightHaptic();
      return;
    }

    onInteractionStart?.();
    onInteractionStateChange?.(true);

    if (closestIndex !== -1 && minDist < THRESHOLD) {
      setActivePointIndex(closestIndex);
      setSelectedPointIndex(closestIndex);
      triggerLightHaptic();
    } else if (
      sortedPoints.length < MAX_POINTS &&
      coords.x >= -0.05 &&
      coords.x <= 1.05 &&
      coords.y >= -0.05 &&
      coords.y <= 1.05
    ) {
      // Clamp new interior X away from endpoints and existing points
      const clampedX = Math.max(0.04, Math.min(0.96, coords.x));
      const clampedY = Math.max(0, Math.min(1, coords.y));
      const tooClose = sortedPoints.some(p => Math.abs(p.x - clampedX) < 0.035);

      if (!tooClose) {
        const newPoint = { x: clampedX, y: clampedY };
        const nextPoints = [...sortedPoints, newPoint].sort((a, b) => a.x - b.x);
        const insertedIdx = nextPoints.findIndex(
          p => p.x === newPoint.x && p.y === newPoint.y
        );
        onChange(nextPoints);
        setActivePointIndex(insertedIdx);
        setSelectedPointIndex(insertedIdx);
        triggerLightHaptic();
      } else {
        onInteractionStateChange?.(false);
      }
    } else {
      onInteractionStateChange?.(false);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (activePointIndex === null) return;
    const coords = getPointerDataCoords(e);
    if (!coords) return;

    const isFirst = activePointIndex === 0;
    const isLast = activePointIndex === sortedPoints.length - 1;

    let x = Math.max(0, Math.min(1, coords.x));
    let y = Math.max(0, Math.min(1, coords.y));

    if (isFirst) {
      x = 0;
      y = Math.min(0.85, y);
    } else if (isLast) {
      x = 1;
      y = Math.max(0.15, y);
    } else {
      const minX = sortedPoints[activePointIndex - 1].x + 0.035;
      const maxX = sortedPoints[activePointIndex + 1].x - 0.035;
      x = Math.max(minX, Math.min(maxX, x));
    }

    const nextPoints = [...sortedPoints];
    nextPoints[activePointIndex] = { x, y };
    onChange(nextPoints);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if capture was not set
    }
    if (activePointIndex !== null) {
      setActivePointIndex(null);
    }
    onInteractionStateChange?.(false);
  };

  const handleRemoveSelectedPoint = useCallback(() => {
    if (
      selectedPointIndex === null ||
      selectedPointIndex <= 0 ||
      selectedPointIndex >= sortedPoints.length - 1
    ) {
      return;
    }
    onInteractionStart?.();
    const nextPoints = sortedPoints.filter((_, i) => i !== selectedPointIndex);
    onChange(nextPoints);
    setSelectedPointIndex(null);
    triggerLightHaptic();
  }, [selectedPointIndex, sortedPoints, onChange, onInteractionStart]);

  const handleSelectPreset = (presetPoints: Point[]) => {
    onInteractionStart?.();
    onChange(presetPoints.map(p => ({ ...p })));
    setSelectedPointIndex(null);
    triggerLightHaptic();
  };

  const handleQuickSliderChange = (nextShadows: number, nextContrast: number) => {
    if (!hasSavedHistoryForSlider.current) {
      onInteractionStart?.();
      hasSavedHistoryForSlider.current = true;
    }
    const nextPoints = buildToneCurveFromControls(nextShadows, nextContrast);
    onChange(nextPoints);
    setSelectedPointIndex(null);
  };

  const handleResetShadows = useDoubleTap(() => {
    onInteractionStart?.();
    onChange(buildToneCurveFromControls(0, toneMetrics.contrast));
    setSelectedPointIndex(null);
  });

  const handleResetContrast = useDoubleTap(() => {
    onInteractionStart?.();
    onChange(buildToneCurveFromControls(toneMetrics.shadows, 0));
    setSelectedPointIndex(null);
  });

  const activePoint =
    activePointIndex !== null
      ? sortedPoints[activePointIndex]
      : selectedPointIndex !== null
      ? sortedPoints[selectedPointIndex]
      : null;

  const canDeleteSelected =
    selectedPointIndex !== null &&
    selectedPointIndex > 0 &&
    selectedPointIndex < sortedPoints.length - 1;

  const neutral = isCurveNeutral(sortedPoints);

  return (
    <div
      className="w-full flex flex-col gap-3 select-none"
      onTouchStart={e => e.stopPropagation()}
      onTouchMove={e => e.stopPropagation()}
      onTouchEnd={e => e.stopPropagation()}
    >
      {/* 1. Preset bar (fades out during direct graph drag so viewfinder stays clear) */}
      <div
        className={`flex items-center gap-1.5 transition-opacity duration-200 ${
          isInteracting ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <div className="flex-1 grid grid-cols-4 gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
          {CURVE_PRESETS.map(preset => {
            const isSelected = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset.points)}
                className={`min-h-[34px] px-1.5 py-1.5 rounded-lg text-[10px] font-medium tracking-tight whitespace-nowrap truncate transition-all active:scale-95 ${
                  isSelected
                    ? 'bg-white text-black shadow-sm'
                    : 'text-zinc-300 hover:text-white hover:bg-white/5'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Interactive Graph Canvas + SVG */}
      <div className="w-full flex flex-col items-center">
        <div
          className={`w-full max-w-[260px] aspect-square relative select-none touch-none rounded-xl overflow-hidden transition-all duration-200 ${
            isInteracting
              ? 'bg-black/15 border border-white/20 shadow-none'
              : 'bg-zinc-950/85 border border-white/15 shadow-2xl'
          }`}
        >
          {/* Live Luminance Histogram aligned with SVG plot area */}
          <canvas
            ref={histCanvasRef}
            width={160}
            height={160}
            className="absolute pointer-events-none"
            style={{
              left: `${(PADDING / VIEW_SIZE) * 100}%`,
              top: `${(PADDING / VIEW_SIZE) * 100}%`,
              width: `${(GRAPH_SIZE / VIEW_SIZE) * 100}%`,
              height: `${(GRAPH_SIZE / VIEW_SIZE) * 100}%`,
            }}
          />

          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
            className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <defs>
              <linearGradient id="curveAreaGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="white" stopOpacity="0.24" />
                <stop offset="100%" stopColor="white" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Frame & 4x4 Tonal Grid */}
            <g
              stroke="rgba(255,255,255,0.10)"
              strokeWidth="1"
              className={`transition-opacity duration-200 ${
                isInteracting ? 'opacity-25' : 'opacity-100'
              }`}
            >
              <rect
                x={toViewX(0)}
                y={toViewY(1)}
                width={GRAPH_SIZE}
                height={GRAPH_SIZE}
                fill="none"
                stroke="rgba(255,255,255,0.16)"
              />
              {[0.25, 0.5, 0.75].map(t => (
                <React.Fragment key={`grid-${t}`}>
                  <line
                    x1={toViewX(t)}
                    y1={toViewY(0)}
                    x2={toViewX(t)}
                    y2={toViewY(1)}
                    strokeDasharray={t === 0.5 ? 'none' : '3 3'}
                  />
                  <line
                    x1={toViewX(0)}
                    y1={toViewY(t)}
                    x2={toViewX(1)}
                    y2={toViewY(t)}
                    strokeDasharray={t === 0.5 ? 'none' : '3 3'}
                  />
                </React.Fragment>
              ))}
            </g>

            {/* Diagonal Identity Line */}
            <line
              x1={toViewX(0)}
              y1={toViewY(0)}
              x2={toViewX(1)}
              y2={toViewY(1)}
              stroke="rgba(255,255,255,0.22)"
              strokeWidth="1"
              strokeDasharray="4 4"
              className={`pointer-events-none transition-opacity duration-200 ${
                isInteracting ? 'opacity-20' : 'opacity-100'
              }`}
            />

            {/* Area Under Curve */}
            <path
              d={`${pathData} L ${toViewX(1)} ${toViewY(0)} L ${toViewX(0)} ${toViewY(0)} Z`}
              fill="url(#curveAreaGradient)"
              className="pointer-events-none"
            />

            {/* Main Tone Curve Stroke */}
            <path
              d={pathData}
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]"
            />

            {/* Control Points with generous Android touch targets */}
            {sortedPoints.map((p, i) => {
              const isActive = activePointIndex === i;
              const isSelected = selectedPointIndex === i;
              const cx = toViewX(p.x);
              const cy = toViewY(p.y);
              return (
                <g key={i} transform={`translate(${cx}, ${cy})`}>
                  {/* Invisible 44px+ hit target */}
                  <circle r="20" fill="transparent" />
                  {(isActive || isSelected) && (
                    <circle
                      r={isActive ? 13 : 10}
                      fill="none"
                      stroke="#facc15"
                      strokeOpacity={isActive ? 0.55 : 0.4}
                      strokeWidth="1.5"
                    />
                  )}
                  <circle
                    r={isActive ? 6.5 : isSelected ? 5.5 : 4.5}
                    fill={isActive || isSelected ? '#facc15' : '#ffffff'}
                    stroke="#09090b"
                    strokeWidth="2"
                  />
                </g>
              );
            })}
          </svg>

          {/* Subtle Tonal Zone Labels along bottom axis */}
          <div
            className={`absolute bottom-1 inset-x-4 flex justify-between text-[9px] font-mono text-zinc-400 pointer-events-none transition-opacity duration-200 ${
              isInteracting ? 'opacity-0' : 'opacity-80'
            }`}
          >
            <span>{t.shadows}</span>
            <span>{t.midtonesShort}</span>
            <span>{t.highlights}</span>
          </div>

          {/* Live Coordinate Readout while dragging/selecting */}
          {activePoint && (
            <div className="absolute top-2 left-2.5 px-2 py-0.5 rounded bg-black/70 border border-white/10 text-[10px] font-mono tabular-nums text-zinc-200 pointer-events-none">
              {t.inputShort} {Math.round(activePoint.x * 255)} · {t.outputShort}{' '}
              {Math.round(activePoint.y * 255)}
            </div>
          )}
        </div>
      </div>

      {/* 3. Contextual Point Actions & Telemetry Row */}
      <div
        className={`flex items-center justify-between text-[11px] font-mono tabular-nums px-1 transition-opacity duration-200 ${
          isInteracting ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <div className="flex items-center gap-3 text-zinc-400">
          <span>
            {t.shadows}{' '}
            <strong className="text-white font-semibold">
              {shadowsPct > 0 ? `+${shadowsPct}` : shadowsPct}
            </strong>
          </span>
          <span aria-hidden="true" className="text-zinc-600">
            ·
          </span>
          <span>
            {t.curveContrast}{' '}
            <strong className="text-white font-semibold">
              {contrastPct > 0 ? `+${contrastPct}` : contrastPct}
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {canDeleteSelected ? (
            <button
              type="button"
              onClick={handleRemoveSelectedPoint}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-500/15 border border-red-500/30 text-red-300 text-[10px] font-sans font-medium active:scale-95 transition-transform"
            >
              <Trash2 size={12} />
              <span>{t.removePoint}</span>
            </button>
          ) : !neutral ? (
            <button
              type="button"
              onClick={() => handleSelectPreset(CURVE_PRESETS[0].points)}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-zinc-400 hover:text-white text-[10px] font-sans active:scale-95 transition-transform"
            >
              <RotateCcw size={11} />
              <span>{t.resetCurve}</span>
            </button>
          ) : (
            <span className="text-[10px] font-sans text-zinc-500">
              {t.tapGraphHint}
            </span>
          )}
        </div>
      </div>

      {/* 4. Quick Real-Time Sombras & Contraste Curve Sliders */}
      <div
        className={`grid grid-cols-2 gap-4 pt-1 border-t border-white/10 transition-opacity duration-200 ${
          isInteracting ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        {/* Sombras slider — double-tap resets to 0 */}
        <div className="flex flex-col gap-1.5">
          <div
            onPointerUp={handleResetShadows}
            title={t.resetDefaultHint}
            className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider cursor-pointer"
          >
            <span className="text-zinc-400">{t.shadows}</span>
            <span className="text-white tabular-nums">
              {shadowsPct > 0 ? `+${shadowsPct}` : shadowsPct}
            </span>
          </div>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.04}
            value={toneMetrics.shadows}
            onPointerDown={() => {
              hasSavedHistoryForSlider.current = false;
            }}
            onPointerUp={e => {
              hasSavedHistoryForSlider.current = false;
              handleResetShadows(e);
            }}
            onChange={e =>
              handleQuickSliderChange(
                parseFloat(e.target.value),
                toneMetrics.contrast
              )
            }
            className="w-full h-2 bg-white/15 rounded-full appearance-none cursor-pointer range-thumb-style"
            aria-label={t.shadows}
          />
        </div>

        {/* Contraste slider — double-tap resets to 0 */}
        <div className="flex flex-col gap-1.5">
          <div
            onPointerUp={handleResetContrast}
            title={t.resetDefaultHint}
            className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider cursor-pointer"
          >
            <span className="text-zinc-400">{t.curveContrast}</span>
            <span className="text-white tabular-nums">
              {contrastPct > 0 ? `+${contrastPct}` : contrastPct}
            </span>
          </div>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.04}
            value={toneMetrics.contrast}
            onPointerDown={() => {
              hasSavedHistoryForSlider.current = false;
            }}
            onPointerUp={e => {
              hasSavedHistoryForSlider.current = false;
              handleResetContrast(e);
            }}
            onChange={e =>
              handleQuickSliderChange(
                toneMetrics.shadows,
                parseFloat(e.target.value)
              )
            }
            className="w-full h-2 bg-white/15 rounded-full appearance-none cursor-pointer range-thumb-style"
            aria-label="Ajustar contraste na curva"
          />
        </div>
      </div>
    </div>
  );
};

export default CurvesControl;
