import { FilterSettings } from '../types';
import { getCurveLut } from './curveMath';

/**
 * Generates the Look-Up Table (LUT) based on current filter settings.
 * Maps input values (0-255) to output values (0-255).
 */
export const generateLut = (settings: FilterSettings): Uint8Array => {
  const { blackPoint, whitePoint, midTone, contrast, outputBlack, outputWhite, curvePoints } = settings;

  // Generate Curve LUT (0.0 - 1.0)
  const curveLutFloat = getCurveLut(curvePoints);

  const lut = new Uint8Array(256);
  
  for (let i = 0; i < 256; i++) {
    // 1. Normalize input [0, 255] -> [0, 1] based on input levels
    let val = (i - blackPoint) / (whitePoint - blackPoint);
    
    // Clamp
    val = Math.max(0, Math.min(1, val));

    // 2. Apply Gamma (Midtone)
    // Gamma correction: val = val ^ (1 / gamma)
    if (midTone !== 1 && val > 0) {
      val = Math.pow(val, 1 / midTone);
    }

    // 3. Apply Contrast
    // Pivot around 0.5
    if (contrast !== 1) {
        val = (val - 0.5) * contrast + 0.5;
        val = Math.max(0, Math.min(1, val)); // Clamp again after contrast
    }

    // 4. Apply Curves (Map 0-1 val to 0-255 index for Curve LUT)
    const curveIndex = Math.round(val * 255);
    val = curveLutFloat[curveIndex];

    // 5. Map to Output Levels [0, 1] -> [outBlack, outWhite]
    let outVal = val * (outputWhite - outputBlack) + outputBlack;
    
    // Final Clamp
    lut[i] = Math.max(0, Math.min(255, Math.round(outVal)));
  }
  
  return lut;
};

/**
 * Applies the LUT filter to raw image data in place.
 */
const applyFiltersToImageData = (data: Uint8ClampedArray, lut: Uint8Array) => {
  for (let i = 0; i < data.length; i += 4) {
    // Grayscale (Luma method: Rec 709)
    const gray = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    
    // Apply LUT
    const finalVal = lut[Math.round(gray)];

    data[i] = finalVal;     // R
    data[i + 1] = finalVal; // G
    data[i + 2] = finalVal; // B
    // Alpha (data[i+3]) remains unchanged
  }
};

/**
 * Capture from Video Element (Fallback / Preview Resolution)
 */
export const processImage = (
  video: HTMLVideoElement,
  settings: FilterSettings,
  zoom: number,
  isNativeZoom: boolean
): { url: string; width: number; height: number } => {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return { url: '', width: 0, height: 0 };

  // Draw frame with Zoom logic
  if (isNativeZoom || zoom === 1) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  } else {
    // Digital Zoom: Crop center
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cropW = vw / zoom;
    const cropH = vh / zoom;
    const sx = (vw - cropW) / 2;
    const sy = (vh - cropH) / 2;
    
    ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);
  }

  // Get raw pixel data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  // Apply Filters
  const lut = generateLut(settings);
  applyFiltersToImageData(imageData.data, lut);

  ctx.putImageData(imageData, 0, 0);
  
  return {
    url: canvas.toDataURL('image/jpeg', 0.95),
    width: canvas.width,
    height: canvas.height
  };
};

/**
 * Process High-Resolution Blob (from ImageCapture API)
 */
export const processHighResPhoto = async (
  blob: Blob,
  settings: FilterSettings,
  zoom: number,
  isNativeZoom: boolean
): Promise<{ url: string; width: number; height: number }> => {
  // 1. Convert Blob to ImageBitmap (Fastest way to handle blobs)
  const bitmap = await createImageBitmap(blob);
  
  const canvas = document.createElement('canvas');
  // Set canvas to the full resolution of the captured photo
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Context creation failed");

  // 2. Handle Zoom cropping on the High Res image
  // If native zoom is active, the blob is likely already zoomed/cropped by hardware or full frame depending on implementation.
  // Standard ImageCapture usually returns full sensor data unless zoom is applied at track level.
  // We assume: If isNativeZoom is false, we MUST crop digitally.
  
  if (isNativeZoom || zoom === 1) {
      ctx.drawImage(bitmap, 0, 0);
  } else {
      // Digital Zoom logic applied to the high-res bitmap
      const cropW = bitmap.width / zoom;
      const cropH = bitmap.height / zoom;
      const sx = (bitmap.width - cropW) / 2;
      const sy = (bitmap.height - cropH) / 2;
      
      // Resize canvas to match the crop (optional: or keep full size and scale up?)
      // Usually digital zoom results in smaller image or upscaled blurry image.
      // Let's keep the canvas size high (upscale) to maintain 'file dimensions' or resize canvas to crop?
      // Standard behavior: Output image is usually same dimensions, just cropped & scaled.
      ctx.drawImage(bitmap, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);
  }
  
  // 3. Get Data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  // 4. Apply Filters
  const lut = generateLut(settings);
  applyFiltersToImageData(imageData.data, lut);
  
  // 5. Save
  ctx.putImageData(imageData, 0, 0);
  
  return {
      url: canvas.toDataURL('image/jpeg', 0.95),
      width: canvas.width,
      height: canvas.height
  };
};