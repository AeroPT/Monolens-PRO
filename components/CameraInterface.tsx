
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useCamera, FocusMode } from '../hooks/useCamera';
import SVGFilters from './SVGFilters';
import SliderControl from './SliderControl';
import CurvesControl from './CurvesControl';
import Histogram from './Histogram';
import { DEFAULT_SETTINGS, FilterSettings, CapturedImage } from '../types';
import { processImage, processHighResPhoto } from '../utils/imageProcessing';
import { ImageIcon, RotateCcw, Sliders, X, Undo2, Target, ChevronDown, Loader2 } from 'lucide-react';

interface CameraInterfaceProps {
  onGalleryClick: () => void;
  onCapture: (img: CapturedImage) => void;
  lastImage?: CapturedImage;
}

interface FocusState {
    x: number;
    y: number;
    visible: boolean;
    working: boolean;
}

const CameraInterface: React.FC<CameraInterfaceProps> = ({ 
  onGalleryClick, 
  onCapture,
  lastImage 
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const { 
    devices, activeDeviceId, stream, error, switchCamera, 
    supportsFocus, triggerAutoFocus, 
    focusMode, setFocusMode,
    zoom, zoomRange, setZoom, supportsNativeZoom,
    supportsExposure, exposureRange, setExposure,
    supportsIso, isoRange, setIso,
    supportsManualFocus, focusDistance, focusDistanceRange, setManualFocusDistance
  } = useCamera();
  
  const [settings, setSettings] = useState<FilterSettings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<FilterSettings[]>([]);
  const [showControls, setShowControls] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'levels' | 'curves'>('levels');
  const [isAdjustingCurve, setIsAdjustingCurve] = useState(false);
  const [isAdjustingSlider, setIsAdjustingSlider] = useState(false);
  const [focusPoint, setFocusPoint] = useState<FocusState>({ x: 50, y: 50, visible: false, working: false });
  const [exposureVal, setExposureVal] = useState(0);
  const [isAdjustingExposure, setIsAdjustingExposure] = useState(false);
  const exposureStartVal = useRef(0);

  const [isoVal, setIsoVal] = useState<number>(0); 
  const [isIsoAuto, setIsIsoAuto] = useState(true);
  const [showIsoSlider, setShowIsoSlider] = useState(false);
  
  const exposureLongPressTimer = useRef<any>(null);
  const touchStartPos = useRef<{x: number, y: number} | null>(null);
  const initialPinchDist = useRef<number | null>(null);
  const initialZoomLevel = useRef<number>(1);
  const isPinching = useRef(false);
  
  // Swipe down logic for controls
  const controlsSwipeStartY = useRef<number | null>(null);

  const isModifying = isAdjustingCurve || isAdjustingSlider;

  useEffect(() => {
    const videoEl = videoRef.current;
    if (videoEl && stream) {
      setIsVideoReady(false);
      videoEl.srcObject = stream;
      videoEl.play().catch(e => console.warn("Auto-play failed:", e));
    }
  }, [stream]);

  useEffect(() => {
    setExposureVal(0);
    exposureStartVal.current = 0;
    setIsIsoAuto(true);
    setShowIsoSlider(false);
    if (supportsIso) setIsoVal(isoRange.min);
    setIsVideoReady(false);
  }, [activeDeviceId, supportsIso, isoRange.min]);

  const handleCapture = async () => {
    if (!videoRef.current || !stream || isCapturing) return;
    setIsCapturing(true);
    setIsFlashing(true);
    
    setTimeout(() => setIsFlashing(false), 150);

    try {
        let captureResult: { url: string; width: number; height: number };
        const track = stream.getVideoTracks()[0];
        const capturer = ('ImageCapture' in window) ? new (window as any).ImageCapture(track) : null;
        if (capturer && track.readyState === 'live') {
            try {
                const blob = await capturer.takePhoto();
                captureResult = await processHighResPhoto(blob, settings, zoom, supportsNativeZoom);
            } catch (err) {
                captureResult = processImage(videoRef.current, settings, zoom, supportsNativeZoom);
            }
        } else {
             captureResult = processImage(videoRef.current, settings, zoom, supportsNativeZoom);
        }
        onCapture({ id: Date.now().toString(), url: captureResult.url, width: captureResult.width, height: captureResult.height, timestamp: Date.now(), settings: { ...settings } });
    } catch (e) {
        console.error("Capture error:", e);
    } finally {
        setIsCapturing(false);
    }
  };

  const saveHistory = () => {
    setHistory(prev => {
        const newHistory = [...prev, JSON.parse(JSON.stringify(settings))];
        if (newHistory.length > 20) newHistory.shift();
        return newHistory;
    });
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    setSettings(history[history.length - 1]);
    setHistory(prev => prev.slice(0, -1));
  };

  const updateSetting = (key: keyof FilterSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const resetSettings = () => {
    saveHistory(); 
    setSettings(DEFAULT_SETTINGS);
  };

  const getDistance = (touches: React.TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
        isPinching.current = true;
        initialPinchDist.current = getDistance(e.touches);
        initialZoomLevel.current = zoom;
        return; 
    }
    if (e.touches.length === 1) {
       const touch = e.touches[0];
       touchStartPos.current = { x: touch.clientX, y: touch.clientY };
       exposureStartVal.current = exposureVal;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
     if (e.touches.length === 2 && isPinching.current && initialPinchDist.current) {
        e.preventDefault(); 
        const currentDist = getDistance(e.touches);
        const ratio = currentDist / initialPinchDist.current;
        let newZoom = initialZoomLevel.current * ratio;
        newZoom = Math.min(Math.max(newZoom, zoomRange.min), zoomRange.max);
        setZoom(newZoom);
        return;
     }
     if (e.touches.length === 1 && touchStartPos.current && !isPinching.current) {
        const touch = e.touches[0];
        const deltaY = touchStartPos.current.y - touch.clientY;
        const deltaX = touchStartPos.current.x - touch.clientX;
        if (!isAdjustingExposure && Math.abs(deltaY) > 15 && Math.abs(deltaY) > Math.abs(deltaX)) {
             if (!showIsoSlider) setIsAdjustingExposure(true);
        }
        if (isAdjustingExposure) {
             e.preventDefault();
             const rangeSpan = supportsExposure ? (exposureRange.max - exposureRange.min) : 4;
             const valueChange = (deltaY / (window.innerHeight * 0.4)) * rangeSpan;
             let newVal = exposureStartVal.current + valueChange;
             newVal = Math.max(supportsExposure ? exposureRange.min : -2, Math.min(supportsExposure ? exposureRange.max : 2, newVal));
             setExposureVal(newVal);
             setExposure(newVal);
        }
     }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
     if (e.touches.length < 2) {
         setTimeout(() => { isPinching.current = false; initialPinchDist.current = null; }, 100);
     }
     if (isAdjustingExposure) {
         setTimeout(() => setIsAdjustingExposure(false), 500);
         touchStartPos.current = null;
         return; 
     }
     touchStartPos.current = null;
  };

  const handleScreenTap = async (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (isPinching.current || isAdjustingExposure || showControls || showIsoSlider) return;
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) return;
    if (!containerRef.current) return;

    let clientX: number, clientY: number;
    if ('touches' in e) {
        const touch = e.changedTouches[0] || e.touches[0];
        if (!touch) return;
        clientX = touch.clientX;
        clientY = touch.clientY;
    } else {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;

    setFocusPoint({ x, y, visible: true, working: true });
    
    await triggerAutoFocus();
    
    setTimeout(() => {
        setFocusPoint(prev => ({ ...prev, working: false }));
    }, 700);
  };

  const toggleAFMode = async () => {
    const nextMode: FocusMode = focusMode === 'continuous' ? 'single-shot' : 'continuous';
    
    if (nextMode === 'single-shot') {
        setFocusPoint({ x: 50, y: 50, visible: true, working: true });
    } else {
        setFocusPoint(prev => ({ ...prev, visible: false }));
    }
    
    await setFocusMode(nextMode);
    if (nextMode === 'single-shot') {
        setTimeout(() => setFocusPoint(prev => ({ ...prev, working: false })), 1200);
    }
  };

  const startExposurePress = () => {
    exposureLongPressTimer.current = setTimeout(() => {
      setExposureVal(0);
      setExposure(0);
    }, 600);
  };

  const cancelExposurePress = () => {
    if (exposureLongPressTimer.current) clearTimeout(exposureLongPressTimer.current);
  };

  const handleLensClick = (deviceId: string) => {
    if (deviceId !== activeDeviceId) {
        switchCamera(deviceId);
    }
  };

  // Logic to swipe down on controls to hide them
  const handleControlsTouchStart = (e: React.TouchEvent) => {
    controlsSwipeStartY.current = e.touches[0].clientY;
  };

  const handleControlsTouchMove = (e: React.TouchEvent) => {
    if (controlsSwipeStartY.current === null) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - controlsSwipeStartY.current;

    // If we swipe down more than 60 pixels, close the controls
    if (deltaY > 60) {
        setShowControls(false);
        controlsSwipeStartY.current = null;
    }
  };

  const sortedDevices = useMemo(() => {
      return [...devices].sort((a, b) => {
          const aIsFront = a.label.toLowerCase().includes('front');
          const bIsFront = b.label.toLowerCase().includes('front');
          if (aIsFront && !bIsFront) return 1;
          if (!aIsFront && bIsFront) return -1;
          return a.deviceId.localeCompare(b.deviceId);
      });
  }, [devices]);

  const getLensLabel = (device: { deviceId: string; label: string }, index: number) => {
    const labelLower = device.label.toLowerCase();
    if (labelLower.includes('front')) return "FRONT";
    if (labelLower.includes('ultra') || labelLower.includes('wide')) return "WIDE";
    if (labelLower.includes('tele') || labelLower.includes('zoom')) return "TELE";
    return `LENS ${index + 1}`;
  };

  const isAfLocked = focusMode === 'single-shot' && focusPoint.visible && !focusPoint.working;
  const pillStyle = "bg-black/70 backdrop-blur-3xl border border-white/20 rounded-full shadow-2xl transition-all duration-300 w-fit shrink-0";
  const pillTextStyle = "text-[10px] font-mono font-bold uppercase tracking-wider text-white/95";

  return (
    <div className="relative w-full h-full bg-black select-none overflow-hidden touch-none flex flex-col">
      <SVGFilters settings={settings} />

      <div 
        ref={containerRef}
        className="relative flex-1 w-full overflow-hidden bg-black"
        onClick={handleScreenTap}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {error ? (
          <div className="flex flex-col items-center justify-center h-full text-red-500 p-8 text-center bg-zinc-950 font-mono text-sm safe-top">
            <X size={40} className="mb-4 opacity-50" />
            <p>{error}</p>
            <button onClick={() => window.location.reload()} className="mt-8 px-6 py-3 border border-red-500/30 rounded-full text-[10px] uppercase tracking-widest active:bg-red-500/20">Reiniciar App</button>
          </div>
        ) : (
          <video
            key={stream?.id || activeDeviceId || 'init'} 
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onPlaying={() => setIsVideoReady(true)}
            className={`w-full h-full object-cover transform transition-opacity duration-300 ${isVideoReady ? 'opacity-100' : 'opacity-0'}`}
            style={{ filter: 'url(#mono-pro-filter)', transform: !supportsNativeZoom && zoom > 1 ? `scale(${zoom})` : 'none' }}
          />
        )}
        
        <div className={`absolute inset-0 bg-white z-[60] pointer-events-none transition-opacity duration-150 ${isFlashing ? 'opacity-100' : 'opacity-0'}`} />

        <div className="absolute top-28 left-6 z-20 origin-top-left">
            <Histogram videoRef={videoRef} settings={settings} visible={!error && !!stream} />
        </div>

        {isAfLocked && supportsManualFocus && (
            <div className="absolute right-6 top-1/2 -translate-y-1/2 h-[50vh] w-16 z-[70] flex flex-col items-center justify-between py-6 bg-black/60 backdrop-blur-3xl border border-white/20 rounded-full shadow-2xl pointer-events-auto animate-in fade-in slide-in-from-right-4">
                <div className="text-[10px] font-mono font-bold text-white/50 uppercase tracking-widest transform -rotate-90 mb-4">Manual Focus</div>
                <div className="flex-1 w-full relative flex items-center justify-center">
                    <input 
                        type="range"
                        min={focusDistanceRange.min}
                        max={focusDistanceRange.max}
                        step="any"
                        value={focusDistance}
                        onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setManualFocusDistance(val);
                        }}
                        className="range-vertical-focus"
                        style={{ width: '32vh' }}
                    />
                </div>
                <div className="flex flex-col items-center mt-6">
                    <Target size={16} className="text-yellow-400 mb-1" />
                    <span className="text-[11px] font-mono text-yellow-400 font-bold">{focusDistance.toFixed(2)}</span>
                </div>
            </div>
        )}

        <div className="absolute top-[200px] left-6 z-20 flex flex-col items-start space-y-3 pointer-events-none">
            {supportsFocus && (
                <div onClick={(e) => { e.stopPropagation(); toggleAFMode(); }} className={`pointer-events-auto cursor-pointer flex items-center space-x-3 px-3 py-1.5 ${pillStyle} ${(!showControls && !isAdjustingExposure && !isModifying) ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'}`}>
                    <Target size={11} className={focusMode === 'continuous' ? 'text-blue-400 animate-pulse' : 'text-zinc-400'} />
                    <span className={pillTextStyle}>
                       {focusMode === 'continuous' ? 'AF-C' : 'AF-S'}
                    </span>
                </div>
            )}
            {supportsIso && (
                <div onClick={(e) => { e.stopPropagation(); setShowIsoSlider(!showIsoSlider); }} className={`pointer-events-auto cursor-pointer flex items-center space-x-3 px-3 py-1.5 ${pillStyle} ${(!showControls && !isAdjustingExposure && !isModifying) ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${isIsoAuto ? 'bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.8)]' : 'bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.8)]'}`} />
                    <span className={pillTextStyle}>ISO {isIsoAuto ? 'AUTO' : isoVal}</span>
                </div>
            )}
        </div>

        <div 
            onTouchStart={(e) => { e.stopPropagation(); startExposurePress(); }}
            onTouchEnd={(e) => { e.stopPropagation(); cancelExposurePress(); }}
            className={`absolute top-24 right-6 z-50 pointer-events-auto px-3 py-1.5 cursor-pointer flex items-center justify-center ${pillStyle} ${ (showControls || isAdjustingExposure || exposureVal !== 0) ? 'opacity-100 scale-100' : 'opacity-50 scale-95'} ${isModifying ? 'opacity-0 pointer-events-none' : ''}`}
        >
            <span className={pillTextStyle}>
               {exposureVal > 0 ? '+' : ''}{exposureVal.toFixed(1)} EV
            </span>
        </div>

        {focusPoint.visible && (
            <div className={`absolute w-14 h-14 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 transition-opacity duration-300 ${focusPoint.visible ? 'opacity-100' : 'opacity-0'} ${isModifying ? 'opacity-0' : ''}`} style={{ left: `${focusPoint.x}%`, top: `${focusPoint.y}%` }}>
                <div className={`w-full h-full border-2 transition-all duration-500 ease-out ${focusPoint.working ? 'border-white scale-125 shadow-[0_0_20px_white]' : focusMode === 'single-shot' ? 'border-yellow-400 scale-100 shadow-[0_0_10px_rgba(250,204,21,0.6)]' : 'border-white/30 scale-100 opacity-20'}`}>
                    <div className={`absolute top-0 left-0 w-2.5 h-2.5 border-t-2 border-l-2 ${focusMode === 'single-shot' ? 'border-yellow-400' : 'border-white'} -mt-1 -ml-1`} />
                    <div className={`absolute top-0 right-0 w-2.5 h-2.5 border-t-2 border-r-2 ${focusMode === 'single-shot' ? 'border-yellow-400' : 'border-white'} -mt-1 -mr-1`} />
                    <div className={`absolute bottom-0 left-0 w-2.5 h-2.5 border-b-2 border-l-2 ${focusMode === 'single-shot' ? 'border-yellow-400' : 'border-white'} -mb-1 -ml-1`} />
                    <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 border-b-2 border-r-2 ${focusMode === 'single-shot' ? 'border-yellow-400' : 'border-white'} -mb-1 -mr-1`} />
                </div>
            </div>
        )}
      </div>

      <div className={`absolute top-0 left-0 w-full flex justify-center z-[120] transition-opacity duration-300 safe-top pt-4 ${isModifying ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className="bg-black/60 backdrop-blur-3xl rounded-full border border-white/20 shadow-2xl max-w-[90vw] overflow-hidden p-1 w-max">
          <div className="flex flex-nowrap overflow-x-auto no-scrollbar items-center px-2 space-x-2 h-9">
             {sortedDevices.map((device, idx) => {
                 const isActive = activeDeviceId === device.deviceId;
                 const label = getLensLabel(device, idx);
                 return (
                  <button
                    key={device.deviceId}
                    onClick={() => handleLensClick(device.deviceId)}
                    className={`relative flex-shrink-0 px-3.5 py-1 rounded-full text-[9px] font-mono font-bold tracking-widest whitespace-nowrap leading-none transition-all duration-300 uppercase ${isActive ? 'bg-white text-black shadow-lg scale-100' : 'bg-transparent text-white/40'}`}
                  >
                    <span className="block max-w-[80px] truncate">{label}</span>
                  </button>
                );
             })}
          </div>
        </div>
      </div>

      {showIsoSlider && supportsIso && (
        <div className={`absolute bottom-36 left-1/2 transform -translate-x-1/2 w-[85vw] max-w-xs z-[90] transition-opacity ${isModifying ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
           <div className="flex items-center space-x-4 bg-black/80 backdrop-blur-3xl px-5 py-3 rounded-full border border-white/20 shadow-2xl">
              <button onClick={() => { setIsIsoAuto(!isIsoAuto); setIso(isIsoAuto ? isoVal : 'auto'); }} className={`px-2.5 py-1 rounded-full text-[8px] font-bold font-mono transition-colors ${isIsoAuto ? 'bg-green-500 text-black' : 'bg-white/10 text-white'}`}>AUTO</button>
              <div className="flex-1 h-8 flex items-center">
                  <input type="range" min={isoRange.min} max={isoRange.max} step={isoRange.step} value={isIsoAuto ? isoRange.min : isoVal} onChange={(e) => { 
                      const val = Number(e.target.value);
                      setIsoVal(val); setIsIsoAuto(false); setIso(val); 
                  }} className={`w-full h-1.5 appearance-none bg-white/20 rounded-full cursor-pointer range-thumb-style ${isIsoAuto ? 'opacity-30 pointer-events-none' : ''}`} />
              </div>
              <span className={`text-[9px] font-mono font-bold w-10 text-right ${isIsoAuto ? 'text-white/40' : 'text-yellow-400'}`}>{isoVal}</span>
           </div>
        </div>
      )}

      {(!showControls && !showIsoSlider && (zoomRange.max > zoomRange.min)) && (
        <div className={`absolute bottom-36 left-1/2 transform -translate-x-1/2 w-[75vw] max-w-[280px] z-40 transition-opacity ${isModifying ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <div className="flex items-center space-x-3 bg-black/50 backdrop-blur-2xl px-4 py-2.5 rounded-full border border-white/10 text-white shadow-xl">
             <span className="text-[11px] font-mono font-bold text-yellow-400 w-8 text-right">{zoom.toFixed(1)}x</span>
             <input type="range" min={zoomRange.min} max={zoomRange.max} step={0.1} value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer range-thumb-style" />
          </div>
        </div>
      )}

      {showControls && (
        <div 
          onTouchStart={handleControlsTouchStart}
          onTouchMove={handleControlsTouchMove}
          className={`absolute bottom-28 left-0 w-full z-[100] transition-all duration-500 flex flex-col pointer-events-auto ${
            isModifying 
              ? 'bg-transparent border-transparent shadow-none' 
              : 'bg-black/50 border-t border-white/15 shadow-[0_-10px_40px_rgba(0,0,0,0.9)]'
          }`} 
          style={{ maxHeight: '55vh' }}
        >
           <div className={`relative transition-opacity duration-500 ${isModifying ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
               <div className="w-full flex justify-center pt-2.5 pb-1.5"> 
                   <div className="w-10 h-1 bg-white/20 rounded-full" /> 
               </div>
               <div className={`flex justify-between items-center px-8 py-3 border-b border-white/5`}>
                  <div className="flex space-x-6">
                      <h3 onClick={() => { setActiveTab('levels'); }} className={`text-[9px] font-bold uppercase py-1.5 cursor-pointer tracking-widest ${activeTab === 'levels' ? 'text-white border-b-2 border-white' : 'text-white/30'}`}>Levels</h3>
                      <h3 onClick={() => { setActiveTab('curves'); }} className={`text-[9px] font-bold uppercase py-1.5 cursor-pointer tracking-widest ${activeTab === 'curves' ? 'text-white border-b-2 border-white' : 'text-white/30'}`}>Curves</h3>
                  </div>
                  <div className="flex space-x-3">
                    <button onClick={handleUndo} disabled={history.length === 0} className={`p-1.5 transition-opacity ${history.length === 0 ? 'opacity-10' : 'opacity-80 active:scale-90'}`}><Undo2 size={18} /></button>
                    <button onClick={resetSettings} className="p-1.5 opacity-80 active:scale-90"><RotateCcw size={16} /></button>
                  </div>
               </div>
           </div>

           <div className={`relative px-8 py-6 overflow-y-auto no-scrollbar`}>
              {activeTab === 'levels' ? (
                <div className="space-y-6 pb-8">
                    <SliderControl label="Black" value={settings.blackPoint} min={0} max={255} onChange={(v) => updateSetting('blackPoint', v)} isAdjusting={isAdjustingSlider} onInteractionStart={() => { saveHistory(); setIsAdjustingSlider(true); }} onInteractionEnd={() => setIsAdjustingSlider(false)} />
                    <SliderControl label="White" value={settings.whitePoint} min={0} max={255} onChange={(v) => updateSetting('whitePoint', v)} isAdjusting={isAdjustingSlider} onInteractionStart={() => { saveHistory(); setIsAdjustingSlider(true); }} onInteractionEnd={() => setIsAdjustingSlider(false)} />
                    <SliderControl label="Gamma" value={settings.midTone} min={0.1} max={3.0} step={0.1} onChange={(v) => updateSetting('midTone', v)} isAdjusting={isAdjustingSlider} onInteractionStart={() => { saveHistory(); setIsAdjustingSlider(true); }} onInteractionEnd={() => setIsAdjustingSlider(false)} />
                    <SliderControl label="Contrast" value={settings.contrast} min={0.5} max={2.0} step={0.05} onChange={(v) => updateSetting('contrast', v)} isAdjusting={isAdjustingSlider} onInteractionStart={() => { saveHistory(); setIsAdjustingSlider(true); }} onInteractionEnd={() => setIsAdjustingSlider(false)} />
                </div>
              ) : (
                <div className="flex flex-col items-center pb-8">
                    <div className="w-72 max-w-full pointer-events-auto">
                        <CurvesControl points={settings.curvePoints} onChange={(pts) => updateSetting('curvePoints', pts)} onInteractionStateChange={(st) => { setIsAdjustingCurve(st); }} onInteractionStart={saveHistory} />
                    </div>
                </div>
              )}
           </div>
        </div>
      )}

      <div className={`absolute bottom-0 left-0 w-full h-28 bg-gradient-to-t from-black to-transparent z-[110] flex items-center justify-around px-8 pb-8 safe-bottom transition-all duration-500 ${isModifying ? 'opacity-0 pointer-events-none translate-y-10' : 'opacity-100 translate-y-0'}`}>
        <button onClick={() => { onGalleryClick(); }} className="w-11 h-11 rounded-xl bg-zinc-900/80 border border-white/10 overflow-hidden relative shadow-2xl active:scale-90 transition-transform">
          {lastImage ? <img src={lastImage.url} alt="Last" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-zinc-700"><ImageIcon size={20} /></div>}
        </button>
        <button onClick={handleCapture} className={`w-20 h-20 rounded-full border-4 border-white/20 flex items-center justify-center bg-transparent active:scale-95 transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] ${isCapturing ? 'opacity-50' : ''}`}>
           <div className="w-16 h-16 rounded-full bg-white shadow-inner" />
        </button>
        <button onClick={() => { setShowControls(!showControls); }} className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-2xl ${showControls ? 'bg-white text-black scale-110' : 'bg-zinc-900/80 text-white border border-white/10 active:scale-90'}`}>
          {showControls ? <ChevronDown size={22} /> : <Sliders size={20} />}
        </button>
      </div>
    </div>
  );
};

export default CameraInterface;
