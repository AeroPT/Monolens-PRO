import { BwColorFilterId, DEFAULT_SETTINGS, FilmRecipe, FilterSettings } from '../types';

export interface BwColorFilterDef {
  id: BwColorFilterId;
  label: string;
  shortLabel: string;
  description: string;
  swatchHex: string;
  weights: [number, number, number];
}

export const BW_COLOR_FILTERS: BwColorFilterDef[] = [
  {
    id: 'neutral',
    label: 'Neutro',
    shortLabel: 'Neutro',
    description: 'Luminância padrão Rec.709 equilibrada',
    swatchHex: '#d4d4d8',
    weights: [0.2126, 0.7152, 0.0722],
  },
  {
    id: 'yellow',
    label: 'Amarelo #8',
    shortLabel: 'Amarelo',
    description: 'Contraste natural, realça nuvens subtis',
    swatchHex: '#facc15',
    weights: [0.34, 0.58, 0.08],
  },
  {
    id: 'orange',
    label: 'Laranja #21',
    shortLabel: 'Laranja',
    description: 'Clássico de rua: escurece céus e limpa pele',
    swatchHex: '#fb923c',
    weights: [0.48, 0.44, 0.08],
  },
  {
    id: 'red',
    label: 'Vermelho #25',
    shortLabel: 'Vermelho',
    description: 'Céus dramáticos e contraste arquitetónico',
    swatchHex: '#ef4444',
    weights: [0.68, 0.27, 0.05],
  },
  {
    id: 'green',
    label: 'Verde #11',
    shortLabel: 'Verde',
    description: 'Separação rica em folhagem e retratos',
    swatchHex: '#4ade80',
    weights: [0.15, 0.70, 0.15],
  },
  {
    id: 'blue',
    label: 'Azul #47',
    shortLabel: 'Azul',
    description: 'Atmosfera brumosa e microtextura marcada',
    swatchHex: '#60a5fa',
    weights: [0.08, 0.28, 0.64],
  },
];

const FILTER_MAP = new Map<BwColorFilterId, [number, number, number]>(
  BW_COLOR_FILTERS.map(f => [f.id, f.weights])
);

export const getBwChannelWeights = (
  filterId?: BwColorFilterId
): [number, number, number] => {
  return FILTER_MAP.get(filterId ?? 'neutral') ?? [0.2126, 0.7152, 0.0722];
};

export const BUILT_IN_RECIPES: FilmRecipe[] = [
  {
    id: 'builtin-neutral',
    name: 'Padrão P&B',
    isBuiltIn: true,
    settings: { ...DEFAULT_SETTINGS },
  },
  {
    id: 'builtin-trix',
    name: 'Tri-X 400',
    isBuiltIn: true,
    settings: {
      ...DEFAULT_SETTINGS,
      colorFilter: 'orange',
      contrast: 1.12,
      grain: 0.34,
      vignette: 0.22,
      curvePoints: [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.17 },
        { x: 0.75, y: 0.85 },
        { x: 1, y: 1 },
      ],
    },
  },
  {
    id: 'builtin-hp5',
    name: 'Ilford HP5',
    isBuiltIn: true,
    settings: {
      ...DEFAULT_SETTINGS,
      colorFilter: 'yellow',
      midTone: 1.05,
      grain: 0.28,
      vignette: 0.14,
      curvePoints: [
        { x: 0, y: 0.04 },
        { x: 0.26, y: 0.29 },
        { x: 0.74, y: 0.78 },
        { x: 1, y: 1 },
      ],
    },
  },
  {
    id: 'builtin-delta',
    name: 'Delta 100',
    isBuiltIn: true,
    settings: {
      ...DEFAULT_SETTINGS,
      colorFilter: 'yellow',
      contrast: 1.08,
      grain: 0.08,
      vignette: 0.1,
      curvePoints: [
        { x: 0, y: 0 },
        { x: 0.24, y: 0.2 },
        { x: 0.76, y: 0.82 },
        { x: 1, y: 1 },
      ],
    },
  },
  {
    id: 'builtin-noir',
    name: 'Noir Rua',
    isBuiltIn: true,
    settings: {
      ...DEFAULT_SETTINGS,
      colorFilter: 'red',
      contrast: 1.18,
      grain: 0.24,
      vignette: 0.42,
      curvePoints: [
        { x: 0, y: 0 },
        { x: 0.28, y: 0.1 },
        { x: 0.72, y: 0.9 },
        { x: 1, y: 1 },
      ],
    },
  },
];

const CUSTOM_RECIPES_KEY = 'monolens_custom_recipes_v1';

export const loadCustomRecipes = (): FilmRecipe[] => {
  try {
    const raw = localStorage.getItem(CUSTOM_RECIPES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is FilmRecipe =>
        Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && item.settings)
    );
  } catch {
    return [];
  }
};

export const saveCustomRecipes = (recipes: FilmRecipe[]): void => {
  try {
    localStorage.setItem(CUSTOM_RECIPES_KEY, JSON.stringify(recipes));
  } catch {
    // Ignore storage quota errors
  }
};

export const cloneFilterSettings = (s: FilterSettings): FilterSettings => ({
  ...DEFAULT_SETTINGS,
  ...s,
  curvePoints: (s.curvePoints || DEFAULT_SETTINGS.curvePoints).map(p => ({ ...p })),
});
