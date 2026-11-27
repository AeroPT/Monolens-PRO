import { useRef, useState, useCallback, useEffect } from 'react';

interface UseObjectTrackerOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onTrack?: (xPercent: number, yPercent: number, confidence: number) => void;
  onLost?: () => void;
}

/**
 * Real-time lightweight visual object tracking for Google Pixel style camera focus.
 * Uses luminance template matching on an offscreen canvas with Rec.709 perceived luminance.
 */
export function useObjectTracker({
  videoRef,
  containerRef,
  onTrack,
  onLost,
}: UseObjectTrackerOptions) {
  const [isTracking, setIsTracking] = useState(false);
  const isTrackingRef = useRef(false);

  // Template data (20x20 luminance buffer)
  const templateRef = useRef<Uint8Array | null>(null);
  // Current center position in video pixel coordinates
  const currentPosRef = useRef<{ vX: number; vY: number } | null>(null);
  const lostFramesRef = useRef(0);
  const animFrameIdRef = useRef<number | null>(null);

  // Reusable offscreen canvases to avoid allocation overhead during video render loop
  const canvasesRef = useRef<{
    templateCanvas: HTMLCanvasElement;
    templateCtx: CanvasRenderingContext2D;
    searchCanvas: HTMLCanvasElement;
    searchCtx: CanvasRenderingContext2D;
  } | null>(null);

  const initCanvases = useCallback(() => {
    if (canvasesRef.current) return canvasesRef.current;

    const templateCanvas = document.createElement('canvas');
    templateCanvas.width = 20;
    templateCanvas.height = 20;
    const templateCtx = templateCanvas.getContext('2d', {
      willReadFrequently: true,
    })!;

    const searchCanvas = document.createElement('canvas');
    searchCanvas.width = 64;
    searchCanvas.height = 64;
    const searchCtx = searchCanvas.getContext('2d', {
      willReadFrequently: true,
    })!;

    canvasesRef.current = {
      templateCanvas,
      templateCtx,
      searchCanvas,
      searchCtx,
    };
    return canvasesRef.current;
  }, []);

  const stopTracking = useCallback(() => {
    isTrackingRef.current = false;
    setIsTracking(false);
    templateRef.current = null;
    currentPosRef.current = null;
    lostFramesRef.current = 0;
    if (animFrameIdRef.current !== null) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
  }, []);

  const startTracking = useCallback(
    (xPercent: number, yPercent: number) => {
      const video = videoRef.current;
      const container = containerRef.current;
      if (!video || !container || video.readyState < 2) return;

      const vW = video.videoWidth;
      const vH = video.videoHeight;
      const cW = container.clientWidth;
      const cH = container.clientHeight;
      if (!vW || !vH || !cW || !cH) return;

      // Coordinate mapping taking object-fit: cover into account
      const scale = Math.max(cW / vW, cH / vH);
      const renderedW = vW * scale;
      const renderedH = vH * scale;
      const offsetX = (cW - renderedW) / 2;
      const offsetY = (cH - renderedH) / 2;

      const cX = (xPercent / 100) * cW;
      const cY = (yPercent / 100) * cH;
      const vX = (cX - offsetX) / scale;
      const vY = (cY - offsetY) / scale;

      // Clamp target within video bounds (leaving 12px margin for template extraction)
      const clampedVx = Math.max(12, Math.min(vW - 12, vX));
      const clampedVy = Math.max(12, Math.min(vH - 12, vY));

      const { templateCtx } = initCanvases();

      // Sample 20x20 template patch centered at tap point
      templateCtx.drawImage(
        video,
        Math.round(clampedVx - 10),
        Math.round(clampedVy - 10),
        20,
        20,
        0,
        0,
        20,
        20
      );

      const imgData = templateCtx.getImageData(0, 0, 20, 20).data;
      const template = new Uint8Array(400);
      for (let i = 0, j = 0; i < imgData.length; i += 4, j++) {
        template[j] = Math.round(
          0.2126 * imgData[i] + 0.7152 * imgData[i + 1] + 0.0722 * imgData[i + 2]
        );
      }

      templateRef.current = template;
      currentPosRef.current = { vX: clampedVx, vY: clampedVy };
      lostFramesRef.current = 0;
      isTrackingRef.current = true;
      setIsTracking(true);
    },
    [videoRef, containerRef, initCanvases]
  );

  // Tracking processing loop
  useEffect(() => {
    if (!isTracking) return;

    let lastTimestamp = 0;
    const TARGET_INTERVAL_MS = 28; // ~35 FPS: fast, silky-smooth tracking with minimal battery impact

    const tick = (now: number) => {
      if (!isTrackingRef.current) return;

      if (now - lastTimestamp >= TARGET_INTERVAL_MS) {
        lastTimestamp = now;

        const video = videoRef.current;
        const container = containerRef.current;
        const template = templateRef.current;
        const currentPos = currentPosRef.current;

        if (
          video &&
          container &&
          template &&
          currentPos &&
          video.readyState >= 2 &&
          canvasesRef.current
        ) {
          const vW = video.videoWidth;
          const vH = video.videoHeight;
          const cW = container.clientWidth;
          const cH = container.clientHeight;

          if (vW > 0 && vH > 0 && cW > 0 && cH > 0) {
            const { searchCtx } = canvasesRef.current;
            const { vX, vY } = currentPos;

            // Search window (64x64 pixels around last position)
            const sx = Math.max(0, Math.min(vW - 64, Math.round(vX - 32)));
            const sy = Math.max(0, Math.min(vH - 64, Math.round(vY - 32)));

            searchCtx.drawImage(video, sx, sy, 64, 64, 0, 0, 64, 64);
            const sData = searchCtx.getImageData(0, 0, 64, 64).data;

            const searchLuma = new Uint8Array(4096);
            for (let i = 0, j = 0; i < sData.length; i += 4, j++) {
              searchLuma[j] = Math.round(
                0.2126 * sData[i] + 0.7152 * sData[i + 1] + 0.0722 * sData[i + 2]
              );
            }

            // Coarse search (step = 2) for minimum Sum of Absolute Differences (SAD)
            const maxOffset = 44; // 64 - 20
            let bestSAD = Infinity;
            let bestDx = 12;
            let bestDy = 12;

            for (let dy = 0; dy <= maxOffset; dy += 2) {
              for (let dx = 0; dx <= maxOffset; dx += 2) {
                let sad = 0;
                for (let ty = 0; ty < 20; ty += 2) {
                  const sRow = (dy + ty) * 64;
                  const tRow = ty * 20;
                  for (let tx = 0; tx < 20; tx += 2) {
                    const diff = searchLuma[sRow + dx + tx] - template[tRow + tx];
                    sad += diff < 0 ? -diff : diff;
                  }
                  if (sad >= bestSAD) break;
                }
                if (sad < bestSAD) {
                  bestSAD = sad;
                  bestDx = dx;
                  bestDy = dy;
                }
              }
            }

            // Fine refinement (step = 1) in local neighborhood of best coarse match
            const rMinX = Math.max(0, bestDx - 2);
            const rMaxX = Math.min(maxOffset, bestDx + 2);
            const rMinY = Math.max(0, bestDy - 2);
            const rMaxY = Math.min(maxOffset, bestDy + 2);
            let refinedSAD = Infinity;
            let refDx = bestDx;
            let refDy = bestDy;

            for (let dy = rMinY; dy <= rMaxY; dy++) {
              for (let dx = rMinX; dx <= rMaxX; dx++) {
                let sad = 0;
                for (let ty = 0; ty < 20; ty++) {
                  const sRow = (dy + ty) * 64;
                  const tRow = ty * 20;
                  for (let tx = 0; tx < 20; tx++) {
                    const diff = searchLuma[sRow + dx + tx] - template[tRow + tx];
                    sad += diff < 0 ? -diff : diff;
                  }
                  if (sad >= refinedSAD) break;
                }
                if (sad < refinedSAD) {
                  refinedSAD = sad;
                  refDx = dx;
                  refDy = dy;
                }
              }
            }

            const avgError = refinedSAD / 400;

            // Match confidence threshold check
            if (avgError > 60) {
              lostFramesRef.current++;
              if (lostFramesRef.current > 35) {
                // Lost tracking for over ~1s, stop tracking
                stopTracking();
                onLost?.();
                return;
              }
            } else {
              lostFramesRef.current = Math.max(0, lostFramesRef.current - 1);

              // Detected target center in video pixels
              const targetVx = sx + refDx + 10;
              const targetVy = sy + refDy + 10;

              // Smooth lerp movement (Google Pixel style fluid motion)
              const lerp = 0.55;
              const newVx = vX + (targetVx - vX) * lerp;
              const newVy = vY + (targetVy - vY) * lerp;
              currentPosRef.current = { vX: newVx, vY: newVy };

              // Slightly adapt template when confidence is high to follow rotations & soft lighting
              if (avgError < 28) {
                for (let ty = 0; ty < 20; ty++) {
                  const sRow = (refDy + ty) * 64;
                  const tRow = ty * 20;
                  for (let tx = 0; tx < 20; tx++) {
                    template[tRow + tx] = Math.round(
                      template[tRow + tx] * 0.94 + searchLuma[sRow + refDx + tx] * 0.06
                    );
                  }
                }
              }

              // Transform back to container percentage
              const scale = Math.max(cW / vW, cH / vH);
              const renderedW = vW * scale;
              const renderedH = vH * scale;
              const offsetX = (cW - renderedW) / 2;
              const offsetY = (cH - renderedH) / 2;

              const cX = newVx * scale + offsetX;
              const cY = newVy * scale + offsetY;
              const xPercent = Math.max(3, Math.min(97, (cX / cW) * 100));
              const yPercent = Math.max(3, Math.min(97, (cY / cH) * 100));

              const confidence = Math.max(0, Math.min(1, 1 - avgError / 60));
              onTrack?.(xPercent, yPercent, confidence);
            }
          }
        }
      }

      if (isTrackingRef.current) {
        animFrameIdRef.current = requestAnimationFrame(tick);
      }
    };

    animFrameIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
    };
  }, [isTracking, videoRef, containerRef, onTrack, onLost, stopTracking]);

  return {
    isTracking,
    startTracking,
    stopTracking,
  };
}
