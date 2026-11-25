// 🆕 Sistema de alertas para chats urgentes (>20 min sin respuesta)
// Combina 3 mecanismos:
//   1. Web Audio API → beep (cuando app está abierta)
//   2. navigator.vibrate → vibración (Android)
//   3. Capacitor LocalNotifications → notificación nativa (cuando app está en background)
// + Toast prominente in-app
const UrgentAlerts = (function() {
    const knownUrgentIds = new Set();        // chats ya marcados (no re-alertar)
    let permisoLocalNotif = false;
    let initialized = false;
    let audioCtx = null;

    async function init() {
        if (initialized) return;
        initialized = true;
        // Pedir permiso de LocalNotifications si está disponible
        try {
            const LN = window.Capacitor?.Plugins?.LocalNotifications;
            if (LN) {
                const perm = await LN.requestPermissions();
                permisoLocalNotif = perm?.display === 'granted';
                console.log('[UrgentAlerts] LocalNotifications permiso:', permisoLocalNotif);
            }
        } catch (e) { console.warn('[UrgentAlerts] No se pudo iniciar LocalNotifications:', e.message); }
    }

    // Beep generado con Web Audio API (sin necesidad de archivo MP3)
    function beep(freq = 880, duration = 200) {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration / 1000);
            osc.start();
            osc.stop(audioCtx.currentTime + duration / 1000);
        } catch (e) { /* silencio si está bloqueado */ }
    }

    function vibrate(pattern) {
        try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
    }

    async function dispararLocalNotif(chat) {
        if (!permisoLocalNotif) return;
        try {
            const LN = window.Capacitor?.Plugins?.LocalNotifications;
            if (!LN) return;
            await LN.schedule({
                notifications: [{
                    id: Math.floor(Math.random() * 2147483647),
                    title: '⚠️ Cliente esperando',
                    body: `${chat.name || chat.phone || 'Cliente'} lleva más de 20 minutos sin respuesta`,
                    smallIcon: 'ic_stat_solucnet',
                    sound: 'default',
                    schedule: { at: new Date(Date.now() + 200) },
                    extra: { chatId: chat.id, urgent: true },
                }],
            });
        } catch (e) { console.warn('[UrgentAlerts] LocalNotif error:', e.message); }
    }

    function mostrarBannerUrgente(chat) {
        // Banner prominente arriba del header (z-index alto, animado, parpadeante claro)
        let banner = document.getElementById('urgent-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'urgent-banner';
            banner.style.cssText = `
                position:fixed; top:max(8px, env(safe-area-inset-top, 8px)); left:8px; right:8px;
                color:#7f1d1d; padding:14px 16px; border-radius:12px;
                border: 2px solid #dc2626;
                box-shadow:0 6px 20px rgba(220,38,38,0.4);
                z-index:99999; cursor:pointer;
                font-size:0.92em; font-weight:600;
                animation: urgentBannerBlink 1.2s ease-in-out infinite;
            `;
            document.body.appendChild(banner);
            // Inyectar keyframes una sola vez
            if (!document.getElementById('urgent-banner-keyframes')) {
                const s = document.createElement('style');
                s.id = 'urgent-banner-keyframes';
                s.textContent = `
                    @keyframes urgentBannerBlink {
                        0%, 100% { background: #fee2e2; box-shadow: 0 6px 20px rgba(220,38,38,0.4); transform: scale(1); }
                        50% { background: #fecaca; box-shadow: 0 6px 28px rgba(220,38,38,0.7); transform: scale(1.02); }
                    }
                    @keyframes urgentBannerIcon {
                        0%, 100% { transform: rotate(0); }
                        25% { transform: rotate(-15deg); }
                        75% { transform: rotate(15deg); }
                    }
                `;
                document.head.appendChild(s);
            }
        }
        const num = (chat.id || '').replace('@c.us','').replace('@lid','').replace('@s.whatsapp.net','');
        const nombre = chat.name && !chat.name.startsWith('+') ? chat.name : '+' + num;
        banner.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                <div style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="display:inline-block; font-size:1.3em; animation: urgentBannerIcon 0.8s ease-in-out infinite;">⏰</span>
                        <span><b style="color:#991b1b;">Cliente esperando +20 min</b></span>
                    </div>
                    <div style="font-size:0.85em; font-weight:500; color:#7f1d1d; opacity:0.95; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${nombre}</div>
                </div>
                <button onclick="event.stopPropagation(); document.getElementById('urgent-banner').remove();" style="background:rgba(220,38,38,0.15); border:none; color:#991b1b; width:32px; height:32px; border-radius:50%; cursor:pointer; font-size:1.2em; flex-shrink:0;">×</button>
            </div>
        `;
        banner.onclick = () => {
            banner.remove();
            if (typeof Router !== 'undefined') Router.navigate('chat/' + encodeURIComponent(chat.id));
        };
        // Auto-dismiss después de 15 segundos (antes 8s — muy poco para ver bien)
        clearTimeout(banner._dismissTimer);
        banner._dismissTimer = setTimeout(() => { banner.remove(); }, 15000);
    }

    // Llamar con la lista actualizada de chats (desde polling o socket update)
    function checkUrgentes(chats) {
        if (!Array.isArray(chats)) return;
        const currentUrgent = chats.filter(c => c.urgente === true);
        let nuevos = 0;
        let primero = null;
        for (const c of currentUrgent) {
            if (!knownUrgentIds.has(c.id)) {
                knownUrgentIds.add(c.id);
                nuevos++;
                if (!primero) primero = c;
            }
        }
        // Limpiar IDs que ya no son urgentes (asesor respondió)
        const idsActuales = new Set(currentUrgent.map(c => c.id));
        for (const id of knownUrgentIds) {
            if (!idsActuales.has(id)) knownUrgentIds.delete(id);
        }
        // Si hubo nuevos urgentes → disparar las 3 alertas
        if (nuevos > 0 && primero) {
            // 1. Sonido (doble beep)
            beep(880, 180);
            setTimeout(() => beep(660, 180), 200);
            // 2. Vibración (pattern: vibra-pausa-vibra-pausa-vibra)
            vibrate([200, 100, 200, 100, 400]);
            // 3. Toast in-app + local notification
            mostrarBannerUrgente(nuevos > 1 ? { ...primero, name: `${nuevos} chats urgentes` } : primero);
            dispararLocalNotif(primero);
            console.log(`⚠️ [UrgentAlerts] ${nuevos} chat(s) urgente(s) nuevo(s)`);
        }
    }

    // 🆕 Notificación cuando un chat pasa a MODO HUMANO (asesor debe atender)
    function mostrarBannerModoHumano(payload) {
        const num = (payload.chatId || '').replace('@c.us','').replace('@lid','').replace('@s.whatsapp.net','');
        const nombre = payload.nombre && !payload.nombre.startsWith('+') ? payload.nombre : '+' + num;

        // Banner azul/naranja, distinto al rojo de urgente
        let banner = document.getElementById('modo-humano-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'modo-humano-banner';
            banner.style.cssText = `
                position:fixed; top:max(8px, env(safe-area-inset-top, 8px)); left:8px; right:8px;
                color:white; padding:14px 16px; border-radius:12px;
                background: linear-gradient(135deg, #f59e0b, #d97706);
                box-shadow:0 6px 20px rgba(245,158,11,0.4);
                z-index:99998; cursor:pointer;
                font-size:0.92em; font-weight:600;
                animation: modoHumanoSlideIn 0.35s ease-out;
            `;
            document.body.appendChild(banner);
            if (!document.getElementById('modo-humano-keyframes')) {
                const s = document.createElement('style');
                s.id = 'modo-humano-keyframes';
                s.textContent = `@keyframes modoHumanoSlideIn { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
                document.head.appendChild(s);
            }
        }
        banner.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                <div style="flex:1; min-width:0;">
                    <div><i class="fas fa-user-headset"></i> Chat pasó a modo humano — ¡atender!</div>
                    <div style="font-size:0.85em; font-weight:500; opacity:0.95; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${nombre}</div>
                </div>
                <button onclick="event.stopPropagation(); document.getElementById('modo-humano-banner').remove();" style="background:rgba(255,255,255,0.25); border:none; color:white; width:32px; height:32px; border-radius:50%; cursor:pointer; font-size:1.2em; flex-shrink:0;">×</button>
            </div>
        `;
        banner.onclick = () => {
            banner.remove();
            if (typeof Router !== 'undefined') Router.navigate('chat/' + encodeURIComponent(payload.chatId));
        };
        // Auto-dismiss 12s
        clearTimeout(banner._dismissTimer);
        banner._dismissTimer = setTimeout(() => banner.remove(), 12000);

        // Beep + vibración (más suave que urgente)
        beep(1000, 150);
        vibrate([150, 80, 150]);

        // Notificación nativa Android (si hay permiso)
        if (permisoLocalNotif) {
            try {
                const LN = window.Capacitor?.Plugins?.LocalNotifications;
                if (LN) LN.schedule({
                    notifications: [{
                        id: Math.floor(Math.random() * 2147483647),
                        title: '👤 Chat pasó a modo humano',
                        body: `${nombre} requiere atención de un asesor`,
                        smallIcon: 'ic_stat_solucnet',
                        sound: 'default',
                        schedule: { at: new Date(Date.now() + 200) },
                        extra: { chatId: payload.chatId, type: 'modo-humano' },
                    }],
                });
            } catch {}
        }
    }

    function bindSocketModoHumano() {
        if (typeof SocketBus === 'undefined' || !SocketBus.on) return;
        SocketBus.on('chat:modo-humano-activado', (data) => {
            if (!data || !data.chatId) return;
            console.log('[UrgentAlerts] Modo humano activado:', data);
            mostrarBannerModoHumano(data);
        });
    }
    // Reintenta hasta que SocketBus esté disponible
    const __bindTry = setInterval(() => {
        if (typeof SocketBus !== 'undefined' && SocketBus.on) {
            bindSocketModoHumano();
            clearInterval(__bindTry);
        }
    }, 1000);

    return { init, checkUrgentes };
})();
