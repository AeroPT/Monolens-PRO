import React, { useState, useRef, useEffect, memo, useCallback } from 'react';
import { CapturedImage, DEFAULT_SETTINGS, FilterSettings } from '../types';
import {
  ChevronLeft,
  Trash2,
  Download,
  Info,
  X,
  ChevronRight,
  Loader2,
  SlidersHorizontal,
  Check,
  Globe,
} from 'lucide-react';
import { saveMediaToDevice, openImageInSnapseed } from '../utils/mediaSave';
import { reprocessImageFromUrl } from '../utils/imageProcessing';
import { BW_COLOR_FILTERS, cloneFilterSettings } from '../utils/bwFilters';
import { useI18n } from '../utils/i18n';
import SVGFilters from './SVGFilters';
import ZoomableImageView from './ZoomableImageView';
import { GalleryEditorPreview, GalleryEditorSheet } from './GalleryEditor';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

const SnapseedIcon: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M19.5 4.5C12.5 4.5 6.8 8.3 5.2 14.8C4.8 16.5 4.9 18.2 5.4 19.6C6.9 20.1 8.7 20.1 10.5 19.6C16.7 17.9 19.9 12.2 19.5 4.5Z"
      fill="#4ADE80"
      fillOpacity="0.22"
      stroke="#4ADE80"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M4.5 19.5C8.5 15.5 12.8 11.4 19.5 4.5"
      stroke="#4ADE80"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

interface LazyThumbnailProps {
  image: CapturedImage;
  index: number;
  isSelectionMode: boolean;
  isSelected: boolean;
  onClick: () => void;
  onLongPress: () => void;
}

const LazyThumbnail = memo(
  ({
    image,
    index,
    isSelectionMode,
    isSelected,
    onClick,
    onLongPress,
  }: LazyThumbnailProps) => {
    const [isLoaded, setIsLoaded] = useState(false);
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressTriggeredRef = useRef(false);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);

    const clearTimer = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };

    useEffect(() => () => clearTimer(), []);

    const handleTouchStart = (e: React.TouchEvent) => {
      if (isSelectionMode || e.touches.length !== 1) return;
      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      longPressTriggeredRef.current = false;
      clearTimer();
      longPressTimerRef.current = setTimeout(() => {
        longPressTriggeredRef.current = true;
        onLongPress();
      }, 420);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
      if (!touchStartRef.current || !longPressTimerRef.current) return;
      const touch = e.touches[0];
      if (
        Math.abs(touch.clientX - touchStartRef.current.x) > 10 ||
        Math.abs(touch.clientY - touchStartRef.current.y) > 10
      ) {
        clearTimer();
      }
    };

    const handleTouchEnd = () => {
      clearTimer();
      touchStartRef.current = null;
    };

    const handleClick = (e: React.MouseEvent) => {
      if (longPressTriggeredRef.current) {
        e.preventDefault();
        e.stopPropagation();
        longPressTriggeredRef.current = false;
        return;
      }
      onClick();
    };

    return (
      <button
        type="button"
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        className="aspect-square relative overflow-hidden bg-zinc-900 group w-full h-full border border-black"
      >
        <div
          className={`absolute inset-0 flex items-center justify-center bg-zinc-800 transition-opacity duration-500 ${
            isLoaded ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <div className="w-full h-full bg-zinc-800 animate-pulse" />
        </div>

        <img
          src={image.thumbnailUrl || image.url}
          alt={`Thumbnail ${index}`}
          className={`w-full h-full object-cover transition-all duration-300 will-change-opacity ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          } ${isSelectionMode && isSelected ? 'scale-[0.9] rounded-md brightness-90' : ''}`}
          loading="lazy"
          decoding="async"
          onLoad={() => setIsLoaded(true)}
        />

        {isSelectionMode && isSelected && (
          <div className="absolute inset-0 ring-2 ring-inset ring-yellow-400 pointer-events-none" />
        )}

        <div className="absolute inset-0 bg-white/10 opacity-0 group-active:opacity-100 transition-opacity duration-200 pointer-events-none" />

        {isSelectionMode && (
          <span
            className={`absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center transition-all pointer-events-none ${
              isSelected
                ? 'bg-yellow-400 text-black border border-yellow-300 shadow-md scale-100'
                : 'bg-black/55 border-2 border-white/75 scale-95'
            }`}
          >
            {isSelected && <Check size={14} strokeWidth={3} />}
          </span>
        )}

        {(image.dngFilePath || image.dngBuffer || image.originalUrl) && (
          <span className="absolute bottom-1.5 right-1.5 text-[9px] font-mono font-bold text-yellow-400 bg-black/70 px-1.5 py-0.5 rounded pointer-events-none">
            {image.dngFilePath ? 'RAW DNG' : image.dngBuffer ? 'DNG' : 'RAW'}
          </span>
        )}
      </button>
    );
  }
);

interface GalleryProps {
  images: CapturedImage[];
  onBack: () => void;
  onDelete: (id: string) => void;
  onDeleteMany?: (ids: string[]) => Promise<void> | void;
  onSaveCopy?: (image: CapturedImage) => Promise<void> | void;
}

const Gallery: React.FC<GalleryProps> = ({
  images,
  onBack,
  onDelete,
  onDeleteMany,
  onSaveCopy,
}) => {
  const { lang, toggleLang, t } = useI18n();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isOpeningSnapseed, setIsOpeningSnapseed] = useState(false);
  const [showSnapseedChoice, setShowSnapseedChoice] = useState(false);
  const [viewOriginal, setViewOriginal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isProcessingCopy, setIsProcessingCopy] = useState(false);
  const [editSettings, setEditSettings] = useState<FilterSettings>(() =>
    cloneFilterSettings(DEFAULT_SETTINGS)
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedImage = selectedIndex !== null ? images[selectedIndex] : null;

  useEffect(() => {
    setViewOriginal(false);
    setIsEditing(false);
    setShowSnapseedChoice(false);
  }, [selectedIndex]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 2600);
  }, []);

  useEffect(() => {
    if (selectedIndex === null) return;
    if (selectedIndex > 0 && images[selectedIndex - 1]) {
      const img = new Image();
      img.src = images[selectedIndex - 1].url;
    }
    if (selectedIndex < images.length - 1 && images[selectedIndex + 1]) {
      const img = new Image();
      img.src = images[selectedIndex + 1].url;
    }
  }, [selectedIndex, images]);

  const handleOpenEditor = () => {
    if (!selectedImage) return;
    setShowInfo(false);
    setViewOriginal(false);
    setEditSettings(
      selectedImage.originalUrl
        ? cloneFilterSettings(selectedImage.settings)
        : cloneFilterSettings(DEFAULT_SETTINGS)
    );
    setIsEditing(true);
  };

  const handleSaveEditedCopy = async () => {
    if (!selectedImage || !onSaveCopy || isProcessingCopy) return;
    setIsProcessingCopy(true);
    try {
      const sourceUrl = selectedImage.originalUrl || selectedImage.url;
      const result = await reprocessImageFromUrl(sourceUrl, editSettings);
      const nowTs = Date.now();
      const newImage: CapturedImage = {
        id: String(nowTs),
        url: result.url,
        thumbnailUrl: result.thumbnailUrl,
        originalUrl: selectedImage.originalUrl,
        captureMode: selectedImage.captureMode,
        width: result.width,
        height: result.height,
        timestamp: nowTs,
        settings: cloneFilterSettings(editSettings),
      };
      await onSaveCopy(newImage);
      setIsEditing(false);
      setSelectedIndex(0);
      showToast(t.saveCopySuccess);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.saveError;
      showToast(msg);
    } finally {
      setIsProcessingCopy(false);
    }
  };

  const toggleSelectImage = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const enterSelectionModeWith = useCallback((id: string) => {
    try {
      Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    } catch {
      // Ignore on web
    }
    setIsSelectionMode(true);
    setSelectedIds(new Set([id]));
  }, []);

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedIds(new Set());
    setShowBatchDeleteConfirm(false);
  }, []);

  const handleToggleSelectAll = () => {
    if (selectedIds.size === images.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(images.map(img => img.id)));
    }
  };

  const handleBatchDeleteConfirm = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (onDeleteMany) {
      await onDeleteMany(ids);
    } else {
      for (const id of ids) {
        onDelete(id);
      }
    }
    exitSelectionMode();
    showToast(ids.length === 1 ? t.photoDeleted : t.photosDeleted(ids.length));
  };

  const handleDownload = async (saveDng = false) => {
    if (!selectedImage || isSaving) return;

    const hasDngFilePath = saveDng && !!selectedImage.dngFilePath;
    const hasDngBuffer = saveDng && !hasDngFilePath && !!selectedImage.dngBuffer;
    const hasLegacyOriginal =
      saveDng && !hasDngFilePath && !hasDngBuffer && !!selectedImage.originalUrl;

    const targetUrl = hasLegacyOriginal
      ? selectedImage.originalUrl!
      : selectedImage.url;

    const fileName =
      hasDngFilePath || hasDngBuffer
        ? `RAW_${selectedImage.timestamp}.dng`
        : hasLegacyOriginal
        ? `RAW_ORIG_${selectedImage.timestamp}.png`
        : `MONO_${selectedImage.timestamp}.jpg`;

    const mimeType =
      hasDngFilePath || hasDngBuffer
        ? 'image/x-adobe-dng'
        : hasLegacyOriginal
        ? 'image/png'
        : 'image/jpeg';

    setIsSaving(true);

    try {
      const res = await saveMediaToDevice({
        fileName,
        mimeType,
        filePath: hasDngFilePath ? selectedImage.dngFilePath : undefined,
        dataUrl: hasDngFilePath || hasDngBuffer ? undefined : targetUrl,
        buffer: hasDngBuffer ? selectedImage.dngBuffer : undefined,
        allowWebDownload: true,
      });
      showToast(res.message);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.saveError;
      showToast(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const launchSnapseed = async (format: 'dng' | 'jpg') => {
    if (!selectedImage || isSaving || isOpeningSnapseed) return;

    const useDngFile = format === 'dng' && !!selectedImage.dngFilePath;
    const useDngBuffer =
      format === 'dng' && !useDngFile && !!selectedImage.dngBuffer;
    const useOriginalLegacy =
      format === 'jpg' &&
      viewOriginal &&
      !selectedImage.dngFilePath &&
      !selectedImage.dngBuffer &&
      !!selectedImage.originalUrl;

    const fileName =
      useDngFile || useDngBuffer
        ? `RAW_${selectedImage.timestamp}.dng`
        : useOriginalLegacy
        ? `RAW_ORIG_${selectedImage.timestamp}.png`
        : `MONO_${selectedImage.timestamp}.jpg`;

    const mimeType =
      useDngFile || useDngBuffer
        ? 'image/x-adobe-dng'
        : useOriginalLegacy
        ? 'image/png'
        : 'image/jpeg';

    setShowSnapseedChoice(false);
    setIsOpeningSnapseed(true);
    try {
      await openImageInSnapseed({
        fileName,
        mimeType,
        filePath: useDngFile ? selectedImage.dngFilePath : undefined,
        buffer: useDngBuffer ? selectedImage.dngBuffer : undefined,
        dataUrl:
          useDngFile || useDngBuffer
            ? undefined
            : useOriginalLegacy
            ? selectedImage.originalUrl!
            : selectedImage.url,
      });
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : '';
      if (useDngFile && code.includes('SOURCE_FILE_NOT_FOUND')) {
        try {
          if (selectedImage.dngBuffer) {
            await openImageInSnapseed({
              fileName: `RAW_${selectedImage.timestamp}.dng`,
              mimeType: 'image/x-adobe-dng',
              buffer: selectedImage.dngBuffer,
            });
            return;
          }
          await openImageInSnapseed({
            fileName: `MONO_${selectedImage.timestamp}.jpg`,
            mimeType: 'image/jpeg',
            dataUrl: selectedImage.url,
          });
          return;
        } catch (fallbackErr: unknown) {
          const fallbackCode =
            fallbackErr instanceof Error ? fallbackErr.message : '';
          showToast(fallbackCode || t.snapseedError);
          return;
        }
      }
      if (code === 'SNAPSEED_NOT_INSTALLED') {
        showToast(t.snapseedNotInstalled);
      } else if (code === 'SNAPSEED_ANDROID_ONLY') {
        showToast(t.snapseedAndroidOnly);
      } else {
        showToast(code || t.snapseedError);
      }
    } finally {
      setIsOpeningSnapseed(false);
    }
  };

  const handleOpenInSnapseed = () => {
    if (!selectedImage || isSaving || isOpeningSnapseed) return;
    const hasDng = !!(selectedImage.dngFilePath || selectedImage.dngBuffer);
    if (hasDng) {
      setShowSnapseedChoice(true);
    } else {
      void launchSnapseed('jpg');
    }
  };

  const handleDeleteConfirm = () => {
    if (!selectedImage) return;
    onDelete(selectedImage.id);
    setShowDeleteConfirm(false);

    if (images.length <= 1) {
      setSelectedIndex(null);
      onBack();
    } else {
      const newIndex =
        selectedIndex! >= images.length - 1 ? images.length - 2 : selectedIndex!;
      setSelectedIndex(newIndex);
    }
  };

  const handleNext = useCallback(() => {
    if (selectedIndex !== null && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
  }, [selectedIndex]);

  const handlePrev = useCallback(() => {
    if (selectedIndex !== null && selectedIndex < images.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }
  }, [selectedIndex, images.length]);

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString(lang === 'en' ? 'en-US' : 'pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  if (selectedImage) {
    const isFirst = selectedIndex === 0;
    const isLast = selectedIndex === images.length - 1;
    const selectedFilterDef =
      BW_COLOR_FILTERS.find(
        f => f.id === (selectedImage.settings.colorFilter ?? 'neutral')
      ) ?? BW_COLOR_FILTERS[0];
    const formattedDate = formatDate(selectedImage.timestamp);
    const [datePart, timePart] = formattedDate.split(/[,\s]+/);

    return (
      <div className="w-full h-full bg-black flex flex-col z-50 fixed inset-0 animate-fade-in">
        {isEditing && <SVGFilters settings={editSettings} />}

        {!isEditing && (
          <div
            className={`absolute top-0 left-0 w-full p-4 safe-top flex justify-between items-center z-20 transition-opacity duration-300 ${
              isInteracting ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
          >
            <button
              type="button"
              onClick={() => setSelectedIndex(null)}
              className="text-white/80 hover:text-white p-2 rounded-full bg-black/20 backdrop-blur-md"
            >
              <ChevronLeft size={28} />
            </button>
            <div className="text-white/80 font-mono text-xs bg-black/20 backdrop-blur-md px-3 py-1 rounded-full">
              {datePart} • {timePart}
            </div>
            <button
              type="button"
              onClick={() => setShowInfo(v => !v)}
              className={`p-2 rounded-full backdrop-blur-md transition-colors ${
                showInfo ? 'bg-white text-black' : 'bg-black/20 text-white/80'
              }`}
            >
              <Info size={24} />
            </button>
          </div>
        )}

        <div className="flex-1 w-full h-full relative bg-black flex items-center justify-center overflow-hidden">
          {isEditing ? (
            <GalleryEditorPreview
              image={selectedImage}
              editSettings={editSettings}
              alt={t.editPreviewAlt}
            />
          ) : (
            <ZoomableImageView
              key={`${selectedImage.id}-${viewOriginal ? 'orig' : 'bw'}`}
              src={
                viewOriginal && selectedImage.originalUrl
                  ? selectedImage.originalUrl
                  : selectedImage.url
              }
              alt="Full View"
              onSwipeLeft={handlePrev}
              onSwipeRight={handleNext}
              onInteractionStart={() => setIsInteracting(true)}
              onInteractionEnd={() => setIsInteracting(false)}
            />
          )}

          {!isEditing && selectedImage.originalUrl && !isInteracting && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 p-1 rounded-xl bg-black/75 border border-white/15 backdrop-blur-md">
              <button
                type="button"
                onClick={() => setViewOriginal(false)}
                className={`px-3 py-1 rounded-lg text-[11px] font-mono font-semibold transition-colors ${
                  !viewOriginal ? 'bg-white text-black' : 'text-zinc-300'
                }`}
              >
                {t.bwPill}
              </button>
              <button
                type="button"
                onClick={() => setViewOriginal(true)}
                className={`px-3 py-1 rounded-lg text-[11px] font-mono font-semibold transition-colors ${
                  viewOriginal ? 'bg-yellow-400 text-black' : 'text-zinc-300'
                }`}
              >
                {t.origDngPill}
              </button>
            </div>
          )}

          {!isEditing && !isInteracting && (
            <>
              {!isFirst && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    handleNext();
                  }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-white/30 hover:text-white transition-colors pointer-events-auto"
                >
                  <ChevronLeft size={40} />
                </button>
              )}
              {!isLast && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    handlePrev();
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-white/30 hover:text-white transition-colors pointer-events-auto"
                >
                  <ChevronRight size={40} />
                </button>
              )}
            </>
          )}
        </div>

        {!isEditing && (
          <div
            className={`absolute bottom-20 left-4 right-4 bg-zinc-900/90 backdrop-blur-xl border border-white/10 rounded-2xl p-5 text-white shadow-2xl transition-transform duration-300 ease-spring ${
              showInfo && !isInteracting ? 'translate-y-0' : 'translate-y-[150%]'
            } z-20`}
          >
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
                {t.imageInfoTitle}
              </h3>
              <button type="button" onClick={() => setShowInfo(false)}>
                <X size={16} className="text-zinc-500" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-xs font-mono">
              <div>
                <span className="text-zinc-500 block">{t.fileLabel}</span>
                <span className="text-white">
                  {selectedImage.dngFilePath
                    ? 'RAW Bayer DNG + JPEG'
                    : selectedImage.dngBuffer
                    ? 'DNG + JPEG'
                    : 'JPEG High Quality'}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">{t.captureLabel}</span>
                <span className="text-white">{formattedDate}</span>
              </div>
              {selectedImage.width && selectedImage.height && (
                <div>
                  <span className="text-zinc-500 block">{t.resolutionLabel}</span>
                  <span className="text-white font-bold">
                    {selectedImage.width} x {selectedImage.height}
                  </span>
                </div>
              )}
              <div>
                <span className="text-zinc-500 block">{t.opticalFilterLabel}</span>
                <span className="text-white">{selectedFilterDef.label}</span>
              </div>
              {selectedImage.captureMode && (
                <div className="col-span-2">
                  <span className="text-zinc-500 block">{t.modeLabel}</span>
                  <span className="text-white">
                    {selectedImage.captureMode === 'sensor_max'
                      ? t.sensorMaxLabel
                      : selectedImage.captureMode === 'stream4k'
                      ? t.stream4kLabel
                      : t.fastLabel}
                  </span>
                </div>
              )}
              <div className="col-span-2 h-px bg-white/10 my-1" />
              <div>
                <span className="text-zinc-500 block">{t.gammaLabel}</span>
                <span className="text-white">
                  {selectedImage.settings.midTone.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">{t.contrastLabel}</span>
                <span className="text-white">
                  {((selectedImage.settings.contrast - 1) * 100).toFixed(0)}%
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">{t.grainLabel}</span>
                <span className="text-white">
                  {Math.round((selectedImage.settings.grain ?? 0) * 100)}%
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">{t.vignetteLabel}</span>
                <span className="text-white">
                  {Math.round((selectedImage.settings.vignette ?? 0) * 100)}%
                </span>
              </div>
            </div>
          </div>
        )}

        {isEditing ? (
          <GalleryEditorSheet
            image={selectedImage}
            editSettings={editSettings}
            isProcessingCopy={isProcessingCopy}
            onChangeSettings={setEditSettings}
            onSaveCopy={handleSaveEditedCopy}
            onCancel={() => setIsEditing(false)}
            t={t}
          />
        ) : (
          <div
            className={`absolute bottom-0 left-0 w-full px-3 pt-6 pb-8 bg-gradient-to-t from-black/90 to-transparent flex justify-around items-center gap-1 z-20 transition-opacity duration-300 ${
              isInteracting ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
          >
            <button
              type="button"
              onClick={() => handleDownload(false)}
              disabled={isSaving || isOpeningSnapseed}
              className="flex flex-col items-center space-y-1 text-white/80 active:text-white active:scale-95 transition-all disabled:opacity-50 min-w-0"
            >
              {isSaving ? (
                <Loader2 size={22} className="animate-spin" />
              ) : (
                <Download size={22} strokeWidth={1.5} />
              )}
              <span className="text-[10px] uppercase tracking-wide whitespace-nowrap">
                {t.exportBw}
              </span>
            </button>
            {(selectedImage.dngFilePath ||
              selectedImage.dngBuffer ||
              selectedImage.originalUrl) && (
              <button
                type="button"
                onClick={() => handleDownload(true)}
                disabled={isSaving || isOpeningSnapseed}
                className="flex flex-col items-center space-y-1 text-yellow-400/90 active:text-yellow-300 active:scale-95 transition-all disabled:opacity-50 min-w-0"
              >
                {isSaving ? (
                  <Loader2 size={22} className="animate-spin" />
                ) : (
                  <Download size={22} strokeWidth={1.5} />
                )}
                <span className="text-[10px] uppercase tracking-wide whitespace-nowrap">
                  {t.exportDng}
                </span>
              </button>
            )}
            {onSaveCopy && (
              <button
                type="button"
                onClick={handleOpenEditor}
                disabled={isSaving || isOpeningSnapseed}
                className="flex flex-col items-center space-y-1 text-white/80 active:text-white active:scale-95 transition-all disabled:opacity-50 min-w-0"
              >
                <SlidersHorizontal size={22} strokeWidth={1.5} />
                <span className="text-[10px] uppercase tracking-wide whitespace-nowrap">
                  {t.reedit}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenInSnapseed}
              disabled={isSaving || isOpeningSnapseed}
              className="flex flex-col items-center space-y-1 text-emerald-400/90 active:text-emerald-300 active:scale-95 transition-all disabled:opacity-50 min-w-0"
            >
              {isOpeningSnapseed ? (
                <Loader2 size={22} className="animate-spin text-emerald-400" />
              ) : (
                <SnapseedIcon size={22} />
              )}
              <span className="text-[10px] uppercase tracking-wide whitespace-nowrap">
                {t.snapseedLabel}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isSaving || isOpeningSnapseed}
              className="flex flex-col items-center space-y-1 text-red-500/80 active:text-red-500 active:scale-95 transition-all disabled:opacity-50 min-w-0"
            >
              <Trash2 size={22} strokeWidth={1.5} />
              <span className="text-[10px] uppercase tracking-wide whitespace-nowrap">
                {t.delete}
              </span>
            </button>
          </div>
        )}

        {toastMessage && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-zinc-900/95 border border-white/15 text-xs font-medium text-white shadow-2xl whitespace-nowrap">
            {toastMessage}
          </div>
        )}

        {showSnapseedChoice && !isEditing && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-6"
            onClick={() => setShowSnapseedChoice(false)}
          >
            <div
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-xs shadow-2xl transform scale-100 transition-all"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-center mb-3">
                <div className="w-11 h-11 rounded-full bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center">
                  <SnapseedIcon size={24} />
                </div>
              </div>
              <h3 className="text-lg font-bold text-white mb-2 text-center">
                {t.snapseedChooseTitle}
              </h3>
              <p className="text-zinc-400 text-sm mb-5 text-center leading-relaxed">
                {t.snapseedChooseDesc}
              </p>
              <div className="flex flex-col space-y-2.5">
                <button
                  type="button"
                  onClick={() => void launchSnapseed('dng')}
                  className="w-full py-3 px-4 bg-yellow-400 text-black rounded-xl font-semibold active:bg-yellow-300 transition-colors text-sm"
                >
                  {t.snapseedOptionDng}
                </button>
                <button
                  type="button"
                  onClick={() => void launchSnapseed('jpg')}
                  className="w-full py-3 px-4 bg-white text-black rounded-xl font-semibold active:bg-zinc-200 transition-colors text-sm"
                >
                  {t.snapseedOptionJpg}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSnapseedChoice(false)}
                  className="w-full py-2.5 px-4 bg-zinc-800 text-zinc-200 rounded-xl font-medium active:bg-zinc-700 transition-colors text-sm"
                >
                  {t.cancel}
                </button>
              </div>
            </div>
          </div>
        )}

        {showDeleteConfirm && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-xs shadow-2xl transform scale-100 transition-all">
              <h3 className="text-lg font-bold text-white mb-2 text-center">
                {t.deletePhotoTitle}?
              </h3>
              <p className="text-zinc-400 text-sm mb-6 text-center leading-relaxed">
                {t.irreversibleMsg}
              </p>
              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-3 px-4 bg-zinc-800 text-white rounded-xl font-medium active:bg-zinc-700 transition-colors text-sm"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteConfirm}
                  className="flex-1 py-3 px-4 bg-red-600 text-white rounded-xl font-medium active:bg-red-700 transition-colors text-sm"
                >
                  {t.confirmDelete}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-black flex flex-col relative">
      <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between bg-black/90 backdrop-blur-sm z-10 sticky top-0 safe-top">
        {isSelectionMode ? (
          <>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={exitSelectionMode}
                className="px-3 py-1.5 rounded-full bg-white/10 text-xs font-medium text-white active:scale-95 transition-transform"
              >
                {t.cancel}
              </button>
              <span className="text-sm font-mono font-semibold text-white tabular-nums">
                {t.selectedCount(selectedIds.size)}
              </span>
            </div>
            {images.length > 0 && (
              <button
                type="button"
                onClick={handleToggleSelectAll}
                className="px-3 py-1.5 rounded-full bg-white/10 text-xs font-medium text-yellow-400 active:scale-95 transition-transform"
              >
                {selectedIds.size === images.length ? t.deselectAll : t.selectAll}
              </button>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center">
              <button
                type="button"
                onClick={onBack}
                className="mr-3 text-white p-1 -ml-2 rounded-full active:bg-white/10"
              >
                <ChevronLeft size={28} />
              </button>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white">
                  {t.galleryTitle}
                </h1>
                <p className="text-xs text-zinc-500 font-mono">
                  {t.galleryCount(images.length)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleLang}
                title={t.langToggleHint}
                aria-label={t.langToggleHint}
                className="px-2.5 py-1.5 rounded-full bg-white/10 border border-white/15 flex items-center gap-1 text-[11px] font-mono font-bold text-white active:scale-95 transition-transform"
              >
                <Globe size={13} className="text-zinc-300" />
                <span>{t.langPill}</span>
              </button>
              {images.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setIsSelectionMode(true);
                    setSelectedIds(new Set());
                  }}
                  className="px-3.5 py-1.5 rounded-full bg-white/10 border border-white/15 text-xs font-medium text-white active:scale-95 transition-transform"
                >
                  {t.select}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-1 scroll-smooth">
        {images.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-3/4 text-zinc-600 space-y-3 text-center px-6">
            <div className="w-16 h-16 rounded-full border-2 border-dashed border-zinc-700 flex items-center justify-center">
              <Info size={24} />
            </div>
            <p className="font-mono text-sm text-zinc-400">{t.galleryEmpty}</p>
            <p className="text-xs text-zinc-600">{t.galleryEmptySub}</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-0.5 pb-28">
            {images.map((img, index) => (
              <LazyThumbnail
                key={img.id}
                image={img}
                index={index}
                isSelectionMode={isSelectionMode}
                isSelected={selectedIds.has(img.id)}
                onClick={() => {
                  if (isSelectionMode) {
                    toggleSelectImage(img.id);
                  } else {
                    setSelectedIndex(index);
                  }
                }}
                onLongPress={() => enterSelectionModeWith(img.id)}
              />
            ))}
          </div>
        )}
      </div>

      {isSelectionMode && (
        <div className="absolute bottom-0 left-0 right-0 z-20 px-5 pt-3 pb-[max(var(--safe-area-bottom),20px)] bg-black/90 backdrop-blur-xl border-t border-white/15 flex items-center justify-between gap-3">
          <span className="text-xs font-mono text-zinc-400">
            {t.tapToSelect}
          </span>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => setShowBatchDeleteConfirm(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-red-600 text-white text-xs font-semibold active:scale-95 transition-all disabled:opacity-40"
          >
            <Trash2 size={15} />
            <span>{t.deleteSelected(selectedIds.size)}</span>
          </button>
        </div>
      )}

      {toastMessage && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-zinc-900/95 border border-white/15 text-xs font-medium text-white shadow-2xl whitespace-nowrap">
          {toastMessage}
        </div>
      )}

      {showBatchDeleteConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-xs shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2 text-center">
              {t.deleteBatchTitle} ({selectedIds.size})
            </h3>
            <p className="text-zinc-400 text-sm mb-6 text-center leading-relaxed">
              {t.irreversibleBatchMsg}
            </p>
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => setShowBatchDeleteConfirm(false)}
                className="flex-1 py-3 px-4 bg-zinc-800 text-white rounded-xl font-medium active:bg-zinc-700 transition-colors text-sm"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={handleBatchDeleteConfirm}
                className="flex-1 py-3 px-4 bg-red-600 text-white rounded-xl font-medium active:bg-red-700 transition-colors text-sm"
              >
                {t.confirmDelete}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Gallery;
