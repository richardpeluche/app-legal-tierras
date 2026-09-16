/* Cachea el armazón y los datos para que la app abra sin señal.
   Sube CACHE cada vez que actualices el corpus. */
const CACHE = 'tierras-ec-v3';
const ARCHIVOS = [
  './', './index.html',
  './assets/style.css', './assets/app.js',
  './data/corpus.json', './data/comunas-dmq.json',
  './data/consultas-quito.json', './data/system-prompt.md',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;          // las consultas nunca se cachean
  if (e.request.url.includes('workers.dev')) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
