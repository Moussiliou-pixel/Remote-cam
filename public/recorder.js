/**
 * Enregistrement local en buffer glissant + détection de mouvement basique.
 * Tout reste local à l'appareil caméra (IndexedDB) : rien n'est envoyé au
 * serveur de signalisation ni aux viewers distants.
 */

const RecorderModule = (() => {
  const DB_NAME = 'remote-cam-recordings';
  const STORE_NAME = 'segments';
  const DB_VERSION = 1;

  const CONFIG = {
    segmentSeconds: 10,
    normalRetentionMs: 60 * 60 * 1000,
    eventRetentionMs: 7 * 24 * 60 * 60 * 1000,
    maxTotalBytes: 500 * 1024 * 1024,
    motionCheckIntervalMs: 500,
    motionThreshold: 18,
    motionSampleSize: 48,
  };

  let db = null;
  let motionDetectedInCurrentSegment = false;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function saveSegment(blob, { timestamp, isEvent }) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record = {
        blob,
        timestamp,
        isEvent,
        size: blob.size,
        expiresAt: timestamp + (isEvent ? CONFIG.eventRetentionMs : CONFIG.normalRetentionMs),
      };
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function getAllSegments() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.timestamp - a.timestamp));
      req.onerror = () => reject(req.error);
    });
  }

  function deleteSegment(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function cleanup() {
    const all = await getAllSegments();
    const now = Date.now();

    for (const seg of all) {
      if (seg.expiresAt < now) {
        await deleteSegment(seg.id);
      }
    }

    let remaining = await getAllSegments();
    let totalBytes = remaining.reduce((sum, s) => sum + s.size, 0);

    if (totalBytes > CONFIG.maxTotalBytes) {
      const deletable = remaining
        .filter((s) => !s.isEvent)
        .sort((a, b) => a.timestamp - b.timestamp);

      for (const seg of deletable) {
        if (totalBytes <= CONFIG.maxTotalBytes) break;
        await deleteSegment(seg.id);
        totalBytes -= seg.size;
      }
    }
  }

  function startMotionDetection(videoEl) {
    const canvas = document.createElement('canvas');
    canvas.width = CONFIG.motionSampleSize;
    canvas.height = CONFIG.motionSampleSize;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let previousFrame = null;

    setInterval(() => {
      if (videoEl.readyState < 2) return;

      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const currentFrame = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

      if (previousFrame) {
        let diffSum = 0;
        for (let i = 0; i < currentFrame.length; i += 4) {
          diffSum += Math.abs(currentFrame[i] - previousFrame[i]);
        }
        const avgDiff = diffSum / (currentFrame.length / 4);

        if (avgDiff > CONFIG.motionThreshold) {
          motionDetectedInCurrentSegment = true;
        }
      }

      previousFrame = currentFrame;
    }, CONFIG.motionCheckIntervalMs);
  }

  function startRecordingLoop(stream) {
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : 'video/webm';

    function recordOneSegment() {
      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      const segmentStart = Date.now();
      motionDetectedInCurrentSegment = false;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: mimeType });
        try {
          await saveSegment(blob, {
            timestamp: segmentStart,
            isEvent: motionDetectedInCurrentSegment,
          });
          await cleanup();
        } catch (err) {
          console.error('Erreur de sauvegarde du segment :', err);
        }
        recordOneSegment();
      };

      recorder.start();
      setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, CONFIG.segmentSeconds * 1000);
    }

    recordOneSegment();
  }

  async function init(videoEl, stream) {
    db = await openDB();
    startMotionDetection(videoEl);
    startRecordingLoop(stream);
    setInterval(cleanup, 5 * 60 * 1000);
  }

  return { init, getAllSegments, deleteSegment, CONFIG };
})();
