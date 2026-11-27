import React from 'react';
import { Check, Loader2, RotateCcw } from 'lucide-react';
import { CapturedImage, DEFAULT_SETTINGS, FilterSettings } from '../types';
import { BW_COLOR_FILTERS, cloneFilterSettings } from '../utils/bwFilters';
import { Translations } from '../utils/i18n';
import SliderControl from './SliderControl';

interface GalleryEditorPreviewProps {
  image: CapturedImage;
  editSettings: FilterSettings;
  alt: string;
}

export const GalleryEditorPreview: React.FC<GalleryEditorPreviewProps> = ({
  image,
  editSettings,
  alt,
}) => (
  <div className="relative w-full h-full flex items-center justify-center p-4 pb-[42vh]">
    <div className="relative max-w-full max-h-full flex items-center justify-center overflow-hidden">
      <img
        src={image.originalUrl || image.url}
        alt={alt}
        className="max-w-full max-h-[52vh] object-contain"
        style={{ filter: 'url(#mono-pro-filter)' }}
      />
      {(editSettings.vignette ?? 0) > 0.005 && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(circle, transparent 42%, rgba(0, 0, 0, ${(
              (editSettings.vignette ?? 0) * 0.85
            ).toFixed(2)}) 100%)`,
          }}
        />
      )}
      {(editSettings.grain ?? 0) > 0.005 && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{
            opacity: ((editSettings.grain ?? 0) * 0.28).toFixed(2),
            mixBlendMode: 'overlay',
          }}
          aria-hidden="true"
        >
          <filter id="gallery-edit-grain">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.82"
              numOctaves="2"
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#gallery-edit-grain)" />
        </svg>
      )}
    </div>
  </div>
);

interface GalleryEditorSheetProps {
  image: CapturedImage;
  editSettings: FilterSettings;
  isProcessingCopy: boolean;
  onChangeSettings: React.Dispatch<React.SetStateAction<FilterSettings>>;
  onSaveCopy: () => void;
  onCancel: () => void;
  t: Translations;
}

export const GalleryEditorSheet: React.FC<GalleryEditorSheetProps> = ({
  image,
  editSettings,
  isProcessingCopy,
  onChangeSettings,
  onSaveCopy,
  onCancel,
  t,
}) => (
  <div className="absolute bottom-0 left-0 right-0 z-30 bg-black/90 backdrop-blur-2xl border-t border-white/15 rounded-t-3xl flex flex-col max-h-[48vh]">
    <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
      <button
        type="button"
        onClick={onCancel}
        disabled={isProcessingCopy}
        className="px-3 py-1.5 rounded-full text-xs font-medium text-zinc-300 hover:text-white active:scale-95"
      >
        {t.cancel}
      </button>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            onChangeSettings(
              image.originalUrl
                ? cloneFilterSettings(image.settings)
                : cloneFilterSettings(DEFAULT_SETTINGS)
            )
          }
          disabled={isProcessingCopy}
          aria-label={t.resetCurves}
          className="p-2 rounded-full text-zinc-400 hover:text-white active:scale-95"
        >
          <RotateCcw size={16} />
        </button>
        <button
          type="button"
          onClick={onSaveCopy}
          disabled={isProcessingCopy}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white text-black text-xs font-semibold active:scale-95 disabled:opacity-50"
        >
          {isProcessingCopy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Check size={14} />
          )}
          <span>{t.saveCopy}</span>
        </button>
      </div>
    </div>

    <div className="px-5 py-4 overflow-y-auto space-y-4">
      {image.originalUrl ? (
        <div className="space-y-1.5">
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400">
            {t.opticalBwFilter}
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {BW_COLOR_FILTERS.map(filter => {
              const active = (editSettings.colorFilter ?? 'neutral') === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() =>
                    onChangeSettings(prev => ({ ...prev, colorFilter: filter.id }))
                  }
                  className={`min-h-[34px] px-2 py-1 rounded-xl border flex items-center gap-1.5 text-[11px] font-medium transition-all active:scale-95 ${
                    active
                      ? 'bg-white text-black border-white'
                      : 'bg-white/5 text-zinc-200 border-white/10'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/30"
                    style={{ backgroundColor: filter.swatchHex }}
                  />
                  <span className="truncate">{filter.shortLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-zinc-400 font-mono">
          {t.reeditNonDestructiveNote}
        </p>
      )}

      <SliderControl
        label={t.curveContrast}
        value={editSettings.contrast}
        defaultValue={1.0}
        min={0.5}
        max={2.0}
        step={0.05}
        onChange={v => onChangeSettings(prev => ({ ...prev, contrast: v }))}
      />
      <SliderControl
        label={t.curveMidtones}
        value={editSettings.midTone}
        defaultValue={1.0}
        min={0.1}
        max={3.0}
        step={0.1}
        onChange={v => onChangeSettings(prev => ({ ...prev, midTone: v }))}
      />
      <SliderControl
        label={t.curveInputBlack}
        value={editSettings.blackPoint}
        defaultValue={0}
        min={0}
        max={255}
        onChange={v => onChangeSettings(prev => ({ ...prev, blackPoint: v }))}
      />
      <SliderControl
        label={t.curveInputWhite}
        value={editSettings.whitePoint}
        defaultValue={255}
        min={0}
        max={255}
        onChange={v => onChangeSettings(prev => ({ ...prev, whitePoint: v }))}
      />
      <SliderControl
        label={t.grain}
        value={Math.round((editSettings.grain ?? 0) * 100)}
        defaultValue={0}
        min={0}
        max={100}
        step={2}
        onChange={v => onChangeSettings(prev => ({ ...prev, grain: v / 100 }))}
      />
      <SliderControl
        label={t.vignette}
        value={Math.round((editSettings.vignette ?? 0) * 100)}
        defaultValue={0}
        min={0}
        max={100}
        step={2}
        onChange={v => onChangeSettings(prev => ({ ...prev, vignette: v / 100 }))}
      />
    </div>
  </div>
);
