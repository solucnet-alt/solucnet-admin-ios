// 🆕 v2026-08-27: caché local (IndexedDB) para que la app admin funcione offline-first, como
// WhatsApp — al abrir sin internet se ve la última lista de chats y los mensajes ya cargados,
// en vez de una pantalla de error. Se escribe SIEMPRE que una carga de red tiene éxito; se lee
// SOLO cuando la red falla (no reemplaza al servidor, es el respaldo).
const OfflineStore = (function() {
    const DB_NAME = 'solucnet_admin_offline';
    const DB_VERSION = 1;
    let _dbPromise = null;

    function _abrir() {
        if (_dbPromise) return _dbPromise;
        _dbPromise = new Promise((resolve, reject) => {
            try {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('chats')) {
                        db.createObjectStore('chats', { keyPath: 'id' });
                    }
                    if (!db.objectStoreNames.contains('messages')) {
                        const st = db.createObjectStore('messages', { keyPath: 'id' });
                        st.createIndex('chatId', 'chatId', { unique: false });
                    }
                    if (!db.objectStoreNames.contains('meta')) {
                        db.createObjectStore('meta', { keyPath: 'key' });
                    }
                };
                req.onsuccess = (e) => resolve(e.target.result);
                req.onerror = (e) => reject(e.target.error);
            } catch (err) { reject(err); }
        });
        return _dbPromise;
    }

    async function _tx(storeName, mode) {
        const db = await _abrir();
        return db.transaction(storeName, mode).objectStore(storeName);
    }

    // ---------- Chats ----------
    async function guardarChats(chats) {
        try {
            const db = await _abrir();
            const tx = db.transaction('chats', 'readwrite');
            const store = tx.objectStore('chats');
            store.clear();
            for (const c of (chats || [])) { if (c && c.id) store.put(c); }
            await _esperarTx(tx);
            await guardarMeta('chats_actualizado', Date.now());
        } catch (e) { console.warn('[OfflineStore] guardarChats falló:', e.message); }
    }
    async function obtenerChatsCache() {
        try {
            const store = await _tx('chats', 'readonly');
            return await _pedirTodos(store.getAll());
        } catch (e) { console.warn('[OfflineStore] obtenerChatsCache falló:', e.message); return []; }
    }

    // ---------- Mensajes ----------
    // Se guardan con id compuesto "chatId::mensajeId" (único global) y campo chatId para el índice.
    function _idCompuesto(chatId, msgId) { return `${chatId}::${msgId}`; }
    async function guardarMensajes(chatId, mensajes) {
        try {
            const db = await _abrir();
            const tx = db.transaction('messages', 'readwrite');
            const store = tx.objectStore('messages');
            for (const m of (mensajes || [])) {
                if (!m || m.id == null) continue;
                store.put({ ...m, id: _idCompuesto(chatId, m.id), _realId: m.id, chatId });
            }
            await _esperarTx(tx);
        } catch (e) { console.warn('[OfflineStore] guardarMensajes falló:', e.message); }
    }
    // Guarda/actualiza UN mensaje suelto (usado por el push de notificaciones — el mensaje
    // queda cacheado ANTES de que el usuario abra el chat).
    async function guardarMensajeIndividual(chatId, mensaje) {
        return guardarMensajes(chatId, [mensaje]);
    }
    async function obtenerMensajesCache(chatId) {
        try {
            const store = await _tx('messages', 'readonly');
            const idx = store.index('chatId');
            const rows = await _pedirTodos(idx.getAll(IDBKeyRange.only(chatId)));
            // Restaurar el id real (sin el prefijo compuesto) para que el resto del código no note la diferencia.
            return rows.map(r => ({ ...r, id: r._realId })).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        } catch (e) { console.warn('[OfflineStore] obtenerMensajesCache falló:', e.message); return []; }
    }

    // ---------- Meta (marcas de tiempo, etc.) ----------
    async function guardarMeta(key, value) {
        try { const store = await _tx('meta', 'readwrite'); store.put({ key, value }); } catch (_) {}
    }
    async function obtenerMeta(key) {
        try {
            const store = await _tx('meta', 'readonly');
            const r = await new Promise((res, rej) => { const q = store.get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
            return r ? r.value : null;
        } catch (_) { return null; }
    }

    // ---------- Helpers ----------
    function _esperarTx(tx) {
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }
    function _pedirTodos(req) {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    return {
        guardarChats, obtenerChatsCache,
        guardarMensajes, guardarMensajeIndividual, obtenerMensajesCache,
        guardarMeta, obtenerMeta,
    };
})();
