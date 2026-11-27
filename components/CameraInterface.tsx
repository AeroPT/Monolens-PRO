import React, {
  useRef,
  useState,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import { useCamera, FocusMode, formatExposureTime } from '../hooks/useCamera';
import SVGFilters from './SVGFilters';
import SliderControl from './SliderControl';
import CurvesControl from './CurvesControl';
import ExposureControl from './ExposureControl';
import Histogram from './Histogram';
import HorizontalLevel from './HorizontalLevel';
import FramingGrid, { GridMode, GRID_MODE_ORDER } from './FramingGrid';
import AssistOverlay, { getPeakingColorDef } from './AssistOverlay';
import FilmControl from './FilmControl';
import CaptureModeMenu from './CaptureModeMenu';
import PeakSettingsMenu from './PeakSettingsMenu';
import FocusReticle from './FocusReticle';
import {
  DEFAULT_SETTINGS,
  FilterSettings,
  CapturedImage,
  PeakingColorId,
  CaptureMode,
} from '../types';
import {
  processBitmap,
  snapshotVideoCanvas,
  processCanvasSnapshot,
  reprocessImageFromUrl,
} from '../utils/imageProcessing';
import { getCurveLut, isCurveNeutral } from '../utils/curveMath';
import { cloneFilterSettings } from '../utils/bwFilters';
import {
  ProCapture,
  isProCaptureSupported,
  inferLensHint,
} from '../utils/proCapture';
import { runContrastAutofocusSweep } from '../utils/contrastAutofocus';
import {
  VisualObjectTracker,
  screenPercentToVideoNorm,
} from '../utils/objectTracker';
import { useDoubleTap } from '../utils/useDoubleTap';
import { useI18n } from '../utils/i18n';
import {
  STORAGE_KEYS,
  StoredExposurePrefs,
  safeSetItem,
  loadSavedCaptureMode,
  loadSavedFilterSettings,
  loadSavedFocusMode,
  loadSavedExposurePrefs,
  loadSavedBool,
  loadSavedGridMode,
  loadSavedPeakingColor,
  loadSavedPeakingIntensity,
  loadSavedTimerSeconds,
} from '../utils/cameraPrefs';
import {
  ImageIcon,
  RotateCcw,
  Sliders,
  SlidersHorizontal,
  X,
  Undo2,
  Target,
  ChevronDown,
  Aperture,
  Grid3x3,
  Timer,
  Focus,
  Sun,
  Cpu,
  Globe,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

const TRANSPARENT_POSTER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

interface CameraInterfaceProps {
  onGalleryClick: () => void;
  onCapture: (img: CapturedImage) => void;
  lastImage?: CapturedImage;
}

interface FocusState {
  x: number;
  y: number;
  visible: boolean;
  working: boolean;
  tracking: boolean;
}

const triggerLightHaptic = () => {
  try {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  } catch {
    // Ignore on browser
  }
};

const CameraInterface: React.FC<CameraInterfaceProps> = ({
  onGalleryClick,
  onCapture,
  lastImage,
}) => {
  const { toggleLang, t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const focusReticleRef = useRef<HTMLDivElement>(null);
  const selectedAfCoordsRef = useRef<{ x: number; y: number }>({
    x: 0.5,
    y: 0.5,
  });
  const afSweepIdRef = useRef(0);
  const trackerRef = useRef<VisualObjectTracker | null>(null);
  if (!trackerRef.current && typeof document !== 'undefined') {
    trackerRef.current = new VisualObjectTracker();
  }

  const initialExposurePrefsRef = useRef<StoredExposurePrefs | null>(null);
  if (!initialExposurePrefsRef.current) {
    initialExposurePrefsRef.current = loadSavedExposurePrefs();
  }
  const desiredFocusModeRef = useRef<FocusMode>(loadSavedFocusMode());
  const pendingHardwareRestoreRef = useRef<boolean>(true);
  const lastExplicitDeviceIdRef = useRef<string | null>(null);

  const [captureMode, setCaptureMode] = useState<CaptureMode>(loadSavedCaptureMode);
  const [showModeMenu, setShowModeMenu] = useState(false);

  const {
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
    supportsExposure,
    exposureRange,
    setExposure,
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
  } = useCamera(captureMode);

  const [settings, setSettings] = useState<FilterSettings>(loadSavedFilterSettings);
  const [history, setHistory] = useState<FilterSettings[]>([]);
  const [showControls, setShowControls] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isFreezeVisible, setIsFreezeVisible] = useState(false);
  const freezeCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureRawOriginal, setCaptureRawOriginal] = useState<boolean>(() =>
    loadSavedBool(STORAGE_KEYS.captureDng, false)
  );
  const [showLevel, setShowLevel] = useState<boolean>(() =>
    loadSavedBool(STORAGE_KEYS.levelEnabled, true)
  );
  const [gridMode, setGridMode] = useState<GridMode>(loadSavedGridMode);
  const [peakingEnabled, setPeakingEnabled] = useState<boolean>(() =>
    loadSavedBool(STORAGE_KEYS.peaking, false)
  );
  const [peakingColor, setPeakingColor] = useState<PeakingColorId>(
    loadSavedPeakingColor
  );
  const [peakingIntensity, setPeakingIntensity] = useState<number>(
    loadSavedPeakingIntensity
  );
  const [showPeakMenu, setShowPeakMenu] = useState(false);
  const [zebrasEnabled, setZebrasEnabled] = useState<boolean>(() =>
    loadSavedBool(STORAGE_KEYS.zebras, false)
  );
  const [timerSeconds, setTimerSeconds] = useState<0 | 3 | 10>(
    loadSavedTimerSeconds
  );
  const [countdown, setCountdown] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeTab, setActiveTab] = useState<
    'film' | 'exposure' | 'curves' | 'levels'
  >('curves');
  const [isAdjustingCurve, setIsAdjustingCurve] = useState(false);
  const [isAdjustingSlider, setIsAdjustingSlider] = useState(false);
  const [isAdjustingManualExposure, setIsAdjustingManualExposure] =
    useState(false);

  const [focusPoint, setFocusPoint] = useState<FocusState>({
    x: 50,
    y: 50,
    visible: false,
    working: false,
    tracking: false,
  });
  const focusPointRef = useRef<FocusState>(focusPoint);
  focusPointRef.current = focusPoint;

  // Exposure state (Auto EV + Manual Shutter & ISO)
  const [exposureMode, setExposureMode] = useState<'auto' | 'manual'>(
    () => initialExposurePrefsRef.current?.mode ?? 'auto'
  );
  const [manualExposureTime, setManualExposureTime] = useState<number>(
    () => initialExposurePrefsRef.current?.exposureTime ?? 80
  );
  const [manualIso, setManualIso] = useState<number>(
    () => initialExposurePrefsRef.current?.iso ?? 200
  );
  const [exposureVal, setExposureVal] = useState<number>(
    () => initialExposurePrefsRef.current?.ev ?? 0
  );
  const [isAdjustingExposure, setIsAdjustingExposure] = useState(false);
  const exposureStartVal = useRef(initialExposurePrefsRef.current?.ev ?? 0);

  // Latest exposure values in refs so stream restore doesn't re-run on slider drags
  const exposureStateRef = useRef({
    exposureMode,
    manualExposureTime,
    manualIso,
    exposureVal,
  });
  exposureStateRef.current = {
    exposureMode,
    manualExposureTime,
    manualIso,
    exposureVal,
  };

  const exposureLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const initialPinchDist = useRef<number | null>(null);
  const initialZoomLevel = useRef<number>(1);
  const isPinching = useRef(false);
  const controlsSwipeStartY = useRef<number | null>(null);

  const isModifying =
    isAdjustingCurve || isAdjustingSlider || isAdjustingManualExposure;
  const hasCustomCurve = useMemo(
    () => !isCurveNeutral(settings.curvePoints),
    [settings.curvePoints]
  );

  const miniCurvePath = useMemo(() => {
    const lut = getCurveLut(settings.curvePoints);
    let d = `M 2 ${(20 - lut[0] * 16).toFixed(1)}`;
    for (let i = 16; i <= 255; i += 16) {
      const x = 2 + (i / 255) * 16;
      const y = 20 - lut[i] * 16;
      d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return d;
  }, [settings.curvePoints]);

  const captureViewfinderFreezeFrame = useCallback(() => {
    const videoEl = videoRef.current;
    const freezeCanvas = freezeCanvasRef.current;
    if (
      !videoEl ||
      !freezeCanvas ||
      videoEl.readyState < 2 ||
      !videoEl.videoWidth ||
      !videoEl.videoHeight
    ) {
      return;
    }
    try {
      const maxDim = 1280;
      const scale = Math.min(
        1,
        maxDim / Math.max(videoEl.videoWidth, videoEl.videoHeight)
      );
      const w = Math.max(1, Math.round(videoEl.videoWidth * scale));
      const h = Math.max(1, Math.round(videoEl.videoHeight * scale));
      if (freezeCanvas.width !== w) freezeCanvas.width = w;
      if (freezeCanvas.height !== h) freezeCanvas.height = h;
      const ctx = freezeCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoEl, 0, 0, w, h);
        setIsFreezeVisible(true);
      }
    } catch {
      // Ignore transient frame capture errors
    }
  }, []);

  useEffect(() => {
    const videoEl = videoRef.current;
    setIsVideoReady(false);
    if (videoEl && stream) {
      videoEl.srcObject = stream;
      videoEl.play().catch(e => console.warn('Auto-play failed:', e));
    }
    return () => {
      if (videoEl) {
        videoEl.srcObject = null;
      }
    };
  }, [stream]);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 2400);
  }, []);

  useEffect(() => {
    return () => {
      if (exposureLongPressTimer.current) {
        clearTimeout(exposureLongPressTimer.current);
      }
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Persist chosen settings across restarts
  useEffect(() => {
    const toStore: FilterSettings = { ...settings, exposureGain: 1.0 };
    safeSetItem(STORAGE_KEYS.filterSettings, JSON.stringify(toStore));
  }, [settings]);

  useEffect(() => {
    safeSetItem(STORAGE_KEYS.captureDng, String(captureRawOriginal));
  }, [captureRawOriginal]);

  useEffect(() => {
    safeSetItem(STORAGE_KEYS.captureMode, captureMode);
  }, [captureMode]);

  useEffect(() => {
    const prefs: StoredExposurePrefs = {
      mode: exposureMode,
      exposureTime: manualExposureTime,
      iso: manualIso,
      ev: exposureVal,
    };
    safeSetItem(STORAGE_KEYS.exposurePrefs, JSON.stringify(prefs));
  }, [exposureMode, manualExposureTime, manualIso, exposureVal]);

  // Handle initial startup vs explicit lens switch
  useEffect(() => {
    if (!activeDeviceId) return;
    afSweepIdRef.current += 1;
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
      setCountdown(null);
    }
    setIsVideoReady(false);

    if (lastExplicitDeviceIdRef.current === null) {
      lastExplicitDeviceIdRef.current = activeDeviceId;
      pendingHardwareRestoreRef.current = true;
      return;
    }

    if (lastExplicitDeviceIdRef.current !== activeDeviceId) {
      lastExplicitDeviceIdRef.current = activeDeviceId;
      pendingHardwareRestoreRef.current = false;
      setExposureVal(0);
      exposureStartVal.current = 0;
      setExposureMode('auto');
      setManualExposureTime(currentExposureTime);
      setManualIso(currentIso);
      setSettings(prev => ({ ...prev, exposureGain: 1.0 }));
      selectedAfCoordsRef.current = { x: 0.5, y: 0.5 };
      desiredFocusModeRef.current = 'continuous';
      safeSetItem(STORAGE_KEYS.focusMode, 'continuous');
      trackerRef.current?.stop();
      setFocusPoint(prev => ({
        ...prev,
        visible: false,
        working: false,
        tracking: false,
      }));
    }
  }, [activeDeviceId]);

  useEffect(() => {
    if (exposureMode === 'auto') {
      setManualExposureTime(currentExposureTime);
      setManualIso(currentIso);
    }
  }, [currentExposureTime, currentIso, exposureMode]);

  const applyUnifiedExposure = useCallback(
    async (
      nextMode: 'auto' | 'manual',
      nextTime: number,
      nextIso: number
    ) => {
      setExposureMode(nextMode);
      setManualExposureTime(nextTime);
      setManualIso(nextIso);

      if (nextMode === 'auto') {
        await applyManualExposure('auto');
        setSettings(prev => ({ ...prev, exposureGain: 1.0 }));
        return;
      }

      await applyManualExposure('manual', nextTime, nextIso);

      if (supportsExposureTime && supportsIso) {
        setSettings(prev => ({ ...prev, exposureGain: 1.0 }));
      } else {
        const evDelta =
          (supportsIso ? 0 : Math.log2(Math.max(25, nextIso) / 200)) +
          (supportsExposureTime ? 0 : Math.log2(Math.max(1, nextTime) / 80));

        if (supportsExposure) {
          const clampedComp = Math.min(
            exposureRange.max,
            Math.max(exposureRange.min, evDelta)
          );
          setExposureVal(clampedComp);
          await setExposure(clampedComp);
          const residualEv = evDelta - clampedComp;
          const gain = Math.min(3.5, Math.max(0.28, Math.pow(2, residualEv)));
          setSettings(prev => ({ ...prev, exposureGain: gain }));
        } else {
          const gain = Math.min(3.5, Math.max(0.28, Math.pow(2, evDelta)));
          setSettings(prev => ({ ...prev, exposureGain: gain }));
        }
      }
    },
    [
      applyManualExposure,
      supportsExposureTime,
      supportsIso,
      supportsExposure,
      exposureRange,
      setExposure,
    ]
  );

  // Restore saved exposure & focus mode once a new stream is ready
  useEffect(() => {
    if (!stream || !pendingHardwareRestoreRef.current) return;
    const timer = setTimeout(() => {
      if (!pendingHardwareRestoreRef.current) return;
      pendingHardwareRestoreRef.current = false;

      const {
        exposureMode: savedMode,
        manualExposureTime: savedTime,
        manualIso: savedIso,
        exposureVal: savedEv,
      } = exposureStateRef.current;

      if (savedMode === 'manual') {
        void applyUnifiedExposure('manual', savedTime, savedIso);
      } else if (Math.abs(savedEv) > 0.05 && supportsExposure) {
        void setExposure(savedEv);
      }

      if (desiredFocusModeRef.current === 'single-shot' && supportsFocus) {
        setFocusPoint(prev => ({
          x: prev.visible ? prev.x : 50,
          y: prev.visible ? prev.y : 50,
          visible: true,
          working: false,
          tracking: false,
        }));
        void setFocusMode('single-shot', selectedAfCoordsRef.current);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [
    stream,
    supportsExposure,
    supportsFocus,
    applyUnifiedExposure,
    setExposure,
    setFocusMode,
  ]);

  // Double-tap reset handlers for HUD controls
  const handleDoubleTapZoomReset = useDoubleTap(() => {
    setZoom(zoomRange.min);
  });

  const handleDoubleTapExposureReset = useDoubleTap(() => {
    setExposureVal(0);
    setExposure(0);
    applyUnifiedExposure('auto', 80, 200);
  });

  const handleDoubleTapFocusReset = useDoubleTap(() => {
    setManualFocusDistance(focusDistanceRange.min);
  });

  const handleToggleLevel = async () => {
    triggerLightHaptic();
    const next = !showLevel;
    if (
      next &&
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof (
        DeviceMotionEvent as unknown as {
          requestPermission?: () => Promise<string>;
        }
      ).requestPermission === 'function'
    ) {
      try {
        const perm = await (
          DeviceMotionEvent as unknown as {
            requestPermission: () => Promise<string>;
          }
        ).requestPermission();
        if (perm !== 'granted') return;
      } catch {
        // Ignore if denied or unsupported
      }
    }

    setShowLevel(next);
    safeSetItem(STORAGE_KEYS.levelEnabled, String(next));
  };

  const handleCycleGrid = () => {
    triggerLightHaptic();
    const idx = GRID_MODE_ORDER.indexOf(gridMode);
    const next = GRID_MODE_ORDER[(idx + 1) % GRID_MODE_ORDER.length];
    setGridMode(next);
    safeSetItem(STORAGE_KEYS.gridMode, next);
  };

  const handleTogglePeaking = () => {
    triggerLightHaptic();
    setPeakingEnabled(prev => {
      const next = !prev;
      if (!next) setShowPeakMenu(false);
      safeSetItem(STORAGE_KEYS.peaking, String(next));
      return next;
    });
  };

  const handleSelectPeakingColor = useCallback(
    (color: PeakingColorId) => {
      triggerLightHaptic();
      setPeakingColor(color);
      if (!peakingEnabled) {
        setPeakingEnabled(true);
        safeSetItem(STORAGE_KEYS.peaking, 'true');
      }
      safeSetItem(STORAGE_KEYS.peakingColor, color);
    },
    [peakingEnabled]
  );

  const handlePeakingIntensityChange = useCallback(
    (val: number) => {
      const clamped = Math.max(10, Math.min(100, Math.round(val)));
      setPeakingIntensity(clamped);
      if (!peakingEnabled) {
        setPeakingEnabled(true);
        safeSetItem(STORAGE_KEYS.peaking, 'true');
      }
      safeSetItem(STORAGE_KEYS.peakingIntensity, String(clamped));
    },
    [peakingEnabled]
  );

  const handleDoubleTapPeakIntensityReset = useDoubleTap(() => {
    handlePeakingIntensityChange(55);
  });

  const handleToggleZebras = () => {
    triggerLightHaptic();
    setZebrasEnabled(prev => {
      const next = !prev;
      safeSetItem(STORAGE_KEYS.zebras, String(next));
      return next;
    });
  };

  const handleCycleTimer = () => {
    triggerLightHaptic();
    setTimerSeconds(prev => {
      const next: 0 | 3 | 10 = prev === 0 ? 3 : prev === 3 ? 10 : 0;
      safeSetItem(STORAGE_KEYS.timer, String(next));
      return next;
    });
  };

  const getLocalizedModeMeta = useCallback(
    (modeId: CaptureMode) => {
      if (modeId === 'fast') {
        return {
          label: t.fastLabel,
          pillLabel: t.fastPill,
          resolutionHint: t.fastHint,
          description: t.fastDesc,
        };
      }
      if (modeId === 'stream4k') {
        return {
          label: t.stream4kLabel,
          pillLabel: t.stream4kPill,
          resolutionHint: t.stream4kHint,
          description: t.stream4kDesc,
        };
      }
      return {
        label: t.sensorMaxLabel,
        pillLabel: t.sensorMaxPill,
        resolutionHint: t.sensorMaxHint,
        description: t.sensorMaxDesc,
      };
    },
    [t]
  );

  const handleSelectCaptureMode = useCallback(
    (nextMode: CaptureMode) => {
      triggerLightHaptic();
      if (nextMode !== captureMode) {
        captureViewfinderFreezeFrame();
        pendingHardwareRestoreRef.current = true;
        setCaptureMode(nextMode);
      }
      setShowModeMenu(false);
      const meta = getLocalizedModeMeta(nextMode);
      if (nextMode === 'sensor_max' && !isProCaptureSupported()) {
        showToast(t.sensorMaxToastWeb);
      } else {
        showToast(t.modeToast(meta.label));
      }
    },
    [captureMode, captureViewfinderFreezeFrame, getLocalizedModeMeta, showToast, t]
  );

  const executeCapture = async () => {
    if (!videoRef.current || !stream || isCapturing) return;
    setShowModeMenu(false);
    setShowPeakMenu(false);
    setIsCapturing(true);
    setIsFlashing(true);

    try {
      Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    } catch {
      // Ignore on web
    }

    const isNativeSensorMax =
      captureMode === 'sensor_max' && isProCaptureSupported();
    setTimeout(() => setIsFlashing(false), 75);

    try {
      const nowTs = Date.now();

      if (isNativeSensorMax) {
        const activeDevice = devices.find(d => d.deviceId === activeDeviceId);
        const deviceLabel = activeDevice?.label || '';
        const lensHint = inferLensHint(deviceLabel);
        const afCoords = selectedAfCoordsRef.current;
        const exposureTimeNs = Math.round(manualExposureTime * 100_000);

        captureViewfinderFreezeFrame();
        pendingHardwareRestoreRef.current = true;
        await pauseStreamForProCapture();

        let proRes: Awaited<ReturnType<typeof ProCapture.captureStill>>;
        try {
          proRes = await ProCapture.captureStill({
            deviceLabel,
            lensHint,
            captureRaw: captureRawOriginal,
            autoSaveRaw: false,
            focusX: afCoords.x,
            focusY: afCoords.y,
            focusMode,
            exposureMode,
            exposureTimeNs,
            iso: Math.round(manualIso),
            exposureCompensationEv: exposureVal,
            zoomRatio: zoom,
          });
        } finally {
          resumeStreamAfterProCapture();
        }

        const jpegSrc = Capacitor.convertFileSrc(proRes.jpegPath);
        const processed = await reprocessImageFromUrl(jpegSrc, settings, {
          includeColorCopyMaxDim: captureRawOriginal ? 1600 : undefined,
        });

        onCapture({
          id: String(nowTs),
          url: processed.url,
          thumbnailUrl: processed.thumbnailUrl,
          originalUrl: processed.originalUrl,
          dngFilePath: proRes.dngPath,
          captureMode: 'sensor_max',
          width: processed.width,
          height: processed.height,
          timestamp: nowTs,
          settings: cloneFilterSettings(settings),
        });

        const mpLabel = (
          (processed.width * processed.height) /
          1_000_000
        ).toFixed(1);

        showToast(
          t.sensorMaxSaved(mpLabel, !!(captureRawOriginal && proRes.dngPath))
        );
        return;
      }

      // Freeze the viewfinder preview immediately (same experience as Max Sensor)
      // and grab the raw full-res frame at t=0 before waiting for the shutter blink to fade.
      captureViewfinderFreezeFrame();

      let grabbedBitmap: ImageBitmap | null = null;
      let fallbackSnapshot: ReturnType<typeof snapshotVideoCanvas> = null;
      const track = stream.getVideoTracks()[0];
      const capturer =
        'ImageCapture' in window ? new (window as any).ImageCapture(track) : null;

      if (
        capturer &&
        typeof capturer.grabFrame === 'function' &&
        track.readyState === 'live'
      ) {
        try {
          grabbedBitmap = await capturer.grabFrame();
        } catch {
          fallbackSnapshot = snapshotVideoCanvas(
            videoRef.current,
            zoom,
            supportsNativeZoom
          );
        }
      } else {
        fallbackSnapshot = snapshotVideoCanvas(
          videoRef.current,
          zoom,
          supportsNativeZoom
        );
      }

      // Allow the frozen frame and subtle shutter blink to paint cleanly on screen
      // before running heavy CPU image/DNG encoding.
      await new Promise<void>(resolve => setTimeout(resolve, 180));
      await new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );

      const dngMeta = {
        exposureTimeSeconds:
          exposureMode === 'manual'
            ? manualExposureTime * 0.0001
            : currentExposureTime * 0.0001,
        iso: exposureMode === 'manual' ? manualIso : currentIso,
        timestamp: nowTs,
      };

      let captureResult: {
        url: string;
        thumbnailUrl: string;
        originalUrl?: string;
        dngBuffer?: ArrayBuffer;
        width: number;
        height: number;
      };

      try {
        if (grabbedBitmap) {
          captureResult = processBitmap(
            grabbedBitmap,
            settings,
            zoom,
            supportsNativeZoom,
            captureRawOriginal,
            dngMeta
          );
        } else if (fallbackSnapshot) {
          captureResult = processCanvasSnapshot(
            fallbackSnapshot,
            settings,
            captureRawOriginal,
            dngMeta
          );
        } else {
          throw new Error(t.captureError);
        }
      } finally {
        if (grabbedBitmap) grabbedBitmap.close();
      }

      onCapture({
        id: String(nowTs),
        url: captureResult.url,
        thumbnailUrl: captureResult.thumbnailUrl,
        originalUrl: captureResult.originalUrl,
        dngBuffer: captureResult.dngBuffer,
        captureMode,
        width: captureResult.width,
        height: captureResult.height,
        timestamp: nowTs,
        settings: cloneFilterSettings(settings),
      });

      showToast(t.fastSaved(!!(captureRawOriginal && captureResult.dngBuffer)));
    } catch (e) {
      console.error('Capture error:', e);
      const errMsg = e instanceof Error ? e.message : t.captureError;
      showToast(errMsg);
    } finally {
      if (!isNativeSensorMax) {
        setIsFreezeVisible(false);
      }
      setIsCapturing(false);
    }
  };

  const handleCapture = () => {
    if (!videoRef.current || !stream || isCapturing) return;

    if (countdown !== null) {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      setCountdown(null);
      return;
    }

    if (timerSeconds === 0) {
      void executeCapture();
      return;
    }

    let remaining: number = timerSeconds;
    setCountdown(remaining);
    triggerLightHaptic();

    countdownTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        setCountdown(null);
        void executeCapture();
      } else {
        setCountdown(remaining);
        triggerLightHaptic();
      }
    }, 1000);
  };

  const saveHistory = useCallback(() => {
    setHistory(prev => {
      const snapshot = cloneFilterSettings(settings);
      const newHistory = [...prev, snapshot];
      if (newHistory.length > 20) newHistory.shift();
      return newHistory;
    });
  }, [settings]);

  const handleUndo = () => {
    if (history.length === 0) return;
    setSettings(history[history.length - 1]);
    setHistory(prev => prev.slice(0, -1));
  };

  const updateSetting = <K extends keyof FilterSettings>(
    key: K,
    value: FilterSettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const resetSettings = () => {
    saveHistory();
    setSettings(cloneFilterSettings(DEFAULT_SETTINGS));
    applyUnifiedExposure('auto', 80, 200);
    setExposureVal(0);
    setExposure(0);
  };

  const handleOpenPanel = (
    tab: 'film' | 'exposure' | 'curves' | 'levels'
  ) => {
    setShowPeakMenu(false);
    setShowModeMenu(false);
    if (showControls && activeTab === tab) {
      setShowControls(false);
    } else {
      setActiveTab(tab);
      setShowControls(true);
    }
  };

  const getDistance = (touches: React.TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      isPinching.current = true;
      initialPinchDist.current = getDistance(e.touches);
      initialZoomLevel.current = zoom;
      return;
    }
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartPos.current = { x: touch.clientX, y: touch.clientY };
      exposureStartVal.current = exposureVal;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && isPinching.current && initialPinchDist.current) {
      e.preventDefault();
      const currentDist = getDistance(e.touches);
      const ratio = currentDist / initialPinchDist.current;
      let newZoom = initialZoomLevel.current * ratio;
      newZoom = Math.min(Math.max(newZoom, zoomRange.min), zoomRange.max);
      setZoom(newZoom);
      return;
    }
    if (e.touches.length === 1 && touchStartPos.current && !isPinching.current) {
      const touch = e.touches[0];
      const deltaY = touchStartPos.current.y - touch.clientY;
      const deltaX = touchStartPos.current.x - touch.clientX;
      if (
        !isAdjustingExposure &&
        Math.abs(deltaY) > 15 &&
        Math.abs(deltaY) > Math.abs(deltaX)
      ) {
        if (!showControls && exposureMode === 'auto') {
          setIsAdjustingExposure(true);
        }
      }
      if (isAdjustingExposure) {
        e.preventDefault();
        const rangeSpan = supportsExposure
          ? exposureRange.max - exposureRange.min
          : 4;
        const valueChange = (deltaY / (window.innerHeight * 0.4)) * rangeSpan;
        let newVal = exposureStartVal.current + valueChange;
        newVal = Math.max(
          supportsExposure ? exposureRange.min : -2,
          Math.min(supportsExposure ? exposureRange.max : 2, newVal)
        );
        setExposureVal(newVal);
        setExposure(newVal);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      setTimeout(() => {
        isPinching.current = false;
        initialPinchDist.current = null;
      }, 100);
    }
    if (isAdjustingExposure) {
      setTimeout(() => setIsAdjustingExposure(false), 500);
      touchStartPos.current = null;
      return;
    }
    touchStartPos.current = null;
  };

  const handleScreenTap = async (
    e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>
  ) => {
    if (showPeakMenu || showModeMenu) {
      setShowPeakMenu(false);
      setShowModeMenu(false);
      return;
    }
    if (isPinching.current || isAdjustingExposure || showControls) return;
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) return;
    if (!containerRef.current) return;

    let clientX: number;
    let clientY: number;
    if ('touches' in e) {
      const touch = e.changedTouches[0] || e.touches[0];
      if (!touch) return;
      clientX = touch.clientX;
      clientY = touch.clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;

    // Google Pixel gesture: tapping directly on the active tracking circle unlocks it
    if (
      focusPointRef.current.visible &&
      Math.hypot(x - focusPointRef.current.x, y - focusPointRef.current.y) < 7
    ) {
      trackerRef.current?.stop();
      setFocusPoint(prev => ({
        ...prev,
        visible: false,
        working: false,
        tracking: false,
      }));
      return;
    }

    let videoNorm = { x: x / 100, y: y / 100 };
    if (videoRef.current && videoRef.current.readyState >= 2) {
      videoNorm = screenPercentToVideoNorm(
        x,
        y,
        rect.width,
        rect.height,
        videoRef.current.videoWidth,
        videoRef.current.videoHeight
      );
    }

    selectedAfCoordsRef.current = videoNorm;
    const sweepId = ++afSweepIdRef.current;

    triggerLightHaptic();

    setFocusPoint({
      x,
      y,
      visible: true,
      working: true,
      tracking: false,
    });

    if (
      trackerRef.current &&
      videoRef.current &&
      videoRef.current.readyState >= 2
    ) {
      trackerRef.current.initAtVideoNorm(
        videoRef.current,
        videoNorm.x,
        videoNorm.y
      );
    }

    if (
      supportsManualFocus &&
      focusDistanceRange.max > focusDistanceRange.min &&
      videoRef.current &&
      videoRef.current.readyState >= 2
    ) {
      void runContrastAutofocusSweep({
        video: videoRef.current,
        normPoint: videoNorm,
        minDist: focusDistanceRange.min,
        maxDist: focusDistanceRange.max,
        applyFocusDistance: async (dist: number) => {
          await setManualFocusDistance(dist);
        },
        isCancelled: () => sweepId !== afSweepIdRef.current,
      }).then(() => {
        if (sweepId === afSweepIdRef.current) {
          setFocusPoint(prev => ({
            ...prev,
            x: focusPointRef.current.x,
            y: focusPointRef.current.y,
            working: false,
            tracking: trackerRef.current?.getIsActive() ?? false,
          }));
          try {
            Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
          } catch {
            // Ignore
          }
        }
      });
    } else {
      await triggerAutoFocus(videoNorm, true);
      const finalizeFocus = () => {
        if (sweepId === afSweepIdRef.current) {
          setFocusPoint(prev => ({
            ...prev,
            x: focusPointRef.current.x,
            y: focusPointRef.current.y,
            working: false,
            tracking: trackerRef.current?.getIsActive() ?? false,
          }));
        }
      };
      if (focusMode === 'continuous') {
        setTimeout(finalizeFocus, 450);
      } else {
        finalizeFocus();
      }
    }
  };

  const toggleAFMode = async () => {
    afSweepIdRef.current += 1;
    trackerRef.current?.stop();
    const nextMode: FocusMode =
      focusMode === 'continuous' ? 'single-shot' : 'continuous';
    desiredFocusModeRef.current = nextMode;
    safeSetItem(STORAGE_KEYS.focusMode, nextMode);

    if (nextMode === 'single-shot') {
      setFocusPoint(prev => ({
        x: prev.visible ? prev.x : 50,
        y: prev.visible ? prev.y : 50,
        visible: true,
        working: true,
        tracking: false,
      }));
    } else {
      setFocusPoint(prev => ({
        ...prev,
        visible: false,
        working: false,
        tracking: false,
      }));
      selectedAfCoordsRef.current = { x: 0.5, y: 0.5 };
    }

    await setFocusMode(
      nextMode,
      nextMode === 'single-shot' ? selectedAfCoordsRef.current : undefined
    );
    if (nextMode === 'single-shot') {
      setFocusPoint(prev => ({ ...prev, working: false }));
    }
  };

  // Real-time object tracking loop (updates reticle DOM directly to avoid 33fps React re-renders)
  useEffect(() => {
    if (!focusPoint.visible || isCapturing) return;

    let animId: number | null = null;
    let lastTime = 0;

    const tick = (now: number) => {
      if (
        trackerRef.current?.getIsActive() &&
        videoRef.current &&
        containerRef.current &&
        videoRef.current.readyState >= 2
      ) {
        if (now - lastTime >= 30) {
          lastTime = now;
          const container = containerRef.current;
          const res = trackerRef.current.update(
            videoRef.current,
            container.clientWidth,
            container.clientHeight
          );
          if (res && res.confidence > 0.3) {
            focusPointRef.current.x = res.screenX;
            focusPointRef.current.y = res.screenY;
            selectedAfCoordsRef.current = { x: res.videoX, y: res.videoY };

            if (focusReticleRef.current) {
              focusReticleRef.current.style.left = `${res.screenX}%`;
              focusReticleRef.current.style.top = `${res.screenY}%`;
            }

            if (!focusPointRef.current.tracking) {
              setFocusPoint(prev => ({
                ...prev,
                x: res.screenX,
                y: res.screenY,
                tracking: true,
              }));
            }
          }
        }
      }
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => {
      if (animId !== null) cancelAnimationFrame(animId);
    };
  }, [focusPoint.visible, isCapturing]);

  const startExposurePress = () => {
    exposureLongPressTimer.current = setTimeout(() => {
      setExposureVal(0);
      setExposure(0);
      applyUnifiedExposure('auto', 80, 200);
    }, 600);
  };

  const cancelExposurePress = () => {
    if (exposureLongPressTimer.current) {
      clearTimeout(exposureLongPressTimer.current);
    }
  };

  const handleLensClick = (deviceId: string) => {
    if (deviceId !== activeDeviceId) {
      captureViewfinderFreezeFrame();
      switchCamera(deviceId);
    }
  };

  const handleControlsTouchStart = (e: React.TouchEvent) => {
    controlsSwipeStartY.current = e.touches[0].clientY;
  };

  const handleControlsTouchMove = (e: React.TouchEvent) => {
    if (controlsSwipeStartY.current === null) return;
    const deltaY = e.touches[0].clientY - controlsSwipeStartY.current;
    if (deltaY > 60) {
      setShowControls(false);
      controlsSwipeStartY.current = null;
    }
  };

  const sortedDevices = useMemo(() => {
    return [...devices].sort((a, b) => {
      const aIsFront = a.label.toLowerCase().includes('front');
      const bIsFront = b.label.toLowerCase().includes('front');
      if (aIsFront && !bIsFront) return 1;
      if (!aIsFront && bIsFront) return -1;
      return a.deviceId.localeCompare(b.deviceId);
    });
  }, [devices]);

  const backDevices = useMemo(
    () => sortedDevices.filter(d => !d.label.toLowerCase().includes('front')),
    [sortedDevices]
  );

  const getLensLabel = (
    device: { deviceId: string; label: string },
    index: number
  ) => {
    const labelLower = device.label.toLowerCase();
    if (labelLower.includes('front')) return t.lensFront;
    if (
      labelLower.includes('ultra') ||
      labelLower.includes('wide') ||
      labelLower.includes('0.7') ||
      labelLower.includes('0.6')
    ) {
      return '0.7× WIDE';
    }
    if (labelLower.includes('tele') || labelLower.includes('zoom')) {
      return 'TELE';
    }
    const backIdx = backDevices.findIndex(d => d.deviceId === device.deviceId);
    if (backIdx === 0) return '1× MAIN';
    if (backIdx === 1 && backDevices.length === 2) return '0.7× WIDE';
    return t.lensFallback(index + 1);
  };

  const activeModeMeta = getLocalizedModeMeta(captureMode);
  const localizedError =
    error === 'PERMISSION_DENIED'
      ? t.cameraDenied
      : error === 'LENS_ERROR'
      ? t.lensError
      : null;

  const isAfLocked =
    focusMode === 'single-shot' && focusPoint.visible && !focusPoint.working;
  const hudPillStyle =
    'bg-black/70 backdrop-blur-3xl border border-white/20 rounded-full shadow-2xl transition-all duration-300 w-fit shrink-0';
  const hudTextStyle =
    'text-[10px] font-mono font-bold uppercase tracking-wider text-white/95 tabular-nums';
  const peakingDef = getPeakingColorDef(peakingColor);
  const hudVisible = !showControls && !isAdjustingExposure && !isModifying;
  const rightHudVisible = hudVisible && countdown === null;

  return (
    <div className="relative w-full h-full bg-black select-none overflow-hidden touch-none flex flex-col">
      <SVGFilters settings={settings} />

      {/* Viewfinder */}
      <div
        ref={containerRef}
        className="relative flex-1 w-full overflow-hidden bg-black"
        onClick={handleScreenTap}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {localizedError ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-200 p-8 text-center bg-zinc-950 font-sans text-sm safe-top">
            <X size={36} className="mb-4 text-red-400" />
            <p className="max-w-xs text-zinc-300 leading-relaxed">
              {localizedError}
            </p>
            <button
              type="button"
              onClick={retryCamera}
              className="mt-6 min-h-[44px] px-6 py-2.5 border border-white/20 bg-white/5 rounded-full text-xs font-medium tracking-wide text-white active:bg-white/15 transition-colors"
            >
              {t.retry}
            </button>
          </div>
        ) : (
          <>
            <canvas
              ref={freezeCanvasRef}
              aria-hidden="true"
              className={`absolute inset-0 w-full h-full object-cover pointer-events-none z-[2] ${
                isFreezeVisible && (!isVideoReady || isCapturing)
                  ? 'opacity-100'
                  : 'opacity-0'
              }`}
              style={{
                filter: 'url(#mono-pro-filter)',
                transform:
                  !supportsNativeZoom && zoom > 1 ? `scale(${zoom})` : 'none',
              }}
            />
            {stream && (
              <video
                key={stream.id}
                ref={videoRef}
                autoPlay
                playsInline
                muted
                controls={false}
                disableRemotePlayback
                poster={TRANSPARENT_POSTER}
                onPlaying={() => {
                  setIsVideoReady(true);
                  setIsFreezeVisible(false);
                }}
                className={`w-full h-full object-cover transform ${
                  isVideoReady ? 'opacity-100' : 'opacity-0'
                }`}
                style={{
                  filter: 'url(#mono-pro-filter)',
                  transform:
                    !supportsNativeZoom && zoom > 1 ? `scale(${zoom})` : 'none',
                }}
              />
            )}
          </>
        )}

        {/* Live Optical Vignette Preview */}
        {(settings.vignette ?? 0) > 0.005 && !error && !!stream && (
          <div
            className="absolute inset-0 pointer-events-none z-[3]"
            style={{
              background: `radial-gradient(circle, transparent 42%, rgba(0, 0, 0, ${(
                (settings.vignette ?? 0) * 0.85
              ).toFixed(2)}) 100%)`,
            }}
          />
        )}

        {/* Live Organic Film Grain Preview */}
        {(settings.grain ?? 0) > 0.005 && !error && !!stream && (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none z-[4]"
            style={{
              opacity: ((settings.grain ?? 0) * 0.28).toFixed(2),
              mixBlendMode: 'overlay',
            }}
            aria-hidden="true"
          >
            <filter id="live-film-grain-overlay">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.82"
                numOctaves="2"
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <rect
              width="100%"
              height="100%"
              filter="url(#live-film-grain-overlay)"
            />
          </svg>
        )}

        {/* Focus Peaking & Highlight Zebras Live Canvas Overlay */}
        <AssistOverlay
          videoRef={videoRef}
          settings={settings}
          zoom={zoom}
          supportsNativeZoom={supportsNativeZoom}
          peakingEnabled={peakingEnabled}
          peakingColor={peakingColor}
          peakingIntensity={peakingIntensity}
          zebrasEnabled={zebrasEnabled}
          visible={!error && !!stream && !isModifying}
        />

        {/* Shutter Timer Countdown Overlay */}
        {countdown !== null && (
          <div className="absolute inset-0 z-[55] flex flex-col items-center justify-center pointer-events-none bg-black/25">
            <span className="text-8xl font-mono font-bold text-white tabular-nums drop-shadow-[0_4px_24px_rgba(0,0,0,0.85)]">
              {countdown}
            </span>
            <span className="mt-3 px-3 py-1 rounded-full bg-black/70 border border-white/20 text-[10px] font-mono uppercase tracking-widest text-zinc-200">
              {t.timerCancelHint}
            </span>
          </div>
        )}

        {/* Subtle Mechanical Shutter Blink (no blinding white flash) */}
        <div
          className={`absolute inset-0 bg-black/55 z-[60] pointer-events-none transition-opacity duration-100 ${
            isFlashing ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Real-time Luminance Histogram */}
        <div className="absolute top-24 left-5 z-20 origin-top-left">
          <Histogram
            videoRef={videoRef}
            settings={settings}
            visible={!error && !!stream && !showControls}
          />
        </div>

        {/* Left Camera Mode Triggers */}
        <div className="absolute top-[192px] left-5 z-20 flex flex-col items-start space-y-2.5 pointer-events-none">
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              setShowPeakMenu(false);
              setShowModeMenu(v => !v);
            }}
            aria-label={`${t.captureModeTitle}: ${activeModeMeta.label}`}
            className={`pointer-events-auto min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 ${hudPillStyle} ${
              captureMode === 'sensor_max'
                ? 'border-yellow-400/60'
                : captureMode === 'stream4k'
                ? 'border-blue-400/60'
                : ''
            } ${
              hudVisible
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-90 pointer-events-none'
            }`}
          >
            <Cpu
              size={12}
              className={
                captureMode === 'sensor_max'
                  ? 'text-yellow-400'
                  : captureMode === 'stream4k'
                  ? 'text-blue-400'
                  : 'text-zinc-300'
              }
            />
            <span
              className={`${hudTextStyle} ${
                captureMode === 'sensor_max'
                  ? 'text-yellow-400'
                  : captureMode === 'stream4k'
                  ? 'text-blue-300'
                  : ''
              }`}
            >
              {activeModeMeta.pillLabel}
            </span>
          </button>

          {supportsFocus && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                void toggleAFMode();
              }}
              className={`pointer-events-auto min-h-[36px] flex items-center space-x-2 px-3 py-1.5 ${hudPillStyle} ${
                hudVisible
                  ? 'opacity-100 scale-100'
                  : 'opacity-0 scale-90 pointer-events-none'
              }`}
            >
              <Target
                size={12}
                className={
                  focusMode === 'continuous' ? 'text-blue-400' : 'text-zinc-300'
                }
              />
              <span className={hudTextStyle}>
                {focusMode === 'continuous' ? t.afContinuous : t.afSingle}
              </span>
            </button>
          )}

          {/* Unfiltered Adobe DNG / Native Bayer RAW Pair Toggle */}
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              triggerLightHaptic();
              setCaptureRawOriginal(v => !v);
            }}
            aria-label={t.bwPlusDng}
            className={`pointer-events-auto min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 ${hudPillStyle} ${
              captureRawOriginal ? 'border-yellow-400/60' : ''
            } ${
              hudVisible
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-90 pointer-events-none'
            }`}
          >
            <span
              className={`${hudTextStyle} ${
                captureRawOriginal ? 'text-yellow-400' : 'text-white/75'
              }`}
            >
              {captureRawOriginal
                ? captureMode === 'sensor_max' && isProCaptureSupported()
                  ? t.bwPlusRaw
                  : t.bwPlusDng
                : t.jpgBw}
            </span>
          </button>

          {/* Horizontal Level ON/OFF Toggle */}
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              void handleToggleLevel();
            }}
            aria-pressed={showLevel}
            aria-label={showLevel ? t.levelOn : t.levelOff}
            className={`pointer-events-auto min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 ${hudPillStyle} ${
              showLevel ? 'border-green-400/55' : ''
            } ${
              hudVisible
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-90 pointer-events-none'
            }`}
          >
            <svg
              viewBox="0 0 16 16"
              className={`w-3.5 h-3.5 ${
                showLevel ? 'text-green-400' : 'text-zinc-400'
              }`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <line x1="1.5" y1="8" x2="3.5" y2="8" />
              <line x1="12.5" y1="8" x2="14.5" y2="8" />
              <line x1="5" y1="8" x2="11" y2="8" />
              <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
            </svg>
            <span
              className={`${hudTextStyle} ${
                showLevel ? 'text-green-400' : 'text-white/55'
              }`}
            >
              {showLevel ? t.levelOn : t.levelOff}
            </span>
          </button>

          {/* Framing Grid Cycle Toggle */}
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              handleCycleGrid();
            }}
            aria-label={t.gridLabels[gridMode]}
            className={`pointer-events-auto min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 ${hudPillStyle} ${
              gridMode !== 'off' ? 'border-white/40' : ''
            } ${
              hudVisible
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-90 pointer-events-none'
            }`}
          >
            <Grid3x3
              size={12}
              className={gridMode !== 'off' ? 'text-white' : 'text-zinc-400'}
            />
            <span
              className={`${hudTextStyle} ${
                gridMode !== 'off' ? 'text-white' : 'text-white/55'
              }`}
            >
              {t.gridLabels[gridMode]}
            </span>
          </button>
        </div>

        {/* Top-Right Exposure / EV Interactive Indicator */}
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            handleOpenPanel('exposure');
          }}
          onPointerUp={e => {
            e.stopPropagation();
            handleDoubleTapExposureReset(e);
          }}
          onTouchStart={e => {
            e.stopPropagation();
            startExposurePress();
          }}
          onTouchEnd={e => {
            e.stopPropagation();
            cancelExposurePress();
          }}
          className={`absolute top-24 right-5 z-50 pointer-events-auto min-h-[36px] px-3 py-1.5 cursor-pointer flex items-center gap-1.5 ${hudPillStyle} ${
            exposureMode === 'manual' ? 'border-yellow-400/50' : ''
          } ${isModifying ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
          aria-label={t.tabExposure}
        >
          <Aperture
            size={12}
            className={
              exposureMode === 'manual' ? 'text-yellow-400' : 'text-zinc-300'
            }
          />
          <span
            className={`${hudTextStyle} ${
              exposureMode === 'manual' ? 'text-yellow-400' : ''
            }`}
          >
            {exposureMode === 'manual'
              ? `${formatExposureTime(manualExposureTime)} · ${Math.round(
                  manualIso
                )}`
              : `${exposureVal > 0 ? '+' : ''}${exposureVal.toFixed(1)} EV`}
          </span>
        </button>

        {/* Right Camera Assist Triggers (Peaking, Zebras, Timer, Language) */}
        <div className="absolute top-[148px] right-5 z-20 flex flex-col items-end space-y-2.5 pointer-events-none">
          <div
            className={`flex items-center gap-1.5 transition-all duration-300 ${
              rightHudVisible
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-90 pointer-events-none'
            }`}
          >
            {peakingEnabled && (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  setShowModeMenu(false);
                  setShowPeakMenu(v => !v);
                }}
                aria-label={t.peakingIntensity}
                className={`pointer-events-auto min-h-[36px] w-9 flex items-center justify-center ${hudPillStyle}`}
                style={{
                  borderColor: showPeakMenu
                    ? peakingDef.hex
                    : `${peakingDef.hex}80`,
                }}
              >
                <SlidersHorizontal
                  size={12}
                  style={{ color: peakingDef.hex }}
                />
              </button>
            )}
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                handleTogglePeaking();
              }}
              aria-pressed={peakingEnabled}
              aria-label={t.peakingPill}
              className={`pointer-events-auto min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 ${hudPillStyle}`}
              style={
                peakingEnabled
                  ? { borderColor: `${peakingDef.hex}99` }
                  : undefined
              }
            >
              <Focus
                size={12}
                style={peakingEnabled ? { color: peakingDef.hex } : undefined}
                className={peakingEnabled ? '' : 'text-zinc-400'}
              />
              <span
                className={`${hudTextStyle} ${peakingEnabled ? '' : 'text-white/60'}`}
                style={peakingEnabled ? { color: peakingDef.hex } : undefined}
              >
                {peakingEnabled
                  ? `${t.peakingPill} ${peakingIntensity}%`
                  : t.peakingPill}
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              handleToggleZebras();
            }}
            aria-pressed={zebrasEnabled}
            aria-label={t.zebrasToggle}
            className={`pointer-events-auto min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 ${hudPillStyle} ${
              zebrasEnabled ? 'border-red-400/65' : ''
            } ${
              rightHudVisible
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-90 pointer-events-none'
            }`}
          >
            <Sun
              size={12}
              className={zebrasEnabled ? 'text-red-400' : 'text-zinc-400'}
            />
            <span
              className={`${hudTextStyle} ${
                zebrasEnabled ? 'text-red-400' : 'text-white/60'
              }`}
            >
              ZEBRA
            </span>
          </button>

          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              handleCycleTimer();
            }}
            aria-label={`${t.timerPill} (${timerSeconds}s)`}
            className={`pointer-events-auto min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 ${hudPillStyle} ${
              timerSeconds > 0 ? 'border-yellow-400/60' : ''
            } ${
              rightHudVisible
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-90 pointer-events-none'
            }`}
          >
            <Timer
              size={12}
              className={timerSeconds > 0 ? 'text-yellow-400' : 'text-zinc-400'}
            />
            <span
              className={`${hudTextStyle} ${
                timerSeconds > 0 ? 'text-yellow-400' : 'text-white/60'
              }`}
            >
              {timerSeconds > 0 ? `${timerSeconds}S` : t.timerPill}
            </span>
          </button>

          {/* Language Switcher Pill (PT / EN) */}
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              toggleLang();
            }}
            title={t.langToggleHint}
            aria-label={t.langToggleHint}
            className={`pointer-events-auto min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 ${hudPillStyle} ${
              rightHudVisible
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-90 pointer-events-none'
            }`}
          >
            <Globe size={12} className="text-zinc-300" />
            <span className={hudTextStyle}>{t.langPill}</span>
          </button>
        </div>

        {/* Floating Capture Mode Selector Popover */}
        {showModeMenu && rightHudVisible && (
          <CaptureModeMenu
            captureMode={captureMode}
            onSelectMode={handleSelectCaptureMode}
            onClose={() => setShowModeMenu(false)}
            getModeMeta={getLocalizedModeMeta}
            t={t}
          />
        )}

        {/* Floating Focus Peaking Color & Intensity Popover */}
        {showPeakMenu && rightHudVisible && (
          <PeakSettingsMenu
            peakingColor={peakingColor}
            peakingIntensity={peakingIntensity}
            onSelectColor={handleSelectPeakingColor}
            onIntensityChange={handlePeakingIntensityChange}
            onDoubleTapReset={handleDoubleTapPeakIntensityReset}
            onClose={() => setShowPeakMenu(false)}
            t={t}
          />
        )}

        {/* Pixel-Style Circular Focus Zone */}
        {focusPoint.visible && (
          <FocusReticle
            reticleRef={focusReticleRef}
            initialX={focusPoint.x}
            initialY={focusPoint.y}
            working={focusPoint.working}
            tracking={focusPoint.tracking}
            focusMode={focusMode}
            hidden={isModifying}
          />
        )}

        {/* Framing Grid Lines */}
        <FramingGrid
          mode={gridMode}
          visible={!error && !!stream && !isModifying}
        />

        {/* Horizontal Spirit Level */}
        <HorizontalLevel
          enabled={showLevel}
          visible={!error && !!stream && !showControls && !isModifying}
        />
      </div>

      {/* Top Lens Selector Bar */}
      {sortedDevices.length > 0 && (
        <div
          className={`absolute top-0 left-0 w-full flex justify-center z-[120] transition-opacity duration-300 pt-[max(var(--safe-area-top),16px)] ${
            isModifying ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          <div className="bg-black/65 backdrop-blur-3xl rounded-full border border-white/20 shadow-2xl max-w-[90vw] overflow-hidden p-1 w-max">
            <div className="flex flex-nowrap overflow-x-auto no-scrollbar items-center px-1.5 space-x-1.5 h-9">
              {sortedDevices.map((device, idx) => {
                const isActive = activeDeviceId === device.deviceId;
                const label = getLensLabel(device, idx);
                return (
                  <button
                    key={device.deviceId}
                    type="button"
                    onClick={() => handleLensClick(device.deviceId)}
                    className={`relative flex-shrink-0 px-3.5 py-1.5 rounded-full text-[10px] font-mono font-bold tracking-widest whitespace-nowrap leading-none transition-all duration-200 uppercase ${
                      isActive
                        ? 'bg-white text-black shadow-lg'
                        : 'bg-transparent text-white/55 hover:text-white/85'
                    }`}
                  >
                    <span className="block max-w-[92px] truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Thumb-Zone Quick Exposure + Zoom Strip */}
      {!showControls && (
        <div
          className={`absolute bottom-32 left-1/2 transform -translate-x-1/2 w-[90vw] max-w-sm z-40 flex flex-col items-center gap-2.5 transition-opacity ${
            isModifying ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          {isAfLocked && supportsManualFocus && (
            <div className="w-[75vw] max-w-[260px] flex items-center space-x-3 bg-black/55 backdrop-blur-2xl px-4 py-1.5 rounded-full border border-white/10 text-white shadow-xl">
              <span
                onPointerUp={handleDoubleTapFocusReset}
                title={t.resetFocusHint}
                className="flex items-center justify-end gap-1 text-[11px] font-mono font-bold text-yellow-400 w-10 shrink-0 tabular-nums cursor-pointer"
              >
                <Target size={11} className="text-yellow-400 shrink-0" />
                <span>{focusDistance.toFixed(1)}</span>
              </span>
              <input
                type="range"
                min={focusDistanceRange.min}
                max={focusDistanceRange.max}
                step="any"
                value={focusDistance}
                onPointerUp={handleDoubleTapFocusReset}
                onChange={e =>
                  setManualFocusDistance(parseFloat(e.target.value))
                }
                className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer range-thumb-style"
                aria-label="Manual focus"
              />
            </div>
          )}

          {zoomRange.max > zoomRange.min && (
            <div className="w-[75vw] max-w-[260px] flex items-center space-x-3 bg-black/55 backdrop-blur-2xl px-4 py-2 rounded-full border border-white/10 text-white shadow-xl">
              <span
                onPointerUp={handleDoubleTapZoomReset}
                title={t.resetZoomHint}
                className="text-[11px] font-mono font-bold text-yellow-400 w-9 text-right tabular-nums cursor-pointer"
              >
                {zoom.toFixed(1)}x
              </span>
              <input
                type="range"
                min={zoomRange.min}
                max={zoomRange.max}
                step={0.1}
                value={zoom}
                onPointerUp={handleDoubleTapZoomReset}
                onChange={e => setZoom(parseFloat(e.target.value))}
                className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer range-thumb-style"
                aria-label="Zoom"
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => handleOpenPanel('exposure')}
            onPointerUp={handleDoubleTapExposureReset}
            className={`min-h-[38px] px-4 py-1.5 rounded-full backdrop-blur-2xl border flex items-center gap-2.5 text-[11px] font-mono tabular-nums shadow-xl active:scale-95 transition-all ${
              exposureMode === 'manual'
                ? 'bg-black/80 border-yellow-400/50 text-yellow-300'
                : 'bg-black/60 border-white/15 text-zinc-200'
            }`}
          >
            <span className="uppercase tracking-wider text-zinc-400 text-[10px]">
              {t.lightLabel}
            </span>
            <span className="font-semibold text-white">
              {exposureMode === 'manual'
                ? formatExposureTime(manualExposureTime)
                : 'AUTO'}
            </span>
            <span aria-hidden="true" className="text-zinc-600">
              ·
            </span>
            <span className="font-semibold">
              {exposureMode === 'manual'
                ? `ISO ${Math.round(manualIso)}`
                : 'ISO AUTO'}
            </span>
          </button>
        </div>
      )}

      {/* Processing Indicator During Capture */}
      {isCapturing && (
        <div className="absolute bottom-56 left-1/2 -translate-x-1/2 z-[130] px-4 py-1.5 rounded-full bg-black/85 backdrop-blur-xl border border-yellow-400/40 text-[11px] font-mono text-yellow-300 shadow-2xl whitespace-nowrap pointer-events-none">
          {captureMode === 'sensor_max' && isProCaptureSupported()
            ? t.capturingSensor
            : t.processingImage}
        </div>
      )}

      {/* Brief Auto-Save Toast */}
      {toastMessage && (
        <div className="absolute bottom-32 left-1/2 -translate-x-1/2 z-[130] px-4 py-1.5 rounded-full bg-black/85 backdrop-blur-xl border border-white/20 text-[11px] font-mono text-white shadow-2xl whitespace-nowrap pointer-events-none">
          {toastMessage}
        </div>
      )}

      {/* Real-Time Film, Exposure, Tone Curve & Levels Drawer */}
      {showControls && (
        <div
          onTouchStart={handleControlsTouchStart}
          onTouchMove={handleControlsTouchMove}
          className={`absolute bottom-28 left-0 w-full z-[100] transition-all duration-300 flex flex-col pointer-events-auto rounded-t-3xl ${
            isModifying
              ? 'bg-transparent border-transparent shadow-none'
              : 'bg-black/80 backdrop-blur-2xl border-t border-white/15 shadow-[0_-10px_40px_rgba(0,0,0,0.9)]'
          }`}
          style={{ maxHeight: '68vh' }}
        >
          <div
            className={`relative transition-opacity duration-200 ${
              isModifying ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
          >
            <div className="w-full flex justify-center pt-2.5 pb-1">
              <div className="w-10 h-1 bg-white/25 rounded-full" />
            </div>
            <div className="flex justify-between items-center px-5 py-2 border-b border-white/10 gap-2">
              <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/10 overflow-x-auto no-scrollbar">
                {(
                  [
                    ['film', t.tabFilm],
                    ['exposure', t.tabExposure],
                    ['curves', t.tabCurves],
                    ['levels', t.tabLevels],
                  ] as const
                ).map(([tabId, label]) => (
                  <button
                    key={tabId}
                    type="button"
                    onClick={() => setActiveTab(tabId)}
                    className={`min-h-[34px] px-2.5 py-1.5 rounded-lg text-xs font-medium tracking-wide whitespace-nowrap transition-colors ${
                      activeTab === tabId
                        ? 'bg-white text-black shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={history.length === 0}
                  aria-label="Undo"
                  className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full transition-opacity ${
                    history.length === 0
                      ? 'opacity-20'
                      : 'opacity-85 hover:bg-white/10 active:scale-90'
                  }`}
                >
                  <Undo2 size={18} />
                </button>
                <button
                  type="button"
                  onClick={resetSettings}
                  aria-label={t.resetCurves}
                  className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full opacity-85 hover:bg-white/10 active:scale-90 transition-transform"
                >
                  <RotateCcw size={17} />
                </button>
              </div>
            </div>
          </div>

          <div className="relative px-5 py-4 overflow-y-auto no-scrollbar">
            {activeTab === 'film' ? (
              <FilmControl
                settings={settings}
                onApplyRecipe={recipeSettings => {
                  saveHistory();
                  setSettings(prev => ({
                    ...recipeSettings,
                    exposureGain: prev.exposureGain,
                  }));
                }}
                onChangeSetting={(key, value) => updateSetting(key, value)}
                onInteractionStart={() => {
                  saveHistory();
                  setIsAdjustingSlider(true);
                }}
                onInteractionEnd={() => setIsAdjustingSlider(false)}
                isAdjusting={isAdjustingSlider}
              />
            ) : activeTab === 'exposure' ? (
              <div className="pb-2">
                <ExposureControl
                  mode={exposureMode}
                  exposureTime={manualExposureTime}
                  exposureTimeRange={exposureTimeRange}
                  supportsExposureTime={supportsExposureTime}
                  iso={manualIso}
                  isoRange={isoRange}
                  supportsIso={supportsIso}
                  onModeChange={nextMode =>
                    applyUnifiedExposure(
                      nextMode,
                      manualExposureTime,
                      manualIso
                    )
                  }
                  onExposureTimeChange={nextTime =>
                    applyUnifiedExposure('manual', nextTime, manualIso)
                  }
                  onIsoChange={nextIso =>
                    applyUnifiedExposure('manual', manualExposureTime, nextIso)
                  }
                  onReset={() => applyUnifiedExposure('auto', 80, 200)}
                  onInteractionStateChange={setIsAdjustingManualExposure}
                  isAdjusting={isAdjustingManualExposure}
                />
              </div>
            ) : activeTab === 'curves' ? (
              <div className="w-full max-w-sm mx-auto pb-2">
                <CurvesControl
                  points={settings.curvePoints}
                  videoRef={videoRef}
                  colorFilter={settings.colorFilter}
                  onChange={pts => updateSetting('curvePoints', pts)}
                  onInteractionStateChange={setIsAdjustingCurve}
                  onInteractionStart={saveHistory}
                />
              </div>
            ) : (
              <div className="space-y-5 pb-4 max-w-sm mx-auto">
                <SliderControl
                  label={t.curveInputBlack}
                  value={settings.blackPoint}
                  defaultValue={DEFAULT_SETTINGS.blackPoint}
                  min={0}
                  max={255}
                  onChange={v => updateSetting('blackPoint', v)}
                  isAdjusting={isAdjustingSlider}
                  onInteractionStart={() => {
                    saveHistory();
                    setIsAdjustingSlider(true);
                  }}
                  onInteractionEnd={() => setIsAdjustingSlider(false)}
                />
                <SliderControl
                  label={t.curveInputWhite}
                  value={settings.whitePoint}
                  defaultValue={DEFAULT_SETTINGS.whitePoint}
                  min={0}
                  max={255}
                  onChange={v => updateSetting('whitePoint', v)}
                  isAdjusting={isAdjustingSlider}
                  onInteractionStart={() => {
                    saveHistory();
                    setIsAdjustingSlider(true);
                  }}
                  onInteractionEnd={() => setIsAdjustingSlider(false)}
                />
                <SliderControl
                  label={t.curveMidtones}
                  value={settings.midTone}
                  defaultValue={DEFAULT_SETTINGS.midTone}
                  min={0.1}
                  max={3.0}
                  step={0.1}
                  onChange={v => updateSetting('midTone', v)}
                  isAdjusting={isAdjustingSlider}
                  onInteractionStart={() => {
                    saveHistory();
                    setIsAdjustingSlider(true);
                  }}
                  onInteractionEnd={() => setIsAdjustingSlider(false)}
                />
                <SliderControl
                  label={t.curveContrast}
                  value={settings.contrast}
                  defaultValue={DEFAULT_SETTINGS.contrast}
                  min={0.5}
                  max={2.0}
                  step={0.05}
                  onChange={v => updateSetting('contrast', v)}
                  isAdjusting={isAdjustingSlider}
                  onInteractionStart={() => {
                    saveHistory();
                    setIsAdjustingSlider(true);
                  }}
                  onInteractionEnd={() => setIsAdjustingSlider(false)}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom Camera Control Bar */}
      <div
        className={`absolute bottom-0 left-0 w-full h-28 bg-gradient-to-t from-black via-black/85 to-transparent z-[110] grid grid-cols-3 items-center px-5 pb-[max(var(--safe-area-bottom),20px)] transition-all duration-300 ${
          isModifying
            ? 'opacity-0 pointer-events-none translate-y-10'
            : 'opacity-100 translate-y-0'
        }`}
      >
        <div className="justify-self-start">
          <button
            type="button"
            onClick={onGalleryClick}
            aria-label={t.galleryTitle}
            className="w-12 h-12 rounded-xl bg-zinc-900/85 border border-white/15 overflow-hidden relative shadow-2xl active:scale-90 transition-transform flex items-center justify-center"
          >
            {lastImage ? (
              <img
                src={lastImage.thumbnailUrl || lastImage.url}
                alt={t.galleryTitle}
                className="w-full h-full object-cover"
              />
            ) : (
              <ImageIcon size={20} className="text-zinc-500" />
            )}
          </button>
        </div>

        <div className="justify-self-center">
          <button
            type="button"
            onClick={handleCapture}
            disabled={!stream || isCapturing}
            aria-label={countdown !== null ? t.cancel : 'Shutter'}
            className={`w-20 h-20 rounded-full border-4 flex items-center justify-center bg-transparent active:scale-95 transition-all shadow-[0_0_20px_rgba(255,255,255,0.12)] ${
              countdown !== null ? 'border-yellow-400' : 'border-white/25'
            } ${isCapturing || !stream ? 'opacity-50' : ''}`}
          >
            <div
              className={`w-16 h-16 rounded-full shadow-inner transition-colors ${
                countdown !== null ? 'bg-yellow-400' : 'bg-white'
              }`}
            />
          </button>
        </div>

        <div className="justify-self-end flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleOpenPanel('curves')}
            aria-label={t.tabCurves}
            className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-2xl ${
              showControls && activeTab === 'curves'
                ? 'bg-white text-black scale-105'
                : 'bg-zinc-900/90 text-white border border-white/15 active:scale-90'
            }`}
          >
            <svg viewBox="0 0 22 22" className="w-5 h-5">
              <path
                d="M2 20 L20 2"
                stroke="currentColor"
                strokeOpacity="0.25"
                strokeWidth="1"
                strokeDasharray="2 2"
                fill="none"
              />
              <path
                d={miniCurvePath}
                stroke={
                  showControls && activeTab === 'curves'
                    ? '#000000'
                    : hasCustomCurve
                    ? '#facc15'
                    : '#ffffff'
                }
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>

          <button
            type="button"
            onClick={() =>
              handleOpenPanel(showControls ? activeTab : 'film')
            }
            aria-label={showControls ? t.cancel : t.tabFilm}
            className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-2xl ${
              showControls && activeTab !== 'curves'
                ? 'bg-white text-black scale-105'
                : exposureMode === 'manual' ||
                  (settings.colorFilter ?? 'neutral') !== 'neutral' ||
                  (settings.grain ?? 0) > 0.01 ||
                  (settings.vignette ?? 0) > 0.01
                ? 'bg-zinc-900/90 text-yellow-400 border border-yellow-400/50 active:scale-90'
                : 'bg-zinc-900/90 text-white border border-white/15 active:scale-90'
            }`}
          >
            {showControls ? <ChevronDown size={20} /> : <Sliders size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CameraInterface;
