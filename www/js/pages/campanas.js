// Página: Campañas (app admin) — réplica móvil del panel web public/campanas.html
// Cubre: listar campañas + ciclo de vida (iniciar/pausar/reanudar/cancelar/destinatarios),
// crear campaña (texto 24h conversacional / plantilla Meta, audiencia con filtros, adjuntos,
// seguimiento de Sol) y pestaña Plantillas Meta (crear + estado) vía /api/cloud-templates.
//
// Endpoints backend (ya existentes; protegidos por requireAuth; escrituras: gestionar_campanas):
//   GET  /api/campanas                       → [ {id,nombre,estado,total_destinatarios,enviados,respondieron,transferidos,vigencia_horas,creado_at,creada_por} ]
//   GET  /api/campanas/:id                    → { nombre, destinatarios:[{nombre,telefono,plan,zona,enviado_at,error,respondio_at,transferido_at}] }
//   GET  /api/campanas/opciones-filtros       → { bds:[], estados:{est:cnt}, planes:[{id,plan,bd,velocidad,costo,clientes}], zonas:[{id,nombre}] }
//   POST /api/campanas/contar      {filtros}                    → { total }
//   POST /api/campanas/preview     {filtros,mensaje}            → { previews:[{cliente,plan,mensaje_renderizado}] }
//   POST /api/campanas/adjuntos/upload   (FormData 'files')     → { ok, adjuntos:[{nombre,ruta,mime}] }
//   POST /api/campanas             {nombre,mensaje,filtros,instruccion_ia,adjuntos,vigencia_horas} → { campana_id, total_destinatarios, error? }
//   POST /api/campanas/:id/iniciar | /pausar | /cancelar
//   POST /api/campanas/plantilla   {nombre,plantilla_nombre,plantilla_lang,mapeo_variables,filtros,numeros_manuales} → { total_destinatarios, error? }
//   GET  /api/cloud-templates                 → { ok, templates:[{name,language,status,category,components}] }
//   POST /api/cloud-templates      {name,category,language,header,body,bodyExample,footer,button} → { ok, status, category, error? }
//   POST /api/cloud-templates/header-upload   (FormData 'imagen') → { ok, header_handle, error? }
const CampanasPage = (function () {
    let _tab = 'campanas';        // 'campanas' | 'plantillas'
    let _subtab = 'crear';        // dentro de Plantillas Meta: 'crear' | 'estado'
    let _refresh = null;
    let _modalAbierto = false;
    // Estado del formulario "Nueva campaña"
    let _opciones = null;
    let _filtros = { estados: [], planes: [], zonas: [], bds: [] };
    let _adjuntos = [];
    let _tipoEnvio = 'texto';     // 'texto' | 'plantilla'
    let _headerHandle = null;     // handle de imagen de encabezado (crear plantilla Meta)
    let _plantillasMeta = [];
    let _detalle = null;          // data del modal de destinatarios

    // Mapeo zona → BDs donde aparece (idéntico al panel web, para filtrar zonas por BD)
    const ZONA_A_BDS = {
        'reposo': ['Reposo/Salvador'], 'salvador': ['Reposo/Salvador'], 'bosque': ['Reposo/Salvador'], 'milucha': ['Reposo/Salvador'],
        'churido': ['Churido'], 'osito': ['RG/Salsi/Osito'], 'rio grande': ['RG/Salsi/Osito'], 'riogrande': ['RG/Salsi/Osito'], 'salsipuedes': ['RG/Salsi/Osito']
    };

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    function money(v) { const n = Number(v) || 0; return '$' + n.toLocaleString('es-CO'); }
    function fechaFmt(v) { try { return new Date(v).toLocaleString('es-CO'); } catch { return '-'; } }
    function waFormat(s) {
        return esc(s)
            .replace(/\*([^\*\n]+)\*/g, '<b>$1</b>')
            .replace(/_([^_\n]+)_/g, '<i>$1</i>')
            .replace(/~([^~\n]+)~/g, '<s>$1</s>')
            .replace(/\n/g, '<br>');
    }
    function toast(msg, tipo) {
        const t = document.getElementById('toast'); if (!t) { alert(msg); return; }
        t.textContent = msg; t.className = 'toast show' + (tipo === 'error' ? ' error' : tipo === 'success' ? ' success' : '');
        clearTimeout(t._to); t._to = setTimeout(() => { t.className = 'toast'; }, 3500);
    }
    function badgeEstado(estado) {
        const e = String(estado || '').toLowerCase();
        let cls = 'sn-badge--off';
        if (e === 'enviando') cls = 'sn-badge--info';
        else if (e === 'pausada') cls = 'sn-badge--warn';
        else if (e === 'completada' || e === 'finalizada') cls = 'sn-badge--ok';
        else if (e === 'cancelada') cls = 'sn-badge--danger';
        return `<span class="sn-badge ${cls}">${esc(estado || '-')}</span>`;
    }

    // Estilos scoped (una sola vez). Usa tokens del sistema de diseño — sin hex crudos inline.
    function ensureStyles() {
        if (document.getElementById('cmp-styles')) return;
        const st = document.createElement('style');
        st.id = 'cmp-styles';
        st.textContent = `
          #page-campanas { padding: 12px; max-width: 760px; margin: 0 auto; }
          .cmp-tabs { display:flex; gap:8px; margin-bottom: var(--sn-space-3); }
          .cmp-tab { flex:1; min-height: var(--sn-touch-min); border:none; border-radius: var(--sn-radius-md); font-weight: var(--sn-weight-semibold); font-size: var(--sn-text-sm); background: var(--sn-surface-2); color: var(--sn-text-secondary); cursor:pointer; }
          .cmp-tab.active { background: var(--brand-grad); color: var(--sn-on-primary); }
          .cmp-subtabs { display:flex; gap:6px; margin-bottom: var(--sn-space-3); }
          .cmp-subtab { flex:1; min-height:38px; border:1px solid var(--sn-border); border-radius: var(--sn-radius-md); font-size: var(--sn-text-xs); font-weight: var(--sn-weight-semibold); background: var(--sn-surface); color: var(--sn-text-secondary); cursor:pointer; }
          .cmp-subtab.active { background: var(--brand-tint); border-color: var(--brand); color: var(--brand-dark); }
          .cmp-label { display:block; font-weight: var(--sn-weight-semibold); font-size: var(--sn-text-sm); color: var(--sn-text-secondary); margin: var(--sn-space-3) 0 var(--sn-space-1); }
          .cmp-input, .cmp-ta, .cmp-sel { width:100%; box-sizing:border-box; padding:10px; border:1px solid var(--sn-border); border-radius: var(--sn-radius-md); background: var(--sn-surface); color: var(--sn-text-primary); font-size: var(--sn-text-sm); }
          .cmp-ta { min-height:110px; resize:vertical; font-family: inherit; line-height: var(--sn-leading-normal); }
          .cmp-chip { display:inline-block; padding:6px 11px; border:1px solid var(--sn-border); border-radius: var(--sn-radius-full); font-size: var(--sn-text-xs); background: var(--sn-surface); color: var(--sn-text-secondary); cursor:pointer; margin:0 6px 6px 0; }
          .cmp-chip.activo { background: var(--brand-tint); border-color: var(--brand); color: var(--brand-dark); font-weight: var(--sn-weight-semibold); }
          .cmp-chip .cnt { opacity:.55; margin-left:5px; font-weight: var(--sn-weight-semibold); }
          .cmp-var { padding:5px 9px; border:1px solid var(--sn-border); border-radius: var(--sn-radius-sm); background: var(--sn-surface-2); color: var(--sn-text-secondary); font-size: var(--sn-text-xs); cursor:pointer; margin:0 6px 6px 0; }
          .cmp-preview { background: var(--sn-green-100); color: var(--sn-green-900); border-radius: var(--sn-radius-md); padding:10px; font-size: var(--sn-text-sm); min-height:40px; white-space:pre-wrap; }
          .cmp-hint { font-size: var(--sn-text-xs); color: var(--sn-text-tertiary); margin-top: 4px; }
          .cmp-scrim { position:fixed; inset:0; background: rgba(0,0,0,.45); z-index: var(--sn-z-modal); display:flex; align-items:flex-end; justify-content:center; }
          .cmp-sheet { background: var(--sn-surface); width:100%; max-width:640px; border-radius: var(--sn-radius-xl) var(--sn-radius-xl) 0 0; max-height:92vh; overflow:auto; padding:16px; box-sizing:border-box; }
          .cmp-sheet__head { display:flex; justify-content:space-between; align-items:center; margin-bottom: var(--sn-space-3); position:sticky; top:-16px; background: var(--sn-surface); padding:4px 0; }
          .cmp-x { border:none; background: var(--sn-surface-2); color: var(--sn-text-secondary); border-radius: var(--sn-radius-md); min-width:36px; min-height:36px; cursor:pointer; }
          .cmp-varrow { display:flex; gap:6px; align-items:center; margin-bottom:6px; flex-wrap:wrap; }
          .cmp-tag { background: var(--brand-tint); color: var(--brand-dark); border-radius: var(--sn-radius-sm); padding:3px 7px; font-size: var(--sn-text-xs); font-weight: var(--sn-weight-semibold); font-family: var(--sn-font-mono); }
          .hidden { display:none !important; }
        `;
        document.head.appendChild(st);
    }

    function ensurePage() {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const main = document.querySelector('.app-main');
        let page = document.getElementById('page-campanas');
        if (!page) { page = document.createElement('div'); page.id = 'page-campanas'; page.className = 'page'; main.appendChild(page); }
        page.classList.add('active');
        return page;
    }
    function activa() { const p = document.getElementById('page-campanas'); return p && p.classList.contains('active'); }

    async function show() {
        ensureStyles();
        const page = ensurePage();
        page.innerHTML = `
            <h2 style="margin:4px 0 12px;font-size:20px;"><i class="fas fa-bullhorn"></i> Campañas</h2>
            <div class="cmp-tabs">
              <button class="cmp-tab ${_tab === 'campanas' ? 'active' : ''}" data-tab="campanas">Campañas</button>
              <button class="cmp-tab ${_tab === 'plantillas' ? 'active' : ''}" data-tab="plantillas">Plantillas Meta</button>
            </div>
            <div id="cmpBody"></div>`;
        page.querySelectorAll('.cmp-tab').forEach(b => b.onclick = () => { _tab = b.dataset.tab; show(); });
        if (_tab === 'campanas') renderTabCampanas(); else renderTabPlantillas();
        Perms.apply(page);
        if (_refresh) clearInterval(_refresh);
        _refresh = setInterval(() => {
            if (activa() && !_modalAbierto && _tab === 'campanas' && document.visibilityState === 'visible') cargarCampanas();
        }, 10000);
    }

    // ============================================================
    // TAB CAMPAÑAS — lista + ciclo de vida
    // ============================================================
    function renderTabCampanas() {
        const b = document.getElementById('cmpBody');
        b.innerHTML = `
            <button class="sn-btn sn-btn--primary sn-btn--block" data-perm="gestionar_campanas" id="cmpNueva" style="margin-bottom:12px;">
              <i class="fas fa-plus"></i> Nueva campaña</button>
            <div id="cmpLista"><div class="sn-empty"><i class="fas fa-spinner fa-spin"></i><p>Cargando…</p></div></div>`;
        const btn = b.querySelector('#cmpNueva'); if (btn) btn.onclick = abrirCrear;
        cargarCampanas();
        Perms.apply(b);
    }

    async function cargarCampanas() {
        const cont = document.getElementById('cmpLista'); if (!cont) return;
        try {
            const lista = await API.get('/api/campanas');
            if (!Array.isArray(lista) || !lista.length) {
                cont.innerHTML = `<div class="sn-empty"><i class="fas fa-bullhorn"></i><p>No hay campañas aún. Creá la primera.</p></div>`;
                return;
            }
            cont.innerHTML = lista.map(c => {
                const pct = c.total_destinatarios > 0 ? Math.round((c.enviados / c.total_destinatarios) * 100) : 0;
                const acc = [];
                acc.push(`<button class="sn-btn sn-btn--ghost sn-btn--sm" data-ver="${c.id}"><i class="fas fa-list"></i> Destinatarios</button>`);
                if (c.estado === 'borrador') acc.push(`<button class="sn-btn sn-btn--success sn-btn--sm" data-perm="gestionar_campanas" data-iniciar="${c.id}"><i class="fas fa-play"></i> Iniciar</button>`);
                if (c.estado === 'enviando') acc.push(`<button class="sn-btn sn-btn--ghost sn-btn--sm" data-perm="gestionar_campanas" data-pausar="${c.id}"><i class="fas fa-pause"></i> Pausar</button>`);
                if (c.estado === 'pausada') acc.push(`<button class="sn-btn sn-btn--success sn-btn--sm" data-perm="gestionar_campanas" data-iniciar="${c.id}"><i class="fas fa-play"></i> Reanudar</button>`);
                if (['borrador', 'pausada', 'enviando'].includes(c.estado)) acc.push(`<button class="sn-btn sn-btn--danger sn-btn--sm" data-perm="gestionar_campanas" data-cancelar="${c.id}"><i class="fas fa-times"></i> Cancelar</button>`);
                return `
                  <div class="sn-card">
                    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
                      <div class="sn-row__title" style="font-size:15px;">${esc(c.nombre)}</div>
                      ${badgeEstado(c.estado)}
                    </div>
                    <div class="sn-row__sub" style="margin-top:4px;"><i class="fas fa-clock"></i> ${fechaFmt(c.creado_at)} · ${esc(c.creada_por || '-')} · <i class="fas fa-bolt"></i> ${c.vigencia_horas}h contexto</div>
                    <div class="sn-grid-2" style="margin-top:10px;">
                      <div class="sn-stat"><div class="sn-stat__num">${c.total_destinatarios || 0}</div><div class="sn-stat__label">Destinos</div></div>
                      <div class="sn-stat"><div class="sn-stat__num">${c.enviados || 0} <span style="font-size:12px;">(${pct}%)</span></div><div class="sn-stat__label">Enviados</div></div>
                      <div class="sn-stat"><div class="sn-stat__num">${c.respondieron || 0}</div><div class="sn-stat__label">Respondieron</div></div>
                      <div class="sn-stat"><div class="sn-stat__num">${c.transferidos || 0}</div><div class="sn-stat__label">A asesor</div></div>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">${acc.join('')}</div>
                  </div>`;
            }).join('');
            cont.querySelectorAll('[data-ver]').forEach(x => x.onclick = () => verDetalle(x.dataset.ver));
            cont.querySelectorAll('[data-iniciar]').forEach(x => x.onclick = () => lifecycle(x.dataset.iniciar, 'iniciar', '¿Iniciar envío?'));
            cont.querySelectorAll('[data-pausar]').forEach(x => x.onclick = () => lifecycle(x.dataset.pausar, 'pausar', null));
            cont.querySelectorAll('[data-cancelar]').forEach(x => x.onclick = () => lifecycle(x.dataset.cancelar, 'cancelar', '¿Cancelar la campaña? No se podrá reanudar.'));
            Perms.apply(cont);
        } catch (e) { cont.innerHTML = `<div class="sn-empty" style="color:var(--sn-danger);">${esc(e.message)}</div>`; }
    }

    async function lifecycle(id, accion, confirmMsg) {
        if (confirmMsg && !confirm(confirmMsg)) return;
        try {
            await API.post('/api/campanas/' + id + '/' + accion, {});
            toast(accion === 'iniciar' ? 'Envío iniciado ✓' : accion === 'pausar' ? 'Campaña pausada' : 'Campaña cancelada', 'success');
            cargarCampanas();
        } catch (e) { toast(e.message.includes('admin') || e.message.includes('permiso') ? 'No tenés permiso para esta acción' : ('Error: ' + e.message), 'error'); }
    }

    // ---------- Modal destinatarios ----------
    async function verDetalle(id) {
        _modalAbierto = true;
        let ov = document.getElementById('cmpDetalle');
        if (!ov) { ov = document.createElement('div'); ov.id = 'cmpDetalle'; ov.className = 'cmp-scrim'; document.body.appendChild(ov); }
        ov.innerHTML = `
          <div class="cmp-sheet">
            <div class="cmp-sheet__head"><b id="cmpDetTit">Destinatarios</b><button class="cmp-x" id="cmpDetX">✕</button></div>
            <div id="cmpDetResumen" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;"></div>
            <div style="display:flex;gap:6px;margin-bottom:10px;">
              <input class="cmp-input" id="cmpDetBuscar" placeholder="Buscar nombre o teléfono…" style="flex:1;">
              <select class="cmp-sel" id="cmpDetFiltro" style="width:auto;">
                <option value="">Todos</option><option value="enviado">Enviados</option><option value="pendiente">Pendientes</option>
                <option value="error">Con error</option><option value="respondio">Respondieron</option><option value="transferido">A asesor</option>
              </select>
            </div>
            <div id="cmpDetLista"><div class="sn-empty"><i class="fas fa-spinner fa-spin"></i></div></div>
          </div>`;
        ov.onclick = (e) => { if (e.target === ov) cerrarDetalle(); };
        ov.querySelector('#cmpDetX').onclick = cerrarDetalle;
        ov.querySelector('#cmpDetBuscar').oninput = pintarDestinatarios;
        ov.querySelector('#cmpDetFiltro').onchange = pintarDestinatarios;
        ov._id = id;
        await refrescarDetalle(id);
        // auto-refresh del detalle cada 8s mientras esté abierto
        clearInterval(ov._t);
        ov._t = setInterval(() => { const o = document.getElementById('cmpDetalle'); if (o) refrescarDetalle(o._id); else clearInterval(ov._t); }, 8000);
    }
    function cerrarDetalle() { _modalAbierto = false; const ov = document.getElementById('cmpDetalle'); if (ov) { clearInterval(ov._t); ov.remove(); } }

    async function refrescarDetalle(id) {
        try {
            const d = await API.get('/api/campanas/' + id);
            if (d && d.error) throw new Error(d.error);
            _detalle = d;
            const tit = document.getElementById('cmpDetTit'); if (tit) tit.textContent = (d.nombre || 'Campaña') + ' — Destinatarios';
            const dests = d.destinatarios || [];
            const cEnv = dests.filter(x => x.enviado_at).length, cPend = dests.filter(x => !x.enviado_at && !x.error).length;
            const cErr = dests.filter(x => x.error).length, cResp = dests.filter(x => x.respondio_at).length, cTran = dests.filter(x => x.transferido_at).length;
            const res = document.getElementById('cmpDetResumen');
            if (res) res.innerHTML =
                `<span class="sn-badge sn-badge--ok">✓ ${cEnv} enviados</span>
                 <span class="sn-badge sn-badge--warn">⏳ ${cPend} pendientes</span>
                 <span class="sn-badge sn-badge--danger">✕ ${cErr} error</span>
                 <span class="sn-badge sn-badge--info">💬 ${cResp} respondieron</span>
                 <span class="sn-badge sn-badge--info">👤 ${cTran} a asesor</span>`;
            pintarDestinatarios();
        } catch (e) { const l = document.getElementById('cmpDetLista'); if (l) l.innerHTML = `<div class="sn-empty" style="color:var(--sn-danger);">${esc(e.message)}</div>`; }
    }

    function pintarDestinatarios() {
        if (!_detalle) return;
        const cont = document.getElementById('cmpDetLista'); if (!cont) return;
        const buscar = (document.getElementById('cmpDetBuscar')?.value || '').toLowerCase().trim();
        const filtro = document.getElementById('cmpDetFiltro')?.value || '';
        let dests = _detalle.destinatarios || [];
        if (buscar) dests = dests.filter(d => (d.nombre || '').toLowerCase().includes(buscar) || (d.telefono || '').includes(buscar));
        if (filtro === 'enviado') dests = dests.filter(d => d.enviado_at);
        else if (filtro === 'pendiente') dests = dests.filter(d => !d.enviado_at && !d.error);
        else if (filtro === 'error') dests = dests.filter(d => d.error);
        else if (filtro === 'respondio') dests = dests.filter(d => d.respondio_at);
        else if (filtro === 'transferido') dests = dests.filter(d => d.transferido_at);
        if (!dests.length) { cont.innerHTML = `<div class="sn-empty">Sin destinatarios para mostrar</div>`; return; }
        cont.innerHTML = dests.map(d => {
            let b, det = '';
            if (d.error) { b = `<span class="sn-badge sn-badge--danger">ERROR</span>`; det = esc(d.error); }
            else if (d.transferido_at) { b = `<span class="sn-badge sn-badge--info">A ASESOR</span>`; det = 'Transferido: ' + fechaFmt(d.transferido_at); }
            else if (d.respondio_at) { b = `<span class="sn-badge sn-badge--info">RESPONDIÓ</span>`; det = 'Respondió: ' + fechaFmt(d.respondio_at); }
            else if (d.enviado_at) { b = `<span class="sn-badge sn-badge--ok">ENVIADO</span>`; det = fechaFmt(d.enviado_at); }
            else { b = `<span class="sn-badge sn-badge--warn">PENDIENTE</span>`; det = 'Esperando turno…'; }
            return `<div class="sn-row">
                <div class="sn-row__main">
                  <div class="sn-row__title">${esc(d.nombre || '-')}</div>
                  <div class="sn-row__sub" style="font-family:var(--sn-font-mono);">${esc(d.telefono || '-')} · ${esc(d.plan || '-')} · ${esc(d.zona || '-')}</div>
                  <div class="sn-row__sub">${esc(det)}</div>
                </div>
                <div style="white-space:nowrap;">${b}</div>
              </div>`;
        }).join('');
    }

    // ============================================================
    // Modal NUEVA CAMPAÑA
    // ============================================================
    function abrirCrear() {
        _modalAbierto = true;
        _filtros = { estados: [], planes: [], zonas: [], bds: [] };
        _adjuntos = []; _tipoEnvio = 'texto';
        let ov = document.getElementById('cmpCrear');
        if (!ov) { ov = document.createElement('div'); ov.id = 'cmpCrear'; ov.className = 'cmp-scrim'; document.body.appendChild(ov); }
        ov.innerHTML = `
          <div class="cmp-sheet">
            <div class="cmp-sheet__head"><b>Nueva campaña</b><button class="cmp-x" id="cmpCrearX">✕</button></div>

            <label class="cmp-label">Nombre interno</label>
            <input class="cmp-input" id="c-nombre" placeholder="Ej: Promo octubre">

            <label class="cmp-label">Tipo de envío</label>
            <div style="display:flex;flex-direction:column;gap:6px;font-size:var(--sn-text-sm);">
              <label><input type="radio" name="c-tipo" value="texto" checked> Texto libre (conversacional, ventana 24h)</label>
              <label><input type="radio" name="c-tipo" value="plantilla"> Plantilla aprobada (Meta)</label>
            </div>

            <!-- Audiencia -->
            <div class="sn-section-title">Audiencia</div>
            <label class="cmp-label">Bases de datos</label><div id="f-bds"></div>
            <label class="cmp-label">Estados</label><div id="f-estados"></div>
            <label class="cmp-label">Planes <span class="cmp-hint" id="planes-info"></span></label><div id="f-planes"></div>
            <label class="cmp-label">Zonas <span class="cmp-hint" id="zonas-info"></span></label><div id="f-zonas"></div>
            <div id="contador" class="sn-badge sn-badge--info" style="margin-top:8px;">📊 Calculando…</div>

            <!-- MODO TEXTO -->
            <div id="wrap-texto">
              <label class="cmp-label">Mensaje</label>
              <div style="margin-bottom:6px;">
                <button class="cmp-var" data-var="[Nombre]">[Nombre]</button>
                <button class="cmp-var" data-var="[NombreCompleto]">[NombreCompleto]</button>
                <button class="cmp-var" data-var="[Plan]">[Plan]</button>
                <button class="cmp-var" data-var="[Velocidad]">[Velocidad]</button>
                <button class="cmp-var" data-var="[Zona]">[Zona]</button>
                <button class="cmp-var" data-var="[Costo]">[Costo]</button>
              </div>
              <textarea class="cmp-ta" id="c-mensaje" placeholder="Hola [Nombre], ..."></textarea>
              <label class="cmp-label">Vista previa</label>
              <div class="cmp-preview" id="c-preview"><span style="color:var(--sn-text-tertiary)">Escribí un mensaje…</span></div>

              <label class="cmp-label">Adjuntos (opcional)</label>
              <input type="file" id="c-files" multiple style="font-size:var(--sn-text-sm);">
              <button class="sn-btn sn-btn--ghost sn-btn--sm" id="c-subir" style="margin-top:6px;"><i class="fas fa-upload"></i> Subir</button>
              <div id="adj-list" style="margin-top:6px;"></div>

              <label class="cmp-label">Seguimiento de Sol (instrucción IA)</label>
              <div style="margin-bottom:6px;display:flex;flex-wrap:wrap;gap:6px;">
                <button class="cmp-var" data-preset="comercial">Comercial</button>
                <button class="cmp-var" data-preset="tecnico">Técnico</button>
                <button class="cmp-var" data-preset="cobranza">Cobranza</button>
                <button class="cmp-var" data-preset="filtrar">Filtrar</button>
              </div>
              <textarea class="cmp-ta" id="c-instr" style="min-height:70px;" placeholder="Qué debe hacer Sol cuando el cliente responda…"></textarea>

              <label class="cmp-label">Horas de contexto (ventana)</label>
              <input class="cmp-input" type="number" id="c-vigencia" value="24" min="1" max="720">
            </div>

            <!-- MODO PLANTILLA -->
            <div id="wrap-plantilla" class="hidden">
              <label class="cmp-label">Plantilla aprobada</label>
              <select class="cmp-sel" id="c-plantilla-select"><option value="">Cargando…</option></select>
              <div class="cmp-preview" id="c-plantilla-preview" style="margin-top:8px;"></div>
              <label class="cmp-label">Variables de la plantilla</label>
              <div id="c-plantilla-vars"></div>
              <label class="cmp-label">Números manuales (opcional)</label>
              <textarea class="cmp-ta" id="c-numeros" style="min-height:70px;" placeholder="Un número por línea. Opcional: Nombre, 3001234567"></textarea>
              <div class="cmp-hint">Se envía a los clientes de los filtros + estos números.</div>
            </div>

            <div style="display:flex;gap:8px;margin-top:16px;">
              <button class="sn-btn sn-btn--ghost sn-btn--block" id="c-borrador" data-perm="gestionar_campanas"><i class="fas fa-save"></i> Borrador</button>
              <button class="sn-btn sn-btn--primary sn-btn--block" id="c-enviar" data-perm="gestionar_campanas"><i class="fas fa-paper-plane"></i> Guardar y enviar</button>
            </div>
          </div>`;
        ov.onclick = (e) => { if (e.target === ov) cerrarCrear(); };
        ov.querySelector('#cmpCrearX').onclick = cerrarCrear;
        ov.querySelectorAll('input[name="c-tipo"]').forEach(r => r.onchange = () => { _tipoEnvio = r.value; cambiarTipoEnvio(); });
        ov.querySelectorAll('.cmp-var[data-var]').forEach(btn => btn.onclick = () => insertar('c-mensaje', btn.dataset.var, true));
        ov.querySelectorAll('.cmp-var[data-preset]').forEach(btn => btn.onclick = () => preset(btn.dataset.preset));
        ov.querySelector('#c-mensaje').oninput = actualizarPreview;
        ov.querySelector('#c-subir').onclick = subirAdjuntos;
        ov.querySelector('#c-borrador').onclick = () => guardar(false);
        ov.querySelector('#c-enviar').onclick = guardarYEnviar;
        ov.querySelector('#c-plantilla-select').onchange = seleccionarPlantilla;
        cambiarTipoEnvio();
        cargarOpciones();
        Perms.apply(ov);
    }
    function cerrarCrear() { _modalAbierto = false; const ov = document.getElementById('cmpCrear'); if (ov) ov.remove(); }

    function cambiarTipoEnvio() {
        const esP = _tipoEnvio === 'plantilla';
        document.getElementById('wrap-texto')?.classList.toggle('hidden', esP);
        document.getElementById('wrap-plantilla')?.classList.toggle('hidden', !esP);
        const borr = document.getElementById('c-borrador'); if (borr) borr.classList.toggle('hidden', esP); // borrador solo en texto
        if (esP) cargarPlantillasParaSelect();
    }

    function insertar(id, text, refresh) {
        const ta = document.getElementById(id); if (!ta) return;
        const i = ta.selectionStart ?? ta.value.length, f = ta.selectionEnd ?? ta.value.length;
        ta.value = ta.value.slice(0, i) + text + ta.value.slice(f);
        ta.focus(); ta.setSelectionRange(i + text.length, i + text.length);
        if (refresh) actualizarPreview();
    }
    function preset(tipo) {
        const P = {
            comercial: 'Si el cliente dice NO, "no me interesa", STOP, o equivalente → cierra amable y NO transfieras. Cualquier otra respuesta → transferí al asesor COMERCIAL con razón "Cliente respondió a campaña — pasar a comercial".',
            tecnico: 'Si el cliente dice NO, "no me interesa", STOP, o equivalente → cierra amable y NO transfieras. Cualquier otra respuesta → transferí al asesor TÉCNICO con razón "Cliente respondió a campaña técnica".',
            cobranza: 'Si el cliente dice que va a pagar → llamá registrarPromesaPagoConValidacion con la fecha indicada. Si dice NO o no responde claro → transferí al asesor de cobranza.',
            filtrar: 'Si el cliente dice NO, "no me interesa", STOP, o equivalente → cierra amable y NO transfieras. Cualquier otra respuesta → transferí al asesor con el contexto.'
        };
        const ta = document.getElementById('c-instr'); if (ta) ta.value = P[tipo] || '';
    }

    // ---------- Filtros de audiencia ----------
    async function cargarOpciones() {
        try {
            _opciones = await API.get('/api/campanas/opciones-filtros');
            const bds = document.getElementById('f-bds');
            if (bds) bds.innerHTML = (_opciones.bds || []).map(b => `<div class="cmp-chip" data-tipo="bds" data-val="${esc(b)}">${esc(b)}</div>`).join('');
            const est = document.getElementById('f-estados');
            if (est) est.innerHTML = Object.entries(_opciones.estados || {}).map(([e, c]) => `<div class="cmp-chip" data-tipo="estados" data-val="${esc(e)}">${esc(e)}<span class="cnt">${c}</span></div>`).join('');
            rePintarPlanesYZonas();
            // listeners de chips (delegado por grupo). Re-enganchar está OK: el modal se recrea cada apertura.
            ['f-bds', 'f-estados', 'f-planes', 'f-zonas'].forEach(gid => {
                const g = document.getElementById(gid); if (!g) return;
                g.onclick = (e) => {
                    const c = e.target.closest('.cmp-chip'); if (!c) return;
                    c.classList.toggle('activo');
                    const tipo = c.dataset.tipo; let val = c.dataset.val;
                    if (tipo === 'planes') val = parseInt(val);
                    _filtros[tipo] = _filtros[tipo] || [];
                    if (c.classList.contains('activo')) { if (!_filtros[tipo].includes(val)) _filtros[tipo].push(val); }
                    else _filtros[tipo] = _filtros[tipo].filter(v => v !== val);
                    if (tipo === 'bds') rePintarPlanesYZonas();
                    actualizarContador();
                };
            });
            actualizarContador();
        } catch (e) { toast('Error cargando filtros: ' + e.message, 'error'); }
    }

    function rePintarPlanesYZonas() {
        const bdsSel = _filtros.bds || [], noFiltro = bdsSel.length === 0;
        const planes = (_opciones?.planes || []).filter(p => noFiltro || bdsSel.includes(p.bd));
        if (_filtros.planes?.length) { const disp = new Set(planes.map(p => p.id)); _filtros.planes = _filtros.planes.filter(id => disp.has(id)); }
        const selP = new Set(_filtros.planes || []);
        const fp = document.getElementById('f-planes');
        if (fp) fp.innerHTML = planes.length
            ? planes.map(p => `<div class="cmp-chip${selP.has(p.id) ? ' activo' : ''}" data-tipo="planes" data-val="${p.id}" title="${esc(p.bd)} · ${esc(p.velocidad || '')} · ${money(p.costo)}">${esc(p.plan)}<span class="cnt">${p.clientes}</span></div>`).join('')
            : `<div class="cmp-hint">Sin planes para esa selección</div>`;
        const pi = document.getElementById('planes-info'); if (pi) pi.textContent = noFiltro ? `(todos: ${planes.length})` : `(${planes.length} de ${bdsSel.length} BD)`;
        const zonas = (_opciones?.zonas || []).filter(z => { if (noFiltro) return true; const bz = ZONA_A_BDS[(z.nombre || z.id || '').toLowerCase()] || []; return bz.some(bd => bdsSel.includes(bd)); });
        if (_filtros.zonas?.length) { const disp = new Set(zonas.map(z => z.id)); _filtros.zonas = _filtros.zonas.filter(v => disp.has(v)); }
        const selZ = new Set(_filtros.zonas || []);
        const fz = document.getElementById('f-zonas');
        if (fz) fz.innerHTML = zonas.length
            ? zonas.map(z => `<div class="cmp-chip${selZ.has(z.id) ? ' activo' : ''}" data-tipo="zonas" data-val="${esc(z.id)}">${esc(z.nombre)}</div>`).join('')
            : `<div class="cmp-hint">Sin zonas para esa selección</div>`;
        const zi = document.getElementById('zonas-info'); if (zi) zi.textContent = noFiltro ? `(todas: ${zonas.length})` : `(${zonas.length} de las BD)`;
    }

    let _contarTimer = null;
    function actualizarContador() {
        clearTimeout(_contarTimer);
        const el = document.getElementById('contador'); if (el) el.textContent = '📊 Calculando…';
        _contarTimer = setTimeout(async () => {
            try {
                const d = await API.post('/api/campanas/contar', { filtros: _filtros });
                if (el) el.textContent = `📊 ${d.total} cliente(s) coinciden`;
                actualizarPreview();
            } catch (e) { if (el) el.textContent = '⚠️ ' + e.message; }
        }, 500);
    }
    let _previewTimer = null;
    function actualizarPreview() {
        if (_tipoEnvio !== 'texto') return;
        clearTimeout(_previewTimer);
        _previewTimer = setTimeout(async () => {
            const pv = document.getElementById('c-preview'); if (!pv) return;
            const msg = document.getElementById('c-mensaje')?.value || '';
            if (!msg.trim()) { pv.innerHTML = `<span style="color:var(--sn-text-tertiary)">Escribí un mensaje…</span>`; return; }
            try {
                const d = await API.post('/api/campanas/preview', { filtros: _filtros, mensaje: msg });
                if (!d.previews?.length) { pv.innerHTML = `<span style="color:var(--sn-text-tertiary)">Sin clientes para preview</span>`; return; }
                const p = d.previews[0];
                pv.innerHTML = `<div style="font-size:12px;color:var(--sn-green-800);font-weight:700;margin-bottom:6px;">${esc(p.cliente)} (${esc(p.plan)})</div>${waFormat(p.mensaje_renderizado)}`;
            } catch { /* silencioso */ }
        }, 400);
    }

    // ---------- Adjuntos ----------
    async function subirAdjuntos() {
        const inp = document.getElementById('c-files'); if (!inp || !inp.files.length) return;
        const fd = new FormData(); for (const f of inp.files) fd.append('files', f);
        try {
            const d = await API.post('/api/campanas/adjuntos/upload', fd);
            if (d.ok) { _adjuntos.push(...(d.adjuntos || [])); pintarAdjuntos(); inp.value = ''; }
            else toast('Error: ' + (d.error || 'subida fallida'), 'error');
        } catch (e) { toast('Error: ' + e.message, 'error'); }
    }
    function pintarAdjuntos() {
        const el = document.getElementById('adj-list'); if (!el) return;
        el.innerHTML = _adjuntos.map((a, i) => `<div class="sn-badge sn-badge--info" style="margin:0 6px 6px 0;">${esc(a.nombre)} <span data-rm="${i}" style="cursor:pointer;margin-left:4px;">✕</span></div>`).join('');
        el.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { _adjuntos.splice(parseInt(x.dataset.rm), 1); pintarAdjuntos(); });
    }

    // ---------- Guardar (texto) ----------
    async function guardar(iniciar) {
        const body = {
            nombre: document.getElementById('c-nombre')?.value.trim(),
            mensaje: document.getElementById('c-mensaje')?.value,
            filtros: _filtros,
            instruccion_ia: document.getElementById('c-instr')?.value || '',
            adjuntos: _adjuntos,
            vigencia_horas: parseInt(document.getElementById('c-vigencia')?.value) || 24
        };
        if (!body.nombre || !body.mensaje) return toast('Falta nombre o mensaje', 'error');
        if (iniciar && !confirm('¿Confirmás iniciar el envío AHORA? No se puede revertir lo ya enviado.')) return;
        try {
            const d = await API.post('/api/campanas', body);
            if (d && d.error) throw new Error(d.error);
            if (iniciar) {
                await API.post('/api/campanas/' + d.campana_id + '/iniciar', {});
                toast(`Campaña creada (${d.total_destinatarios} destinos) — envío iniciado`, 'success');
            } else toast(`Borrador guardado (${d.total_destinatarios} destinos)`, 'success');
            cerrarCrear(); cargarCampanas();
        } catch (e) { toast('Error: ' + e.message, 'error'); }
    }
    function guardarYEnviar() {
        if (_tipoEnvio === 'plantilla') return guardarYEnviarPlantilla();
        guardar(true);
    }

    // ---------- Plantilla aprobada en campaña ----------
    async function cargarPlantillasParaSelect() {
        const sel = document.getElementById('c-plantilla-select'); if (!sel) return;
        sel.innerHTML = '<option value="">Cargando…</option>';
        try {
            const d = await API.get('/api/cloud-templates');
            if (!d.ok) { sel.innerHTML = '<option value="">Error cargando</option>'; return; }
            _plantillasMeta = d.templates || [];
            const ap = _plantillasMeta.filter(t => (t.status || '').toUpperCase() === 'APPROVED');
            sel.innerHTML = '<option value="">Elegí una plantilla…</option>' + ap.map(t => `<option value="${esc(t.name)}">${esc(t.name)} (${esc(t.language)})</option>`).join('');
        } catch { sel.innerHTML = '<option value="">Error cargando</option>'; }
    }
    function textoPlantilla(t) {
        const c = t.components || [];
        const h = c.find(x => x.type === 'HEADER'), b = c.find(x => x.type === 'BODY'), f = c.find(x => x.type === 'FOOTER'), btn = c.find(x => x.type === 'BUTTONS');
        let out = '';
        if (h) out += h.format === 'TEXT' ? `*${h.text}*\n\n` : `[Encabezado: imagen]\n\n`;
        out += (b?.text || '') + '\n';
        if (f) out += `\n_${f.text}_`;
        if (btn?.buttons?.length) out += `\n\n[Botón: ${btn.buttons[0].text} → ${btn.buttons[0].url || ''}]`;
        return out;
    }
    function numerosVars(t) { const n = new Set(); (t || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_, x) => { n.add(parseInt(x)); return ''; }); return [...n].sort((a, b) => a - b); }
    function seleccionarPlantilla() {
        const nombre = document.getElementById('c-plantilla-select')?.value;
        const t = _plantillasMeta.find(x => x.name === nombre);
        const pv = document.getElementById('c-plantilla-preview'), vr = document.getElementById('c-plantilla-vars');
        if (!t) { if (pv) pv.textContent = ''; if (vr) vr.innerHTML = ''; return; }
        if (pv) pv.textContent = textoPlantilla(t);
        const nums = numerosVars((t.components || []).find(c => c.type === 'BODY')?.text || '');
        const CAMPOS = [['nombre', 'Nombre del cliente'], ['nombre_completo', 'Nombre completo'], ['plan_nombre', 'Plan contratado'], ['zona', 'Zona'], ['costo', 'Costo del plan']];
        if (vr) vr.innerHTML = nums.map(n => `
            <div class="cmp-varrow">
              <span class="cmp-tag">{{${n}}}</span>
              <select class="cmp-sel c-var-tipo" data-n="${n}" style="flex:1;width:auto;">
                ${CAMPOS.map(([v, l]) => `<option value="campo:${v}">${l}</option>`).join('')}
                <option value="fijo">Valor fijo (todos igual)</option>
              </select>
              <input class="cmp-input c-var-fijo hidden" data-n="${n}" placeholder="Valor fijo" style="flex:1;width:auto;">
            </div>`).join('') || '<span class="cmp-hint">Esta plantilla no tiene variables.</span>';
        if (vr) vr.querySelectorAll('.c-var-tipo').forEach(s => s.onchange = () => {
            const fijo = vr.querySelector(`.c-var-fijo[data-n="${s.dataset.n}"]`);
            if (fijo) fijo.classList.toggle('hidden', s.value !== 'fijo');
        });
    }
    function mapeoVariables() {
        return [...document.querySelectorAll('.c-var-tipo')].map(sel => {
            const n = sel.dataset.n;
            if (sel.value === 'fijo') return { tipo: 'fijo', valor: document.querySelector(`.c-var-fijo[data-n="${n}"]`)?.value || '' };
            return { tipo: 'campo', campo: sel.value.split(':')[1] };
        });
    }
    function parseNumeros() {
        const raw = document.getElementById('c-numeros')?.value || '';
        return raw.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
            const p = l.split(','); return p.length > 1 ? { nombre: p[0].trim(), numero: p.slice(1).join(',').trim() } : { nombre: '', numero: p[0].trim() };
        });
    }
    async function guardarYEnviarPlantilla() {
        const nombre = document.getElementById('c-nombre')?.value.trim();
        const plantilla_nombre = document.getElementById('c-plantilla-select')?.value;
        if (!nombre) return toast('Falta el nombre interno', 'error');
        if (!plantilla_nombre) return toast('Elegí una plantilla', 'error');
        const t = _plantillasMeta.find(x => x.name === plantilla_nombre);
        const numeros_manuales = parseNumeros();
        const hayFiltro = _filtros.bds?.length || _filtros.estados?.length || _filtros.zonas?.length || _filtros.planes?.length;
        if (!numeros_manuales.length && !hayFiltro) return toast('Elegí al menos un filtro o agregá números manuales', 'error');
        if (!confirm('¿Confirmás iniciar el envío AHORA? No se puede revertir lo ya enviado.')) return;
        try {
            const d = await API.post('/api/campanas/plantilla', {
                nombre, plantilla_nombre, plantilla_lang: t?.language || 'es',
                mapeo_variables: mapeoVariables(), filtros: _filtros, numeros_manuales
            });
            if (d && d.error) throw new Error(d.error);
            toast(`Campaña creada (${d.total_destinatarios} destinos) — envío iniciado`, 'success');
            cerrarCrear(); cargarCampanas();
        } catch (e) { toast('Error: ' + e.message, 'error'); }
    }

    // ============================================================
    // TAB PLANTILLAS META (crear + estado)
    // ============================================================
    function renderTabPlantillas() {
        const b = document.getElementById('cmpBody');
        b.innerHTML = `
            <div class="cmp-subtabs">
              <button class="cmp-subtab ${_subtab === 'crear' ? 'active' : ''}" data-sub="crear">Crear plantilla</button>
              <button class="cmp-subtab ${_subtab === 'estado' ? 'active' : ''}" data-sub="estado">Estado</button>
            </div>
            <div id="cmpSub"></div>`;
        b.querySelectorAll('.cmp-subtab').forEach(x => x.onclick = () => { _subtab = x.dataset.sub; renderTabPlantillas(); });
        if (_subtab === 'crear') renderCrearPlantilla(); else renderEstadoPlantillas();
        Perms.apply(b);
    }

    function renderCrearPlantilla() {
        _headerHandle = null;
        const s = document.getElementById('cmpSub');
        s.innerHTML = `
            <div class="sn-card">
              <label class="cmp-label">Nombre (solo minúsculas, números y _)</label>
              <input class="cmp-input" id="tpl-nombre" placeholder="promo_octubre">
              <div class="sn-grid-2" style="margin-top:8px;">
                <div><label class="cmp-label">Categoría</label>
                  <select class="cmp-sel" id="tpl-categoria"><option value="UTILITY">UTILITY</option><option value="MARKETING">MARKETING</option></select></div>
                <div><label class="cmp-label">Idioma</label><input class="cmp-input" id="tpl-idioma" value="es"></div>
              </div>

              <label class="cmp-label">Encabezado</label>
              <select class="cmp-sel" id="tpl-header-tipo"><option value="">Ninguno</option><option value="texto">Texto</option><option value="imagen">Imagen</option></select>
              <input class="cmp-input hidden" id="tpl-header-texto" placeholder="Texto del encabezado" style="margin-top:6px;">
              <div class="hidden" id="tpl-header-imagen" style="margin-top:6px;">
                <input type="file" id="tpl-header-file" accept="image/*" style="font-size:var(--sn-text-sm);">
                <button class="sn-btn sn-btn--ghost sn-btn--sm" id="tpl-header-subir" style="margin-top:6px;"><i class="fas fa-upload"></i> Subir a Meta</button>
                <div class="cmp-hint" id="tpl-header-estado"></div>
              </div>

              <label class="cmp-label">Cuerpo del mensaje</label>
              <button class="cmp-var" id="tpl-add-var"><i class="fas fa-plus"></i> Variable {{n}}</button>
              <textarea class="cmp-ta" id="tpl-body" placeholder="Hola {{1}}, ..."></textarea>
              <div id="tpl-ejemplos-wrap" class="hidden" style="margin-top:8px;">
                <label class="cmp-label">Ejemplos de variables</label>
                <div id="tpl-ejemplos"></div>
              </div>

              <label class="cmp-label">Pie (opcional)</label>
              <input class="cmp-input" id="tpl-footer" placeholder="SolucNet">
              <label class="cmp-label">Botón de enlace (opcional)</label>
              <div class="sn-grid-2">
                <input class="cmp-input" id="tpl-btn-texto" placeholder="Texto del botón">
                <input class="cmp-input" id="tpl-btn-url" placeholder="https://...">
              </div>

              <button class="sn-btn sn-btn--primary sn-btn--block" id="tpl-crear" data-perm="gestionar_campanas" style="margin-top:14px;"><i class="fas fa-paper-plane"></i> Enviar a Meta</button>
              <div class="cmp-hint" id="tpl-resultado" style="margin-top:8px;"></div>
            </div>`;
        s.querySelector('#tpl-header-tipo').onchange = (e) => {
            s.querySelector('#tpl-header-texto').classList.toggle('hidden', e.target.value !== 'texto');
            s.querySelector('#tpl-header-imagen').classList.toggle('hidden', e.target.value !== 'imagen');
            _headerHandle = null;
        };
        s.querySelector('#tpl-header-subir').onclick = subirHeaderImagen;
        s.querySelector('#tpl-add-var').onclick = () => {
            const ta = s.querySelector('#tpl-body'); const usados = numerosVars(ta.value); const next = usados.length ? Math.max(...usados) + 1 : 1;
            insertar('tpl-body', `{{${next}}}`, false); pintarEjemplos();
        };
        s.querySelector('#tpl-body').oninput = pintarEjemplos;
        s.querySelector('#tpl-crear').onclick = crearPlantilla;
        Perms.apply(s);
    }
    function pintarEjemplos() {
        const nums = numerosVars(document.getElementById('tpl-body')?.value || '');
        document.getElementById('tpl-ejemplos-wrap')?.classList.toggle('hidden', !nums.length);
        const w = document.getElementById('tpl-ejemplos'); if (!w) return;
        w.innerHTML = nums.map(n => `<div class="cmp-varrow"><span class="cmp-tag">{{${n}}}</span><input class="cmp-input tpl-ej" data-n="${n}" placeholder="Ejemplo para {{${n}}}" style="flex:1;"></div>`).join('');
    }
    async function subirHeaderImagen() {
        const inp = document.getElementById('tpl-header-file'); const est = document.getElementById('tpl-header-estado');
        if (!inp || !inp.files.length) return;
        if (est) est.textContent = 'Subiendo a Meta…';
        const fd = new FormData(); fd.append('imagen', inp.files[0]);
        try {
            const d = await API.post('/api/cloud-templates/header-upload', fd);
            if (d.ok) { _headerHandle = d.header_handle; if (est) est.innerHTML = '<span style="color:var(--sn-success)"><i class="fas fa-check"></i> Imagen lista</span>'; }
            else if (est) est.innerHTML = `<span style="color:var(--sn-danger)">${esc(d.error || 'error')}</span>`;
        } catch (e) { if (est) est.innerHTML = `<span style="color:var(--sn-danger)">${esc(e.message)}</span>`; }
    }
    async function crearPlantilla() {
        const nombre = document.getElementById('tpl-nombre')?.value.trim() || '';
        if (!/^[a-z0-9_]+$/.test(nombre)) return toast('Nombre: solo minúsculas, números y guión bajo', 'error');
        const body = document.getElementById('tpl-body')?.value.trim() || '';
        if (!body) return toast('Falta el cuerpo del mensaje', 'error');
        const nums = numerosVars(body);
        const bodyExample = nums.map(n => (document.querySelector(`.tpl-ej[data-n="${n}"]`)?.value || '').trim());
        if (nums.length && bodyExample.some(v => !v)) return toast('Faltan ejemplos para alguna variable', 'error');
        const headerTipo = document.getElementById('tpl-header-tipo')?.value;
        let header = null;
        if (headerTipo === 'texto') {
            const t = document.getElementById('tpl-header-texto')?.value.trim();
            if (!t) return toast('Falta el texto del encabezado', 'error');
            header = { tipo: 'texto', texto: t };
        } else if (headerTipo === 'imagen') {
            if (!_headerHandle) return toast('Subí la imagen del encabezado primero', 'error');
            header = { tipo: 'imagen', header_handle: _headerHandle };
        }
        const footer = document.getElementById('tpl-footer')?.value.trim() || '';
        const btnTexto = document.getElementById('tpl-btn-texto')?.value.trim() || '';
        const btnUrl = document.getElementById('tpl-btn-url')?.value.trim() || '';
        const button = (btnTexto && btnUrl) ? { texto: btnTexto, url: btnUrl } : null;
        const payload = { name: nombre, category: document.getElementById('tpl-categoria')?.value, language: document.getElementById('tpl-idioma')?.value.trim() || 'es', header, body, bodyExample, footer, button };
        const res = document.getElementById('tpl-resultado'); if (res) res.textContent = 'Enviando a Meta…';
        try {
            const d = await API.post('/api/cloud-templates', payload);
            if (d.ok) {
                if (res) res.innerHTML = `<span style="color:var(--sn-success)"><i class="fas fa-check-circle"></i> Enviada — estado <b>${esc(d.status)}</b>, categoría <b>${esc(d.category)}</b>. Meta puede tardar en aprobarla. Revisá en "Estado".</span>`;
                toast('Plantilla enviada a Meta', 'success');
            } else if (res) res.innerHTML = `<span style="color:var(--sn-danger)"><i class="fas fa-times-circle"></i> ${esc(d.error || 'Meta rechazó la plantilla')}</span>`;
        } catch (e) { if (res) res.innerHTML = `<span style="color:var(--sn-danger)">${esc(e.message)}</span>`; }
    }

    function renderEstadoPlantillas() {
        const s = document.getElementById('cmpSub');
        s.innerHTML = `
            <input class="cmp-input" id="tpl-buscar" placeholder="Buscar plantilla…" style="margin-bottom:10px;">
            <div id="tpl-estado-lista"><div class="sn-empty"><i class="fas fa-spinner fa-spin"></i> Cargando…</div></div>`;
        s.querySelector('#tpl-buscar').oninput = pintarEstadoPlantillas;
        cargarEstadoPlantillas();
    }
    async function cargarEstadoPlantillas() {
        const cont = document.getElementById('tpl-estado-lista'); if (!cont) return;
        try {
            const d = await API.get('/api/cloud-templates');
            if (!d.ok) { cont.innerHTML = `<div class="sn-empty" style="color:var(--sn-danger);">${esc(d.error || 'error')}</div>`; return; }
            _plantillasMeta = d.templates || [];
            pintarEstadoPlantillas();
        } catch (e) { cont.innerHTML = `<div class="sn-empty" style="color:var(--sn-danger);">${esc(e.message)}</div>`; }
    }
    function pintarEstadoPlantillas() {
        const cont = document.getElementById('tpl-estado-lista'); if (!cont) return;
        const buscar = (document.getElementById('tpl-buscar')?.value || '').toLowerCase().trim();
        let lista = _plantillasMeta;
        if (buscar) lista = lista.filter(t => (t.name || '').toLowerCase().includes(buscar));
        if (!lista.length) { cont.innerHTML = `<div class="sn-empty">Sin plantillas para mostrar</div>`; return; }
        cont.innerHTML = lista.map((t, i) => {
            const est = (t.status || '').toLowerCase();
            const cls = est === 'approved' ? 'sn-badge--ok' : (est === 'rejected' ? 'sn-badge--danger' : 'sn-badge--warn');
            return `<div class="sn-card">
                <div style="display:flex;justify-content:space-between;gap:6px;align-items:center;flex-wrap:wrap;">
                  <b>${esc(t.name)} <span class="sn-row__sub" style="font-weight:400;">(${esc(t.language)})</span></b>
                  <div style="display:flex;gap:6px;align-items:center;">
                    <span class="sn-badge ${cls}">${esc(t.status)}</span>
                    <span class="sn-badge sn-badge--info">${esc(t.category)}</span>
                    <button class="sn-btn sn-btn--ghost sn-btn--sm" data-tpl="${i}"><i class="fas fa-eye"></i></button>
                  </div>
                </div>
                <div class="cmp-preview hidden" id="tpl-txt-${i}" style="margin-top:8px;">${esc(textoPlantilla(t))}</div>
              </div>`;
        }).join('');
        cont.querySelectorAll('[data-tpl]').forEach(x => x.onclick = () => document.getElementById('tpl-txt-' + x.dataset.tpl)?.classList.toggle('hidden'));
    }

    return { show };
})();

if (typeof Router !== 'undefined') Router.register('campanas', () => CampanasPage.show());
