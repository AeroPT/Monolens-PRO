
import React, { useState, useEffect } from 'react';
import CameraInterface from './components/CameraInterface';
import Gallery from './components/Gallery';
import { CapturedImage } from './types';
import { initDB, loadImagesFromDB, saveImageToDB, deleteImageFromDB } from './utils/storage';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';

const App: React.FC = () => {
  const [view, setView] = useState<'camera' | 'gallery'>('camera');
  const [capturedImages, setCapturedImages] = useState<CapturedImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Android Lifecycle and Native Integration
  useEffect(() => {
    const setupNative = async () => {
      try {
        // Hide/Style StatusBar for Camera Experience
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setOverlaysWebView({ overlay: true });
      } catch (e) {
        console.warn("Native StatusBar not available");
      }

      // Handle Android Back Button
      const backListener = await CapApp.addListener('backButton', () => {
        if (view === 'gallery') {
          setView('camera');
        } else {
          CapApp.exitApp();
        }
      });

      return () => {
        backListener.remove();
      };
    };

    setupNative();
  }, [view]);

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

  if (isLoading) {
    return (
      <div className="w-full h-screen bg-black flex items-center justify-center text-white">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white"></div>
      </div>
    );
  }

  return (
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
        />
      )}
    </div>
  );
};

export default App;
