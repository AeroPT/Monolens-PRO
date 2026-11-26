
import React, { useState, useRef, useEffect, memo, useCallback } from 'react';
import { CapturedImage } from '../types';
import { ChevronLeft, Trash2, Download, Info, X, ChevronRight, Share2, Loader2 } from 'lucide-react';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

// Optimized Thumbnail Component with Skeleton and Fade-in
const LazyThumbnail = memo(({ image, onClick, index }: { image: CapturedImage, onClick: () => void, index: number }) => {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <button 
      onClick={onClick}
      className="aspect-square relative overflow-hidden bg-zinc-900 group w-full h-full border border-black"
    >
      {/* Skeleton / Placeholder */}
      <div className={`absolute inset-0 flex items-center justify-center bg-zinc-800 transition-opacity duration-500 ${isLoaded ? 'opacity-0' : 'opacity-100'}`}>
           <div className="w-full h-full bg-zinc-800 animate-pulse" />
      </div>
      
      <img 
          src={image.url} 
          alt={`Thumbnail ${index}`} 
          className={`w-full h-full object-cover transition-opacity duration-500 will-change-opacity ${isLoaded ? 'opacity-100' : 'opacity-0'}`} 
          loading="lazy" 
          decoding="async"
          onLoad={() => setIsLoaded(true)}
      />
      {/* Touch Overlay feedback */}
      <div className="absolute inset-0 bg-white/10 opacity-0 group-active:opacity-100 transition-opacity duration-200" />
    </button>
  );
});

interface ZoomableViewProps {
    src: string;
    alt: string;
    onSwipeLeft: () => void;
    onSwipeRight: () => void;
    onInteractionStart: () => void;
    onInteractionEnd: () => void;
}

/**
 * ZoomableView
 * Handles complex gestures: Pinch-to-zoom, Panning, and Double Tap.
 */
const ZoomableView: React.FC<ZoomableViewProps> = ({ 
    src, 
    alt, 
    onSwipeLeft, 
    onSwipeRight, 
    onInteractionStart,
    onInteractionEnd
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
    const [isAnimating, setIsAnimating] = useState(false);
    const [isImageLoaded, setIsImageLoaded] = useState(false);

    useEffect(() => {
        setIsImageLoaded(false);
    }, [src]);

    const gesture = useRef({
        startX: 0,
        startY: 0,
        startScale: 1,
        startDist: 0,
        initialX: 0,
        initialY: 0,
        isPinching: false,
        isPanning: false,
        pointers: new Map<number, { x: number, y: number }>()
    });

    useEffect(() => {
        setTransform({ scale: 1, x: 0, y: 0 });
    }, [src]);

    const getDistance = (p1: {x:number, y:number}, p2: {x:number, y:number}) => {
        return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
    };

    const clampPosition = (currentScale: number, x: number, y: number) => {
        if (!containerRef.current) return { x, y };
        const { clientWidth, clientHeight } = containerRef.current;
        
        const maxX = Math.max(0, (clientWidth * currentScale - clientWidth) / 2);
        const maxY = Math.max(0, (clientHeight * currentScale - clientHeight) / 2);

        return {
            x: Math.min(Math.max(x, -maxX), maxX),
            y: Math.min(Math.max(y, -maxY), maxY)
        };
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        setIsAnimating(false);
        onInteractionStart(); 

        Array.from(e.changedTouches).forEach((t: any) => {
            const touch = t as React.Touch;
            gesture.current.pointers.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
        });

        const pointers: {x: number, y: number}[] = Array.from(gesture.current.pointers.values());

        if (pointers.length === 2) {
            gesture.current.isPinching = true;
            gesture.current.isPanning = false;
            gesture.current.startDist = getDistance(pointers[0], pointers[1]);
            gesture.current.startScale = transform.scale;
        } else if (pointers.length === 1) {
            gesture.current.isPinching = false;
            gesture.current.isPanning = true;
            gesture.current.startX = pointers[0].x;
            gesture.current.startY = pointers[0].y;
            gesture.current.initialX = transform.x;
            gesture.current.initialY = transform.y;
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        e.preventDefault(); 

        Array.from(e.changedTouches).forEach((t: any) => {
            const touch = t as React.Touch;
            gesture.current.pointers.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
        });

        const pointers: {x: number, y: number}[] = Array.from(gesture.current.pointers.values());

        if (gesture.current.isPinching && pointers.length === 2) {
            const dist = getDistance(pointers[0], pointers[1]);
            const scaleFactor = dist / gesture.current.startDist;
            let newScale = gesture.current.startScale * scaleFactor;
            newScale = Math.min(Math.max(0.8, newScale), 6); 
            setTransform(prev => ({ ...prev, scale: newScale }));
        } 
        else if (gesture.current.isPanning && pointers.length === 1 && !gesture.current.isPinching) {
            const dx = pointers[0].x - gesture.current.startX;
            const dy = pointers[0].y - gesture.current.startY;

            if (transform.scale > 1.05) {
                setTransform(prev => ({
                    ...prev,
                    x: gesture.current.initialX + dx,
                    y: gesture.current.initialY + dy
                }));
            } else {
                 setTransform(prev => ({
                    ...prev,
                    x: dx * 0.5, 
                    y: 0
                }));
            }
        }
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        Array.from(e.changedTouches).forEach((t: any) => {
            const touch = t as React.Touch;
            gesture.current.pointers.delete(touch.identifier);
        });

        const pointers: {x: number, y: number}[] = Array.from(gesture.current.pointers.values());

        if (gesture.current.isPinching && pointers.length < 2) {
            gesture.current.isPinching = false;
        }

        if (pointers.length === 0) {
            setIsAnimating(true); 
            
            let { scale, x, y } = transform;

            if (scale < 1) {
                scale = 1; x = 0; y = 0;
            } else if (scale > 4) {
                scale = 4;
            }

            if (transform.scale <= 1.05) {
                if (transform.x > 80) {
                    onSwipeRight(); 
                    x = 0; 
                } else if (transform.x < -80) {
                    onSwipeLeft(); 
                    x = 0;
                } else {
                    x = 0; 
                }
                y = 0;
            } else {
                const clamped = clampPosition(scale, x, y);
                x = clamped.x;
                y = clamped.y;
            }

            setTransform({ scale, x, y });
            
            setTimeout(() => {
                onInteractionEnd();
            }, 300);
        }
    };

    const handleDoubleTap = (e: React.MouseEvent | React.TouchEvent) => {
        if (!containerRef.current) return;
        setIsAnimating(true);

        if (transform.scale > 1.1) {
            setTransform({ scale: 1, x: 0, y: 0 });
        } else {
            const rect = containerRef.current.getBoundingClientRect();
            let clientX, clientY;
            
            if ('touches' in e) {
                clientX = e.changedTouches[0].clientX;
                clientY = e.changedTouches[0].clientY;
            } else {
                clientX = (e as React.MouseEvent).clientX;
                clientY = (e as React.MouseEvent).clientY;
            }

            const touchX = clientX - rect.left - rect.width / 2;
            const touchY = clientY - rect.top - rect.height / 2;

            const targetScale = 2.5;
            const targetX = -(touchX * (targetScale - 1));
            const targetY = -(touchY * (targetScale - 1));
            const clamped = clampPosition(targetScale, targetX, targetY);

            setTransform({ scale: targetScale, x: clamped.x, y: clamped.y });
        }
    };

    return (
        <div 
            ref={containerRef}
            className="w-full h-full overflow-hidden flex items-center justify-center touch-none bg-black"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onDoubleClick={handleDoubleTap}
        >
            {!isImageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                </div>
            )}
            
            <img 
                src={src} 
                alt={alt}
                onLoad={() => setIsImageLoaded(true)}
                className={`max-w-full max-h-full object-contain will-change-transform 
                    ${isAnimating ? 'transition-transform duration-300 ease-out' : ''} 
                    ${isImageLoaded ? 'opacity-100 animate-fade-in' : 'opacity-0'}`}
                style={{
                    transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`
                }}
                draggable={false}
                decoding="async"
            />
        </div>
    );
};

interface GalleryProps {
  images: CapturedImage[];
  onBack: () => void;
  onDelete: (id: string) => void;
}

const Gallery: React.FC<GalleryProps> = ({ images, onBack, onDelete }) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const selectedImage = selectedIndex !== null ? images[selectedIndex] : null;

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

  const handleDownload = async () => {
    if (!selectedImage || isSaving) return;
    setIsSaving(true);

    try {
      const fileName = `MONO_${selectedImage.timestamp}.jpg`;
      
      // MODO WEB / BROWSER
      if (!Capacitor.isNativePlatform()) {
         const link = document.createElement('a');
         link.href = selectedImage.url;
         link.download = fileName;
         document.body.appendChild(link);
         link.click();
         document.body.removeChild(link);
         // Pequeno delay para a UI
         setTimeout(() => {
            setIsSaving(false);
            alert('Download iniciado!');
         }, 500);
         return;
      }

      // MODO NATIVO (ANDROID)
      const base64Data = selectedImage.url.includes(',') 
        ? selectedImage.url.split(',')[1] 
        : selectedImage.url;
        
      let saved = false;

      // 1. Tentar salvar em Documents (Android 10+)
      try {
          await Filesystem.writeFile({
            path: fileName,
            data: base64Data,
            directory: Directory.Documents,
          });
          saved = true;
          alert('Foto guardada na pasta Documentos.');
      } catch (err) {
          console.warn('Falha ao escrever em Documents:', err);
      }

      // 2. Fallback: Share Sheet (Partilha Nativa)
      if (!saved) {
        try {
            // Criar um ficheiro temporário na cache para poder partilhar
            const tempResult = await Filesystem.writeFile({
                path: fileName,
                data: base64Data,
                directory: Directory.Cache 
            });
            
            await Share2.share({
                title: 'Guardar Foto',
                text: 'MonoLens Pro',
                url: tempResult.uri,
                dialogTitle: 'Guardar ou Partilhar'
            });
            saved = true;
        } catch (shareErr) {
            console.error(shareErr);
            throw new Error("Não foi possível guardar. Tente verificar as permissões.");
        }
      }

    } catch (error: any) {
      alert(error.message || "Erro ao processar imagem.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteConfirm = () => {
    if (selectedImage) {
      onDelete(selectedImage.id);
      setShowDeleteConfirm(false);
      
      if (images.length <= 1) {
        setSelectedIndex(null);
        onBack();
      } else {
        const newIndex = selectedIndex! >= images.length - 1 ? images.length - 2 : selectedIndex!;
        setSelectedIndex(newIndex);
      }
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

  const formatDate = (ts: number) => {
      return new Date(ts).toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
      });
  };

  if (selectedImage) {
    const isFirst = selectedIndex === 0;
    const isLast = selectedIndex === images.length - 1;

    return (
      <div className="w-full h-full bg-black flex flex-col z-50 fixed inset-0 animate-fade-in">
         <div className={`absolute top-0 left-0 w-full p-4 flex justify-between items-center z-20 transition-opacity duration-300 ${isInteracting ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
            <button onClick={() => setSelectedIndex(null)} className="text-white/80 hover:text-white p-2 rounded-full bg-black/20 backdrop-blur-md">
              <ChevronLeft size={28} />
            </button>
            <div className="text-white/80 font-mono text-xs bg-black/20 backdrop-blur-md px-3 py-1 rounded-full">
                {formatDate(selectedImage.timestamp).split(' ')[0]} • {formatDate(selectedImage.timestamp).split(' ')[1]}
            </div>
            <button onClick={() => setShowInfo(!showInfo)} className={`p-2 rounded-full backdrop-blur-md transition-colors ${showInfo ? 'bg-white text-black' : 'bg-black/20 text-white/80'}`}>
                <Info size={24} />
            </button>
         </div>
         
         <div className="flex-1 w-full h-full relative bg-black">
            <ZoomableView 
                key={selectedImage.id} 
                src={selectedImage.url}
                alt="Full View"
                onSwipeLeft={handlePrev} 
                onSwipeRight={handleNext}
                onInteractionStart={() => setIsInteracting(true)}
                onInteractionEnd={() => setIsInteracting(false)}
            />

            {!isInteracting && (
                <>
                    {!isFirst && (
                        <button onClick={(e) => { e.stopPropagation(); handleNext(); }} className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-white/30 hover:text-white transition-colors pointer-events-auto">
                            <ChevronLeft size={40} />
                        </button>
                    )}
                    {!isLast && (
                        <button onClick={(e) => { e.stopPropagation(); handlePrev(); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-white/30 hover:text-white transition-colors pointer-events-auto">
                            <ChevronRight size={40} />
                        </button>
                    )}
                </>
            )}
         </div>
         
         <div className={`absolute bottom-20 left-4 right-4 bg-zinc-900/90 backdrop-blur-xl border border-white/10 rounded-2xl p-5 text-white shadow-2xl transition-transform duration-300 ease-spring ${showInfo && !isInteracting ? 'translate-y-0' : 'translate-y-[150%]'} z-20`}>
            <div className="flex justify-between items-start mb-4">
                <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">Dados da Imagem</h3>
                <button onClick={() => setShowInfo(false)}><X size={16} className="text-zinc-500" /></button>
            </div>
            
            <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-xs font-mono">
                <div>
                    <span className="text-zinc-500 block">ARQUIVO</span>
                    <span className="text-white">JPEG High Quality</span>
                </div>
                <div>
                    <span className="text-zinc-500 block">CAPTURA</span>
                    <span className="text-white">{formatDate(selectedImage.timestamp)}</span>
                </div>
                {selectedImage.width && selectedImage.height && (
                    <div className="col-span-2">
                        <span className="text-zinc-500 block">RESOLUÇÃO</span>
                        <span className="text-white font-bold">{selectedImage.width} x {selectedImage.height}</span>
                    </div>
                )}
                <div className="col-span-2 h-px bg-white/10 my-1" />
                <div>
                    <span className="text-zinc-500 block">GAMMA</span>
                    <span className="text-white">{selectedImage.settings.midTone.toFixed(2)}</span>
                </div>
                <div>
                    <span className="text-zinc-500 block">CONTRASTE</span>
                    <span className="text-white">{((selectedImage.settings.contrast - 1) * 100).toFixed(0)}%</span>
                </div>
            </div>
         </div>

         <div className={`absolute bottom-0 left-0 w-full p-6 pb-8 bg-gradient-to-t from-black/90 to-transparent flex justify-between items-center z-20 transition-opacity duration-300 ${isInteracting ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
             <button onClick={handleDownload} disabled={isSaving} className="flex flex-col items-center space-y-1 text-white/80 active:text-white active:scale-95 transition-all disabled:opacity-50">
                {isSaving ? <Loader2 size={24} className="animate-spin" /> : <Download size={24} strokeWidth={1.5} />}
                <span className="text-[10px] uppercase tracking-wide">Guardar</span>
             </button>
             <button onClick={() => setShowDeleteConfirm(true)} disabled={isSaving} className="flex flex-col items-center space-y-1 text-red-500/80 active:text-red-500 active:scale-95 transition-all disabled:opacity-50">
                <Trash2 size={24} strokeWidth={1.5} />
                <span className="text-[10px] uppercase tracking-wide">Apagar</span>
             </button>
         </div>

         {showDeleteConfirm && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-xs shadow-2xl transform scale-100 transition-all">
                <h3 className="text-lg font-bold text-white mb-2 text-center">Apagar Foto?</h3>
                <p className="text-zinc-400 text-sm mb-6 text-center leading-relaxed">
                  Esta ação é irreversível. O arquivo será removido permanentemente.
                </p>
                <div className="flex space-x-3">
                  <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-3 px-4 bg-zinc-800 text-white rounded-xl font-medium active:bg-zinc-700 transition-colors text-sm">Cancelar</button>
                  <button onClick={handleDeleteConfirm} className="flex-1 py-3 px-4 bg-red-600 text-white rounded-xl font-medium active:bg-red-700 transition-colors text-sm">Apagar</button>
                </div>
              </div>
            </div>
         )}
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-black flex flex-col">
      <div className="px-4 py-5 border-b border-white/5 flex items-center justify-between bg-black/90 backdrop-blur-sm z-10 sticky top-0 safe-top">
        <div className="flex items-center">
            <button onClick={onBack} className="mr-3 text-white p-1 -ml-2 rounded-full active:bg-white/10">
            <ChevronLeft size={28} />
            </button>
            <div>
                <h1 className="text-xl font-bold tracking-tight text-white">Galeria</h1>
                <p className="text-xs text-zinc-500 font-mono">{images.length} FOTOS • P&B</p>
            </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-1 scroll-smooth">
        {images.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-3/4 text-zinc-600 space-y-4">
            <div className="w-16 h-16 rounded-full border-2 border-dashed border-zinc-700 flex items-center justify-center">
                <Info size={24} />
            </div>
            <p className="font-mono text-sm">Rolo da câmera vazio</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-0.5 pb-20">
            {images.map((img, index) => (
              <LazyThumbnail key={img.id} image={img} index={index} onClick={() => setSelectedIndex(index)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Gallery;
