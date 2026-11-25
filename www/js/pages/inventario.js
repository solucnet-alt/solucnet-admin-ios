// 🆕 Página: Inventario (stock, movimientos)
const InventarioPage = (function() {
    let activeTab = 'stock';
    let materiales = [];
    let movimientos = [];
    let retirados = [];
    let diarioOnus = [];
    let stats = {};
    let searchTerm = '';
    let categoriaFiltro = '';
    let movFiltroMaterial = '';
    let movFiltroTipo = '';
    let movFiltroDesde = '';
    // 🛡️ v2026-06-10: búsqueda en vivo para movimientos/retirados/diario ONUs
    let movSearchTerm = '';
    let retSearchTerm = '';
    let diarioSearchTerm = '';

    // Normaliza texto: lowercase + sin tildes — para búsqueda case-insensitive
    function _norm(s) {
        return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    // 🛡️ v1.0.91 (2026-06-04): Las categorías y unidades DEBEN coincidir con los ENUM de la BD.
    // Antes mandábamos "ONU", "Cable", "u." etc. y MySQL rechazaba con "Data truncated".
    // Estructura: { value: <ENUM exacto>, label: <texto bonito> }.
    const CATEGORIAS = [
        { value: 'onu', label: 'ONU' },
        { value: 'tvbox', label: 'TV Box' },
        { value: 'cable', label: 'Cable' },
        { value: 'conector_verde', label: 'Conector verde' },
        { value: 'conector_azul', label: 'Conector azul' },
        { value: 'conector', label: 'Conector (otro)' },
        { value: 'herramienta', label: 'Herramienta' },
        { value: 'accesorio', label: 'Accesorio' },
        { value: 'otro', label: 'Otro' },
    ];
    const UNIDADES = [
        { value: 'unidades', label: 'Unidades' },
        { value: 'metros', label: 'Metros' },
        { value: 'rollos', label: 'Rollos' },
        { value: 'cajas', label: 'Cajas' },
        { value: 'pares', label: 'Pares' },
    ];

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    }

    function fmtFecha(ts) {
        if (!ts) return '—';
        try { return new Date(ts).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
        catch { return '—'; }
    }

    function renderMaterial(m) {
        const stockBajo = m.stock_actual <= (m.stock_minimo || 0) && (m.stock_minimo > 0);
        const color = stockBajo ? '#dc3545' : '#16a34a';
        return `
            <div data-id="${m.id}" class="material-card" style="background:white; border-radius:12px; padding:12px; margin-bottom:6px; box-shadow:0 1px 2px rgba(0,0,0,0.04); border-left:3px solid ${color}; cursor:pointer;">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:0.92em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${escapeHtml(m.nombre)}
                        </div>
                        <div style="font-size:0.75em; color:#999; margin-top:2px;">
                            ${m.codigo ? `<code style="background:#f5f6f7; padding:1px 5px; border-radius:3px;">${escapeHtml(m.codigo)}</code> · ` : ''}${escapeHtml(m.categoria || '—')}
                        </div>
                        ${m.descripcion ? `<div style="font-size:0.78em; color:#666; margin-top:3px;">${escapeHtml(m.descripcion)}</div>` : ''}
                    </div>
                    <div style="text-align:right; flex-shrink:0;">
                        <div style="font-size:1.2em; font-weight:700; color:${color};">${m.stock_actual || 0}</div>
                        <div style="font-size:0.7em; color:#999;">${escapeHtml(m.unidad_medida || 'u.')}</div>
                        ${stockBajo ? '<div style="font-size:0.68em; color:#dc3545; font-weight:600; margin-top:1px;">⚠️ Bajo</div>' : ''}
                    </div>
                </div>
            </div>
        `;
    }

    function renderMovimiento(m) {
        const esEntrada = m.tipo_movimiento === 'entrada';
        const color = esEntrada ? '#16a34a' : '#dc3545';
        return `
            <div style="background:white; border-radius:12px; padding:12px; margin-bottom:6px; box-shadow:0 1px 2px rgba(0,0,0,0.04); border-left:3px solid ${color};">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:0.9em;">${escapeHtml(m.material_nombre || '—')}</div>
                        <div style="font-size:0.75em; color:#999; margin-top:2px;">${escapeHtml(m.material_codigo || '')} · ${fmtFecha(m.fecha_movimiento)}</div>
                        ${m.observacion ? `<div style="font-size:0.78em; color:#666; margin-top:3px;">${escapeHtml(m.observacion)}</div>` : ''}
                        ${m.visita_id ? `<div style="font-size:0.72em; color:#0066cc; margin-top:2px;">Visita #${m.visita_id}</div>` : ''}
                    </div>
                    <div style="text-align:right; flex-shrink:0;">
                        <div style="font-size:1.05em; font-weight:700; color:${color};">${esEntrada ? '+' : '-'}${m.cantidad}</div>
                        <div style="font-size:0.68em; color:#999;">${m.stock_anterior} → ${m.stock_posterior}</div>
                    </div>
                </div>
            </div>
        `;
    }

    function applyFiltros(lista) {
        let result = lista;
        if (categoriaFiltro) result = result.filter(m => m.categoria === categoriaFiltro);
        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            result = result.filter(m =>
                (m.nombre || '').toLowerCase().includes(q) ||
                (m.codigo || '').toLowerCase().includes(q) ||
                (m.descripcion || '').toLowerCase().includes(q)
            );
        }
        return result;
    }

    function renderStock() {
        const lista = applyFiltros(materiales);
        const c = document.getElementById('inv-list-container');
        if (!c) return;
        document.getElementById('inv-count').textContent = `${lista.length} de ${materiales.length}`;
        if (!lista.length) {
            c.innerHTML = `<div class="empty-state"><i class="fas fa-box"></i><p>Sin materiales</p></div>`;
            return;
        }

        // 🆕 Separar equipos seriales (ONU / TV Box) del resto — cada uno ítem independiente
        const SERIALES = [
            { cat: 'onu',   label: 'ONUs en Bodega',   icon: 'fa-wifi', grad: 'linear-gradient(135deg,#0066cc,#0052a3)' },
            { cat: 'tvbox', label: 'TV Box en Bodega', icon: 'fa-tv',   grad: 'linear-gradient(135deg,#4f46e5,#3730a3)' }
        ];
        const esSerial = (m) => SERIALES.some(s => s.cat === (m.categoria || '').toLowerCase());
        const otros = lista.filter(m => !esSerial(m))
            .sort((a, b) => {
                const ca = (a.categoria || '').toLowerCase();
                const cb = (b.categoria || '').toLowerCase();
                if (ca !== cb) return ca.localeCompare(cb);
                return (a.nombre || '').localeCompare(b.nombre || '');
            });

        const hint = `<div style="font-size:0.72em; color:#999; text-align:center; padding:4px 0 6px;"><i class="fas fa-info-circle"></i> Tap: ajustar stock · Mantén pulsado: editar material</div>`;

        let serialResumen = '';
        SERIALES.forEach(sc => {
            const items = lista.filter(m => (m.categoria || '').toLowerCase() === sc.cat);
            if (items.length === 0) return;
            const totalStock = items.reduce((s, o) => s + (parseFloat(o.stock_actual) || 0), 0);
            serialResumen += `
                <div onclick="InventarioPage.verDetalleOnus('${sc.cat}')" style="background:${sc.grad}; color:white; border-radius:12px; padding:14px; margin-bottom:8px; cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,0.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="font-weight:700; font-size:1.05em;"><i class="fas ${sc.icon}"></i> ${sc.label}</div>
                            <div style="font-size:0.78em; opacity:0.95; margin-top:2px;">${items.length} seriales registrados · tap para ver detalle</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:1.6em; font-weight:800;">${totalStock}</div>
                            <div style="font-size:0.7em; opacity:0.9;">unidades</div>
                        </div>
                    </div>
                </div>
            `;
        });

        c.innerHTML = hint + serialResumen + otros.map(renderMaterial).join('');
        c.querySelectorAll('.material-card').forEach(el => {
            const id = parseInt(el.dataset.id);
            const m = materiales.find(x => x.id === id);
            if (!m) return;
            el.addEventListener('click', () => openAjusteStock(m));
            let pressTimer;
            const start = () => { pressTimer = setTimeout(() => { el._lp = true; openMaterialEditor(m); }, 550); };
            const end = (e) => { clearTimeout(pressTimer); if (el._lp) { e?.preventDefault?.(); e?.stopPropagation?.(); el._lp = false; } };
            el.addEventListener('touchstart', start, { passive: true });
            el.addEventListener('touchend', end);
            el.addEventListener('mousedown', start);
            el.addEventListener('mouseup', end);
            el.addEventListener('mouseleave', () => clearTimeout(pressTimer));
            el.addEventListener('click', (e) => { if (el._lp) { e.preventDefault(); e.stopPropagation(); el._lp = false; } }, true);
        });
    }

    function verDetalleOnus(categoria = 'onu') {
        const esTv = (categoria || 'onu').toLowerCase() === 'tvbox';
        const etiqueta = esTv ? 'TV Box' : 'ONUs';
        const iconoDet = esTv ? 'fa-tv' : 'fa-wifi';
        const gradDet = esTv ? 'linear-gradient(135deg,#4f46e5,#3730a3)' : 'linear-gradient(135deg,#0066cc,#0052a3)';
        const onus = materiales.filter(m => (m.categoria || '').toLowerCase() === (categoria || 'onu').toLowerCase())
            .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const total = onus.reduce((s, o) => s + (parseFloat(o.stock_actual) || 0), 0);
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:92vh;">
                <div class="modal-header" style="background:${gradDet};"><h3><i class="fas ${iconoDet}"></i> ${etiqueta} en Bodega (${total})</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <input type="text" id="onu-search" placeholder="🔍 Buscar serial o nombre…" style="width:100%; padding:9px; border:1px solid #ddd; border-radius:8px; margin-bottom:10px; font-size:0.9em; box-sizing:border-box;">
                    <div id="onu-list">${onus.length ? onus.map(o => `
                        <div data-id="${o.id}" class="onu-row" style="background:white; padding:10px; border-radius:8px; margin-bottom:5px; border-left:3px solid #16a34a; cursor:pointer;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <div style="flex:1; min-width:0;">
                                    <div style="font-weight:600; font-family:monospace; font-size:0.88em; color:#0066cc;">${escapeHtml(o.codigo || o.nombre || '?')}</div>
                                    <div style="font-size:0.78em; color:#666; margin-top:2px;">${escapeHtml(o.nombre || '')}</div>
                                </div>
                                <div style="text-align:right;">
                                    <div style="font-weight:700; font-size:1.05em;">${o.stock_actual || 0}</div>
                                </div>
                            </div>
                        </div>
                    `).join('') : `<div class="empty-state"><p>Sin ${etiqueta} registradas</p></div>`}</div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cerrar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.querySelector('#onu-search').addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase().trim();
            overlay.querySelectorAll('.onu-row').forEach(row => {
                row.style.display = (!q || row.textContent.toLowerCase().includes(q)) ? '' : 'none';
            });
        });
        // Tap en una ONU → ajustar stock
        overlay.querySelectorAll('.onu-row').forEach(row => {
            row.addEventListener('click', () => {
                const id = parseInt(row.dataset.id);
                const m = materiales.find(x => x.id === id);
                if (m) { overlay.remove(); openAjusteStock(m); }
            });
        });
    }

    function renderMovimientos() {
        const c = document.getElementById('inv-list-container');
        if (!c) return;
        const qn = _norm(movSearchTerm);
        const filtrados = movimientos.filter(m => {
            if (movFiltroTipo && m.tipo_movimiento !== movFiltroTipo) return false;
            if (movFiltroMaterial && !(m.material_nombre || '').toLowerCase().includes(movFiltroMaterial.toLowerCase()) && !(m.material_codigo || '').toLowerCase().includes(movFiltroMaterial.toLowerCase())) return false;
            if (movFiltroDesde) {
                const ts = new Date(m.fecha_movimiento).getTime();
                if (ts < new Date(movFiltroDesde).getTime()) return false;
            }
            // 🆕 búsqueda global en vivo (case-insensitive + sin tildes)
            if (qn) {
                const blob = _norm([m.material_nombre, m.material_codigo, m.tipo_movimiento, m.observacion, m.tecnico_nombre, m.visita_id, m.fecha_movimiento].join(' '));
                if (!blob.includes(qn)) return false;
            }
            return true;
        });
        document.getElementById('inv-count').textContent = `${filtrados.length} de ${movimientos.length} movimientos`;
        const filtros = `
            <div style="background:white; padding:8px; border-radius:8px; margin-bottom:6px; display:grid; grid-template-columns:1fr 1fr; gap:6px;">
                <input type="search" placeholder="🔍 Buscar (material, técnico, observación…)" value="${escapeHtml(movSearchTerm)}" id="mov-f-search" style="grid-column:1 / -1; padding:8px; border:1px solid #ddd; border-radius:6px; font-size:0.85em;">
                <input type="text" placeholder="Material específico…" value="${escapeHtml(movFiltroMaterial)}" id="mov-f-mat" style="padding:8px; border:1px solid #ddd; border-radius:6px; font-size:0.85em;">
                <select id="mov-f-tipo" style="padding:8px; border:1px solid #ddd; border-radius:6px; font-size:0.85em;">
                    <option value="">Todos los tipos</option>
                    <option value="entrada" ${movFiltroTipo==='entrada'?'selected':''}>Entrada</option>
                    <option value="salida" ${movFiltroTipo==='salida'?'selected':''}>Salida</option>
                    <option value="ajuste" ${movFiltroTipo==='ajuste'?'selected':''}>Ajuste</option>
                </select>
                <input type="date" id="mov-f-desde" value="${movFiltroDesde}" style="grid-column:1 / -1; padding:8px; border:1px solid #ddd; border-radius:6px; font-size:0.85em;">
            </div>
        `;
        if (!filtrados.length) {
            c.innerHTML = filtros + `<div class="empty-state"><i class="fas fa-exchange-alt"></i><p>Sin movimientos${movSearchTerm||movFiltroMaterial||movFiltroTipo||movFiltroDesde ? ' con esos filtros' : ''}</p></div>`;
        } else {
            c.innerHTML = filtros + filtrados.map(renderMovimiento).join('');
        }
        // 🆕 search-on-type: re-renderiza preservando foco/cursor
        const searchEl = document.getElementById('mov-f-search');
        if (searchEl) {
            searchEl.addEventListener('input', e => {
                movSearchTerm = e.target.value;
                renderMovimientos();
                const refoc = document.getElementById('mov-f-search');
                if (refoc) { refoc.focus(); refoc.setSelectionRange(refoc.value.length, refoc.value.length); }
            });
        }
        document.getElementById('mov-f-mat').addEventListener('input', e => { movFiltroMaterial = e.target.value; renderMovimientos(); });
        document.getElementById('mov-f-tipo').addEventListener('change', e => { movFiltroTipo = e.target.value; renderMovimientos(); });
        document.getElementById('mov-f-desde').addEventListener('change', e => { movFiltroDesde = e.target.value; renderMovimientos(); });
    }

    function renderTab() {
        if (activeTab === 'stock') renderStock();
        else if (activeTab === 'movimientos') renderMovimientos();
        else if (activeTab === 'retirados') renderRetirados();
        else if (activeTab === 'diario') renderDiarioOnus();
    }

    function renderDiarioOnus() {
        const c = document.getElementById('inv-list-container');
        if (!c) return;
        // 🆕 v2026-06-10: filtro en vivo (técnico, fecha, detalle de seriales…)
        const qn = _norm(diarioSearchTerm);
        const filtrados = !qn ? diarioOnus : diarioOnus.filter(d => {
            const blob = _norm([
                d.tecnico_nombre, d.fecha, d.fecha_registro,
                d.total_onus, d.cantidad, d.detalle_seriales
            ].filter(v => v !== undefined && v !== null).join(' '));
            return blob.includes(qn);
        });
        document.getElementById('inv-count').textContent = qn
            ? `${filtrados.length} de ${diarioOnus.length} (filtrado)`
            : `${diarioOnus.length} registros diarios`;
        const searchBar = `
            <div style="background:white; padding:8px; border-radius:8px; margin-bottom:6px;">
                <input type="search" id="diario-f-search" placeholder="🔍 Buscar (técnico, fecha, serial…)" value="${escapeHtml(diarioSearchTerm)}" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:6px; font-size:0.85em; box-sizing:border-box;">
            </div>
        `;
        const wireSearch = () => {
            const s = document.getElementById('diario-f-search');
            if (s) s.addEventListener('input', e => {
                diarioSearchTerm = e.target.value;
                renderDiarioOnus();
                const r = document.getElementById('diario-f-search');
                if (r) { r.focus(); r.setSelectionRange(r.value.length, r.value.length); }
            });
        };
        if (!filtrados.length) {
            c.innerHTML = searchBar + `<div class="empty-state"><i class="fas fa-clipboard-list"></i><p>Sin registros${qn ? ' con ese término' : ' diarios de ONUs'}</p></div>`;
            wireSearch();
            return;
        }
        c.innerHTML = searchBar + filtrados.map(d => {
            const fecha = d.fecha || d.fecha_registro;
            return `
                <div style="background:white; border-radius:12px; padding:12px; margin-bottom:6px; border-left:3px solid #0066cc; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                    <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:600; font-size:0.92em;">${escapeHtml(d.tecnico_nombre || 'Técnico')}</div>
                            <div style="font-size:0.78em; color:#666; margin-top:2px;"><i class="fas fa-calendar"></i> ${fmtFecha(fecha)}</div>
                            <div style="font-size:0.78em; color:#0066cc; margin-top:2px;"><i class="fas fa-microchip"></i> <b>${d.total_onus || d.cantidad || 0}</b> ONUs escaneadas</div>
                            ${d.detalle_seriales ? `<div style="font-size:0.72em; color:#999; margin-top:3px; font-family:monospace; max-height:60px; overflow-y:auto;">${escapeHtml(String(d.detalle_seriales).substring(0,300))}</div>` : ''}
                        </div>
                        <span style="background:#dbeafe; color:#1e40af; font-size:0.68em; font-weight:600; padding:3px 6px; border-radius:6px;">${d.total_onus || d.cantidad || 0}</span>
                    </div>
                </div>
            `;
        }).join('');
        wireSearch();
    }

    async function loadDiarioOnus() {
        try {
            const data = await API.get('/api/inventario/historial-diario-onus');
            diarioOnus = data?.historial || data?.data || (Array.isArray(data) ? data : []);
        } catch { diarioOnus = []; }
    }

    // Scanner cámara para registrar serial — usa BarcodeDetector API nativo si está disponible
    async function abrirScannerSerial() {
        let serialDetectado = null;
        // Intentar usar BarcodeDetector (Chrome Android 83+)
        if ('BarcodeDetector' in window) {
            try {
                serialDetectado = await scanWithBarcodeDetector();
            } catch (e) {
                console.warn('Barcode scan falló:', e);
            }
        }
        // Fallback: tomar foto + ingreso manual
        if (!serialDetectado) {
            if (window.Capacitor?.Plugins?.Camera) {
                try {
                    await window.Capacitor.Plugins.Camera.getPhoto({ resultType: 'base64', source: 'CAMERA', quality: 60 });
                } catch (e) { if (e?.message?.includes('User cancelled')) return; }
            }
            serialDetectado = prompt('Ingresá el SERIAL del equipo (no se detectó QR automático):');
            if (!serialDetectado) return;
        }
        const tipo = prompt('Tipo de equipo (ONU o TV BOX):', 'ONU');
        if (!tipo) return;
        const esTv = /tv/i.test(tipo) && /box/i.test(tipo);
        const cliente = prompt('Nombre cliente / referencia:', '') || '';
        try {
            await API.post('/api/inventario/reintegrar-onu', {
                serial_equipo: serialDetectado.trim().toUpperCase(),
                tipo_equipo: esTv ? 'TV BOX' : tipo,
                estado_fisico: 'bueno',
                cliente_nombre: cliente || 'Manual scan'
            });
            showToast((esTv ? 'TV Box' : 'ONU') + ' registrada ✓ ' + serialDetectado, 'success');
            await loadDiarioOnus();
            renderTab();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    // Auto-zoom / autofoco: la cámara barre acercando/alejando para leer mejor el código.
    // Si el equipo no soporta zoom, no hace nada.
    function _autoZoomTrackAdm(stream) {
        try {
            const track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
            if (!track || !track.getCapabilities) return function () {};
            const caps = track.getCapabilities();
            try { if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) {}
            if (!caps.zoom || !(caps.zoom.max > caps.zoom.min)) return function () {};
            const zmin = caps.zoom.min || 1, zmax = caps.zoom.max;
            const ztop = Math.min(zmax, zmin + (zmax - zmin) * 0.6);
            const niveles = [zmin, zmin + (ztop - zmin) * 0.5, ztop];
            let i = 0, dir = 1;
            const timer = setInterval(function () {
                try { track.applyConstraints({ advanced: [{ zoom: niveles[i] }] }); } catch (e) {}
                i += dir; if (i >= niveles.length - 1) dir = -1; else if (i <= 0) dir = 1;
            }, 900);
            return function () { clearInterval(timer); try { track.applyConstraints({ advanced: [{ zoom: zmin }] }); } catch (e) {} };
        } catch (e) { return function () {}; }
    }
    async function scanWithBarcodeDetector() {
        return new Promise(async (resolve, reject) => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:black; z-index:99999; display:flex; flex-direction:column;';
                overlay.innerHTML = `
                    <div style="padding:10px; background:rgba(0,0,0,0.8); color:white; text-align:center; font-size:0.9em;">📷 Apuntá al código QR / barra del equipo</div>
                    <video autoplay playsinline style="flex:1; object-fit:cover;"></video>
                    <div style="position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); width:60vw; height:30vh; border:3px solid #16a34a; border-radius:8px; pointer-events:none;"></div>
                    <button id="bd-close" style="padding:14px; background:#dc3545; color:white; border:none; font-size:1em; font-weight:600;">✕ Cancelar</button>
                `;
                document.body.appendChild(overlay);
                const video = overlay.querySelector('video');
                video.srcObject = stream;
                const _zStop = _autoZoomTrackAdm(stream);
                const detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix'] });
                let stopped = false;
                const cleanup = (result) => {
                    if (stopped) return; stopped = true;
                    try { _zStop && _zStop(); } catch (e) {}
                    stream.getTracks().forEach(t => t.stop());
                    overlay.remove();
                    if (result) resolve(result); else reject(new Error('cancelled'));
                };
                overlay.querySelector('#bd-close').onclick = () => cleanup(null);
                const tick = async () => {
                    if (stopped) return;
                    try {
                        const codes = await detector.detect(video);
                        if (codes.length > 0) {
                            cleanup(codes[0].rawValue);
                            return;
                        }
                    } catch {}
                    requestAnimationFrame(tick);
                };
                video.onloadedmetadata = () => tick();
                setTimeout(() => { if (!stopped) cleanup(null); }, 30000); // timeout 30s
            } catch (err) { reject(err); }
        });
    }

    function renderRetirados() {
        const c = document.getElementById('inv-list-container');
        if (!c) return;
        // 🆕 v2026-06-10: filtro en vivo (serial, cliente, técnico, motivo, descripción…)
        const qn = _norm(retSearchTerm);
        const filtrados = !qn ? retirados : retirados.filter(r => {
            const blob = _norm([
                r.serial_number, r.serial, r.serial_equipo,
                r.equipo_tipo, r.tipo, r.marca, r.modelo,
                r.cliente_nombre, r.cliente_cedula,
                r.motivo_retiro, r.estado_fisico, r.descripcion_dano,
                r.tecnico_nombre, r.visita_id, r.fecha_retiro
            ].filter(Boolean).join(' '));
            return blob.includes(qn);
        });
        document.getElementById('inv-count').textContent = qn
            ? `${filtrados.length} de ${retirados.length} (filtrado)`
            : `${retirados.length} equipos retirados`;
        const searchBar = `
            <div style="background:white; padding:8px; border-radius:8px; margin-bottom:6px;">
                <input type="search" id="ret-f-search" placeholder="🔍 Buscar (serial, cliente, motivo, descripción…)" value="${escapeHtml(retSearchTerm)}" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:6px; font-size:0.85em; box-sizing:border-box;">
            </div>
        `;
        if (!filtrados.length) {
            c.innerHTML = searchBar + `<div class="empty-state"><i class="fas fa-archive"></i><p>Sin equipos retirados${qn ? ' con ese término' : ''}</p></div>`;
            const s = document.getElementById('ret-f-search');
            if (s) s.addEventListener('input', e => { retSearchTerm = e.target.value; renderRetirados(); const r = document.getElementById('ret-f-search'); if (r) { r.focus(); r.setSelectionRange(r.value.length, r.value.length); } });
            return;
        }
        c.innerHTML = searchBar + filtrados.map(r => {
            const procesado = !!r.procesado || r.procesado === 1;
            const color = procesado ? '#999' : '#f59e0b';
            return `
                <div style="background:white; border-radius:12px; padding:12px; margin-bottom:6px; border-left:3px solid ${color}; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                    <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:600; font-size:0.92em;">${escapeHtml(r.equipo_tipo || r.tipo || 'Equipo')} ${r.marca || ''} ${r.modelo || ''}</div>
                            <div style="font-size:0.76em; color:#0066cc; font-family:monospace; margin-top:2px;">SN: ${escapeHtml(r.serial_number || r.serial || '—')}</div>
                            <div style="font-size:0.75em; color:#666; margin-top:2px;">${escapeHtml(r.cliente_nombre || '')} · ${fmtFecha(r.fecha_retiro)}</div>
                            ${r.motivo_retiro ? `<div style="font-size:0.78em; color:#92400e; margin-top:3px;"><i class="fas fa-exclamation-triangle"></i> ${escapeHtml(r.motivo_retiro)}</div>` : ''}
                            <div style="font-size:0.74em; color:#999; margin-top:2px;">Estado: ${escapeHtml(r.estado_fisico || '—')}</div>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:4px; flex-shrink:0;">
                            <span style="background:${procesado ? '#f3f4f6' : '#fef3c7'}; color:${procesado ? '#666' : '#92400e'}; font-size:0.68em; font-weight:600; padding:3px 6px; border-radius:6px; text-align:center;">${procesado ? 'PROCESADO' : 'PENDIENTE'}</span>
                            ${!procesado ? `
                                <button onclick="InventarioPage.procesarRetirado(${r.id}, 'reintegrar')" style="background:#16a34a; color:white; border:none; padding:5px 8px; border-radius:5px; font-size:0.7em; cursor:pointer;"><i class="fas fa-undo"></i> Reintegrar</button>
                                <button onclick="InventarioPage.procesarRetirado(${r.id}, 'baja')" style="background:#dc3545; color:white; border:none; padding:5px 8px; border-radius:5px; font-size:0.7em; cursor:pointer;"><i class="fas fa-trash"></i> Dar baja</button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        // 🆕 enganchar listener del search también en este path
        const s2 = document.getElementById('ret-f-search');
        if (s2) s2.addEventListener('input', e => {
            retSearchTerm = e.target.value;
            renderRetirados();
            const r = document.getElementById('ret-f-search');
            if (r) { r.focus(); r.setSelectionRange(r.value.length, r.value.length); }
        });
    }

    async function loadRetirados() {
        try {
            const data = await API.get('/api/equipos-retirados?limite=200');
            retirados = data?.equipos || data?.data || (Array.isArray(data) ? data : []);
        } catch { retirados = []; }
    }

    async function procesarRetirado(id, accion) {
        const labels = { reintegrar: 'reintegrar al stock', baja: 'dar de baja' };
        if (!confirm(`¿${labels[accion]} este equipo?`)) return;
        try {
            await API.put(`/api/equipos-retirados/${id}/procesar`, { accion, observacion: '' });
            showToast(accion === 'reintegrar' ? 'Reintegrado al stock' : 'Dado de baja', 'success');
            await loadRetirados();
            renderTab();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    function openAjusteStock(material) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3><i class="fas fa-sliders-h"></i> Ajustar stock</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:16px;">
                    <div style="background:#eff6ff; padding:10px; border-radius:8px; margin-bottom:12px; font-size:0.86em;">
                        <b>${escapeHtml(material.nombre)}</b><br>
                        Stock actual: <b>${material.stock_actual || 0}</b> ${material.unidad_medida || 'u.'}
                    </div>
                    <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Tipo de movimiento</label>
                    <select id="aj-tipo" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:12px;">
                        <option value="entrada">+ Entrada (sumar)</option>
                        <option value="salida">− Salida (restar)</option>
                        <option value="ajuste">⚙️ Ajuste manual</option>
                    </select>
                    <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Cantidad *</label>
                    <input type="number" id="aj-cant" min="1" step="1" placeholder="Cantidad" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:12px;">
                    <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Observación</label>
                    <textarea id="aj-obs" rows="2" placeholder="Motivo del ajuste" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; font-family:inherit;"></textarea>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="aj-save"><i class="fas fa-save"></i> Aplicar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.querySelector('#aj-save').onclick = async () => {
            const tipo = overlay.querySelector('#aj-tipo').value;
            let cant = parseInt(overlay.querySelector('#aj-cant').value);
            const obs = overlay.querySelector('#aj-obs').value.trim();
            if (!cant || cant <= 0) return showToast('Cantidad inválida', 'error');
            // El endpoint espera 'cantidad' con signo (negativo si salida)
            if (tipo === 'salida') cant = -Math.abs(cant);
            try {
                await API.post(`/api/inventario/materiales/${material.id}/ajuste`, { cantidad: cant, tipo, observacion: obs });
                showToast('Stock ajustado ✓', 'success');
                overlay.remove();
                await loadStock();
                await loadMovimientos();
                renderStats();
                renderTab();
            } catch (err) { showToast('Error: ' + err.message, 'error'); }
        };
    }

    function exportarCSV() {
        let csv = '';
        let filename = '';
        if (activeTab === 'stock') {
            csv = 'Código,Nombre,Categoría,Stock actual,Stock mínimo,Unidad,Costo\n';
            csv += materiales.map(m => [
                m.codigo || '', m.nombre || '', m.categoria || '',
                m.stock_actual || 0, m.stock_minimo || 0, m.unidad_medida || '',
                m.costo_unitario || 0
            ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
            filename = 'stock-inventario.csv';
        } else if (activeTab === 'movimientos') {
            csv = 'Fecha,Material,Código,Tipo,Cantidad,Stock anterior,Stock posterior,Visita,Observación\n';
            csv += movimientos.map(m => [
                fmtFecha(m.fecha_movimiento), m.material_nombre || '', m.material_codigo || '',
                m.tipo_movimiento || '', m.cantidad || 0, m.stock_anterior || 0,
                m.stock_posterior || 0, m.visita_id || '', m.observacion || ''
            ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
            filename = 'movimientos-inventario.csv';
        } else if (activeTab === 'retirados') {
            csv = 'Fecha,Tipo,Marca,Modelo,Serial,Cliente,Motivo,Estado,Procesado\n';
            csv += retirados.map(r => [
                fmtFecha(r.fecha_retiro), r.equipo_tipo || '', r.marca || '', r.modelo || '',
                r.serial_number || '', r.cliente_nombre || '', r.motivo_retiro || '',
                r.estado_fisico || '', r.procesado ? 'sí' : 'no'
            ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
            filename = 'equipos-retirados.csv';
        } else { return; }

        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('CSV exportado', 'success');
    }

    function renderStats() {
        const t = stats.totales || {};
        const el = document.getElementById('inv-stats');
        if (!el) return;
        el.innerHTML = `
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px;">
                <div style="background:white; padding:10px; border-radius:8px; text-align:center;">
                    <div style="font-size:1.2em; font-weight:700; color:#0066cc;">${t.total_materiales || 0}</div>
                    <div style="font-size:0.7em; color:#666;">Materiales</div>
                </div>
                <div style="background:white; padding:10px; border-radius:8px; text-align:center;">
                    <div style="font-size:1.2em; font-weight:700; color:#16a34a;">${parseInt(t.total_unidades || 0)}</div>
                    <div style="font-size:0.7em; color:#666;">Unidades</div>
                </div>
                <div style="background:white; padding:10px; border-radius:8px; text-align:center;">
                    <div style="font-size:1.2em; font-weight:700; color:${parseInt(t.stock_bajo || 0) > 0 ? '#dc3545' : '#999'};">${t.stock_bajo || 0}</div>
                    <div style="font-size:0.7em; color:#666;">Stock bajo</div>
                </div>
            </div>
        `;
    }

    async function loadStock() {
        try {
            const [mData, sData] = await Promise.all([
                API.get('/api/inventario/materiales'),
                API.get('/api/inventario/estadisticas')
            ]);
            materiales = mData?.materiales || (Array.isArray(mData) ? mData : []);
            stats = sData?.estadisticas || {};
        } catch { materiales = []; stats = {}; }
    }

    async function loadMovimientos() {
        try {
            const data = await API.get('/api/inventario/movimientos?limit=100');
            movimientos = data?.movimientos || (Array.isArray(data) ? data : []);
        } catch { movimientos = []; }
    }

    // Modal de crear/editar material
    function openMaterialEditor(material = null) {
        const isEdit = !!material;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:92vh;">
                <div class="modal-header">
                    <h3><i class="fas fa-box"></i> ${isEdit ? 'Editar material' : 'Nuevo material'}</h3>
                    <button class="icon-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body" style="padding:16px;">
                    ${isEdit ? `
                    <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Código</label>
                    <input type="text" id="mat-codigo" value="${escapeHtml(material?.codigo || '')}" readonly style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; margin-bottom:12px; background:#f0f0f0; color:#666;">
                    ` : `
                    <!-- 🛡️ v1.0.99: campo Código removido al crear (lo autogenera el backend con prefijo por categoría: ONU-XXXX, CAB-XXXX, etc.). Antes se mostraba editable pero el backend lo ignoraba — confundía al usuario. -->
                    <div style="background:#eff6ff; border-left:3px solid #3b82f6; padding:8px 12px; border-radius:6px; margin-bottom:12px; font-size:0.78em; color:#1e40af;">
                        ℹ️ El código se genera automáticamente según la categoría (ej: ONU-0291, CAB-0012).
                    </div>
                    `}

                    <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Nombre *</label>
                    <input type="text" id="mat-nombre" value="${escapeHtml(material?.nombre || '')}" placeholder="Nombre del material" style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; margin-bottom:12px;">

                    <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Categoría *</label>
                    <select id="mat-categoria" style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; margin-bottom:12px;">
                        ${CATEGORIAS.map(c => `<option value="${c.value}" ${material?.categoria === c.value ? 'selected' : ''}>${c.label}</option>`).join('')}
                    </select>

                    <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Descripción</label>
                    <textarea id="mat-descripcion" rows="2" style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; font-family:inherit; margin-bottom:12px;">${escapeHtml(material?.descripcion || '')}</textarea>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">
                        <div>
                            <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Stock actual</label>
                            <input type="number" id="mat-stock" min="0" step="1" value="${material?.stock_actual || 0}" style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em;">
                        </div>
                        <div>
                            <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Stock mínimo</label>
                            <input type="number" id="mat-minimo" min="0" step="1" value="${material?.stock_minimo || 0}" style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em;">
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div>
                            <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Unidad</label>
                            <select id="mat-unidad" style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em;">
                                ${UNIDADES.map(u => `<option value="${u.value}" ${(material?.unidad_medida || 'unidades') === u.value ? 'selected' : ''}>${u.label}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Costo unitario</label>
                            <input type="number" id="mat-costo" min="0" step="100" value="${material?.costo_unitario || 0}" style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em;">
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    ${isEdit ? `<button class="btn-secondary" style="background:#fee; color:#dc3545;" id="mat-borrar-btn"><i class="fas fa-trash"></i> Eliminar</button>` : ''}
                    <button class="btn-primary" id="mat-save-btn"><i class="fas fa-save"></i> Guardar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        document.getElementById('mat-save-btn').addEventListener('click', async () => {
            const data = {
                // 🛡️ v1.0.99: NO mandamos código en creación. El backend lo autogenera.
                nombre: document.getElementById('mat-nombre').value.trim(),
                categoria: document.getElementById('mat-categoria').value,
                descripcion: document.getElementById('mat-descripcion').value.trim(),
                stock_actual: parseInt(document.getElementById('mat-stock').value) || 0,
                stock_minimo: parseInt(document.getElementById('mat-minimo').value) || 0,
                unidad_medida: document.getElementById('mat-unidad').value.trim() || 'unidades',
                costo_unitario: parseFloat(document.getElementById('mat-costo').value) || 0,
            };
            if (!data.nombre) { showToast('Nombre es obligatorio', 'error'); return; }
            const btn = document.getElementById('mat-save-btn');
            btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            try {
                let resultado;
                if (isEdit) {
                    resultado = await API.put(`/api/inventario/materiales/${material.id}`, data);
                    showToast('Material actualizado', 'success');
                } else {
                    resultado = await API.post('/api/inventario/materiales', data);
                    // 🛡️ v1.0.99: el backend SUMA stock si el nombre ya existe (case-insensitive).
                    // Antes mostrábamos siempre "Creado" → el usuario creía que era nuevo material pero
                    // realmente se había sumado al existente. Ahora distinguimos los dos casos.
                    if (resultado && resultado.sumado === true) {
                        showToast(`✅ Stock sumado a existente (${resultado.codigo}): ${resultado.stockAnterior} → ${resultado.stockNuevo}`, 'success');
                    } else if (resultado && resultado.codigo) {
                        showToast(`✅ Material creado: ${resultado.codigo}`, 'success');
                    } else {
                        showToast('Material creado', 'success');
                    }
                }
                overlay.remove();
                await loadStock();
                renderStats();
                renderTab();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
                btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
            }
        });

        const delBtn = document.getElementById('mat-borrar-btn');
        if (delBtn) {
            delBtn.addEventListener('click', async () => {
                if (!confirm(`¿Eliminar "${material.nombre}"?`)) return;
                try {
                    await API.del(`/api/inventario/materiales/${material.id}`);
                    showToast('Eliminado', 'success');
                    overlay.remove();
                    await loadStock();
                    renderStats();
                    renderTab();
                } catch (err) { showToast('Error: ' + err.message, 'error'); }
            });
        }
    }

    function showToast(msg, type='info') {
        let t = document.getElementById('toast');
        if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
        t.className = 'toast show ' + type;
        t.textContent = msg;
        setTimeout(() => t.classList.remove('show'), 2500);
    }

    function show() {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const main = document.querySelector('.app-main');
        let page = document.getElementById('page-inventario');
        if (!page) {
            page = document.createElement('div');
            page.id = 'page-inventario';
            page.className = 'page';
            main.appendChild(page);
        }
        page.classList.add('active');
        page.innerHTML = `
            <div id="inv-stats" style="margin-bottom:8px;"></div>
            <div class="tabs-bar">
                <button class="tab-btn ${activeTab === 'stock' ? 'active' : ''}" data-tab="stock">
                    <i class="fas fa-boxes"></i> Stock <span class="count">0</span>
                </button>
                <button class="tab-btn ${activeTab === 'movimientos' ? 'active' : ''}" data-tab="movimientos">
                    <i class="fas fa-exchange-alt"></i> Movim. <span class="count">0</span>
                </button>
                <button class="tab-btn ${activeTab === 'retirados' ? 'active' : ''}" data-tab="retirados">
                    <i class="fas fa-archive"></i> Retirados <span class="count">0</span>
                </button>
                <button class="tab-btn ${activeTab === 'diario' ? 'active' : ''}" data-tab="diario">
                    <i class="fas fa-clipboard-list"></i> Diario ONUs <span class="count">0</span>
                </button>
            </div>
            <div id="inv-filters" style="margin-bottom:6px;"></div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.78em; color:#666; margin-bottom:6px;">
                <span id="inv-count">…</span>
                <button onclick="InventarioPage.exportarCSV()" style="background:#16a34a; color:white; border:none; padding:6px 12px; border-radius:6px; font-size:0.78em; font-weight:600; cursor:pointer;"><i class="fas fa-file-csv"></i> Exportar CSV</button>
            </div>
            <div id="inv-list-container">
                <div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>
            </div>
            <button class="fab" onclick="InventarioPage.fabAction()" title="Acción">
                <i class="fas fa-plus" id="inv-fab-icon"></i>
            </button>
        `;
        page.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                activeTab = btn.dataset.tab;
                page.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === activeTab));
                renderFilters();
                if (activeTab === 'movimientos' && !movimientos.length) await loadMovimientos();
                if (activeTab === 'retirados' && !retirados.length) await loadRetirados();
                if (activeTab === 'diario' && !diarioOnus.length) await loadDiarioOnus();
                document.getElementById('inv-list-container').innerHTML = '<div class="loading-center"><i class="fas fa-spinner fa-spin"></i></div>';
                renderTab();
            });
        });
        renderFilters();
        (async () => {
            await Promise.all([loadStock(), loadMovimientos()]);
            renderStats();
            renderTab();
        })();
    }

    function renderFilters() {
        const el = document.getElementById('inv-filters');
        if (!el) return;
        if (activeTab !== 'stock') { el.innerHTML = ''; return; }
        el.innerHTML = `
            <div style="background:white; padding:8px; border-radius:8px; display:flex; gap:6px; align-items:center;">
                <input type="text" id="inv-buscar" placeholder="Buscar..." value="${escapeHtml(searchTerm)}" style="flex:1; padding:8px 10px; border:1px solid #ddd; border-radius:6px; font-size:0.85em;">
                <select id="inv-categoria" style="padding:8px 10px; border:1px solid #ddd; border-radius:6px; font-size:0.85em;">
                    <option value="">Todas</option>
                    ${CATEGORIAS.map(c => `<option value="${c.value}" ${categoriaFiltro === c.value ? 'selected' : ''}>${c.label}</option>`).join('')}
                </select>
            </div>
        `;
        document.getElementById('inv-buscar').addEventListener('input', (e) => { searchTerm = e.target.value.trim(); renderStock(); });
        document.getElementById('inv-categoria').addEventListener('change', (e) => { categoriaFiltro = e.target.value; renderStock(); });
    }

    function crearMaterial() { openMaterialEditor(null); }
    function fabAction() {
        if (activeTab === 'diario') abrirScannerSerial();
        else crearMaterial();
    }

    return { show, crearMaterial, procesarRetirado, exportarCSV, fabAction, abrirScannerSerial, verDetalleOnus };
})();

if (typeof Router !== 'undefined') Router.register('inventario', () => InventarioPage.show());
