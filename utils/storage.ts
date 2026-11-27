import { CapturedImage } from '../types';

const DB_NAME = 'monolens_db';
const STORE_NAME = 'images';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open (or reuse) the IndexedDB database connection
 */
const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      dbPromise = null;
      const err = (event.target as IDBOpenDBRequest).error;
      console.error('Database error:', err);
      reject(err);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
  });

  return dbPromise;
};

/**
 * Initialize the database (ensure it exists)
 */
export const initDB = async (): Promise<void> => {
  await openDB();
};

/**
 * Save a captured image to the database
 */
export const saveImageToDB = async (image: CapturedImage): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(image);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Load all images from the database, sorted by timestamp desc
 */
export const loadImagesFromDB = async (): Promise<CapturedImage[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const images = request.result as CapturedImage[];
      // Sort in memory (newest first)
      images.sort((a, b) => b.timestamp - a.timestamp);
      resolve(images);
    };
    request.onerror = () => reject(request.error);
  });
};

/**
 * Delete an image by ID
 */
export const deleteImageFromDB = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Delete multiple images by ID in a single transaction
 */
export const deleteImagesFromDB = async (ids: string[]): Promise<void> => {
  if (ids.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    for (const id of ids) {
      store.delete(id);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};