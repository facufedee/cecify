// Service worker de Cecify.
//
// Regla de oro: NUNCA se guarda en cache nada que dependa de la sesion (/api/*, fotos subidas,
// paginas con datos del usuario). Solo la carcasa estatica de la app y una pantalla sin conexion.
// Si un dispositivo se comparte entre invitados, no puede quedar informacion de otro en el cache.
const CACHE = 'cecify-static-v3'
// En localhost (desarrollo) no se cachea nada: los archivos de Next no llevan hash y quedarian desactualizados.
// El service worker se usa ahi solo para las notificaciones push.
const DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1'
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
  if (DEV || request.method !== 'GET') return

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

// ---- Notificaciones push ----

// Solo rutas de la propia app (nunca una direccion externa que llegara en el aviso)
const safeUrl = (url) => (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/')

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }

  event.waitUntil(
    (async () => {
      // Si la app esta abierta y a la vista, ya se entero por dentro: no se duplica con una notificacion
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (windows.some((w) => w.visibilityState === 'visible' && w.focused)) return

      await self.registration.showNotification(String(data.title || 'Cecify'), {
        body: String(data.body || ''),
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        // Misma etiqueta = reemplaza a la anterior (una notificacion por conversacion) y vuelve a sonar
        tag: data.tag ? String(data.tag) : undefined,
        renotify: Boolean(data.tag),
        data: { url: safeUrl(data.url) },
      })
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(safeUrl(event.notification.data && event.notification.data.url), self.location.origin)

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (open) {
        await open.focus()
        if ('navigate' in open) await open.navigate(target.href).catch(() => {})
        return
      }
      await self.clients.openWindow(target.href)
    })()
  )
})
