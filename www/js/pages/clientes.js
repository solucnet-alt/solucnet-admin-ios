// 🆕 Página: Clientes externos (Solucnet.com) — sincronización y búsqueda
const ClientesPage = (function() {
    let clientes = [];
    let stats = {};
    let searchTerm = '';
    let estadoFiltro = '';
    let currentPage = 1;
    const PAGE_SIZE = 30;

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    }

    function fmtFecha(ts) {
        if (!ts) return '—';
        try { return new Date(ts).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
        catch { return '—'; }
    }

    function renderCliente(c) {
        const estadoColor = c.estado === 'Activo' ? '#16a34a' : '#dc3545';
        // 🆕 Si no hay nombre, usar "Sin nombre" + contrato como subtítulo (como hace el web admin)
        const nombreVisible = (c.nombre && c.nombre.trim()) ? c.nombre.trim() : (c.movil || c.telefono || 'Sin nombre');
        return `
            <div data-id="${c.id || c.cedula || c.numero_contrato}" class="cli-card" style="background:white; border-radius:12px; padding:12px; margin-bottom:6px; box-shadow:0 1px 2px rgba(0,0,0,0.04); border-left:3px solid ${estadoColor}; cursor:pointer;">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:0.92em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${escapeHtml(nombreVisible)}
                        </div>
                        <div style="font-size:0.72em; color:#888; margin-top:1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            <i class="fas fa-file-contract"></i> ${escapeHtml(c.numero_contrato || '—')}
                        </div>
                        <div style="font-size:0.78em; color:#666; margin-top:2px;">
                            ${c.cedula ? 'CC ' + escapeHtml(c.cedula) + ' · ' : ''}
                            ${escapeHtml(c.telefono || c.movil || 'Sin tel')}
                        </div>
                        ${c.direccion ? `<div style="font-size:0.75em; color:#999; margin-top:2px;"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(c.direccion)}</div>` : ''}
                        ${c.plan_contratado ? `<div style="font-size:0.75em; color:#0066cc; margin-top:2px;"><i class="fas fa-wifi"></i> ${escapeHtml(c.plan_contratado)}</div>` : ''}
                        ${c.fecha_registro ? `<div style="font-size:0.7em; color:#999; margin-top:3px;"><i class="fas fa-clock"></i> Registrado ${fmtFecha(c.fecha_registro)}</div>` : ''}
                    </div>
                    <span style="background:${estadoColor}22; color:${estadoColor}; font-size:0.7em; font-weight:600; padding:3px 8px; border-radius:8px; flex-shrink:0;">${escapeHtml(c.estado || '?')}</span>
                </div>
            </div>
        `;
    }

    function showDetalleCliente(c) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const row = (k, v) => v ? `<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f0f0f0; font-size:0.85em;"><span style="color:#666;">${k}</span><b style="text-align:right; max-width:60%;">${escapeHtml(String(v))}</b></div>` : '';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3><i class="fas fa-user"></i> ${escapeHtml(c.nombre || 'Cliente')}</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    ${row('Contrato', c.numero_contrato)}
                    ${row('Cédula', c.cedula)}
                    ${row('Estado', c.estado)}
                    ${row('Teléfono', c.telefono)}
                    ${row('Móvil', c.movil)}
                    ${row('Email', c.email)}
                    ${row('Dirección', c.direccion)}
                    ${row('Ciudad', c.ciudad)}
                    ${row('Plan', c.plan_contratado)}
                    ${row('Precio plan', c.precio_plan ? '$ ' + Number(c.precio_plan).toLocaleString('es-CO') : null)}
                    ${row('IP estática', c.ip_estatica)}
                    ${row('Sucursal', c.sucursal_nombre)}
                    ${row('Fecha alta', c.fecha_alta ? fmtFecha(c.fecha_alta) : null)}
                    <div style="margin-top:14px; display:flex; flex-direction:column; gap:6px;">
                        <button onclick="ClientesPage.programarVisita('${escapeHtml(c.cedula || c.numero_contrato || c.nombre || '')}')" style="background:linear-gradient(135deg,#0066cc,#0052a3); color:white; border:none; padding:11px; border-radius:8px; font-size:0.9em; font-weight:600; cursor:pointer;"><i class="fas fa-calendar-plus"></i> Programar visita técnica</button>
                        <!-- 🆕 v2026-06-01: Registrar instalación (paridad con el panel web) -->
                        ${c.id ? `<button onclick="ClientesPage.registrarInstalacion(${c.id})" style="background:linear-gradient(135deg,#16a34a,#15803d); color:white; border:none; padding:11px; border-radius:8px; font-size:0.9em; font-weight:600; cursor:pointer;"><i class="fas fa-tools"></i> Registrar instalación</button>` : ''}
                        <!-- 🆕 Botones para abrir los 2 PDFs del cliente (formulario + contrato) -->
                        ${c.cedula ? `<div style="display:flex; gap:6px;">
                            <button onclick="ClientesPage.abrirFormulario('${escapeHtml(c.cedula)}', '${escapeHtml(c.numero_contrato || '')}')" style="flex:1; background:#dc3545; color:white; border:none; padding:10px; border-radius:8px; font-size:0.82em; font-weight:600; cursor:pointer;"><i class="fas fa-file-pdf"></i> Formulario</button>
                            <button onclick="ClientesPage.abrirContrato('${escapeHtml(c.cedula)}', '${escapeHtml(c.numero_contrato || '')}')" style="flex:1; background:#7c3aed; color:white; border:none; padding:10px; border-radius:8px; font-size:0.82em; font-weight:600; cursor:pointer;"><i class="fas fa-file-signature"></i> Contrato</button>
                        </div>` : ''}
                        ${(c.telefono || c.movil) ? `<div style="display:flex; gap:6px;">
                            <a href="tel:${escapeHtml(c.telefono || c.movil)}" style="flex:1; text-align:center; background:#16a34a; color:white; padding:10px; border-radius:8px; text-decoration:none; font-size:0.85em; font-weight:600;"><i class="fas fa-phone"></i> Llamar</a>
                            <a href="https://wa.me/${(c.movil || c.telefono || '').replace(/\D/g,'')}" target="_blank" style="flex:1; text-align:center; background:#25d366; color:white; padding:10px; border-radius:8px; text-decoration:none; font-size:0.85em; font-weight:600;"><i class="fab fa-whatsapp"></i> WhatsApp</a>
                        </div>` : ''}
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    function applyFiltros() {
        let lista = clientes;
        if (estadoFiltro) lista = lista.filter(c => c.estado === estadoFiltro);
        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            lista = lista.filter(c =>
                (c.nombre || '').toLowerCase().includes(q) ||
                (c.cedula || '').toLowerCase().includes(q) ||
                (c.telefono || '').toLowerCase().includes(q) ||
                (c.movil || '').toLowerCase().includes(q) ||
                (c.numero_contrato || '').toLowerCase().includes(q)
            );
        }
        // 🆕 Ordenar por fecha de registro DESC — los más recientes primero
        lista = [...lista].sort((a, b) => {
            const ta = a.fecha_registro ? new Date(a.fecha_registro).getTime() : 0;
            const tb = b.fecha_registro ? new Date(b.fecha_registro).getTime() : 0;
            return tb - ta;
        });
        return lista;
    }

    function renderList() {
        const lista = applyFiltros();
        const totalPaginas = Math.ceil(lista.length / PAGE_SIZE);
        if (currentPage > totalPaginas) currentPage = 1;
        const start = (currentPage - 1) * PAGE_SIZE;
        const slice = lista.slice(start, start + PAGE_SIZE);
        const c = document.getElementById('clientes-list-container');
        if (!c) return;
        document.getElementById('clientes-count').textContent = `${lista.length} clientes`;
        if (!slice.length) {
            c.innerHTML = `<div class="empty-state"><i class="fas fa-users"></i><p>No hay clientes con estos filtros</p></div>`;
            return;
        }
        const pagBar = totalPaginas > 1 ? `
            <div style="display:flex; justify-content:center; align-items:center; gap:10px; padding:10px;">
                <button onclick="ClientesPage.prevPage()" ${currentPage === 1 ? 'disabled' : ''} style="padding:6px 12px; border-radius:6px; border:1px solid #ddd; background:white; cursor:pointer;">‹</button>
                <span style="font-size:0.85em; color:#666;">Pág ${currentPage} de ${totalPaginas}</span>
                <button onclick="ClientesPage.nextPage()" ${currentPage === totalPaginas ? 'disabled' : ''} style="padding:6px 12px; border-radius:6px; border:1px solid #ddd; background:white; cursor:pointer;">›</button>
            </div>
        ` : '';
        c.innerHTML = slice.map(renderCliente).join('') + pagBar;
        // Click → detalle
        c.querySelectorAll('.cli-card').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.dataset.id;
                const cli = slice.find(x => String(x.id || x.cedula || x.numero_contrato) === id);
                if (cli) showDetalleCliente(cli);
            });
        });
    }

    async function load() {
        const c = document.getElementById('clientes-list-container');
        if (c) c.innerHTML = `<div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>`;
        try {
            const [data, statsData] = await Promise.all([
                API.get('/api/clientes-externos?limit=500'),
                API.get('/api/estadisticas-clientes-externos'),
            ]);
            clientes = data?.clientes || (Array.isArray(data) ? data : []);
            stats = statsData?.estadisticas || {};
            renderStats();
            renderList();
        } catch (err) {
            if (c) c.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle" style="color:#dc3545;"></i><p>Error: ${escapeHtml(err.message)}</p></div>`;
        }
    }

    function renderStats() {
        const el = document.getElementById('clientes-stats');
        if (!el) return;
        el.innerHTML = `
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px;">
                <div style="background:white; padding:10px; border-radius:8px; text-align:center;">
                    <div style="font-size:1.3em; font-weight:700; color:#0066cc;">${stats.total || 0}</div>
                    <div style="font-size:0.7em; color:#666;">Total</div>
                </div>
                <div style="background:white; padding:10px; border-radius:8px; text-align:center;">
                    <div style="font-size:1.3em; font-weight:700; color:#16a34a;">${stats.activos || 0}</div>
                    <div style="font-size:0.7em; color:#666;">Activos</div>
                </div>
                <div style="background:white; padding:10px; border-radius:8px; text-align:center;">
                    <div style="font-size:1.3em; font-weight:700; color:#dc3545;">${stats.inactivos || 0}</div>
                    <div style="font-size:0.7em; color:#666;">Inactivos</div>
                </div>
            </div>
            ${stats.ultima_sincronizacion ? `<div style="font-size:0.75em; color:#999; margin-top:6px; text-align:center;">Última sync: ${fmtFecha(stats.ultima_sincronizacion)}</div>` : ''}
        `;
    }

    async function sincronizar() {
        const btn = document.getElementById('clientes-sync-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sincronizando…'; }
        try {
            const data = await API.post('/api/sincronizar-clientes-externos', {});
            if (data?.success) {
                showToast(`Sync OK: ${data.nuevos || 0} nuevos, ${data.actualizados || 0} actualizados`, 'success');
                await load();
            } else {
                showToast(data?.message || 'Error', 'error');
            }
        } catch (err) {
            showToast('Error de red', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt"></i> Sincronizar'; }
        }
    }

    function prevPage() { if (currentPage > 1) { currentPage--; renderList(); document.querySelector('.app-main')?.scrollTo(0, 0); } }
    function nextPage() { currentPage++; renderList(); document.querySelector('.app-main')?.scrollTo(0, 0); }

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
        let page = document.getElementById('page-clientes');
        if (!page) {
            page = document.createElement('div');
            page.id = 'page-clientes';
            page.className = 'page';
            main.appendChild(page);
        }
        page.classList.add('active');
        page.innerHTML = `
            <div id="clientes-stats"></div>
            <div style="background:white; padding:10px; border-radius:12px; margin-top:8px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                <div style="display:flex; gap:6px; align-items:center;">
                    <input type="text" id="clientes-buscar" placeholder="Buscar nombre, cédula, tel..." style="flex:1; padding:8px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.9em;">
                    <select id="clientes-estado" style="padding:8px 10px; border:1px solid #ddd; border-radius:8px; font-size:0.85em;">
                        <option value="">Todos</option>
                        <option value="Activo">Activos</option>
                        <option value="Inactivo">Inactivos</option>
                    </select>
                </div>
                <button id="clientes-sync-btn" onclick="ClientesPage.sincronizar()" style="margin-top:8px; width:100%; padding:10px; background:#0066cc; color:white; border:none; border-radius:8px; font-weight:600; cursor:pointer;">
                    <i class="fas fa-sync-alt"></i> Sincronizar con Solucnet.com
                </button>
                <div id="clientes-count" style="font-size:0.78em; color:#666; text-align:center; margin-top:6px;">…</div>
            </div>
            <div id="clientes-list-container" style="margin-top:8px;"></div>
        `;
        document.getElementById('clientes-buscar').addEventListener('input', (e) => { searchTerm = e.target.value.trim(); currentPage = 1; renderList(); });
        document.getElementById('clientes-estado').addEventListener('change', (e) => { estadoFiltro = e.target.value; currentPage = 1; renderList(); });
        load();
    }

    function programarVisita(terminoBusqueda) {
        // Cerrar cualquier modal abierto
        document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
        // Buscar el cliente externo en el cache local
        const cli = clientes.find(c =>
            (c.cedula && c.cedula === terminoBusqueda) ||
            (c.numero_contrato && c.numero_contrato === terminoBusqueda) ||
            (c.nombre && c.nombre === terminoBusqueda)
        );
        if (!cli) {
            alert('No se encontró el cliente en la lista.');
            return;
        }
        // 🆕 Abrir modal de Agendar Instalación (igual al web admin)
        abrirModalAgendarInstalacion(cli);
    }

    // 🆕 Modal "Agendar Instalación" — replica exactamente el flujo del web admin
    // 1. Muestra cliente + cédula
    // 2. Carga PDF automáticamente desde /api/pdf-instalacion-por-cedula
    // 3. Selector de zona → POST /api/agendar-instalacion
    function abrirModalAgendarInstalacion(cliente) {
        const ZONAS = ['REPOSO','SALVADOR','BOSQUE LOS ALMENDROS','CHURIDO','SALSIPUEDES','RIO GRANDE','MI LUCHA','OSITO'];
        let pdfFile = null; // File que vamos a enviar
        let zonaSeleccionada = null;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const lbl = 'display:block; font-size:0.82em; font-weight:600; color:#555; margin-bottom:6px;';
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:94vh; display:flex; flex-direction:column;">
                <div class="modal-header" style="background:linear-gradient(135deg,#16a34a,#15803d);">
                    <h3><i class="fas fa-calendar-plus"></i> Agendar Instalación</h3>
                    <button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button>
                </div>
                <div class="modal-body" style="padding:14px 18px; overflow-y:auto;">
                    <div style="background:#dcfce7; padding:10px; border-radius:8px; margin-bottom:14px; border-left:3px solid #16a34a;">
                        <div style="font-size:0.78em; color:#15803d; font-weight:600;"><i class="fas fa-user"></i> Cliente</div>
                        <div style="font-weight:600; margin-top:2px;">${escapeHtml(cliente.nombre || cliente.movil || 'Sin nombre')}</div>
                        <div style="font-size:0.82em; color:#444; margin-top:2px;">
                            <i class="fas fa-id-card"></i> CC ${escapeHtml(cliente.cedula || '—')} ·
                            <i class="fas fa-file-contract"></i> ${escapeHtml(cliente.numero_contrato || '—')}
                        </div>
                    </div>

                    <label style="${lbl}"><i class="fas fa-file-pdf"></i> PDF de inscripción *</label>
                    <div id="ai-pdf-status" style="background:#f8f9fa; padding:10px; border-radius:8px; font-size:0.85em; margin-bottom:6px;">
                        <i class="fas fa-spinner fa-spin"></i> Buscando PDF automáticamente…
                    </div>
                    <input type="file" id="ai-pdf-input" accept="application/pdf" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:8px; margin-bottom:14px; font-size:0.85em;">

                    <label style="${lbl}"><i class="fas fa-map-marker-alt"></i> Zona de instalación *</label>
                    <div id="ai-zonas" style="display:grid; grid-template-columns:repeat(2,1fr); gap:6px;">
                        ${ZONAS.map(z => `
                            <button type="button" class="ai-zona-btn" data-zona="${z}" style="padding:11px 6px; background:#f0fdf4; border:2px solid #bbf7d0; color:#15803d; border-radius:8px; font-size:0.82em; font-weight:600; cursor:pointer;">
                                <i class="fas fa-map-pin"></i> ${z}
                            </button>
                        `).join('')}
                        <button type="button" class="ai-zona-btn" data-zona="OTRO" style="grid-column:span 2; padding:11px; background:#fef3c7; border:2px solid #fcd34d; color:#92400e; border-radius:8px; font-size:0.82em; font-weight:600; cursor:pointer;">
                            <i class="fas fa-pen"></i> Otra zona…
                        </button>
                    </div>
                    <div id="ai-zona-otra-container" style="display:none; margin-top:10px;">
                        <input type="text" id="ai-zona-otra" placeholder="Nombre de la zona…" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; font-size:0.9em; box-sizing:border-box;">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="ai-submit" disabled style="background:#16a34a; opacity:0.5;"><i class="fas fa-calendar-check"></i> Agendar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();

        const submitBtn = overlay.querySelector('#ai-submit');
        const updateSubmit = () => {
            const ok = pdfFile && zonaSeleccionada;
            submitBtn.disabled = !ok;
            submitBtn.style.opacity = ok ? '1' : '0.5';
        };

        // Auto-cargar PDF de inscripción por cédula
        const statusEl = overlay.querySelector('#ai-pdf-status');
        const fileInput = overlay.querySelector('#ai-pdf-input');
        if (cliente.cedula) {
            (async () => {
                try {
                    const resp = await fetch(APP_CONFIG.SERVER_URL + `/api/pdf-instalacion-por-cedula/${encodeURIComponent(cliente.cedula)}`, {
                        headers: { 'Authorization': 'Bearer ' + API.getToken() }
                    });
                    if (!resp.ok) {
                        statusEl.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:#dc3545;"></i> No se encontró el PDF en servidor. Adjunta manualmente.';
                        return;
                    }
                    const cd = resp.headers.get('Content-Disposition') || '';
                    let fname = `Formulario_Registro_${cliente.numero_contrato || cliente.cedula}.pdf`;
                    const m = cd.match(/filename="(.+)"/);
                    if (m && m[1]) fname = m[1];
                    const blob = await resp.blob();
                    pdfFile = new File([blob], fname, { type: 'application/pdf' });
                    statusEl.innerHTML = `<i class="fas fa-check-circle" style="color:#16a34a;"></i> <b>PDF cargado:</b> ${escapeHtml(fname)} <span style="color:#888;">(${Math.round(blob.size/1024)} KB)</span>`;
                    // Reflejar en el input file
                    try {
                        const dt = new DataTransfer();
                        dt.items.add(pdfFile);
                        fileInput.files = dt.files;
                    } catch {}
                    updateSubmit();
                } catch (e) {
                    statusEl.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:#dc3545;"></i> Error: ' + e.message;
                }
            })();
        } else {
            statusEl.innerHTML = '<i class="fas fa-info-circle"></i> Cliente sin cédula. Adjunta el PDF manualmente.';
        }

        // Manual file upload
        fileInput.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (f) {
                // 🛡️ v2026-06-02: forzar MIME a application/pdf si el nombre termina en .pdf.
                // En Android WebView el file picker a veces devuelve type='application/octet-stream'
                // y multer del servidor rechazaba el archivo → app quedaba colgada "Agendando…"
                if (/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
                    pdfFile = new File([f], f.name, { type: 'application/pdf' });
                } else {
                    pdfFile = f;
                }
                statusEl.innerHTML = `<i class="fas fa-check-circle" style="color:#16a34a;"></i> Archivo manual: ${escapeHtml(f.name)}`;
                updateSubmit();
            }
        });

        // Selector de zona
        overlay.querySelectorAll('.ai-zona-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const z = btn.dataset.zona;
                if (z === 'OTRO') {
                    overlay.querySelector('#ai-zona-otra-container').style.display = 'block';
                    overlay.querySelector('#ai-zona-otra').focus();
                    zonaSeleccionada = null;
                    updateSubmit();
                    return;
                }
                // Marcar visualmente la zona seleccionada
                overlay.querySelectorAll('.ai-zona-btn').forEach(b => {
                    b.style.background = b.dataset.zona === 'OTRO' ? '#fef3c7' : '#f0fdf4';
                    b.style.borderColor = b.dataset.zona === 'OTRO' ? '#fcd34d' : '#bbf7d0';
                });
                btn.style.background = '#16a34a';
                btn.style.borderColor = '#15803d';
                btn.style.color = 'white';
                zonaSeleccionada = z;
                overlay.querySelector('#ai-zona-otra-container').style.display = 'none';
                updateSubmit();
            });
        });
        overlay.querySelector('#ai-zona-otra').addEventListener('input', (e) => {
            const v = e.target.value.trim().toUpperCase();
            zonaSeleccionada = v || null;
            updateSubmit();
        });

        // Submit
        submitBtn.onclick = async () => {
            if (!pdfFile || !zonaSeleccionada) return;
            if (!confirm(`¿Agendar instalación para ${cliente.nombre || 'este cliente'} en zona ${zonaSeleccionada}?`)) return;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Agendando…';
            try {
                const fd = new FormData();
                fd.append('clienteId', cliente.id);
                fd.append('zona', zonaSeleccionada);
                fd.append('pdf_instalacion', pdfFile);
                const r = await fetch(APP_CONFIG.SERVER_URL + '/api/agendar-instalacion', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + API.getToken() },
                    body: fd
                });
                const data = await r.json();
                if (r.ok && data.success) {
                    alert('✅ ' + (data.message || 'Instalación agendada exitosamente'));
                    overlay.remove();
                } else {
                    alert('❌ ' + (data.message || 'Error al agendar instalación'));
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fas fa-calendar-check"></i> Agendar';
                }
            } catch (err) {
                alert('Error de red: ' + err.message);
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-calendar-check"></i> Agendar';
            }
        };
    }

    // 🆕 Overlay con barra de progreso para descargas de PDF
    function showPdfProgress(label) {
        let ov = document.getElementById('pdf-dl-overlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'pdf-dl-overlay';
            ov.style.cssText = `position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:99998; display:flex; align-items:center; justify-content:center;`;
            ov.innerHTML = `
                <div style="background:white; padding:18px 22px; border-radius:14px; min-width:240px; max-width:88%; box-shadow:0 8px 24px rgba(0,0,0,0.25); text-align:center;">
                    <div id="pdf-dl-label" style="font-weight:600; color:#0066cc; margin-bottom:10px; font-size:0.92em;"><i class="fas fa-file-pdf"></i> ${label || 'Cargando PDF…'}</div>
                    <div style="background:#e0e0e0; height:8px; border-radius:4px; overflow:hidden;">
                        <div id="pdf-dl-bar" style="background:linear-gradient(90deg,#0084ff,#0066cc); height:100%; width:0%; transition:width 0.2s;"></div>
                    </div>
                    <div id="pdf-dl-pct" style="margin-top:8px; font-size:0.8em; color:#666;">0%</div>
                </div>
            `;
            document.body.appendChild(ov);
        }
        return ov;
    }
    function updatePdfProgress(pct, text) {
        const bar = document.getElementById('pdf-dl-bar');
        const pctEl = document.getElementById('pdf-dl-pct');
        const lab = document.getElementById('pdf-dl-label');
        if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
        if (pctEl) pctEl.textContent = (pct >= 0 ? Math.round(pct) : '') + '%';
        if (lab && text) lab.innerHTML = '<i class="fas fa-file-pdf"></i> ' + text;
    }
    function hidePdfProgress() {
        const ov = document.getElementById('pdf-dl-overlay');
        if (ov) ov.remove();
    }

    // 🆕 Abrir el PDF del cliente externo (formulario de inscripción o contrato)
    // con barra de progreso REAL durante la descarga
    async function descargarYAbrirPdf(url, filenameSugerido) {
        showPdfProgress('Descargando…');
        try {
            const resp = await fetch(APP_CONFIG.SERVER_URL + url, {
                headers: { 'Authorization': 'Bearer ' + API.getToken() }
            });
            if (!resp.ok) {
                hidePdfProgress();
                if (typeof showToast === 'function') showToast('No se encontró el PDF en el servidor', 'error');
                else alert('No se encontró el PDF en el servidor');
                return;
            }
            const cd = resp.headers.get('Content-Disposition') || '';
            let fileName = filenameSugerido || 'documento.pdf';
            const m = cd.match(/filename="(.+)"/);
            if (m && m[1]) fileName = m[1];

            // Leer en chunks para mostrar progreso real
            const total = parseInt(resp.headers.get('Content-Length') || '0', 10);
            const reader = resp.body?.getReader?.();
            let blob;
            if (reader && total > 0) {
                const chunks = [];
                let received = 0;
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    received += value.length;
                    updatePdfProgress((received / total) * 100);
                }
                blob = new Blob(chunks, { type: 'application/pdf' });
            } else {
                blob = await resp.blob();
                updatePdfProgress(95);
            }
            updatePdfProgress(100, 'Abriendo…');
            hidePdfProgress();

            // 🆕 v2026-05-25: VISOR PDF IN-APP con PDF.js — NO descarga, abre dentro de la propia app
            await abrirPdfEnVisor(blob, fileName);
        } catch (e) {
            hidePdfProgress();
            console.error('[descargarYAbrirPdf] Error:', e);
            alert('No se pudo abrir el PDF: ' + e.message);
        }
    }

    // 🆕 v2026-05-25: Visor PDF in-app usando PDF.js (Mozilla).
    // Renderiza dentro de la propia app — no requiere FileOpener ni descarga al sistema.
    async function abrirPdfEnVisor(blob, fileName) {
        // Cargar PDF.js dinámicamente si no está cargado todavía
        if (!window.pdfjsLib) {
            await cargarPdfJs();
        }
        const pdfjs = window.pdfjsLib;
        const buf = await blob.arrayBuffer();
        const pdfDoc = await pdfjs.getDocument({ data: buf }).promise;
        const totalPages = pdfDoc.numPages;
        let currentPage = 1;
        let currentScale = 1.0;

        // Construir modal full-screen
        const overlay = document.createElement('div');
        overlay.id = 'pdf-viewer-overlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; background: #1a1a1a; z-index: 99999;
            display: flex; flex-direction: column; padding-top: env(safe-area-inset-top, 0);
        `;
        overlay.innerHTML = `
            <div style="background:#2d2d2d; color:white; padding:10px 14px; display:flex; align-items:center; gap:10px; box-shadow:0 2px 4px rgba(0,0,0,0.3);">
                <button id="pdf-close" style="background:none; border:none; color:white; font-size:1.3em; cursor:pointer;"><i class="fas fa-arrow-left"></i></button>
                <div style="flex:1; font-size:0.92em; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${(fileName || 'PDF').replace(/[<>]/g, '')}</div>
                <button id="pdf-zoom-out" style="background:none; border:none; color:white; font-size:1.05em; cursor:pointer;"><i class="fas fa-search-minus"></i></button>
                <span id="pdf-zoom-label" style="font-size:0.75em; min-width:38px; text-align:center;">100%</span>
                <button id="pdf-zoom-in" style="background:none; border:none; color:white; font-size:1.05em; cursor:pointer;"><i class="fas fa-search-plus"></i></button>
                <button id="pdf-share" style="background:none; border:none; color:white; font-size:1.05em; cursor:pointer;" title="Descargar / compartir"><i class="fas fa-download"></i></button>
            </div>
            <div id="pdf-canvas-wrap" style="flex:1; overflow:auto; background:#1a1a1a; display:flex; justify-content:center; align-items:start; padding:14px;">
                <canvas id="pdf-canvas" style="background:white; max-width:100%; height:auto; box-shadow:0 4px 16px rgba(0,0,0,0.5);"></canvas>
            </div>
            <div style="background:#2d2d2d; color:white; padding:10px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
                <button id="pdf-prev" style="background:#444; color:white; border:none; padding:8px 14px; border-radius:8px; font-size:0.9em; cursor:pointer;"><i class="fas fa-chevron-left"></i> Anterior</button>
                <div id="pdf-page-info" style="font-size:0.88em; font-weight:600;">${currentPage} / ${totalPages}</div>
                <button id="pdf-next" style="background:#444; color:white; border:none; padding:8px 14px; border-radius:8px; font-size:0.9em; cursor:pointer;">Siguiente <i class="fas fa-chevron-right"></i></button>
            </div>
        `;
        document.body.appendChild(overlay);

        const canvas = overlay.querySelector('#pdf-canvas');
        const ctx = canvas.getContext('2d');

        async function renderPage(pageNum) {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: currentScale * 1.5 }); // 1.5x para más nitidez
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.width = (viewport.width / 1.5 * currentScale).toFixed(0) + 'px';
            await page.render({ canvasContext: ctx, viewport }).promise;
            overlay.querySelector('#pdf-page-info').textContent = `${pageNum} / ${totalPages}`;
            overlay.querySelector('#pdf-prev').disabled = pageNum <= 1;
            overlay.querySelector('#pdf-next').disabled = pageNum >= totalPages;
            overlay.querySelector('#pdf-zoom-label').textContent = Math.round(currentScale * 100) + '%';
        }

        await renderPage(currentPage);

        // Handlers
        overlay.querySelector('#pdf-close').onclick = () => overlay.remove();
        overlay.querySelector('#pdf-prev').onclick = () => { if (currentPage > 1) { currentPage--; renderPage(currentPage); } };
        overlay.querySelector('#pdf-next').onclick = () => { if (currentPage < totalPages) { currentPage++; renderPage(currentPage); } };
        overlay.querySelector('#pdf-zoom-in').onclick = () => { if (currentScale < 3) { currentScale = Math.min(3, currentScale + 0.25); renderPage(currentPage); } };
        overlay.querySelector('#pdf-zoom-out').onclick = () => { if (currentScale > 0.5) { currentScale = Math.max(0.5, currentScale - 0.25); renderPage(currentPage); } };
        // Botón compartir/descargar (opcional, por si quieren guardarlo después de verlo)
        overlay.querySelector('#pdf-share').onclick = async () => {
            try {
                const isNative = !!(window.Capacitor && (window.Capacitor.isNativePlatform?.() || window.Capacitor.platform !== 'web'));
                if (isNative && window.Capacitor.Plugins?.Filesystem) {
                    const { Filesystem } = window.Capacitor.Plugins;
                    const rd = new FileReader();
                    await new Promise((resolve, reject) => { rd.onloadend = resolve; rd.onerror = reject; rd.readAsDataURL(blob); });
                    const base64 = String(rd.result).split(',')[1] || '';
                    const safe = (fileName || 'documento.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
                    await Filesystem.writeFile({ path: `SolucNet/${safe}`, data: base64, directory: 'DOCUMENTS', recursive: true });
                    alert(`✅ Guardado en Documents/SolucNet/${safe}`);
                } else {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = fileName || 'documento.pdf';
                    a.click();
                }
            } catch (e) { alert('No se pudo descargar: ' + e.message); }
        };

        // ESC y atrás de Android cierran el visor
        const escHandler = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);
    }

    // 🆕 v2026-05-25: Cargar PDF.js autohospedado en cliente.solucnet.com/libs/pdfjs/
    // Hospedarlo localmente evita problemas de CDN externo bloqueado en WebView Capacitor.
    function cargarPdfJs() {
        if (window.pdfjsLib) return Promise.resolve();
        showPdfProgress('Cargando visor…');
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = APP_CONFIG.SERVER_URL + '/libs/pdfjs/pdf.min.js';
            s.onload = () => {
                if (window.pdfjsLib) {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = APP_CONFIG.SERVER_URL + '/libs/pdfjs/pdf.worker.min.js';
                    hidePdfProgress();
                    resolve();
                } else {
                    hidePdfProgress();
                    reject(new Error('PDF.js cargó pero no expuso pdfjsLib'));
                }
            };
            s.onerror = () => {
                hidePdfProgress();
                reject(new Error('No se pudo descargar PDF.js'));
            };
            document.head.appendChild(s);
        });
    }

    function abrirFormulario(cedula, numeroContrato) {
        descargarYAbrirPdf(`/api/pdf-instalacion-por-cedula/${encodeURIComponent(cedula)}`, `Formulario_Registro_${numeroContrato || cedula}.pdf`);
    }
    function abrirContrato(cedula, numeroContrato) {
        descargarYAbrirPdf(`/api/contrato-por-cedula/${encodeURIComponent(cedula)}`, `Contrato_${numeroContrato || cedula}.pdf`);
    }

    // 🆕 v2026-06-01: Registrar instalación (paridad con el panel web)
    // Muestra sub-modal con las 3 BDs (REPOSO/CHURIDO/RIO_GRANDE), envía POST a
    // /api/registrar-instalacion con la BD elegida y muestra el resultado.
    function registrarInstalacion(clienteId) {
        const cliente = clientes.find(x => x.id === clienteId);
        if (!cliente) { showToast('Cliente no encontrado', 'error'); return; }

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const bdBtn = (key, nombre, ip, color) => `
            <button type="button" class="bd-pick" data-bd="${key}" style="display:flex; justify-content:space-between; align-items:center; width:100%; background:white; border:1px solid #e5e7eb; padding:14px; border-radius:10px; margin-bottom:6px; cursor:pointer; text-align:left;">
                <div>
                    <div style="font-weight:700; color:${color}; font-size:1em;"><i class="fas fa-database"></i> ${nombre}</div>
                    <div style="font-size:0.75em; color:#666; margin-top:2px;">${ip} — Mikrowisp6</div>
                </div>
                <i class="fas fa-chevron-right" style="color:#ccc;"></i>
            </button>
        `;
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3><i class="fas fa-tools"></i> Registrar instalación</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <div style="background:#eff6ff; padding:10px; border-radius:8px; margin-bottom:14px; font-size:0.85em;">
                        <div><b>Cliente:</b> ${escapeHtml(cliente.nombre || '-')}</div>
                        <div><b>Cédula:</b> ${escapeHtml(cliente.cedula || '-')}</div>
                        ${cliente.plan_contratado ? `<div><b>Plan:</b> ${escapeHtml(cliente.plan_contratado)}</div>` : ''}
                    </div>
                    <div style="font-size:0.85em; font-weight:600; color:#374151; margin-bottom:8px;"><i class="fas fa-server"></i> Seleccione la base de datos de destino:</div>
                    ${bdBtn('REPOSO', 'REPOSO', '192.168.99.50', '#0066cc')}
                    ${bdBtn('CHURIDO', 'CHURIDO', '192.168.99.11', '#16a34a')}
                    ${bdBtn('RIO_GRANDE', 'RIO GRANDE', '192.168.99.2', '#f59e0b')}
                    <div id="reg-inst-status" style="margin-top:8px; font-size:0.82em; color:#666; text-align:center;"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const status = overlay.querySelector('#reg-inst-status');
        overlay.querySelectorAll('.bd-pick').forEach(btn => {
            btn.addEventListener('click', async () => {
                const bd = btn.dataset.bd;
                // Bloquear todos los botones mientras se procesa
                overlay.querySelectorAll('.bd-pick').forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
                status.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrando…';
                try {
                    const notas = cliente.plan_contratado ? `Plan contratado: ${cliente.plan_contratado}` : '';
                    const data = await API.post('/api/registrar-instalacion', {
                        clienteId: cliente.id,
                        baseDatos: bd,
                        notas
                    });
                    if (data?.success) {
                        showToast(`✅ ${data.message || 'Instalación registrada'}`, 'success');
                        setTimeout(() => overlay.remove(), 800);
                    } else {
                        status.innerHTML = `<span style="color:#dc3545;">${escapeHtml(data?.message || 'Error desconocido')}</span>`;
                        overlay.querySelectorAll('.bd-pick').forEach(b => { b.disabled = false; b.style.opacity = ''; });
                    }
                } catch (err) {
                    status.innerHTML = `<span style="color:#dc3545;">Error de red: ${escapeHtml(err.message || '')}</span>`;
                    overlay.querySelectorAll('.bd-pick').forEach(b => { b.disabled = false; b.style.opacity = ''; });
                }
            });
        });
    }

    return { show, sincronizar, prevPage, nextPage, programarVisita, abrirFormulario, abrirContrato, registrarInstalacion };
})();

if (typeof Router !== 'undefined') Router.register('clientes', () => ClientesPage.show());
