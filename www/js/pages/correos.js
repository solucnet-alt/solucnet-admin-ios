// 🆕 Página: Correos Corporativos (bandeja tipo Outlook — IMAP/SMTP multi-cuenta)
// Patrón: IIFE con estado privado + auto-registro en Router (igual que ChatsPage/FotosPage).
// Navegación del detalle: PÁGINA nueva (Router.register('correos-detalle', ...)), no modal —
// mismo patrón que 'chat' en chat-detail.js (Router.navigate('chat/'+id)). Se eligió página
// porque da back-button real (historial de hash) y espacio completo para leer el correo,
// consistente con cómo la app ya resuelve el detalle de chats.
// 🛡️ Seguridad: el HTML del correo es contenido NO CONFIABLE → va SIEMPRE en
// <iframe sandbox="allow-same-origin"> vía `.srcdoc` (nunca innerHTML). Todo dato de servidor
// (remitente/asunto/preview/nombre de adjunto) que se inserta en el DOM pasa por escapeHtml().
//
// 🎨 v2026-08-01: RESKIN visual "estilo Outlook mobile" (pedido del dueño del proyecto —
// el diseño anterior le pareció "muy pobre"). Es SOLO visual: mismos endpoints, mismos
// nombres de campo del backend, mismos IDs/clases que usa bindPageEvents()/renderList()/
// showDetalle() para engancharse al DOM. Los estilos nuevos (paleta Microsoft Office,
// avatares de color por remitente, header de cuenta, etc.) viven en un <style> que este
// módulo inyecta una sola vez (injectStyles()), SCOPEADO a #page-correos / #page-correos-detalle
// / .correos-modal para no filtrar hacia chats.js u otras páginas que reusan las mismas
// clases globales (.chat-item, .chat-list, .fab, .tabs-bar, .modal-overlay...).
const CorreosPage = (function() {
    let cuentas = [];
    let cuentaActualId = null;
    let carpetas = [];
    let carpetaActual = null; // path de la carpeta seleccionada
    let mensajes = [];
    let totalMensajes = 0;
    let pagina = 1;
    const POR_PAGINA = 20;
    let cargandoMas = false;
    let hayMas = true;
    let searchTerm = '';
    let searchDebounceTimer = null; // 🆕 debounce (~400ms) de la búsqueda server-side (?q=)
    let lastScrollY = 0;

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    function avatarInitial(name) {
        const clean = (name || '').trim();
        return clean.charAt(0).toUpperCase() || '?';
    }

    // 🎨 Avatar de color por remitente/cuenta (patrón Outlook: cada contacto tiene un color
    // estable, calculado por hash simple del nombre — sin depender de nada del servidor).
    const AVATAR_COLORS = ['#7b6cff', '#35d6a4', '#2aa5ff', '#ff6b81', '#f2b544', '#a48bff', '#12c2c2', '#ff8a5c'];
    function avatarColor(name) {
        const s = (name || '').trim();
        let hash = 0;
        for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
        return AVATAR_COLORS[hash % AVATAR_COLORS.length];
    }

    // 🎨 Estilos "Outlook" inyectados una sola vez. Todo scopeado a #page-correos /
    // #page-correos-detalle / .correos-modal — NUNCA se tocan clases globales sin scope
    // (.chat-item, .fab, .tabs-bar, .modal-overlay... los sigue usando chats.js tal cual).
    function injectStyles() {
        if (document.getElementById('correos-outlook-styles')) return;
        const style = document.createElement('style');
        style.id = 'correos-outlook-styles';
        style.textContent = `
            /* 🎨 v2026-09-13 RESKIN PREMIUM OSCURO (Superhuman) — mismas clases que el reskin Outlook
               anterior, solo cambia la paleta a violeta/oscuro para igualar la web correos.html. */
            #page-correos, #page-correos-detalle {
                --ol-accent: #7b6cff;
                --ol-accent-dark: #a48bff;
                --ol-bg: #0d0f16;
                --ol-panel: #161a24;
                --ol-border: #242a38;
                --ol-text: #e9ebf3;
                --ol-text-secondary: #9aa0b4;
                --ol-grad: linear-gradient(135deg,#7b6cff,#a48bff);
                background: #0d0f16; color: #e9ebf3;
            }
            #page-correos .co-header {
                background: var(--ol-panel);
                border: 1px solid var(--ol-border);
                border-radius: 14px;
                padding: 12px 14px;
                margin-bottom: 8px;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            #page-correos .co-account { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
            #page-correos .co-account-avatar {
                width: 40px; height: 40px; border-radius: 11px; color: #fff;
                display: flex; align-items: center; justify-content: center;
                font-weight: 700; font-size: 1.05em; flex-shrink: 0; text-transform: uppercase;
                box-shadow: 0 2px 8px -2px rgba(0,0,0,.4);
            }
            #page-correos .co-account-info { min-width: 0; }
            #page-correos .co-account-name {
                font-weight: 700; font-size: 0.95em; color: var(--ol-text);
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            #page-correos .co-account-sub {
                font-size: 0.72em; color: var(--ol-text-secondary);
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            #page-correos .co-account-chevron { color: var(--ol-text-secondary); font-size: 0.85em; margin-left: 2px; }
            #page-correos .co-gear { background: var(--ol-bg) !important; color: var(--ol-text-secondary) !important; }

            #page-correos .search-bar { background: var(--ol-panel); border: 1px solid var(--ol-border); border-radius: 11px; box-shadow: none; }
            #page-correos .search-bar input { color: var(--ol-text); }
            #page-correos .search-bar input::placeholder { color: var(--ol-text-secondary); }

            #page-correos #correos-cuentas-bar { margin-bottom: 6px; }
            #page-correos #correos-cuentas-bar .tab-btn { display: inline-flex; align-items: center; gap: 6px; border-radius: 20px; background: var(--ol-panel); border: 1px solid var(--ol-border); color: var(--ol-text-secondary); }
            #page-correos #correos-cuentas-bar .co-chip-avatar {
                width: 18px; height: 18px; border-radius: 50%; background: var(--ol-accent); color: #fff;
                display: inline-flex; align-items: center; justify-content: center; font-size: 0.68em; font-weight: 700;
            }
            #page-correos #correos-cuentas-bar .tab-btn.active .co-chip-avatar { background: rgba(255,255,255,0.35); }
            #page-correos #correos-cuentas-bar .tab-btn.active,
            #page-correos #correos-carpetas-bar .tab-btn.active {
                background: var(--ol-grad);
                border-color: transparent; color: #fff;
            }
            #page-correos .tabs-bar .tab-btn { border-radius: 20px; }

            #page-correos .chat-list .chat-item { border-radius: 12px; align-items: center; padding: 10px 12px; gap: 8px; background: var(--ol-panel); border: 1px solid var(--ol-border); margin-bottom: 6px; }
            #page-correos .chat-list .chat-name, #page-correos .chat-list .chat-title { color: var(--ol-text); }
            #page-correos .chat-list .chat-preview, #page-correos .chat-list .chat-subtitle, #page-correos .chat-list .chat-msg { color: var(--ol-text-secondary); }
            #page-correos .chat-list .co-unread-wrap { width: 8px; flex-shrink: 0; align-self: stretch; display: flex; align-items: center; justify-content: center; }
            #page-correos .chat-list .co-unread-dot { width: 8px; height: 8px; border-radius: 50%; background: #35d6a4; box-shadow: 0 0 8px #35d6a4; }
            #page-correos .chat-item .chat-avatar { box-shadow: 0 2px 8px -2px rgba(0,0,0,.4); border-radius: 11px; }
            #page-correos .chat-item .chat-time { color: var(--ol-text-secondary); }
            #page-correos .chat-item .chat-time.unread { color: var(--ol-accent-dark); }
            #page-correos .fab {
                background: var(--ol-grad);
                box-shadow: 0 8px 22px -8px var(--ol-accent);
            }

            #page-correos-detalle { background: #0d0f16; }
            #page-correos-detalle .co-msg-card {
                background: var(--ol-panel); border: 1px solid var(--ol-border); border-radius: 12px; padding: 14px; margin: 0 8px 8px;
            }
            #page-correos-detalle .co-msg-avatar {
                width: 44px; height: 44px; font-size: 1.1em; color: #fff; border-radius: 12px;
                display: flex; align-items: center; justify-content: center; font-weight: 700;
                flex-shrink: 0; text-transform: uppercase; box-shadow: 0 3px 10px -2px rgba(0,0,0,.45);
            }
            #page-correos-detalle .co-msg-meta-row { font-size: 0.78em; color: var(--ol-text-secondary); margin-bottom: 2px; }
            /* El CUERPO del correo va sobre "papel" blanco para que se lea (texto negro del correo). */
            #page-correos-detalle .co-msg-body, #page-correos-detalle iframe { background: #ffffff; border-radius: 10px; }
            #page-correos-detalle .btn-primary { background: var(--ol-grad); }
            #page-correos-detalle .btn-primary:active { filter: brightness(.95); }

            .correos-modal .modal-content, .correos-modal .modal-box, .correos-modal .modal-body { background: #12151d; color: #e9ebf3; }
            .correos-modal .modal-header { background: var(--ol-grad); }
            .correos-modal .btn-primary { background: var(--ol-grad); }
            .correos-modal .btn-primary:disabled { background: #333a4d; }
            .correos-modal .chat-avatar { background: var(--ol-grad); box-shadow: none; }
            .correos-modal .co-field-label { display: block; font-size: 0.78em; font-weight: 600; color: #9aa0b4; margin-bottom: 4px; }
            .correos-modal .co-input {
                width: 100%; padding: 10px; border: 1px solid #333a4d; border-radius: 9px;
                font-size: 0.9em; margin-bottom: 12px; box-sizing: border-box; font-family: inherit;
                background: #0d0f16; color: #e9ebf3;
            }
            .correos-modal .co-input:focus { outline: none; border-color: #7b6cff; box-shadow: 0 0 0 2px rgba(123,108,255,0.2); }
            .correos-modal .co-input::placeholder { color: #6f7690; }
            .correos-modal .co-row { display: flex; gap: 8px; margin-bottom: 10px; }
            .correos-modal .co-row .co-input { margin-bottom: 0; }
            .correos-modal .co-section-title { font-weight: 700; font-size: 0.82em; color: #e9ebf3; margin: 10px 0 6px; }
            .correos-modal .co-hint {
                background: #241f45; border: 1px solid #2f2860; border-radius: 9px;
                padding: 8px 10px; font-size: 0.75em; color: #a48bff; margin-bottom: 10px;
            }
            /* 🆕 Autocompletado de contactos en el campo "Para" del redactar */
            .correos-modal .co-para-wrap { position: relative; }
            .correos-modal .co-autocomplete {
                position: absolute; left: 0; right: 0; top: 100%; z-index: 30;
                background: #161a24; border: 1px solid #333a4d; border-radius: 9px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.5); max-height: 190px; overflow-y: auto;
                margin-top: -8px;
            }
            .correos-modal .co-autocomplete-item { padding: 8px 10px; cursor: pointer; border-bottom: 1px solid #242a38; }
            .correos-modal .co-autocomplete-item:last-child { border-bottom: none; }
            .correos-modal .co-autocomplete-item:hover { background: #1b2030; }
            .correos-modal .co-ac-nombre { font-weight: 600; font-size: 0.85em; color: #e9ebf3; }
            .correos-modal .co-ac-email { font-size: 0.78em; color: #9aa0b4; }
            .correos-modal .modal-footer { flex-wrap: wrap; }
        `;
        document.head.appendChild(style);
    }
    injectStyles();

    // 🆕 copiado del patrón de ChatsPage.formatTime (hoy=hora, ayer="Ayer", <7 días=día semana)
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
        if (diff < 7) return ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d.getDay()];
        return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' });
    }

    function fmtFechaLarga(ts) {
        if (!ts) return '';
        try { return new Date(ts).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
        catch { return ''; }
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

    // 🛡️ mailparser (leerMensaje en email-service.js) devuelve from/to de un mensaje leído
    // como AddressObject { value, html, text } y NO como string plano (a diferencia de
    // "remitente" en el listado, que ya llega formateado). Sin normalizar esto, escapeHtml()
    // sobre msg.from/msg.to explota (.replace no es función sobre un objeto) al abrir
    // CUALQUIER mensaje. Ver auditoría.
    function direccionTexto(x) {
        if (x === null || x === undefined) return '';
        if (typeof x === 'string') return x;
        if (typeof x === 'object') {
            if (typeof x.text === 'string') return x.text;
            if (Array.isArray(x.value) && x.value[0]) {
                return x.value.map(v => v.name ? `${v.name} <${v.address}>` : v.address).join(', ');
            }
        }
        return String(x);
    }

    function nombreRemitente(remitente) {
        // remitente puede venir "Nombre <correo@dominio.com>" o solo el email
        const s = direccionTexto(remitente);
        const m = s.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
        if (m && m[1] && m[1].trim()) return m[1].trim();
        if (m && m[2]) return m[2];
        return s || 'Desconocido';
    }

    function carpetaLabel(c) {
        const u = (c.usoEspecial || '').toLowerCase();
        if (u === 'inbox') return 'Bandeja de entrada';
        if (u === 'sent') return 'Enviados';
        if (u === 'trash') return 'Papelera';
        if (u === 'drafts') return 'Borradores';
        if (u === 'junk' || u === 'spam') return 'Spam';
        return c.nombre || c.path || 'Carpeta';
    }

    function carpetaIcon(c) {
        const u = (c.usoEspecial || '').toLowerCase();
        if (u === 'inbox') return 'fa-inbox';
        if (u === 'sent') return 'fa-paper-plane';
        if (u === 'trash') return 'fa-trash';
        if (u === 'drafts') return 'fa-file-alt';
        if (u === 'junk' || u === 'spam') return 'fa-ban';
        return 'fa-folder';
    }

    // ============ Ensamble de contenedores de página (patrón fotos.js: crear si no existe) ============
    function ensurePage(id) {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const main = document.querySelector('.app-main');
        let page = document.getElementById(id);
        if (!page) {
            page = document.createElement('div');
            page.id = id;
            page.className = 'page';
            main.appendChild(page);
        }
        page.classList.add('active');
        return page;
    }

    // ============================== LISTA (bandeja) ==============================

    function pageTemplate() {
        const cuentaActualObj = cuentas.find(c => String(c.id) === String(cuentaActualId));
        const nombreCuentaActual = (cuentaActualObj && (cuentaActualObj.nombre_cuenta || cuentaActualObj.email)) || 'Correo';
        const folderObj = carpetas.find(c => c.path === carpetaActual);
        const folderSub = folderObj ? `${carpetaLabel(folderObj)} · ${totalMensajes} correo${totalMensajes === 1 ? '' : 's'}` : '';

        const cuentasHtml = cuentas.length > 1 ? `
            <div class="tabs-bar" id="correos-cuentas-bar">
                ${cuentas.map(c => `
                    <button class="tab-btn ${c.id == cuentaActualId ? 'active' : ''}" data-cuenta="${c.id}">
                        <span class="co-chip-avatar">${escapeHtml(avatarInitial(c.nombre_cuenta || c.email))}</span>
                        ${escapeHtml(c.nombre_cuenta || c.email || ('Cuenta ' + c.id))}
                    </button>
                `).join('')}
            </div>
        ` : '';

        const carpetasHtml = `
            <div class="tabs-bar" id="correos-carpetas-bar">
                ${carpetas.map(c => `
                    <button class="tab-btn ${c.path === carpetaActual ? 'active' : ''}" data-carpeta="${escapeHtml(c.path)}">
                        <i class="fas ${carpetaIcon(c)}"></i> ${escapeHtml(carpetaLabel(c))}${c.noLeidos ? ` <span class="count">${c.noLeidos}</span>` : ''}
                    </button>
                `).join('')}
            </div>
        `;

        const gearBtn = (typeof Auth !== 'undefined' && Auth.tienePermiso('gestionar_correos_cuentas'))
            ? `<button class="icon-btn co-gear" id="correos-btn-cuentas" title="Gestionar cuentas"><i class="fas fa-cog"></i></button>`
            : '';

        return `
            <div class="co-header">
                <div class="co-account" id="correos-account-switch" ${cuentas.length > 1 ? 'style="cursor:pointer;" title="Cambiar de correo"' : ''}>
                    <div class="co-account-avatar" style="background:${avatarColor(nombreCuentaActual)};">${escapeHtml(avatarInitial(nombreCuentaActual))}</div>
                    <div class="co-account-info">
                        <div class="co-account-name">${escapeHtml(nombreCuentaActual)}</div>
                        <div class="co-account-sub">${escapeHtml(folderSub)}</div>
                    </div>
                    ${cuentas.length > 1 ? '<i class="fas fa-chevron-down co-account-chevron"></i>' : ''}
                </div>
                ${gearBtn}
            </div>
            <div class="search-bar">
                <i class="fas fa-search search-icon"></i>
                <input type="text" id="correos-search" placeholder="Buscar correos..." autocomplete="off" value="${escapeHtml(searchTerm || '')}">
            </div>
            ${cuentasHtml}
            ${carpetasHtml}
            <div id="correos-refresh-indicator" class="refresh-indicator">
                <i class="fas fa-spinner"></i> Actualizando...
            </div>
            <div id="correos-list-container" class="chat-list">
                <div class="loading-center"><i class="fas fa-spinner fa-spin"></i><p>Cargando correos…</p></div>
            </div>
            <button class="fab" id="correos-fab-redactar" title="Redactar">
                <i class="fas fa-pen"></i>
            </button>
        `;
    }

    // 🆕 La búsqueda ahora es server-side (?q= en /mensajes) — `mensajes` YA viene filtrado
    // por el backend cuando hay searchTerm activo, no hace falta re-filtrar acá.
    function filteredMensajes() {
        return mensajes;
    }

    function renderItem(m) {
        const remitenteNombre = nombreRemitente(m.remitente);
        const asunto = m.asunto && m.asunto.trim() ? m.asunto : '(Sin asunto)';
        const preview = m.preview ? m.preview.substring(0, 90) : '';
        const noLeido = m.leido === false;
        return `
            <div class="chat-item" data-uid="${escapeHtml(String(m.uid))}">
                <div class="co-unread-wrap">${noLeido ? '<span class="co-unread-dot"></span>' : ''}</div>
                <div class="chat-avatar" style="background:${avatarColor(remitenteNombre)};">${escapeHtml(avatarInitial(remitenteNombre))}</div>
                <div class="chat-info">
                    <div class="chat-name-row">
                        <div class="chat-name" style="${noLeido ? 'font-weight:800;' : ''}">${escapeHtml(remitenteNombre)}</div>
                        <div class="chat-time ${noLeido ? 'unread' : ''}">${formatTime(m.fecha)}</div>
                        <button class="co-star ${m.destacado ? 'on' : ''}" data-uid="${escapeHtml(String(m.uid))}" aria-label="Destacar" style="background:none;border:none;cursor:pointer;padding:0 2px;margin-left:6px;font-size:1em;color:${m.destacado ? '#f2b01e' : '#c8c6c4'};"><i class="${m.destacado ? 'fas' : 'far'} fa-star"></i></button>
                    </div>
                    <div class="chat-subtitle" style="${noLeido ? 'color:#242424; font-weight:700;' : ''}">${escapeHtml(asunto)}</div>
                    <div class="chat-preview-row">
                        <div class="chat-preview">${escapeHtml(preview)}</div>
                        ${m.tieneAdjuntos ? '<i class="fas fa-paperclip" style="color:var(--text-tertiary); font-size:0.85em;" title="Tiene adjuntos"></i>' : ''}
                    </div>
                </div>
            </div>
        `;
    }

    function renderList() {
        const container = document.getElementById('correos-list-container');
        if (!container) return;
        const list = filteredMensajes();
        if (list.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-envelope-open"></i>
                    <p>${searchTerm ? 'Sin correos que coincidan' : 'No hay correos en esta carpeta'}</p>
                </div>
            `;
            return;
        }
        const cargarMasHtml = hayMas
            ? `<div id="correos-cargar-mas" style="text-align:center; padding:14px;">
                   <button class="btn-secondary" style="width:100%;">${cargandoMas ? '<i class="fas fa-spinner fa-spin"></i> Cargando…' : 'Cargar más correos'}</button>
               </div>`
            : '';
        container.innerHTML = list.map(renderItem).join('') + cargarMasHtml;
        container.querySelectorAll('.chat-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.co-star')) return; // el tap en la estrella no abre el correo
                try { lastScrollY = document.querySelector('.app-main')?.scrollTop || 0; } catch {}
                const uid = el.dataset.uid;
                Router.navigate(`correos-detalle/${encodeURIComponent(cuentaActualId)}/${encodeURIComponent(carpetaActual)}/${encodeURIComponent(uid)}`);
            });
        });
        container.querySelectorAll('.co-star').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); toggleDestacado(btn.dataset.uid); });
        });
        const btnMas = document.getElementById('correos-cargar-mas');
        if (btnMas) btnMas.addEventListener('click', () => cargarMasMensajes());
    }

    async function loadCuentas() {
        try {
            const data = await API.get('/api/correos/cuentas');
            cuentas = (data && data.cuentas) ? data.cuentas : (Array.isArray(data) ? data : []);
            if (!cuentaActualId && cuentas.length > 0) cuentaActualId = cuentas[0].id;
        } catch (err) {
            console.error('[correos] Error cargando cuentas:', err);
            cuentas = [];
        }
    }

    async function loadCarpetas() {
        if (!cuentaActualId) { carpetas = []; return; }
        try {
            const data = await API.get(`/api/correos/${cuentaActualId}/carpetas`);
            carpetas = (data && data.carpetas) ? data.carpetas : [];
            if (!carpetaActual || !carpetas.find(c => c.path === carpetaActual)) {
                const inbox = carpetas.find(c => (c.usoEspecial || '').toLowerCase() === 'inbox');
                carpetaActual = inbox ? inbox.path : (carpetas[0] ? carpetas[0].path : null);
            }
        } catch (err) {
            console.error('[correos] Error cargando carpetas:', err);
            carpetas = [];
        }
    }

    async function loadMensajes(showRefresh = false) {
        const refreshEl = document.getElementById('correos-refresh-indicator');
        if (showRefresh && refreshEl) refreshEl.classList.add('refreshing');
        const container = document.getElementById('correos-list-container');
        if (!cuentaActualId || !carpetaActual) {
            if (container) container.innerHTML = `<div class="empty-state"><i class="fas fa-envelope"></i><p>No hay cuentas de correo configuradas</p></div>`;
            if (refreshEl) refreshEl.classList.remove('refreshing');
            return;
        }
        try {
            pagina = 1;
            const qParam = searchTerm ? `&q=${encodeURIComponent(searchTerm)}` : '';
            const data = await API.get(`/api/correos/${cuentaActualId}/mensajes?carpeta=${encodeURIComponent(carpetaActual)}&pagina=${pagina}&porPagina=${POR_PAGINA}${qParam}`);
            mensajes = (data && data.mensajes) ? data.mensajes : (Array.isArray(data) ? data : []);
            totalMensajes = (data && typeof data.total === 'number') ? data.total : mensajes.length;
            hayMas = mensajes.length < totalMensajes;
            renderList();
        } catch (err) {
            console.error('[correos] Error cargando mensajes:', err);
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

    async function cargarMasMensajes() {
        if (cargandoMas || !hayMas) return;
        cargandoMas = true;
        renderList();
        try {
            pagina += 1;
            const qParam = searchTerm ? `&q=${encodeURIComponent(searchTerm)}` : '';
            const data = await API.get(`/api/correos/${cuentaActualId}/mensajes?carpeta=${encodeURIComponent(carpetaActual)}&pagina=${pagina}&porPagina=${POR_PAGINA}${qParam}`);
            const nuevos = (data && data.mensajes) ? data.mensajes : [];
            mensajes = mensajes.concat(nuevos);
            totalMensajes = (data && typeof data.total === 'number') ? data.total : totalMensajes;
            hayMas = mensajes.length < totalMensajes && nuevos.length > 0;
        } catch (err) {
            console.warn('[correos] Error cargando más:', err.message);
            hayMas = false;
        } finally {
            cargandoMas = false;
            renderList();
        }
    }

    async function cambiarCuenta(id) {
        if (id == cuentaActualId) return;
        cuentaActualId = id;
        carpetaActual = null;
        mensajes = [];
        const page = document.getElementById('page-correos');
        if (page) page.innerHTML = pageTemplate();
        bindPageEvents();
        const container = document.getElementById('correos-list-container');
        if (container) container.innerHTML = `<div class="loading-center"><i class="fas fa-spinner fa-spin"></i><p>Cargando correos…</p></div>`;
        await loadCarpetas();
        const page2 = document.getElementById('page-correos');
        if (page2) page2.innerHTML = pageTemplate();
        bindPageEvents();
        await loadMensajes();
    }

    async function cambiarCarpeta(path) {
        if (path === carpetaActual) return;
        carpetaActual = path;
        document.querySelectorAll('#correos-carpetas-bar .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.carpeta === path));
        const container = document.getElementById('correos-list-container');
        if (container) container.innerHTML = `<div class="loading-center"><i class="fas fa-spinner fa-spin"></i><p>Cargando correos…</p></div>`;
        await loadMensajes();
    }

    function bindPageEvents() {
        const page = document.getElementById('page-correos');
        if (!page) return;
        page.querySelectorAll('#correos-cuentas-bar .tab-btn').forEach(btn => {
            btn.addEventListener('click', () => cambiarCuenta(btn.dataset.cuenta));
        });
        page.querySelectorAll('#correos-carpetas-bar .tab-btn').forEach(btn => {
            btn.addEventListener('click', () => cambiarCarpeta(btn.dataset.carpeta));
        });
        // 🆕 Búsqueda server-side: debounce ~400ms y vuelve a pedir /mensajes con ?q=
        // (antes filtraba en cliente sobre la página ya cargada; ahora el backend filtra
        // dentro de TODA la carpeta, no solo lo que ya bajamos).
        const searchInput = page.querySelector('#correos-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                searchTerm = e.target.value.trim();
                clearTimeout(searchDebounceTimer);
                searchDebounceTimer = setTimeout(() => { loadMensajes(); }, 400);
            });
        }
        const fab = page.querySelector('#correos-fab-redactar');
        if (fab) fab.addEventListener('click', () => abrirModalRedactar());
        const gear = page.querySelector('#correos-btn-cuentas');
        if (gear) gear.addEventListener('click', () => abrirModalCuentas());
        // 🆕 v2026-08: la flecha "v" / header de cuenta abre un selector para cambiar de correo.
        const acctSwitch = page.querySelector('#correos-account-switch');
        if (acctSwitch && cuentas.length > 1) acctSwitch.addEventListener('click', (e) => mostrarSelectorCuentas(e));
    }

    // 🆕 v2026-08: selector desplegable de cuentas (dropdown anclado bajo el header de correo).
    function mostrarSelectorCuentas(ev) {
        try { ev?.stopPropagation?.(); } catch {}
        // si ya está abierto, cerrarlo (toggle)
        if (document.getElementById('correos-cuenta-menu')) { cerrarSelectorCuentas(); return; }
        const overlay = document.createElement('div');
        overlay.id = 'correos-cuenta-menu-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:4000;';
        const menu = document.createElement('div');
        menu.id = 'correos-cuenta-menu';
        menu.style.cssText = 'position:absolute;top:56px;left:10px;min-width:240px;max-width:82vw;max-height:60vh;overflow-y:auto;'
            + 'background:var(--ol-bg, #fff);color:var(--ol-text, #1f2937);border-radius:12px;'
            + 'box-shadow:0 10px 30px rgba(0,0,0,0.28);border:1px solid rgba(0,0,0,0.08);padding:6px;';
        menu.innerHTML = cuentas.map(c => {
            const nombre = c.nombre_cuenta || c.email || ('Cuenta ' + c.id);
            const activo = (c.id == cuentaActualId);
            return `<div class="co-cuenta-opt" data-cuenta="${c.id}" style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;cursor:pointer;${activo ? 'background:rgba(37,99,235,0.10);' : ''}">
                <span style="width:30px;height:30px;flex:0 0 30px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:0.85em;background:${avatarColor(nombre)};">${escapeHtml(avatarInitial(nombre))}</span>
                <span style="min-width:0;flex:1;">
                    <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(nombre)}</div>
                    ${c.email ? `<div style="font-size:0.78em;opacity:0.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.email)}</div>` : ''}
                </span>
                ${activo ? '<i class="fas fa-check" style="color:#2563eb;"></i>' : ''}
            </div>`;
        }).join('');
        overlay.appendChild(menu);
        overlay.addEventListener('click', cerrarSelectorCuentas);
        menu.addEventListener('click', (e) => {
            const opt = e.target.closest('.co-cuenta-opt');
            if (!opt) { e.stopPropagation(); return; }
            e.stopPropagation();
            cerrarSelectorCuentas();
            cambiarCuenta(opt.dataset.cuenta);
        });
        document.body.appendChild(overlay);
    }
    function cerrarSelectorCuentas() {
        document.getElementById('correos-cuenta-menu-overlay')?.remove();
    }

    async function show() {
        const page = ensurePage('page-correos');
        page.innerHTML = `<div class="loading-center"><i class="fas fa-spinner fa-spin"></i><p>Cargando…</p></div>`;
        if (cuentas.length === 0) await loadCuentas();
        if (cuentas.length === 0) {
            page.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-envelope"></i>
                    <p>No hay cuentas de correo configuradas</p>
                    ${(typeof Auth !== 'undefined' && Auth.tienePermiso('gestionar_correos_cuentas'))
                        ? '<button class="btn-primary" id="correos-empty-agregar" style="margin-top:14px;"><i class="fas fa-plus"></i> Agregar cuenta</button>'
                        : ''}
                </div>
            `;
            const btn = document.getElementById('correos-empty-agregar');
            if (btn) btn.addEventListener('click', () => abrirModalCuentas());
            return;
        }
        if (!carpetas.length) await loadCarpetas();
        page.innerHTML = pageTemplate();
        bindPageEvents();
        if (mensajes.length > 0) {
            renderList();
            loadMensajes(true); // refresco en segundo plano, sin bloquear (patrón chats.js)
        } else {
            await loadMensajes(true);
        }
        if (lastScrollY > 0) {
            requestAnimationFrame(() => {
                try {
                    const main = document.querySelector('.app-main');
                    if (main) main.scrollTop = lastScrollY;
                } catch {}
            });
        }
    }

    // ============================== DETALLE (lectura) ==============================

    function detalleTemplate() {
        return `
            <div style="background:white; border-radius:0 0 14px 14px; padding:calc(10px + var(--safe-top,0px)) 8px 10px; margin:-8px -8px 10px; box-shadow:0 1px 3px rgba(15,23,42,0.06); display:flex; align-items:center; gap:8px;">
                <button class="icon-btn" id="correos-detalle-back" style="background:rgba(0,0,0,0.06); color:var(--text-secondary);"><i class="fas fa-arrow-left"></i></button>
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:700; font-size:0.95em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" id="correos-detalle-asunto">…</div>
                </div>
                <button class="icon-btn" id="correos-detalle-eliminar" title="Eliminar" style="background:#fee2e2; color:#dc2626;"><i class="fas fa-trash"></i></button>
            </div>
            <div id="correos-detalle-body">
                <div class="loading-center"><i class="fas fa-spinner fa-spin"></i><p>Cargando correo…</p></div>
            </div>
        `;
    }

    function renderAdjuntos(cuentaId, uid, carpeta, attachments) {
        if (!attachments || !attachments.length) return '';
        const items = attachments.map((a, idx) => {
            const nombre = a.filename || a.nombre || `adjunto-${idx + 1}`;
            const tipo = (a.contentType || a.tipo || '').toLowerCase();
            const esImagen = tipo.startsWith('image/');
            const icon = esImagen ? 'fa-image' : (tipo.includes('pdf') ? 'fa-file-pdf' : (tipo.includes('word') || tipo.includes('document') ? 'fa-file-word' : (tipo.includes('sheet') || tipo.includes('excel') ? 'fa-file-excel' : 'fa-file')));
            const url = APP_CONFIG.SERVER_URL + `/api/correos/${cuentaId}/mensajes/${encodeURIComponent(uid)}/adjunto/${encodeURIComponent(nombre)}?carpeta=${encodeURIComponent(carpeta)}&token=${encodeURIComponent(API.getToken())}`;
            return `
                <div class="chat-item" style="cursor:pointer;" data-adjunto-url="${escapeHtml(url)}" data-adjunto-imagen="${esImagen ? '1' : '0'}" data-adjunto-nombre="${escapeHtml(nombre)}">
                    <div class="chat-avatar" style="background:var(--bg); color:var(--text-secondary); box-shadow:none;"><i class="fas ${icon}"></i></div>
                    <div class="chat-info">
                        <div class="chat-name">${escapeHtml(nombre)}</div>
                        <div class="chat-preview">${a.size ? formatBytes(a.size) : ''}</div>
                    </div>
                    <i class="fas fa-download" style="color:var(--text-tertiary); align-self:center;"></i>
                </div>
            `;
        }).join('');
        return `
            <div style="padding:0 8px; font-size:0.78em; font-weight:600; color:#666; text-transform:uppercase; letter-spacing:0.5px; margin:14px 0 6px;">
                <i class="fas fa-paperclip"></i> Adjuntos (${attachments.length})
            </div>
            <div class="chat-list" style="padding-bottom:8px;">${items}</div>
        `;
    }

    function formatBytes(n) {
        if (!n) return '';
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }

    async function showDetalle(params) {
        const cuentaId = params && params[0];
        const carpeta = decodeURIComponent((params && params[1]) || '');
        const uid = decodeURIComponent((params && params[2]) || '');

        // 🆕 Si el mensaje está en la carpeta de Borradores (misma detección `usoEspecial ===
        // 'drafts'` que ya usa carpetaLabel/carpetaIcon), no abrimos el panel de lectura normal:
        // abrimos directo el overlay de redactar precargado con lo guardado, y guardamos el uid
        // original para mandarlo como uidBorradorExistente si el usuario vuelve a guardar.
        const folderDraftObj = carpetas.find(c => c.path === carpeta);
        const esBorrador = folderDraftObj && (folderDraftObj.usoEspecial || '').toLowerCase() === 'drafts';
        if (esBorrador) {
            const page = ensurePage('page-correos-detalle');
            page.innerHTML = `
                <div style="background:white; border-radius:0 0 14px 14px; padding:calc(10px + var(--safe-top,0px)) 8px 10px; margin:-8px -8px 10px; box-shadow:0 1px 3px rgba(15,23,42,0.06); display:flex; align-items:center; gap:8px;">
                    <button class="icon-btn" id="correos-detalle-back" style="background:rgba(0,0,0,0.06); color:var(--text-secondary);"><i class="fas fa-arrow-left"></i></button>
                    <div style="flex:1; font-weight:700; font-size:0.95em;">Editando borrador…</div>
                </div>
                <div class="loading-center"><i class="fas fa-spinner fa-spin"></i><p>Cargando borrador…</p></div>
            `;
            page.querySelector('#correos-detalle-back').addEventListener('click', () => Router.navigate('correos'));
            try {
                const data = await API.get(`/api/correos/${cuentaId}/mensajes/${encodeURIComponent(uid)}?carpeta=${encodeURIComponent(carpeta)}`);
                const msg = (data && data.mensaje) ? data.mensaje : data;
                if (!msg) throw new Error('Borrador no encontrado');
                abrirModalRedactar({
                    para: direccionTexto(msg.to),
                    asunto: msg.subject || '',
                    cuerpo: msg.text || '',
                    borradorUid: uid,
                    borradorCarpeta: carpeta,
                    onClose: () => Router.navigate('correos'),
                    onDone: () => Router.navigate('correos'),
                });
            } catch (err) {
                page.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-exclamation-triangle" style="color:var(--danger);"></i>
                        <p>Error: ${escapeHtml(err.message)}</p>
                    </div>
                `;
            }
            return;
        }

        const page = ensurePage('page-correos-detalle');
        page.innerHTML = detalleTemplate();
        page.querySelector('#correos-detalle-back').addEventListener('click', () => Router.navigate('correos'));
        page.querySelector('#correos-detalle-eliminar').addEventListener('click', () => eliminarMensaje(cuentaId, carpeta, uid));

        const bodyEl = page.querySelector('#correos-detalle-body');
        try {
            const data = await API.get(`/api/correos/${cuentaId}/mensajes/${encodeURIComponent(uid)}?carpeta=${encodeURIComponent(carpeta)}`);
            const msg = (data && data.mensaje) ? data.mensaje : data;
            if (!msg) throw new Error('Correo no encontrado');
            const asunto = msg.subject && msg.subject.trim() ? msg.subject : '(Sin asunto)';
            page.querySelector('#correos-detalle-asunto').textContent = asunto;

            const iframeId = 'correos-body-iframe-' + Date.now();
            bodyEl.innerHTML = `
                <div class="co-msg-card">
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                        <div class="co-msg-avatar" style="background:${avatarColor(nombreRemitente(msg.from))};">${escapeHtml(avatarInitial(nombreRemitente(msg.from)))}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:700; font-size:0.92em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(nombreRemitente(msg.from))}</div>
                            <div style="font-size:0.75em; color:var(--text-tertiary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(direccionTexto(msg.from))}</div>
                        </div>
                        <button class="icon-btn" id="correos-detalle-guardar-contacto" title="Guardar contacto" style="background:var(--bg); color:#c19b00; width:34px; height:34px; font-size:0.85em; flex-shrink:0;"><i class="fas fa-star"></i></button>
                    </div>
                    <div class="co-msg-meta-row"><b>Para:</b> ${escapeHtml(direccionTexto(msg.to))}</div>
                    <div class="co-msg-meta-row" style="margin-bottom:10px;"><b>Fecha:</b> ${escapeHtml(fmtFechaLarga(msg.date))}</div>
                    <div style="font-weight:700; font-size:1.05em; margin-bottom:10px; color:#242424;">${escapeHtml(asunto)}</div>
                    <iframe id="${iframeId}" sandbox="allow-same-origin" style="width:100%; min-height:120px; border:none; display:block;"></iframe>
                </div>
                ${renderAdjuntos(cuentaId, uid, carpeta, msg.attachments)}
                <div style="padding:8px; display:flex; gap:8px; flex-wrap:wrap;">
                    <button class="btn-primary" id="correos-detalle-responder" style="flex:1 1 30%;"><i class="fas fa-reply"></i> Responder</button>
                    <button class="btn-secondary" id="correos-detalle-responder-todos" style="flex:1 1 30%;"><i class="fas fa-reply-all"></i> A todos</button>
                    <button class="btn-secondary" id="correos-detalle-reenviar" style="flex:1 1 30%;"><i class="fas fa-share"></i> Reenviar</button>
                </div>
                <div style="padding:0 8px 12px; display:flex; gap:8px; justify-content:space-around;">
                    <button class="btn-secondary" id="correos-detalle-destacar" style="flex:1;"><i class="${msg.destacado ? 'fas' : 'far'} fa-star" style="color:${msg.destacado ? '#f2b01e' : 'inherit'};"></i> ${msg.destacado ? 'Quitar' : 'Destacar'}</button>
                    <button class="btn-secondary" id="correos-detalle-noleido" style="flex:1;"><i class="fas fa-envelope"></i> No leído</button>
                    <button class="btn-secondary" id="correos-detalle-archivar" style="flex:1;"><i class="fas fa-box-archive"></i> Archivar</button>
                </div>
            `;
            // Headers de hilo del mensaje abierto (para encadenar la respuesta).
            const _refPrev = Array.isArray(msg.references) ? msg.references.join(' ') : (msg.references || '');
            const _hilo = msg.messageId ? { inReplyTo: msg.messageId, references: (_refPrev + ' ' + msg.messageId).trim() } : {};
            // 🛡️ El cuerpo HTML del correo es contenido no confiable: se pinta SOLO vía
            // `.srcdoc` de un <iframe sandbox="allow-same-origin"> (sin allow-scripts), nunca
            // con innerHTML directo. Así se ve con formato pero no puede ejecutar nada ni
            // acceder al resto de la página (origen aislado).
            const iframe = document.getElementById(iframeId);
            const rawHtml = msg.html;
            const rawText = msg.text;
            let srcdoc;
            if (rawHtml && String(rawHtml).trim()) {
                srcdoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
                    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:15px; color:#1a1a1a; margin:0; padding:0; word-wrap:break-word; overflow-wrap:break-word;}
                    img{max-width:100%; height:auto;}
                    a{color:#0078D4;}
                    table{max-width:100%;}
                </style></head><body>${rawHtml}</body></html>`;
            } else {
                const esc = escapeHtml(rawText || '(Este correo no tiene contenido)');
                srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:15px; color:#1a1a1a; white-space:pre-wrap; word-wrap:break-word; margin:0; padding:0;}</style></head><body>${esc}</body></html>`;
            }
            if (iframe) {
                iframe.addEventListener('load', () => {
                    try {
                        const h = iframe.contentDocument?.body?.scrollHeight || 0;
                        if (h > 0) iframe.style.height = (h + 20) + 'px';
                    } catch {}
                });
                iframe.srcdoc = srcdoc;
            }

            page.querySelectorAll('[data-adjunto-url]').forEach(el => {
                el.addEventListener('click', () => {
                    const url = el.dataset.adjuntoUrl;
                    if (el.dataset.adjuntoImagen === '1') openLightbox(url);
                    else window.open(url, '_blank');
                });
            });

            const _citaResp = `\n\n---- Mensaje original ----\nDe: ${direccionTexto(msg.from)}\nFecha: ${fmtFechaLarga(msg.date)}\nAsunto: ${asunto}\n\n${(rawText || '').substring(0, 500)}`;
            const _asuntoRe = asunto.toLowerCase().startsWith('re:') ? asunto : ('Re: ' + asunto);
            page.querySelector('#correos-detalle-responder').addEventListener('click', () => {
                abrirModalRedactar({ para: direccionTexto(msg.from), asunto: _asuntoRe, cuerpo: _citaResp, ..._hilo });
            });

            // 🆕 Responder a todos: Para = remitente; Cc = resto de To+Cc (sin la cuenta propia ni el remitente).
            page.querySelector('#correos-detalle-responder-todos').addEventListener('click', () => {
                const miEmail = ((cuentas.find(c => String(c.id) === String(cuentaId)) || {}).email || '').toLowerCase();
                const fromTxt = direccionTexto(msg.from);
                const fromEmail = ((fromTxt.match(/<([^>]+)>/) || [])[1] || fromTxt).toLowerCase();
                const brutos = [direccionTexto(msg.to), direccionTexto(msg.cc)].filter(Boolean).join(',').split(',').map(s => s.trim()).filter(Boolean);
                const vistos = new Set(); const cc = [];
                brutos.forEach(s => { const em = ((s.match(/<([^>]+)>/) || [])[1] || s).trim(); const k = em.toLowerCase(); if (!k || k === miEmail || k === fromEmail || vistos.has(k)) return; vistos.add(k); cc.push(em); });
                abrirModalRedactar({ para: fromTxt, cc: cc.join(', '), asunto: _asuntoRe, cuerpo: _citaResp, ..._hilo });
            });

            // 🆕 Reenviar: mismo flujo de redactar, destinatario vacío, cuerpo citado con el
            // formato clásico "Mensaje reenviado". Simplificación deliberada: NO arrastra los
            // adjuntos del original (habría que re-subirlos al server; se deja anotado, no es
            // parte de este alcance) — si el usuario los necesita, los adjunta de nuevo a mano.
            page.querySelector('#correos-detalle-reenviar').addEventListener('click', () => {
                abrirModalRedactar({
                    para: '',
                    asunto: asunto.toLowerCase().startsWith('fwd:') ? asunto : ('Fwd: ' + asunto),
                    cuerpo: `\n\n---------- Mensaje reenviado ----------\nDe: ${direccionTexto(msg.from)}\nFecha: ${fmtFechaLarga(msg.date)}\nAsunto: ${asunto}\n\n${(rawText || '').substring(0, 2000)}`
                });
            });

            // 🆕 Guardar contacto rápido: usa direccionTexto() (mismo parser que ya se usa
            // para mostrar el remitente) para extraer nombre/email del From actual.
            const btnContacto = page.querySelector('#correos-detalle-guardar-contacto');
            if (btnContacto) btnContacto.addEventListener('click', () => guardarContactoDesdeRemitente(msg.from));

            // 🆕 v2026-09-08: destacar / no-leído / archivar desde el detalle.
            const btnDest = page.querySelector('#correos-detalle-destacar');
            if (btnDest) btnDest.addEventListener('click', async () => {
                const nuevo = !msg.destacado;
                try {
                    await API.put(`/api/correos/${cuentaId}/mensajes/${encodeURIComponent(uid)}/destacado?carpeta=${encodeURIComponent(carpeta)}`, { destacado: nuevo });
                    msg.destacado = nuevo;
                    const mm = mensajes.find(x => String(x.uid) === String(uid)); if (mm) mm.destacado = nuevo;
                    btnDest.innerHTML = `<i class="${nuevo ? 'fas' : 'far'} fa-star" style="color:${nuevo ? '#f2b01e' : 'inherit'};"></i> ${nuevo ? 'Quitar' : 'Destacar'}`;
                    showToast(nuevo ? 'Destacado ✓' : 'Destacado quitado', 'success');
                } catch (e) { showToast('No se pudo destacar', 'error'); }
            });
            const btnNL = page.querySelector('#correos-detalle-noleido');
            if (btnNL) btnNL.addEventListener('click', async () => {
                try {
                    await API.put(`/api/correos/${cuentaId}/mensajes/${encodeURIComponent(uid)}/leido?carpeta=${encodeURIComponent(carpeta)}`, { leido: false });
                    const mm = mensajes.find(x => String(x.uid) === String(uid)); if (mm) mm.leido = false;
                    showToast('Marcado como no leído', 'success');
                    Router.navigate('correos');
                } catch (e) { showToast('No se pudo marcar', 'error'); }
            });
            const btnArch = page.querySelector('#correos-detalle-archivar');
            if (btnArch) btnArch.addEventListener('click', async () => {
                const carpArchivo = (carpetas || []).find(c => c.usoEspecial === 'archive');
                if (!carpArchivo) { showToast('Esta cuenta no tiene carpeta de Archivo', 'error'); return; }
                try {
                    await API.put(`/api/correos/${cuentaId}/mensajes/${encodeURIComponent(uid)}/mover`, { carpetaOrigen: carpeta, carpetaDestino: carpArchivo.path });
                    mensajes = mensajes.filter(m => String(m.uid) !== String(uid));
                    showToast('Archivado ✓', 'success');
                    Router.navigate('correos');
                } catch (e) { showToast('No se pudo archivar', 'error'); }
            });

            // Marcar como leído en el servidor + reflejar localmente en la lista
            try {
                await API.put(`/api/correos/${cuentaId}/mensajes/${encodeURIComponent(uid)}/leido?carpeta=${encodeURIComponent(carpeta)}`, { leido: true });
                const m = mensajes.find(x => String(x.uid) === String(uid));
                if (m) m.leido = true;
            } catch (e) { console.warn('[correos] no se pudo marcar como leído:', e.message); }
        } catch (err) {
            bodyEl.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle" style="color:var(--danger);"></i>
                    <p>Error: ${escapeHtml(err.message)}</p>
                </div>
            `;
        }
    }

    async function eliminarMensaje(cuentaId, carpeta, uid) {
        if (!confirm('¿Eliminar este correo?')) return;
        try {
            await API.del(`/api/correos/${cuentaId}/mensajes/${encodeURIComponent(uid)}?carpeta=${encodeURIComponent(carpeta)}`);
            mensajes = mensajes.filter(m => String(m.uid) !== String(uid));
            showToast('Correo eliminado ✓', 'success');
            Router.navigate('correos');
        } catch (err) {
            alert('Error al eliminar: ' + err.message);
        }
    }

    // 🆕 v2026-09-08: destacar/quitar destacado (estrella, estilo Gmail). Optimista + PUT al backend.
    async function toggleDestacado(uid) {
        const m = mensajes.find(x => String(x.uid) === String(uid));
        const nuevo = !(m ? m.destacado : false);
        if (m) { m.destacado = nuevo; renderList(); }
        try {
            await API.put(`/api/correos/${cuentaActualId}/mensajes/${encodeURIComponent(uid)}/destacado?carpeta=${encodeURIComponent(carpetaActual)}`, { destacado: nuevo });
        } catch (err) {
            if (m) { m.destacado = !nuevo; renderList(); }
            showToast('No se pudo destacar', 'error');
        }
    }

    // 🆕 Contactos: guardado rápido desde el remitente de un correo abierto.
    // Reusa direccionTexto() (mismo parser que ya se usa para pintar From/To) para no duplicar
    // lógica de normalización objeto→string del backend (mailparser AddressObject).
    async function guardarContactoDesdeRemitente(from) {
        const texto = direccionTexto(from);
        const m = texto.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
        let nombre, email;
        if (m && m[2]) {
            email = m[2].trim();
            nombre = (m[1] || '').trim() || email;
        } else {
            email = texto.trim();
            nombre = email;
        }
        if (!email) { showToast('No se pudo determinar el email del remitente', 'error'); return; }
        try {
            // 🛡️ el backend espera "nombre"+"email" (no otra convención) en el body JSON.
            await API.post('/api/correos/contactos', { nombre, email });
            showToast('Contacto guardado ✓', 'success');
        } catch (err) {
            alert('Error al guardar contacto: ' + err.message);
        }
    }

    // 🆕 Lightbox de imagen (mismo patrón que FotosPage.openLightbox, reutilizando la clase .lightbox)
    function openLightbox(src) {
        const box = document.createElement('div');
        box.className = 'lightbox';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'lightbox-close';
        closeBtn.innerHTML = '<i class="fas fa-times"></i>';
        closeBtn.addEventListener('click', () => box.remove());
        const dlBtn = document.createElement('button');
        dlBtn.className = 'lightbox-download';
        dlBtn.innerHTML = '<i class="fas fa-external-link-alt"></i>';
        dlBtn.addEventListener('click', () => window.open(src, '_blank'));
        const img = document.createElement('img');
        img.src = src;
        box.appendChild(closeBtn);
        box.appendChild(dlBtn);
        box.appendChild(img);
        document.body.appendChild(box);
        box.addEventListener('click', (e) => { if (e.target === box) box.remove(); });
    }

    // ============================== REDACTAR (FAB + Responder + Reenviar + Borrador) ==============================

    // 🆕 prefill acepta, además de para/asunto/cuerpo:
    //   - borradorUid / borradorCarpeta: si viene seteado, "Guardar borrador" actualiza ese
    //     borrador existente (uidBorradorExistente) en vez de crear uno nuevo.
    //   - onClose: callback al cancelar/cerrar el overlay (usado cuando el overlay se abrió
    //     "reemplazando" el panel de lectura, ej. al entrar a un borrador desde la lista).
    //   - onDone: callback al enviar o guardar OK (mismo caso de uso que onClose).
    function abrirModalRedactar(prefill) {
        prefill = prefill || {};
        if (!cuentaActualId) { alert('No hay una cuenta de correo seleccionada'); return; }
        const borradorUidInicial = prefill.borradorUid || null;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay correos-modal';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3><i class="fas fa-pen"></i> Redactar correo</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <label class="co-field-label">Para</label>
                    <div class="co-para-wrap">
                        <input type="email" id="cr-para" class="co-input" placeholder="destinatario@correo.com" value="${escapeHtml(prefill.para || '')}" autocomplete="off">
                        <div id="cr-para-sugerencias" class="co-autocomplete" style="display:none;"></div>
                    </div>
                    <label class="co-field-label">Cc <span style="font-weight:400;color:#888;">(opcional)</span></label>
                    <input type="text" id="cr-cc" class="co-input" placeholder="cc@correo.com (separá con coma)" value="${escapeHtml(prefill.cc || '')}" autocomplete="off">
                    <label class="co-field-label">Cco <span style="font-weight:400;color:#888;">(oculto para los demás — opcional)</span></label>
                    <input type="text" id="cr-cco" class="co-input" placeholder="cco@correo.com (separá con coma)" value="${escapeHtml(prefill.cco || '')}" autocomplete="off">
                    <label class="co-field-label">Asunto</label>
                    <input type="text" id="cr-asunto" class="co-input" placeholder="Asunto" value="${escapeHtml(prefill.asunto || '')}">
                    <label class="co-field-label">Mensaje</label>
                    <textarea id="cr-cuerpo" class="co-input" rows="8" placeholder="Escribí tu mensaje..." style="resize:vertical; font-family:inherit;">${escapeHtml(prefill.cuerpo || '')}</textarea>
                    <label class="co-field-label">Adjuntos</label>
                    <input type="file" id="cr-adjuntos" multiple style="width:100%; font-size:0.85em;">
                    <div id="cr-adjuntos-preview" style="font-size:0.78em; color:#666; margin-top:6px;"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" id="cr-cancelar">Cancelar</button>
                    <button class="btn-secondary" id="cr-guardar-borrador"><i class="fas fa-save"></i> Borrador</button>
                    <button class="btn-primary" id="cr-enviar"><i class="fas fa-paper-plane"></i> Enviar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const cerrar = () => { overlay.remove(); if (typeof prefill.onClose === 'function') prefill.onClose(); };
        overlay.querySelector('.modal-close').onclick = cerrar;
        overlay.querySelector('#cr-cancelar').onclick = cerrar;
        overlay.querySelector('#cr-adjuntos').addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            overlay.querySelector('#cr-adjuntos-preview').textContent = files.length
                ? files.map(f => f.name).join(', ')
                : '';
        });

        // 🆕 Autocompletado de contactos en "Para": debounce ~400ms → GET /api/correos/contactos?q=
        let contactoDebounceTimer = null;
        const paraInput = overlay.querySelector('#cr-para');
        const sugerenciasEl = overlay.querySelector('#cr-para-sugerencias');
        function ocultarSugerencias() { sugerenciasEl.style.display = 'none'; sugerenciasEl.innerHTML = ''; }
        paraInput.addEventListener('input', () => {
            const q = paraInput.value.trim();
            clearTimeout(contactoDebounceTimer);
            if (!q) { ocultarSugerencias(); return; }
            contactoDebounceTimer = setTimeout(async () => {
                try {
                    const data = await API.get(`/api/correos/contactos?q=${encodeURIComponent(q)}`);
                    const contactos = (data && data.contactos) ? data.contactos : [];
                    if (!contactos.length) { ocultarSugerencias(); return; }
                    // 🛡️ nombre/email vienen del servidor → SIEMPRE por escapeHtml() antes de innerHTML.
                    sugerenciasEl.innerHTML = contactos.map(c => `
                        <div class="co-autocomplete-item" data-email="${escapeHtml(c.email)}">
                            <div class="co-ac-nombre">${escapeHtml(c.nombre || c.email)}</div>
                            <div class="co-ac-email">${escapeHtml(c.email)}</div>
                        </div>
                    `).join('');
                    sugerenciasEl.style.display = 'block';
                    sugerenciasEl.querySelectorAll('.co-autocomplete-item').forEach(el => {
                        el.addEventListener('click', () => {
                            paraInput.value = el.dataset.email;
                            ocultarSugerencias();
                        });
                    });
                } catch (err) {
                    console.warn('[correos] error autocompletando contactos:', err.message);
                }
            }, 400);
        });
        paraInput.addEventListener('blur', () => {
            // pequeño delay para que el click sobre una sugerencia llegue antes de ocultarla
            setTimeout(ocultarSugerencias, 200);
        });

        overlay.querySelector('#cr-enviar').onclick = async () => {
            const para = overlay.querySelector('#cr-para').value.trim();
            const asunto = overlay.querySelector('#cr-asunto').value.trim();
            const cuerpo = overlay.querySelector('#cr-cuerpo').value;
            const archivos = overlay.querySelector('#cr-adjuntos').files;
            if (!para) { alert('Ingresá un destinatario'); return; }
            const btn = overlay.querySelector('#cr-enviar');
            btn.disabled = true; btn.innerHTML = 'Enviando…';
            try {
                const fd = new FormData();
                fd.append('para', para);
                const _cc = overlay.querySelector('#cr-cc').value.trim();
                const _cco = overlay.querySelector('#cr-cco').value.trim();
                if (_cc) fd.append('cc', _cc);
                if (_cco) fd.append('cco', _cco);
                if (prefill.inReplyTo) fd.append('inReplyTo', prefill.inReplyTo);   // 🆕 encadenar respuesta
                if (prefill.references) fd.append('references', prefill.references);
                fd.append('asunto', asunto);
                // 🛡️ el backend espera cuerpoTexto/cuerpoHtml (no "cuerpo") — mismo campo que usa la versión web.
                fd.append('cuerpoTexto', cuerpo);
                fd.append('cuerpoHtml', escapeHtml(cuerpo).replace(/\n/g, '<br>'));
                for (let i = 0; i < archivos.length; i++) fd.append('adjuntos', archivos[i]);
                const r = await API.post(`/api/correos/${cuentaActualId}/enviar`, fd);
                if (r && (r.success || r.ok)) {
                    overlay.remove();
                    showToast('Correo enviado ✓', 'success');
                    if (typeof prefill.onDone === 'function') prefill.onDone();
                } else {
                    alert(r?.message || 'No se pudo enviar el correo');
                }
            } catch (err) {
                alert('Error: ' + (err.message || 'red'));
            } finally {
                btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar';
            }
        };

        // 🆕 Guardar borrador: mismo FormData que el envío, pero a /borradores. Si veníamos
        // editando un borrador existente, manda uidBorradorExistente para que el backend lo
        // actualice en vez de crear uno nuevo.
        overlay.querySelector('#cr-guardar-borrador').onclick = async () => {
            const para = overlay.querySelector('#cr-para').value.trim();
            const asunto = overlay.querySelector('#cr-asunto').value.trim();
            const cuerpo = overlay.querySelector('#cr-cuerpo').value;
            const archivos = overlay.querySelector('#cr-adjuntos').files;
            const btn = overlay.querySelector('#cr-guardar-borrador');
            btn.disabled = true; btn.innerHTML = 'Guardando…';
            try {
                const fd = new FormData();
                fd.append('para', para);
                const _ccB = overlay.querySelector('#cr-cc').value.trim();
                const _ccoB = overlay.querySelector('#cr-cco').value.trim();
                if (_ccB) fd.append('cc', _ccB);
                if (_ccoB) fd.append('cco', _ccoB);
                fd.append('asunto', asunto);
                fd.append('cuerpoTexto', cuerpo);
                fd.append('cuerpoHtml', escapeHtml(cuerpo).replace(/\n/g, '<br>'));
                for (let i = 0; i < archivos.length; i++) fd.append('adjuntos', archivos[i]);
                if (borradorUidInicial) fd.append('uidBorradorExistente', borradorUidInicial);
                const r = await API.post(`/api/correos/${cuentaActualId}/borradores`, fd);
                if (r && r.success) {
                    overlay.remove();
                    showToast('Borrador guardado ✓', 'success');
                    if (typeof prefill.onDone === 'function') {
                        prefill.onDone();
                    } else {
                        // Si estamos parados en la carpeta de Borradores, refrescar la lista.
                        const folderObj = carpetas.find(c => c.path === carpetaActual);
                        if (folderObj && (folderObj.usoEspecial || '').toLowerCase() === 'drafts') loadMensajes();
                    }
                } else {
                    alert(r?.message || 'No se pudo guardar el borrador');
                }
            } catch (err) {
                alert('Error: ' + (err.message || 'red'));
            } finally {
                btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Borrador';
            }
        };
    }

    // ============================== GESTIÓN DE CUENTAS ==============================

    function cuentaFormFields(c) {
        c = c || {};
        return `
            <label class="co-field-label">Nombre de la cuenta</label>
            <input type="text" id="cc-nombre" class="co-input" placeholder="Ej: Soporte SolucNet" value="${escapeHtml(c.nombre_cuenta || '')}">
            <label class="co-field-label">Correo electrónico</label>
            <input type="email" id="cc-email" class="co-input" placeholder="cuenta@dominio.com" value="${escapeHtml(c.email || '')}">
            <div class="co-hint">
                <i class="fas fa-info-circle"></i> Si usás <b>Gmail</b>, el campo contraseña debe ser una <b>contraseña de aplicación</b> (no la contraseña normal de la cuenta) — se genera en la configuración de seguridad de Google.
            </div>
            <div class="co-section-title"><i class="fas fa-download"></i> IMAP (recepción)</div>
            <div class="co-row">
                <input type="text" id="cc-imap-host" class="co-input" placeholder="Host" value="${escapeHtml(c.imap_host || 'mail.infomaniak.com')}" style="flex:2;">
                <input type="number" id="cc-imap-port" class="co-input" placeholder="Puerto" value="${escapeHtml(String(c.imap_port || 993))}" style="flex:1;">
            </div>
            <input type="text" id="cc-imap-user" class="co-input" placeholder="Usuario IMAP" value="${escapeHtml(c.imap_user || '')}">
            <input type="password" id="cc-imap-pass" class="co-input" placeholder="Contraseña IMAP" value="${escapeHtml(c.imap_pass || '')}">
            <div class="co-section-title"><i class="fas fa-upload"></i> SMTP (envío)</div>
            <div class="co-row">
                <input type="text" id="cc-smtp-host" class="co-input" placeholder="Host" value="${escapeHtml(c.smtp_host || 'mail.infomaniak.com')}" style="flex:2;">
                <input type="number" id="cc-smtp-port" class="co-input" placeholder="Puerto" value="${escapeHtml(String(c.smtp_port || 587))}" style="flex:1;">
            </div>
            <input type="text" id="cc-smtp-user" class="co-input" placeholder="Usuario SMTP" value="${escapeHtml(c.smtp_user || '')}">
            <input type="password" id="cc-smtp-pass" class="co-input" placeholder="Contraseña SMTP" value="${escapeHtml(c.smtp_pass || '')}">
        `;
    }

    function leerCuentaForm(overlay) {
        const body = {
            // 🛡️ el backend/BD usa "nombre_cuenta" (no "nombre") — mismo campo que la versión web.
            nombre_cuenta: overlay.querySelector('#cc-nombre').value.trim(),
            email: overlay.querySelector('#cc-email').value.trim(),
            imap_host: overlay.querySelector('#cc-imap-host').value.trim(),
            imap_port: parseInt(overlay.querySelector('#cc-imap-port').value, 10) || 993,
            imap_user: overlay.querySelector('#cc-imap-user').value.trim(),
            smtp_host: overlay.querySelector('#cc-smtp-host').value.trim(),
            smtp_port: parseInt(overlay.querySelector('#cc-smtp-port').value, 10) || 587,
            smtp_user: overlay.querySelector('#cc-smtp-user').value.trim(),
        };
        // 🛡️ v2026-08-01: el campo de contraseña SIEMPRE arranca vacío (el backend nunca la
        // devuelve, ni para precargar el form de edición). Si se manda como '' de todos modos,
        // el backend lo interpreta como "borrar la contraseña guardada" (actualizarCuenta hace
        // `valor ? cifrar(valor) : null`) — eso rompería la conexión de una cuenta existente con
        // solo editar el nombre. Mismo criterio que ya usa correos.html: omitir el campo si está
        // en blanco, solo mandarlo cuando el usuario escribió una contraseña nueva de verdad.
        const imapPass = overlay.querySelector('#cc-imap-pass').value;
        const smtpPass = overlay.querySelector('#cc-smtp-pass').value;
        if (imapPass) body.imap_pass = imapPass;
        if (smtpPass) body.smtp_pass = smtpPass;
        return body;
    }

    function abrirModalCuentas() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay correos-modal';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3><i class="fas fa-cog"></i> Cuentas de correo</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;" id="cc-lista-wrap">
                    <div class="loading-center"><i class="fas fa-spinner fa-spin"></i></div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" id="cc-cerrar">Cerrar</button>
                    <button class="btn-primary" id="cc-agregar"><i class="fas fa-plus"></i> Agregar cuenta</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.querySelector('#cc-cerrar').onclick = () => overlay.remove();
        overlay.querySelector('#cc-agregar').onclick = () => abrirModalCuentaEditar(null, overlay);

        function renderListaCuentas() {
            const wrap = overlay.querySelector('#cc-lista-wrap');
            if (!cuentas.length) {
                wrap.innerHTML = `<div class="empty-state" style="padding:24px;"><i class="fas fa-envelope"></i><p>Sin cuentas configuradas</p></div>`;
                return;
            }
            wrap.innerHTML = cuentas.map(c => `
                <div class="chat-item" style="cursor:default;">
                    <div class="chat-avatar" style="font-size:1em;">${escapeHtml(avatarInitial(c.nombre_cuenta || c.email))}</div>
                    <div class="chat-info">
                        <div class="chat-name">${escapeHtml(c.nombre_cuenta || 'Sin nombre')}</div>
                        <div class="chat-preview">${escapeHtml(c.email || '')}</div>
                    </div>
                    <div style="display:flex; gap:6px; align-self:center;">
                        <button class="icon-btn cc-editar" data-id="${c.id}" style="background:var(--bg); color:var(--primary); width:34px; height:34px; font-size:0.85em;"><i class="fas fa-pen"></i></button>
                        <button class="icon-btn cc-eliminar" data-id="${c.id}" style="background:#fee2e2; color:#dc2626; width:34px; height:34px; font-size:0.85em;"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            `).join('');
            wrap.querySelectorAll('.cc-editar').forEach(b => b.addEventListener('click', () => {
                const c = cuentas.find(x => String(x.id) === String(b.dataset.id));
                abrirModalCuentaEditar(c, overlay);
            }));
            wrap.querySelectorAll('.cc-eliminar').forEach(b => b.addEventListener('click', async () => {
                if (!confirm('¿Eliminar esta cuenta de correo?')) return;
                try {
                    await API.del(`/api/correos/cuentas/${b.dataset.id}`);
                    await loadCuentas();
                    renderListaCuentas();
                    if (String(cuentaActualId) === String(b.dataset.id)) {
                        cuentaActualId = cuentas.length ? cuentas[0].id : null;
                        carpetaActual = null;
                    }
                    showToast('Cuenta eliminada ✓', 'success');
                } catch (err) { alert('Error: ' + err.message); }
            }));
        }
        (async () => {
            if (!cuentas.length) await loadCuentas();
            renderListaCuentas();
        })();

        // Guardamos la función en el overlay para poder refrescar tras editar/agregar
        overlay._refrescarLista = renderListaCuentas;
    }

    function abrirModalCuentaEditar(cuentaExistente, overlayPadre) {
        const editando = !!cuentaExistente;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay correos-modal';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3><i class="fas fa-${editando ? 'pen' : 'plus'}"></i> ${editando ? 'Editar cuenta' : 'Nueva cuenta'}</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    ${cuentaFormFields(cuentaExistente)}
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" id="cce-cancelar">Cancelar</button>
                    <button class="btn-primary" id="cce-guardar"><i class="fas fa-save"></i> Guardar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.querySelector('#cce-cancelar').onclick = () => overlay.remove();
        overlay.querySelector('#cce-guardar').onclick = async () => {
            const body = leerCuentaForm(overlay);
            if (!body.email) { alert('Ingresá el correo electrónico de la cuenta'); return; }
            if (!editando && (!body.imap_pass || !body.smtp_pass)) { alert('Completá las contraseñas de IMAP y SMTP'); return; }
            const btn = overlay.querySelector('#cce-guardar');
            btn.disabled = true; btn.innerHTML = 'Guardando…';
            try {
                btn.innerHTML = 'Validando conexión…';
                const guardar = (b) => editando ? API.put(`/api/correos/cuentas/${cuentaExistente.id}`, b) : API.post('/api/correos/cuentas', b);
                try {
                    await guardar(body);
                } catch (e1) {
                    // el servidor prueba usuario/contraseña/servidor antes de guardar
                    if (e1.payload && e1.payload.puede_forzar) {
                        if (!confirm(e1.payload.message + '\n\n¿Guardar de todos modos?')) throw new Error(e1.payload.message);
                        await guardar({ ...body, forzar: true });
                    } else throw e1;
                }
                await loadCuentas();
                overlay.remove();
                if (overlayPadre && overlayPadre._refrescarLista) overlayPadre._refrescarLista();
                showToast(editando ? 'Cuenta actualizada ✓' : 'Cuenta agregada ✓', 'success');
            } catch (err) {
                alert('Error: ' + err.message);
                btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
            }
        };
    }

    return {
        show, showDetalle, openLightbox,
    };
})();

// Registrar las páginas en el router: 'correos' = bandeja, 'correos-detalle' = lectura de un mensaje
if (typeof Router !== 'undefined') {
    Router.register('correos', () => CorreosPage.show());
    Router.register('correos-detalle', (params) => CorreosPage.showDetalle(params));
}
