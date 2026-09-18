// Receives fetched question-image bytes from content.js (which runs on
// stych.fr's own origin and can't open the extension's IndexedDB directly)
// and stores them here, where results.html can read them back directly
// since both share the chrome-extension://<id> origin.
//
// Schema is duplicated (not imported) in results.js, which reads this same
// database directly for the management UI — keep the two in sync by hand
// if this ever changes.
const DB_NAME = 'stychImageCache';
const DB_VERSION = 1;
const STORE_NAME = 'images';

function openImageDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'url' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function putImage(record) {
  return openImageDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'stych-cache-image') return false;

  const blob = new Blob([new Uint8Array(message.buffer)], { type: message.mimeType });
  const record = {
    url: message.url,
    blob,
    mimeType: message.mimeType,
    size: blob.size,
    savedAt: new Date().toISOString(),
    testUrl: message.meta.testUrl,
    questionOrderNumber: message.meta.questionOrderNumber,
    questionText: message.meta.questionText,
    reason: message.meta.reason,
  };

  putImage(record)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => {
      console.error('[Stych Suivi] background image cache error', err);
      sendResponse({ ok: false, error: String(err) });
    });

  return true; // keep the message channel open for the async sendResponse
});
