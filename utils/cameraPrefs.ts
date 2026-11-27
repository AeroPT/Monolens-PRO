import {
  CaptureMode,
  DEFAULT_SETTINGS,
  FilterSettings,
  PeakingColorId,
} from '../types';
import { FocusMode } from '../hooks/useCamera';
import { GridMode, GRID_MODE_ORDER } from '../components/FramingGrid';
import { PEAKING_COLORS } from '../components/AssistOverlay';
import { cloneFilterSettings } from './bwFilters';
import { isProCaptureSupported } from './proCapture';

export const STORAGE_KEYS = {
  captureMode: 'monolens_capture_mode_v1',
  filterSettings: 'monolens_filter_settings_v1',
  captureDng: 'monolens_capture_dng_v1',
  focusMode: 'monolens_focus_mode_v1',
  exposurePrefs: 'monolens_exposure_prefs_v1',
  levelEnabled: 'monolens_level_enabled',
  gridMode: 'monolens_grid_mode',
  peaking: 'monolens_peaking',
  peakingColor: 'monolens_peaking_color',
  peakingIntensity: 'monolens_peaking_intensity',
  zebras: 'monolens_zebras',
  timer: 'monolens_timer',
} as const;

export interface StoredExposurePrefs {
  mode: 'auto' | 'manual';
  exposureTime: number;
  iso: number;
  ev: number;
}

export const safeGetItem = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const safeSetItem = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota / security errors
  }
};

export const loadSavedCaptureMode = (): CaptureMode => {
  const saved = safeGetItem(STORAGE_KEYS.captureMode);
  if (saved === 'fast' || saved === 'stream4k' || saved === 'sensor_max') {
    return saved;
  }
  return isProCaptureSupported() ? 'sensor_max' : 'fast';
};

export const loadSavedFilterSettings = (): FilterSettings => {
  try {
    const raw = safeGetItem(STORAGE_KEYS.filterSettings);
    if (!raw) return cloneFilterSettings(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<FilterSettings>;
    const base = cloneFilterSettings(DEFAULT_SETTINGS);
    return {
      ...base,
      ...parsed,
      exposureGain: 1.0,
      curvePoints:
        Array.isArray(parsed.curvePoints) && parsed.curvePoints.length >= 2
          ? parsed.curvePoints.map(p => ({
              x: typeof p.x === 'number' ? p.x : 0,
              y: typeof p.y === 'number' ? p.y : 0,
            }))
          : base.curvePoints,
    };
  } catch {
    return cloneFilterSettings(DEFAULT_SETTINGS);
  }
};

export const loadSavedFocusMode = (): FocusMode => {
  return safeGetItem(STORAGE_KEYS.focusMode) === 'single-shot'
    ? 'single-shot'
    : 'continuous';
};

export const loadSavedExposurePrefs = (): StoredExposurePrefs => {
  try {
    const raw = safeGetItem(STORAGE_KEYS.exposurePrefs);
    if (!raw) return { mode: 'auto', exposureTime: 80, iso: 200, ev: 0 };
    const parsed = JSON.parse(raw) as Partial<StoredExposurePrefs>;
    return {
      mode: parsed.mode === 'manual' ? 'manual' : 'auto',
      exposureTime:
        typeof parsed.exposureTime === 'number' && parsed.exposureTime > 0
          ? parsed.exposureTime
          : 80,
      iso: typeof parsed.iso === 'number' && parsed.iso > 0 ? parsed.iso : 200,
      ev:
        typeof parsed.ev === 'number' && Number.isFinite(parsed.ev)
          ? parsed.ev
          : 0,
    };
  } catch {
    return { mode: 'auto', exposureTime: 80, iso: 200, ev: 0 };
  }
};

export const loadSavedBool = (key: string, defaultValue: boolean): boolean => {
  const saved = safeGetItem(key);
  return saved === null ? defaultValue : saved === 'true';
};

export const loadSavedGridMode = (): GridMode => {
  const saved = safeGetItem(STORAGE_KEYS.gridMode) as GridMode | null;
  return saved && GRID_MODE_ORDER.includes(saved) ? saved : '3x3';
};

export const loadSavedPeakingColor = (): PeakingColorId => {
  const saved = safeGetItem(STORAGE_KEYS.peakingColor) as PeakingColorId | null;
  return saved && PEAKING_COLORS.some(c => c.id === saved) ? saved : 'yellow';
};

export const loadSavedPeakingIntensity = (): number => {
  const saved = Number(safeGetItem(STORAGE_KEYS.peakingIntensity));
  return Number.isFinite(saved) && saved >= 10 && saved <= 100 ? saved : 55;
};

export const loadSavedTimerSeconds = (): 0 | 3 | 10 => {
  const saved = Number(safeGetItem(STORAGE_KEYS.timer));
  return saved === 3 || saved === 10 ? saved : 0;
};
