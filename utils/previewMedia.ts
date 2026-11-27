export type PreviewMediaElement = HTMLVideoElement | HTMLImageElement;

export const isPreviewReady = (
  el: PreviewMediaElement | null | undefined
): boolean => {
  if (!el) return false;
  if (el instanceof HTMLVideoElement) {
    return el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0;
  }
  // Note: for multipart/x-mixed-replace MJPEG streams, naturalWidth/Height
  // become positive on the first decoded frame even while the HTTP stream stays open.
  return el.naturalWidth > 0 && el.naturalHeight > 0;
};

export const getPreviewDimensions = (
  el: PreviewMediaElement | null | undefined
): { width: number; height: number } => {
  if (!el) return { width: 0, height: 0 };
  if (el instanceof HTMLVideoElement) {
    return { width: el.videoWidth, height: el.videoHeight };
  }
  return { width: el.naturalWidth, height: el.naturalHeight };
};
