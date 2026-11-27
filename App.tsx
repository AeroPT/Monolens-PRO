
import React, { useState, useEffect } from 'react';
import CameraInterface from './components/CameraInterface';
import Gallery from './components/Gallery';
import { CapturedImage } from './types';
import { initDB, loadImagesFromDB, saveImageToDB, deleteImageFromDB, deleteImagesFromDB } from './utils/storage';
import { I18nProvider } from './utils/i18n';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';

const App: React.FC = () => {
  const [view, setView] = useState<'camera' | 'gallery'>('camera');
  const [capturedImages, setCapturedImages] = useState<CapturedImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const viewRef = React.useRef(view);
  viewRef.current = view;

  // Android Lifecycle and Native Integration
  useEffect(() => {
    let isCancelled = false;
    let backHandle: { remove: () => Promise<void> } | null = null;

    const setupNative = async () => {
      try {
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setOverlaysWebView({ overlay: true });
      } catch {
        // Native StatusBar not available on web
      }

      try {
        const handle = await CapApp.addListener('backButton', () => {
          if (viewRef.current === 'gallery') {
            setView('camera');
          } else {
            CapApp.exitApp();
          }
        });
        if (isCancelled) {
          handle.remove();
        } else {
          backHandle = handle;
        }
      } catch {
        // Native App plugin not available on web
      }
    };

    setupNative();

    return () => {
      isCancelled = true;
      backHandle?.remove();
    };
  }, []);

  // Load images on startup
  useEffect(() => {
    const loadData = async () => {
      try {
        await initDB();
        const images = await loadImagesFromDB();
        setCapturedImages(images);
      } catch (error) {
        console.error("Failed to load images from DB:", error);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  const handleCapture = async (image: CapturedImage) => {
    setCapturedImages(prev => [image, ...prev]);
    try {
      await saveImageToDB(image);
    } catch (error) {
      console.error("Failed to save image to DB:", error);
    }
  };

  const handleDelete = async (id: string) => {
    setCapturedImages(prev => prev.filter(img => img.id !== id));
    try {
      await deleteImageFromDB(id);
    } catch (error) {
      console.error("Failed to delete image from DB:", error);
    }
  };

  const handleDeleteMany = async (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setCapturedImages(prev => prev.filter(img => !idSet.has(img.id)));
    try {
      await deleteImagesFromDB(ids);
    } catch (error) {
      console.error("Failed to delete images from DB:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="w-full h-screen bg-black flex items-center justify-center text-white">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white"></div>
      </div>
    );
  }

  return (
    <I18nProvider>
      <div className="w-full h-screen bg-black overflow-hidden flex flex-col">
        {view === 'camera' ? (
          <CameraInterface 
            onGalleryClick={() => setView('gallery')}
            onCapture={handleCapture}
            lastImage={capturedImages[0]}
          />
        ) : (
          <Gallery 
            images={capturedImages} 
            onBack={() => setView('camera')}
            onDelete={handleDelete}
            onDeleteMany={handleDeleteMany}
            onSaveCopy={handleCapture}
          />
        )}
      </div>
    </I18nProvider>
  );
};

export default App;
