// Página: ISP Guardian (app admin) — monitoreo operativo (MikroTiks). Módulo infectados eliminado 2026-11-14.
// Scope móvil = lo operativo/consulta; la config pesada (perfiles QoS, horarios, sondas) queda en la web.
// Endpoints (requireISPGuardian → permiso ver_isp_guardian para leer; acciones requireISPMikrotik → admin/gestionar_mikrotik):
//   GET  /api/isp/mikrotiks               → lista (incluye cpu_load, cpu_umbral_alerta)
//   GET  /api/isp/mikrotiks/estados       → [{id,nombre,ip,activo,en_linea,ultimo_ok,error_msg}]
const GuardianPage = (function () {
    let _refresh = null;

    function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    function fecha(v) { if (!v) return '-'; try { return new Date(v).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: false }); } catch { return String(v); } }
    function toast(msg, tipo) {
        const t = document.getElementById('toast'); if (!t) { alert(msg); return; }
        t.textContent = msg; t.className = 'toast show' + (tipo === 'error' ? ' error' : tipo === 'success' ? ' success' : '');
        clearTimeout(t._to); t._to = setTimeout(() => { t.className = 'toast'; }, 3500);
    }

    function ensurePage() {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const main = document.querySelector('.app-main');
        let page = document.getElementById('page-guardian');
        if (!page) { page = document.createElement('div'); page.id = 'page-guardian'; page.className = 'page'; main.appendChild(page); }
        page.classList.add('active');
        return page;
    }
    function activa() { const p = document.getElementById('page-guardian'); return p && p.classList.contains('active'); }

    async function show() {
        const page = ensurePage();
        page.innerHTML = `
            <div style="padding:12px;max-width:900px;margin:0 auto;">
              <h2 style="margin:4px 0 12px;font-size:20px;"><i class="fas fa-shield-alt"></i> ISP Guardian</h2>
              <div style="display:flex;gap:8px;margin-bottom:10px;">
                <button id="gRefrescar" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;background:#fff;"><i class="fas fa-sync"></i> Actualizar</button>
              </div>
              <div id="gLista"><div style="text-align:center;padding:20px;color:#888;"><i class="fas fa-spinner fa-spin"></i> Cargando…</div></div>
            </div>`;
        page.querySelector('#gRefrescar').onclick = () => cargar();
        cargar();
        if (_refresh) clearInterval(_refresh);
        _refresh = setInterval(() => { if (activa() && document.visibilityState === 'visible') cargar(); }, 20000);
    }

    function cargar() { return cargarMikrotiks(); }

    // ---- Tarjeta WAN / servidor de borde (OPNsense): cambio manual UFINET <-> TIGO ----
    async function pintarWan() {
        const box = document.getElementById('gWanCard'); if (!box) return;
        try {
            const [e, evResp] = await Promise.all([
                API.get('/api/isp/wan/estado'),
                API.get('/api/isp/wan/eventos').catch(() => ({ eventos: [] })),
            ]);
            const eventos = (evResp && evResp.eventos) || [];
            const forzado = !!e.forzado;
            const activa = e.activa || '—';
            const act = activa === 'UFINET'
                ? { bg: '#dcfce7', bd: '#86efac', fg: '#166534', ico: '🟢' }
                : { bg: '#ffedd5', bd: '#fdba74', fg: '#9a3412', ico: '🔀' };
            const wanRow = (w, esActiva) => w ? `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:8px;background:${esActiva ? '#f0fdf4' : '#f9fafb'};border:1px solid ${esActiva ? '#bbf7d0' : '#eee'};margin-top:4px;">
                  <div><b>${escapeHtml(w.nombre)}</b> <span style="font-size:11px;color:#6b7280;">${escapeHtml(w.ip || '')}</span></div>
                  <div style="font-size:12px;color:${w.online ? '#16a34a' : '#dc2626'};">${w.online ? '🟢' : '🔴'} ${escapeHtml(w.estado || '')} · pérdida ${escapeHtml(w.loss || '?')} · ${escapeHtml(w.delay || '?')}</div>
                </div>` : '';
            const btn = forzado
                ? `<button id="gWanPrincipal" style="width:100%;padding:11px;border:none;border-radius:10px;background:#16a34a;color:#fff;font-weight:700;margin-top:10px;">↩️ Volver a PRINCIPAL (UFINET)</button>`
                : `<button id="gWanRespaldo" style="width:100%;padding:11px;border:none;border-radius:10px;background:#ea580c;color:#fff;font-weight:700;margin-top:10px;">🔀 Conmutar a RESPALDO (TIGO)</button>`;
            box.innerHTML = `
              <div style="background:#fff;border:1px solid #e5e7eb;border-left:5px solid ${act.fg};border-radius:12px;padding:12px;margin-bottom:10px;">
                <div style="font-weight:800;font-size:15px;">🛡️ Servidor de borde (OPNsense) — WAN</div>
                <div style="margin-top:6px;display:inline-block;padding:4px 10px;border-radius:999px;background:${act.bg};border:1px solid ${act.bd};color:${act.fg};font-weight:700;font-size:13px;">
                  ${act.ico} Saliendo por: ${escapeHtml(activa)} — ${escapeHtml(e.modo || '')}
                </div>
                ${wanRow(e.principal, activa === 'UFINET')}
                ${wanRow(e.respaldo, activa === 'TIGO')}
                ${btn}
                <div style="font-size:11px;color:#9ca3af;margin-top:6px;">El cambio mueve TODAS las zonas que salen por este OPNsense (salsipuedes, rio grande, etc.) al otro operador. Reversible.</div>
                ${eventos.length ? `
                <div style="margin-top:10px;border-top:1px solid #f0f0f0;padding-top:8px;">
                  <div style="font-weight:700;font-size:12px;color:#374151;margin-bottom:4px;">📋 Degradaciones detectadas (historial)</div>
                  ${eventos.slice(0, 6).map(ev => {
                    const esBrown = ev.tipo === 'brownout-ufinet';
                    const ic = esBrown ? '🟠' : '📡';
                    const nom = esBrown ? `Brownout UFINET ${ev.loss_max ? '(' + ev.loss_max + '% pérd.)' : ''}` : 'Stalls Meta/TikTok';
                    const ini = fecha(ev.inicio);
                    const estadoEv = ev.activo ? '<span style="color:#dc2626;font-weight:700;">● EN CURSO</span>' : `${ev.dur_min != null ? ev.dur_min + ' min' : ''}`;
                    return `<div style="font-size:11px;color:#4b5563;padding:2px 0;display:flex;justify-content:space-between;gap:6px;">
                        <span>${ic} ${escapeHtml(nom)}</span><span style="white-space:nowrap;color:#6b7280;">${ini} · ${estadoEv}</span></div>`;
                  }).join('')}
                </div>` : `<div style="font-size:11px;color:#16a34a;margin-top:8px;border-top:1px solid #f0f0f0;padding-top:8px;">📋 Sin degradaciones registradas aún. El detector vigila la pérdida de UFINET y los stalls a Meta/TikTok, y avisa por WhatsApp/correo.</div>`}
              </div>`;
            const bR = document.getElementById('gWanRespaldo');
            const bP = document.getElementById('gWanPrincipal');
            if (bR) bR.onclick = () => conmutarWan('respaldo', bR);
            if (bP) bP.onclick = () => conmutarWan('principal', bP);
        } catch (err) {
            box.innerHTML = `<div style="background:#fff;border:1px solid #fde68a;border-radius:12px;padding:10px;margin-bottom:10px;font-size:13px;color:#92400e;">WAN OPNsense: ${escapeHtml(err.message)}</div>`;
        }
    }
    async function conmutarWan(destino, btn) {
        const esResp = destino === 'respaldo';
        const msg = esResp
            ? '¿Conmutar la salida a RESPALDO (TIGO)?\n\nTodas las zonas que salen por este OPNsense cambiarán de operador e IP pública, y se reiniciarán las conexiones activas. Úsalo cuando UFINET esté con pérdida/intermitencia.'
            : '¿Volver a PRINCIPAL (UFINET)?\n\nLas zonas regresan a UFINET. Hazlo cuando UFINET ya esté estable.';
        if (!confirm(msg)) return;
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Conmutando…'; }
        try {
            const r = await API.post('/api/isp/wan/conmutar', { destino });
            toast(r.ok ? (esResp ? 'Conmutado a RESPALDO (TIGO) ✓' : 'De vuelta en PRINCIPAL (UFINET) ✓') : ('Respuesta: ' + (r.salida || '')), r.ok ? 'success' : 'error');
            setTimeout(pintarWan, 2500);
        } catch (e) {
            toast(e.message.includes('permiso') || e.message.includes('admin') ? 'Sin permiso (requiere gestionar MikroTik/admin)' : ('Error: ' + e.message), 'error');
            if (btn) btn.disabled = false;
            pintarWan();
        }
    }

    async function cargarMikrotiks() {
        const cont = document.getElementById('gLista'); if (!cont) return;
        try {
            const [estados, lista] = await Promise.all([
                API.get('/api/isp/mikrotiks/estados'),
                API.get('/api/isp/mikrotiks')
            ]);
            const cpuById = {}; (lista || []).forEach(m => { cpuById[m.id] = m; });
            const arr = estados || [];
            const wanHtml = `<div id="gWanCard"></div>`;
            if (!arr.length) { cont.innerHTML = wanHtml + `<div style="text-align:center;padding:24px;color:#9ca3af;">No hay MikroTiks configurados.</div>`; pintarWan(); return; }
            cont.innerHTML = wanHtml + arr.map(m => {
                const online = !!m.en_linea;
                const full = cpuById[m.id] || {};
                const cpu = (full.cpu_load != null) ? Number(full.cpu_load) : null;
                const umbral = Number(full.cpu_umbral_alerta) || 80;
                const cpuColor = cpu == null ? '#9ca3af' : (cpu >= umbral ? '#dc2626' : cpu >= umbral * 0.75 ? '#f59e0b' : '#16a34a');
                return `<div style="background:#fff;border:1px solid #e5e7eb;border-left:5px solid ${online ? '#16a34a' : '#dc2626'};border-radius:10px;padding:10px;margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                      <div>
                        <div style="font-weight:700;">${escapeHtml(m.nombre)}</div>
                        <div style="font-size:12px;color:#6b7280;">${escapeHtml(m.ip || '')}</div>
                        <div style="font-size:12px;color:${online ? '#16a34a' : '#dc2626'};font-weight:600;">${online ? '🟢 En línea' : '🔴 Sin conexión'}</div>
                        ${!online && m.error_msg ? `<div style="font-size:11px;color:#dc2626;">${escapeHtml(m.error_msg)}</div>` : ''}
                        <div style="font-size:11px;color:#9ca3af;">Últ. OK: ${fecha(m.ultimo_ok)}</div>
                      </div>
                      <div style="text-align:right;">
                        <div style="font-size:22px;font-weight:700;color:${cpuColor};">${cpu == null ? '—' : cpu + '%'}</div>
                        <div style="font-size:11px;color:#9ca3af;">CPU${cpu != null ? ' (umbral ' + umbral + '%)' : ''}</div>
                      </div>
                    </div></div>`;
            }).join('');
            pintarWan();
        } catch (e) { cont.innerHTML = `<div style="text-align:center;padding:24px;color:#dc2626;">${escapeHtml(e.message)}</div>`; }
    }

    return { show };
})();

if (typeof Router !== 'undefined') Router.register('guardian', () => GuardianPage.show());
