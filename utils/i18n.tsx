import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export type Language = 'pt' | 'en';

export const STORAGE_LANG_KEY = 'monolens_lang';

export const getInitialLanguage = (): Language => {
  try {
    const saved = localStorage.getItem(STORAGE_LANG_KEY);
    if (saved === 'pt' || saved === 'en') return saved;
    if (typeof navigator !== 'undefined' && navigator.language) {
      return navigator.language.toLowerCase().startsWith('pt') ? 'pt' : 'en';
    }
  } catch {
    // Ignore storage errors
  }
  return 'pt';
};

export const translations = {
  pt: {
    // Language Toggle
    langPill: 'PT',
    langToggleHint: 'Mudar para Inglês (Switch to English)',
    // Capture Modes
    captureModeTitle: 'Modo de Captura',
    fastLabel: 'Rápido (2.8 MP)',
    fastPill: '2.8M RÁPIDO',
    fastHint: '1920×1440 · 0ms',
    fastDesc:
      'Captura instantânea sem ruído idêntica ao visor, máxima fluidez no Peaking e histograma.',
    stream4kLabel: 'Stream 4K (8–12 MP)',
    stream4kPill: '4K STREAM',
    stream4kHint: 'Até 12 MP · Contínuo',
    stream4kDesc:
      'Pede ao sensor a resolução máxima de vídeo suportada, com captura rápida e NR temporal.',
    sensorMaxLabel: 'Sensor Máx (Camera2)',
    sensorMaxPill: 'PRO MÁX',
    sensorMaxHint: '12.5 MP + RAW Bayer',
    sensorMaxDesc:
      'Resolução total do sensor via Camera2 nativo, AF por zona exata, NR de alta qualidade e DNG real.',
    // Focus modes
    afContinuous: 'AF-C',
    afSingle: 'AF-S',
    afContinuousLong: 'AF-C (Contínuo)',
    afSingleLong: 'AF-S (Foco Travado)',
    // Camera HUD
    timerCancelHint: 'Toque no disparador para cancelar',
    timerPill: 'TIMER',
    peakingPill: 'PEAK',
    peakingIntensity: 'Intensidade Peaking',
    zebrasToggle: 'Zebras de Altas Luzes (>95%)',
    peakingColor: 'Cor do Destaque',
    // Hints & Aria
    resetDefaultHint: 'Toque duas vezes para repor',
    resetFocusHint: 'Toque duas vezes para repor foco',
    resetZoomHint: 'Toque duas vezes para repor 1.0x',
    // Grids
    gridLabels: {
      off: 'GRELHA OFF',
      '3x3': 'GRELHA 3×3',
      '4x4': 'GRELHA 4×4',
      phi: 'GRELHA PHI',
      diag: 'DIAGONAIS',
    },
    // Toast & Error Messages
    sensorMaxSaved: (mp: string, raw: boolean): string =>
      raw ? `${mp} MP P&B + RAW guardados na app` : `${mp} MP P&B guardada na app`,
    fastSaved: (raw: boolean): string =>
      raw ? 'P&B + RAW guardados na app' : 'Foto guardada na app',
    captureError: 'Falha ao capturar imagem.',
    cameraDenied: 'Acesso à câmera negado.',
    lensError: 'Erro ao carregar hardware desta lente.',
    retry: 'Tentar novamente',
    // Gallery
    galleryTitle: 'Galeria',
    galleryEmpty: 'Nenhuma foto capturada ainda.',
    galleryEmptySub: 'Fotografe com o MonoLens Pro para ver as suas fotos aqui.',
    exportBw: 'Exportar P&B',
    exportDng: 'Exportar DNG',
    reedit: 'Reeditar',
    snapseedLabel: 'Snapseed',
    snapseedChooseTitle: 'Abrir no Snapseed',
    snapseedChooseDesc: 'Esta foto tem versão P&B (JPG) e RAW (DNG). Qual deseja abrir?',
    snapseedOptionDng: 'RAW (.DNG)',
    snapseedOptionJpg: 'P&B (.JPG)',
    snapseedNotInstalled: 'Snapseed não está instalado neste dispositivo.',
    snapseedAndroidOnly: 'Disponível na app Android com o Snapseed instalado.',
    snapseedError: 'Erro ao abrir no Snapseed.',
    delete: 'Apagar',
    deletePhotoTitle: 'Apagar Fotografia',
    deletePhotoConfirm: 'Tem a certeza que deseja apagar esta fotografia?',
    deleteBatchTitle: 'Apagar Fotografias',
    deleteBatchConfirm: (n: number): string =>
      `Tem a certeza que deseja apagar ${n} fotografias selecionadas?`,
    cancel: 'Cancelar',
    confirmDelete: 'Apagar',
    photoDeleted: '1 foto apagada',
    photosDeleted: (n: number): string => `${n} fotos apagadas`,
    savedToDeviceSuccess: 'Exportada para a Galeria do Android!',
    saveError: 'Erro ao exportar imagem.',
    select: 'Selecionar',
    selectAll: 'Selecionar Tudo',
    deselectAll: 'Desmarcar',
    selectedCount: (n: number): string => `${n} selecionada${n > 1 ? 's' : ''}`,
    saveCopy: 'Guardar Cópia',
    saveCopySuccess: 'Cópia guardada na galeria!',
    reeditNonDestructiveNote:
      'Ajuste tonal não-destrutivo sobre cópia P&B (ative "P&B + DNG" na câmara para trocar filtros de cor depois).',
    editPreviewAlt: 'Pré-visualização de edição',
    // Controls Tabs
    tabCurves: 'Curvas',
    tabExposure: 'Exposição',
    tabLevels: 'Níveis',
    tabFilm: 'Filme',
    curveInputBlack: 'Ponto Preto',
    curveInputWhite: 'Ponto Branco',
    curveMidtones: 'Gama / Meios-Tons',
    curveContrast: 'Contraste',
    vignette: 'Vinheta Óptica',
    grain: 'Grão Analógico',
    resetCurves: 'Repor Curvas',
    // Extended UI & HUD
    levelOn: 'NÍVEL ON',
    levelOff: 'NÍVEL OFF',
    lensFront: 'FRONTAL',
    lensFallback: (n: number): string => `LENTE ${n}`,
    lightLabel: 'Luz',
    capturingSensor: 'A capturar no sensor...',
    processingImage: 'A processar imagem...',
    jpgBw: 'JPG P&B',
    bwPlusRaw: 'P&B + RAW',
    bwPlusDng: 'P&B + DNG',
    sensorMaxBrowserNote:
      'No browser usa fallback de stream; no Android usa Camera2 nativo.',
    sensorMaxToastWeb: 'Sensor Máx selecionado (Camera2 nativo ativo no Android)',
    ultraWideNativeOnly: (z: string): string =>
      `Ultra-Wide (${z}×) ativo no disparo Sensor Máx (visor WebView limitado a 1×)`,
    modeToast: (label: string): string => `Modo: ${label}`,
    colorLabel: 'Cor',
    intensityLabel: 'Intensidade',
    peakingColors: {
      yellow: 'Amarelo',
      red: 'Vermelho',
      cyan: 'Ciano',
      green: 'Verde',
      white: 'Branco',
    },
    galleryCount: (n: number): string => `${n} FOTOS • P&B`,
    tapToSelect: 'Toque nas fotos para selecionar',
    deleteSelected: (n: number): string => `Apagar (${n})`,
    imageInfoTitle: 'Dados da Imagem',
    fileLabel: 'ARQUIVO',
    captureLabel: 'CAPTURA',
    resolutionLabel: 'RESOLUÇÃO',
    opticalFilterLabel: 'FILTRO ÓPTICO',
    modeLabel: 'MODO',
    gammaLabel: 'GAMA',
    contrastLabel: 'CONTRASTE',
    grainLabel: 'GRÃO',
    vignetteLabel: 'VINHETA',
    bwPill: 'P&B',
    origDngPill: 'Original (DNG)',
    irreversibleMsg:
      'Esta ação é irreversível. O arquivo será removido permanentemente.',
    irreversibleBatchMsg:
      'Esta ação é irreversível. As fotos selecionadas serão removidas da galeria da app.',
    exposureNativeSensor: 'Sensor nativo',
    exposureEvMode: 'Modo EV',
    shutterSpeed: 'Tempo de Exposição',
    manualIso: 'ISO Manual',
    lightInput: 'Entrada de luz',
    lightAuto: 'Automática',
    opticalBwFilter: 'Filtro Óptico P&B',
    filmRecipes: 'Receitas de Filme',
    saveRecipe: 'Guardar',
    recipePlaceholder: 'Nome da receita (ex: Rua Sol)',
    shadows: 'Sombras',
    midtonesShort: 'Médios',
    highlights: 'Realces',
    inputShort: 'Ent',
    outputShort: 'Saída',
    removePoint: 'Remover',
    resetCurve: 'Zerar curva',
    tapGraphHint: 'Toque no gráfico para ajustar',
  },
  en: {
    // Language Toggle
    langPill: 'EN',
    langToggleHint: 'Mudar para Português (Switch to Portuguese)',
    // Capture Modes
    captureModeTitle: 'Capture Mode',
    fastLabel: 'Fast (2.8 MP)',
    fastPill: '2.8M FAST',
    fastHint: '1920×1440 · 0ms',
    fastDesc:
      'Instant zero-noise capture identical to the viewfinder, maximum Peaking and histogram smoothness.',
    stream4kLabel: '4K Stream (8–12 MP)',
    stream4kPill: '4K STREAM',
    stream4kHint: 'Up to 12 MP · Continuous',
    stream4kDesc:
      'Requests maximum video resolution from sensor, with fast capture and temporal NR.',
    sensorMaxLabel: 'Max Sensor (Camera2)',
    sensorMaxPill: 'PRO MAX',
    sensorMaxHint: '12.5 MP + Bayer RAW',
    sensorMaxDesc:
      'Full sensor resolution via native Camera2, exact spot AF, high-quality NR and real DNG.',
    // Focus modes
    afContinuous: 'AF-C',
    afSingle: 'AF-S',
    afContinuousLong: 'AF-C (Continuous)',
    afSingleLong: 'AF-S (Focus Locked)',
    // Camera HUD
    timerCancelHint: 'Tap shutter to cancel',
    timerPill: 'TIMER',
    peakingPill: 'PEAK',
    peakingIntensity: 'Peaking Intensity',
    zebrasToggle: 'Highlight Zebras (>95%)',
    peakingColor: 'Highlight Color',
    // Hints & Aria
    resetDefaultHint: 'Double-tap to reset',
    resetFocusHint: 'Double-tap to reset focus',
    resetZoomHint: 'Double-tap to reset 1.0x',
    // Grids
    gridLabels: {
      off: 'GRID OFF',
      '3x3': 'GRID 3×3',
      '4x4': 'GRID 4×4',
      phi: 'GRID PHI',
      diag: 'DIAGONALS',
    },
    // Toast & Error Messages
    sensorMaxSaved: (mp: string, raw: boolean): string =>
      raw ? `${mp} MP B&W + RAW saved in app` : `${mp} MP B&W saved in app`,
    fastSaved: (raw: boolean): string =>
      raw ? 'B&W + RAW saved in app' : 'Photo saved in app',
    captureError: 'Failed to capture image.',
    cameraDenied: 'Camera access denied.',
    lensError: 'Error loading this lens hardware.',
    retry: 'Try again',
    // Gallery
    galleryTitle: 'Gallery',
    galleryEmpty: 'No photos captured yet.',
    galleryEmptySub: 'Take photos with MonoLens Pro to see them here.',
    exportBw: 'Export B&W',
    exportDng: 'Export DNG',
    reedit: 'Re-edit',
    snapseedLabel: 'Snapseed',
    snapseedChooseTitle: 'Open in Snapseed',
    snapseedChooseDesc: 'This photo has both B&W (JPG) and RAW (DNG) versions. Which one do you want to open?',
    snapseedOptionDng: 'RAW (.DNG)',
    snapseedOptionJpg: 'B&W (.JPG)',
    snapseedNotInstalled: 'Snapseed is not installed on this device.',
    snapseedAndroidOnly: 'Available on Android with Snapseed installed.',
    snapseedError: 'Failed to open in Snapseed.',
    delete: 'Delete',
    deletePhotoTitle: 'Delete Photo',
    deletePhotoConfirm: 'Are you sure you want to delete this photo?',
    deleteBatchTitle: 'Delete Photos',
    deleteBatchConfirm: (n: number): string =>
      `Are you sure you want to delete ${n} selected photos?`,
    cancel: 'Cancel',
    confirmDelete: 'Delete',
    photoDeleted: '1 photo deleted',
    photosDeleted: (n: number): string => `${n} photos deleted`,
    savedToDeviceSuccess: 'Exported to Android Gallery!',
    saveError: 'Error exporting image.',
    select: 'Select',
    selectAll: 'Select All',
    deselectAll: 'Deselect',
    selectedCount: (n: number): string => `${n} selected`,
    saveCopy: 'Save Copy',
    saveCopySuccess: 'Copy saved to gallery!',
    reeditNonDestructiveNote:
      'Non-destructive tonal adjustment on B&W copy (enable "B&W + DNG" in camera to swap color filters later).',
    editPreviewAlt: 'Edit preview',
    // Controls Tabs
    tabCurves: 'Curves',
    tabExposure: 'Exposure',
    tabLevels: 'Levels',
    tabFilm: 'Film',
    curveInputBlack: 'Black Point',
    curveInputWhite: 'White Point',
    curveMidtones: 'Gamma / Mid-Tones',
    curveContrast: 'Contrast',
    vignette: 'Optical Vignette',
    grain: 'Film Grain',
    resetCurves: 'Reset Curves',
    // Extended UI & HUD
    levelOn: 'LEVEL ON',
    levelOff: 'LEVEL OFF',
    lensFront: 'FRONT',
    lensFallback: (n: number): string => `LENS ${n}`,
    lightLabel: 'Light',
    capturingSensor: 'Capturing on sensor...',
    processingImage: 'Processing image...',
    jpgBw: 'B&W JPG',
    bwPlusRaw: 'B&W + RAW',
    bwPlusDng: 'B&W + DNG',
    sensorMaxBrowserNote:
      'Uses stream fallback in browser; native Camera2 on Android.',
    sensorMaxToastWeb: 'Max Sensor selected (native Camera2 active on Android)',
    ultraWideNativeOnly: (z: string): string =>
      `Ultra-Wide (${z}×) active on Max Sensor capture (WebView preview capped at 1×)`,
    modeToast: (label: string): string => `Mode: ${label}`,
    colorLabel: 'Color',
    intensityLabel: 'Intensity',
    peakingColors: {
      yellow: 'Yellow',
      red: 'Red',
      cyan: 'Cyan',
      green: 'Green',
      white: 'White',
    },
    galleryCount: (n: number): string => `${n} PHOTOS • B&W`,
    tapToSelect: 'Tap photos to select',
    deleteSelected: (n: number): string => `Delete (${n})`,
    imageInfoTitle: 'Image Info',
    fileLabel: 'FILE',
    captureLabel: 'CAPTURED',
    resolutionLabel: 'RESOLUTION',
    opticalFilterLabel: 'OPTICAL FILTER',
    modeLabel: 'MODE',
    gammaLabel: 'GAMMA',
    contrastLabel: 'CONTRAST',
    grainLabel: 'GRAIN',
    vignetteLabel: 'VIGNETTE',
    bwPill: 'B&W',
    origDngPill: 'Original (DNG)',
    irreversibleMsg:
      'This action cannot be undone. The file will be permanently removed.',
    irreversibleBatchMsg:
      'This action cannot be undone. Selected photos will be removed from the app gallery.',
    exposureNativeSensor: 'Native sensor',
    exposureEvMode: 'EV Mode',
    shutterSpeed: 'Shutter Speed',
    manualIso: 'Manual ISO',
    lightInput: 'Light input',
    lightAuto: 'Automatic',
    opticalBwFilter: 'Optical B&W Filter',
    filmRecipes: 'Film Recipes',
    saveRecipe: 'Save',
    recipePlaceholder: 'Recipe name (e.g. Street Sun)',
    shadows: 'Shadows',
    midtonesShort: 'Midtones',
    highlights: 'Highlights',
    inputShort: 'In',
    outputShort: 'Out',
    removePoint: 'Remove',
    resetCurve: 'Reset curve',
    tapGraphHint: 'Tap graph to adjust',
  },
};

export type Translations = typeof translations.pt;

interface I18nContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: Translations;
}

const I18nContext = createContext<I18nContextType | null>(null);

export const I18nProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [lang, setLangState] = useState<Language>(getInitialLanguage);

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang);
    try {
      localStorage.setItem(STORAGE_LANG_KEY, newLang);
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    } catch {
      // Ignore storage errors
    }
  }, []);

  const toggleLang = useCallback(() => {
    setLangState(prev => {
      const next = prev === 'pt' ? 'en' : 'pt';
      try {
        localStorage.setItem(STORAGE_LANG_KEY, next);
        Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  const value = useMemo<I18nContextType>(
    () => ({
      lang,
      setLang,
      toggleLang,
      t: translations[lang],
    }),
    [lang, setLang, toggleLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextType => {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    const lang = getInitialLanguage();
    return {
      lang,
      setLang: () => {},
      toggleLang: () => {},
      t: translations[lang],
    };
  }
  return ctx;
};
