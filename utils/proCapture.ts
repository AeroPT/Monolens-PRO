import { Capacitor, registerPlugin } from '@capacitor/core';
import { CaptureMode } from '../types';

export interface ProCapturePlugin {
  getCapabilities(options: {
    deviceLabel: string;
    lensHint: string;
  }): Promise<{
    cameraId: string;
    maxWidth: number;
    maxHeight: number;
    rawSupported: boolean;
    minZoom?: number;
    maxZoom?: number;
    physicalTeleZoom?: number;
  }>;

  captureStill(options: {
    deviceLabel: string;
    lensHint: string;
    captureRaw: boolean;
    autoSaveRaw: boolean;
    focusX: number;
    focusY: number;
    focusMode: 'continuous' | 'single-shot';
    exposureMode: 'auto' | 'manual';
    exposureTimeNs?: number;
    iso?: number;
    exposureCompensationEv?: number;
    zoomRatio?: number;
  }): Promise<{
    jpegPath: string;
    width: number;
    height: number;
    exposureTimeNs: number;
    iso: number;
    rawSupported: boolean;
    dngPath?: string;
    dngSavedToGallery?: boolean;
  }>;

  startLivePreview(options: {
    deviceLabel: string;
    lensHint: string;
    focusX: number;
    focusY: number;
    focusMode: 'continuous' | 'single-shot';
    exposureMode: 'auto' | 'manual';
    exposureTimeNs?: number;
    iso?: number;
    exposureCompensationEv?: number;
    zoomRatio?: number;
  }): Promise<{
    url: string;
    width: number;
    height: number;
  }>;

  stopLivePreview(): Promise<void>;

  updatePreviewZoom(options: { zoomRatio: number }): Promise<void>;

  updatePreviewFocus(options: {
    focusX: number;
    focusY: number;
    focusMode: 'continuous' | 'single-shot';
  }): Promise<void>;

  updatePreviewExposure(options: {
    exposureMode: 'auto' | 'manual';
    exposureTimeNs?: number;
    iso?: number;
    exposureCompensationEv?: number;
  }): Promise<void>;
}

export const ProCapture = registerPlugin<ProCapturePlugin>('ProCapture');

export interface CaptureModeMeta {
  id: CaptureMode;
  label: string;
  pillLabel: string;
  resolutionHint: string;
  description: string;
}

export const CAPTURE_MODES: CaptureModeMeta[] = [
  {
    id: 'fast',
    label: 'Rápido (2.8 MP)',
    pillLabel: '2.8M RÁPIDO',
    resolutionHint: '1920×1440 · 0ms',
    description:
      'Captura instantânea sem ruído idêntica ao visor, máxima fluidez no Peaking e histograma.',
  },
  {
    id: 'stream4k',
    label: 'Stream 4K (8–12 MP)',
    pillLabel: '4K STREAM',
    resolutionHint: 'Até 12 MP · Contínuo',
    description:
      'Pede ao sensor a resolução máxima de vídeo suportada, com captura rápida e NR temporal.',
  },
  {
    id: 'sensor_max',
    label: 'Sensor Máx (Camera2)',
    pillLabel: 'PRO MÁX',
    resolutionHint: '12.5 MP + RAW Bayer',
    description:
      'Resolução total do sensor via Camera2 nativo, AF por zona exata, NR de alta qualidade e DNG real.',
  },
];

export const isProCaptureSupported = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const inferLensHint = (
  label: string
): 'front' | 'wide' | 'tele' | 'main' => {
  const lower = (label || '').toLowerCase();
  if (lower.includes('front')) return 'front';
  if (
    lower.includes('ultra') ||
    lower.includes('wide') ||
    lower.includes('0.7') ||
    lower.includes('0.6')
  ) {
    return 'wide';
  }
  if (lower.includes('tele') || lower.includes('zoom')) return 'tele';
  return 'main';
};
