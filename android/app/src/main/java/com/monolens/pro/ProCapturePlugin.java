package com.monolens.pro;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.SurfaceTexture;
import android.graphics.YuvImage;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CameraMetadata;
import android.hardware.camera2.CaptureFailure;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.CaptureResult;
import android.hardware.camera2.DngCreator;
import android.hardware.camera2.TotalCaptureResult;
import android.hardware.camera2.params.MeteringRectangle;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.ExifInterface;
import android.media.Image;
import android.media.ImageReader;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.HandlerThread;
import android.provider.MediaStore;
import android.util.Range;
import android.util.Rational;
import android.util.Size;
import android.view.Surface;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@CapacitorPlugin(
    name = "ProCapture",
    permissions = {
        @Permission(
            alias = "camera",
            strings = { Manifest.permission.CAMERA }
        )
    }
)
public class ProCapturePlugin extends Plugin {

    private static final Pattern CAMERA2_ID_PATTERN = Pattern.compile("camera2\\s+(\\d+)", Pattern.CASE_INSENSITIVE);
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private final Object previewLock = new Object();
    private volatile LivePreviewSession activePreview = null;

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        new Thread(this::stopLivePreviewInternal, "MonoLensPreviewPauseStop").start();
    }

    @Override
    protected void handleOnDestroy() {
        stopLivePreviewInternal();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        String deviceLabel = call.getString("deviceLabel", "");
        String lensHint = call.getString("lensHint", "main");
        try {
            CameraManager manager = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
            if (manager == null) {
                call.reject("CAMERA_MANAGER_UNAVAILABLE");
                return;
            }
            String cameraId = resolveCameraId(manager, deviceLabel, lensHint);
            if (cameraId == null) {
                call.reject("NO_CAMERA_FOUND");
                return;
            }
            CameraCharacteristics chars = manager.getCameraCharacteristics(cameraId);
            StreamConfigurationMap map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            Size maxJpeg = map != null ? maxByArea(map.getOutputSizes(ImageFormat.JPEG)) : null;
            boolean rawCapable = supportsRawCapture(chars, map);

            float minZoom = 1.0f;
            float maxZoom = 1.0f;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Range<Float> zRange = chars.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE);
                if (zRange != null) {
                    minZoom = zRange.getLower();
                    maxZoom = zRange.getUpper();
                }
            }
            if (maxZoom <= 1.0f) {
                Float maxDigital = chars.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM);
                if (maxDigital != null && maxDigital > 1.0f) {
                    maxZoom = maxDigital;
                }
            }

            double physicalTeleZoom = 0.0;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                try {
                    float[] mainFocals = chars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS);
                    float baseFocal = (mainFocals != null && mainFocals.length > 0) ? mainFocals[0] : 0f;
                    if (baseFocal > 0f) {
                        for (String physId : chars.getPhysicalCameraIds()) {
                            CameraCharacteristics pChars = manager.getCameraCharacteristics(physId);
                            float[] pFocals = pChars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS);
                            if (pFocals != null && pFocals.length > 0) {
                                float ratio = pFocals[0] / baseFocal;
                                if (ratio > 2.2f && ratio > physicalTeleZoom && ratio <= maxZoom + 0.5f) {
                                    physicalTeleZoom = ratio;
                                }
                            }
                        }
                    }
                } catch (Exception ignored) {}
            }

            JSObject ret = new JSObject();
            ret.put("cameraId", cameraId);
            ret.put("maxWidth", maxJpeg != null ? maxJpeg.getWidth() : 0);
            ret.put("maxHeight", maxJpeg != null ? maxJpeg.getHeight() : 0);
            ret.put("rawSupported", rawCapable);
            ret.put("minZoom", minZoom);
            ret.put("maxZoom", maxZoom);
            if (physicalTeleZoom > 0.0) {
                ret.put("physicalTeleZoom", Math.round(physicalTeleZoom * 10.0) / 10.0);
            }
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("CAPABILITIES_ERROR: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void startLivePreview(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
            && getPermissionState("camera") != PermissionState.GRANTED) {
            call.reject("CAMERA_PERMISSION_DENIED");
            return;
        }
        startLivePreviewAsync(call);
    }

    @PluginMethod
    public void stopLivePreview(PluginCall call) {
        getBridge().execute(() -> {
            stopLivePreviewInternal();
            call.resolve();
        });
    }

    @PluginMethod
    public void updatePreviewZoom(PluginCall call) {
        Double zoomObj = call.getDouble("zoomRatio", 1.0);
        final double nextZoom = clamp(zoomObj != null ? zoomObj : 1.0, 0.4, 10.0);
        final LivePreviewSession session = activePreview;
        if (session == null || session.closed) {
            call.resolve();
            return;
        }
        session.zoomRatio = nextZoom;
        session.postRepeatingUpdate(false);
        call.resolve();
    }

    @PluginMethod
    public void updatePreviewFocus(PluginCall call) {
        Double fxObj = call.getDouble("focusX", 0.5);
        Double fyObj = call.getDouble("focusY", 0.5);
        String fMode = call.getString("focusMode", "continuous");
        final LivePreviewSession session = activePreview;
        if (session == null || session.closed) {
            call.resolve();
            return;
        }
        session.focusX = clamp(fxObj != null ? fxObj : 0.5, 0.05, 0.95);
        session.focusY = clamp(fyObj != null ? fyObj : 0.5, 0.05, 0.95);
        session.focusMode = fMode != null ? fMode : "continuous";
        session.postRepeatingUpdate(true);
        call.resolve();
    }

    @PluginMethod
    public void updatePreviewExposure(PluginCall call) {
        String expMode = call.getString("exposureMode", "auto");
        Long expObj = call.getLong("exposureTimeNs", 0L);
        Integer isoObj = call.getInt("iso", 0);
        Double evObj = call.getDouble("exposureCompensationEv", 0.0);
        final LivePreviewSession session = activePreview;
        if (session == null || session.closed) {
            call.resolve();
            return;
        }
        session.exposureMode = expMode != null ? expMode : "auto";
        session.exposureTimeNs = expObj != null ? expObj : 0L;
        session.iso = isoObj != null ? isoObj : 0;
        session.ev = evObj != null ? evObj : 0.0;
        session.postRepeatingUpdate(false);
        call.resolve();
    }

    @PluginMethod
    public void captureStill(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
            && getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermissionCallback");
            return;
        }
        startCaptureAsync(call);
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCaptureAsync(call);
        } else {
            call.reject("CAMERA_PERMISSION_DENIED");
        }
    }

    private void startCaptureAsync(PluginCall call) {
        if (!busy.compareAndSet(false, true)) {
            call.reject("CAPTURE_IN_PROGRESS");
            return;
        }

        final String deviceLabel = call.getString("deviceLabel", "");
        final String lensHint = call.getString("lensHint", "main");
        final boolean captureRaw = Boolean.TRUE.equals(call.getBoolean("captureRaw", false));
        final boolean autoSaveRaw = Boolean.TRUE.equals(call.getBoolean("autoSaveRaw", false));
        Double fxObj = call.getDouble("focusX", 0.5);
        Double fyObj = call.getDouble("focusY", 0.5);
        final double focusX = clamp(fxObj != null ? fxObj : 0.5, 0.05, 0.95);
        final double focusY = clamp(fyObj != null ? fyObj : 0.5, 0.05, 0.95);
        final String focusMode = call.getString("focusMode", "continuous");
        final String exposureMode = call.getString("exposureMode", "auto");
        Long expObj = call.getLong("exposureTimeNs", 0L);
        Integer isoObj = call.getInt("iso", 0);
        Double evObj = call.getDouble("exposureCompensationEv", 0.0);
        Double zoomObj = call.getDouble("zoomRatio", 1.0);
        final long exposureTimeNs = expObj != null ? expObj : 0L;
        final int iso = isoObj != null ? isoObj : 0;
        final double ev = evObj != null ? evObj : 0.0;
        final double zoomRatio = clamp(zoomObj != null ? zoomObj : 1.0, 0.4, 10.0);
        final int displayRotation = getDisplayRotationDegrees();

        getBridge().execute(() -> {
            try {
                stopLivePreviewInternal();
                performCamera2Capture(
                    call,
                    deviceLabel,
                    lensHint,
                    captureRaw,
                    autoSaveRaw,
                    focusX,
                    focusY,
                    focusMode,
                    exposureMode,
                    exposureTimeNs,
                    iso,
                    ev,
                    zoomRatio,
                    displayRotation
                );
            } catch (Throwable t) {
                call.reject("CAMERA2_CAPTURE_FAILED: " + t.getMessage(), new Exception(t));
            } finally {
                busy.set(false);
            }
        });
    }

    private void performCamera2Capture(
        PluginCall call,
        String deviceLabel,
        String lensHint,
        boolean captureRawRequested,
        boolean autoSaveRaw,
        double focusX,
        double focusY,
        String focusMode,
        String exposureMode,
        long exposureTimeNs,
        int iso,
        double ev,
        double zoomRatio,
        int displayRotationDegrees
    ) throws Exception {
        CameraManager manager = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
        if (manager == null) {
            call.reject("CAMERA_MANAGER_UNAVAILABLE");
            return;
        }

        String cameraId = resolveCameraId(manager, deviceLabel, lensHint);
        if (cameraId == null) {
            call.reject("NO_CAMERA_FOUND");
            return;
        }

        CameraCharacteristics chars = manager.getCameraCharacteristics(cameraId);
        StreamConfigurationMap map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
        if (map == null) {
            call.reject("STREAM_MAP_UNAVAILABLE");
            return;
        }

        Size jpegSize = maxByArea(map.getOutputSizes(ImageFormat.JPEG));
        if (jpegSize == null) {
            call.reject("NO_JPEG_SIZE_AVAILABLE");
            return;
        }

        boolean enableRaw = captureRawRequested && supportsRawCapture(chars, map);
        Size rawSize = enableRaw ? maxByArea(map.getOutputSizes(ImageFormat.RAW_SENSOR)) : null;
        if (rawSize == null) {
            enableRaw = false;
        }

        HandlerThread handlerThread = new HandlerThread("MonoLensCamera2Capture");
        handlerThread.start();
        Handler handler = new Handler(handlerThread.getLooper());

        final AtomicReference<CameraDevice> cameraRef = new AtomicReference<>();
        final AtomicReference<CameraCaptureSession> sessionRef = new AtomicReference<>();
        final AtomicReference<Image> jpegImageRef = new AtomicReference<>();
        final AtomicReference<Image> rawImageRef = new AtomicReference<>();
        SurfaceTexture dummyTexture = null;
        Surface previewSurface = null;
        ImageReader jpegReader = null;
        ImageReader rawReader = null;

        try {
            // 1. Open CameraDevice (retry briefly in case Chromium WebView is still releasing the HAL)
            CameraDevice device = openCameraWithRetry(manager, cameraId, handler);
            cameraRef.set(device);

            // 2. Prepare Outputs (Headless 640x480 SurfaceTexture for AF/AE convergence + Full-res ImageReaders)
            dummyTexture = new SurfaceTexture(0);
            dummyTexture.setDefaultBufferSize(640, 480);
            previewSurface = new Surface(dummyTexture);

            jpegReader = ImageReader.newInstance(jpegSize.getWidth(), jpegSize.getHeight(), ImageFormat.JPEG, 2);
            if (enableRaw) {
                rawReader = ImageReader.newInstance(rawSize.getWidth(), rawSize.getHeight(), ImageFormat.RAW_SENSOR, 2);
            }

            List<Surface> outputs = new ArrayList<>();
            outputs.add(previewSurface);
            outputs.add(jpegReader.getSurface());
            if (rawReader != null) {
                outputs.add(rawReader.getSurface());
            }

            CameraCaptureSession session = createSessionSync(device, outputs, handler);
            sessionRef.set(session);

            final boolean hasAf = hasAutofocus(chars);
            final boolean isManualExp = "manual".equals(exposureMode) && exposureTimeNs > 0 && iso > 0;
            final Integer lensFacing = chars.get(CameraCharacteristics.LENS_FACING);
            final boolean isFront = lensFacing != null && lensFacing == CameraCharacteristics.LENS_FACING_FRONT;
            final int jpegOrientation = computeJpegOrientation(chars, displayRotationDegrees);
            final MeteringRectangle[] afRegions = buildTapRegions(chars, focusX, focusY, jpegOrientation, isFront);

            // 3. Repeating preview + AF/AE convergence
            final CountDownLatch convergeLatch = new CountDownLatch(1);
            final AtomicBoolean converged = new AtomicBoolean(false);

            CaptureRequest.Builder previewBuilder = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            previewBuilder.addTarget(previewSurface);
            applyCommonControls(
                previewBuilder,
                chars,
                hasAf,
                focusMode,
                afRegions,
                isManualExp,
                exposureTimeNs,
                iso,
                ev,
                zoomRatio
            );

            CameraCaptureSession.CaptureCallback previewCallback = new CameraCaptureSession.CaptureCallback() {
                private int frameCount = 0;

                @Override
                public void onCaptureCompleted(
                    @NonNull CameraCaptureSession s,
                    @NonNull CaptureRequest request,
                    @NonNull TotalCaptureResult result
                ) {
                    if (converged.get()) return;
                    frameCount++;
                    // Allow at least 3 frames for ISP AE/AF state machine to settle
                    if (frameCount < 3) return;

                    boolean afDone = !hasAf;
                    if (!afDone) {
                        Integer afState = result.get(CaptureResult.CONTROL_AF_STATE);
                        afDone = afState == null
                            || afState == CaptureResult.CONTROL_AF_STATE_FOCUSED_LOCKED
                            || afState == CaptureResult.CONTROL_AF_STATE_NOT_FOCUSED_LOCKED
                            || afState == CaptureResult.CONTROL_AF_STATE_PASSIVE_FOCUSED;
                    }

                    boolean aeDone = isManualExp;
                    if (!aeDone) {
                        Integer aeState = result.get(CaptureResult.CONTROL_AE_STATE);
                        aeDone = aeState == null
                            || aeState == CaptureResult.CONTROL_AE_STATE_CONVERGED
                            || aeState == CaptureResult.CONTROL_AE_STATE_FLASH_REQUIRED
                            || aeState == CaptureResult.CONTROL_AE_STATE_LOCKED;
                    }

                    if (afDone && aeDone && converged.compareAndSet(false, true)) {
                        convergeLatch.countDown();
                    }
                }
            };

            session.setRepeatingRequest(previewBuilder.build(), previewCallback, handler);

            // Trigger AF / AE precapture scan when supported
            CaptureRequest.Builder triggerBuilder = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            triggerBuilder.addTarget(previewSurface);
            applyCommonControls(
                triggerBuilder,
                chars,
                hasAf,
                focusMode,
                afRegions,
                isManualExp,
                exposureTimeNs,
                iso,
                ev,
                zoomRatio
            );
            if (hasAf) {
                triggerBuilder.set(CaptureRequest.CONTROL_AF_TRIGGER, CameraMetadata.CONTROL_AF_TRIGGER_START);
            }
            if (!isManualExp) {
                triggerBuilder.set(CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER, CameraMetadata.CONTROL_AE_PRECAPTURE_TRIGGER_START);
            }
            session.capture(triggerBuilder.build(), previewCallback, handler);

            // Wait up to 1.6s for AF + AE lock (never hangs)
            convergeLatch.await(1600, TimeUnit.MILLISECONDS);
            try {
                session.stopRepeating();
            } catch (Exception ignored) {}

            // 4. Issue Full-Sensor High-Quality Still Capture
            final int expectedSignals = enableRaw ? 3 : 2;
            final CountDownLatch stillLatch = new CountDownLatch(expectedSignals);
            final AtomicReference<TotalCaptureResult> stillResultRef = new AtomicReference<>();
            final AtomicReference<String> captureErrorRef = new AtomicReference<>();

            jpegReader.setOnImageAvailableListener(reader -> {
                Image img = reader.acquireLatestImage();
                if (img != null && !jpegImageRef.compareAndSet(null, img)) {
                    img.close();
                }
                stillLatch.countDown();
            }, handler);

            if (rawReader != null) {
                rawReader.setOnImageAvailableListener(reader -> {
                    Image img = reader.acquireLatestImage();
                    if (img != null && !rawImageRef.compareAndSet(null, img)) {
                        img.close();
                    }
                    stillLatch.countDown();
                }, handler);
            }

            CaptureRequest.Builder stillBuilder = device.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            stillBuilder.addTarget(jpegReader.getSurface());
            if (rawReader != null) {
                stillBuilder.addTarget(rawReader.getSurface());
            }
            applyCommonControls(
                stillBuilder,
                chars,
                hasAf,
                focusMode,
                afRegions,
                isManualExp,
                exposureTimeNs,
                iso,
                ev,
                zoomRatio
            );
            stillBuilder.set(CaptureRequest.JPEG_ORIENTATION, jpegOrientation);
            stillBuilder.set(CaptureRequest.JPEG_QUALITY, (byte) 98);
            setIfSupported(
                stillBuilder,
                chars,
                CameraCharacteristics.NOISE_REDUCTION_AVAILABLE_NOISE_REDUCTION_MODES,
                CaptureRequest.NOISE_REDUCTION_MODE,
                CameraMetadata.NOISE_REDUCTION_MODE_HIGH_QUALITY
            );
            setIfSupported(
                stillBuilder,
                chars,
                CameraCharacteristics.EDGE_AVAILABLE_EDGE_MODES,
                CaptureRequest.EDGE_MODE,
                CameraMetadata.EDGE_MODE_HIGH_QUALITY
            );
            setIfSupported(
                stillBuilder,
                chars,
                CameraCharacteristics.COLOR_CORRECTION_AVAILABLE_ABERRATION_MODES,
                CaptureRequest.COLOR_CORRECTION_ABERRATION_MODE,
                CameraMetadata.COLOR_CORRECTION_ABERRATION_MODE_HIGH_QUALITY
            );

            session.capture(stillBuilder.build(), new CameraCaptureSession.CaptureCallback() {
                @Override
                public void onCaptureCompleted(
                    @NonNull CameraCaptureSession s,
                    @NonNull CaptureRequest request,
                    @NonNull TotalCaptureResult result
                ) {
                    stillResultRef.set(result);
                    stillLatch.countDown();
                }

                @Override
                public void onCaptureFailed(
                    @NonNull CameraCaptureSession s,
                    @NonNull CaptureRequest request,
                    @NonNull CaptureFailure failure
                ) {
                    captureErrorRef.set("STILL_CAPTURE_FAILED_REASON_" + failure.getReason());
                    while (stillLatch.getCount() > 0) {
                        stillLatch.countDown();
                    }
                }
            }, handler);

            boolean completed = stillLatch.await(8000, TimeUnit.MILLISECONDS);
            if (!completed || captureErrorRef.get() != null) {
                throw new IllegalStateException(
                    captureErrorRef.get() != null ? captureErrorRef.get() : "STILL_CAPTURE_TIMEOUT"
                );
            }

            Image jpegImage = jpegImageRef.get();
            if (jpegImage == null) {
                throw new IllegalStateException("JPEG_IMAGE_NULL");
            }

            long ts = System.currentTimeMillis();
            File cacheDir = getContext().getCacheDir();
            File jpegFile = new File(cacheDir, "SENSOR_" + ts + ".jpg");
            ByteBuffer jpegBuf = jpegImage.getPlanes()[0].getBuffer();
            byte[] jpegBytes = new byte[jpegBuf.remaining()];
            jpegBuf.get(jpegBytes);
            try (FileOutputStream fos = new FileOutputStream(jpegFile)) {
                fos.write(jpegBytes);
                fos.flush();
            }

            // Read actual captured EXIF / sensor metadata
            TotalCaptureResult stillRes = stillResultRef.get();
            long actualExposureNs = exposureTimeNs;
            int actualIso = iso;
            if (stillRes != null) {
                Long resExp = stillRes.get(CaptureResult.SENSOR_EXPOSURE_TIME);
                if (resExp != null) actualExposureNs = resExp;
                Integer resIso = stillRes.get(CaptureResult.SENSOR_SENSITIVITY);
                if (resIso != null) actualIso = resIso;
            }

            // Write genuine Bayer RAW DNG if available & requested
            String dngPath = null;
            boolean dngSavedToGallery = false;
            Image rawImage = rawImageRef.get();
            if (enableRaw && rawImage != null && stillRes != null) {
                File dngFile = new File(cacheDir, "RAW_" + ts + ".dng");
                try (DngCreator dngCreator = new DngCreator(chars, stillRes);
                     FileOutputStream dngOut = new FileOutputStream(dngFile)) {
                    dngCreator.setOrientation(toExifOrientation(jpegOrientation));
                    dngCreator.writeImage(dngOut, rawImage);
                    dngOut.flush();
                    dngPath = dngFile.getAbsolutePath();

                    if (autoSaveRaw && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        dngSavedToGallery = writeFileToMediaStore(
                            dngFile,
                            "RAW_" + ts + ".dng",
                            "image/x-adobe-dng"
                        );
                    }
                } catch (Exception ignored) {
                    dngPath = null;
                }
            }

            if (jpegImageRef.get() != null) {
                jpegImageRef.get().close();
                jpegImageRef.set(null);
            }
            if (rawImageRef.get() != null) {
                rawImageRef.get().close();
                rawImageRef.set(null);
            }

            boolean isRotated90or270 = jpegOrientation == 90 || jpegOrientation == 270;
            int outWidth = isRotated90or270 ? jpegSize.getHeight() : jpegSize.getWidth();
            int outHeight = isRotated90or270 ? jpegSize.getWidth() : jpegSize.getHeight();

            JSObject ret = new JSObject();
            ret.put("jpegPath", jpegFile.getAbsolutePath());
            ret.put("width", outWidth);
            ret.put("height", outHeight);
            ret.put("exposureTimeNs", actualExposureNs);
            ret.put("iso", actualIso);
            ret.put("rawSupported", enableRaw);
            if (dngPath != null) {
                ret.put("dngPath", dngPath);
                ret.put("dngSavedToGallery", dngSavedToGallery);
            }
            call.resolve(ret);
        } finally {
            try {
                if (jpegImageRef.get() != null) jpegImageRef.get().close();
            } catch (Exception ignored) {}
            try {
                if (rawImageRef.get() != null) rawImageRef.get().close();
            } catch (Exception ignored) {}
            try {
                if (sessionRef.get() != null) sessionRef.get().close();
            } catch (Exception ignored) {}
            try {
                if (cameraRef.get() != null) cameraRef.get().close();
            } catch (Exception ignored) {}
            try {
                if (jpegReader != null) jpegReader.close();
            } catch (Exception ignored) {}
            try {
                if (rawReader != null) rawReader.close();
            } catch (Exception ignored) {}
            try {
                if (previewSurface != null) previewSurface.release();
            } catch (Exception ignored) {}
            try {
                if (dummyTexture != null) dummyTexture.release();
            } catch (Exception ignored) {}
            handlerThread.quitSafely();
        }
    }

    @SuppressLint("MissingPermission")
    private CameraDevice openCameraWithRetry(CameraManager manager, String cameraId, Handler handler) throws Exception {
        Exception lastErr = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            final CountDownLatch openLatch = new CountDownLatch(1);
            final AtomicReference<CameraDevice> devRef = new AtomicReference<>();
            final AtomicReference<Integer> errCodeRef = new AtomicReference<>();

            try {
                manager.openCamera(cameraId, new CameraDevice.StateCallback() {
                    @Override
                    public void onOpened(@NonNull CameraDevice camera) {
                        devRef.set(camera);
                        openLatch.countDown();
                    }

                    @Override
                    public void onDisconnected(@NonNull CameraDevice camera) {
                        camera.close();
                        openLatch.countDown();
                    }

                    @Override
                    public void onError(@NonNull CameraDevice camera, int error) {
                        camera.close();
                        errCodeRef.set(error);
                        openLatch.countDown();
                    }
                }, handler);

                openLatch.await(3000, TimeUnit.MILLISECONDS);
                if (devRef.get() != null) {
                    return devRef.get();
                }
                lastErr = new IllegalStateException("OPEN_CAMERA_ERROR_" + errCodeRef.get());
            } catch (CameraAccessException e) {
                lastErr = e;
            }
            Thread.sleep(160);
        }
        throw lastErr != null ? lastErr : new IllegalStateException("OPEN_CAMERA_FAILED");
    }

    @SuppressWarnings("deprecation")
    private CameraCaptureSession createSessionSync(
        CameraDevice device,
        List<Surface> outputs,
        Handler handler
    ) throws Exception {
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<CameraCaptureSession> sessionRef = new AtomicReference<>();
        device.createCaptureSession(outputs, new CameraCaptureSession.StateCallback() {
            @Override
            public void onConfigured(@NonNull CameraCaptureSession session) {
                sessionRef.set(session);
                latch.countDown();
            }

            @Override
            public void onConfigureFailed(@NonNull CameraCaptureSession session) {
                latch.countDown();
            }
        }, handler);
        latch.await(3000, TimeUnit.MILLISECONDS);
        CameraCaptureSession session = sessionRef.get();
        if (session == null) {
            throw new IllegalStateException("CAPTURE_SESSION_CONFIG_FAILED");
        }
        return session;
    }

    private void applyCommonControls(
        CaptureRequest.Builder builder,
        CameraCharacteristics chars,
        boolean hasAf,
        String focusMode,
        MeteringRectangle[] afRegions,
        boolean isManualExp,
        long exposureTimeNs,
        int iso,
        double ev,
        double zoomRatio
    ) {
        builder.set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO);

        if (hasAf) {
            int[] afModes = chars.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES);
            int desiredAf = "single-shot".equals(focusMode)
                ? CameraMetadata.CONTROL_AF_MODE_AUTO
                : CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_PICTURE;
            if (containsInt(afModes, desiredAf)) {
                builder.set(CaptureRequest.CONTROL_AF_MODE, desiredAf);
            } else if (containsInt(afModes, CameraMetadata.CONTROL_AF_MODE_AUTO)) {
                builder.set(CaptureRequest.CONTROL_AF_MODE, CameraMetadata.CONTROL_AF_MODE_AUTO);
            }
            Integer maxAfRegions = chars.get(CameraCharacteristics.CONTROL_MAX_REGIONS_AF);
            if (afRegions != null && maxAfRegions != null && maxAfRegions > 0) {
                builder.set(CaptureRequest.CONTROL_AF_REGIONS, afRegions);
            }
        }

        if (isManualExp) {
            builder.set(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_OFF);
            Range<Long> expRange = chars.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE);
            long clampedExp = exposureTimeNs;
            if (expRange != null) {
                clampedExp = Math.max(expRange.getLower(), Math.min(expRange.getUpper(), clampedExp));
            }
            builder.set(CaptureRequest.SENSOR_EXPOSURE_TIME, clampedExp);

            Range<Integer> isoRange = chars.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE);
            int clampedIso = iso;
            if (isoRange != null) {
                clampedIso = Math.max(isoRange.getLower(), Math.min(isoRange.getUpper(), clampedIso));
            }
            builder.set(CaptureRequest.SENSOR_SENSITIVITY, clampedIso);
        } else {
            builder.set(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_ON);
            Integer maxAeRegions = chars.get(CameraCharacteristics.CONTROL_MAX_REGIONS_AE);
            if (afRegions != null && maxAeRegions != null && maxAeRegions > 0) {
                builder.set(CaptureRequest.CONTROL_AE_REGIONS, afRegions);
            }
            Range<Integer> compRange = chars.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_RANGE);
            Rational step = chars.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_STEP);
            if (compRange != null && step != null && step.floatValue() > 0f && Math.abs(ev) > 0.01) {
                int steps = Math.round((float) ev / step.floatValue());
                steps = Math.max(compRange.getLower(), Math.min(compRange.getUpper(), steps));
                builder.set(CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION, steps);
            }
        }

        if (Math.abs(zoomRatio - 1.0) > 0.01) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Range<Float> zoomRange = chars.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE);
                if (zoomRange != null) {
                    float clampedZoom = Math.max(zoomRange.getLower(), Math.min(zoomRange.getUpper(), (float) zoomRatio));
                    builder.set(CaptureRequest.CONTROL_ZOOM_RATIO, clampedZoom);
                }
            } else if (zoomRatio > 1.01) {
                Rect active = chars.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE);
                Float maxDigital = chars.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM);
                if (active != null && maxDigital != null && maxDigital > 1.0f) {
                    float clampedZoom = Math.min(maxDigital, (float) zoomRatio);
                    int cropW = Math.round(active.width() / clampedZoom);
                    int cropH = Math.round(active.height() / clampedZoom);
                    int cropX = (active.width() - cropW) / 2;
                    int cropY = (active.height() - cropH) / 2;
                    builder.set(
                        CaptureRequest.SCALER_CROP_REGION,
                        new Rect(active.left + cropX, active.top + cropY, active.left + cropX + cropW, active.top + cropY + cropH)
                    );
                }
            }
        }
    }

    private String resolveCameraId(CameraManager manager, String deviceLabel, String lensHint) throws CameraAccessException {
        String[] ids = manager.getCameraIdList();
        if (ids.length == 0) return null;

        if (deviceLabel != null && !deviceLabel.isEmpty()) {
            Matcher m = CAMERA2_ID_PATTERN.matcher(deviceLabel);
            if (m.find()) {
                String parsedId = m.group(1);
                for (String id : ids) {
                    if (id.equals(parsedId)) {
                        return id;
                    }
                }
            }
        }

        boolean wantFront = "front".equals(lensHint)
            || (deviceLabel != null && deviceLabel.toLowerCase().contains("front"));
        boolean wantWide = "wide".equals(lensHint);
        boolean wantTele = "tele".equals(lensHint);

        List<String> matchingFacing = new ArrayList<>();
        for (String id : ids) {
            CameraCharacteristics chars = manager.getCameraCharacteristics(id);
            Integer facing = chars.get(CameraCharacteristics.LENS_FACING);
            if (facing == null) continue;
            if (wantFront && facing == CameraCharacteristics.LENS_FACING_FRONT) {
                return id;
            }
            if (!wantFront && facing == CameraCharacteristics.LENS_FACING_BACK) {
                matchingFacing.add(id);
            }
        }

        if (matchingFacing.isEmpty()) {
            return ids[0];
        }

        if (wantWide || wantTele) {
            String bestId = matchingFacing.get(0);
            float bestFocal = wantWide ? Float.MAX_VALUE : -Float.MAX_VALUE;
            for (String id : matchingFacing) {
                CameraCharacteristics chars = manager.getCameraCharacteristics(id);
                float[] focals = chars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS);
                if (focals != null && focals.length > 0) {
                    if (wantWide && focals[0] < bestFocal) {
                        bestFocal = focals[0];
                        bestId = id;
                    } else if (wantTele && focals[0] > bestFocal) {
                        bestFocal = focals[0];
                        bestId = id;
                    }
                }
            }
            return bestId;
        }

        return matchingFacing.get(0);
    }

    private boolean supportsRawCapture(CameraCharacteristics chars, StreamConfigurationMap map) {
        if (map == null) return false;
        int[] caps = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES);
        if (!containsInt(caps, CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_RAW)) {
            return false;
        }
        Size[] rawSizes = map.getOutputSizes(ImageFormat.RAW_SENSOR);
        return rawSizes != null && rawSizes.length > 0;
    }

    private boolean hasAutofocus(CameraCharacteristics chars) {
        Float minFocus = chars.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE);
        if (minFocus != null && minFocus <= 0f) {
            return false;
        }
        int[] afModes = chars.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES);
        return containsInt(afModes, CameraMetadata.CONTROL_AF_MODE_AUTO)
            || containsInt(afModes, CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
    }

    private int getDisplayRotationDegrees() {
        if (getActivity() == null || getActivity().getWindowManager() == null) return 0;
        int rot = getActivity().getWindowManager().getDefaultDisplay().getRotation();
        switch (rot) {
            case Surface.ROTATION_90:
                return 90;
            case Surface.ROTATION_180:
                return 180;
            case Surface.ROTATION_270:
                return 270;
            case Surface.ROTATION_0:
            default:
                return 0;
        }
    }

    private static int computeJpegOrientation(CameraCharacteristics chars, int deviceDegrees) {
        Integer sensorObj = chars.get(CameraCharacteristics.SENSOR_ORIENTATION);
        int sensorOrientation = sensorObj != null ? sensorObj : 90;
        Integer facing = chars.get(CameraCharacteristics.LENS_FACING);
        if (facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT) {
            return (sensorOrientation + deviceDegrees) % 360;
        }
        return (sensorOrientation - deviceDegrees + 360) % 360;
    }

    private static int toExifOrientation(int jpegOrientation) {
        switch (jpegOrientation) {
            case 90:
                return ExifInterface.ORIENTATION_ROTATE_90;
            case 180:
                return ExifInterface.ORIENTATION_ROTATE_180;
            case 270:
                return ExifInterface.ORIENTATION_ROTATE_270;
            case 0:
            default:
                return ExifInterface.ORIENTATION_NORMAL;
        }
    }

    private static MeteringRectangle[] buildTapRegions(
        CameraCharacteristics chars,
        double screenX,
        double screenY,
        int rotationDeg,
        boolean isFront
    ) {
        Rect active = chars.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE);
        if (active == null) return null;

        double x = isFront ? (1.0 - screenX) : screenX;
        double y = screenY;
        double sx;
        double sy;
        switch (rotationDeg) {
            case 90:
                sx = y;
                sy = 1.0 - x;
                break;
            case 180:
                sx = 1.0 - x;
                sy = 1.0 - y;
                break;
            case 270:
                sx = 1.0 - y;
                sy = x;
                break;
            case 0:
            default:
                sx = x;
                sy = y;
                break;
        }

        int cx = active.left + (int) Math.round(sx * active.width());
        int cy = active.top + (int) Math.round(sy * active.height());
        int halfW = Math.max(64, active.width() / 12);
        int halfH = Math.max(64, active.height() / 12);

        int left = Math.max(active.left, Math.min(active.right - halfW * 2, cx - halfW));
        int top = Math.max(active.top, Math.min(active.bottom - halfH * 2, cy - halfH));
        return new MeteringRectangle[] {
            new MeteringRectangle(left, top, halfW * 2, halfH * 2, MeteringRectangle.METERING_WEIGHT_MAX - 1)
        };
    }

    private boolean writeFileToMediaStore(File sourceFile, String fileName, String mimeType) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false;
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
        values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/MonoLensPro");
        values.put(MediaStore.Images.Media.IS_PENDING, 1);

        Uri collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri itemUri = resolver.insert(collection, values);
        if (itemUri == null) return false;

        try {
            byte[] buffer = new byte[65536];
            try (FileInputStream in = new FileInputStream(sourceFile);
                 OutputStream out = resolver.openOutputStream(itemUri)) {
                if (out == null) throw new IllegalStateException("Null output stream");
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
                out.flush();
            }
            ContentValues publishValues = new ContentValues();
            publishValues.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(itemUri, publishValues, null, null);
            return true;
        } catch (Exception e) {
            resolver.delete(itemUri, null, null);
            return false;
        }
    }

    private void startLivePreviewAsync(PluginCall call) {
        final String deviceLabel = call.getString("deviceLabel", "");
        final String lensHint = call.getString("lensHint", "main");
        Double fxObj = call.getDouble("focusX", 0.5);
        Double fyObj = call.getDouble("focusY", 0.5);
        final double focusX = clamp(fxObj != null ? fxObj : 0.5, 0.05, 0.95);
        final double focusY = clamp(fyObj != null ? fyObj : 0.5, 0.05, 0.95);
        final String focusMode = call.getString("focusMode", "continuous");
        final String exposureMode = call.getString("exposureMode", "auto");
        Long expObj = call.getLong("exposureTimeNs", 0L);
        Integer isoObj = call.getInt("iso", 0);
        Double evObj = call.getDouble("exposureCompensationEv", 0.0);
        Double zoomObj = call.getDouble("zoomRatio", 1.0);
        final long exposureTimeNs = expObj != null ? expObj : 0L;
        final int iso = isoObj != null ? isoObj : 0;
        final double ev = evObj != null ? evObj : 0.0;
        final double zoomRatio = clamp(zoomObj != null ? zoomObj : 1.0, 0.4, 10.0);

        getBridge().execute(() -> {
            synchronized (previewLock) {
                stopLivePreviewInternal();
                LivePreviewSession session = null;
                try {
                    CameraManager manager = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
                    if (manager == null) {
                        call.reject("CAMERA_MANAGER_UNAVAILABLE");
                        return;
                    }
                    String cameraId = resolveCameraId(manager, deviceLabel, lensHint);
                    if (cameraId == null) {
                        call.reject("NO_CAMERA_FOUND");
                        return;
                    }
                    CameraCharacteristics chars = manager.getCameraCharacteristics(cameraId);
                    StreamConfigurationMap map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
                    if (map == null) {
                        call.reject("STREAM_MAP_UNAVAILABLE");
                        return;
                    }
                    Size previewSize = selectPreviewSize(map.getOutputSizes(ImageFormat.YUV_420_888));
                    if (previewSize == null) {
                        call.reject("NO_PREVIEW_SIZE_AVAILABLE");
                        return;
                    }

                    session = new LivePreviewSession(
                        cameraId,
                        chars,
                        previewSize,
                        zoomRatio,
                        focusX,
                        focusY,
                        focusMode != null ? focusMode : "continuous",
                        exposureMode != null ? exposureMode : "auto",
                        exposureTimeNs,
                        iso,
                        ev
                    );
                    session.start(manager);
                    activePreview = session;

                    int jpegOrientation = computeJpegOrientation(chars, getDisplayRotationDegrees());
                    boolean isRotated = jpegOrientation == 90 || jpegOrientation == 270;
                    int outW = isRotated ? previewSize.getHeight() : previewSize.getWidth();
                    int outH = isRotated ? previewSize.getWidth() : previewSize.getHeight();

                    JSObject ret = new JSObject();
                    ret.put("url", "http://127.0.0.1:" + session.serverSocket.getLocalPort() + "/stream.mjpeg");
                    ret.put("width", outW);
                    ret.put("height", outH);
                    call.resolve(ret);
                } catch (Throwable t) {
                    if (session != null) {
                        session.close();
                    }
                    activePreview = null;
                    call.reject("LIVE_PREVIEW_START_FAILED: " + t.getMessage(), new Exception(t));
                }
            }
        });
    }

    private void stopLivePreviewInternal() {
        synchronized (previewLock) {
            LivePreviewSession s = activePreview;
            activePreview = null;
            if (s != null) {
                s.close();
            }
        }
    }

    private final class LivePreviewSession {
        final String cameraId;
        final CameraCharacteristics chars;
        final boolean hasAf;
        final boolean isFront;
        final Size previewSize;

        volatile double zoomRatio;
        volatile double focusX;
        volatile double focusY;
        volatile String focusMode;
        volatile String exposureMode;
        volatile long exposureTimeNs;
        volatile int iso;
        volatile double ev;
        volatile boolean closed = false;

        final Object frameMonitor = new Object();
        final Object frameEncodeLock = new Object();
        final CopyOnWriteArrayList<Socket> clientSockets = new CopyOnWriteArrayList<>();
        final ByteArrayOutputStream jpegBaos = new ByteArrayOutputStream(131072);

        CameraDevice cameraDevice;
        CameraCaptureSession captureSession;
        ImageReader yuvReader;
        HandlerThread handlerThread;
        Handler handler;
        HandlerThread readerThread;
        Handler readerHandler;
        ServerSocket serverSocket;
        Thread acceptThread;
        byte[] latestJpeg;
        long frameSeq = 0L;
        byte[] nv21Buffer;
        byte[] srcYBuf;
        byte[] srcUBuf;
        byte[] srcVBuf;

        LivePreviewSession(
            String cameraId,
            CameraCharacteristics chars,
            Size previewSize,
            double zoomRatio,
            double focusX,
            double focusY,
            String focusMode,
            String exposureMode,
            long exposureTimeNs,
            int iso,
            double ev
        ) {
            this.cameraId = cameraId;
            this.chars = chars;
            this.hasAf = hasAutofocus(chars);
            Integer lensFacing = chars.get(CameraCharacteristics.LENS_FACING);
            this.isFront = lensFacing != null && lensFacing == CameraCharacteristics.LENS_FACING_FRONT;
            this.previewSize = previewSize;
            this.zoomRatio = zoomRatio;
            this.focusX = focusX;
            this.focusY = focusY;
            this.focusMode = focusMode;
            this.exposureMode = exposureMode;
            this.exposureTimeNs = exposureTimeNs;
            this.iso = iso;
            this.ev = ev;
        }

        void start(CameraManager manager) throws Exception {
            serverSocket = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
            acceptThread = new Thread(this::runAcceptLoop, "MonoLensMjpegAccept");
            acceptThread.setDaemon(true);
            acceptThread.start();

            handlerThread = new HandlerThread("MonoLensLivePreview");
            handlerThread.start();
            handler = new Handler(handlerThread.getLooper());

            readerThread = new HandlerThread("MonoLensYuvReader");
            readerThread.start();
            readerHandler = new Handler(readerThread.getLooper());

            cameraDevice = openCameraWithRetry(manager, cameraId, handler);
            yuvReader = ImageReader.newInstance(
                previewSize.getWidth(),
                previewSize.getHeight(),
                ImageFormat.YUV_420_888,
                3
            );
            yuvReader.setOnImageAvailableListener(this::onImageAvailable, readerHandler);

            List<Surface> outputs = new ArrayList<>();
            outputs.add(yuvReader.getSurface());
            captureSession = createSessionSync(cameraDevice, outputs, handler);
            applyRepeatingRequest(false);
        }

        void postRepeatingUpdate(boolean triggerAf) {
            Handler h = handler;
            if (h == null || closed) return;
            h.post(() -> {
                if (closed) return;
                applyRepeatingRequest(triggerAf);
            });
        }

        private void applyRepeatingRequest(boolean triggerAf) {
            CameraDevice dev = cameraDevice;
            CameraCaptureSession session = captureSession;
            ImageReader reader = yuvReader;
            if (closed || dev == null || session == null || reader == null) return;

            try {
                int displayRotation = getDisplayRotationDegrees();
                int jpegOrientation = computeJpegOrientation(chars, displayRotation);
                boolean isManualExp = "manual".equals(exposureMode) && exposureTimeNs > 0 && iso > 0;
                MeteringRectangle[] afRegions = buildTapRegions(chars, focusX, focusY, jpegOrientation, isFront);

                CaptureRequest.Builder builder = dev.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                builder.addTarget(reader.getSurface());
                applyCommonControls(
                    builder,
                    chars,
                    hasAf,
                    focusMode,
                    afRegions,
                    isManualExp,
                    exposureTimeNs,
                    iso,
                    ev,
                    zoomRatio
                );
                if (!isManualExp) {
                    Range<Integer> fpsRange = selectPreviewFpsRange(chars);
                    if (fpsRange != null) {
                        builder.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, fpsRange);
                    }
                }
                session.setRepeatingRequest(builder.build(), null, handler);

                if (triggerAf && hasAf) {
                    CaptureRequest.Builder trig = dev.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                    trig.addTarget(reader.getSurface());
                    applyCommonControls(
                        trig,
                        chars,
                        true,
                        focusMode,
                        afRegions,
                        isManualExp,
                        exposureTimeNs,
                        iso,
                        ev,
                        zoomRatio
                    );
                    if (!isManualExp) {
                        Range<Integer> fpsRange = selectPreviewFpsRange(chars);
                        if (fpsRange != null) {
                            trig.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, fpsRange);
                        }
                    }
                    trig.set(CaptureRequest.CONTROL_AF_TRIGGER, CameraMetadata.CONTROL_AF_TRIGGER_START);
                    session.capture(trig.build(), null, handler);
                }
            } catch (Exception ignored) {}
        }

        private void onImageAvailable(ImageReader reader) {
            synchronized (frameEncodeLock) {
                Image image = null;
                try {
                    image = reader.acquireLatestImage();
                    if (image == null || closed) return;

                    int rotDeg = computeJpegOrientation(chars, getDisplayRotationDegrees());
                    boolean swapped = rotDeg == 90 || rotDeg == 270;
                    int outW = swapped ? image.getHeight() : image.getWidth();
                    int outH = swapped ? image.getWidth() : image.getHeight();

                    Image.Plane[] planes = image.getPlanes();
                    srcYBuf = copyPlaneToByteArray(planes[0].getBuffer(), srcYBuf);
                    srcUBuf = copyPlaneToByteArray(planes[1].getBuffer(), srcUBuf);
                    srcVBuf = copyPlaneToByteArray(planes[2].getBuffer(), srcVBuf);

                    nv21Buffer = yuv420ArraysToRotatedNv21(
                        image.getWidth(),
                        image.getHeight(),
                        srcYBuf,
                        planes[0].getRowStride(),
                        planes[0].getPixelStride(),
                        srcUBuf,
                        planes[1].getRowStride(),
                        planes[1].getPixelStride(),
                        srcVBuf,
                        planes[2].getRowStride(),
                        planes[2].getPixelStride(),
                        rotDeg,
                        nv21Buffer
                    );

                    jpegBaos.reset();
                    YuvImage yuvImage = new YuvImage(nv21Buffer, ImageFormat.NV21, outW, outH, null);
                    yuvImage.compressToJpeg(new Rect(0, 0, outW, outH), 78, jpegBaos);
                    byte[] encoded = jpegBaos.toByteArray();

                    synchronized (frameMonitor) {
                        latestJpeg = encoded;
                        frameSeq++;
                        frameMonitor.notifyAll();
                    }
                } catch (Throwable ignored) {
                } finally {
                    if (image != null) {
                        try {
                            image.close();
                        } catch (Exception ignored) {}
                    }
                }
            }
        }

        private void runAcceptLoop() {
            while (!closed && serverSocket != null && !serverSocket.isClosed()) {
                try {
                    Socket client = serverSocket.accept();
                    if (closed) {
                        client.close();
                        break;
                    }
                    client.setTcpNoDelay(true);
                    clientSockets.add(client);
                    Thread writer = new Thread(() -> serveClient(client), "MonoLensMjpegClient");
                    writer.setDaemon(true);
                    writer.start();
                } catch (Exception e) {
                    break;
                }
            }
        }

        private void serveClient(Socket client) {
            try {
                InputStream rawIn = new BufferedInputStream(client.getInputStream());
                StringBuilder reqHeaders = new StringBuilder();
                int prev = -1;
                int b;
                int headerBytes = 0;
                while ((b = rawIn.read()) != -1 && headerBytes < 4096) {
                    reqHeaders.append((char) b);
                    headerBytes++;
                    if (reqHeaders.length() >= 4 && reqHeaders.substring(reqHeaders.length() - 4).equals("\r\n\r\n")) {
                        break;
                    }
                    if (prev == '\n' && b == '\n') {
                        break;
                    }
                    prev = b;
                }

                OutputStream out = client.getOutputStream();
                byte[] httpHeader = (
                    "HTTP/1.1 200 OK\r\n"
                        + "Connection: close\r\n"
                        + "Cache-Control: no-store, no-cache, must-revalidate, max-age=0\r\n"
                        + "Pragma: no-cache\r\n"
                        + "Access-Control-Allow-Origin: *\r\n"
                        + "Content-Type: multipart/x-mixed-replace; boundary=monolensframe\r\n\r\n"
                ).getBytes(StandardCharsets.US_ASCII);
                out.write(httpHeader);
                out.flush();

                long lastSentSeq = 0L;
                while (!closed && !client.isClosed()) {
                    byte[] frameBytes;
                    synchronized (frameMonitor) {
                        while (!closed && frameSeq == lastSentSeq) {
                            frameMonitor.wait(500);
                        }
                        if (closed) break;
                        frameBytes = latestJpeg;
                        lastSentSeq = frameSeq;
                    }
                    if (frameBytes == null || frameBytes.length == 0) continue;

                    byte[] partHeader = (
                        "--monolensframe\r\n"
                            + "Content-Type: image/jpeg\r\n"
                            + "Content-Length: " + frameBytes.length + "\r\n\r\n"
                    ).getBytes(StandardCharsets.US_ASCII);
                    out.write(partHeader);
                    out.write(frameBytes);
                    out.write("\r\n".getBytes(StandardCharsets.US_ASCII));
                    out.flush();
                }
            } catch (Exception ignored) {
            } finally {
                clientSockets.remove(client);
                try {
                    client.close();
                } catch (Exception ignored) {}
            }
        }

        void close() {
            closed = true;
            synchronized (frameMonitor) {
                frameMonitor.notifyAll();
            }
            for (Socket client : clientSockets) {
                try {
                    client.close();
                } catch (Exception ignored) {}
            }
            clientSockets.clear();
            try {
                if (serverSocket != null) serverSocket.close();
            } catch (Exception ignored) {}
            try {
                if (captureSession != null) captureSession.close();
            } catch (Exception ignored) {}
            try {
                if (cameraDevice != null) cameraDevice.close();
            } catch (Exception ignored) {}
            synchronized (frameEncodeLock) {
                try {
                    if (yuvReader != null) yuvReader.close();
                } catch (Exception ignored) {}
                yuvReader = null;
            }
            try {
                if (readerThread != null) readerThread.quitSafely();
            } catch (Exception ignored) {}
            try {
                if (handlerThread != null) handlerThread.quitSafely();
            } catch (Exception ignored) {}
        }
    }

    private static byte[] copyPlaneToByteArray(ByteBuffer buf, byte[] reuse) {
        buf.rewind();
        int rem = buf.remaining();
        byte[] arr = (reuse != null && reuse.length >= rem) ? reuse : new byte[rem];
        buf.get(arr, 0, rem);
        return arr;
    }

    private static byte[] yuv420ArraysToRotatedNv21(
        int srcW,
        int srcH,
        byte[] srcY,
        int yRowStride,
        int yPixStride,
        byte[] srcU,
        int uRowStride,
        int uPixStride,
        byte[] srcV,
        int vRowStride,
        int vPixStride,
        int rotDeg,
        byte[] reuseBuf
    ) {
        boolean swap = (rotDeg == 90 || rotDeg == 270);
        int outW = swap ? srcH : srcW;
        int outH = swap ? srcW : srcH;
        int ySize = outW * outH;
        int totalSize = ySize + (ySize >> 1);
        byte[] nv21 = (reuseBuf != null && reuseBuf.length == totalSize) ? reuseBuf : new byte[totalSize];

        // Y plane
        int dstIdx = 0;
        if (rotDeg == 0) {
            if (yPixStride == 1 && yRowStride == srcW) {
                System.arraycopy(srcY, 0, nv21, 0, ySize);
            } else {
                for (int dy = 0; dy < outH; dy++) {
                    int rowOff = dy * yRowStride;
                    for (int dx = 0; dx < outW; dx++) {
                        nv21[dstIdx++] = srcY[rowOff + dx * yPixStride];
                    }
                }
            }
        } else if (rotDeg == 90 && yPixStride == 1) {
            int lastRowOff = (srcH - 1) * yRowStride;
            for (int dy = 0; dy < outH; dy++) {
                int pos = lastRowOff + dy;
                for (int dx = 0; dx < outW; dx++) {
                    nv21[dstIdx++] = srcY[pos];
                    pos -= yRowStride;
                }
            }
        } else if (rotDeg == 270 && yPixStride == 1) {
            int lastCol = srcW - 1;
            for (int dy = 0; dy < outH; dy++) {
                int pos = lastCol - dy;
                for (int dx = 0; dx < outW; dx++) {
                    nv21[dstIdx++] = srcY[pos];
                    pos += yRowStride;
                }
            }
        } else {
            for (int dy = 0; dy < outH; dy++) {
                for (int dx = 0; dx < outW; dx++) {
                    int sx;
                    int sy;
                    switch (rotDeg) {
                        case 90:
                            sx = dy;
                            sy = srcH - 1 - dx;
                            break;
                        case 180:
                            sx = srcW - 1 - dx;
                            sy = srcH - 1 - dy;
                            break;
                        case 270:
                            sx = srcW - 1 - dy;
                            sy = dx;
                            break;
                        case 0:
                        default:
                            sx = dx;
                            sy = dy;
                            break;
                    }
                    nv21[dstIdx++] = srcY[sy * yRowStride + sx * yPixStride];
                }
            }
        }

        // UV planes (NV21 = interleaved V, U)
        int srcHalfW = srcW >> 1;
        int srcHalfH = srcH >> 1;
        int outHalfW = outW >> 1;
        int outHalfH = outH >> 1;
        int uvIdx = ySize;

        if (rotDeg == 90) {
            int lastUvRow = srcHalfH - 1;
            for (int uy = 0; uy < outHalfH; uy++) {
                int vPos = lastUvRow * vRowStride + uy * vPixStride;
                int uPos = lastUvRow * uRowStride + uy * uPixStride;
                for (int ux = 0; ux < outHalfW; ux++) {
                    nv21[uvIdx++] = srcV[vPos];
                    nv21[uvIdx++] = srcU[uPos];
                    vPos -= vRowStride;
                    uPos -= uRowStride;
                }
            }
        } else if (rotDeg == 270) {
            int lastUvCol = srcHalfW - 1;
            for (int uy = 0; uy < outHalfH; uy++) {
                int col = lastUvCol - uy;
                int vPos = col * vPixStride;
                int uPos = col * uPixStride;
                for (int ux = 0; ux < outHalfW; ux++) {
                    nv21[uvIdx++] = srcV[vPos];
                    nv21[uvIdx++] = srcU[uPos];
                    vPos += vRowStride;
                    uPos += uRowStride;
                }
            }
        } else {
            for (int uy = 0; uy < outHalfH; uy++) {
                for (int ux = 0; ux < outHalfW; ux++) {
                    int sux = (rotDeg == 180) ? (srcHalfW - 1 - ux) : ux;
                    int suy = (rotDeg == 180) ? (srcHalfH - 1 - uy) : uy;
                    nv21[uvIdx++] = srcV[suy * vRowStride + sux * vPixStride];
                    nv21[uvIdx++] = srcU[suy * uRowStride + sux * uPixStride];
                }
            }
        }
        return nv21;
    }

    @SuppressWarnings("unchecked")
    private static Range<Integer> selectPreviewFpsRange(CameraCharacteristics chars) {
        Range<Integer>[] ranges = chars.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES);
        if (ranges == null || ranges.length == 0) return null;
        Range<Integer> best = null;
        int bestScore = Integer.MIN_VALUE;
        for (Range<Integer> r : ranges) {
            int lo = r.getLower();
            int hi = r.getUpper();
            if (hi > 30) continue;
            // Prefer [30, 30] or [24, 30] / [15, 30]
            int score = hi * 100 + lo;
            if (score > bestScore) {
                bestScore = score;
                best = r;
            }
        }
        return best;
    }

    private static Size selectPreviewSize(Size[] sizes) {
        if (sizes == null || sizes.length == 0) return null;
        final long targetArea = 800L * 600L;
        Size best43 = null;
        long best43Diff = Long.MAX_VALUE;
        Size fallback = null;
        long fallbackDiff = Long.MAX_VALUE;

        for (Size s : sizes) {
            int w = s.getWidth();
            int h = s.getHeight();
            if (w < 480 || h < 360 || w > 800 || h > 800) continue;
            long area = (long) w * h;
            long diff = Math.abs(area - targetArea);
            double aspect = (double) w / Math.max(1, h);
            if (Math.abs(aspect - (4.0 / 3.0)) < 0.08) {
                if (diff < best43Diff) {
                    best43 = s;
                    best43Diff = diff;
                }
            }
            if (diff < fallbackDiff) {
                fallback = s;
                fallbackDiff = diff;
            }
        }
        if (best43 != null) return best43;
        if (fallback != null) return fallback;
        return sizes[sizes.length - 1];
    }

    private static void setIfSupported(
        CaptureRequest.Builder builder,
        CameraCharacteristics chars,
        CameraCharacteristics.Key<int[]> availKey,
        CaptureRequest.Key<Integer> reqKey,
        int desiredValue
    ) {
        int[] avail = chars.get(availKey);
        if (containsInt(avail, desiredValue)) {
            builder.set(reqKey, desiredValue);
        }
    }

    private static boolean containsInt(int[] arr, int target) {
        if (arr == null) return false;
        for (int v : arr) {
            if (v == target) return true;
        }
        return false;
    }

    private static Size maxByArea(Size[] sizes) {
        if (sizes == null || sizes.length == 0) return null;
        Size best = sizes[0];
        long bestArea = (long) best.getWidth() * best.getHeight();
        for (Size s : sizes) {
            long area = (long) s.getWidth() * s.getHeight();
            if (area > bestArea) {
                best = s;
                bestArea = area;
            }
        }
        return best;
    }

    private static double clamp(double val, double min, double max) {
        return Math.max(min, Math.min(max, val));
    }
}
