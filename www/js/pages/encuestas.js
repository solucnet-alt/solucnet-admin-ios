// Página: Encuestas de retiro + PQR (app admin) — réplica del panel web public/encuestas-retiro.html
// Permiso: ver_visitas (igual que el botón "Encuestas" del panel web — index.html mapea btn-encuestas → ver_visitas).
// Endpoints backend (ya existentes, protegidos por requireAuth):
//   GET  /api/retiro-encuestas?q=            → { success, encuestas[], total }
//   GET  /api/retiro-encuestas/:id/firma     → { success, firma(dataURL) }
//   GET  /api/pqr/stats                       → { stats:[{estado,n}] }
//   GET  /api/pqr?q=&estado=                  → { ok, pqrs[] }
//   GET  /api/pqr/:id                         → { ok, pqr }
//   POST /api/pqr/mejorar-redaccion {texto,tipo,nombre}        → { ok, mejorado }
//   POST /api/pqr/:id/estado {estado}                          → { ok }
//   POST /api/pqr/:id/responder {respuesta}                    → { ok, codigo, emailEnviado, warning, pendienteFirma, error }
//   POST /api/pqr/:id/reintentar-firma                         → { ok, codigo, emailEnviado, warning, pendienteFirma, error }
const EncuestasPage = (function () {
    const PERM = 'ver_visitas';
    let _tab = 'retiro';        // 'retiro' | 'pqr'
    let _qRetiro = '';
    let _qPqr = '';
    let _estadoPqr = '';
    let _pqrActual = null;
    let _pqrMejora = '';
    let _buscarTimer = null;

    function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    function toast(msg, tipo) {
        const t = document.getElementById('toast'); if (!t) { alert(msg); return; }
        t.textContent = msg; t.className = 'toast show' + (tipo === 'error' ? ' error' : tipo === 'success' ? ' success' : '');
        clearTimeout(t._to); t._to = setTimeout(() => { t.className = 'toast'; }, 3500);
    }
    function fmtFecha(s) { if (!s) return ''; try { return new Date(s).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return escapeHtml(s); } }

    // Color por nivel de calificación (0-5) con tokens del sistema
    function _colCalif(avg) { return avg >= 4 ? 'var(--sn-success)' : avg >= 3 ? 'var(--sn-warning)' : avg > 0 ? 'var(--sn-danger)' : 'var(--sn-text-tertiary)'; }
    // Estrellas ★ usando color de marca/token
    function stars(n) {
        n = parseInt(n) || 0; let h = '';
        for (let i = 1; i <= 5; i++) h += `<i class="fas fa-star" style="color:${i <= n ? 'var(--sn-warning)' : 'var(--sn-border-strong)'};font-size:.8em;"></i>`;
        return `<span title="${n}/5" style="white-space:nowrap;letter-spacing:1px;">${h}</span>`;
    }
    // Anillo de progreso SVG (donut). pct 0..1. center = HTML del centro. color = token/var()
    function ringSVG(pct, color, size, stroke, center) {
        const r = (size - stroke) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, pct)));
        return `<div style="position:relative;width:${size}px;height:${size}px;">
            <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
              <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" style="stroke:var(--sn-surface-2);" stroke-width="${stroke}"/>
              <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" style="stroke:${color};transition:stroke-dashoffset .7s ease;" stroke-width="${stroke}"
                stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
                transform="rotate(-90 ${size / 2} ${size / 2})"/>
            </svg>
            <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">${center}</div>
          </div>`;
    }
    // Badge de tipo de PQR
    function badgeTipo(tipo) {
        const t = String(tipo || '').toLowerCase();
        const cls = t === 'queja' ? 'sn-badge--warn' : t === 'reclamo' ? 'sn-badge--danger' : t === 'sugerencia' ? 'sn-badge--ok' : 'sn-badge--info';
        return `<span class="sn-badge ${cls}" style="text-transform:capitalize;">${escapeHtml(tipo || '-')}</span>`;
    }
    // Badge de estado de PQR (o vencido)
    function badgeEstado(estado, vencido) {
        if (vencido) return `<span class="sn-badge sn-badge--danger">Vencido</span>`;
        const e = String(estado || '').toLowerCase();
        const map = { recibido: ['sn-badge--info', 'Recibido'], en_proceso: ['sn-badge--warn', 'En proceso'], respondido: ['sn-badge--ok', 'Respondido'], cerrado: ['sn-badge--off', 'Cerrado'] };
        const [cls, txt] = map[e] || ['sn-badge--off', estado || '-'];
        return `<span class="sn-badge ${cls}">${escapeHtml(txt)}</span>`;
    }

    function ensurePage() {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const main = document.querySelector('.app-main');
        let page = document.getElementById('page-encuestas');
        if (!page) { page = document.createElement('div'); page.id = 'page-encuestas'; page.className = 'page'; main.appendChild(page); }
        page.classList.add('active');
        return page;
    }

    async function show() {
        const page = ensurePage();
        page.innerHTML = `
            <div style="padding:var(--sn-space-3);max-width:900px;margin:0 auto;">
              <h2 style="margin:var(--sn-space-1) 0 var(--sn-space-3);font-size:var(--sn-text-xl);color:var(--sn-text-primary);"><i class="fas fa-clipboard-list"></i> Encuestas &middot; PQR</h2>
              <div style="display:flex;gap:var(--sn-space-2);margin-bottom:var(--sn-space-3);">
                <button id="enTabRetiro" class="sn-btn sn-btn--sm" style="flex:1;"><i class="fas fa-clipboard-list"></i> Encuestas de retiro</button>
                <button id="enTabPqr" class="sn-btn sn-btn--sm" style="flex:1;"><i class="fas fa-inbox"></i> PQR <span id="enPqrBadge" class="sn-badge sn-badge--danger" style="display:none;">0</span></button>
              </div>
              <div id="enTabRetiroBody"></div>
              <div id="enTabPqrBody" style="display:none;"></div>
            </div>`;
        page.querySelector('#enTabRetiro').onclick = () => { _tab = 'retiro'; pintarTabs(); if (!_retiroCargado) cargarRetiro(); };
        page.querySelector('#enTabPqr').onclick = () => { _tab = 'pqr'; pintarTabs(); if (!_pqrCargado) cargarPqr(); };
        pintarTabs();
        renderRetiroShell();
        renderPqrShell();
        _retiroCargado = false; _pqrCargado = false;
        cargarRetiro();
        actualizarBadgePqr();
    }

    function pintarTabs() {
        const r = document.getElementById('enTabRetiro'), p = document.getElementById('enTabPqr');
        if (!r || !p) return;
        r.classList.toggle('sn-btn--primary', _tab === 'retiro');
        p.classList.toggle('sn-btn--primary', _tab === 'pqr');
        document.getElementById('enTabRetiroBody').style.display = _tab === 'retiro' ? '' : 'none';
        document.getElementById('enTabPqrBody').style.display = _tab === 'pqr' ? '' : 'none';
    }

    // ═══════════════ Encuestas de retiro ═══════════════
    let _retiroCargado = false;
    function renderRetiroShell() {
        const body = document.getElementById('enTabRetiroBody');
        body.innerHTML = `
            <div class="sn-row" style="gap:var(--sn-space-2);padding:0 0 var(--sn-space-3);border:none;">
              <input type="text" id="enQRetiro" placeholder="Buscar por nombre, cédula o motivo…"
                style="flex:1;min-width:0;padding:.55rem .7rem;border:1px solid var(--sn-border);border-radius:var(--sn-radius-md);background:var(--sn-surface);color:var(--sn-text-primary);font-size:var(--sn-text-sm);">
              <button id="enBtnBuscarRetiro" class="sn-btn sn-btn--primary sn-btn--sm"><i class="fas fa-search"></i></button>
            </div>
            <div id="enRetiroResumen"></div>
            <div id="enRetiroLista"><div class="sn-empty"><i class="fas fa-spinner fa-spin"></i> Cargando…</div></div>`;
        const inp = body.querySelector('#enQRetiro');
        inp.value = _qRetiro;
        inp.onkeydown = (e) => { if (e.key === 'Enter') { _qRetiro = inp.value.trim(); cargarRetiro(); } };
        body.querySelector('#enBtnBuscarRetiro').onclick = () => { _qRetiro = inp.value.trim(); cargarRetiro(); };
    }

    async function cargarRetiro() {
        _retiroCargado = true;
        const resumen = document.getElementById('enRetiroResumen');
        const cont = document.getElementById('enRetiroLista'); if (!cont) return;
        cont.innerHTML = `<div class="sn-empty"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>`;
        try {
            const q = _qRetiro ? ('?q=' + encodeURIComponent(_qRetiro)) : '';
            const d = await API.get('/api/retiro-encuestas' + q);
            if (!d || !d.success) { cont.innerHTML = `<div class="sn-empty">Error: ${escapeHtml((d && d.message) || '')}</div>`; return; }
            const e = d.encuestas || [];
            renderResumen(e);
            if (!e.length) { cont.innerHTML = `<div class="sn-empty"><i class="fas fa-inbox"></i>Sin encuestas${_qRetiro ? ' para esa búsqueda' : ''}.</div>`; return; }
            cont.innerHTML = `<div class="sn-section-title">${e.length}${_qRetiro ? ' resultado(s)' : ' de ' + (d.total || e.length)} encuestas</div>` + e.map(x => {
                const esTecnico = (x.comentarios_adicionales || '').toLowerCase().includes('registrado por t');
                if (esTecnico) {
                    return `<div class="sn-card sn-card--accent">
                        <div style="display:flex;justify-content:space-between;gap:var(--sn-space-2);">
                          <div class="sn-row__title">${escapeHtml(x.nombre_completo || '')}</div>
                          <span class="sn-badge sn-badge--warn">🔧 Retiro por técnico</span>
                        </div>
                        <div class="sn-row__sub">${escapeHtml(x.numero_documento || '')} · ${escapeHtml(x.fecha || '')}</div>
                        <div style="font-size:var(--sn-text-sm);color:var(--sn-text-secondary);margin-top:var(--sn-space-2);">Motivo: <b>${escapeHtml(x.motivo_retiro || '(sin motivo)')}</b></div>
                        <div class="sn-row__sub" style="font-style:italic;margin-top:var(--sn-space-1);">Retiro realizado por el técnico (sin encuesta del cliente).</div>
                      </div>`;
                }
                const fila = (lbl, val) => `<div style="display:flex;justify-content:space-between;font-size:var(--sn-text-sm);padding:1px 0;"><span style="color:var(--sn-text-secondary);">${lbl}</span>${stars(val)}</div>`;
                return `<div class="sn-card">
                    <div style="display:flex;justify-content:space-between;gap:var(--sn-space-2);align-items:flex-start;">
                      <div class="sn-row__main">
                        <div class="sn-row__title">${escapeHtml(x.nombre_completo || '')}</div>
                        <div class="sn-row__sub">${escapeHtml(x.numero_documento || '')} · ${escapeHtml(x.fecha || '')}</div>
                      </div>
                      ${x.tiene_firma ? `<button class="sn-btn sn-btn--ghost sn-btn--sm en-firma" data-id="${x.id}"><i class="fas fa-signature"></i> Firma</button>` : ''}
                    </div>
                    <div style="margin-top:var(--sn-space-2);">
                      ${fila('Velocidad', x.calif_velocidad)}${fila('Estabilidad', x.calif_estabilidad)}${fila('Atención', x.calif_atencion_cliente)}
                      ${fila('Precio', x.calif_precio)}${fila('Instalación', x.calif_instalacion)}${fila('Soporte', x.calif_soporte_tecnico)}
                    </div>
                    ${x.motivo_retiro ? `<div style="font-size:var(--sn-text-sm);margin-top:var(--sn-space-2);color:var(--sn-text-primary);"><b>Motivo:</b> ${escapeHtml(x.motivo_retiro)}</div>` : ''}
                    ${x.comentarios_adicionales ? `<div class="sn-row__sub" style="margin-top:var(--sn-space-1);">${escapeHtml(x.comentarios_adicionales)}</div>` : ''}
                  </div>`;
            }).join('');
            cont.querySelectorAll('.en-firma').forEach(b => b.onclick = () => verFirma(b.dataset.id));
        } catch (err) { if (resumen) resumen.innerHTML = ''; cont.innerHTML = `<div class="sn-empty">${escapeHtml(err.message)}</div>`; }
    }

    function renderResumen(e) {
        const el = document.getElementById('enRetiroResumen'); if (!el) return;
        if (!e || !e.length) { el.innerHTML = ''; return; }
        const cats = [
            { k: 'calif_velocidad', l: 'Velocidad', ic: '🚀', tip: 'Revisar planes/ancho de banda y saturación en la zona.' },
            { k: 'calif_estabilidad', l: 'Estabilidad', ic: '📶', tip: 'Auditar NAPs, potencias ópticas y cortes recurrentes.' },
            { k: 'calif_atencion_cliente', l: 'Atención', ic: '🎧', tip: 'Reforzar tiempos de respuesta y trato en soporte.' },
            { k: 'calif_precio', l: 'Precio', ic: '💲', tip: 'Evaluar competitividad de tarifas y percepción de valor.' },
            { k: 'calif_instalacion', l: 'Instalación', ic: '🔧', tip: 'Mejorar prolijidad y tiempos de instalación.' },
            { k: 'calif_soporte_tecnico', l: 'Soporte', ic: '🛠️', tip: 'Capacitar y acelerar la resolución técnica.' }];
        const calificadas = e.filter(x => cats.some(c => (parseInt(x[c.k]) || 0) > 0));
        const sinCalif = e.length - calificadas.length;
        const proms = cats.map(c => {
            const vals = calificadas.map(x => parseInt(x[c.k]) || 0).filter(v => v > 0);
            const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
            return { ...c, avg, n: vals.length };
        });
        const conDato = proms.filter(p => p.n > 0);
        const global = conDato.length ? conDato.reduce((s, p) => s + p.avg, 0) / conDato.length : 0;
        const gCol = _colCalif(global);

        // KPIs
        let html = `<div class="sn-grid-3" style="margin-bottom:var(--sn-space-3);">
            <div class="sn-stat"><div class="sn-stat__num">${e.length}</div><div class="sn-stat__label">Totales</div></div>
            <div class="sn-stat"><div class="sn-stat__num" style="color:var(--sn-success);">${calificadas.length}</div><div class="sn-stat__label">Con calificación</div></div>
            <div class="sn-stat"><div class="sn-stat__num" style="color:var(--sn-text-tertiary);">${sinCalif}</div><div class="sn-stat__label">Por técnico</div></div>
          </div>`;

        // Satisfacción por categoría
        html += `<div class="sn-card"><div class="sn-section-title">⭐ Satisfacción por categoría (1 a 5 · excluye las de técnicos)</div>
            <div style="display:flex;flex-wrap:wrap;gap:var(--sn-space-5);align-items:center;justify-content:center;">
              <div style="text-align:center;">
                ${ringSVG(global / 5, gCol, 128, 14, `<div style="font-size:var(--sn-text-xl);font-weight:var(--sn-weight-bold);color:${gCol};">${global ? global.toFixed(1) : '—'}</div><div style="font-size:var(--sn-text-xs);color:var(--sn-text-tertiary);">de 5.0</div>`)}
                <div style="font-weight:var(--sn-weight-semibold);color:var(--sn-text-primary);margin-top:var(--sn-space-2);">Satisfacción global</div>
                <div class="sn-row__sub">${calificadas.length} calificadas</div>
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:var(--sn-space-2);flex:1;min-width:260px;">`;
        proms.forEach(p => {
            const col = _colCalif(p.avg);
            html += `<div style="text-align:center;padding:var(--sn-space-2) 0;">
                ${ringSVG(p.avg / 5, col, 72, 8, `<span style="font-size:var(--sn-text-md);font-weight:var(--sn-weight-bold);color:${col};">${p.avg ? p.avg.toFixed(1) : '—'}</span>`)}
                <div style="font-size:var(--sn-text-xs);color:var(--sn-text-secondary);margin-top:var(--sn-space-1);font-weight:var(--sn-weight-semibold);">${p.ic} ${p.l}</div>
                <div class="sn-row__sub">${p.n} calif.</div>
              </div>`;
        });
        html += `</div></div></div>`;

        // Puntos a mejorar
        const mejorar = conDato.filter(p => p.avg < 3.5).sort((a, b) => a.avg - b.avg);
        html += `<div class="sn-card"><div class="sn-section-title">🎯 Puntos a mejorar</div>`;
        if (mejorar.length) {
            mejorar.forEach(p => {
                const crit = p.avg < 2.5; const col = _colCalif(p.avg);
                html += `<div class="sn-row" style="border-radius:var(--sn-radius-md);margin-bottom:var(--sn-space-2);background:var(--sn-surface-2);">
                    <div style="width:38px;height:38px;border-radius:var(--sn-radius-full);display:flex;align-items:center;justify-content:center;flex:0 0 auto;">${p.ic}</div>
                    <div class="sn-row__main"><div class="sn-row__title">${p.l} ${crit ? '<span style="color:var(--sn-danger);font-size:var(--sn-text-xs);">· crítico</span>' : ''}</div><div class="sn-row__sub">${p.tip}</div></div>
                    <div style="font-weight:var(--sn-weight-bold);color:${col};">${p.avg.toFixed(1)}<span class="sn-row__sub" style="display:inline;">/5</span></div>
                  </div>`;
            });
        } else {
            html += `<div class="sn-row" style="border:none;color:var(--sn-green-800);"><i class="fas fa-check-circle"></i> Todas las categorías calificadas están en buen nivel (3.5 o más).</div>`;
        }
        html += `</div>`;

        // Motivos de retiro (donut)
        const motivos = {};
        e.forEach(x => { const m = ((x.motivo_retiro || '').trim()) || '(sin motivo)'; motivos[m] = (motivos[m] || 0) + 1; });
        const top = Object.entries(motivos).sort((a, b) => b[1] - a[1]).slice(0, 6);
        const totalM = top.reduce((s, [, n]) => s + n, 0);
        if (top.length) {
            const palette = ['var(--brand)', 'var(--sn-teal-500)', 'var(--sn-success)', 'var(--sn-warning)', 'var(--sn-danger)', 'var(--sn-info)'];
            const size = 148, stroke = 26, r = (size - stroke) / 2, c = 2 * Math.PI * r;
            let acc = 0, segs = '';
            top.forEach(([, n], i) => {
                const frac = n / totalM, dash = c * frac;
                segs += `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" style="stroke:${palette[i]};" stroke-width="${stroke}"
                    stroke-dasharray="${dash.toFixed(1)} ${(c - dash).toFixed(1)}" stroke-dashoffset="${(-acc).toFixed(1)}"
                    transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
                acc += dash;
            });
            const legend = top.map(([m, n], i) => `<div style="display:flex;align-items:center;gap:var(--sn-space-2);font-size:var(--sn-text-sm);color:var(--sn-text-secondary);">
                <span style="width:11px;height:11px;border-radius:3px;flex:0 0 auto;background:${palette[i]};"></span>
                <span style="text-transform:capitalize;">${escapeHtml(m)}</span> <b style="color:var(--sn-text-primary);">${n}</b> <span class="sn-row__sub" style="display:inline;">(${Math.round(n / totalM * 100)}%)</span></div>`).join('');
            html += `<div class="sn-card"><div class="sn-section-title">📋 Motivos de retiro más frecuentes</div>
                <div style="display:flex;flex-wrap:wrap;gap:var(--sn-space-5);align-items:center;justify-content:center;">
                  <div style="position:relative;flex:0 0 auto;">
                    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${segs}</svg>
                    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                      <div style="font-size:var(--sn-text-lg);font-weight:var(--sn-weight-bold);color:var(--sn-text-primary);">${totalM}</div>
                      <div class="sn-row__sub">retiros</div></div>
                  </div>
                  <div style="display:flex;flex-direction:column;gap:var(--sn-space-2);flex:1;min-width:210px;">${legend}</div>
                </div></div>`;
        }
        el.innerHTML = html;
    }

    async function verFirma(id) {
        try {
            const d = await API.get('/api/retiro-encuestas/' + id + '/firma');
            if (d && d.success && d.firma) { abrirLightbox(d.firma); }
            else toast('Esta encuesta no tiene firma.', 'error');
        } catch (e) { toast('No se pudo cargar la firma', 'error'); }
    }
    function abrirLightbox(src) {
        let ov = document.getElementById('enLightbox');
        if (!ov) { ov = document.createElement('div'); ov.id = 'enLightbox'; document.body.appendChild(ov); }
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:100000;display:flex;align-items:center;justify-content:center;padding:var(--sn-space-5);';
        ov.innerHTML = `<div style="background:var(--sn-surface);padding:var(--sn-space-4);border-radius:var(--sn-radius-lg);text-align:center;max-width:95%;">
            <div class="sn-section-title" style="margin-top:0;">Firma del cliente</div>
            <img src="${escapeHtml(src)}" alt="firma" style="max-width:100%;max-height:70vh;">
          </div>`;
        ov.onclick = () => ov.remove();
    }

    // ═══════════════ PQR ═══════════════
    let _pqrCargado = false;
    function renderPqrShell() {
        const body = document.getElementById('enTabPqrBody');
        body.innerHTML = `
            <div class="sn-row" style="gap:var(--sn-space-2);padding:0 0 var(--sn-space-3);border:none;flex-wrap:wrap;">
              <input type="text" id="enQPqr" placeholder="Buscar por radicado, nombre, cédula o correo…"
                style="flex:1;min-width:0;padding:.55rem .7rem;border:1px solid var(--sn-border);border-radius:var(--sn-radius-md);background:var(--sn-surface);color:var(--sn-text-primary);font-size:var(--sn-text-sm);">
              <select id="enEstadoPqr" style="padding:.55rem .5rem;border:1px solid var(--sn-border);border-radius:var(--sn-radius-md);background:var(--sn-surface);color:var(--sn-text-primary);font-size:var(--sn-text-sm);">
                <option value="">Todos</option><option value="recibido">Recibido</option><option value="en_proceso">En proceso</option><option value="respondido">Respondido</option><option value="cerrado">Cerrado</option>
              </select>
              <button id="enBtnBuscarPqr" class="sn-btn sn-btn--primary sn-btn--sm"><i class="fas fa-search"></i></button>
            </div>
            <div id="enPqrLista"><div class="sn-empty"><i class="fas fa-spinner fa-spin"></i> Cargando…</div></div>`;
        const inp = body.querySelector('#enQPqr'); inp.value = _qPqr;
        const sel = body.querySelector('#enEstadoPqr'); sel.value = _estadoPqr;
        inp.onkeydown = (e) => { if (e.key === 'Enter') { _qPqr = inp.value.trim(); cargarPqr(); } };
        sel.onchange = () => { _estadoPqr = sel.value; cargarPqr(); };
        body.querySelector('#enBtnBuscarPqr').onclick = () => { _qPqr = inp.value.trim(); cargarPqr(); };
    }

    async function actualizarBadgePqr() {
        try {
            const d = await API.get('/api/pqr/stats');
            let pend = 0;
            (d && d.stats || []).forEach(s => { if (s.estado === 'recibido' || s.estado === 'en_proceso') pend += Number(s.n) || 0; });
            const b = document.getElementById('enPqrBadge'); if (!b) return;
            if (pend > 0) { b.textContent = pend; b.style.display = ''; } else b.style.display = 'none';
        } catch { }
    }

    async function cargarPqr() {
        _pqrCargado = true;
        const cont = document.getElementById('enPqrLista'); if (!cont) return;
        cont.innerHTML = `<div class="sn-empty"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>`;
        try {
            const params = new URLSearchParams();
            if (_qPqr) params.set('q', _qPqr); if (_estadoPqr) params.set('estado', _estadoPqr);
            const d = await API.get('/api/pqr' + (params.toString() ? ('?' + params) : ''));
            if (!d || !d.ok) { cont.innerHTML = `<div class="sn-empty">Error: ${escapeHtml((d && d.error) || '')}</div>`; return; }
            const list = d.pqrs || [];
            if (!list.length) { cont.innerHTML = `<div class="sn-empty"><i class="fas fa-inbox"></i>Sin PQR${_qPqr || _estadoPqr ? ' para ese filtro' : ''}.</div>`; return; }
            cont.innerHTML = `<div class="sn-section-title">${list.length} PQR</div>` + list.map(p => {
                const venc = Number(p.vencido) === 1;
                const avisoFirma = p.firma_estado === 'pendiente' ? '<span class="sn-badge sn-badge--warn">⏳ Esperando firma</span>'
                    : (p.firma_estado === 'error' ? '<span class="sn-badge sn-badge--danger">⚠️ Firma con error</span>' : '');
                return `<div class="sn-card en-pqr" data-id="${p.id}" style="cursor:pointer;">
                    <div style="display:flex;justify-content:space-between;gap:var(--sn-space-2);align-items:flex-start;">
                      <div class="sn-row__main">
                        <div class="sn-row__title">${escapeHtml(p.radicado || '')} ${badgeTipo(p.tipo)}</div>
                        <div class="sn-row__sub">${escapeHtml(p.nombre || '')}${p.cedula ? ' · CC ' + escapeHtml(p.cedula) : ''}</div>
                        <div class="sn-row__sub">${fmtFecha(p.fecha_creacion)}${p.fecha_limite ? ' · límite ' + escapeHtml(p.fecha_limite) : ''}</div>
                      </div>
                      <div style="text-align:right;display:flex;flex-direction:column;gap:var(--sn-space-1);align-items:flex-end;">${badgeEstado(p.estado, venc)}${avisoFirma}</div>
                    </div></div>`;
            }).join('');
            cont.querySelectorAll('.en-pqr').forEach(c => c.onclick = () => verPqr(c.dataset.id));
            actualizarBadgePqr();
        } catch (e) { cont.innerHTML = `<div class="sn-empty">${escapeHtml(e.message)}</div>`; }
    }

    async function verPqr(id) {
        try {
            const d = await API.get('/api/pqr/' + id);
            if (!d || !d.ok) { toast('No se pudo cargar el PQR', 'error'); return; }
            const p = d.pqr; _pqrActual = p; _pqrMejora = '';
            const yaResp = p.estado === 'respondido' || p.estado === 'cerrado';
            const field = (k, v) => `<div style="margin:var(--sn-space-2) 0;"><div style="font-size:var(--sn-text-xs);color:var(--sn-text-tertiary);text-transform:uppercase;letter-spacing:.04em;">${k}</div><div style="font-size:var(--sn-text-sm);margin-top:2px;white-space:pre-wrap;word-break:break-word;color:var(--sn-text-primary);">${v}</div></div>`;
            const desc = (txt) => `<div style="background:var(--sn-surface-2);border:1px solid var(--sn-border-soft);border-radius:var(--sn-radius-md);padding:var(--sn-space-3);white-space:pre-wrap;word-break:break-word;font-size:var(--sn-text-sm);color:var(--sn-text-primary);">${escapeHtml(txt || '')}</div>`;
            let body = `
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--sn-space-2);">
                  <div><div class="sn-row__title" style="font-size:var(--sn-text-lg);">${escapeHtml(p.radicado || '')}</div>
                    <div style="margin-top:var(--sn-space-1);">${badgeTipo(p.tipo)} ${badgeEstado(p.estado, false)}</div></div>
                  <button class="sn-btn sn-btn--ghost sn-btn--sm" id="enPqrCerrar">✕</button>
                </div>
                ${field('Cliente', escapeHtml(p.nombre || '') + (p.cedula ? ' · CC ' + escapeHtml(p.cedula) : '') + (p.contrato ? ' · Contrato ' + escapeHtml(p.contrato) : ''))}
                ${field('Contacto', escapeHtml(p.email || '') + (p.telefono ? ' · ' + escapeHtml(p.telefono) : ''))}
                ${field('Radicado', fmtFecha(p.fecha_creacion) + ' · límite ' + escapeHtml(p.fecha_limite || ''))}
                ${p.asunto ? field('Asunto', escapeHtml(p.asunto)) : ''}
                <div style="margin:var(--sn-space-2) 0;"><div style="font-size:var(--sn-text-xs);color:var(--sn-text-tertiary);text-transform:uppercase;letter-spacing:.04em;margin-bottom:var(--sn-space-1);">Solicitud del cliente</div>${desc(p.descripcion)}</div>`;
            if (yaResp) {
                const firmaTxt = p.firma_codigo
                    ? field('Firmada por el representante legal en Vigente', `Código <b style="font-family:var(--sn-font-mono);">${escapeHtml(p.firma_codigo)}</b>${p.firma_url ? ` · <a href="${escapeHtml(p.firma_url)}" target="_blank" rel="noopener" style="color:var(--brand);">verificar</a>` : ''}`)
                    : '';
                body += `<div style="margin:var(--sn-space-2) 0;"><div style="font-size:var(--sn-text-xs);color:var(--sn-text-tertiary);text-transform:uppercase;letter-spacing:.04em;margin-bottom:var(--sn-space-1);">Respuesta enviada ${p.respondido_por_nombre ? 'por ' + escapeHtml(p.respondido_por_nombre) : ''} · ${fmtFecha(p.fecha_respuesta)} ${Number(p.email_enviado) === 1 ? '✅ correo enviado' : '⚠️ correo NO salió'}</div>${desc(p.respuesta)}</div>
                    ${firmaTxt}
                    <div style="display:flex;gap:var(--sn-space-2);flex-wrap:wrap;margin-top:var(--sn-space-3);"><button class="sn-btn sn-btn--ghost" id="enPqrCerrar2">Cerrar</button></div>`;
            } else if (p.firma_estado === 'pendiente' || p.firma_estado === 'error') {
                const esError = p.firma_estado === 'error';
                body += `<div class="sn-card" style="background:var(--sn-surface-2);border-left:4px solid ${esError ? 'var(--sn-danger)' : 'var(--sn-warning)'};">
                    <b style="color:var(--sn-text-primary);">${esError ? '⚠️ No se pudo firmar la respuesta' : '⏳ Respuesta escrita, esperando la firma en Vigente'}</b>
                    <div style="font-size:var(--sn-text-sm);margin-top:var(--sn-space-1);color:var(--sn-text-secondary);">${esError ? 'Hay algo que arreglar antes de que salga. Cuando esté, tocá «Reintentar ahora».' : 'Se firma y se envía sola apenas Vigente responda. Al cliente todavía no le llegó nada.'}</div>
                    ${p.firma_error ? `<div class="sn-row__sub" style="margin-top:var(--sn-space-1);word-break:break-word;">Motivo: ${escapeHtml(p.firma_error)}</div>` : ''}
                    <div class="sn-row__sub" style="margin-top:var(--sn-space-1);">Intentos: ${Number(p.firma_intentos) || 0}${p.firma_proximo_intento && !esError ? ' · próximo: ' + fmtFecha(p.firma_proximo_intento) : ''}</div>
                  </div>
                  <div style="margin:var(--sn-space-2) 0;"><div style="font-size:var(--sn-text-xs);color:var(--sn-text-tertiary);text-transform:uppercase;letter-spacing:.04em;margin-bottom:var(--sn-space-1);">La respuesta que se va a enviar ${p.respondido_por_nombre ? '(redactó ' + escapeHtml(p.respondido_por_nombre) + ')' : ''}</div>${desc(p.respuesta)}</div>
                  <div style="display:flex;gap:var(--sn-space-2);flex-wrap:wrap;margin-top:var(--sn-space-3);">
                    <button class="sn-btn sn-btn--primary" id="enPqrReintentar" data-perm="${PERM}"><i class="fas fa-rotate"></i> Reintentar ahora</button>
                    <button class="sn-btn sn-btn--ghost" id="enPqrCerrar2">Cerrar</button>
                  </div>`;
            } else {
                body += `<div style="margin:var(--sn-space-2) 0;" data-perm="${PERM}">
                    <div style="font-size:var(--sn-text-xs);color:var(--sn-text-tertiary);text-transform:uppercase;letter-spacing:.04em;margin-bottom:var(--sn-space-1);">Respuesta formal (se enviará por correo a ${escapeHtml(p.email || '')})</div>
                    <textarea id="enPqrResp" placeholder="Escribí la respuesta formal al cliente…" style="width:100%;min-height:130px;border:1px solid var(--sn-border);border-radius:var(--sn-radius-md);padding:var(--sn-space-3);font-family:inherit;font-size:var(--sn-text-sm);background:var(--sn-surface);color:var(--sn-text-primary);resize:vertical;box-sizing:border-box;"></textarea>
                    <div style="margin-top:var(--sn-space-2);"><button class="sn-btn sn-btn--sm" id="enPqrIA" style="background:var(--sn-grad-info);color:var(--sn-on-primary);"><i class="fas fa-wand-magic-sparkles"></i> Mejorar redacción con IA</button></div>
                    <div id="enPqrPrev" style="display:none;"></div>
                  </div>
                  <div style="display:flex;gap:var(--sn-space-2);flex-wrap:wrap;margin-top:var(--sn-space-3);">
                    <button class="sn-btn sn-btn--primary" id="enPqrResponder" data-perm="${PERM}"><i class="fas fa-file-signature"></i> Firmar y enviar correo</button>
                    ${p.estado === 'recibido' ? `<button class="sn-btn" id="enPqrEnProceso" data-perm="${PERM}" style="background:var(--sn-state-pendiente-bg);color:var(--sn-state-pendiente-fg);">Marcar en proceso</button>` : ''}
                    <button class="sn-btn sn-btn--ghost" id="enPqrCerrar2">Cancelar</button>
                  </div>`;
            }
            abrirModal(body);
        } catch (e) { toast('Error: ' + e.message, 'error'); }
    }

    function abrirModal(bodyHtml) {
        let ov = document.getElementById('enPqrModal');
        if (!ov) { ov = document.createElement('div'); ov.id = 'enPqrModal'; document.body.appendChild(ov); }
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(20,10,40,.55);z-index:100000;display:flex;align-items:flex-end;justify-content:center;padding:0;';
        ov.innerHTML = `<div style="background:var(--sn-surface);border-radius:var(--sn-radius-xl) var(--sn-radius-xl) 0 0;max-width:660px;width:100%;max-height:92vh;overflow:auto;padding:var(--sn-space-4);">${bodyHtml}</div>`;
        ov.onclick = (e) => { if (e.target === ov) cerrarModal(); };
        const inner = ov.firstElementChild;
        inner.querySelector('#enPqrCerrar') && (inner.querySelector('#enPqrCerrar').onclick = cerrarModal);
        inner.querySelector('#enPqrCerrar2') && (inner.querySelector('#enPqrCerrar2').onclick = cerrarModal);
        const bR = inner.querySelector('#enPqrResponder'); if (bR) bR.onclick = () => responderPqr(_pqrActual.id);
        const bRe = inner.querySelector('#enPqrReintentar'); if (bRe) bRe.onclick = () => reintentarFirmaPqr(_pqrActual.id);
        const bEp = inner.querySelector('#enPqrEnProceso'); if (bEp) bEp.onclick = () => cambiarEstadoPqr(_pqrActual.id, 'en_proceso');
        const bIA = inner.querySelector('#enPqrIA'); if (bIA) bIA.onclick = mejorarPqr;
        // Gateo fino por permiso
        if (window.Perms && Perms.apply) Perms.apply(inner);
    }
    function cerrarModal() { const ov = document.getElementById('enPqrModal'); if (ov) ov.remove(); }

    async function responderPqr(id) {
        const ta = document.getElementById('enPqrResp');
        const txt = (ta ? ta.value : '').trim();
        if (txt.length < 5) { toast('Escribí la respuesta.', 'error'); return; }
        if (txt.length < 20) { toast('La respuesta es muy corta (mínimo 20 caracteres).', 'error'); return; }
        const btn = document.getElementById('enPqrResponder');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Firmando en Vigente…'; }
        const restaurar = () => { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-file-signature"></i> Firmar y enviar correo'; } };
        try {
            const d = await API.post('/api/pqr/' + id + '/responder', { respuesta: txt });
            if (d && d.ok) {
                if (d.emailEnviado === false) toast('Firmada (código ' + (d.codigo || '') + ') pero el correo NO salió: ' + (d.warning || ''), 'error');
                else toast('✅ Respuesta firmada y enviada al cliente. Código: ' + (d.codigo || ''), 'success');
                cerrarModal(); cargarPqr();
            } else if (d && d.pendienteFirma) {
                toast('⏳ ' + (d.error || 'Quedó pendiente de firma.'));
                cerrarModal(); cargarPqr();
            } else { toast('No se pudo: ' + ((d && d.error) || ''), 'error'); restaurar(); }
        } catch (e) { toast(e.message.includes('admin') ? 'Solo un admin puede responder' : ('Error: ' + e.message), 'error'); restaurar(); }
    }

    async function reintentarFirmaPqr(id) {
        const btn = document.getElementById('enPqrReintentar');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Firmando en Vigente…'; }
        try {
            const d = await API.post('/api/pqr/' + id + '/reintentar-firma', {});
            if (d && d.ok) {
                toast(d.emailEnviado === false ? 'Firmada (código ' + (d.codigo || '') + ') pero el correo NO salió: ' + (d.warning || '') : '✅ Firmada y enviada. Código: ' + (d.codigo || ''), d.emailEnviado === false ? 'error' : 'success');
            } else toast((d && d.pendienteFirma ? '⏳ Sigue pendiente: ' : 'No se pudo firmar: ') + ((d && d.error) || ''), 'error');
            cerrarModal(); cargarPqr();
        } catch (e) { toast('Error: ' + e.message, 'error'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-rotate"></i> Reintentar ahora'; } }
    }

    async function cambiarEstadoPqr(id, estado) {
        try {
            const d = await API.post('/api/pqr/' + id + '/estado', { estado });
            if (d && d.ok) { cerrarModal(); cargarPqr(); } else toast('No se pudo cambiar el estado.', 'error');
        } catch (e) { toast('Error: ' + e.message, 'error'); }
    }

    async function mejorarPqr() {
        const ta = document.getElementById('enPqrResp'); if (!ta) return;
        const texto = ta.value.trim();
        if (texto.length < 3) { toast('Escribí primero un borrador de la respuesta.', 'error'); return; }
        const btn = document.getElementById('enPqrIA'), prev = document.getElementById('enPqrPrev');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mejorando…'; }
        try {
            const d = await API.post('/api/pqr/mejorar-redaccion', { texto, tipo: (_pqrActual && _pqrActual.tipo) || '', nombre: (_pqrActual && _pqrActual.nombre) || '' });
            if (d && d.ok && d.mejorado) {
                _pqrMejora = d.mejorado;
                prev.style.display = 'block';
                prev.innerHTML = `<div class="sn-card" style="margin-top:var(--sn-space-2);background:var(--brand-tint);border-color:var(--brand-100);">
                    <div class="sn-section-title" style="margin-top:0;color:var(--brand);"><i class="fas fa-wand-magic-sparkles"></i> Versión mejorada (previa)</div>
                    <div style="font-size:var(--sn-text-sm);color:var(--sn-text-primary);line-height:var(--sn-leading-relaxed);white-space:pre-wrap;word-break:break-word;background:var(--sn-surface);border:1px solid var(--sn-border-soft);border-radius:var(--sn-radius-md);padding:var(--sn-space-3);">${escapeHtml(d.mejorado)}</div>
                    <div style="display:flex;gap:var(--sn-space-2);margin-top:var(--sn-space-2);">
                      <button class="sn-btn sn-btn--primary sn-btn--sm" id="enPqrUsarMejora"><i class="fas fa-check"></i> Usar esta versión</button>
                      <button class="sn-btn sn-btn--ghost sn-btn--sm" id="enPqrDescartar">Descartar</button>
                    </div></div>`;
                prev.querySelector('#enPqrUsarMejora').onclick = () => { if (_pqrMejora) ta.value = _pqrMejora; prev.style.display = 'none'; };
                prev.querySelector('#enPqrDescartar').onclick = () => { prev.style.display = 'none'; };
            } else { toast((d && d.error) || 'No se pudo mejorar el texto.', 'error'); }
        } catch (e) { toast('Error: ' + e.message, 'error'); }
        finally { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Mejorar redacción con IA'; } }
    }

    return { show };
})();

if (typeof Router !== 'undefined') Router.register('encuestas', () => EncuestasPage.show());
