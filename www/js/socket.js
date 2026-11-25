// 🆕 Cliente Socket.IO para SolucNet Admin
// Conecta al servidor en cliente.solucnet.com y escucha eventos en tiempo real:
//   - new-message     → mensaje entrante/saliente nuevo en cualquier chat
//   - chats-update    → lista de chats actualizada
//   - admin:nueva_version → notificación de update
//   - whatsapp:status → conexión de WhatsApp del servidor

const SocketBus = (function() {
    let socket = null;
    let isConnected = false;
    const listeners = {};  // { eventName: [callback, ...] }

    function emit(event, data) {
        (listeners[event] || []).forEach(cb => {
            try { cb(data); } catch (e) { console.error('[SocketBus] listener error:', e); }
        });
    }

    function on(event, cb) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
        return () => {
            listeners[event] = (listeners[event] || []).filter(c => c !== cb);
        };
    }

    async function loadScript(url) {
        return new Promise((resolve, reject) => {
            if (window.io) return resolve();
            const s = document.createElement('script');
            s.src = url;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    async function connect() {
        if (socket && socket.connected) return socket;
        try {
            // Cargar el cliente Socket.IO desde el servidor
            await loadScript(APP_CONFIG.SERVER_URL + '/socket.io/socket.io.js');
            const token = localStorage.getItem(APP_CONFIG.STORAGE.TOKEN) || localStorage.getItem('token');
            socket = window.io(APP_CONFIG.SERVER_URL, {
                transports: ['websocket', 'polling'],
                auth: token ? { token } : undefined,
                query: token ? { token } : undefined,
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                timeout: 20000,
            });

            socket.on('connect', () => {
                isConnected = true;
                console.log('[SocketBus] Conectado:', socket.id);
                emit('_connection', { connected: true });
            });
            socket.on('disconnect', (reason) => {
                isConnected = false;
                console.warn('[SocketBus] Desconectado:', reason);
                emit('_connection', { connected: false, reason });
            });
            socket.on('connect_error', (err) => {
                console.error('[SocketBus] Error conexión:', err.message);
            });

            // Eventos del servidor → re-emitidos al bus
            // 🆕 message_ack_update: actualización de ACK estilo WhatsApp (✓/✓✓/✓✓ azul)
            // 🛡️ v2026-06-08: message:edited — cliente editó un mensaje (igual que WhatsApp)
            ['new-message', 'chats-update', 'admin:nueva_version', 'connection-status', 'message_ack_update', 'message:edited', 'chat:typing', 'message:reaction',
             // 🗺️ Eventos del Mapa Universal (re-emitidos por el bot desde solucnet-monitor)
             'monitor:tick', 'monitor:zona_manual_declarada', 'monitor:alerta_cerrada'].forEach(evName => {
                socket.on(evName, (data) => {
                    if (evName !== 'message_ack_update') console.log(`[SocketBus] ${evName}:`, data);
                    emit(evName, data);
                });
            });

            return socket;
        } catch (err) {
            console.error('[SocketBus] Error iniciando:', err);
            return null;
        }
    }

    function disconnect() {
        if (socket) { socket.disconnect(); socket = null; }
        isConnected = false;
    }

    function connected() { return isConnected; }

    return { connect, disconnect, on, connected };
})();
