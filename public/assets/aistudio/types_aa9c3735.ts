export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface Point {
  x: number;
  y: number;
}

export type BwColorFilterId =
  | 'neutral'
  | 'yellow'
  | 'orange'
  | 'red'
  | 'green'
  | 'blue';

export type PeakingColorId =
  | 'yellow'
  | 'red'
  | 'cyan'
  | 'green'
  | 'white';

export type CaptureMode = 'fast' | 'stream4k' | 'sensor_max';

export interface FilterSettings {
  blackPoint: number; // 0-255 (Input Black)
  whitePoint: number; // 0-255 (Input White)
  midTone: number;    // 0.1-3.0 (Gamma)
  contrast: number;   // 0.5-2.0 (1.0 is neutral)
  outputBlack: number; // 0-255
  outputWhite: number; // 0-255
  exposureGain: number; // 0.25-4.0 (1.0 is neutral; fallback EV gain when sensor lacks manual mode)
  curvePoints: Point[]; // [{x:0,y:0}, {x:1,y:1}]
  colorFilter?: BwColorFilterId; // Optical B&W channel filter
  grain?: number; // 0-1 organic film grain intensity
  vignette?: number; // 0-1 optical edge falloff intensity
}

export const DEFAULT_SETTINGS: FilterSettings = {
  blackPoint: 0,
  whitePoint: 255,
  midTone: 1.0,
  contrast: 1.0,
  outputBlack: 0,
  outputWhite: 255,
  exposureGain: 1.0,
  curvePoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  colorFilter: 'neutral',
  grain: 0,
  vignette: 0,
};

export interface FilmRecipe {
  id: string;
  name: string;
  isBuiltIn?: boolean;
  settings: FilterSettings;
}

export interface CapturedImage {
  id: string;
  url: string;
  thumbnailUrl?: string;
  originalUrl?: string;
  dngBuffer?: ArrayBuffer;
  dngFilePath?: string;
  captureMode?: CaptureMode;
  timestamp: number;
  settings: FilterSettings;
  width?: number;
  height?: number;
}