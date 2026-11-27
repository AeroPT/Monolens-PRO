import React, { useState, useMemo } from 'react';
import { BwColorFilterId, FilmRecipe, FilterSettings } from '../types';
import {
  BW_COLOR_FILTERS,
  BUILT_IN_RECIPES,
  cloneFilterSettings,
  loadCustomRecipes,
  saveCustomRecipes,
} from '../utils/bwFilters';
import SliderControl from './SliderControl';
import { BookmarkPlus, Check, Trash2, X } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { useI18n } from '../utils/i18n';

interface FilmControlProps {
  settings: FilterSettings;
  onApplyRecipe: (recipeSettings: FilterSettings) => void;
  onChangeSetting: <K extends keyof FilterSettings>(
    key: K,
    value: FilterSettings[K]
  ) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  isAdjusting: boolean;
}

const triggerHaptic = () => {
  try {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  } catch {
    // Ignore on web
  }
};

const areSettingsClose = (a: FilterSettings, b: FilterSettings): boolean => {
  if ((a.colorFilter ?? 'neutral') !== (b.colorFilter ?? 'neutral')) return false;
  if (Math.abs((a.grain ?? 0) - (b.grain ?? 0)) > 0.03) return false;
  if (Math.abs((a.vignette ?? 0) - (b.vignette ?? 0)) > 0.03) return false;
  if (Math.abs(a.contrast - b.contrast) > 0.03) return false;
  if (Math.abs(a.midTone - b.midTone) > 0.05) return false;
  if (Math.abs(a.blackPoint - b.blackPoint) > 3) return false;
  if (Math.abs(a.whitePoint - b.whitePoint) > 3) return false;
  if (a.curvePoints.length !== b.curvePoints.length) return false;
  return a.curvePoints.every(
    (p, idx) =>
      Math.abs(p.x - b.curvePoints[idx].x) < 0.03 &&
      Math.abs(p.y - b.curvePoints[idx].y) < 0.03
  );
};

const FilmControl: React.FC<FilmControlProps> = ({
  settings,
  onApplyRecipe,
  onChangeSetting,
  onInteractionStart,
  onInteractionEnd,
  isAdjusting,
}) => {
  const { t } = useI18n();
  const [customRecipes, setCustomRecipes] = useState<FilmRecipe[]>(() =>
    loadCustomRecipes()
  );
  const [isSavingRecipe, setIsSavingRecipe] = useState(false);
  const [recipeName, setRecipeName] = useState('');

  const activeFilterId: BwColorFilterId = settings.colorFilter ?? 'neutral';
  const activeFilterDef = useMemo(
    () => BW_COLOR_FILTERS.find(f => f.id === activeFilterId) ?? BW_COLOR_FILTERS[0],
    [activeFilterId]
  );

  const allRecipes = useMemo(
    () => [...BUILT_IN_RECIPES, ...customRecipes],
    [customRecipes]
  );

  const handleSaveCustomRecipe = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = recipeName.trim();
    if (!trimmed) return;

    const newRecipe: FilmRecipe = {
      id: `custom-${Date.now()}`,
      name: trimmed.slice(0, 22),
      isBuiltIn: false,
      settings: cloneFilterSettings(settings),
    };
    const next = [...customRecipes, newRecipe];
    setCustomRecipes(next);
    saveCustomRecipes(next);
    setRecipeName('');
    setIsSavingRecipe(false);
    triggerHaptic();
  };

  const handleDeleteCustomRecipe = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = customRecipes.filter(r => r.id !== id);
    setCustomRecipes(next);
    saveCustomRecipes(next);
    triggerHaptic();
  };

  return (
    <div className="space-y-5 pb-3 max-w-sm mx-auto select-none">
      {/* 1. Optical B&W Color Filters */}
      <div
        className={`space-y-2 transition-opacity duration-200 ${
          isAdjusting ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-zinc-400">
          <span>{t.opticalBwFilter}</span>
          <span className="text-zinc-300 font-semibold">{activeFilterDef.label}</span>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {BW_COLOR_FILTERS.map(filter => {
            const isSelected = activeFilterId === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => {
                  onInteractionStart();
                  onChangeSetting('colorFilter', filter.id);
                  onInteractionEnd();
                  triggerHaptic();
                }}
                className={`min-h-[38px] px-2.5 py-1.5 rounded-xl border flex items-center gap-2 text-[11px] font-medium transition-all active:scale-95 ${
                  isSelected
                    ? 'bg-white text-black border-white shadow-sm'
                    : 'bg-white/5 text-zinc-200 border-white/10 hover:bg-white/10'
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

        <p className="text-[11px] text-zinc-400 leading-tight">
          {activeFilterDef.description}
        </p>
      </div>

      {/* 2. Organic Film Grain & Optical Vignette */}
      <div className="space-y-4 pt-1 border-t border-white/10">
        <SliderControl
          label={t.grain}
          value={Math.round((settings.grain ?? 0) * 100)}
          defaultValue={0}
          min={0}
          max={100}
          step={2}
          onChange={v => onChangeSetting('grain', v / 100)}
          isAdjusting={isAdjusting}
          onInteractionStart={onInteractionStart}
          onInteractionEnd={onInteractionEnd}
        />

        <SliderControl
          label={t.vignette}
          value={Math.round((settings.vignette ?? 0) * 100)}
          defaultValue={0}
          min={0}
          max={100}
          step={2}
          onChange={v => onChangeSetting('vignette', v / 100)}
          isAdjusting={isAdjusting}
          onInteractionStart={onInteractionStart}
          onInteractionEnd={onInteractionEnd}
        />
      </div>

      {/* 3. Classic & Custom Film Recipes */}
      <div
        className={`space-y-2 pt-2 border-t border-white/10 transition-opacity duration-200 ${
          isAdjusting ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400">
            {t.filmRecipes}
          </span>
          {!isSavingRecipe && (
            <button
              type="button"
              onClick={() => setIsSavingRecipe(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-[10px] font-mono uppercase tracking-wider text-white active:scale-95 transition-transform"
            >
              <BookmarkPlus size={12} />
              <span>{t.saveRecipe}</span>
            </button>
          )}
        </div>

        {isSavingRecipe && (
          <form
            onSubmit={handleSaveCustomRecipe}
            className="flex items-center gap-1.5 bg-white/5 border border-white/15 rounded-xl p-1.5"
          >
            <input
              type="text"
              value={recipeName}
              onChange={e => setRecipeName(e.target.value)}
              placeholder={t.recipePlaceholder}
              maxLength={22}
              autoFocus
              className="flex-1 bg-transparent px-2 py-1 text-xs text-white placeholder-zinc-500 outline-none"
            />
            <button
              type="submit"
              disabled={!recipeName.trim()}
              aria-label="Confirmar receita"
              className="p-1.5 rounded-lg bg-white text-black disabled:opacity-30 active:scale-95"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                setIsSavingRecipe(false);
                setRecipeName('');
              }}
              aria-label="Cancelar"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white active:scale-95"
            >
              <X size={14} />
            </button>
          </form>
        )}

        <div className="flex flex-wrap gap-1.5">
          {allRecipes.map(recipe => {
            const isActive = areSettingsClose(settings, recipe.settings);
            const filterDef = BW_COLOR_FILTERS.find(
              f => f.id === (recipe.settings.colorFilter ?? 'neutral')
            );
            return (
              <div
                key={recipe.id}
                onClick={() => {
                  onInteractionStart();
                  onApplyRecipe(cloneFilterSettings(recipe.settings));
                  onInteractionEnd();
                  triggerHaptic();
                }}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onInteractionStart();
                    onApplyRecipe(cloneFilterSettings(recipe.settings));
                    onInteractionEnd();
                    triggerHaptic();
                  }
                }}
                className={`min-h-[34px] pl-2.5 pr-2 py-1 rounded-xl border flex items-center gap-1.5 text-[11px] font-medium cursor-pointer transition-all active:scale-95 ${
                  isActive
                    ? 'bg-white text-black border-white shadow-sm'
                    : 'bg-white/5 text-zinc-200 border-white/10 hover:bg-white/10'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0 border border-black/30"
                  style={{ backgroundColor: filterDef?.swatchHex ?? '#d4d4d8' }}
                />
                <span>{recipe.name}</span>
                {!recipe.isBuiltIn && (
                  <button
                    type="button"
                    onClick={e => handleDeleteCustomRecipe(recipe.id, e)}
                    aria-label={`Remover ${recipe.name}`}
                    className={`p-0.5 rounded hover:bg-black/15 ${
                      isActive ? 'text-black/70' : 'text-zinc-500 hover:text-red-400'
                    }`}
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default FilmControl;
