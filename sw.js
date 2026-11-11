// NOVA — service worker: guarda a tela para abrir rápido como app.
// Arquivos do próprio site: busca na rede primeiro (atualizações chegam na hora) e usa a cópia se estiver sem sinal.
// Consultas ao Protheus (outro endereço) nunca passam pelo cache.
const CACHE = 'nova-202611111635';
const ASSETS = ['./', './index.html', './styles.css', './renderer.js', './relatorio.js', './protheus.js', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './icon.svg', './icon-maskable-512.png', './logo-grupo4k.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
