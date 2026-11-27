import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { arrayBufferToBase64 } from './dngEncoder';

interface MediaSaverPlugin {
  saveToGallery(options: {
    fileName: string;
    mimeType: string;
    data: string;
  }): Promise<{ uri: string }>;
  saveFileToGallery(options: {
    filePath: string;
    fileName: string;
    mimeType: string;
  }): Promise<{ uri: string }>;
  openInSnapseed(options: {
    fileName: string;
    mimeType: string;
    data?: string;
    filePath?: string;
  }): Promise<void>;
}

const MediaSaver = registerPlugin<MediaSaverPlugin>('MediaSaver');

export interface SaveMediaParams {
  fileName: string;
  mimeType: string;
  dataUrl?: string;
  buffer?: ArrayBuffer;
  filePath?: string;
  allowWebDownload?: boolean;
}

export interface SaveMediaResult {
  location: 'mediastore' | 'documents' | 'share' | 'cache' | 'web';
  message: string;
}

export const saveMediaToDevice = async ({
  fileName,
  mimeType,
  dataUrl,
  buffer,
  filePath,
  allowWebDownload = true,
}: SaveMediaParams): Promise<SaveMediaResult> => {
  const isDng = mimeType === 'image/x-adobe-dng';

  if (filePath && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    await MediaSaver.saveFileToGallery({
      filePath,
      fileName,
      mimeType,
    });
    return {
      location: 'mediastore',
      message: isDng
        ? 'RAW (.dng) guardado em Pictures/MonoLensPro'
        : 'Foto guardada em Pictures/MonoLensPro',
    };
  }

  if (!Capacitor.isNativePlatform()) {
    if (!allowWebDownload) {
      return { location: 'web', message: 'Guardado na galeria da app' };
    }
    if (buffer) {
      const blob = new Blob([buffer], { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      return { location: 'web', message: 'Ficheiro .dng guardado' };
    }
    if (dataUrl) {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return {
        location: 'web',
        message: isDng ? 'Ficheiro .dng guardado' : 'Download iniciado',
      };
    }
    throw new Error('Sem dados para guardar.');
  }

  const base64Data = buffer
    ? arrayBufferToBase64(buffer)
    : dataUrl && dataUrl.includes(',')
    ? dataUrl.split(',')[1]
    : dataUrl || '';

  if (!base64Data) {
    throw new Error('Imagem vazia.');
  }

  // 1. Android MediaStore -> Pictures/MonoLensPro
  if (Capacitor.getPlatform() === 'android') {
    try {
      await MediaSaver.saveToGallery({
        fileName,
        mimeType,
        data: base64Data,
      });
      return {
        location: 'mediastore',
        message: isDng
          ? 'Ficheiro .dng guardado em Pictures/MonoLensPro'
          : 'Foto guardada em Pictures/MonoLensPro',
      };
    } catch (mediaErr) {
      console.warn('MediaSaver falhou, usando fallback Filesystem:', mediaErr);
    }
  }

  // 2. Fallback: Documents
  try {
    await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory: Directory.Documents,
    });
    return {
      location: 'documents',
      message: isDng
        ? 'Ficheiro .dng guardado em Documentos'
        : 'Foto guardada em Documentos',
    };
  } catch (err) {
    console.warn('Falha ao escrever em Documents:', err);
  }

  // 3. Fallback: Web Share / Cache
  if (allowWebDownload) {
    const blob = buffer
      ? new Blob([buffer], { type: mimeType })
      : await (await fetch(dataUrl || '')).blob();
    const file = new File([blob], fileName, { type: mimeType });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: 'MonoLens Pro',
        files: [file],
      });
      return { location: 'share', message: 'Partilha concluída' };
    }
  }

  await Filesystem.writeFile({
    path: fileName,
    data: base64Data,
    directory: Directory.Cache,
  });
  return {
    location: 'cache',
    message: isDng
      ? 'Ficheiro .dng guardado no cache do app'
      : 'Foto guardada no cache do app',
  };
};

export interface OpenInSnapseedParams {
  fileName: string;
  mimeType: string;
  dataUrl?: string;
  buffer?: ArrayBuffer;
  filePath?: string;
}

export const openImageInSnapseed = async ({
  fileName,
  mimeType,
  dataUrl,
  buffer,
  filePath,
}: OpenInSnapseedParams): Promise<void> => {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      if (filePath) {
        await MediaSaver.openInSnapseed({
          filePath,
          fileName,
          mimeType,
        });
        return;
      }

      const base64Data = buffer
        ? arrayBufferToBase64(buffer)
        : dataUrl && dataUrl.includes(',')
        ? dataUrl.split(',')[1]
        : dataUrl || '';

      if (!base64Data) {
        throw new Error('Imagem vazia.');
      }

      await MediaSaver.openInSnapseed({
        fileName,
        mimeType,
        data: base64Data,
      });
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('SNAPSEED_NOT_INSTALLED')) {
        throw new Error('SNAPSEED_NOT_INSTALLED');
      }
      throw err;
    }
  }

  // Web fallback via Web Share API if supported
  if (typeof navigator !== 'undefined' && navigator.canShare) {
    try {
      const blob = buffer
        ? new Blob([buffer], { type: mimeType })
        : dataUrl
        ? await (await fetch(dataUrl)).blob()
        : null;
      if (blob) {
        const file = new File([blob], fileName, { type: mimeType });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'MonoLens Pro',
            files: [file],
          });
          return;
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
    }
  }

  throw new Error('SNAPSEED_ANDROID_ONLY');
};
