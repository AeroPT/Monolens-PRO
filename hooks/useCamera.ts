import { useState, useEffect, useCallback, useRef } from 'react';
import { CameraDevice } from '../types';

export type FocusMode = 'continuous' | 'single-shot';

export const useCamera = () => {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supportsFocus, setSupportsFocus] = useState(false);
  const [supportedFocusModes, setSupportedFocusModes] = useState<string[]>([]);
  const [focusMode, setFocusModeState] = useState<FocusMode>('continuous');
  
  const [focusDistance, setFocusDistanceState] = useState<number>(0);
  const [focusDistanceRange, setFocusDistanceRange] = useState({ min: 0, max: 0, step: 0 });
  const [supportsManualFocus, setSupportsManualFocus] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const isLockingRef = useRef<boolean>(false);

  const [zoom, setZoomState] = useState(1);
  const [zoomRange, setZoomRange] = useState({ min: 1, max: 1 });
  const [supportsNativeZoom, setSupportsNativeZoom] = useState(false);
  
  const [exposureRange, setExposureRange] = useState({ min: 0, max: 0, step: 0 });
  const [supportsExposure, setSupportsExposure] = useState(false);

  const [isoRange, setIsoRange] = useState({ min: 100, max: 3200, step: 100 });
  const [supportsIso, setSupportsIso] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const getDevices = async () => {
      try {
        const initialStream = await navigator.mediaDevices.getUserMedia({ video: true });
        initialStream.getTracks().forEach(track => track.stop());
        if (!isMounted) return;
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter(device => device.kind === 'videoinput');
        const formattedDevices: CameraDevice[] = videoDevices.map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${device.deviceId.slice(0, 5)}`
        }));
        setDevices(formattedDevices);
        if (formattedDevices.length > 0) {
           setActiveDeviceId(prev => {
             if (prev && formattedDevices.find(d => d.deviceId === prev)) return prev;
             const backCamera = formattedDevices.find(d => 
                d.label.toLowerCase().includes('back') || 
                d.label.toLowerCase().includes('traseira') || 
                d.label.toLowerCase().includes('environment')
              );
              return backCamera ? backCamera.deviceId : formattedDevices[0].deviceId;
           });
        }
      } catch (err: any) {
        if (isMounted) setError("Acesso à câmera negado.");
      }
    };
    getDevices();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (!activeDeviceId) return;
    let isMounted = true;
    const startStream = async () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setStream(null); 
      setError(null);
      
      // Reset capabilities state
      setSupportsFocus(false);
      setSupportsManualFocus(false);
      setSupportsNativeZoom(false);
      setSupportsExposure(false);
      setSupportsIso(false);
      setZoomRange({ min: 1, max: 1 });
      setZoomState(1);

      await new Promise(resolve => setTimeout(resolve, 300));
      if (!isMounted) return;

      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { 
            deviceId: { exact: activeDeviceId }, 
            width: { ideal: 1920 }, 
            height: { ideal: 1080 } 
          }
        });
        
        if (isMounted) {
          streamRef.current = newStream;
          setStream(newStream);
          const track = newStream.getVideoTracks()[0];
          const caps = (track.getCapabilities ? track.getCapabilities() : {}) as any;
          
          // Build initial safe constraints
          const initialConstraints: any = {};
          
          if (caps.focusMode) {
              setSupportsFocus(true);
              setSupportedFocusModes(caps.focusMode);
              if (caps.focusMode.includes('continuous')) {
                  initialConstraints.focusMode = 'continuous';
              }
          }

          if (caps.focusDistance) {
              setSupportsManualFocus(true);
              setFocusDistanceRange({
                  min: caps.focusDistance.min,
                  max: caps.focusDistance.max,
                  step: caps.focusDistance.step || 0.01
              });
              setFocusDistanceState(caps.focusDistance.min);
          }

          if (caps.zoom) {
              setSupportsNativeZoom(true);
              setZoomRange({ min: caps.zoom.min, max: caps.zoom.max });
              setZoomState(caps.zoom.min);
          } else {
              setZoomRange({ min: 1, max: 4 });
          }

          if (caps.exposureCompensation) {
            setSupportsExposure(true);
            setExposureRange({ min: caps.exposureCompensation.min, max: caps.exposureCompensation.max, step: caps.exposureCompensation.step });
          }
          
          if (caps.iso) {
            setSupportsIso(true);
            setIsoRange({ min: caps.iso.min, max: caps.iso.max, step: caps.iso.step });
          }

          // Apply supported constraints only
          if (Object.keys(initialConstraints).length > 0) {
              try {
                  await track.applyConstraints({ advanced: [initialConstraints] });
              } catch (e) {
                  console.warn("Could not apply initial constraints safely", e);
              }
          }
        }
      } catch (err: any) {
        if (isMounted) setError("Erro ao carregar hardware desta lente.");
      }
    };
    startStream();
    return () => {
      isMounted = false;
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    };
  }, [activeDeviceId]);

  const triggerAutoFocus = async () => {
    if (!streamRef.current || !supportsFocus || isLockingRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    
    try {
        if (focusMode === 'continuous') {
            if (supportedFocusModes.includes('continuous')) {
                await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] });
            }
        } else {
            isLockingRef.current = true;
            if (supportedFocusModes.includes('continuous')) {
                await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] });
                await new Promise(resolve => setTimeout(resolve, 800));
            }
            
            const lockMode = supportsManualFocus ? 'manual' : 
                             (supportedFocusModes.includes('manual') ? 'manual' : 
                             (supportedFocusModes.includes('fixed') ? 'fixed' : 'single-shot'));
            
            if (supportedFocusModes.includes(lockMode)) {
                await track.applyConstraints({ advanced: [{ focusMode: lockMode } as any] });
            }
            
            const settings = track.getSettings() as any;
            if (settings.focusDistance !== undefined) {
                setFocusDistanceState(settings.focusDistance);
            }
            isLockingRef.current = false;
        }
    } catch (e) {
        isLockingRef.current = false;
    }
  };

  const setManualFocusDistance = async (distance: number) => {
    if (!streamRef.current || !supportsManualFocus) return;
    const track = streamRef.current.getVideoTracks()[0];
    try {
        setFocusDistanceState(distance);
        await track.applyConstraints({ 
          advanced: [{ focusMode: 'manual', focusDistance: distance } as any] 
        });
    } catch (e) {}
  };

  const setFocusMode = async (mode: FocusMode) => {
    if (!streamRef.current || !supportsFocus) return;
    setFocusModeState(mode);
    const track = streamRef.current.getVideoTracks()[0];
    if (mode === 'continuous') {
        isLockingRef.current = false;
        if (supportedFocusModes.includes('continuous')) {
            await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] });
        }
    } else {
        await triggerAutoFocus();
    }
  };

  const switchCamera = useCallback((deviceId: string) => {
    if (deviceId !== activeDeviceId) setActiveDeviceId(deviceId);
  }, [activeDeviceId]);

  const setZoom = async (value: number) => {
    const newZoom = Math.min(Math.max(value, zoomRange.min), zoomRange.max);
    setZoomState(newZoom);
    if (supportsNativeZoom && streamRef.current) {
        const track = streamRef.current.getVideoTracks()[0];
        try { await track.applyConstraints({ advanced: [{ zoom: newZoom } as any] }); } catch (e) {}
    }
  };

  const setExposure = async (value: number) => {
    if (supportsExposure && streamRef.current) {
        const track = streamRef.current.getVideoTracks()[0];
        try { await track.applyConstraints({ advanced: [{ exposureCompensation: value } as any] }); } catch (e) {}
    }
  };

  const setIso = async (value: number | 'auto') => {
    if (supportsIso && streamRef.current) {
        const track = streamRef.current.getVideoTracks()[0];
        try {
            if (value === 'auto') {
                await track.applyConstraints({ advanced: [{ exposureMode: 'continuous' } as any] });
            } else {
                await track.applyConstraints({ advanced: [{ exposureMode: 'manual', iso: value } as any] });
            }
        } catch (e) {}
    }
  };

  return { 
    devices, activeDeviceId, stream, error, switchCamera, supportsFocus, 
    triggerAutoFocus, focusMode, setFocusMode, zoom, zoomRange, setZoom, 
    supportsNativeZoom, supportsExposure, exposureRange, setExposure, 
    supportsIso, isoRange, setIso,
    supportsManualFocus, focusDistance, focusDistanceRange, setManualFocusDistance
  };
};