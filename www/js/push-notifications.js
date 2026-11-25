// 🆕 PUSH NOTIFICATIONS — SolucNet Admin
// Registra el token FCM al login, guarda en el backend (/api/fcm/save-token)
// y maneja notificaciones recibidas (foreground / background / tap)
const PushNotifAdmin = (function() {
    let registered = false;
    let fcmToken = null;

    async function init(userId) {
        if (registered) return;
        // Solo en Capacitor nativo
        if (!window.Capacitor || !window.Capacitor.isNativePlatform?.()) {
            console.log('[PushAdmin] No es app nativa — push deshabilitado');
            return;
        }
        const PN = window.Capacitor.Plugins?.PushNotifications;
        if (!PN) {
            console.warn('[PushAdmin] Plugin PushNotifications no disponible (¿falta google-services.json?)');
            return;
        }

        try {
            // Solicitar permisos
            let perm = await PN.checkPermissions();
            if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
                perm = await PN.requestPermissions();
            }
            if (perm.receive !== 'granted') {
                console.warn('[PushAdmin] Permiso de notificaciones denegado');
                return;
            }

            // Listeners ANTES de register()
            PN.addListener('registration', async (token) => {
                console.log('✅ [PushAdmin] FCM Token recibido:', (token.value || '').substring(0, 30) + '…');
                fcmToken = token.value;
                await guardarTokenServer(token.value, userId);
            });

            PN.addListener('registrationError', (err) => {
                console.error('❌ [PushAdmin] Error en registro:', err);
            });

            PN.addListener('pushNotificationReceived', (notification) => {
                console.log('📱 [PushAdmin] Notif recibida (app abierta):', notification);
                // Opcionalmente mostrar in-app banner si el user no está mirando
                const titulo = notification.title || 'SolucNet';
                const cuerpo = notification.body || '';
                const data = notification.data || {};
                mostrarBannerInApp(titulo, cuerpo, data);
                _precargarEnSegundoPlano(data);
            });

            PN.addListener('pushNotificationActionPerformed', (action) => {
                console.log('👆 [PushAdmin] Tap en notif:', action);
                const data = action.notification?.data || {};
                if (data.chatId && typeof Router !== 'undefined') {
                    Router.navigate('chat/' + encodeURIComponent(data.chatId));
                }
            });

            // Registrar
            await PN.register();
            registered = true;
        } catch (e) {
            console.error('[PushAdmin] Error iniciando push:', e);
        }
    }

    async function guardarTokenServer(token, userId) {
        try {
            await fetch(APP_CONFIG.SERVER_URL + '/api/fcm/save-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + API.getToken()
                },
                body: JSON.stringify({
                    fcm_token: token,
                    user_id: userId,
                    device_info: {
                        platform: (window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'android'),
                        app_version: APP_CONFIG.APP_VERSION,
                        app_id: 'com.solucnet.admin'
                    }
                })
            });
            console.log('✅ [PushAdmin] Token guardado en servidor');
        } catch (e) {
            console.warn('[PushAdmin] Error guardando token en servidor:', e.message);
        }
    }

    // 🆕 v2026-08-27: apenas llega el push, refrescar la lista de chats y precargar los mensajes
    // de ESE chat en caché — best-effort, en segundo plano, sin bloquear ni mostrar nada. Así,
    // cuando el asesor abra la app (con o sin internet en ese momento), ya está listo.
    function _precargarEnSegundoPlano(data) {
        try { if (typeof ChatsPage !== 'undefined' && ChatsPage.loadChats) ChatsPage.loadChats(false); } catch (_) {}
        try { if (data?.chatId && typeof ChatDetailPage !== 'undefined' && ChatDetailPage.precargarChat) ChatDetailPage.precargarChat(data.chatId); } catch (_) {}
    }

    function mostrarBannerInApp(titulo, mensaje, data) {
        // Banner pequeño arriba a la derecha — al tap navega al chat
        let banner = document.getElementById('push-inapp-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'push-inapp-banner';
            banner.style.cssText = `
                position: fixed; top: max(10px, env(safe-area-inset-top, 10px)); left: 10px; right: 10px;
                background: white; color: #111; padding: 12px 14px; border-radius: 12px;
                box-shadow: 0 8px 22px rgba(0,0,0,0.18); z-index: 99999;
                cursor: pointer; animation: pushBannerSlide 0.3s ease-out;
                border-left: 4px solid #0066cc;
            `;
            document.body.appendChild(banner);
            if (!document.getElementById('push-inapp-keyframes')) {
                const s = document.createElement('style');
                s.id = 'push-inapp-keyframes';
                s.textContent = `@keyframes pushBannerSlide { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
                document.head.appendChild(s);
            }
        }
        banner.innerHTML = `
            <div style="display:flex; justify-content:space-between; gap:8px;">
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:700; font-size:0.92em;">${escapeHtml(titulo)}</div>
                    <div style="font-size:0.84em; color:#555; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(mensaje)}</div>
                </div>
                <button onclick="event.stopPropagation(); this.closest('#push-inapp-banner').remove();" style="background:none; border:none; font-size:1.4em; color:#888; cursor:pointer; padding:0 4px;">×</button>
            </div>
        `;
        banner.onclick = () => {
            banner.remove();
            if (data?.chatId && typeof Router !== 'undefined') Router.navigate('chat/' + encodeURIComponent(data.chatId));
        };
        clearTimeout(banner._dismissTimer);
        banner._dismissTimer = setTimeout(() => banner.remove(), 7000);
    }

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
    }

    return { init };
})();
