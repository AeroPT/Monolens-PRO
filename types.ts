export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface FilterSettings {
  blackPoint: number; // 0-255 (Input Black)
  whitePoint: number; // 0-255 (Input White)
  midTone: number;    // 0.1-3.0 (Gamma)
  contrast: number;   // 0.5-2.0 (1.0 is neutral)
  outputBlack: number; // 0-255
  outputWhite: number; // 0-255
  curvePoints: Point[]; // [{x:0,y:0}, {x:1,y:1}]
}

export const DEFAULT_SETTINGS: FilterSettings = {
  blackPoint: 0,
  whitePoint: 255,
  midTone: 1.0,
  contrast: 1.0,
  outputBlack: 0,
  outputWhite: 255,
  curvePoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
};

export interface CapturedImage {
  id: string;
  url: string;
  timestamp: number;
  settings: FilterSettings;
  width?: number;
  height?: number;
}