import { useState, useEffect, useCallback, useRef } from 'react';
import { CameraDevice, CaptureMode } from '../types';
import {
  ProCapture,
  isProCaptureSupported,
  inferLensHint,
} from '../utils/proCapture';

export type FocusMode = 'continuous' | 'single-shot';
export type CameraErrorCode = 'PERMISSION_DENIED' | 'LENS_ERROR';

const STORAGE_ACTIVE_DEVICE_KEY = 'monolens_active_device_v1';

export interface CapabilityRange {
  min: number;
  max: number;
  step: number;
}

/**
 * Formats W3C ImageCapture exposureTime (units of 100 microseconds = 0.1ms)
 * into standard photographic shutter speed strings (e.g., "1/1000s", "1/60s", "0.5s").
 */
export const formatExposureTime = (units100us: number): string => {
  const seconds = Math.max(0.0001, units100us * 0.0001);
  if (seconds >= 0.95) {
    return `${seconds.toFixed(1)}s`;
  }
  if (seconds >= 0.35) {
    return `${seconds.toFixed(2).replace(/\.00$/, '')}s`;
  }
  const denom = Math.max(1, Math.round(1 / seconds));
  return `1/${denom}s`;
};

const requestCameraStream = async (
  deviceId: string,
  profile: '4k' | '1440p'
): Promise<MediaStream> => {
  const candidates: MediaTrackConstraints[] =
    profile === '4k'
      ? [
          {
            deviceId: { exact: deviceId },
            width: { ideal: 4032 },
            height: { ideal: 3024 },
            frameRate: { ideal: 30 },
          },
          {
            deviceId: { exact: deviceId },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
            frameRate: { ideal: 30 },
          },
          {
            deviceId: { exact: deviceId },
            width: { ideal: 1920 },
            height: { ideal: 1440 },
          },
        ]
      : [
          {
            deviceId: { exact: deviceId },
            width: { ideal: 1920 },
            height: { ideal: 1440 },
            frameRate: { ideal: 30 },
          },
          {
            deviceId: { exact: deviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
          { deviceId: { exact: deviceId } },
        ];

  let lastErr: unknown;
  for (const video of candidates) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
};

export const useCamera = (
  captureMode: CaptureMode = 'fast',
  suppressWebStream = false
) => {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_ACTIVE_DEVICE_KEY);
    } catch {
      return null;
    }
  });
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<CameraErrorCode | null>(null);
  const [supportsFocus, setSupportsFocus] = useState(false);
  const [supportedFocusModes, setSupportedFocusModes] = useState<string[]>([]);
  const [focusMode, setFocusModeState] = useState<FocusMode>('continuous');

  const [focusDistance, setFocusDistanceState] = useState<number>(0);
  const [focusDistanceRange, setFocusDistanceRange] = useState<CapabilityRange>({
    min: 0,
    max: 0,
    step: 0,
  });
  const [supportsManualFocus, setSupportsManualFocus] = useState(false);

  const devicesRef = useRef<CameraDevice[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const isLockingRef = useRef<boolean>(false);
  const focusRangeRef = useRef<CapabilityRange>({ min: 0, max: 0, step: 0 });
  const supportsFocusRef = useRef(false);
  const supportedFocusModesRef = useRef<string[]>([]);
  const focusModeRef = useRef<FocusMode>('continuous');
  const zoomRangeRef = useRef({ min: 1, max: 1 });
  const webZoomRangeRef = useRef({ min: 1, max: 1 });
  const supportsNativeZoomRef = useRef(false);
  const supportsExposureRef = useRef(false);
  const zoomRef = useRef(1);
  const lastDeviceIdForStreamRef = useRef<string | null>(null);
  const suppressWebStreamRef = useRef(suppressWebStream);
  suppressWebStreamRef.current = suppressWebStream;

  const [zoom, setZoomState] = useState(1);
  const [zoomRange, setZoomRange] = useState({ min: 1, max: 1 });
  const [supportsNativeZoom, setSupportsNativeZoom] = useState(false);
  const [supportsWebUltraWide, setSupportsWebUltraWide] = useState(false);
  const [nativeTeleZoom, setNativeTeleZoom] = useState<number | null>(null);

  const [exposureRange, setExposureRange] = useState<CapabilityRange>({
    min: -2,
    max: 2,
    step: 0.1,
  });
  const [supportsExposure, setSupportsExposure] = useState(false);

  const [supportedExposureModes, setSupportedExposureModes] = useState<string[]>([]);
  const [supportsExposureTime, setSupportsExposureTime] = useState(false);
  const [exposureTimeRange, setExposureTimeRange] = useState<CapabilityRange>({
    min: 3, // 1/3333s (0.3ms)
    max: 5000, // 1/2s (500ms)
    step: 1,
  });
  const [currentExposureTime, setCurrentExposureTime] = useState<number>(80);

  const [isoRange, setIsoRange] = useState<CapabilityRange>({
    min: 50,
    max: 3200,
    step: 10,
  });
  const [supportsIso, setSupportsIso] = useState(false);
  const [currentIso, setCurrentIso] = useState<number>(200);

  const [reloadNonce, setReloadNonce] = useState(0);
  const [streamRestartNonce, setStreamRestartNonce] = useState(0);
  const streamProfileKey = captureMode === 'stream4k' ? '4k' : '1440p';

  const retryCamera = useCallback(() => {
    setError(null);
    setReloadNonce(n => n + 1);
  }, []);

  useEffect(() => {
    let isMounted = true;
    const getDevices = async () => {
      try {
        let allDevices = await navigator.mediaDevices.enumerateDevices();
        let videoDevices = allDevices.filter(d => d.kind === 'videoinput');

        // Only open a probe stream if permission/labels aren't available yet
        if (videoDevices.length === 0 || videoDevices.some(d => !d.label)) {
          const initialStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
          });
          initialStream.getTracks().forEach(track => track.stop());
          if (!isMounted) return;
          allDevices = await navigator.mediaDevices.enumerateDevices();
          videoDevices = allDevices.filter(d => d.kind === 'videoinput');
        }

        if (!isMounted) return;
        const formattedDevices: CameraDevice[] = videoDevices.map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${device.deviceId.slice(0, 5)}`,
        }));
        devicesRef.current = formattedDevices;
        setDevices(formattedDevices);
        if (formattedDevices.length > 0) {
          setActiveDeviceId(prev => {
            if (prev && formattedDevices.find(d => d.deviceId === prev)) {
              return prev;
            }
            const backCamera = formattedDevices.find(d => {
              const l = d.label.toLowerCase();
              return (
                l.includes('back') ||
                l.includes('traseira') ||
                l.includes('environment') ||
                l.includes('camera2 0')
              );
            });
            const chosen = backCamera ? backCamera.deviceId : formattedDevices[0].deviceId;
            try {
              localStorage.setItem(STORAGE_ACTIVE_DEVICE_KEY, chosen);
            } catch {
              // Ignore
            }
            return chosen;
          });
        }
      } catch {
        if (isMounted) setError('PERMISSION_DENIED');
      }
    };
    getDevices();
    return () => {
      isMounted = false;
    };
  }, [reloadNonce]);

  useEffect(() => {
    if (!activeDeviceId) return;
    if (suppressWebStreamRef.current) return;
    let isMounted = true;
    const startStream = async () => {
      const hadActiveStream = !!streamRef.current;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setStream(null);
      setError(null);

      const isSameDeviceRestart =
        lastDeviceIdForStreamRef.current === activeDeviceId;
      lastDeviceIdForStreamRef.current = activeDeviceId;
      const preservedZoom = isSameDeviceRestart ? zoomRef.current : 1;

      // Reset capabilities state (preserve optical zoom & tele cap on same-device restart)
      isLockingRef.current = false;
      supportsFocusRef.current = false;
      supportedFocusModesRef.current = [];
      supportsNativeZoomRef.current = false;
      supportsExposureRef.current = false;
      if (!isSameDeviceRestart) {
        zoomRangeRef.current = { min: 1, max: 1 };
        webZoomRangeRef.current = { min: 1, max: 1 };
        setZoomRange({ min: 1, max: 1 });
        setNativeTeleZoom(null);
        zoomRef.current = 1;
        setZoomState(1);
      }
      setSupportsFocus(false);
      setSupportedFocusModes([]);
      setSupportsManualFocus(false);
      setSupportsNativeZoom(false);
      setSupportsWebUltraWide(false);
      setSupportsExposure(false);
      setSupportedExposureModes([]);
      setSupportsExposureTime(false);
      setSupportsIso(false);
      setExposureTimeRange({ min: 3, max: 5000, step: 1 });
      setIsoRange({ min: 50, max: 3200, step: 10 });

      // Only pause briefly to let Android Camera2 release an active session
      if (hadActiveStream) {
        await new Promise(resolve => setTimeout(resolve, 180));
        if (!isMounted) return;
      }

      try {
        const newStream = await requestCameraStream(activeDeviceId, streamProfileKey);

        if (!isMounted) {
          newStream.getTracks().forEach(track => track.stop());
          return;
        }

        streamRef.current = newStream;
        setStream(newStream);
        const track = newStream.getVideoTracks()[0];
        const caps = (
          track.getCapabilities ? track.getCapabilities() : {}
        ) as Record<string, any>;
        const trackSettings = (
          track.getSettings ? track.getSettings() : {}
        ) as Record<string, any>;

        const initialConstraints: Record<string, unknown> = {};

        if (caps.focusMode) {
          supportsFocusRef.current = true;
          supportedFocusModesRef.current = caps.focusMode;
          setSupportsFocus(true);
          setSupportedFocusModes(caps.focusMode);
          if (caps.focusMode.includes('continuous')) {
            initialConstraints.focusMode = 'continuous';
            focusModeRef.current = 'continuous';
            setFocusModeState('continuous');
          }
        }

        if (caps.focusDistance) {
          const range = {
            min: caps.focusDistance.min,
            max: caps.focusDistance.max,
            step: caps.focusDistance.step || 0.01,
          };
          focusRangeRef.current = range;
          setSupportsManualFocus(true);
          setFocusDistanceRange(range);
          setFocusDistanceState(
            trackSettings.focusDistance ?? caps.focusDistance.min
          );
        } else {
          focusRangeRef.current = { min: 0, max: 0, step: 0 };
        }

        let webRange = { min: 1, max: 4 };
        if (caps.zoom) {
          webRange = { min: caps.zoom.min, max: caps.zoom.max };
          supportsNativeZoomRef.current = true;
          webZoomRangeRef.current = webRange;
          zoomRangeRef.current = {
            min: isSameDeviceRestart
              ? Math.min(zoomRangeRef.current.min, webRange.min)
              : webRange.min,
            max: isSameDeviceRestart
              ? Math.max(zoomRangeRef.current.max, webRange.max)
              : webRange.max,
          };
          setSupportsNativeZoom(true);
          setSupportsWebUltraWide(caps.zoom.min < 0.95);
          setZoomRange(zoomRangeRef.current);
          const targetZoom = isSameDeviceRestart
            ? Math.min(
                zoomRangeRef.current.max,
                Math.max(zoomRangeRef.current.min, preservedZoom)
              )
            : typeof trackSettings.zoom === 'number'
            ? trackSettings.zoom
            : Math.min(webRange.max, Math.max(webRange.min, 1));
          zoomRef.current = targetZoom;
          setZoomState(targetZoom);
          const webClamped = Math.min(webRange.max, Math.max(webRange.min, targetZoom));
          if (Math.abs(webClamped - (trackSettings.zoom ?? 1)) > 0.01) {
            initialConstraints.zoom = webClamped;
          }
        } else {
          webZoomRangeRef.current = webRange;
          if (!isSameDeviceRestart) {
            zoomRangeRef.current = webRange;
            setZoomRange(webRange);
          }
          setSupportsWebUltraWide(false);
        }

        if (isProCaptureSupported()) {
          const activeDev = devicesRef.current.find(d => d.deviceId === activeDeviceId);
          const devLabel = activeDev?.label || '';
          const lensHint = inferLensHint(devLabel);
          if (lensHint !== 'front') {
            ProCapture.getCapabilities({ deviceLabel: devLabel, lensHint })
              .then(nativeCaps => {
                if (!isMounted) return;
                const nativeMin =
                  typeof nativeCaps.minZoom === 'number' && nativeCaps.minZoom > 0.2
                    ? nativeCaps.minZoom
                    : webRange.min;
                const nativeMax =
                  typeof nativeCaps.maxZoom === 'number' && nativeCaps.maxZoom > 1
                    ? nativeCaps.maxZoom
                    : webRange.max;
                const mergedRange = {
                  min: Math.min(webRange.min, nativeMin),
                  max: Math.max(webRange.max, nativeMax),
                };
                if (
                  mergedRange.min < zoomRangeRef.current.min ||
                  mergedRange.max > zoomRangeRef.current.max
                ) {
                  zoomRangeRef.current = mergedRange;
                  setZoomRange(mergedRange);
                }
                if (
                  typeof nativeCaps.physicalTeleZoom === 'number' &&
                  nativeCaps.physicalTeleZoom > 2.2
                ) {
                  setNativeTeleZoom(nativeCaps.physicalTeleZoom);
                }
              })
              .catch(() => {
                // Ignore if native capabilities unavailable
              });
          }
        }

        if (caps.exposureCompensation) {
          supportsExposureRef.current = true;
          setSupportsExposure(true);
          setExposureRange({
            min: caps.exposureCompensation.min,
            max: caps.exposureCompensation.max,
            step: caps.exposureCompensation.step || 0.1,
          });
        }

        if (Array.isArray(caps.exposureMode)) {
          setSupportedExposureModes(caps.exposureMode);
        }

        if (caps.exposureTime) {
          setSupportsExposureTime(true);
          const minT = Math.max(1, caps.exposureTime.min ?? 1);
          const maxT = Math.max(minT + 1, caps.exposureTime.max ?? 10000);
          setExposureTimeRange({
            min: minT,
            max: maxT,
            step: caps.exposureTime.step || 1,
          });
          setCurrentExposureTime(
            trackSettings.exposureTime ?? Math.min(maxT, Math.max(minT, 80))
          );
        }

        if (caps.iso) {
          setSupportsIso(true);
          const minIso = caps.iso.min ?? 50;
          const maxIso = caps.iso.max ?? 3200;
          setIsoRange({
            min: minIso,
            max: maxIso,
            step: caps.iso.step || 10,
          });
          setCurrentIso(
            trackSettings.iso ?? Math.min(maxIso, Math.max(minIso, 200))
          );
        }

        if (Object.keys(initialConstraints).length > 0) {
          try {
            await track.applyConstraints({
              advanced: [initialConstraints as MediaTrackConstraintSet],
            });
          } catch (e) {
            console.warn('Could not apply initial constraints safely', e);
          }
        }
      } catch {
        if (isMounted) setError('LENS_ERROR');
      }
    };
    startStream();
    return () => {
      isMounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [activeDeviceId, streamProfileKey, streamRestartNonce]);

  const triggerAutoFocus = useCallback(
    async (point?: { x: number; y: number }, lockOnPoint = false) => {
      if (!streamRef.current || !supportsFocusRef.current || isLockingRef.current) {
        return;
      }
      const track = streamRef.current.getVideoTracks()[0];
      if (!track) return;

      const modes = supportedFocusModesRef.current;
      const poiConstraint = point
        ? {
            pointsOfInterest: [
              {
                x: Math.max(0.05, Math.min(0.95, point.x)),
                y: Math.max(0.05, Math.min(0.95, point.y)),
              },
            ],
          }
        : {};

      const applyConstraintSafely = async (constraint: Record<string, unknown>) => {
        try {
          await track.applyConstraints({
            advanced: [constraint as MediaTrackConstraintSet],
          });
        } catch {
          if ('pointsOfInterest' in constraint) {
            const { pointsOfInterest: _ignored, ...rest } = constraint;
            if (Object.keys(rest).length > 0) {
              await track.applyConstraints({
                advanced: [rest as MediaTrackConstraintSet],
              });
            }
          }
        }
      };

      try {
        const shouldSingleShot = lockOnPoint || focusModeRef.current === 'single-shot';

        if (!shouldSingleShot) {
          if (modes.includes('single-shot') && point) {
            await applyConstraintSafely({
              focusMode: 'single-shot',
              ...poiConstraint,
            });
            await new Promise(resolve => setTimeout(resolve, 450));
            const trackSettings = track.getSettings() as Record<string, any>;
            if (typeof trackSettings.focusDistance === 'number') {
              setFocusDistanceState(trackSettings.focusDistance);
            }
          } else if (modes.includes('continuous')) {
            await applyConstraintSafely({
              focusMode: 'continuous',
              ...poiConstraint,
            });
          }
          return;
        }

        isLockingRef.current = true;
        focusModeRef.current = 'single-shot';
        setFocusModeState('single-shot');

        if (modes.includes('single-shot')) {
          await applyConstraintSafely({
            focusMode: 'single-shot',
            ...poiConstraint,
          });
          await new Promise(resolve => setTimeout(resolve, 450));
        } else if (modes.includes('continuous')) {
          await applyConstraintSafely({
            focusMode: 'continuous',
            ...poiConstraint,
          });
          await new Promise(resolve => setTimeout(resolve, 550));

          const fallbackLockMode = modes.includes('manual')
            ? 'manual'
            : modes.includes('fixed')
            ? 'fixed'
            : null;
          if (fallbackLockMode) {
            await applyConstraintSafely({ focusMode: fallbackLockMode });
          }
        }

        const trackSettings = track.getSettings() as Record<string, any>;
        if (typeof trackSettings.focusDistance === 'number') {
          setFocusDistanceState(trackSettings.focusDistance);
        }
        isLockingRef.current = false;
      } catch {
        isLockingRef.current = false;
      }
    },
    []
  );

  const setManualFocusDistance = useCallback(async (distance: number) => {
    if (!streamRef.current) return;
    const { min, max } = focusRangeRef.current;
    if (max <= min) return;
    const clamped = Math.max(min, Math.min(max, distance));
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    try {
      setFocusDistanceState(clamped);
      await track.applyConstraints({
        advanced: [{ focusMode: 'manual', focusDistance: clamped } as any],
      });
    } catch {
      // Ignore constraint rejections on locked frames
    }
  }, []);

  const setFocusMode = useCallback(
    async (mode: FocusMode, point?: { x: number; y: number }) => {
      if (!streamRef.current || !supportsFocusRef.current) return;
      focusModeRef.current = mode;
      setFocusModeState(mode);
      const track = streamRef.current.getVideoTracks()[0];
      if (!track) return;
      if (mode === 'continuous') {
        isLockingRef.current = false;
        if (supportedFocusModesRef.current.includes('continuous')) {
          await track.applyConstraints({
            advanced: [{ focusMode: 'continuous' } as any],
          });
        }
      } else {
        await triggerAutoFocus(point, true);
      }
    },
    [triggerAutoFocus]
  );

  const switchCamera = useCallback(
    (deviceId: string) => {
      if (deviceId !== activeDeviceId) {
        try {
          localStorage.setItem(STORAGE_ACTIVE_DEVICE_KEY, deviceId);
        } catch {
          // Ignore
        }
        setActiveDeviceId(deviceId);
      }
    },
    [activeDeviceId]
  );

  const pauseStreamForProCapture = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setStream(null);
    await new Promise(resolve => setTimeout(resolve, 180));
  }, []);

  const resumeStreamAfterProCapture = useCallback(() => {
    setStreamRestartNonce(n => n + 1);
  }, []);

  const setZoom = useCallback(async (value: number) => {
    const { min, max } = zoomRangeRef.current;
    const newZoom = Math.min(Math.max(value, min), max);
    zoomRef.current = newZoom;
    setZoomState(newZoom);
    if (supportsNativeZoomRef.current && streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      const { min: wMin, max: wMax } = webZoomRangeRef.current;
      const webClampedZoom = Math.min(Math.max(newZoom, wMin), wMax);
      try {
        await track.applyConstraints({
          advanced: [{ zoom: webClampedZoom } as any],
        });
      } catch {
        // Ignore
      }
    }
  }, []);

  const setExposure = useCallback(async (value: number) => {
    if (supportsExposureRef.current && streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      try {
        await track.applyConstraints({
          advanced: [{ exposureCompensation: value } as any],
        });
      } catch {
        // Ignore
      }
    }
  }, []);

  /**
   * Atomically applies manual exposureMode, exposureTime (100µs units), and ISO
   * for Google Pixel 7 / Camera2 manual exposure compatibility.
   */
  const applyManualExposure = useCallback(
    async (
      mode: 'auto' | 'manual',
      exposureTimeUnits?: number,
      isoValue?: number
    ) => {
      if (exposureTimeUnits !== undefined) {
        setCurrentExposureTime(exposureTimeUnits);
      }
      if (isoValue !== undefined) {
        setCurrentIso(isoValue);
      }

      if (!streamRef.current) return;
      const track = streamRef.current.getVideoTracks()[0];
      if (!track) return;

      try {
        if (mode === 'auto') {
          if (supportedExposureModes.includes('continuous')) {
            await track.applyConstraints({
              advanced: [{ exposureMode: 'continuous' } as any],
            });
          }
          return;
        }

        const constraint: Record<string, unknown> = {};
        if (supportedExposureModes.includes('manual')) {
          constraint.exposureMode = 'manual';
        }
        if (supportsExposureTime && exposureTimeUnits !== undefined) {
          constraint.exposureTime = Math.min(
            exposureTimeRange.max,
            Math.max(exposureTimeRange.min, Math.round(exposureTimeUnits))
          );
        }
        if (supportsIso && isoValue !== undefined) {
          constraint.iso = Math.min(
            isoRange.max,
            Math.max(isoRange.min, Math.round(isoValue))
          );
        }

        if (Object.keys(constraint).length > 0) {
          await track.applyConstraints({
            advanced: [constraint as MediaTrackConstraintSet],
          });
        }
      } catch (e) {
        console.warn('Manual exposure constraint fallback:', e);
      }
    },
    [
      supportedExposureModes,
      supportsExposureTime,
      exposureTimeRange,
      supportsIso,
      isoRange,
    ]
  );

  return {
    devices,
    activeDeviceId,
    stream,
    error,
    switchCamera,
    retryCamera,
    supportsFocus,
    triggerAutoFocus,
    focusMode,
    setFocusMode,
    zoom,
    zoomRange,
    setZoom,
    supportsNativeZoom,
    supportsWebUltraWide,
    nativeTeleZoom,
    supportsExposure,
    exposureRange,
    setExposure,
    supportedExposureModes,
    supportsExposureTime,
    exposureTimeRange,
    currentExposureTime,
    supportsIso,
    isoRange,
    currentIso,
    applyManualExposure,
    supportsManualFocus,
    focusDistance,
    focusDistanceRange,
    setManualFocusDistance,
    pauseStreamForProCapture,
    resumeStreamAfterProCapture,
  };
};