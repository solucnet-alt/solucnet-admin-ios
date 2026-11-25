// Página: Reportados / Cobranza (app admin) — réplica móvil del panel web reportados.html + public/reportados.js
// Patrón tomado de js/pages/verificacion-pagos.js (page dinámica, tabs, modales, toast, auto-refresh).
//
// Permisos:
//   - Entrada (lectura): ver_cobranza  → ya gateado por el drawer (data-permiso="ver_cobranza").
//   - Acciones (escritura): gestionar_cobranza → botones con data-perm="gestionar_cobranza" + Perms.apply().
//
// Endpoints backend (todos requireAuth; ya existen, usados por el panel web):
//   GET    /api/cobranza/estadisticas                 → dashboard (KPIs, motor_activo, distribucion_mora, mensajes_semana)
//   POST   /api/cobranza/sincronizar-morosos          → sincroniza morosos desde MikroWisp     [gestionar]
//   POST   /api/cobranza/ejecutar-motor               → corre el motor manualmente              [gestionar]
//   PUT    /api/cobranza/motor/pausar | /motor/reanudar → toggle del motor                      [gestionar]
//   GET    /api/cobranza/morosos?pagina=&limite=&busqueda=&estado_cobranza=&estado_cliente=&dias_mora_min=&dias_mora_max=
//   GET    /api/cobranza/morosos/:id                  → detalle de un moroso
//   PUT    /api/cobranza/morosos/:id                  → editar                                  [gestionar]
//   DELETE /api/cobranza/morosos/:id                  → eliminar                                [gestionar]
//   POST   /api/cobranza/enviar-mensaje  {moroso_id, canal, mensaje}                            [gestionar]
//   POST   /api/cobranza/enviar-masivo   {morosos_ids, canal, plantilla_id}                     [gestionar]
//   GET    /api/cobranza/historial?pagina=&limite=&canal=&fecha_desde=
//   GET    /api/cobranza/plantillas                   → plantillas (para el envío)
//   GET    /api/cobranza/config  |  PUT /api/cobranza/config                                    [gestionar]
//   GET    /api/cobranza/logs?limit=&tipo=
const CobranzaPage = (function () {
    let _tab = 'dashboard';         // dashboard | morosos | historial | plantillas | config | logs
    let _pagina = 1;
    let _totalPaginas = 1;
    let _seleccion = [];            // ids de morosos seleccionados para envío masivo
    let _plantillasCache = [];
    let _motorActivo = false;
    let _refresh = null;
    let _modalAbierto = false;
    let _buscarTimer = null;

    // ---------- helpers ----------
    function escapeHtml(s) { const d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; }
    function money(v) { return '$' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Number(v) || 0); }
    function fecha(f) { if (!f) return '-'; const d = new Date(f); return isNaN(d) ? '-' : d.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    function fechaCorta(f) { if (!f) return '-'; const d = new Date(f); return isNaN(d) ? '-' : d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' }); }
    function puedeGestionar() { try { return !!(window.Perms && Perms.can('gestionar_cobranza')); } catch (e) { return false; } }

    function toast(msg, tipo) {
        const t = document.getElementById('toast'); if (!t) { alert(msg); return; }
        t.textContent = msg; t.className = 'toast show' + (tipo === 'error' ? ' error' : tipo === 'success' ? ' success' : '');
        clearTimeout(t._to); t._to = setTimeout(() => { t.className = 'toast'; }, 3500);
    }

    function badgeEstadoCobranza(estado) {
        const e = String(estado || '').toLowerCase();
        let cls = 'sn-badge--off';
        if (e === 'activo') cls = 'sn-badge--danger';
        else if (e === 'pausado') cls = 'sn-badge--warn';
        else if (e === 'convenio') cls = 'sn-badge--info';
        else if (e === 'pagado') cls = 'sn-badge--ok';
        return `<span class="sn-badge ${cls}">${escapeHtml(estado || '-')}</span>`;
    }
    function badgeEstadoCliente(estado) {
        const e = String(estado || '').toUpperCase();
        let cls = 'sn-badge--off';
        if (e === 'SUSPENDIDO') cls = 'sn-badge--warn';
        else if (e === 'ACTIVO') cls = 'sn-badge--ok';
        else if (e === 'RETIRADO') cls = 'sn-badge--danger';
        return `<span class="sn-badge ${cls}">${escapeHtml(estado || '-')}</span>`;
    }
    function badgeCanal(canal) {
        const c = String(canal || '').toLowerCase();
        let cls = 'sn-badge--off', icon = 'fa-comment';
        if (c === 'whatsapp') { cls = 'sn-badge--ok'; icon = 'fab fa-whatsapp'; return `<span class="sn-badge ${cls}"><i class="${icon}"></i> ${escapeHtml(canal)}</span>`; }
        if (c === 'sms') { cls = 'sn-badge--info'; icon = 'fas fa-sms'; }
        else if (c === 'sms_flash') { cls = 'sn-badge--warn'; icon = 'fas fa-bolt'; }
        else icon = 'fas fa-comment';
        return `<span class="sn-badge ${cls}"><i class="${icon}"></i> ${escapeHtml(canal)}</span>`;
    }
    function badgeEstadoEnvio(estado) {
        const e = String(estado || '').toLowerCase();
        let cls = 'sn-badge--off';
        if (e === 'enviado' || e === 'entregado') cls = 'sn-badge--ok';
        else if (e === 'fallido') cls = 'sn-badge--danger';
        else if (e === 'pendiente') cls = 'sn-badge--warn';
        return `<span class="sn-badge ${cls}">${escapeHtml(estado || '-')}</span>`;
    }

    // ---------- page lifecycle ----------
    function ensurePage() {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const main = document.querySelector('.app-main');
        let page = document.getElementById('page-cobranza');
        if (!page) { page = document.createElement('div'); page.id = 'page-cobranza'; page.className = 'page'; main.appendChild(page); }
        page.classList.add('active');
        return page;
    }
    function activa() { const p = document.getElementById('page-cobranza'); return p && p.classList.contains('active'); }

    const TABS = [
        { k: 'dashboard', ic: 'fa-gauge-high', t: 'Panel' },
        { k: 'morosos', ic: 'fa-users', t: 'Morosos' },
        { k: 'historial', ic: 'fa-clock-rotate-left', t: 'Historial' },
        { k: 'plantillas', ic: 'fa-bolt', t: 'Plantillas' },
        { k: 'config', ic: 'fa-sliders', t: 'Config' },
        { k: 'logs', ic: 'fa-list', t: 'Logs' }
    ];

    async function show() {
        const page = ensurePage();
        page.innerHTML = `
          <div style="padding:var(--sn-space-3); max-width:900px; margin:0 auto;">
            <h2 style="margin:var(--sn-space-1) 0 var(--sn-space-3); font-size:var(--sn-text-xl); color:var(--sn-text-primary);">
              <i class="fas fa-hand-holding-dollar"></i> Reportados / Cobranza
            </h2>
            <div id="cobTabs" style="display:flex; gap:var(--sn-space-2); overflow-x:auto; padding-bottom:var(--sn-space-2); margin-bottom:var(--sn-space-3); -webkit-overflow-scrolling:touch;">
              ${TABS.map(t => `<button class="sn-btn sn-btn--sm cob-tab" data-k="${t.k}" style="flex:0 0 auto;"><i class="fas ${t.ic}"></i> ${t.t}</button>`).join('')}
            </div>
            <div id="cobBody"></div>
          </div>`;
        page.querySelectorAll('.cob-tab').forEach(b => b.onclick = () => { _tab = b.dataset.k; pintarTabs(); cargarTab(); });
        pintarTabs();
        cargarTab();

        // auto-refresh del dashboard cada 15s si está visible y sin modal
        if (_refresh) clearInterval(_refresh);
        _refresh = setInterval(() => {
            if (activa() && !_modalAbierto && document.visibilityState === 'visible' && _tab === 'dashboard') cargarDashboard();
        }, 15000);
    }

    function pintarTabs() {
        document.querySelectorAll('.cob-tab').forEach(b => {
            const on = b.dataset.k === _tab;
            b.classList.toggle('sn-btn--primary', on);
        });
    }

    function cargarTab() {
        const body = document.getElementById('cobBody'); if (!body) return;
        body.innerHTML = `<div class="sn-empty"><i class="fas fa-spinner fa-spin"></i><p>Cargando…</p></div>`;
        switch (_tab) {
            case 'dashboard': return cargarDashboard();
            case 'morosos': return cargarMorososTab();
            case 'historial': return cargarHistorialTab();
            case 'plantillas': return cargarPlantillasTab();
            case 'config': return cargarConfigTab();
            case 'logs': return cargarLogsTab();
        }
    }

    // ---------- DASHBOARD ----------
    async function cargarDashboard() {
        const body = document.getElementById('cobBody'); if (!body || _tab !== 'dashboard') return;
        try {
            const d = await API.get('/api/cobranza/estadisticas');
            const s = (d && d.estadisticas) || {};
            const mor = s.morosos || {}, msg = s.mensajes_hoy || {};
            _motorActivo = !!s.motor_activo;
            const stat = (num, label) => `<div class="sn-stat"><div class="sn-stat__num">${num}</div><div class="sn-stat__label">${label}</div></div>`;
            const dist = (s.distribucion_mora || []).map(r => {
                const max = Math.max(1, ...(s.distribucion_mora || []).map(x => Number(x.cantidad) || 0));
                const pct = Math.round(((Number(r.cantidad) || 0) / max) * 100);
                return `<div style="margin-bottom:var(--sn-space-2);">
                    <div style="display:flex; justify-content:space-between; font-size:var(--sn-text-xs); color:var(--sn-text-secondary);"><span>${escapeHtml(r.rango)}</span><span>${r.cantidad}</span></div>
                    <div style="height:8px; background:var(--sn-surface-2); border-radius:var(--sn-radius-full); overflow:hidden;"><div style="height:100%; width:${pct}%; background:var(--brand-grad); border-radius:var(--sn-radius-full);"></div></div>
                  </div>`;
            }).join('') || `<div style="color:var(--sn-text-tertiary); font-size:var(--sn-text-sm);">Sin datos de distribución.</div>`;

            body.innerHTML = `
              <div class="sn-card" style="display:flex; align-items:center; justify-content:space-between; gap:var(--sn-space-3);">
                <div>
                  <div class="sn-section-title" style="margin:0 0 var(--sn-space-1);">Motor de cobranza</div>
                  <div id="cobMotorTxt" style="font-weight:var(--sn-weight-semibold); color:${_motorActivo ? 'var(--sn-success)' : 'var(--sn-text-tertiary)'};">
                    ${_motorActivo ? '● Activo' : '○ Pausado'}
                  </div>
                </div>
                <button id="cobBtnMotor" class="sn-btn ${_motorActivo ? 'sn-btn--danger' : 'sn-btn--success'}" data-perm="gestionar_cobranza">
                  <i class="fas ${_motorActivo ? 'fa-pause' : 'fa-play'}"></i> ${_motorActivo ? 'Pausar' : 'Activar'}
                </button>
              </div>

              <div class="sn-grid-2" style="margin-bottom:var(--sn-space-3);">
                ${stat(mor.activos || 0, 'Morosos activos')}
                ${stat(money(mor.deuda_total_activa || 0), 'Deuda total')}
                ${stat(msg.total || 0, 'Mensajes hoy')}
                ${stat(Math.round(mor.promedio_dias_mora || 0) + ' días', 'Mora promedio')}
              </div>

              <div class="sn-card">
                <div class="sn-section-title" style="margin-top:0;">Distribución de mora</div>
                ${dist}
                <div style="margin-top:var(--sn-space-2); font-size:var(--sn-text-xs); color:var(--sn-text-tertiary);">
                  Enviados hoy: <b>${msg.enviados || 0}</b> · Fallidos: <b>${msg.fallidos || 0}</b>
                </div>
              </div>

              <div class="sn-grid-2">
                <button id="cobBtnSync" class="sn-btn sn-btn--ghost" data-perm="gestionar_cobranza"><i class="fas fa-rotate"></i> Sincronizar morosos</button>
                <button id="cobBtnMotorManual" class="sn-btn sn-btn--primary" data-perm="gestionar_cobranza"><i class="fas fa-bolt"></i> Ejecutar motor</button>
              </div>`;

            body.querySelector('#cobBtnMotor').onclick = toggleMotor;
            body.querySelector('#cobBtnSync').onclick = sincronizar;
            body.querySelector('#cobBtnMotorManual').onclick = ejecutarMotor;
            if (window.Perms) Perms.apply(body);
        } catch (e) { body.innerHTML = `<div class="sn-empty"><i class="fas fa-triangle-exclamation"></i><p>${escapeHtml(e.message)}</p></div>`; }
    }

    async function toggleMotor() {
        if (!puedeGestionar()) return toast('Sin permiso para gestionar cobranza', 'error');
        try {
            const ep = _motorActivo ? '/api/cobranza/motor/pausar' : '/api/cobranza/motor/reanudar';
            const r = await API.put(ep, {});
            if (r && r.success !== false) { _motorActivo = !_motorActivo; toast(_motorActivo ? 'Motor activado ✓' : 'Motor pausado ✓', 'success'); cargarDashboard(); }
            else toast((r && r.message) || 'Error', 'error');
        } catch (e) { toast('Error: ' + e.message, 'error'); }
    }
    async function sincronizar() {
        if (!puedeGestionar()) return toast('Sin permiso para gestionar cobranza', 'error');
        toast('Sincronizando morosos…', 'info');
        try {
            const r = await API.post('/api/cobranza/sincronizar-morosos', {});
            if (r && r.success) { toast(`Sincronización: ${r.resultado?.total_sincronizados || 0} morosos`, 'success'); cargarDashboard(); }
            else toast((r && r.message) || 'Error en sincronización', 'error');
        } catch (e) { toast('Error: ' + e.message, 'error'); }
    }
    async function ejecutarMotor() {
        if (!puedeGestionar()) return toast('Sin permiso para gestionar cobranza', 'error');
        if (!confirm('¿Ejecutar el motor de cobranza ahora? Enviará los mensajes según las reglas activas.')) return;
        toast('Ejecutando motor…', 'info');
        try {
            const r = await API.post('/api/cobranza/ejecutar-motor', {});
            if (r && r.success) { toast(`Motor ejecutado: ${r.resultados?.enviados || 0} mensajes`, 'success'); cargarDashboard(); }
            else toast((r && r.message) || 'Error ejecutando motor', 'error');
        } catch (e) { toast('Error: ' + e.message, 'error'); }
    }

    // ---------- MOROSOS ----------
    function cargarMorososTab() {
        const body = document.getElementById('cobBody'); if (!body) return;
        body.innerHTML = `
          <div class="search-bar" style="display:flex; align-items:center; gap:var(--sn-space-2); background:var(--sn-surface); border:1px solid var(--sn-border); border-radius:var(--sn-radius-md); padding:var(--sn-space-2) var(--sn-space-3); margin-bottom:var(--sn-space-2);">
            <i class="fas fa-search" style="color:var(--sn-text-tertiary);"></i>
            <input id="cobBuscar" type="text" placeholder="Buscar por nombre, cédula o teléfono…" style="border:none; outline:none; background:transparent; flex:1; min-height:auto; color:var(--sn-text-primary);">
          </div>
          <div style="display:flex; gap:var(--sn-space-2); margin-bottom:var(--sn-space-2); flex-wrap:wrap;">
            <select id="cobFEstado" style="flex:1; min-width:120px; padding:var(--sn-space-2); border:1px solid var(--sn-border); border-radius:var(--sn-radius-md); background:var(--sn-surface); color:var(--sn-text-primary);">
              <option value="">Estado cobranza</option>
              <option value="activo">Activo</option><option value="pausado">Pausado</option>
              <option value="convenio">Convenio</option><option value="pagado">Pagado</option>
            </select>
            <select id="cobFCliente" style="flex:1; min-width:120px; padding:var(--sn-space-2); border:1px solid var(--sn-border); border-radius:var(--sn-radius-md); background:var(--sn-surface); color:var(--sn-text-primary);">
              <option value="">Estado cliente</option>
              <option value="ACTIVO">Activo</option><option value="SUSPENDIDO">Suspendido</option><option value="RETIRADO">Retirado</option>
            </select>
          </div>
          <div id="cobMasivoBar" style="display:none; align-items:center; justify-content:space-between; gap:var(--sn-space-2); margin-bottom:var(--sn-space-2); padding:var(--sn-space-2) var(--sn-space-3); background:var(--brand-100); border-radius:var(--sn-radius-md);">
            <span style="font-size:var(--sn-text-sm); color:var(--brand-800);"><b id="cobSelCount">0</b> seleccionados</span>
            <button id="cobBtnMasivo" class="sn-btn sn-btn--sm sn-btn--primary" data-perm="gestionar_cobranza"><i class="fas fa-paper-plane"></i> Envío masivo</button>
          </div>
          <div id="cobMorosos"></div>
          <div id="cobPaginacion" style="display:flex; gap:var(--sn-space-1); justify-content:center; flex-wrap:wrap; margin-top:var(--sn-space-3);"></div>`;

        const inp = body.querySelector('#cobBuscar');
        inp.oninput = () => { clearTimeout(_buscarTimer); _buscarTimer = setTimeout(() => cargarMorosos(1), 450); };
        body.querySelector('#cobFEstado').onchange = () => cargarMorosos(1);
        body.querySelector('#cobFCliente').onchange = () => cargarMorosos(1);
        cargarMorosos(1);
    }

    async function cargarMorosos(pagina = 1) {
        _pagina = pagina;
        const cont = document.getElementById('cobMorosos'); if (!cont) return;
        cont.innerHTML = `<div class="sn-empty"><i class="fas fa-spinner fa-spin"></i></div>`;
        try {
            const params = new URLSearchParams({
                pagina, limite: 25,
                busqueda: document.getElementById('cobBuscar')?.value || '',
                estado_cobranza: document.getElementById('cobFEstado')?.value || '',
                estado_cliente: document.getElementById('cobFCliente')?.value || ''
            });
            const d = await API.get('/api/cobranza/morosos?' + params.toString());
            const morosos = (d && d.morosos) || [];
            _totalPaginas = (d && d.total_paginas) || 1;
            if (!morosos.length) { cont.innerHTML = `<div class="sn-empty"><i class="fas fa-users"></i><p>Sin morosos.</p></div>`; actualizarBarraMasivo(); return; }
            cont.innerHTML = morosos.map(m => {
                const sel = _seleccion.includes(m.id);
                return `<div class="sn-card" style="padding:var(--sn-space-3);">
                    <div style="display:flex; gap:var(--sn-space-3); align-items:flex-start;">
                      <input type="checkbox" class="cob-chk" data-id="${m.id}" ${sel ? 'checked' : ''} style="width:20px; height:20px; margin-top:2px;">
                      <div style="flex:1; min-width:0;">
                        <div class="sn-row__title">${escapeHtml(m.nombre || 'Sin nombre')}</div>
                        <div class="sn-row__sub">Céd. ${escapeHtml(m.cedula || '-')} · ${escapeHtml(m.movil || m.telefono || 's/tel')}</div>
                        <div style="margin-top:var(--sn-space-1); display:flex; gap:var(--sn-space-1); flex-wrap:wrap; align-items:center;">
                          ${badgeEstadoCliente(m.estado_cliente)} ${badgeEstadoCobranza(m.estado_cobranza)}
                          <span class="sn-badge sn-badge--danger">${m.dias_moroso || 0} d</span>
                        </div>
                        <div style="margin-top:var(--sn-space-1); font-weight:var(--sn-weight-bold); color:var(--sn-text-primary);">${money(m.deuda_total)}</div>
                        <div class="sn-row__sub">Últ. contacto: ${m.ultimo_contacto ? fecha(m.ultimo_contacto) : 'Nunca'}</div>
                      </div>
                    </div>
                    <div style="display:flex; gap:var(--sn-space-2); margin-top:var(--sn-space-2); flex-wrap:wrap;">
                      <button class="sn-btn sn-btn--sm sn-btn--ghost cob-ver" data-id="${m.id}"><i class="fas fa-eye"></i> Ver</button>
                      <button class="sn-btn sn-btn--sm sn-btn--ghost cob-edit" data-id="${m.id}" data-perm="gestionar_cobranza"><i class="fas fa-user-edit"></i> Editar</button>
                      <button class="sn-btn sn-btn--sm sn-btn--success cob-msg" data-id="${m.id}" data-nombre="${escapeHtml(m.nombre || '')}" data-perm="gestionar_cobranza"><i class="fas fa-paper-plane"></i> Mensaje</button>
                      <button class="sn-btn sn-btn--sm sn-btn--danger cob-del" data-id="${m.id}" data-nombre="${escapeHtml(m.nombre || '')}" data-perm="gestionar_cobranza"><i class="fas fa-trash"></i></button>
                    </div>
                  </div>`;
            }).join('');
            cont.querySelectorAll('.cob-chk').forEach(cb => cb.onchange = () => toggleSel(Number(cb.dataset.id), cb.checked));
            cont.querySelectorAll('.cob-ver').forEach(b => b.onclick = () => verDetalle(Number(b.dataset.id)));
            cont.querySelectorAll('.cob-edit').forEach(b => b.onclick = () => editarMoroso(Number(b.dataset.id)));
            cont.querySelectorAll('.cob-msg').forEach(b => b.onclick = () => modalEnvio(Number(b.dataset.id), b.dataset.nombre));
            cont.querySelectorAll('.cob-del').forEach(b => b.onclick = () => eliminarMoroso(Number(b.dataset.id), b.dataset.nombre));
            if (window.Perms) Perms.apply(cont);
            renderPaginacion();
            actualizarBarraMasivo();
        } catch (e) { cont.innerHTML = `<div class="sn-empty"><i class="fas fa-triangle-exclamation"></i><p>${escapeHtml(e.message)}</p></div>`; }
    }

    function renderPaginacion() {
        const c = document.getElementById('cobPaginacion'); if (!c) return;
        if (_totalPaginas <= 1) { c.innerHTML = ''; return; }
        const btn = (lbl, pag, dis, on) => `<button class="sn-btn sn-btn--sm ${on ? 'sn-btn--primary' : 'sn-btn--ghost'}" ${dis ? 'disabled' : ''} data-pag="${pag}">${lbl}</button>`;
        let html = btn('<i class="fas fa-chevron-left"></i>', _pagina - 1, _pagina <= 1, false);
        const ini = Math.max(1, _pagina - 1), fin = Math.min(_totalPaginas, _pagina + 1);
        for (let i = ini; i <= fin; i++) html += btn(i, i, false, i === _pagina);
        html += btn('<i class="fas fa-chevron-right"></i>', _pagina + 1, _pagina >= _totalPaginas, false);
        c.innerHTML = html;
        c.querySelectorAll('button[data-pag]').forEach(b => { if (!b.disabled) b.onclick = () => cargarMorosos(Number(b.dataset.pag)); });
    }

    function toggleSel(id, checked) {
        if (checked) { if (!_seleccion.includes(id)) _seleccion.push(id); }
        else _seleccion = _seleccion.filter(x => x !== id);
        actualizarBarraMasivo();
    }
    function actualizarBarraMasivo() {
        const bar = document.getElementById('cobMasivoBar'), cnt = document.getElementById('cobSelCount');
        if (!bar) return;
        const n = _seleccion.length;
        bar.style.display = (n > 0 && puedeGestionar()) ? 'flex' : 'none';
        if (cnt) cnt.textContent = n;
        const bm = document.getElementById('cobBtnMasivo');
        if (bm && !bm._wired) { bm._wired = true; bm.onclick = modalMasivo; }
    }

    async function verDetalle(id) {
        try {
            const d = await API.get('/api/cobranza/morosos/' + id);
            if (!d || !d.success) return toast('Error cargando detalle', 'error');
            const m = d.moroso;
            const fila = (l, v) => `<div style="display:flex; justify-content:space-between; gap:var(--sn-space-3); padding:var(--sn-space-1) 0; border-bottom:1px solid var(--sn-border-soft);"><span style="color:var(--sn-text-tertiary); font-size:var(--sn-text-sm);">${l}</span><span style="text-align:right; color:var(--sn-text-primary); font-size:var(--sn-text-sm);">${v}</span></div>`;
            abrirModal(`
              <b style="font-size:var(--sn-text-md);">${escapeHtml(m.nombre || '-')}</b>
              <div style="margin-top:var(--sn-space-3);">
                ${fila('Cédula', escapeHtml(m.cedula || '-'))}
                ${fila('Teléfono', escapeHtml(m.telefono || '-'))}
                ${fila('Móvil', escapeHtml(m.movil || '-'))}
                ${fila('Email', escapeHtml(m.email || '-'))}
                ${fila('Dirección', escapeHtml(m.direccion || '-'))}
                ${fila('Días mora', (m.dias_moroso || 0) + ' días')}
                ${fila('Deuda', money(m.deuda_total))}
                ${fila('Facturas pend.', m.facturas_pendientes || 0)}
                ${fila('Estado cobranza', badgeEstadoCobranza(m.estado_cobranza))}
                ${fila('Contactos', m.cantidad_contactos || 0)}
                ${fila('Últ. contacto', m.ultimo_contacto ? fecha(m.ultimo_contacto) : 'Nunca')}
                ${fila('BD origen', escapeHtml(m.bd_origen || '-'))}
                ${m.notas ? `<div style="margin-top:var(--sn-space-2); font-size:var(--sn-text-sm); color:var(--sn-text-secondary); white-space:pre-wrap;">${escapeHtml(m.notas)}</div>` : ''}
              </div>
              <button class="sn-btn sn-btn--primary sn-btn--block cob-edit-modal" data-id="${id}" data-perm="gestionar_cobranza" style="margin-top:var(--sn-space-3);"><i class="fas fa-user-edit"></i> Editar</button>`);
            const b = document.querySelector('#cobModal .cob-edit-modal');
            if (b) b.onclick = () => { cerrarModal(); editarMoroso(id); };
        } catch (e) { toast('Error: ' + e.message, 'error'); }
    }

    async function editarMoroso(id) {
        if (!puedeGestionar()) return toast('Sin permiso para gestionar cobranza', 'error');
        let m = {};
        try { const d = await API.get('/api/cobranza/morosos/' + id); if (d && d.success) m = d.moroso || {}; }
        catch (e) { return toast('Error cargando datos', 'error'); }
        const inp = (id2, lbl, val, type) => `<label style="display:block; margin-bottom:var(--sn-space-2);"><span style="display:block; font-size:var(--sn-text-xs); color:var(--sn-text-tertiary); margin-bottom:2px;">${lbl}</span><input id="${id2}" type="${type || 'text'}" value="${escapeHtml(val == null ? '' : val)}" style="width:100%; box-sizing:border-box; padding:var(--sn-space-2); border:1px solid var(--sn-border); border-radius:var(--sn-radius-md); background:var(--sn-surface); color:var(--sn-text-primary);"></label>`;
        abrirModal(`
          <b style="font-size:var(--sn-text-md);">Editar cliente</b>
          <div style="margin-top:var(--sn-space-3);">
            ${inp('edNombre', 'Nombre *', m.nombre)}
            ${inp('edCedula', 'Cédula', m.cedula)}
            ${inp('edTelefono', 'Teléfono', m.telefono)}
            ${inp('edMovil', 'Móvil', m.movil)}
            ${inp('edEmail', 'Email', m.email)}
            ${inp('edDireccion', 'Dirección', m.direccion)}
            ${inp('edDeuda', 'Deuda total', m.deuda_total, 'number')}
            ${inp('edDias', 'Días mora', m.dias_moroso, 'number')}
            <label style="display:block; margin-bottom:var(--sn-space-2);"><span style="display:block; font-size:var(--sn-text-xs); color:var(--sn-text-tertiary); margin-bottom:2px;">Estado cobranza</span>
              <select id="edEstado" style="width:100%; box-sizing:border-box; padding:var(--sn-space-2); border:1px solid var(--sn-border); border-radius:var(--sn-radius-md); background:var(--sn-surface); color:var(--sn-text-primary);">
                ${['activo', 'pausado', 'convenio', 'pagado', 'inactivo'].map(e => `<option value="${e}" ${m.estado_cobranza === e ? 'selected' : ''}>${e}</option>`).join('')}
              </select></label>
            ${inp('edNotas', 'Notas', m.notas)}
          </div>
          <button id="edGuardar" class="sn-btn sn-btn--primary sn-btn--block" style="margin-top:var(--sn-space-3);"><i class="fas fa-save"></i> Guardar</button>`);
        document.getElementById('edGuardar').onclick = async () => {
            const datos = {
                nombre: document.getElementById('edNombre').value.trim(),
                cedula: document.getElementById('edCedula').value.trim(),
                telefono: document.getElementById('edTelefono').value.trim(),
                movil: document.getElementById('edMovil').value.trim(),
                email: document.getElementById('edEmail').value.trim(),
                direccion: document.getElementById('edDireccion').value.trim(),
                deuda_total: parseFloat(document.getElementById('edDeuda').value) || 0,
                dias_moroso: parseInt(document.getElementById('edDias').value) || 0,
                estado_cobranza: document.getElementById('edEstado').value,
                notas: document.getElementById('edNotas').value.trim()
            };
            if (!datos.nombre) return toast('El nombre es obligatorio', 'error');
            if (!datos.telefono && !datos.movil) return toast('Se requiere al menos un teléfono', 'error');
            try {
                const r = await API.put('/api/cobranza/morosos/' + id, datos);
                if (r && r.success) { toast('Cliente actualizado ✓', 'success'); cerrarModal(); cargarMorosos(_pagina); }
                else toast((r && r.message) || 'Error guardando', 'error');
            } catch (e) { toast('Error: ' + e.message, 'error'); }
        };
    }

    async function eliminarMoroso(id, nombre) {
        if (!puedeGestionar()) return toast('Sin permiso para gestionar cobranza', 'error');
        if (!confirm(`¿Eliminar a "${nombre}"? Esta acción no se puede deshacer.`)) return;
        try {
            const r = await API.del('/api/cobranza/morosos/' + id);
            if (r && r.success) { toast('Cliente eliminado ✓', 'success'); _seleccion = _seleccion.filter(x => x !== id); cargarMorosos(_pagina); }
            else toast((r && r.message) || 'Error eliminando', 'error');
        } catch (e) { toast('Error: ' + e.message, 'error'); }
    }

    // ---------- ENVÍO INDIVIDUAL ----------
    async function modalEnvio(id, nombre) {
        if (!puedeGestionar()) return toast('Sin permiso para gestionar cobranza', 'error');
        await asegurarPlantillas();
        const opts = _plantillasCache.filter(p => p.activo).map(p => `<option value="${p.id}">${escapeHtml(p.nombre)} (${p.canal})</option>`).join('');
        abrirModal(`
          <b style="font-size:var(--sn-text-md);">Mensaje a ${escapeHtml(nombre)}</b>
          <div style="margin-top:var(--sn-space-3);">
            <label style="display:block; margin-bottom:var(--sn-space-2);"><span style="display:block; font-size:var(--sn-text-xs); color:var(--sn-text-tertiary); margin-bottom:2px;">Plantilla (opcional)</span>
              <select id="enPlantilla" style="width:100%; box-sizing:border-box; padding:var(--sn-space-2); border:1px solid var(--sn-border); border-radius:var(--sn-radius-md); background:var(--sn-surface); color:var(--sn-text-primary);"><option value="">-- Escribir manual --</option>${opts}</select></label>
            <label style="display:block; margin-bottom:var(--sn-space-2);"><span style="display:block; font-size:var(--sn-text-xs); color:var(--sn-text-tertiary); margin-bottom:2px;">Canal</span>
              <select id="enCanal" style="width:100%; box-sizing:border-box; padding:var(--sn-space-2); border:1px solid var(--sn-border); border-radius:var(--sn-radius-md); background:var(--sn-surface); color:var(--sn-text-primary);">
                <option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="sms_flash">SMS Flash</option></select></label>
            <textarea id="enMensaje" rows="5" placeholder="Escribe el mensaje…" style="width:100%; box-sizing:border-box; padding:var(--sn-space-2); border:1px solid var(--sn-border); border-radius:var(--sn-radius-md); background:var(--sn-surface); color:var(--sn-text-primary); resize:vertical;"></textarea>
          </div>
          <button id="enEnviar" class="sn-btn sn-btn--success sn-btn--block" style="margin-top:var(--sn-space-3);"><i class="fas fa-paper-plane"></i> Enviar</button>`);
        const sel = document.getElementById('enPlantilla');
        sel.onchange = () => {
            const p = _plantillasCache.find(x => x.id == sel.value);
            if (p) { document.getElementById('enMensaje').value = p.contenido; document.getElementById('enCanal').value = p.canal; }
        };
        document.getElementById('enEnviar').onclick = async () => {
            const canal = document.getElementById('enCanal').value;
            const mensaje = document.getElementById('enMensaje').value.trim();
            if (!mensaje) return toast('Escribe un mensaje', 'error');
            try {
                const r = await API.post('/api/cobranza/enviar-mensaje', { moroso_id: id, canal, mensaje });
                if (r && r.success) { toast('Mensaje enviado ✓', 'success'); cerrarModal(); }
                else toast((r && (r.error || r.message)) || 'Error enviando', 'error');
            } catch (e) { toast('Error: ' + e.message, 'error'); }
        };
    }

    // ---------- ENVÍO MASIVO ----------
    async function modalMasivo() {
        if (!puedeGestionar()) return toast('Sin permiso para gestionar cobranza', 'error');
        if (!_seleccion.length) return toast('Selecciona al menos un cliente', 'error');
        await asegurarPlantillas();
        const opts = _plantillasCache.filter(p => p.activo).map(p => `<option value="${p.id}">${escapeHtml(p.nombre)} (${p.canal})</option>`).join('');
        abrirModal(`
          <b style="font-size:var(--sn-text-md);">Envío masivo</b>
          <div style="margin-top:var(--sn-space-2); font-size:var(--sn-text-sm); color:var(--sn-text-secondary);">Se enviará a <b>${_seleccion.length}</b> clientes seleccionados.</div>
          <div style="margin-top:var(--sn-space-3);">
            <label style="display:block; margin-bottom:var(--sn-space-2);"><span style="display:block; font-size:var(--sn-text-xs); color:var(--sn-text-tertiary); margin-bottom:2px;">Plantilla *</span>
              <select id="maPlantilla" style="width:100%; box-sizing:border-box; padding:var(--sn-space-2); border:1px solid var(--sn-border); border-radius:var(--sn-radius-md); background:var(--sn-surface); color:var(--sn-text-primary);"><option value="">-- Seleccionar --</option>${opts}</select></label>
            <label style="display:block; margin-bottom:var(--sn-space-2);"><span style="display:block; font-size:var(--sn-text-xs); color:var(--sn-text-tertiary); margin-bottom:2px;">Canal</span>
              <select id="maCanal" style="width:100%; box-sizing:border-box; padding:var(--sn-space-2); border:1px solid var(--sn-border); border-radius:var(--sn-radius-md); background:var(--sn-surface); color:var(--sn-text-primary);">
                <option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="sms_flash">SMS Flash</option></select></label>
          </div>
          <button id="maEnviar" class="sn-btn sn-btn--primary sn-btn--block" style="margin-top:var(--sn-space-3);"><i class="fas fa-paper-plane"></i> Enviar a ${_seleccion.length}</button>`);
        document.getElementById('maEnviar').onclick = async () => {
            const plantilla_id = document.getElementById('maPlantilla').value;
            const canal = document.getElementById('maCanal').value;
            if (!plantilla_id) return toast('Selecciona una plantilla', 'error');
            const btn = document.getElementById('maEnviar'); btn.disabled = true; btn.textContent = 'Enviando…';
            try {
                const r = await API.post('/api/cobranza/enviar-masivo', { morosos_ids: _seleccion, canal, plantilla_id });
                if (r && r.success) {
                    const res = r.resultados || {};
                    toast(`Envío: ${res.enviados || 0}/${res.total || _seleccion.length} exitosos`, 'success');
                    cerrarModal(); _seleccion = []; cargarMorosos(_pagina);
                } else { toast((r && (r.error || r.message)) || 'Error en envío masivo', 'error'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Reintentar'; }
            } catch (e) { toast('Error: ' + e.message, 'error'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Reintentar'; }
        };
    }

    async function asegurarPlantillas() {
        if (_plantillasCache.length) return;
        try { const d = await API.get('/api/cobranza/plantillas'); if (d && d.success) _plantillasCache = d.plantillas || []; } catch (e) {}
    }

    // ---------- HISTORIAL ----------
    async function cargarHistorialTab() {
        const body = document.getElementById('cobBody'); if (!body) return;
        try {
            const d = await API.get('/api/cobranza/historial?pagina=1&limite=50');
            const hist = (d && d.historial) || [];
            if (!hist.length) { body.innerHTML = `<div class="sn-empty"><i class="fas fa-clock-rotate-left"></i><p>Sin mensajes registrados.</p></div>`; return; }
            body.innerHTML = hist.map(h => `
              <div class="sn-card" style="padding:var(--sn-space-3);">
                <div style="display:flex; justify-content:space-between; gap:var(--sn-space-2); align-items:flex-start;">
                  <div style="flex:1; min-width:0;">
                    <div class="sn-row__title">${escapeHtml(h.cliente_nombre || h.moroso_nombre || '-')}</div>
                    <div class="sn-row__sub">${escapeHtml(h.cliente_telefono || '')} · ${fecha(h.fecha_envio)}</div>
                    <div style="margin-top:var(--sn-space-1); font-size:var(--sn-text-sm); color:var(--sn-text-secondary);">${escapeHtml((h.mensaje_enviado || '').substring(0, 120))}${(h.mensaje_enviado || '').length > 120 ? '…' : ''}</div>
                    <div style="margin-top:var(--sn-space-1); display:flex; gap:var(--sn-space-1); flex-wrap:wrap;">${badgeCanal(h.canal)} ${badgeEstadoEnvio(h.estado_envio)}</div>
                  </div>
                </div>
                <div class="sn-row__sub" style="margin-top:var(--sn-space-1);">Por: ${escapeHtml(h.enviado_por || '-')}</div>
              </div>`).join('');
        } catch (e) { body.innerHTML = `<div class="sn-empty"><i class="fas fa-triangle-exclamation"></i><p>${escapeHtml(e.message)}</p></div>`; }
    }

    // ---------- PLANTILLAS (lectura; edición completa en web) ----------
    async function cargarPlantillasTab() {
        const body = document.getElementById('cobBody'); if (!body) return;
        try {
            const d = await API.get('/api/cobranza/plantillas');
            const pls = (d && d.plantillas) || [];
            _plantillasCache = pls;
            const aviso = `<div class="sn-card" style="background:var(--brand-100); border:none;"><div style="font-size:var(--sn-text-sm); color:var(--brand-800);"><i class="fas fa-circle-info"></i> La edición/creación de plantillas y reglas se gestiona desde el panel web <b>reportados.html</b>.</div></div>`;
            if (!pls.length) { body.innerHTML = aviso + `<div class="sn-empty"><i class="fas fa-bolt"></i><p>Sin plantillas.</p></div>`; return; }
            body.innerHTML = aviso + pls.map(p => `
              <div class="sn-card" style="padding:var(--sn-space-3);">
                <div style="display:flex; justify-content:space-between; gap:var(--sn-space-2); align-items:center;">
                  <div class="sn-row__title">${escapeHtml(p.nombre)}</div>
                  <div style="display:flex; gap:var(--sn-space-1);">${badgeCanal(p.canal)}${p.activo ? '<span class="sn-badge sn-badge--ok">Activa</span>' : '<span class="sn-badge sn-badge--off">Inactiva</span>'}</div>
                </div>
                <div style="margin-top:var(--sn-space-1); font-size:var(--sn-text-sm); color:var(--sn-text-secondary); white-space:pre-wrap;">${escapeHtml((p.contenido || '').substring(0, 180))}${(p.contenido || '').length > 180 ? '…' : ''}</div>
              </div>`).join('');
        } catch (e) { body.innerHTML = `<div class="sn-empty"><i class="fas fa-triangle-exclamation"></i><p>${escapeHtml(e.message)}</p></div>`; }
    }

    // ---------- CONFIG (motor + horario + días + BestVoiper) ----------
    async function cargarConfigTab() {
        const body = document.getElementById('cobBody'); if (!body) return;
        try {
            const d = await API.get('/api/cobranza/config');
            const c = (d && d.config) || {};
            const motor = c.motor_activo?.valor === true || c.motor_activo?.valor === 'true';
            const horaIni = c.hora_inicio?.valor || '08:00';
            const horaFin = c.hora_fin?.valor || '15:00';
            const dias = (c.dias_envio?.valor || '1,2,3,4,5,6').split(',').map(s => s.trim());
            const diasLbl = [['1', 'L'], ['2', 'M'], ['3', 'X'], ['4', 'J'], ['5', 'V'], ['6', 'S'], ['7', 'D']];
            body.innerHTML = `
              <div class="sn-card">
                <div class="sn-section-title" style="margin-top:0;">Motor</div>
                <label style="display:flex; align-items:center; gap:var(--sn-space-2); font-weight:var(--sn-weight-semibold); color:var(--sn-text-primary);"><input type="checkbox" id="cfgMotor" ${motor ? 'checked' : ''} style="width:20px; height:20px;"> Motor automático activo</label>
                <div class="sn-section-title">Horario de envío</div>
                <div style="display:flex; gap:var(--sn-space-2); align-items:center;">
                  <input type="time" id="cfgIni" value="${horaIni}" style="flex:1; padding:var(--sn-space-2); border:1px solid var(--sn-border); border-radius:var(--sn-radius-md); background:var(--sn-surface); color:var(--sn-text-primary);">
                  <span style="color:var(--sn-text-tertiary);">a</span>
                  <input type="time" id="cfgFin" value="${horaFin}" style="flex:1; padding:var(--sn-space-2); border:1px solid var(--sn-border); border-radius:var(--sn-radius-md); background:var(--sn-surface); color:var(--sn-text-primary);">
                </div>
                <div class="sn-section-title">Días de envío</div>
                <div style="display:flex; gap:var(--sn-space-1); flex-wrap:wrap;">
                  ${diasLbl.map(([v, l]) => `<label style="flex:1; min-width:40px; text-align:center; padding:var(--sn-space-2) 0; border:1px solid var(--sn-border); border-radius:var(--sn-radius-md); cursor:pointer;"><input type="checkbox" class="cfg-dia" value="${v}" ${dias.includes(v) ? 'checked' : ''} style="display:block; margin:0 auto 4px;"><span style="font-size:var(--sn-text-xs); color:var(--sn-text-secondary);">${l}</span></label>`).join('')}
                </div>
                <div class="sn-section-title">BestVoiper (SMS)</div>
                <input type="text" id="cfgBvUser" value="${escapeHtml(c.bestvoiper_usuario?.valor || '')}" placeholder="Usuario" style="width:100%; box-sizing:border-box; margin-bottom:var(--sn-space-2); padding:var(--sn-space-2); border:1px solid var(--sn-border); border-radius:var(--sn-radius-md); background:var(--sn-surface); color:var(--sn-text-primary);">
                <input type="password" id="cfgBvPass" value="${escapeHtml(c.bestvoiper_password?.valor || '')}" placeholder="Contraseña" style="width:100%; box-sizing:border-box; margin-bottom:var(--sn-space-2); padding:var(--sn-space-2); border:1px solid var(--sn-border); border-radius:var(--sn-radius-md); background:var(--sn-surface); color:var(--sn-text-primary);">
                <input type="text" id="cfgBvCountry" value="${escapeHtml(c.bestvoiper_country?.valor || '57')}" placeholder="Código país" style="width:100%; box-sizing:border-box; padding:var(--sn-space-2); border:1px solid var(--sn-border); border-radius:var(--sn-radius-md); background:var(--sn-surface); color:var(--sn-text-primary);">
                <div style="display:flex; gap:var(--sn-space-2); margin-top:var(--sn-space-3);">
                  <button id="cfgTest" class="sn-btn sn-btn--ghost" data-perm="gestionar_cobranza"><i class="fas fa-plug"></i> Probar SMS</button>
                  <button id="cfgGuardar" class="sn-btn sn-btn--primary" data-perm="gestionar_cobranza" style="flex:1;"><i class="fas fa-save"></i> Guardar</button>
                </div>
                <div id="cfgTestStatus" style="margin-top:var(--sn-space-2); font-size:var(--sn-text-sm);"></div>
              </div>`;
            body.querySelector('#cfgGuardar').onclick = guardarConfig;
            body.querySelector('#cfgTest').onclick = testBestVoiper;
            if (window.Perms) Perms.apply(body);
        } catch (e) { body.innerHTML = `<div class="sn-empty"><i class="fas fa-triangle-exclamation"></i><p>${escapeHtml(e.message)}</p></div>`; }
    }

    async function guardarConfig() {
        if (!puedeGestionar()) return toast('Sin permiso para gestionar cobranza', 'error');
        const dias = Array.from(document.querySelectorAll('.cfg-dia:checked')).map(cb => cb.value);
        if (!dias.length) return toast('Selecciona al menos un día', 'error');
        const ini = document.getElementById('cfgIni').value, fin = document.getElementById('cfgFin').value;
        if (ini >= fin) return toast('La hora de inicio debe ser menor que la hora fin', 'error');
        const cfg = {
            motor_activo: document.getElementById('cfgMotor').checked,
            hora_inicio: ini, hora_fin: fin, dias_envio: dias.join(','),
            bestvoiper_usuario: document.getElementById('cfgBvUser').value,
            bestvoiper_password: document.getElementById('cfgBvPass').value,
            bestvoiper_country: document.getElementById('cfgBvCountry').value
        };
        try {
            const r = await API.put('/api/cobranza/config', cfg);
            if (r && r.success) { toast('Configuración guardada ✓', 'success'); _motorActivo = cfg.motor_activo; }
            else toast((r && r.message) || 'Error guardando', 'error');
        } catch (e) { toast('Error: ' + e.message, 'error'); }
    }

    async function testBestVoiper() {
        if (!puedeGestionar()) return toast('Sin permiso para gestionar cobranza', 'error');
        const st = document.getElementById('cfgTestStatus'); if (st) st.innerHTML = '<span style="color:var(--sn-text-tertiary);"><i class="fas fa-spinner fa-spin"></i> Probando…</span>';
        try {
            const r = await API.post('/api/cobranza/bestvoiper/test', {});
            if (r && r.success) { if (st) st.innerHTML = `<span style="color:var(--sn-success);"><i class="fas fa-check"></i> Conexión OK · Saldo: ${escapeHtml(String(r.balance || 'N/A'))}</span>`; }
            else if (st) st.innerHTML = `<span style="color:var(--sn-danger);"><i class="fas fa-times"></i> ${escapeHtml(r?.error || 'Falló')}</span>`;
        } catch (e) { if (st) st.innerHTML = `<span style="color:var(--sn-danger);"><i class="fas fa-times"></i> ${escapeHtml(e.message)}</span>`; }
    }

    // ---------- LOGS ----------
    async function cargarLogsTab() {
        const body = document.getElementById('cobBody'); if (!body) return;
        try {
            const d = await API.get('/api/cobranza/logs?limit=100');
            const logs = (d && d.logs) || [];
            if (!logs.length) { body.innerHTML = `<div class="sn-empty"><i class="fas fa-list"></i><p>Sin logs.</p></div>`; return; }
            const tipoBadge = (t) => {
                const map = { error: 'sn-badge--danger', envio_mensajes: 'sn-badge--ok', motor_inicio: 'sn-badge--info', motor_fin: 'sn-badge--off', sincronizacion: 'sn-badge--warn', info: 'sn-badge--info' };
                return `<span class="sn-badge ${map[t] || 'sn-badge--off'}">${escapeHtml(t || '-')}</span>`;
            };
            body.innerHTML = logs.map(l => `
              <div class="sn-card" style="padding:var(--sn-space-3);">
                <div style="display:flex; justify-content:space-between; gap:var(--sn-space-2); align-items:center;">
                  ${tipoBadge(l.tipo)}
                  <span class="sn-row__sub">${fecha(l.fecha)}</span>
                </div>
                <div style="margin-top:var(--sn-space-1); font-size:var(--sn-text-sm); color:var(--sn-text-primary);">${escapeHtml(l.mensaje || '')}</div>
              </div>`).join('');
        } catch (e) { body.innerHTML = `<div class="sn-empty"><i class="fas fa-triangle-exclamation"></i><p>${escapeHtml(e.message)}</p></div>`; }
    }

    // ---------- modal genérico (bottom sheet) ----------
    function abrirModal(html) {
        _modalAbierto = true;
        let ov = document.getElementById('cobModal');
        if (!ov) { ov = document.createElement('div'); ov.id = 'cobModal'; document.body.appendChild(ov); }
        ov.className = 'modal-overlay';
        ov.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:100000; display:flex; align-items:flex-end; justify-content:center;';
        ov.innerHTML = `
          <div style="background:var(--sn-surface); width:100%; max-width:560px; border-radius:var(--sn-radius-xl) var(--sn-radius-xl) 0 0; max-height:90vh; overflow:auto; padding:var(--sn-space-4);">
            <div style="display:flex; justify-content:flex-end; margin-bottom:var(--sn-space-1);">
              <button id="cobModalCerrar" class="sn-btn sn-btn--sm sn-btn--ghost">✕</button>
            </div>
            <div id="cobModalBody">${html}</div>
          </div>`;
        ov.querySelector('#cobModalCerrar').onclick = cerrarModal;
        ov.onclick = (e) => { if (e.target === ov) cerrarModal(); };
        if (window.Perms) Perms.apply(ov);
    }
    function cerrarModal() { _modalAbierto = false; const ov = document.getElementById('cobModal'); if (ov) ov.remove(); }

    return { show };
})();

if (typeof Router !== 'undefined') Router.register('cobranza', () => CobranzaPage.show());
