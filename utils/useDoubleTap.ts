import { useRef, useCallback } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

interface TapRecord {
  time: number;
  x: number;
  y: number;
}

const triggerResetHaptic = () => {
  try {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  } catch {
    // Ignore on web
  }
};

/**
 * Reliable double-tap / double-click detector for both Android touch WebView
 * and desktop pointers (works even on <input type="range"> where ondblclick can be swallowed).
 */
export const useDoubleTap = (onDoubleTap: () => void, delayMs = 320) => {
  const lastTapRef = useRef<TapRecord | null>(null);

  const handlePointerUp = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const now = Date.now();
      const prev = lastTapRef.current;

      if (
        prev &&
        now - prev.time <= delayMs &&
        Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 28
      ) {
        lastTapRef.current = null;
        triggerResetHaptic();
        onDoubleTap();
        return;
      }

      lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
    },
    [onDoubleTap, delayMs]
  );

  return handlePointerUp;
};
