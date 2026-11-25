// Página: Mapa Universal — NATIVO dentro de la app móvil.
// Réplica completa de la versión web (mapa.html):
//   ✓ 4 capas base (Sat híbrido / Sat puro / Calles / OSM)
//   ✓ Cluster de clientes verde/rojo
//   ✓ NAPs cuadrados amarillos
//   ✓ Líneas cliente↔NAP al hacer zoom ≥15
//   ✓ Filtros como stats clickeables (multi-toggle solo-mode)
//   ✓ Panel de alertas (bottom sheet en móvil) con botón resolver
//   ✓ Dibujar polígono con Leaflet-Geoman (touch)
//   ✓ Modal "Declarar zona caída" → POST /api/mapa/declarar-zona-manual
//   ✓ Leyenda
//   ✓ Socket.IO live update (monitor:tick, alertas, zona manual)
//   ✓ Auto-refresh 60s + botón refresh manual
const MapaPage = (function() {
    let _mapa = null;
    let _clusterClientes = null;
    let _layerNaps = null;
    let _layerConexiones = null;
    let _layerPoligonos = null;
    let _napsIndex = new Map();
    let _datosClientes = [];
    let _datosNaps = [];
    let _datosAlertas = [];
    let _filtros = { verdes: true, rojos: true, naps: true };
    let _refrescoInterval = null;
    let _socketUnsubs = [];
    const _ZOOM_CONEXIONES = 15;

    // ───────────────────────────── helpers ─────────────────────────────
    function _getToken() {
        return localStorage.getItem(APP_CONFIG.STORAGE.TOKEN) || localStorage.getItem('token');
    }
    // 🛡️ Hardcoded fallback: si APP_CONFIG no llegó a window por algún motivo,
    // las URLs quedaban relativas y caían en el bundle local devolviendo HTML
    // (eso causaba el "Respuesta no-JSON: SolucNet Admin..."). Ahora siempre
    // sale al server público correcto.
    const _SERVER_FALLBACK = 'https://cliente.solucnet.com';
    function _api(path) {
        let base = (window.APP_CONFIG?.SERVER_URL || '').replace(/\/$/, '');
        if (!base || !/^https?:\/\//.test(base)) {
            base = _SERVER_FALLBACK;
        }
        return base + path;
    }
    async function _fetchJSON(path, options = {}) {
        const tok = _getToken();
        if (!tok) throw new Error('Sin token de sesión');
        const fullUrl = _api(path);
        _debug('→ ' + fullUrl.replace(/^https?:\/\/[^\/]+/, ''));
        let r;
        try {
            r = await fetch(fullUrl, {
                ...options,
                headers: {
                    'Authorization': 'Bearer ' + tok,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    ...(options.headers || {})
                },
                cache: 'no-store',
            });
        } catch (netErr) {
            _debug('NET FAIL: ' + String(netErr?.message || netErr).substring(0, 60));
            throw new Error('Sin conexión al servidor');
        }
        _debug('HTTP ' + r.status + ' · CT=' + (r.headers.get('content-type') || '?').substring(0, 25));
        const raw = await r.text();
        _debug('body len=' + raw.length + ' inicia="' + raw.substring(0, 30).replace(/\n/g, '↵') + '"');
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch (e) {
            const preview = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 60);
            throw new Error(`No-JSON ${r.status}: "${preview}"`);
        }
        if (!r.ok) {
            const msg = body?.message || ('HTTP ' + r.status);
            throw new Error(msg);
        }
        return body;
    }
    function _escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function _toast(msg, tipo) {
        let t = document.getElementById('toast');
        if (!t) {
            t = document.createElement('div'); t.id = 'toast'; t.className = 'toast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.className = 'toast show' + (tipo ? ' ' + tipo : '');
        setTimeout(() => t.classList.remove('show'), 3000);
    }
    // Logging silencioso a console (no panel visible). Si querés volver a ver
    // el panel amarillo de diagnóstico, restaurar este helper con el div global.
    function _debug(msg) { try { console.log('[MapaPage]', msg); } catch {} }
    // Point-in-polygon (ray casting) — para calcular preview del modal
    function _pointInPolygon(lat, lng, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const yi = polygon[i][0], xi = polygon[i][1];
            const yj = polygon[j][0], xj = polygon[j][1];
            const intersect = ((yi > lat) !== (yj > lat)) &&
                (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    // ───────────────────────────── error screens ─────────────────────────────
    function _renderPermErr(page) {
        page.innerHTML = `
            <div style="padding:40px 20px;text-align:center;color:#fff;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;">
                <i class="fas fa-ban" style="font-size:3em;color:#f87171;"></i>
                <p style="font-weight:600;font-size:1.1em;">Sin permiso</p>
                <p style="font-size:0.85em;opacity:0.85;max-width:280px;">
                    No tenés el permiso <code>ver_mapa_universal</code>.
                </p>
            </div>`;
    }
    function _renderSesionErr(page) {
        page.innerHTML = `
            <div style="padding:40px 20px;text-align:center;color:#fff;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;">
                <i class="fas fa-lock" style="font-size:3em;color:#f87171;"></i>
                <p style="font-weight:600;font-size:1.1em;">Sesión expirada</p>
                <p style="font-size:0.85em;opacity:0.85;max-width:280px;">Cerrá la app y volvé a iniciar sesión.</p>
            </div>`;
    }
    function _renderLeafletNoCargado(page) {
        page.innerHTML = `
            <div style="padding:40px 20px;text-align:center;color:#fff;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;">
                <i class="fas fa-wifi" style="font-size:3em;color:#f59e0b;"></i>
                <p style="font-weight:600;font-size:1.1em;">Sin conexión</p>
                <p style="font-size:0.85em;opacity:0.85;max-width:280px;">No se pudo cargar el motor del mapa (Leaflet). Revisá tu conexión y volvé a entrar.</p>
                <button onclick="MapaPage.show()" style="margin-top:10px;padding:10px 18px;border:none;border-radius:8px;background:#1e40af;color:#fff;font-weight:600;cursor:pointer;">
                    <i class="fas fa-sync"></i> Reintentar
                </button>
            </div>`;
    }

    // ───────────────────────────── show / init ─────────────────────────────
    function show() {
        _debug('show() llamado');
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const page = document.getElementById('page-mapa');
        if (!page) { _debug('✗ page-mapa NO existe en DOM'); return; }
        _debug('page-mapa OK');
        page.classList.add('active');

        // 🛡️ Bug viewport: el padre `.app-main` tiene `overflow-y:auto` y `.page`
        // tiene `padding: 8px 8px 110px` por defecto → el mapa quedaba con scroll
        // y se "movía hacia arriba y abajo y aparecía mocho". Le ponemos
        // position:fixed para sacarlo del flow normal del SPA y que ocupe el
        // viewport real del dispositivo (debajo del header de 56px).
        page.style.cssText = `
            display:block;padding:0;margin:0;
            position:fixed;top:56px;left:0;right:0;bottom:0;
            overflow:hidden;background:#0f172a;z-index:50;
        `;
        // Cuando el usuario navegue a otra página, resetear el styling para que
        // no quede el page-mapa cubriendo todo (position:fixed + z-index sobrevive
        // a .active=false del SPA). Listener one-shot.
        if (!window._mapaHashListener) {
            window._mapaHashListener = () => {
                const p = document.getElementById('page-mapa');
                if (p && !p.classList.contains('active')) {
                    p.style.cssText = '';
                    if (typeof MapaPage !== 'undefined' && MapaPage.hide) {
                        try { MapaPage.hide(); } catch {}
                    }
                }
            };
            window.addEventListener('hashchange', window._mapaHashListener);
        }

        const token = _getToken();
        _debug('token: ' + (token ? 'sí (' + token.substring(0, 10) + '…)' : 'NO'));
        if (!token) return _renderSesionErr(page);

        const user = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
        const rol = (user?.rol || '').toLowerCase();
        const perms = (typeof Auth !== 'undefined') ? (Auth.getPermisos() || {}) : {};
        _debug('user: ' + (user?.username || '?') + ' rol=' + rol);
        if (rol !== 'admin' && !perms.ver_mapa_universal) return _renderPermErr(page);

        if (typeof L === 'undefined' || typeof L.map !== 'function') {
            _debug('✗ Leaflet NO cargado');
            return _renderLeafletNoCargado(page);
        }
        _debug('Leaflet OK, ver. ' + (L.version || '?'));

        page.innerHTML = `
            <!-- Topbar: stats clickeables como filtros -->
            <div id="mapa-topbar" style="
                position:absolute;top:0;left:0;right:0;height:42px;z-index:1000;
                background:linear-gradient(135deg,#1e3a8a,#1e40af);
                display:flex;align-items:center;gap:6px;padding:0 8px;
                color:#fff;font-size:11px;box-shadow:0 2px 8px rgba(0,0,0,0.3);
                overflow-x:auto;white-space:nowrap;">
                <span class="mapa-stat" data-filter="total" title="Reset">
                    <i class="fas fa-users"></i> <span id="mapa-stat-total">0</span>
                </span>
                <span class="mapa-stat verde" data-filter="verdes" title="Solo online">
                    <i class="fas fa-check-circle"></i> <span id="mapa-stat-verdes">0</span>
                </span>
                <span class="mapa-stat rojo" data-filter="rojos" title="Solo caídos">
                    <i class="fas fa-times-circle"></i> <span id="mapa-stat-rojos">0</span>
                </span>
                <span class="mapa-stat nap" data-filter="naps" title="Solo NAPs">
                    <i class="fas fa-server"></i> <span id="mapa-stat-naps">0</span>
                </span>
                <span class="mapa-stat alertas" data-filter="alertas" title="Panel alertas">
                    <i class="fas fa-bell"></i> <span id="mapa-stat-alertas">0</span>
                </span>
            </div>

            <!-- Canvas del mapa -->
            <div id="mapa-canvas" style="position:absolute;top:42px;left:0;right:0;bottom:0;background:#0f172a;"></div>

            <!-- 🆕 v2026-08: Banner de sectores caídos — SIEMPRE visible cuando hay caídos (antes la
                 lista solo se veía tocando la campanita, poco descubrible). Toca para ver el detalle. -->
            <div id="mapa-alertas-banner" onclick="MapaPage._abrirPanelAlertas()" style="
                position:absolute;top:50px;left:50%;transform:translateX(-50%);z-index:1000;
                display:none;align-items:center;gap:7px;white-space:nowrap;cursor:pointer;
                background:#dc2626;color:#fff;font-size:12px;font-weight:700;padding:7px 14px;
                border-radius:20px;box-shadow:0 4px 14px rgba(220,38,38,0.55);animation:mapaAlertaPulse 1.6s infinite;">
                <i class="fas fa-exclamation-triangle"></i>
                <span id="mapa-alertas-banner-txt">0 sectores caídos</span>
                <span style="opacity:0.85;font-weight:500;">· ver</span>
            </div>

            <!-- Botones flotantes (esquina inferior derecha) — separados del borde
                 inferior para no quedar tapados por la barra de navegación Android
                 ni por gestos del sistema. -->
            <div id="mapa-controles" style="position:absolute;bottom:calc(80px + env(safe-area-inset-bottom, 0px));right:calc(14px + env(safe-area-inset-right, 0px));z-index:999;display:flex;flex-direction:column;gap:10px;">
                <button class="mapa-fab" id="mapa-btn-refresh" title="Refrescar">
                    <i class="fas fa-sync"></i>
                </button>
                <button class="mapa-fab" id="mapa-btn-dibujar" title="Dibujar zona caída">
                    <i class="fas fa-draw-polygon"></i>
                </button>
            </div>


            <!-- Leyenda (esquina inferior izquierda) — también respeta safe-area -->
            <div id="mapa-leyenda" style="
                position:absolute;bottom:calc(14px + env(safe-area-inset-bottom, 0px));left:calc(10px + env(safe-area-inset-left, 0px));z-index:999;
                background:rgba(15,23,42,0.9);color:#f1f5f9;border:1px solid #334155;
                border-radius:8px;padding:6px 8px;font-size:10px;line-height:1.4;
                box-shadow:0 4px 10px rgba(0,0,0,0.4);">
                <div class="ley-row"><span class="ley-sq verde"></span> Online</div>
                <div class="ley-row"><span class="ley-sq rojo"></span> Caído</div>
                <div class="ley-row"><span class="ley-sq nap-sq"></span> NAP</div>
                <div style="opacity:0.65;font-size:9px;border-top:1px solid #334155;padding-top:3px;margin-top:3px;">
                    Zoom para ver líneas
                </div>
            </div>

            <!-- Panel de alertas (bottom sheet, oculto por default) -->
            <div id="mapa-alertas-panel" style="
                position:absolute;bottom:0;left:0;right:0;z-index:1001;
                background:rgba(15,23,42,0.97);color:#f1f5f9;
                border-top:1px solid rgba(248,113,113,0.5);
                border-radius:16px 16px 0 0;
                padding:12px 14px 18px;
                max-height:60vh;overflow-y:auto;
                transform:translateY(100%);transition:transform 0.25s ease-out;
                box-shadow:0 -8px 24px rgba(0,0,0,0.5);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                    <h3 style="margin:0;font-size:14px;color:#fbbf24;display:flex;align-items:center;gap:6px;">
                        <i class="fas fa-exclamation-triangle"></i> Sectores caídos
                        <span id="mapa-alertas-cuenta" style="opacity:0.7;font-size:12px;">0</span>
                    </h3>
                    <button id="mapa-btn-cerrar-alertas" style="background:none;border:none;color:#fff;font-size:1.3em;cursor:pointer;">×</button>
                </div>
                <div id="mapa-alertas-lista">
                    <div style="opacity:0.5;font-size:12px;padding:8px;">Sin alertas activas.</div>
                </div>
            </div>

            <!-- Modal "Declarar zona caída" -->
            <div id="mapa-modal-zona" style="
                position:absolute;inset:0;background:rgba(0,0,0,0.7);z-index:2000;
                display:none;align-items:center;justify-content:center;">
                <div style="
                    background:#1e293b;color:#f1f5f9;border-radius:14px;padding:18px;
                    max-width:90%;width:380px;max-height:85vh;overflow-y:auto;
                    box-shadow:0 20px 60px rgba(0,0,0,0.6);">
                    <h2 style="margin:0 0 10px;font-size:16px;color:#fbbf24;">
                        <i class="fas fa-exclamation-triangle"></i> Declarar zona caída
                    </h2>
                    <p style="font-size:12px;line-height:1.5;opacity:0.85;">
                        Vas a notificar por WhatsApp a la lista de destinatarios de ONUs pendientes que esta zona está caída.
                    </p>
                    <label style="display:block;font-size:11px;color:#94a3b8;margin:10px 0 4px;">Etiqueta de la zona</label>
                    <input type="text" id="mapa-zona-etiqueta" style="
                        width:100%;padding:8px 10px;background:#0f172a;color:#f1f5f9;
                        border:1px solid #334155;border-radius:6px;box-sizing:border-box;font-size:13px;">
                    <div id="mapa-zona-resumen" style="
                        background:#0f172a;border:1px solid #334155;border-radius:6px;
                        padding:10px;margin:10px 0;font-size:12px;"></div>
                    <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">
                        <button id="mapa-zona-cancelar" style="
                            padding:8px 14px;border-radius:6px;border:none;cursor:pointer;
                            font-size:12px;font-weight:600;background:#475569;color:#fff;">Cancelar</button>
                        <button id="mapa-zona-confirmar" style="
                            padding:8px 14px;border-radius:6px;border:none;cursor:pointer;
                            font-size:12px;font-weight:600;background:#dc2626;color:#fff;">
                            <i class="fas fa-bell"></i> Declarar
                        </button>
                    </div>
                </div>
            </div>

            <style>
                .mapa-stat {
                    display:inline-flex;align-items:center;gap:4px;padding:3px 8px;
                    border-radius:6px;background:rgba(255,255,255,0.10);
                    cursor:pointer;user-select:none;
                    border:2px solid transparent;transition:all 0.15s ease;
                }
                .mapa-stat.inactivo { opacity:0.35;background:rgba(255,255,255,0.04); }
                .mapa-stat.activo-solo { border-color:rgba(255,255,255,0.55);background:rgba(255,255,255,0.20); }
                .mapa-stat.verde { color:#4ade80; }
                .mapa-stat.rojo { color:#f87171; }
                .mapa-stat.nap { color:#fbbf24; }
                .mapa-stat.alertas { color:#fca5a5;background:rgba(248,113,113,0.20); }
                .mapa-marker-cliente {
                    width:14px;height:14px;border-radius:50%;
                    border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,0.5);
                }
                .mapa-marker-cliente.verde { background:#16a34a; }
                .mapa-marker-cliente.rojo { background:#dc2626; animation:mpulse 1.5s infinite; }
                .mapa-marker-cliente.desc { background:#6b7280; }
                .mapa-marker-nap {
                    width:18px;height:18px;background:#fbbf24;border:2px solid #78350f;border-radius:3px;
                }
                @keyframes mpulse {
                    0%,100% { box-shadow:0 0 6px rgba(220,38,38,0.6); }
                    50% { box-shadow:0 0 14px rgba(220,38,38,1); }
                }
                .leaflet-popup-content { font-size:12px; line-height:1.4; margin:8px 10px; }
                .mapa-fab {
                    width:44px;height:44px;border-radius:50%;
                    background:#1e40af;color:#fff;border:none;
                    box-shadow:0 4px 10px rgba(0,0,0,0.4);
                    cursor:pointer;font-size:1em;
                    display:flex;align-items:center;justify-content:center;
                }
                .mapa-fab.activo { background:#dc2626; }
                .mapa-fab:active { transform:scale(0.95); }
                #mapa-alertas-panel.abierto { transform:translateY(0); }
                @keyframes mapaAlertaPulse { 0%,100% { box-shadow:0 4px 14px rgba(220,38,38,0.55); } 50% { box-shadow:0 4px 22px rgba(220,38,38,0.95); } }
                .ley-row { display:flex;align-items:center;gap:5px;padding:1px 0; }
                .ley-sq { width:10px;height:10px;border-radius:50%; }
                .ley-sq.verde { background:#16a34a; }
                .ley-sq.rojo { background:#dc2626; }
                .ley-sq.nap-sq { background:#fbbf24;border-radius:2px; }
                .alerta-item {
                    background:rgba(248,113,113,0.10);
                    border-left:3px solid #f87171;
                    padding:8px 10px;margin:6px 0;border-radius:6px;
                }
                .alerta-item .titulo { font-weight:600;color:#fca5a5;font-size:13px; }
                .alerta-item .meta { font-size:11px;opacity:0.85;margin-top:3px;line-height:1.4; }
                .alerta-item button {
                    margin-top:6px;background:#475569;color:#fff;border:none;
                    padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;
                }
            </style>
        `;

        // ───── Inicializar Leaflet con 4 capas base ─────
        try {
            _mapa = L.map('mapa-canvas', { zoomControl: true, preferCanvas: true }).setView([7.79, -76.65], 13);

            const googleSatHib = L.tileLayer(
                'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
                { subdomains: ['0','1','2','3'], maxZoom: 21, attribution: '&copy; Google' }
            );
            const googleSatPuro = L.tileLayer(
                'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
                { subdomains: ['0','1','2','3'], maxZoom: 21, attribution: '&copy; Google' }
            );
            const googleCalles = L.tileLayer(
                'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
                { subdomains: ['0','1','2','3'], maxZoom: 21, attribution: '&copy; Google' }
            );
            const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                { maxZoom: 19, attribution: '&copy; OpenStreetMap' });
            googleSatHib.addTo(_mapa);
            L.control.layers({
                '🛰️ Satélite + Calles (Google)': googleSatHib,
                '🛰️ Satélite puro (Google)': googleSatPuro,
                '🗺️ Calles (Google)': googleCalles,
                '🌍 OpenStreetMap': osm,
            }, null, { position: 'topright', collapsed: true }).addTo(_mapa);

            // 🛡️ z-order: NAPs DEBAJO de clientes (sino el cuadrito amarillo
            // tapaba al cliente al estar ambos en el mismo punto). Uso un pane
            // custom con zIndex menor que markerPane (600).
            try {
                _mapa.createPane('napsPane');
                _mapa.getPane('napsPane').style.zIndex = 580;
            } catch (e) { _debug('pane fail: ' + (e?.message||e).substring(0,30)); }

            // Cluster + layer NAPs + conexiones + polígonos
            _clusterClientes = L.markerClusterGroup ?
                L.markerClusterGroup({ maxClusterRadius: 50, showCoverageOnHover: false, chunkedLoading: true }) :
                L.layerGroup();
            _mapa.addLayer(_clusterClientes);
            _layerNaps = L.layerGroup().addTo(_mapa);
            _layerConexiones = L.layerGroup().addTo(_mapa);
            _layerPoligonos = L.layerGroup().addTo(_mapa);

            // Re-render conexiones al desplazar/zoom (perf en móvil)
            _mapa.on('zoomend moveend', () => _renderConexiones());

            // 🛡️ Crítico en SPA: el contenedor puede tener altura 0 cuando Leaflet
            // hace init si el page-mapa estaba oculto antes. invalidateSize() lo
            // fuerza a recalcular tras unos ticks de layout.
            setTimeout(() => { try { _mapa.invalidateSize(); } catch {} }, 100);
            setTimeout(() => { try { _mapa.invalidateSize(); } catch {} }, 500);

            // Geoman: polígono touch-friendly (si está cargado)
            if (_mapa.pm && _mapa.pm.setLang) {
                _mapa.pm.setLang('es');
                _mapa.on('pm:create', e => {
                    const layer = e.layer;
                    const latlngs = layer.getLatLngs()[0] || layer.getLatLngs();
                    const puntos = (Array.isArray(latlngs[0]) ? latlngs[0] : latlngs).map(p => [p.lat, p.lng]);
                    if (puntos.length < 3) { _toast('Polígono inválido', 'error'); _mapa.removeLayer(layer); return; }
                    _abrirModalZona(puntos, layer);
                });
            }
        } catch (e) {
            console.error('[MapaPage] Leaflet init falló:', e);
            _renderLeafletNoCargado(page);
            return;
        }

        // ───── Hooks UI ─────
        document.querySelectorAll('.mapa-stat').forEach(el => {
            el.addEventListener('click', () => _onStatClick(el.dataset.filter));
        });
        document.getElementById('mapa-btn-refresh').addEventListener('click', () => {
            _toast('Actualizando…');
            _cargarTodo();
        });
        document.getElementById('mapa-btn-dibujar').addEventListener('click', () => {
            if (!_mapa.pm || !_mapa.pm.enableDraw) {
                _toast('Plugin de dibujo no disponible', 'error');
                return;
            }
            _mapa.pm.enableDraw('Polygon');
            _toast('Tocá los vértices, doble-tap para cerrar', 'warn');
        });
        document.getElementById('mapa-btn-cerrar-alertas').addEventListener('click', _togglePanelAlertas);
        document.getElementById('mapa-zona-cancelar').addEventListener('click', () => {
            document.getElementById('mapa-modal-zona').style.display = 'none';
            if (window._mapaPoligonoTemp) {
                try { _mapa.removeLayer(window._mapaPoligonoTemp); } catch {}
                window._mapaPoligonoTemp = null;
            }
        });

        // ───── Carga inicial + Socket.IO + auto-refresh 60s ─────
        _cargarTodo();
        if (_refrescoInterval) clearInterval(_refrescoInterval);
        _refrescoInterval = setInterval(() => {
            const p = document.getElementById('page-mapa');
            if (p && p.classList.contains('active')) {
                _cargarClientes().catch(() => {});
                _cargarAlertas().catch(() => {});
            }
        }, 60000);

        // Socket.IO live updates
        _conectarSocket();

        _aplicarFiltrosUI();
    }

    // ───────────────────────────── Filtros ─────────────────────────────
    function _activosCount() {
        return ['verdes','rojos','naps'].filter(k => _filtros[k]).length;
    }
    function _onStatClick(filter) {
        if (filter === 'total') {
            _filtros = { verdes: true, rojos: true, naps: true };
        } else if (filter === 'alertas') {
            _togglePanelAlertas();
            return;
        } else if (filter === 'verdes' || filter === 'rojos' || filter === 'naps') {
            const cuantos = _activosCount();
            if (_filtros[filter] && cuantos > 1) {
                _filtros.verdes = _filtros.rojos = _filtros.naps = false;
                _filtros[filter] = true;
            } else if (_filtros[filter] && cuantos === 1) {
                _filtros.verdes = _filtros.rojos = _filtros.naps = true;
            } else {
                _filtros[filter] = true;
            }
        }
        _aplicarFiltrosUI();
    }
    function _aplicarFiltrosUI() {
        _renderClientes();
        _renderNaps();
        const soloUno = _activosCount() === 1;
        for (const [clave, statFilter] of [['verdes','verdes'],['rojos','rojos'],['naps','naps']]) {
            const el = document.querySelector(`.mapa-stat[data-filter="${statFilter}"]`);
            if (!el) continue;
            el.classList.toggle('inactivo', !_filtros[clave]);
            el.classList.toggle('activo-solo', _filtros[clave] && soloUno);
        }
        const todos = _filtros.verdes && _filtros.rojos && _filtros.naps;
        const total = document.querySelector('.mapa-stat[data-filter="total"]');
        if (total) total.classList.toggle('activo-solo', todos);
    }
    function _togglePanelAlertas() {
        const p = document.getElementById('mapa-alertas-panel');
        if (!p) return;
        p.classList.toggle('abierto');
    }
    // 🆕 v2026-08: abre el panel de alertas (desde el banner rojo). Si ya está abierto, no hace nada.
    function _abrirPanelAlertas() {
        const p = document.getElementById('mapa-alertas-panel');
        if (p && !p.classList.contains('abierto')) p.classList.add('abierto');
    }

    // ───────────────────────────── Carga datos ─────────────────────────────
    async function _cargarTodo() {
        const tok = _getToken();
        _debug(`token=${tok ? tok.substring(0,12)+'…' : 'NULL'}`);
        _debug(`server=${(window.APP_CONFIG?.SERVER_URL || 'NULL').replace(/^https?:\/\//,'')}`);
        try {
            await Promise.all([_cargarClientes(), _cargarNaps(), _cargarAlertas()]);
            _debug(`✓ ${_datosClientes.length}c ${_datosNaps.length}n ${_datosAlertas.length}a`);
            // Forzar invalidateSize después de renderizar — algunos WebViews
            // necesitan ese empujón final para reposicionar markers.
            setTimeout(() => { try { _mapa.invalidateSize(); } catch {} }, 200);
        } catch (e) {
            _debug(`✗ err: ${(e?.message||e).substring(0,40)}`);
        }
    }
    async function _cargarClientes() {
        try {
            _debug('GET /clientes…');
            const d = await _fetchJSON('/api/mapa/clientes');
            if (!d.success) throw new Error(d.message || 'sin success');
            _datosClientes = d.clientes || [];
            _debug(`clientes resp: ${_datosClientes.length}`);
            _renderClientes();
            _actualizarStats();
            return _datosClientes;
        } catch (e) {
            _debug(`✗ /clientes: ${(e?.message||e).substring(0,40)}`);
            throw e;
        }
    }
    async function _cargarNaps() {
        try {
            _debug('GET /naps…');
            const d = await _fetchJSON('/api/mapa/naps');
            if (!d.success) throw new Error(d.message || 'sin success');
            _datosNaps = d.naps || [];
            _debug(`naps resp: ${_datosNaps.length}`);
            _napsIndex.clear();
            for (const n of _datosNaps) {
                if (n.lat != null && n.lng != null) _napsIndex.set(`${n.bd}:${n.id}`, n);
            }
            _renderNaps();
            _renderConexiones();
            const el = document.getElementById('mapa-stat-naps');
            if (el) el.textContent = _datosNaps.length;
            return _datosNaps;
        } catch (e) {
            _debug(`✗ /naps: ${(e?.message||e).substring(0,40)}`);
            throw e;
        }
    }
    async function _cargarAlertas() {
        try {
            const d = await _fetchJSON('/api/mapa/sectores-alertados');
            if (!d.success) throw new Error(d.message || 'sin datos');
            _datosAlertas = d.alertas || [];
            _renderAlertas();
            return _datosAlertas;
        } catch (e) { console.error('[MapaPage] cargarAlertas:', e); }
    }

    // ───────────────────────────── Render ─────────────────────────────
    function _renderClientes() {
        if (!_clusterClientes) return;
        _clusterClientes.clearLayers();
        for (const c of _datosClientes) {
            if (c.lat == null || c.lng == null) continue;
            const estado = c.estado || 'desconocido';
            if (estado === 'verde' && !_filtros.verdes) continue;
            if (estado === 'rojo' && !_filtros.rojos) continue;
            const cls = estado === 'verde' ? 'verde' : estado === 'rojo' ? 'rojo' : 'desc';
            const icon = L.divIcon({
                className: '',
                html: `<div class="mapa-marker-cliente ${cls}"></div>`,
                iconSize: [14, 14], iconAnchor: [7, 7]
            });
            const m = L.marker([parseFloat(c.lat), parseFloat(c.lng)], { icon });
            const estTxt = estado === 'verde' ? '🟢 Online' : estado === 'rojo' ? '🔴 Caído' : '⚪ Sin datos';
            const ultimo = c.ultimo_check ? new Date(c.ultimo_check).toLocaleString('es-CO') : '—';
            m.bindPopup(`
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;">
                    <div style="font-weight:700;color:#1e3a8a;">${_escapeHtml(c.nombre || 'Sin nombre')}</div>
                    <span style="background:#1e40af;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:600;">ID ${c.idcliente || c.idservicio}</span>
                </div>
                <div>${estTxt}</div>
                <div>📞 ${_escapeHtml(c.telefono || '—')}</div>
                <div>🌐 ${_escapeHtml(c.ip || '—')}</div>
                <div>📡 BD: ${_escapeHtml(c.bd || '—')} · NAP #${c.idnap || '—'}</div>
                <div style="font-size:10px;color:#64748b;margin-top:3px;">
                    Servicio ID: <strong>${c.idservicio}</strong> · Cliente ID: <strong>${c.idcliente || '—'}</strong>
                </div>
                <div style="font-size:10px;color:#64748b;">Últ. check: ${ultimo}</div>
                <div style="font-size:10px;color:#64748b;">Fallos consecutivos: ${c.fallos_consecutivos ?? 0}</div>
            `);
            _clusterClientes.addLayer(m);
        }
        _renderConexiones();
    }
    function _renderNaps() {
        if (!_layerNaps) return;
        _layerNaps.clearLayers();
        if (!_filtros.naps) return;
        for (const n of _datosNaps) {
            const icon = L.divIcon({
                className: '', html: '<div class="mapa-marker-nap"></div>',
                iconSize: [18, 18], iconAnchor: [9, 9]
            });
            // pane: 'napsPane' (zIndex 580) garantiza que la caja NAP queda DEBAJO
            // del cliente cuando están en la misma coordenada/cerca.
            const m = L.marker([n.lat, n.lng], { icon, pane: 'napsPane' });
            m.bindPopup(`
                <div style="font-weight:700;color:#1e3a8a;">NAP #${n.id} (${_escapeHtml(n.bd || '')})</div>
                <div>${_escapeHtml(n.descripcion || '—')}</div>
                <div>Puertos: ${n.puertos || '—'}</div>
                <div>${_escapeHtml(n.ubicacion || '')}</div>
            `);
            _layerNaps.addLayer(m);
        }
    }
    function _renderConexiones() {
        if (!_layerConexiones || !_mapa) return;
        _layerConexiones.clearLayers();
        if (_mapa.getZoom() < _ZOOM_CONEXIONES) return;
        if (_napsIndex.size === 0) return;
        const bounds = _mapa.getBounds();
        for (const c of _datosClientes) {
            if (c.lat == null || c.lng == null || !c.idnap) continue;
            const estado = c.estado || 'desconocido';
            if (estado === 'verde' && !_filtros.verdes) continue;
            if (estado === 'rojo' && !_filtros.rojos) continue;
            const nap = _napsIndex.get(`${c.bd}:${c.idnap}`);
            if (!nap) continue;
            const lat = parseFloat(c.lat), lng = parseFloat(c.lng);
            if (!bounds.contains([lat, lng]) && !bounds.contains([nap.lat, nap.lng])) continue;
            const color = estado === 'rojo' ? '#f87171' : estado === 'verde' ? '#4ade80' : '#94a3b8';
            const line = L.polyline([[lat, lng], [nap.lat, nap.lng]], {
                color, weight: 1.5, opacity: 0.65, dashArray: '4,4', interactive: false,
            });
            _layerConexiones.addLayer(line);
        }
    }
    function _renderAlertas() {
        const lista = document.getElementById('mapa-alertas-lista');
        const cuenta = document.getElementById('mapa-alertas-cuenta');
        const stat = document.getElementById('mapa-stat-alertas');
        if (cuenta) cuenta.textContent = _datosAlertas.length;
        if (stat) stat.textContent = _datosAlertas.length;
        // 🆕 v2026-08: banner rojo siempre visible cuando hay sectores caídos (descubrible sin tocar la campana)
        const banner = document.getElementById('mapa-alertas-banner');
        const bannerTxt = document.getElementById('mapa-alertas-banner-txt');
        if (banner) {
            if (_datosAlertas.length > 0) {
                banner.style.display = 'inline-flex';
                if (bannerTxt) bannerTxt.textContent = _datosAlertas.length === 1 ? '1 sector caído' : `${_datosAlertas.length} sectores caídos`;
            } else {
                banner.style.display = 'none';
            }
        }
        if (!lista) return;
        if (!_datosAlertas.length) {
            lista.innerHTML = '<div style="opacity:0.5;font-size:12px;padding:8px;">Sin alertas activas.</div>';
            return;
        }
        lista.innerHTML = _datosAlertas.map(a => `
            <div class="alerta-item">
                <div class="titulo">${_escapeHtml(a.etiqueta || a.identificador)}</div>
                <div class="meta">
                    ${a.clientes_caidos}/${a.clientes_total} caídos (${a.porcentaje}%)<br>
                    Zona: ${_escapeHtml(a.zona_dominante || '—')} · ${a.tipo}<br>
                    ${new Date(a.detectado_at).toLocaleString('es-CO')}
                </div>
                <button onclick="MapaPage.cerrarAlerta(${a.id})">
                    <i class="fas fa-check"></i> Marcar resuelta
                </button>
            </div>
        `).join('');
    }
    function _actualizarStats() {
        let verdes = 0, rojos = 0;
        for (const c of _datosClientes) {
            if (c.estado === 'verde') verdes++;
            else if (c.estado === 'rojo') rojos++;
        }
        const setText = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        setText('mapa-stat-total', _datosClientes.length);
        setText('mapa-stat-verdes', verdes);
        setText('mapa-stat-rojos', rojos);
    }

    // ───────────────────────────── Acciones ─────────────────────────────
    async function cerrarAlerta(id) {
        if (!confirm('¿Marcar esta alerta como resuelta?')) return;
        try {
            await _fetchJSON('/api/mapa/cerrar-alerta/' + id, { method: 'POST' });
            _toast('Alerta cerrada');
            _cargarAlertas();
        } catch (e) { _toast('Error: ' + e.message, 'error'); }
    }
    function _abrirModalZona(puntos, layer) {
        window._mapaPoligonoTemp = layer;
        const dentro = _datosClientes.filter(c =>
            c.lat != null && c.lng != null &&
            _pointInPolygon(parseFloat(c.lat), parseFloat(c.lng), puntos)
        );
        const caidos = dentro.filter(c => c.estado === 'rojo').length;
        const tels = new Set(dentro.map(c => (c.telefono || '').replace(/\D/g, '')).filter(t => t.length >= 10));
        const resumenDiv = document.getElementById('mapa-zona-resumen');
        if (resumenDiv) resumenDiv.innerHTML = `
            <div style="display:flex;justify-content:space-between;padding:2px 0;"><span style="color:#94a3b8;">Clientes en zona</span><strong>${dentro.length}</strong></div>
            <div style="display:flex;justify-content:space-between;padding:2px 0;"><span style="color:#94a3b8;">Caídos ahora</span><strong style="color:#f87171;">${caidos}</strong></div>
            <div style="display:flex;justify-content:space-between;padding:2px 0;"><span style="color:#94a3b8;">Teléfonos únicos</span><strong>${tels.size}</strong></div>
            <div style="display:flex;justify-content:space-between;padding:2px 0;"><span style="color:#94a3b8;">Vértices polígono</span><strong>${puntos.length}</strong></div>
        `;
        const etiqueta = document.getElementById('mapa-zona-etiqueta');
        if (etiqueta) etiqueta.value = `Zona manual ${new Date().toLocaleString('es-CO').replace(',', '')}`;
        const modal = document.getElementById('mapa-modal-zona');
        modal.style.display = 'flex';

        const btnConfirmar = document.getElementById('mapa-zona-confirmar');
        const handler = async () => {
            btnConfirmar.disabled = true; btnConfirmar.textContent = 'Enviando…';
            try {
                const d = await _fetchJSON('/api/mapa/declarar-zona-manual', {
                    method: 'POST',
                    body: JSON.stringify({ etiqueta: etiqueta.value.trim(), poligono: puntos })
                });
                if (!d.success) throw new Error(d.message || 'error');
                _toast(`Zona declarada — ${d.destinatarios_notificados} notificaciones`);
                modal.style.display = 'none';
                if (layer) layer.setStyle({ color: '#dc2626', fillColor: '#dc2626', fillOpacity: 0.2, weight: 2 });
                window._mapaPoligonoTemp = null;
                _cargarAlertas();
            } catch (e) { _toast('Error: ' + e.message, 'error'); }
            finally {
                btnConfirmar.disabled = false; btnConfirmar.innerHTML = '<i class="fas fa-bell"></i> Declarar';
                btnConfirmar.removeEventListener('click', handler);
            }
        };
        btnConfirmar.addEventListener('click', handler, { once: true });
    }

    // ───────────────────────────── Socket.IO ─────────────────────────────
    function _conectarSocket() {
        if (typeof SocketBus === 'undefined') return;
        // Asegurar conexión
        try { if (SocketBus.connect) SocketBus.connect(); } catch {}
        _socketUnsubs.push(SocketBus.on('monitor:tick', () => { _cargarClientes().catch(() => {}); }));
        _socketUnsubs.push(SocketBus.on('monitor:zona_manual_declarada', () => { _cargarAlertas().catch(() => {}); }));
        _socketUnsubs.push(SocketBus.on('monitor:alerta_cerrada', () => { _cargarAlertas().catch(() => {}); }));
    }

    // ───────────────────────────── hide / cleanup ─────────────────────────────
    function hide() {
        if (_refrescoInterval) { clearInterval(_refrescoInterval); _refrescoInterval = null; }
        _socketUnsubs.forEach(u => { try { u(); } catch {} });
        _socketUnsubs = [];
        if (_mapa) { try { _mapa.remove(); } catch {} _mapa = null; _clusterClientes = null; _layerNaps = null; _layerConexiones = null; _layerPoligonos = null; }
    }

    return { show, hide, cerrarAlerta, _abrirPanelAlertas };
})();

if (typeof Router !== 'undefined' && Router.register) {
    Router.register('mapa', () => MapaPage.show());
    console.log('[MapaPage] registrado en Router (versión nativa completa)');
}
