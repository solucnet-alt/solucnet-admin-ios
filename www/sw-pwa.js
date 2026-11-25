// Service Worker de la PWA Admin.
// Objetivo: que la app sea instalable Y que SIEMPRE se actualice sola.
// NO cachea recursos (el panel necesita datos en vivo). Además, al activarse
// PURGA cualquier cache viejo que una versión anterior del SW haya dejado,
// y recarga las pestañas abiertas para que tomen el código nuevo al instante.
//
// IMPORTANTE: cambiar SW_VERSION en cada despliegue que deba forzar refresco.

const SW_VERSION = 'admin-pwa-v2-2026-11-15';

self.addEventListener('install', (event) => {
    console.log('[SW] Instalando PWA Admin', SW_VERSION);
    // Toma control sin esperar a que se cierren las pestañas viejas.
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[SW] Activando PWA Admin', SW_VERSION);
    event.waitUntil((async () => {
        // 1) Borra TODO cache viejo (de versiones anteriores que sí precacheaban).
        try {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
            console.log('[SW] Caches purgados:', keys);
        } catch (e) {
            console.warn('[SW] No se pudieron purgar caches:', e);
        }
        // 2) Toma control de las pestañas ya abiertas.
        await self.clients.claim();
        // 3) Recarga esas pestañas una sola vez para que carguen el código nuevo.
        try {
            const clients = await self.clients.matchAll({ type: 'window' });
            for (const client of clients) {
                if ('navigate' in client) client.navigate(client.url);
            }
        } catch (e) {
            console.warn('[SW] No se pudo recargar clientes:', e);
        }
    })());
});

self.addEventListener('fetch', (event) => {
    // Passthrough total: nunca servir desde cache, siempre ir a la red.
    // (el SW existe para instalabilidad y para poder purgar caches viejos)
});
