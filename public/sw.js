/**
 * Service worker minimal : met en cache les fichiers statiques de l'app
 * (HTML/CSS/JS/icônes) pour que la page se charge même en cas de coupure
 * réseau temporaire, et pour satisfaire le critère d'installabilité PWA
 * de Chrome (présence d'un service worker avec un gestionnaire "fetch").
 *
 * Important : le flux vidéo WebRTC et la connexion Socket.io NE PASSENT
 * PAS par ce cache — seuls les fichiers statiques de l'app sont concernés.
 */

const CACHE_NAME = 'remote-cam-shell-v1';
const SHELL_FILES = [
  '/camera.html',
  '/viewer.html',
  '/recordings.html',
  '/style.css',
  '/recorder.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Ne jamais intercepter Socket.io (signalisation temps réel) : on laisse
  // passer directement au réseau.
  if (event.request.url.includes('/socket.io/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => cached);
    })
  );
});
