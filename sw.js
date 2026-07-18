// Nom de cache SANS numéro de version : la stratégie network-first ci-dessous
// remet chaque fichier en cache à chaque chargement réussi, donc le cache ne
// peut pas rester périmé (il ne sert qu'en secours hors ligne). Plus besoin
// d'incrémenter une version à chaque déploiement — l'oublier figeait les iPads
// hors ligne sur d'anciens fichiers. (« activate » supprime les anciens caches
// versionnés lacasetta-caisse-v1…v6 encore présents sur les appareils.)
const CACHE = 'lacasetta-caisse';
// Chemins RELATIFS : le site est servi sous /lacasetta-caisse/ (GitHub Pages),
// des chemins absolus (/index.html) pointeraient hors du site et casseraient le SW.
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

// Install : pré-cache des assets
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

// Activate : suppression des anciens caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch : NETWORK-FIRST pour nos propres fichiers (toujours la dernière version
// quand il y a du réseau), avec repli sur le cache si hors-ligne.
// cache: 'no-store' contourne le cache HTTP de Safari (max-age de GitHub Pages),
// sinon une mise à jour peut mettre ~10 min à apparaître sur l'iPad.
// Les requêtes POST et externes (Google Sheets) passent directement au réseau.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(req, { cache: 'no-store' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
  );
});
