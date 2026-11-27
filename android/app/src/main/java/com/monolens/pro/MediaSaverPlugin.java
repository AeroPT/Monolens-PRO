package com.monolens.pro;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

@CapacitorPlugin(name = "MediaSaver")
public class MediaSaverPlugin extends Plugin {

    private static final String SNAPSEED_PACKAGE = "com.niksoftware.snapseed";

    @PluginMethod
    public void saveToGallery(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "image/jpeg");
        String base64Data = call.getString("data");

        if (fileName == null || base64Data == null) {
            call.reject("MISSING_PARAMETERS");
            return;
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("REQUIRES_ANDROID_Q_OR_HIGHER");
            return;
        }

        if (base64Data.contains(",")) {
            base64Data = base64Data.substring(base64Data.indexOf(',') + 1);
        }

        final String cleanBase64 = base64Data;
        final String targetName = fileName;
        final String targetMime = mimeType;

        getBridge().execute(() -> {
            byte[] decoded = Base64.decode(cleanBase64, Base64.NO_WRAP);
            writeBytesToMediaStore(call, targetName, targetMime, decoded, null);
        });
    }

    @PluginMethod
    public void saveFileToGallery(PluginCall call) {
        String filePath = call.getString("filePath");
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "image/x-adobe-dng");

        if (filePath == null || fileName == null) {
            call.reject("MISSING_PARAMETERS");
            return;
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("REQUIRES_ANDROID_Q_OR_HIGHER");
            return;
        }

        File sourceFile = new File(filePath);
        if (!sourceFile.exists() || !sourceFile.isFile()) {
            call.reject("SOURCE_FILE_NOT_FOUND");
            return;
        }

        final String targetName = fileName;
        final String targetMime = mimeType;

        getBridge().execute(() -> writeBytesToMediaStore(call, targetName, targetMime, null, sourceFile));
    }

    @PluginMethod
    public void openInSnapseed(PluginCall call) {
        String fileName = call.getString("fileName", "MonoLens_Edit.jpg");
        String mimeType = call.getString("mimeType", "image/jpeg");
        String filePath = call.getString("filePath");
        String base64Data = call.getString("data");

        File sourceFile = null;
        if (filePath != null && !filePath.isEmpty()) {
            sourceFile = new File(filePath);
            if (!sourceFile.exists() || !sourceFile.isFile()) {
                call.reject("SOURCE_FILE_NOT_FOUND");
                return;
            }
        } else if (base64Data != null && !base64Data.isEmpty()) {
            if (base64Data.contains(",")) {
                base64Data = base64Data.substring(base64Data.indexOf(',') + 1);
            }
        } else {
            call.reject("MISSING_PARAMETERS");
            return;
        }

        final File finalSourceFile = sourceFile;
        final String finalBase64 = base64Data;
        final String safeName = fileName.replaceAll("[^a-zA-Z0-9._-]", "_");
        final String targetMime = mimeType;

        getBridge().execute(() -> {
            try {
                Context context = getContext();
                File shareDir = new File(context.getCacheDir(), "snapseed_share");
                if (!shareDir.exists() && !shareDir.mkdirs()) {
                    call.reject("CACHE_DIR_CREATE_FAILED");
                    return;
                }

                // Clean up previous temporary share files so cache does not accumulate
                File[] existing = shareDir.listFiles();
                if (existing != null) {
                    for (File oldFile : existing) {
                        if (oldFile.isFile()) {
                            //noinspection ResultOfMethodCallIgnored
                            oldFile.delete();
                        }
                    }
                }

                File outFile = new File(shareDir, safeName);
                try (FileOutputStream out = new FileOutputStream(outFile)) {
                    if (finalSourceFile != null) {
                        copyFileToStream(finalSourceFile, out);
                    } else {
                        byte[] decoded = Base64.decode(finalBase64, Base64.NO_WRAP);
                        out.write(decoded);
                    }
                    out.flush();
                }

                Uri contentUri = FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + ".fileprovider",
                    outFile
                );

                context.grantUriPermission(
                    SNAPSEED_PACKAGE,
                    contentUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                );

                Activity activity = getActivity();
                Intent editIntent = new Intent(Intent.ACTION_EDIT);
                editIntent.setDataAndType(contentUri, targetMime);
                editIntent.setPackage(SNAPSEED_PACKAGE);
                editIntent.addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                );
                if (activity == null) {
                    editIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                }

                try {
                    if (activity != null) {
                        activity.startActivity(editIntent);
                    } else {
                        context.startActivity(editIntent);
                    }
                    call.resolve();
                } catch (ActivityNotFoundException editNotFound) {
                    Intent sendIntent = new Intent(Intent.ACTION_SEND);
                    sendIntent.setType(targetMime);
                    sendIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                    sendIntent.setPackage(SNAPSEED_PACKAGE);
                    sendIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    if (activity == null) {
                        sendIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    }

                    try {
                        if (activity != null) {
                            activity.startActivity(sendIntent);
                        } else {
                            context.startActivity(sendIntent);
                        }
                        call.resolve();
                    } catch (ActivityNotFoundException sendNotFound) {
                        call.reject("SNAPSEED_NOT_INSTALLED");
                    }
                }
            } catch (Exception ex) {
                call.reject("SNAPSEED_OPEN_FAILED: " + ex.getMessage(), ex);
            }
        });
    }

    private void writeBytesToMediaStore(
        PluginCall call,
        String targetName,
        String targetMime,
        byte[] rawBytes,
        File sourceFile
    ) {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, targetName);
        values.put(MediaStore.Images.Media.MIME_TYPE, targetMime);
        values.put(
            MediaStore.Images.Media.RELATIVE_PATH,
            Environment.DIRECTORY_PICTURES + "/MonoLensPro"
        );
        values.put(MediaStore.Images.Media.IS_PENDING, 1);

        Uri collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri itemUri = resolver.insert(collection, values);

        if (itemUri == null) {
            call.reject("MEDIASTORE_INSERT_FAILED");
            return;
        }

        try {
            try (OutputStream out = resolver.openOutputStream(itemUri)) {
                if (out == null) {
                    throw new IllegalStateException("Null output stream from ContentResolver");
                }
                if (rawBytes != null) {
                    out.write(rawBytes);
                } else if (sourceFile != null) {
                    copyFileToStream(sourceFile, out);
                }
                out.flush();
            }

            ContentValues publishValues = new ContentValues();
            publishValues.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(itemUri, publishValues, null, null);

            JSObject ret = new JSObject();
            ret.put("uri", itemUri.toString());
            call.resolve(ret);
        } catch (Exception ex) {
            resolver.delete(itemUri, null, null);
            call.reject("MEDIASTORE_WRITE_FAILED: " + ex.getMessage(), ex);
        }
    }

    private static void copyFileToStream(File file, OutputStream out) throws IOException {
        byte[] buffer = new byte[65536];
        try (FileInputStream in = new FileInputStream(file)) {
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        }
    }
}
