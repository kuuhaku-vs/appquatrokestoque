// NOVA — service worker: guarda a tela para abrir rápido como app.
// Arquivos do próprio site: busca na rede primeiro (atualizações chegam na hora) e usa a cópia se estiver sem sinal.
// A busca na rede sempre confere com o servidor (não usa a cópia de 10 min do navegador), para não misturar
// tela nova com estilo antigo logo depois de uma atualização.
// Consultas ao Protheus (outro endereço) nunca passam pelo cache.
// A cada atualização: mude o CACHE aqui e o ?v= dos arquivos no index.html.
const CACHE = 'nova-202611121515';
const ASSETS = ['./', './index.html', './styles.css', './renderer.js', './relatorio.js', './etiqueta.js', './protheus.js', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './icon.svg', './icon-maskable-512.png', './logo-grupo4k.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  const fresh = () => fetch(e.request, { cache: 'no-cache' }).catch(() => fetch(e.request));
  const saved = () => caches.match(e.request).then(r => r || caches.match(e.request, { ignoreSearch: true })).then(r => r || caches.match('./index.html'));
  e.respondWith(fresh().then(r => { if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; }).catch(saved));
});
