// Página: Verificación de Pagos (app admin) — réplica del módulo web public/verificacion_pagos.html
// Endpoints backend (ya existentes, protegidos por requireAuth + ver_verificacion_pagos; escrituras solo admin):
//   GET  /api/verificacion-pagos                         → resumen
//   GET  /api/verificacion-pagos/movimientos?dia=        → movimientos bancarios
//   GET  /api/verificacion-pagos/pagos                   → pagos registrados
//   GET  /api/verificacion-pagos/config                  → config (modo prueba)
//   POST /api/verificacion-pagos/config                  → guardar config (admin)
//   POST /api/verificacion-pagos/movimientos/:id/descruzar        (admin)
//   GET  /api/verificacion-pagos/buscar-clientes?q=
//   POST /api/verificacion-pagos/movimientos/:id/registrar-manual  {cedula, confirmado?} (admin)
const VerificacionPagosPage = (function () {
    let _tab = 'mov';           // 'mov' | 'pagos'
    let _dia = _hoyISO();       // filtro de día (YYYY-MM-DD) o '' = todos
    let _refresh = null;        // setInterval
    let _modalAbierto = false;
    let _mmMov = null;          // movimiento sobre el que se registra manual
    let _mmBuscarTimer = null;

    function _hoyISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    function money(v) { const n = Number(v) || 0; return '$' + n.toLocaleString('es-CO'); }
    function toast(msg, tipo) {
        const t = document.getElementById('toast'); if (!t) { alert(msg); return; }
        t.textContent = msg; t.className = 'toast show' + (tipo === 'error' ? ' error' : tipo === 'success' ? ' success' : '');
        clearTimeout(t._to); t._to = setTimeout(() => { t.className = 'toast'; }, 3500);
    }
    function badge(estado) {
        const e = String(estado || '').toLowerCase();
        let bg = '#6b7280';
        if (['pendiente', 'parcial'].includes(e)) bg = '#f59e0b';
        else if (['cruzado', 'registrado', 'saldo_favor'].includes(e)) bg = '#16a34a';
        else if (e === 'pasado_a_asesor') bg = '#2563eb';
        else if (['descartado', 'error'].includes(e)) bg = '#dc2626';
        return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${bg};color:#fff;font-size:11px;font-weight:600;">${escapeHtml(estado || '-')}</span>`;
    }

    function ensurePage() {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const main = document.querySelector('.app-main');
        let page = document.getElementById('page-verificacion-pagos');
        if (!page) { page = document.createElement('div'); page.id = 'page-verificacion-pagos'; page.className = 'page'; main.appendChild(page); }
        page.classList.add('active');
        return page;
    }

    function activa() { const p = document.getElementById('page-verificacion-pagos'); return p && p.classList.contains('active'); }

    async function show() {
        const page = ensurePage();
        page.innerHTML = `
            <div style="padding:12px;max-width:900px;margin:0 auto;">
              <h2 style="margin:4px 0 12px;font-size:20px;"><i class="fas fa-file-invoice-dollar"></i> Verificación de pagos</h2>
              <div id="vpConfig" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:13px;">Cargando config…</div>
              <div id="vpResumen" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px;"></div>
              <div style="display:flex;gap:8px;margin-bottom:10px;">
                <button id="vpTabMov" class="vp-tab" style="flex:1;padding:10px;border:none;border-radius:8px;font-weight:600;">Movimientos</button>
                <button id="vpTabPagos" class="vp-tab" style="flex:1;padding:10px;border:none;border-radius:8px;font-weight:600;">Pagos</button>
              </div>
              <div id="vpFiltroDia" style="display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">
                <input type="date" id="vpDia" value="${_dia}" style="padding:8px;border:1px solid #d1d5db;border-radius:8px;">
                <button id="vpHoy" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;background:#fff;">Hoy</button>
                <button id="vpTodos" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;background:#fff;">Todos</button>
                <button id="vpRefrescar" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;background:#fff;margin-left:auto;"><i class="fas fa-sync"></i></button>
              </div>
              <div id="vpLista"><div style="text-align:center;padding:20px;color:#888;"><i class="fas fa-spinner fa-spin"></i> Cargando…</div></div>
            </div>`;
        // listeners
        page.querySelector('#vpTabMov').onclick = () => { _tab = 'mov'; pintarTabs(); cargarLista(); };
        page.querySelector('#vpTabPagos').onclick = () => { _tab = 'pagos'; pintarTabs(); cargarLista(); };
        page.querySelector('#vpDia').onchange = (e) => { _dia = e.target.value; cargarLista(); };
        page.querySelector('#vpHoy').onclick = () => { _dia = _hoyISO(); const i = page.querySelector('#vpDia'); if (i) i.value = _dia; cargarLista(); };
        page.querySelector('#vpTodos').onclick = () => { _dia = ''; const i = page.querySelector('#vpDia'); if (i) i.value = ''; cargarLista(); };
        page.querySelector('#vpRefrescar').onclick = () => { cargarResumen(); cargarLista(); cargarConfig(); };
        pintarTabs();
        cargarConfig(); cargarResumen(); cargarLista();
        // auto-refresh cada 8s si la página está activa y no hay modal abierto
        if (_refresh) clearInterval(_refresh);
        _refresh = setInterval(() => { if (activa() && !_modalAbierto && document.visibilityState === 'visible') { cargarResumen(); cargarLista(); } }, 8000);
    }

    function pintarTabs() {
        const on = { background: '#2563eb', color: '#fff' }, off = { background: '#e5e7eb', color: '#374151' };
        const m = document.getElementById('vpTabMov'), p = document.getElementById('vpTabPagos');
        const f = document.getElementById('vpFiltroDia');
        if (!m || !p) return;
        Object.assign(m.style, _tab === 'mov' ? on : off);
        Object.assign(p.style, _tab === 'pagos' ? on : off);
        if (f) f.style.display = _tab === 'mov' ? 'flex' : 'none';
    }

    async function cargarConfig() {
        const el = document.getElementById('vpConfig'); if (!el) return;
        try {
            const d = await API.get('/api/verificacion-pagos/config');
            const c = (d && d.config) || {};
            el.innerHTML = `
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <label style="display:flex;align-items:center;gap:6px;font-weight:600;"><input type="checkbox" id="vpModoPrueba" ${c.modo_prueba ? 'checked' : ''}> Modo prueba</label>
                <span style="color:#9a3412;font-size:12px;">${c.modo_prueba ? '(solo actúa sobre los números permitidos)' : '(activo para todos)'}</span>
              </div>
              <div style="display:flex;gap:6px;margin-top:8px;">
                <input type="text" id="vpNumeros" value="${escapeHtml(c.numeros_prueba || '')}" placeholder="Números permitidos (coma)" style="flex:1;padding:8px;border:1px solid #d1d5db;border-radius:8px;">
                <button id="vpGuardarCfg" style="padding:8px 14px;border:none;border-radius:8px;background:#ea580c;color:#fff;font-weight:600;">Guardar</button>
              </div>
              <div style="margin-top:6px;font-size:11px;color:#9a3412;">Registro real: <b>${c.registro_real ? 'SÍ (registra en MikroWisp)' : 'NO (modo simulación)'}</b></div>`;
            el.querySelector('#vpGuardarCfg').onclick = guardarConfig;
        } catch (e) { el.innerHTML = `<span style="color:#dc2626;">Config: ${escapeHtml(e.message)}</span>`; }
    }

    async function guardarConfig() {
        const modo = document.getElementById('vpModoPrueba')?.checked;
        const nums = document.getElementById('vpNumeros')?.value || '';
        try {
            await API.post('/api/verificacion-pagos/config', { modo_prueba: !!modo, numeros_prueba: nums });
            toast('Configuración guardada ✓', 'success'); cargarConfig();
        } catch (e) { toast(e.message.includes('admin') ? 'Solo un admin puede cambiar la configuración' : ('Error: ' + e.message), 'error'); }
    }

    async function cargarResumen() {
        const el = document.getElementById('vpResumen'); if (!el) return;
        try {
            const d = await API.get('/api/verificacion-pagos');
            const r = (d && d.resumen) || {}; const mv = r.movimientos || {}; const pg = r.pagos || {};
            const card = (lbl, val, color) => `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px;text-align:center;"><div style="font-size:22px;font-weight:700;color:${color};">${val || 0}</div><div style="font-size:12px;color:#6b7280;">${lbl}</div></div>`;
            el.innerHTML = card('Movimientos', mv.total, '#111827') + card('Sin cruzar', mv.pendientes, '#f59e0b') + card('Pagos registrados', pg.registrados, '#16a34a') + card('Pasados a asesor', pg.a_asesor, '#2563eb');
        } catch (e) { el.innerHTML = `<div style="grid-column:1/-1;color:#dc2626;font-size:13px;">Resumen: ${escapeHtml(e.message)}</div>`; }
    }

    function cargarLista() { return _tab === 'mov' ? cargarMovimientos() : cargarPagos(); }

    async function cargarMovimientos() {
        const cont = document.getElementById('vpLista'); if (!cont) return;
        try {
            const q = _dia ? ('?dia=' + encodeURIComponent(_dia)) : '';
            const d = await API.get('/api/verificacion-pagos/movimientos' + q);
            const movs = (d && d.movimientos) || [];
            if (!movs.length) { cont.innerHTML = `<div style="text-align:center;padding:24px;color:#9ca3af;">Sin movimientos${_dia ? ' para ese día' : ''}.</div>`; return; }
            cont.innerHTML = movs.map(m => {
                const acc = m.estado === 'pendiente'
                    ? `<button data-mm="${m.id}" data-monto="${m.monto}" data-origen="${escapeHtml(m.origen || '')}" data-banco="${escapeHtml(m.banco || '')}" class="vp-reg" style="padding:6px 10px;border:none;border-radius:8px;background:#2563eb;color:#fff;font-size:12px;font-weight:600;">Registrar</button>`
                    : (m.estado === 'cruzado' ? `<button data-desc="${m.id}" class="vp-desc" style="padding:6px 10px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-size:12px;"><i class="fas fa-unlink"></i></button>` : '');
                const cruce = m.cliente_nombre ? `<div style="font-size:12px;color:#374151;">↔ ${escapeHtml(m.cliente_nombre)}${m.cliente_telefono ? ' · ' + escapeHtml(m.cliente_telefono) : ''}${m.numero_transferencia ? ' · ' + escapeHtml(m.numero_transferencia) : ''}</div>` : '';
                return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                      <div>
                        <div style="font-weight:700;">${money(m.monto)} <span style="font-weight:400;color:#6b7280;font-size:12px;">${escapeHtml(m.banco || '')}</span></div>
                        <div style="font-size:12px;color:#6b7280;">${escapeHtml(m.fecha_fmt || '')} · destino ${escapeHtml(m.cuenta_destino || '-')}</div>
                        <div style="font-size:12px;color:#6b7280;">Origen: ${escapeHtml(m.origen || '-')}</div>
                        ${cruce}
                      </div>
                      <div style="text-align:right;white-space:nowrap;">${badge(m.estado)}<div style="margin-top:6px;">${acc}</div></div>
                    </div></div>`;
            }).join('');
            cont.querySelectorAll('.vp-desc').forEach(b => b.onclick = () => descruzar(b.dataset.desc));
            cont.querySelectorAll('.vp-reg').forEach(b => b.onclick = () => abrirModalManual({ id: b.dataset.mm, monto: b.dataset.monto, origen: b.dataset.origen, banco: b.dataset.banco }));
        } catch (e) { cont.innerHTML = `<div style="text-align:center;padding:24px;color:#dc2626;">${escapeHtml(e.message)}</div>`; }
    }

    async function cargarPagos() {
        const cont = document.getElementById('vpLista'); if (!cont) return;
        try {
            const d = await API.get('/api/verificacion-pagos/pagos');
            const pagos = (d && d.pagos) || [];
            if (!pagos.length) { cont.innerHTML = `<div style="text-align:center;padding:24px;color:#9ca3af;">Sin pagos registrados.</div>`; return; }
            cont.innerHTML = pagos.map(p => `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;gap:8px;">
                  <div>
                    <div style="font-weight:700;">${money(p.monto)} <span style="font-weight:400;color:#6b7280;font-size:12px;">${escapeHtml(p.numero_transferencia || '')}</span></div>
                    <div style="font-size:13px;color:#111827;">${escapeHtml(p.cliente_nombre || 'Sin nombre')}</div>
                    <div style="font-size:12px;color:#6b7280;">Cédula: ${escapeHtml(p.cliente_cedula || '-')}</div>
                    ${p.detalle ? `<div style="font-size:12px;color:#6b7280;">${escapeHtml(p.detalle)}</div>` : ''}
                  </div>
                  <div style="text-align:right;white-space:nowrap;">${badge(p.estado)}</div>
                </div></div>`).join('');
        } catch (e) { cont.innerHTML = `<div style="text-align:center;padding:24px;color:#dc2626;">${escapeHtml(e.message)}</div>`; }
    }

    async function descruzar(id) {
        if (!confirm('¿Descruzar este movimiento? Vuelve a "pendiente". (Si ya se registró en MikroWisp, eso NO se revierte.)')) return;
        try {
            const r = await API.post('/api/verificacion-pagos/movimientos/' + id + '/descruzar', {});
            toast(r && r.tenia_pago_registrado ? 'Descruzado. Ojo: el pago en MikroWisp NO se revierte.' : 'Descruzado ✓', 'success');
            cargarResumen(); cargarLista();
        } catch (e) { toast(e.message.includes('admin') ? 'Solo un admin puede descruzar' : ('Error: ' + e.message), 'error'); }
    }

    // ---------- Modal registrar manual ----------
    function abrirModalManual(mov) {
        _mmMov = mov; _modalAbierto = true;
        let ov = document.getElementById('vpModal');
        if (!ov) { ov = document.createElement('div'); ov.id = 'vpModal'; document.body.appendChild(ov); }
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000;display:flex;align-items:flex-end;justify-content:center;';
        ov.innerHTML = `
          <div style="background:#fff;width:100%;max-width:560px;border-radius:16px 16px 0 0;max-height:90vh;overflow:auto;padding:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <b>Registrar pago manual</b>
              <button id="vpMmCerrar" style="border:none;background:#eee;border-radius:8px;padding:6px 10px;">✕</button>
            </div>
            <div style="font-size:13px;color:#374151;margin-bottom:10px;">Movimiento: <b>${money(mov.monto)}</b> · ${escapeHtml(mov.banco || '')} · origen ${escapeHtml(mov.origen || '-')}</div>
            <input type="text" id="vpMmBuscar" placeholder="Buscar cliente (nombre, cédula o móvil)…" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;">
            <div id="vpMmResultados" style="margin-top:8px;"></div>
            <div id="vpMmPreview" style="margin-top:8px;"></div>
          </div>`;
        ov.querySelector('#vpMmCerrar').onclick = cerrarModal;
        ov.onclick = (e) => { if (e.target === ov) cerrarModal(); };
        const inp = ov.querySelector('#vpMmBuscar');
        inp.oninput = () => { clearTimeout(_mmBuscarTimer); const q = inp.value.trim(); if (q.length < 3) { document.getElementById('vpMmResultados').innerHTML = ''; return; } _mmBuscarTimer = setTimeout(() => buscarClientes(q), 300); };
        setTimeout(() => inp.focus(), 100);
    }
    function cerrarModal() { _modalAbierto = false; _mmMov = null; const ov = document.getElementById('vpModal'); if (ov) ov.remove(); }

    async function buscarClientes(q) {
        const cont = document.getElementById('vpMmResultados'); if (!cont) return;
        cont.innerHTML = `<div style="color:#888;font-size:13px;padding:6px;"><i class="fas fa-spinner fa-spin"></i></div>`;
        try {
            const d = await API.get('/api/verificacion-pagos/buscar-clientes?q=' + encodeURIComponent(q));
            const cli = (d && d.clientes) || [];
            if (!cli.length) { cont.innerHTML = `<div style="color:#9ca3af;font-size:13px;padding:6px;">Sin resultados.</div>`; return; }
            cont.innerHTML = cli.map(c => `<div class="vp-cli" data-ced="${escapeHtml(c.cedula)}" style="padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:6px;">
                <div style="font-weight:600;">${escapeHtml(c.nombre)}</div>
                <div style="font-size:12px;color:#6b7280;">Cédula ${escapeHtml(c.cedula || '-')} · ${escapeHtml(c.movil || 's/móvil')} · ${escapeHtml(c.estado || '')} · ${escapeHtml(c.bd_nombre || '')}</div></div>`).join('');
            cont.querySelectorAll('.vp-cli').forEach(el => el.onclick = () => previewCliente(el.dataset.ced));
        } catch (e) { cont.innerHTML = `<div style="color:#dc2626;font-size:13px;padding:6px;">${escapeHtml(e.message)}</div>`; }
    }

    async function previewCliente(cedula) {
        const pv = document.getElementById('vpMmPreview'); if (!pv || !_mmMov) return;
        pv.innerHTML = `<div style="color:#888;font-size:13px;padding:6px;"><i class="fas fa-spinner fa-spin"></i> Consultando deuda…</div>`;
        try {
            const d = await API.post('/api/verificacion-pagos/movimientos/' + _mmMov.id + '/registrar-manual', { cedula });
            if (!d || !d.preview) { pv.innerHTML = `<div style="color:#dc2626;">No se pudo previsualizar.</div>`; return; }
            const av = d.aviso ? `<div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;">${escapeHtml(d.aviso)}</div>` : '';
            const cli = d.cliente || {};
            pv.innerHTML = `${av}
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px;font-size:13px;">
                <div><b>${escapeHtml(cli.nombre || '')}</b> · ${escapeHtml(cli.cedula || '')}</div>
                <div>Deuda: <b>${money(d.deuda)}</b> · Pendiente: <b>${money(d.pendiente)}</b>${d.saldo_favor ? ' · Saldo a favor: ' + money(d.saldo_favor) : ''}</div>
                <div style="color:#6b7280;">Resultado: ${escapeHtml(d.resultado || '')}${d.tiene_movil === false ? ' · ⚠️ sin móvil (no recibe mensaje)' : ''}</div>
              </div>
              <button id="vpMmConfirmar" data-ced="${escapeHtml(cedula)}" style="width:100%;margin-top:10px;padding:12px;border:none;border-radius:8px;background:#16a34a;color:#fff;font-weight:700;">Confirmar y registrar pago</button>`;
            pv.querySelector('#vpMmConfirmar').onclick = () => confirmarRegistro(cedula);
        } catch (e) { pv.innerHTML = `<div style="color:#dc2626;font-size:13px;">${escapeHtml(e.message.includes('admin') ? 'Solo un admin puede registrar pagos' : e.message)}</div>`; }
    }

    async function confirmarRegistro(cedula) {
        if (!_mmMov) return;
        const btn = document.getElementById('vpMmConfirmar'); if (btn) { btn.disabled = true; btn.textContent = 'Registrando…'; }
        try {
            const d = await API.post('/api/verificacion-pagos/movimientos/' + _mmMov.id + '/registrar-manual', { cedula, confirmado: true });
            const r = (d && d.resultado) || {};
            let msg = 'Pago registrado ✓ ' + (r.numero_transferencia || '');
            if (r.simulado) msg = 'Registrado (SIMULADO — registro_real apagado) ' + (r.numero_transferencia || '');
            if (d && d.sin_movil) msg += ' · sin móvil (no se envió mensaje)';
            toast(msg, 'success');
            cerrarModal(); cargarResumen(); cargarLista();
        } catch (e) { toast(e.message.includes('admin') ? 'Solo un admin puede registrar pagos' : ('Error: ' + e.message), 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Confirmar y registrar pago'; } }
    }

    return { show };
})();

if (typeof Router !== 'undefined') Router.register('verificacion-pagos', () => VerificacionPagosPage.show());
