// Service worker de Cecify.
//
// Regla de oro: NUNCA se guarda en cache nada que dependa de la sesion (/api/*, fotos subidas,
// paginas con datos del usuario). Solo la carcasa estatica de la app y una pantalla sin conexion.
// Si un dispositivo se comparte entre invitados, no puede quedar informacion de otro en el cache.
const CACHE = 'cecify-static-v2'
const OFFLINE_URL = '/offline.html'
const PRECACHE = [OFFLINE_URL, '/manifest.json', '/icons/icon-192.png', '/icons/logo-mark.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  )
})

const isStaticAsset = (url) =>
  url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Recursos estaticos versionados: primero el cache, se completa al vuelo
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(CACHE).then((c) => c.put(request, copy))
            }
            return response
          })
      )
    )
    return
  }

  // Navegacion: siempre a la red; si no hay conexion, la pantalla sin conexion (sin guardar la pagina)
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)))
  }
  // Todo lo demas (API, uploads, etc.) pasa directo, sin cache
})
