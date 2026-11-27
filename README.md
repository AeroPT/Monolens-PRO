# MonoLens Pro

> Professional monochromatic camera application for Android — built with React, TypeScript, real-time SVG/Canvas image processing, and a native Android Camera2 + RAW DNG bridge.

**MonoLens Pro** is dedicated exclusively to Black & White photography. Inspired by classic monochrome rangefinders and modern computational cameras, it pairs a zero-latency live monochrome viewfinder with native Android Camera2 full-sensor capture, real Bayer RAW (`.dng`) support, optical color-filter emulation, and direct Snapseed handoff.

---

## Key Features

### Capture Modes & Native Camera2 Engine
- **Fast (2.8 MP):** Zero-shutter-lag capture (`1920×1440`) matching the live viewfinder with maximum focus peaking and histogram smoothness.
- **4K Stream (8–12 MP):** High-resolution stream capture (`4032×3024` / `3840×2160`) holding a synchronous freeze-frame of the viewfinder during processing for a flash-free shutter transition.
- **Max Sensor (Camera2 Native — Android):** Direct native `Camera2` still capture (`ProCapturePlugin.java`) at full sensor resolution (up to 12.5 MP) with spot AF metering, high-quality noise reduction, and **real Bayer RAW (`.dng`)** output alongside B&W JPEG.
- **Ultra-Wide (`0.7×`) Native Live Preview (Android):** On devices where WebView/WebRTC restricts zoom to `≥ 1×` (such as Pixel logical multi-camera setups), zooming below `0.95×` seamlessly switches to a low-latency localhost Camera2 `YUV_420_888` → MJPEG live preview stream (`127.0.0.1`) with dedicated background encoding, block-copied YUV rotation, and 30 fps AE targeting—preserving real-time B&W SVG filters, peaking, zebras, histogram, and tap-to-focus.
- **B&W + RAW / DNG Dual Capture:** Optionally store an unfiltered original / Adobe DNG alongside each processed monochrome frame for later re-editing or external RAW workflows.

### Optical Monochrome & Film Engine
- **6 Optical B&W Color Filters:** Neutral (`Rec.709`), Yellow `#8`, Orange `#21`, Red `#25`, Green `#11`, and Blue `#47` channel weighting—applied identically in the live viewfinder and final high-precision 12-bit export pipeline.
- **Film Recipes:** Built-in presets (**Padrão P&B**, **Tri-X 400**, **Ilford HP5**, **Delta 100**, **Noir Rua**) plus custom user-saved recipes persisted locally.
- **Film Texture:** Real-time and export-matched **Analog Film Grain** and **Optical Vignette**.
- **Precision Tone Pipeline:**
  - **Tone Curves:** Interactive monotone cubic spline editor with live luminance histogram overlay.
  - **Levels & Gamma:** Input Black/White points, Gamma mid-tones, and pivoted Contrast.

### Viewfinder & Pro Camera Controls
- **Focus & Tracking:** Tap-to-focus with visual object tracking (`VisualObjectTracker`), **AF-C / AF-S** lock toggle, contrast autofocus sweep, and manual focal distance slider.
- **Exposure Control:** Vertical swipe or HUD control for EV compensation, plus **Manual Shutter Speed & ISO** overrides (with software exposure gain fallback).
- **Focus Peaking & Zebras:** Real-time edge peaking (5 selectable highlight colors + adjustable intensity) and highlight clipping zebras (`>95%`).
- **Composition Tools:** Framing grids (`3×3`, `4×4`, `Phi`, `Diagonals`), gyroscope **Horizontal Spirit Level**, live luminance **Histogram**, pinch-to-zoom / slider zoom, multi-lens selector (`1× MAIN`, `0.7× WIDE`, `TELE`, `FRONT`), and self-timer (`OFF`, `3s`, `10s`).
- **Bilingual Interface (PT / EN):** Instant Portuguese / English language switcher available in both the camera HUD and gallery.

### Integrated Gallery, Non-Destructive Editor & Snapseed
- **High-Performance Gallery:** IndexedDB persistence, pinch-to-zoom / pan viewer, swipe navigation, B&W vs. Original/DNG toggle, image metadata inspector, and long-press multi-select batch deletion.
- **Non-Destructive Re-Editor:** Adjust filters, curves, levels, grain, and vignette on captured photos and save edited copies without overwriting originals.
- **Native Android Export (`MediaSaverPlugin`):** Saves B&W JPEGs and `.dng` RAW files directly to `Pictures/MonoLensPro` via Android `MediaStore`.
- **Smart Snapseed Handoff:** Tapping the **Snapseed** icon in the gallery viewer opens the B&W JPEG directly in Snapseed (`com.niksoftware.snapseed`) via `FileProvider`, or—when a **RAW `.dng`** file is also attached to the capture—prompts you to choose between opening the **RAW (`.dng`)** or the **B&W (`.jpg`)**.

---

## Tech Stack

- **Frontend:** [React 19](https://react.dev/) + TypeScript
- **Build & Styling:** [Vite 6](https://vitejs.dev/) + [Tailwind CSS 3](https://tailwindcss.com/)
- **Image Pipeline:** Real-time SVG filter graph (`#mono-pro-filter`) + 12-bit LUT Canvas encoder + custom DNG encoder (`dngEncoder.ts`)
- **Native Bridge:** [Capacitor 6](https://capacitorjs.com/) (`App`, `Filesystem`, `Haptics`, `StatusBar`) + custom Android Java plugins (`ProCapturePlugin`, `MediaSaverPlugin`)
- **Icons:** [Lucide React](https://lucide.dev/)

---

## Prerequisites (Windows / macOS / Linux)

1. **Node.js** (LTS recommended) — [nodejs.org](https://nodejs.org/)
2. **Android Studio** (for building the Android APK) with:
   - Android SDK & Platform Tools
   - Embedded JDK (`jbr`) or system Java 17+

---

## Development & Build Commands

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Web Development Server
```bash
npm run dev
```
Open `http://localhost:3000`.
> *Note: Native Camera2 (`Max Sensor`), MediaStore export, Haptics, Status Bar, and direct Snapseed intent require running on Android; the browser uses the Web `MediaStream` fallback.*

### 3. Build & Sync Android Assets
```bash
npm run android:sync
```
*(Runs `vite build && npx cap sync android`)*

### 4. Build Debug APK (One Command)
```bash
npm run android:apk
```
This runs `npm run build`, `npx cap sync android`, and `node scripts/build-apk.mjs` (auto-detecting `ANDROID_HOME` and Android Studio's JDK on Windows) to output:
```text
android/app/build/outputs/apk/debug/app-debug.apk
```

### 5. Open in Android Studio
```bash
npx cap open android
```

---

## Project Structure

```text
monolens-pro/
├── android/
│   └── app/src/main/
│       ├── AndroidManifest.xml
│       ├── res/xml/
│       │   ├── config.xml
│       │   ├── file_paths.xml               # FileProvider paths for Snapseed export
│       │   └── network_security_config.xml  # Localhost-only cleartext for MJPEG preview
│       └── java/com/monolens/pro/
│           ├── MainActivity.java            # Capacitor plugin registration & WebView config
│           ├── ProCapturePlugin.java        # Native Camera2 capture, Bayer DNG & Ultra-Wide MJPEG stream
│           └── MediaSaverPlugin.java        # MediaStore export & Snapseed FileProvider launcher
├── components/
│   ├── AssistOverlay.tsx                    # Live Focus Peaking & Highlight Zebras
│   ├── CameraInterface.tsx                  # Main viewfinder (WebRTC + native MJPEG), HUD & controls
│   ├── CaptureModeMenu.tsx                  # Fast / 4K Stream / Max Sensor selector
│   ├── CurvesControl.tsx                    # Interactive spline tone curve & histogram
│   ├── ExposureControl.tsx                  # Auto EV & Manual Shutter/ISO controls
│   ├── FilmControl.tsx                      # Optical B&W filters, film recipes, grain & vignette
│   ├── FocusReticle.tsx                     # Pixel-style tap/tracking AF reticle
│   ├── FramingGrid.tsx                      # 3x3, 4x4, Phi, Diagonals overlays
│   ├── Gallery.tsx                          # Photo grid, viewer, batch delete, export & Snapseed chooser
│   ├── GalleryEditor.tsx                    # Non-destructive gallery re-editing sheet
│   ├── Histogram.tsx                        # Real-time luminance histogram
│   ├── HorizontalLevel.tsx                  # Gyroscope spirit level
│   ├── PeakSettingsMenu.tsx                 # Peaking color & intensity popover
│   ├── SVGFilters.tsx                       # Hardware-accelerated SVG monochrome pipeline
│   ├── SliderControl.tsx                    # Tactile parameter slider
│   └── ZoomableImageView.tsx                # Pinch-to-zoom & pan gallery viewer
├── hooks/
│   └── useCamera.ts                         # WebRTC MediaStream, multi-lens, zoom range, AF & exposure
├── scripts/
│   └── build-apk.mjs                        # Cross-platform Gradle debug APK build helper
├── utils/
│   ├── bwFilters.ts                         # Optical B&W channel weights & built-in film recipes
│   ├── cameraPrefs.ts                       # Persistent camera preferences (localStorage)
│   ├── contrastAutofocus.ts                 # Software contrast AF sweep
│   ├── curveMath.ts                         # Monotone cubic spline LUT generator
│   ├── dngEncoder.ts                        # Adobe DNG encoder & Base64 helpers
│   ├── i18n.tsx                             # PT / EN localization context & dictionary
│   ├── imageProcessing.ts                   # 12-bit LUT, grain, vignette & thumbnail processing
│   ├── mediaSave.ts                         # MediaStore saver & Snapseed launcher bridge
│   ├── objectTracker.ts                     # Live viewfinder visual AF target tracker
│   ├── previewMedia.ts                      # Unified HTMLVideoElement / HTMLImageElement preview helpers
│   ├── proCapture.ts                        # JS bridge for native Camera2 ProCapturePlugin
│   ├── storage.ts                           # IndexedDB gallery storage
│   └── useDoubleTap.ts                      # Double-tap reset gesture hook
├── App.tsx
├── index.tsx
├── index.css
├── metadata.json
├── package.json
└── types.ts
```

---

## License

Distributed under the MIT License. See `LICENSE` for more information.
