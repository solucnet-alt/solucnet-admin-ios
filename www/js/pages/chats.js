// 🆕 Página: Lista de Chats (la pantalla más crítica)
// Respeta: filtros Humano/Bot/Todos, orden unreadCount desc + lastActivity desc,
// urgentes con sombra roja, badges, búsqueda, refresh por pull-down
const ChatsPage = (function() {
    let chats = [];
    let asignacionesMap = {}; // 🆕 v2026-07: { numero: {asesor_id, asesor_nombre} } para el badge de asesor
    let etiquetasMap = {};    // 🆕 v2026-07: { numero: [{etiqueta, color, catalogo_id}] } para chips en la lista
    let catalogoEtiquetas = []; // 🆕 v2026-08-27: catálogo de etiquetas (para la fila de filtro por etiqueta)
    let labelFilterIds = new Set(); // 🆕 v2026-08-27: catalogo_id de las etiquetas activas en el filtro (OR entre ellas)
    let filter = 'human';  // default: Humano primero (lo más urgente)
    let searchTerm = '';
    let mensajesEncontrados = [];  // 🆕 resultados de búsqueda en contenido de mensajes
    let buscandoMensajes = false;
    let buscarMensajesTimer = null;
    let lastRefresh = 0;
    // 🛡️ v2026-06-08: scroll position guardada al abrir un chat. Al volver con back(),
    // la pantalla restaura este valor para que el usuario quede donde estaba (antes
    // siempre volvía al tope, obligando a scrollear de nuevo para encontrar el chat).
    let lastScrollY = 0;

    function avatarInitial(name) {
        const clean = (name || '').trim().replace(/^\+/, '');
        return clean.charAt(0).toUpperCase() || '?';
    }

    // 🆕 Color de avatar determinístico por chat (estilo WhatsApp: contactos sin foto → color propio)
    function avatarColor(key) {
        const pal = ['#0088cc','#e17076','#7bc862','#a695e7','#ee7aae','#6ec9cb','#f2a94a','#65aadd','#5ca9e6','#d97ea0'];
        let h = 0; const s = String(key || '');
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return pal[h % pal.length];
    }

    function formatTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const now = new Date();
        const sameDay = d.toDateString() === now.toDateString();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const isYesterday = d.toDateString() === yesterday.toDateString();
        if (sameDay) return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
        if (isYesterday) return 'Ayer';
        const diff = (now - d) / 86400000;
        if (diff < 7) return ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.getDay()];
        return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' });
    }

    function previewText(msg) {
        if (!msg) return 'Sin mensajes';
        const t = (msg + '').substring(0, 60);
        return t.length > 0 ? t : 'Sin mensajes';
    }

    function renderItem(chat) {
        const num = (chat.id || '').replace('@c.us','').replace('@lid','');
        // 🆕 v2026-09-05: estilo WhatsApp → NOMBRE como título, número como subtítulo (SIN perderlo).
        // 🆕 v2026-10-25: usuarios de WhatsApp SIN número (id tipo "CO.<dígitos>" = LID/username) → NO mostrar
        // "+CO.xxx"; mostramos el nombre de perfil como título y "Usuario de WhatsApp" como subtítulo.
        const esUsuarioWA = !/^\+?\d{7,15}$/.test(num);
        const numeroDisplay = esUsuarioWA ? '👤 Usuario de WhatsApp' : '+' + num;
        const nombre = (chat.name && !chat.name.startsWith('+') && chat.name !== num && !/^CO\.\d+$/i.test(chat.name)) ? chat.name : '';
        const tituloPrincipal = nombre || numeroDisplay;   // nombre si existe, si no el número
        const subtituloNumero = nombre ? numeroDisplay : ''; // si hay nombre, el número va debajo
        const isUrgent = chat.urgente === true;
        const isPendienteHorario = chat.pendienteHorario === true; // 🆕 v2026-05-25
        const unreadCount = chat.unreadCount || 0;
        const mode = normalizeMode(chat.mode);
        const preview = previewText(chat.lastMessage);
        // 🌙 Badge especial para chats que pasaron a humano FUERA DE HORARIO (IA sigue atendiéndolos)
        const badge = isPendienteHorario
            ? `<span class="chat-mode-badge pendiente-horario" title="Pendiente: cliente escribió fuera de horario, IA atendiendo hasta que un asesor responda">🌙 Pendiente</span>`
            : `<span class="chat-mode-badge ${mode}">${mode === 'human' ? '👤 Humano' : '🤖 Bot'}</span>`;
        // 🆕 v2026-07: badge de asesor asignado (anti-colisión multi-asesor)
        const asesor = asignacionesMap[num];
        const asesorBadge = (asesor && asesor.asesor_nombre)
            ? `<span class="chat-asesor-badge" title="Atendido por ${escapeHtml(asesor.asesor_nombre)}" style="display:inline-flex; align-items:center; gap:3px; background:#e0edff; color:#0055cc; border-radius:10px; padding:1px 7px; font-size:0.7em; font-weight:600; margin-left:4px;"><i class="fas fa-user-check"></i> ${escapeHtml((asesor.asesor_nombre || '').split(' ')[0])}</span>`
            : '';
        // 🆕 v2026-07: chips de etiquetas (máx 3 en la lista para no saturar la fila)
        const etqs = etiquetasMap[num] || [];
        const etqChips = etqs.slice(0, 3).map(e =>
            `<span title="${escapeHtml(e.etiqueta)}" style="display:inline-block; background:${escapeHtml(e.color || '#888')}; color:#fff; border-radius:8px; padding:0 6px; font-size:0.65em; font-weight:600; margin-left:3px;">${escapeHtml(e.etiqueta)}</span>`
        ).join('');
        return `
            <div class="chat-item ${isUrgent ? 'urgent' : ''} ${isPendienteHorario ? 'pendiente-horario' : ''}" data-chatid="${chat.id}">
                <div class="chat-avatar" style="background:${avatarColor(chat.id)}; box-shadow:none;">${avatarInitial(nombre || numeroDisplay)}</div>
                <div class="chat-info">
                    <div class="chat-name-row">
                        <div class="chat-name ${nombre ? '' : 'chat-number'}">${escapeHtml(tituloPrincipal)}</div>
                        <div class="chat-time ${unreadCount > 0 ? 'unread' : ''}">${formatTime(chat.lastActivity)}</div>
                    </div>
                    ${subtituloNumero ? `<div class="chat-subtitle chat-number-sub">${escapeHtml(subtituloNumero)}</div>` : ''}
                    <div class="chat-preview-row">
                        <div class="chat-preview">${escapeHtml(preview)}</div>
                        ${badge}${asesorBadge}${etqChips}
                        ${unreadCount > 0 ? `<span class="chat-unread">${unreadCount}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
    }

    function normalizeMode(m) {
        // Tolerante: el servidor puede devolver 'human' o 'humano'
        if (!m) return 'bot';
        const s = String(m).toLowerCase();
        if (s === 'human' || s === 'humano') return 'human';
        return 'bot';
    }

    function filteredChats() {
        // 🛡️ v2026-06-10: ocultar LIDs falsos (14+ dígitos guardados como @c.us)
        let list = chats.filter(c => {
            const phoneOnly = String(c.id || c.phone || '').replace(/@.*/, '');
            return !/^\d{14,}$/.test(phoneOnly);
        });
        // Filtro por modo (normalizado)
        // 🛡️ v2026-06-08: los chats con 🌙 pendienteHorario están esperando asesor —
        // conceptualmente son "human", aunque mode siga en 'bot' (IA sigue activa para
        // responder mientras). El filtro 'human' debe mostrarlos; 'bot' los excluye.
        if (filter !== 'all') {
            list = list.filter(c => {
                const m = normalizeMode(c.mode);
                if (filter === 'human') return m === 'human' || c.pendienteHorario === true;
                if (filter === 'bot') return m === 'bot' && c.pendienteHorario !== true;
                return m === filter;
            });
        }
        // 🆕 v2026-08-27: Filtro por etiqueta (catálogo) — OR entre las etiquetas activas
        if (labelFilterIds.size > 0) {
            list = list.filter(c => {
                const num = String(c.id || '').replace(/@.*/, '');
                const etqs = etiquetasMap[num] || [];
                return etqs.some(e => labelFilterIds.has(e.catalogo_id));
            });
        }
        // Filtro por búsqueda
        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            list = list.filter(c =>
                (c.name || '').toLowerCase().includes(q) ||
                (c.id || '').toLowerCase().includes(q) ||
                (c.lastMessage || '').toLowerCase().includes(q)
            );
        }
        // 🆕 v2026-06-26 (pedido del usuario): orden = PENDIENTES arriba y, dentro de cada grupo,
        // por hora (más reciente primero, igual que antes). "Pendiente" = chat que necesita
        // atención: unreadCount>0 O pendiente O pendienteHorario (🌙).
        // ⚠️ TRADEOFF aceptado por el usuario: revierte el orden v2026-06-19 (solo más-reciente).
        // Antes (v2026-06-14) pendientes-arriba sepultaba los chats recién finalizados (sin
        // pendiente) → "no aparecían" en Bot. El usuario confirmó querer pendientes-arriba igual.
        // Para volver a solo-por-hora: list.sort((a,b)=>(b.lastActivity||0)-(a.lastActivity||0)).
        // DEBE quedar idéntico al del web (public/index.html).
        const esPendiente = (c) => (c.unreadCount > 0) || c.pendiente === true || c.pendienteHorario === true;
        list.sort((a, b) => {
            const pa = esPendiente(a) ? 1 : 0, pb = esPendiente(b) ? 1 : 0;
            if (pa !== pb) return pb - pa;                               // 1º: pendientes arriba
            return (b.lastActivity || 0) - (a.lastActivity || 0);        // 2º: por hora (más reciente)
        });
        return list;
    }

    // 🆕 v2026-08-27: fila de chips para filtrar la lista por etiqueta (estilo WhatsApp Business).
    // Se oculta si el catálogo está vacío (no molesta a quien no usa etiquetas).
    function renderLabelFilterBar() {
        const bar = document.getElementById('chats-label-filter-bar');
        if (!bar) return;
        if (!catalogoEtiquetas.length) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
        bar.style.display = 'flex';
        bar.innerHTML = catalogoEtiquetas.map(c => {
            const active = labelFilterIds.has(c.id);
            return `<button class="label-filter-chip ${active ? 'active' : ''}" data-catid="${c.id}" style="background:${active ? escapeHtml(c.color) : 'transparent'}; border-color:${escapeHtml(c.color)}; color:${active ? '#fff' : escapeHtml(c.color)};">${escapeHtml(c.nombre)}</button>`;
        }).join('');
        bar.querySelectorAll('.label-filter-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.dataset.catid, 10);
                if (labelFilterIds.has(id)) labelFilterIds.delete(id); else labelFilterIds.add(id);
                renderLabelFilterBar();
                renderList();
            });
        });
    }

    // 🆕 v2026-08-27: aviso de "sin conexión, viendo lo último guardado" — igual criterio visual
    // que el resto de la app (banner arriba de la lista, no bloquea la pantalla).
    function mostrarBannerOffline() {
        let b = document.getElementById('chats-offline-banner');
        if (b) return;
        b = document.createElement('div');
        b.id = 'chats-offline-banner';
        b.className = 'offline-banner';
        b.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Sin conexión — viendo la última actualización`;
        const container = document.getElementById('chats-list-container');
        if (container && container.parentElement) container.parentElement.insertBefore(b, container);
    }
    function ocultarBannerOffline() {
        document.getElementById('chats-offline-banner')?.remove();
    }

    function updateBadgeCounts() {
        const counts = { all: chats.length, human: 0, bot: 0 };
        chats.forEach(c => { counts[normalizeMode(c.mode)] = (counts[normalizeMode(c.mode)] || 0) + 1; });
        document.querySelectorAll('.tabs-bar .tab-btn').forEach(btn => {
            const f = btn.dataset.filter;
            const countEl = btn.querySelector('.count');
            if (countEl) countEl.textContent = counts[f] || 0;
        });
        // Bottom nav badge: total unread
        const totalUnread = chats.reduce((s, c) => s + (c.unreadCount || 0), 0);
        const navBadge = document.querySelector('.bottom-nav-item[data-route="chats"] .nav-badge');
        if (navBadge) {
            if (totalUnread > 0) { navBadge.textContent = totalUnread > 99 ? '99+' : totalUnread; navBadge.classList.add('show'); }
            else navBadge.classList.remove('show');
        }
    }

    // 🆕 Render de resultados de búsqueda en mensajes (estilo WhatsApp)
    function renderResultadosMensajes() {
        if (!searchTerm || searchTerm.length < 3) return '';
        if (buscandoMensajes) {
            return `<div style="padding:14px; text-align:center; color:#999; font-size:0.85em;"><i class="fas fa-spinner fa-spin"></i> Buscando en mensajes…</div>`;
        }
        if (!mensajesEncontrados.length) {
            return `
                <div class="section-header" style="padding:10px 14px 4px; font-size:0.78em; font-weight:600; color:#666; text-transform:uppercase; letter-spacing:0.5px; margin-top:8px;">Búsqueda en mensajes</div>
                <div style="padding:14px; text-align:center; color:#999; font-size:0.85em;">Sin resultados en mensajes</div>
            `;
        }
        // Resaltar el término en el snippet
        const term = searchTerm.toLowerCase();
        const safeTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${safeTerm})`, 'ig');
        const items = mensajesEncontrados.slice(0, 30).map(m => {
            const num = (m.numero_telefono || '').replace(/^57/, '');
            const esUsuarioWA = !/^\+?\d{7,15}$/.test(num); // 🆕 LID/username sin número
            const idDisplay = esUsuarioWA ? '👤 Usuario de WhatsApp' : '+' + num;
            const txt = (m.contenido_texto || '').substring(0, 100);
            const highlighted = escapeHtml(txt).replace(regex, '<mark style="background:#fef08a; padding:0 2px;">$1</mark>');
            const fecha = m.fecha_mensaje ? formatTime(new Date(m.fecha_mensaje).getTime()) : '';
            const initial = avatarInitial(m.nombre_contacto || idDisplay);
            const chatId = m.numero_telefono + '@c.us';
            const direction = m.from_me ? 'Tú' : (m.nombre_contacto || idDisplay);
            return `
                <div class="msg-search-item" data-chatid="${chatId}" data-msgid="${escapeHtml(m.mensaje_id || '')}" style="display:flex; gap:10px; padding:10px 14px; border-bottom:1px solid #f3f3f3; cursor:pointer;">
                    <div class="chat-avatar" style="width:42px; height:42px;">${initial}</div>
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; justify-content:space-between; gap:6px;">
                            <div style="font-weight:600; font-size:0.88em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esUsuarioWA ? '👤 Usuario de WhatsApp' : '+' + escapeHtml(num)}${m.nombre_contacto ? ` <span style="color:#888; font-weight:400; font-size:0.92em;">· ${escapeHtml(m.nombre_contacto)}</span>` : ''}</div>
                            <div style="font-size:0.7em; color:#999; flex-shrink:0;">${fecha}</div>
                        </div>
                        <div style="font-size:0.78em; color:#777; margin-top:1px;">${escapeHtml(direction)}:</div>
                        <div style="font-size:0.85em; color:#444; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${highlighted}</div>
                    </div>
                </div>
            `;
        }).join('');
        return `
            <div class="section-header" style="padding:10px 14px 4px; font-size:0.78em; font-weight:600; color:#666; text-transform:uppercase; letter-spacing:0.5px; margin-top:8px; border-top:1px solid #eee; background:#f8f9fa;">
                Búsqueda en mensajes (${mensajesEncontrados.length})
            </div>
            ${items}
        `;
    }

    async function buscarEnMensajes(query) {
        buscandoMensajes = true;
        renderList();
        try {
            const data = await API.get('/api/chat/search?query=' + encodeURIComponent(query));
            mensajesEncontrados = data?.resultados || data?.mensajes || [];
        } catch (e) {
            console.warn('[chats] Error buscando en mensajes:', e.message);
            mensajesEncontrados = [];
        } finally {
            buscandoMensajes = false;
            renderList();
        }
    }

    function renderList() {
        const container = document.getElementById('chats-list-container');
        if (!container) return;
        const list = filteredChats();
        const mensajesHtml = renderResultadosMensajes();
        const chatsSectionHeader = searchTerm && searchTerm.length >= 3
            ? `<div class="section-header" style="padding:10px 14px 4px; font-size:0.78em; font-weight:600; color:#666; text-transform:uppercase; letter-spacing:0.5px;">Chats (${list.length})</div>`
            : '';

        if (list.length === 0 && !mensajesHtml) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-comments"></i>
                    <p>No hay chats en este filtro.</p>
                </div>
            `;
        } else {
            const chatsHtml = list.length > 0
                ? list.map(renderItem).join('')
                : (searchTerm && searchTerm.length >= 3 ? '<div style="padding:14px; text-align:center; color:#999; font-size:0.85em;">Sin chats que coincidan</div>' : '');
            container.innerHTML = chatsSectionHeader + chatsHtml + mensajesHtml;
            // Click en chat → abrir chat (guardamos scroll para restaurarlo al volver con back())
            // 🛡️ v2026-06-08: el scroll real está en .app-main (CSS overflow-y:auto), NO en window.
            // Antes guardábamos window.scrollY que siempre era 0 → al volver el scroll seguía en 0.
            container.querySelectorAll('.chat-item').forEach(el => {
                el.addEventListener('click', () => {
                    try { lastScrollY = document.querySelector('.app-main')?.scrollTop || 0; } catch {}
                    const chatId = el.dataset.chatid;
                    Router.navigate('chat/' + encodeURIComponent(chatId));
                });
            });
            // Click en resultado de búsqueda en mensajes → abrir chat (idem)
            container.querySelectorAll('.msg-search-item').forEach(el => {
                el.addEventListener('click', () => {
                    try { lastScrollY = document.querySelector('.app-main')?.scrollTop || 0; } catch {}
                    const chatId = el.dataset.chatid;
                    Router.navigate('chat/' + encodeURIComponent(chatId));
                });
            });
        }
        updateBadgeCounts();
    }

    async function loadChats(showRefresh = false) {
        const refreshEl = document.getElementById('chats-refresh-indicator');
        if (showRefresh && refreshEl) refreshEl.classList.add('refreshing');
        try {
            // 🆕 v2026-09: traer TODO en PARALELO (antes eran 4 esperas en serie → la lista tardaba
            // la suma de las 4). Las secundarias fallan-silencioso (null) para no tumbar la principal.
            const [data, a, t, cat] = await Promise.all([
                API.get('/api/chats'),
                API.get('/api/chats/asignaciones').catch(() => null),
                API.get('/api/chats/etiquetas-todas').catch(() => null),
                API.get('/api/etiquetas/catalogo').catch(() => null),
            ]);
            chats = (data && data.chats) ? data.chats : (Array.isArray(data) ? data : []);
            lastRefresh = Date.now();
            ocultarBannerOffline();
            // 🆕 v2026-08-27: guardar en caché local — si más adelante no hay internet, se
            // muestra esto en vez de una pantalla de error (offline-first, como WhatsApp).
            try { await OfflineStore?.guardarChats(chats); } catch (_) {}
            if (a && a.success) asignacionesMap = a.asignaciones || {};
            if (t && t.success) etiquetasMap = t.etiquetas || {};
            if (cat && cat.success) catalogoEtiquetas = cat.etiquetas || [];
            renderLabelFilterBar();
            renderList();
            reconciliarNotificaciones(); // 🧹 quitar notifs de chats YA atendidos (por quien sea)
        } catch (err) {
            console.error('[chats] Error:', err);
            // 🆕 v2026-08-27: sin conexión (o el server no respondió) → mostrar lo ÚLTIMO que
            // había en caché, en vez de una pantalla de error dura. Igual que WhatsApp: se ve
            // la última foto del chat, con un aviso de que no está actualizado.
            let cache = [];
            try { cache = await OfflineStore?.obtenerChatsCache() || []; } catch (_) {}
            if (cache.length > 0) {
                chats = cache;
                mostrarBannerOffline();
                renderList();
                if (refreshEl) refreshEl.classList.remove('refreshing');
                return;
            }
            const container = document.getElementById('chats-list-container');
            if (container) container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle" style="color:var(--danger);"></i>
                    <p>Error: ${escapeHtml(err.message)}</p>
                </div>
            `;
            showToast('Error de red', 'error');
        } finally {
            if (refreshEl) refreshEl.classList.remove('refreshing');
        }
    }

    // 🧹 v2026-07-31: reconcilia las notificaciones FCM de la bandeja contra el estado REAL de los chats.
    // Problema: las notifs solo se limpiaban al ABRIR ese chat en ESTE dispositivo → si el cliente se
    // atendía desde la web u otro celular (o sin abrir el detalle), la notif quedaba fija. Ahora, cada
    // vez que se refresca la lista (abrir app, foreground, socket), quitamos las notifs de los chats que
    // YA NO están pendientes (unreadCount=0 && !pendiente && !pendienteHorario = atendido).
    async function reconciliarNotificaciones() {
        try {
            const PN = window.Capacitor?.Plugins?.PushNotifications;
            if (!PN?.getDeliveredNotifications) return;
            const norm = (s) => String(s || '').replace(/@(c\.us|s\.whatsapp\.net|lid)$/, '').replace(/^\+/, '');
            const pendientes = new Set();
            for (const c of chats) {
                const esPend = (c.unreadCount > 0) || c.pendiente === true || c.pendienteHorario === true;
                if (esPend && c.id) pendientes.add(norm(c.id));
            }
            const res = await PN.getDeliveredNotifications();
            const notifs = (res && res.notifications) || [];
            const toRemove = notifs.filter(n => {
                const ncid = n.data?.chatId || n.extra?.chatId;
                return ncid && !pendientes.has(norm(ncid));
            });
            if (toRemove.length) {
                await PN.removeDeliveredNotifications({ notifications: toRemove });
                console.log(`🧹 [PUSH] Reconciliación: quitadas ${toRemove.length} notif(s) de chats ya atendidos`);
            }
        } catch (e) { console.warn('[PUSH] reconciliar:', e && e.message); }
    }

    function showToast(msg, type = 'info') {
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        toast.className = 'toast ' + type;
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2500);
    }

    function pageTemplate() {
        return `
            <div class="search-bar">
                <i class="fas fa-search search-icon"></i>
                <input type="text" id="chats-search" placeholder="Buscar chats..." autocomplete="off" value="${escapeHtml(searchTerm || '')}">
            </div>
            <div class="tabs-bar">
                <button class="tab-btn ${filter === 'human' ? 'active' : ''}" data-filter="human">
                    <i class="fas fa-user"></i> Humano <span class="count">0</span>
                </button>
                <button class="tab-btn ${filter === 'bot' ? 'active' : ''}" data-filter="bot">
                    <i class="fas fa-robot"></i> Bot <span class="count">0</span>
                </button>
                <button class="tab-btn ${filter === 'all' ? 'active' : ''}" data-filter="all">
                    <i class="fas fa-comments"></i> Todos <span class="count">0</span>
                </button>
            </div>
            <div id="chats-label-filter-bar" class="label-filter-bar"></div>
            <div id="chats-refresh-indicator" class="refresh-indicator">
                <i class="fas fa-spinner"></i> Actualizando...
            </div>
            <div id="chats-list-container" class="chat-list">
                <div class="loading-center">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Cargando chats…</p>
                </div>
            </div>
            <button class="fab" onclick="ChatsPage.nuevoChat()" title="Nuevo chat">
                <i class="fas fa-comment-medical"></i>
            </button>
            <button onclick="ChatsPage.showActionMenu()" style="position:fixed; bottom:140px; right:16px; z-index:99; width:48px; height:48px; border-radius:50%; background:#6b7280; color:white; border:none; box-shadow:0 4px 12px rgba(0,0,0,0.2); cursor:pointer;" title="Más acciones"><i class="fas fa-ellipsis-v"></i></button>
        `;
    }

    function showActionMenu() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3><i class="fas fa-bars"></i> Acciones de chats</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <button onclick="ChatsPage.desmarcarPendientes()" style="display:block; width:100%; padding:12px; background:#fef3c7; color:#92400e; border:none; border-radius:8px; font-size:0.9em; font-weight:600; cursor:pointer; margin-bottom:8px; text-align:left;"><i class="fas fa-check-double"></i> Desmarcar todos los pendientes</button>
                    <button onclick="ChatsPage.mostrarQR()" style="display:block; width:100%; padding:12px; background:#dcfce7; color:#166534; border:none; border-radius:8px; font-size:0.9em; font-weight:600; cursor:pointer; text-align:left;"><i class="fab fa-whatsapp"></i> Ver QR de WhatsApp</button>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cerrar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
    }

    async function desmarcarPendientes() {
        if (!confirm('¿Desmarcar todos los chats como NO pendientes?\n\nEsto borra los badges naranjas de todos los chats.')) return;
        try {
            await API.post('/api/unmark-all-pending', {});
            document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
            const toast = document.getElementById('toast');
            if (toast) { toast.className = 'toast show success'; toast.textContent = 'Pendientes limpiados ✓'; setTimeout(() => toast.classList.remove('show'), 2500); }
            await loadChats(true);
        } catch (err) { alert('Error: ' + err.message); }
    }

    async function mostrarQR() {
        document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const qrUrl = APP_CONFIG.SERVER_URL + '/api/qr-image?t=' + Date.now() + '&token=' + encodeURIComponent(API.getToken());
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3><i class="fab fa-whatsapp"></i> QR de WhatsApp</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px; text-align:center;">
                    <div style="background:#fffbeb; padding:10px; border-radius:8px; font-size:0.8em; color:#92400e; margin-bottom:14px;">
                        <i class="fas fa-info-circle"></i> Escaneá este QR desde WhatsApp → Dispositivos vinculados. Solo aparece si el bot está desconectado.
                    </div>
                    <img id="qr-img" src="${qrUrl}" style="max-width:280px; width:100%; background:white; padding:10px; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,0.1);" onerror="this.parentElement.innerHTML='<div style=&quot;padding:30px; color:#dc3545;&quot;><i class=&quot;fas fa-exclamation-triangle&quot;></i><br><br>No hay QR disponible. WhatsApp ya está conectado o el bot se está iniciando.</div>'">
                    <button onclick="document.getElementById('qr-img').src='${APP_CONFIG.SERVER_URL}/api/qr-image?t='+Date.now()+'&token=${encodeURIComponent(API.getToken())}'" style="margin-top:14px; padding:10px 20px; background:#0066cc; color:white; border:none; border-radius:8px; font-weight:600; cursor:pointer;"><i class="fas fa-sync-alt"></i> Refrescar QR</button>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cerrar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
    }

    // ✏️ v2026-07-30: a un número NUEVO (fuera de la ventana 24h) NO se puede mandar texto libre por
    // la API oficial → se envía la PLANTILLA de apertura general (/api/nuevo-chat). Cuando el cliente
    // responda, se abre la ventana y ya se le escribe libre.
    function nuevoChat() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3><i class="fas fa-comment-medical"></i> Nuevo chat</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <label style="display:block; font-size:0.78em; font-weight:600; color:#555; margin-bottom:4px;">Número de celular (10 dígitos o con 57)</label>
                    <input type="tel" id="nc-num" placeholder="3001234567" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; margin-bottom:12px; box-sizing:border-box;">
                    <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:10px; font-size:0.82em; color:#0c4a6e;">
                        <b>⚙️ Se enviará la plantilla de apertura:</b><br>
                        <span style="color:#334155;">“Le contactamos desde SOLUCNET S.A.S. respecto a su servicio de internet. Para continuar con la atención de su solicitud, por favor responda a este mensaje.”</span>
                        <div style="margin-top:6px; color:#64748b;">Cuando el cliente responda, podrás escribirle libremente. (Es una plantilla facturable.)</div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="nc-send"><i class="fas fa-paper-plane"></i> Enviar apertura</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.querySelector('#nc-send').onclick = async () => {
            const num = overlay.querySelector('#nc-num').value.replace(/\D/g, '');
            if (!num || num.length < 10) { alert('Número inválido (mínimo 10 dígitos)'); return; }
            const btn = overlay.querySelector('#nc-send');
            btn.disabled = true; btn.innerHTML = 'Enviando…';
            const restore = () => { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar apertura'; };
            try {
                const r = await API.post('/api/nuevo-chat', { numero: num });
                if (r && r.ok) {
                    overlay.remove();
                    await loadChats(true);
                    if (r.chatId) Router.navigate('chat/' + encodeURIComponent(r.chatId));
                } else { alert(r?.message || 'No se pudo enviar la apertura'); restore(); }
            } catch (err) { alert('Error: ' + (err.message || 'red')); restore(); }
        };
    }

    async function show() {
        const page = document.getElementById('page-chats');
        page.innerHTML = pageTemplate();
        // Activar filtros
        const _tabsOrden = ['human', 'bot', 'all'];
        function _dirTab(from, to) {
            const a = _tabsOrden.indexOf(from), b = _tabsOrden.indexOf(to);
            if (a < 0 || b < 0 || a === b) return null;
            return b > a ? 'left' : 'right'; // ir a un tab a la derecha = contenido sale a la izquierda
        }
        // 🆕 v2026-07-30: cambia de tab CON animación de deslizamiento (la lista sale hacia `dir` y la nueva entra por el lado opuesto).
        function _setFilter(f, dir) {
            if (!_tabsOrden.includes(f)) return;
            const cambia = f !== filter;
            filter = f;
            page.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
            const cont = document.getElementById('chats-list-container');
            if (cont && dir && cambia) {
                const outX = dir === 'left' ? -26 : 26;
                cont.style.transition = 'transform .13s ease, opacity .13s ease';
                cont.style.transform = `translateX(${outX}px)`;
                cont.style.opacity = '0.25';
                setTimeout(() => {
                    renderList();
                    cont.style.transition = 'none';
                    cont.style.transform = `translateX(${-outX}px)`; // arranca del lado opuesto
                    requestAnimationFrame(() => {
                        cont.style.transition = 'transform .18s ease, opacity .18s ease';
                        cont.style.transform = 'translateX(0)';
                        cont.style.opacity = '1';
                    });
                }, 130);
            } else {
                renderList();
            }
        }
        page.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => _setFilter(btn.dataset.filter, _dirTab(filter, btn.dataset.filter)));
        });
        // 🆕 v2026-07-30: navegar tabs con swipe horizontal (humano ↔ bot ↔ todos).
        // passive:true → no bloquea el scroll vertical; solo actúa si el gesto es claramente horizontal.
        const _swipeZona = document.getElementById('chats-list-container') || page;
        let _sx = 0, _sy = 0, _st = 0;
        _swipeZona.addEventListener('touchstart', (e) => {
            const t = e.changedTouches[0]; _sx = t.clientX; _sy = t.clientY; _st = Date.now();
        }, { passive: true });
        _swipeZona.addEventListener('touchend', (e) => {
            const t = e.changedTouches[0];
            const dx = t.clientX - _sx, dy = t.clientY - _sy, dt = Date.now() - _st;
            if (dt < 600 && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) {
                const idx = _tabsOrden.indexOf(filter);
                const next = dx < 0 ? idx + 1 : idx - 1; // arrastrar a la izquierda → siguiente tab
                if (next >= 0 && next < _tabsOrden.length) _setFilter(_tabsOrden[next], dx < 0 ? 'left' : 'right');
            }
        }, { passive: true });
        // Búsqueda — filtra chats local + busca en mensajes con debounce
        page.querySelector('#chats-search').addEventListener('input', (e) => {
            searchTerm = e.target.value.trim();
            clearTimeout(buscarMensajesTimer);
            // 🆕 v2026-05-25: Resetear los resultados ANTES de renderizar.
            // Antes el orden era: renderList() → reset, lo que dejaba residuos al borrar la búsqueda.
            if (searchTerm.length < 3) {
                mensajesEncontrados = [];
                buscandoMensajes = false;
            }
            renderList();
            if (searchTerm.length >= 3) {
                buscarMensajesTimer = setTimeout(() => buscarEnMensajes(searchTerm), 350);
            }
        });
        // 🆕 v1.0.138 (2026-06-15): si ya tenemos chats en memoria (de una visita previa),
        // PINTAR AL INSTANTE como WhatsApp. La request al server queda en background.
        if (chats && chats.length > 0) {
            renderList();
            loadChats(true);  // refresco sin await (no bloquea)
        } else {
            // 🆕 v2026-09: arranque frío → mostrar la CACHÉ local al INSTANTE (como WhatsApp) y
            // refrescar detrás, en vez de quedarse en "Cargando chats…" hasta que responda el server.
            let cacheInicial = [];
            try { cacheInicial = await OfflineStore?.obtenerChatsCache() || []; } catch (_) {}
            if (cacheInicial.length > 0) {
                chats = cacheInicial;
                renderList();
                loadChats(true); // refresco en background, sin bloquear la UI
            } else {
                await loadChats(true); // sin caché todavía → esperar al server (solo la 1ª vez de todas)
            }
        }
        // 🛡️ v2026-06-08: restaurar scroll después del render (loadChats hace renderList()).
        // requestAnimationFrame asegura que el DOM esté pintado antes de saltar.
        // El scroll real está en .app-main (overflow-y:auto del CSS), no en window.
        if (lastScrollY > 0) {
            requestAnimationFrame(() => {
                try {
                    const main = document.querySelector('.app-main');
                    if (main) main.scrollTop = lastScrollY;
                } catch {}
            });
        }
    }

    // 🛡️ v2026-07-31: marcar un chat como leído LOCALMENTE (quita el badge de no-leídos/pendiente
    // al instante al abrirlo, sin esperar el refresco de red). El servidor se sincroniza aparte.
    function marcarLeidoLocal(chatId) {
        const c = chats.find(x => x.id === chatId);
        if (c && (c.unreadCount || c.pendiente || c.urgente)) {
            c.unreadCount = 0; c.pendiente = false; c.urgente = false;
            renderList();
        }
    }

    // 🆕 Mensaje en vivo de Socket.IO: actualiza el chat existente o agrega uno nuevo
    function onNewMessage(data) {
        if (!data || !data.chatId) return;
        const chatId = data.chatId;
        const msg = data.message || {};
        const existing = chats.find(c => c.id === chatId);
        if (existing) {
            existing.lastMessage = (msg.body || '').substring(0, 60);
            existing.lastActivity = msg.timestamp || Date.now();
            // Si no es nuestro y no estamos viendo ese chat, incrementar unread
            if (!msg.fromMe && Router.current() !== 'chat') {
                existing.unreadCount = (existing.unreadCount || 0) + 1;
            }
            // 🆕 v2026-07-30: si es NUESTRO mensaje y lo mandó un ASESOR, el chat deja de estar
            // pendiente/sin-leer (espejo del server). Así no queda "sin contestar" tras responder.
            if (msg.fromMe && (msg.senderTipo || msg.sender_tipo) === 'asesor') {
                existing.unreadCount = 0;
                existing.pendiente = false;
                existing.urgente = false;
                existing.pendienteHorario = false;
                existing.pendienteHorarioDesde = null;
            }
            renderList();
        } else {
            // Chat nuevo → debounce + recarga completa
            if (Date.now() - lastRefresh > 2000) loadChats();
        }
    }

    // 🆕 v2026-06-19 (fix "chat finalizado no aparece en Bot en el app"): el backend hace
    // SOFT-FINALIZE — el chat vuelve a modo bot y queda visible. Pero la lista solo lo reflejaba
    // vía un loadChats() en segundo plano al volver con back(); si ese refresco se demoraba o
    // fallaba (p.ej. durante un reinicio del bot), el array local quedaba viejo (chat como 'human')
    // y NO aparecía en la pestaña Bot. Esto actualiza el chat localmente al instante, sin depender
    // del refresco de red — igual que el fix del panel de escritorio.
    function applyLocalFinalize(chatId) {
        if (!chatId) return;
        const c = chats.find(x => x.id === chatId);
        if (c) {
            c.mode = 'bot';
            c.pendiente = false;
            c.unreadCount = 0;
            c.urgente = false;
            c.pendienteHorario = false;
            c.pendienteHorarioDesde = null;
            c.lastActivity = Date.now();
        }
        try { renderList(); } catch {}
    }

    return {
        show, loadChats, onNewMessage, nuevoChat, showActionMenu, desmarcarPendientes, mostrarQR,
        applyLocalFinalize, reconciliarNotificaciones, marcarLeidoLocal,
        get _cache() { return chats; }  // expuesto para chat-detail
    };
})();

// Registrar la página en el router
if (typeof Router !== 'undefined') {
    Router.register('chats', () => ChatsPage.show());
}
