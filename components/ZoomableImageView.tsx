import React, { useEffect, useRef, useState } from 'react';

interface ZoomableImageViewProps {
  src: string;
  alt: string;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
}

const getDistance = (
  p1: { x: number; y: number },
  p2: { x: number; y: number }
) => Math.hypot(p1.x - p2.x, p1.y - p2.y);

const ZoomableImageView: React.FC<ZoomableImageViewProps> = ({
  src,
  alt,
  onSwipeLeft,
  onSwipeRight,
  onInteractionStart,
  onInteractionEnd,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [isAnimating, setIsAnimating] = useState(false);
  const [isImageLoaded, setIsImageLoaded] = useState(false);

  const gesture = useRef({
    startX: 0,
    startY: 0,
    startScale: 1,
    startDist: 0,
    initialX: 0,
    initialY: 0,
    isPinching: false,
    isPanning: false,
    pointers: new Map<number, { x: number; y: number }>(),
  });

  useEffect(() => {
    const el = imgRef.current;
    setIsImageLoaded(Boolean(el && el.complete && el.naturalWidth > 0));
    setTransform({ scale: 1, x: 0, y: 0 });
  }, [src]);

  const clampPosition = (currentScale: number, x: number, y: number) => {
    if (!containerRef.current) return { x, y };
    const { clientWidth, clientHeight } = containerRef.current;
    const maxX = Math.max(0, (clientWidth * currentScale - clientWidth) / 2);
    const maxY = Math.max(0, (clientHeight * currentScale - clientHeight) / 2);
    return {
      x: Math.min(Math.max(x, -maxX), maxX),
      y: Math.min(Math.max(y, -maxY), maxY),
    };
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsAnimating(false);
    onInteractionStart();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      gesture.current.pointers.set(touch.identifier, {
        x: touch.clientX,
        y: touch.clientY,
      });
    }

    const pointers: Array<{ x: number; y: number }> = Array.from(
      gesture.current.pointers.values()
    );

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

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      gesture.current.pointers.set(touch.identifier, {
        x: touch.clientX,
        y: touch.clientY,
      });
    }

    const pointers: Array<{ x: number; y: number }> = Array.from(
      gesture.current.pointers.values()
    );

    if (gesture.current.isPinching && pointers.length === 2) {
      const dist = getDistance(pointers[0], pointers[1]);
      const scaleFactor = dist / gesture.current.startDist;
      const newScale = Math.min(
        Math.max(0.8, gesture.current.startScale * scaleFactor),
        6
      );
      setTransform(prev => ({ ...prev, scale: newScale }));
    } else if (
      gesture.current.isPanning &&
      pointers.length === 1 &&
      !gesture.current.isPinching
    ) {
      const dx = pointers[0].x - gesture.current.startX;
      const dy = pointers[0].y - gesture.current.startY;

      if (transform.scale > 1.05) {
        setTransform(prev => ({
          ...prev,
          x: gesture.current.initialX + dx,
          y: gesture.current.initialY + dy,
        }));
      } else {
        setTransform(prev => ({
          ...prev,
          x: dx * 0.5,
          y: 0,
        }));
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      gesture.current.pointers.delete(e.changedTouches[i].identifier);
    }

    const pointers = gesture.current.pointers;

    if (gesture.current.isPinching && pointers.size < 2) {
      gesture.current.isPinching = false;
    }

    if (pointers.size === 0) {
      setIsAnimating(true);
      let { scale, x, y } = transform;

      if (scale < 1) {
        scale = 1;
        x = 0;
        y = 0;
      } else if (scale > 4) {
        scale = 4;
      }

      if (transform.scale <= 1.05) {
        if (transform.x > 80) {
          onSwipeRight();
        } else if (transform.x < -80) {
          onSwipeLeft();
        }
        x = 0;
        y = 0;
      } else {
        const clamped = clampPosition(scale, x, y);
        x = clamped.x;
        y = clamped.y;
      }

      setTransform({ scale, x, y });
      setTimeout(onInteractionEnd, 300);
    }
  };

  const handleDoubleTap = (e: React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current) return;
    setIsAnimating(true);

    if (transform.scale > 1.1) {
      setTransform({ scale: 1, x: 0, y: 0 });
    } else {
      const rect = containerRef.current.getBoundingClientRect();
      let clientX: number;
      let clientY: number;

      if ('touches' in e) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
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
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={() => setIsImageLoaded(true)}
        onError={() => setIsImageLoaded(true)}
        className={`max-w-full max-h-full object-contain will-change-transform ${
          isAnimating ? 'transition-transform duration-300 ease-out' : ''
        } ${isImageLoaded ? 'opacity-100 animate-fade-in' : 'opacity-0'}`}
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
        draggable={false}
      />
    </div>
  );
};

export default ZoomableImageView;
