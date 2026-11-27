import React, { memo, useEffect, useRef, useState } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

interface HorizontalLevelProps {
  enabled: boolean;
  visible: boolean;
}

interface LevelReading {
  tiltDeg: number;
  hasSensor: boolean;
  isFlat: boolean;
}

const LEVEL_THRESHOLD_DEG = 0.6;
const SMOOTH_ALPHA = 0.2;

const HorizontalLevel: React.FC<HorizontalLevelProps> = ({ enabled, visible }) => {
  const [reading, setReading] = useState<LevelReading>({
    tiltDeg: 0,
    hasSensor: false,
    isFlat: false,
  });

  const gravRef = useRef<{ x: number; y: number; z: number; init: boolean }>({
    x: 0,
    y: 9.81,
    z: 0,
    init: false,
  });
  const hasMotionRef = useRef(false);
  const wasLevelRef = useRef(false);
  const lastHapticAtRef = useRef(0);
  const latestRef = useRef<LevelReading>({
    tiltDeg: 0,
    hasSensor: false,
    isFlat: false,
  });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      hasMotionRef.current = false;
      gravRef.current.init = false;
      wasLevelRef.current = false;
      setReading({ tiltDeg: 0, hasSensor: false, isFlat: false });
      return;
    }

    let dirty = false;

    const scheduleCommit = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (!dirty) return;
        dirty = false;
        const next = latestRef.current;
        setReading(prev => {
          if (
            prev.hasSensor === next.hasSensor &&
            prev.isFlat === next.isFlat &&
            Math.abs(prev.tiltDeg - next.tiltDeg) < 0.05
          ) {
            return prev;
          }
          return next;
        });
      });
    };

    const handleDeviceMotion = (e: DeviceMotionEvent) => {
      const ag = e.accelerationIncludingGravity;
      if (!ag || ag.x === null || ag.y === null || ag.z === null) return;

      hasMotionRef.current = true;

      const g = gravRef.current;
      if (!g.init) {
        g.x = ag.x;
        g.y = ag.y;
        g.z = ag.z;
        g.init = true;
      } else {
        g.x += SMOOTH_ALPHA * (ag.x - g.x);
        g.y += SMOOTH_ALPHA * (ag.y - g.y);
        g.z += SMOOTH_ALPHA * (ag.z - g.z);
      }

      const planeMag = Math.hypot(g.x, g.y);
      if (planeMag < 1.8) {
        latestRef.current = { tiltDeg: 0, hasSensor: true, isFlat: true };
        wasLevelRef.current = false;
        dirty = true;
        scheduleCommit();
        return;
      }

      // Snap to nearest 90° horizon so portrait and landscape both align accurately
      const rawDeg = (Math.atan2(g.x, g.y) * 180) / Math.PI;
      const nearestCardinal = Math.round(rawDeg / 90) * 90;
      const tiltDeg = rawDeg - nearestCardinal;

      const nowLevel = Math.abs(tiltDeg) <= LEVEL_THRESHOLD_DEG;
      if (nowLevel && !wasLevelRef.current) {
        const now = Date.now();
        if (now - lastHapticAtRef.current > 400) {
          lastHapticAtRef.current = now;
          try {
            Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
          } catch {
            // Ignore on browser
          }
        }
      }
      wasLevelRef.current = nowLevel;

      latestRef.current = {
        tiltDeg,
        hasSensor: true,
        isFlat: false,
      };
      dirty = true;
      scheduleCommit();
    };

    // Fallback for devices/browsers emitting only deviceorientation
    const handleDeviceOrientation = (e: DeviceOrientationEvent) => {
      if (hasMotionRef.current) return;
      if (e.gamma === null || e.beta === null) return;

      const isFlat = Math.abs(e.beta) < 12 && Math.abs(e.gamma) < 12;
      if (isFlat) {
        latestRef.current = { tiltDeg: 0, hasSensor: true, isFlat: true };
        dirty = true;
        scheduleCommit();
        return;
      }

      const clamped = Math.max(-45, Math.min(45, -e.gamma));
      latestRef.current = {
        tiltDeg: clamped,
        hasSensor: true,
        isFlat: false,
      };
      dirty = true;
      scheduleCommit();
    };

    window.addEventListener('devicemotion', handleDeviceMotion);
    window.addEventListener('deviceorientation', handleDeviceOrientation);

    return () => {
      window.removeEventListener('devicemotion', handleDeviceMotion);
      window.removeEventListener('deviceorientation', handleDeviceOrientation);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [enabled]);

  if (!enabled) return null;

  const isLevel =
    reading.hasSensor &&
    !reading.isFlat &&
    Math.abs(reading.tiltDeg) <= LEVEL_THRESHOLD_DEG;

  const displayAngle = isLevel ? 0 : reading.tiltDeg;
  const formattedAngle = isLevel
    ? '0°'
    : `${Math.abs(reading.tiltDeg).toFixed(1)}°`;

  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 z-10 pointer-events-none flex items-center justify-center transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="relative flex flex-col items-center justify-center">
        {/* Horizon Level Bar + Fixed Outer Reference Ticks */}
        <div className="relative w-52 h-8 flex items-center justify-center">
          {/* Left fixed horizon tick */}
          <div
            className={`absolute left-0 w-6 h-[2px] rounded-full transition-colors duration-150 ${
              isLevel
                ? 'bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.9)]'
                : 'bg-white/40 shadow-[0_0_4px_rgba(0,0,0,0.8)]'
            }`}
          />

          {/* Right fixed horizon tick */}
          <div
            className={`absolute right-0 w-6 h-[2px] rounded-full transition-colors duration-150 ${
              isLevel
                ? 'bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.9)]'
                : 'bg-white/40 shadow-[0_0_4px_rgba(0,0,0,0.8)]'
            }`}
          />

          {/* Rotating Center Horizon Line */}
          {!reading.hasSensor || reading.isFlat ? (
            <div className="w-24 h-[1.5px] rounded-full bg-white/25 shadow-[0_0_4px_rgba(0,0,0,0.7)]" />
          ) : (
            <div
              className={`w-32 h-[2px] rounded-full transition-colors duration-150 flex items-center justify-center ${
                isLevel
                  ? 'bg-green-400 shadow-[0_0_14px_rgba(34,197,94,0.95)]'
                  : 'bg-white/95 shadow-[0_0_8px_rgba(0,0,0,0.85)]'
              }`}
              style={{
                transform: `rotate(${displayAngle.toFixed(2)}deg)`,
              }}
            >
              {/* Tiny center pivot dot */}
              <div
                className={`w-1.5 h-1.5 rounded-full transition-colors duration-150 ${
                  isLevel ? 'bg-green-300' : 'bg-white'
                }`}
              />
            </div>
          )}
        </div>

        {/* Numeric Angle Readout */}
        {reading.hasSensor && !reading.isFlat && (
          <div
            className={`mt-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold tabular-nums tracking-wider backdrop-blur-md border transition-colors duration-150 ${
              isLevel
                ? 'bg-green-950/70 border-green-400/60 text-green-400 shadow-[0_0_12px_rgba(34,197,94,0.35)]'
                : 'bg-black/50 border-white/15 text-white/85'
            }`}
          >
            {formattedAngle}
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(HorizontalLevel);
