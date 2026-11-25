// Página: Salud del bot / Configuración (app admin) — módulo sensible (solo admin).
// Réplica MÓVIL del panel web public/salud.html, PERO complementaria a estado.js:
//   · estado.js (drawer "Estado del bot") ya cubre: banner WhatsApp, stats, cola API,
//     logs, mensajes recientes y DISPLAY de límites desde /api/bot-health. NO se repite acá.
//   · salud.js (drawer "Salud / Configuración") cubre lo que falta y es editable:
//       - Interventoría del canal Cloud API (Meta) + almacenamiento (solo lectura)
//       - IA / Sol: motor (proveedor/modelo/fallback/temp/tokens), keys y system prompt (edición)
//       - Límites anti-baneo (edición real de topes)
//       - API Oficial: config Cloud (token/phone/waba/verify) + prueba + SEGURIDAD del webhook
//         (App Secret + toggle enforce de firma) + estado de plantillas en Meta
//
// Registro/navegación: self-register a la ruta 'salud' (mismo patrón que estado.js /
// verificacion-pagos.js). El contenedor .page se crea dinámicamente (ensurePage), así
// que NO requiere un <div id="page-salud"> en app.html.
//
// Drawer (app.html): <div class="drawer-item" data-route="salud" data-grupo="admin" data-solo-admin>
//                      <i class="fas fa-stethoscope"></i> Salud / Config</div>
// Script (app.html):  <script src="js/pages/salud.js"></script>
//
// Endpoints backend (ya existentes, requireAuth; escrituras admin):
//   GET  /api/cloud-health                       → interventoría canal Cloud (entregas, fallos, cola)
//   GET  /api/storage-status                     → disco / BD / limpieza / tablas pesadas
//   GET  /api/ia-status                          → { config, proveedor }
//   POST /api/ia-config                          → guardar motor (admin)
//   GET  /api/ia-keys  · POST /api/ia-keys        → keys por proveedor (admin)
//   GET  /api/ia-prompt · POST /api/ia-prompt      → system prompt (admin)
//   GET  /api/limites-envio · POST /api/limites-envio → topes anti-baneo (admin)
//   GET  /api/cloud-config · POST /api/cloud-config   → token/phone/waba/verify (admin)
//   GET  /api/cloud-config/test                  → probar token
//   GET  /api/cloud-health/webhook-seguridad     → App Secret puesto + enforce + última firma
//   PUT  /api/cloud-health/webhook-seguridad     → { enforce, app_secret? } (admin)
//   GET  /api/cloud-templates                    → plantillas en la WABA (estado Meta)
const SaludPage = (function () {
    let _tab = 'interventoria';     // 'interventoria' | 'ia' | 'limites' | 'api'
    let _refresh = null;            // auto-refresh SOLO de interventoría (lectura)
    let _iaConfig = null;

    // Estilos inline SOLO con tokens (cero hex crudos)
    const INP = 'width:100%;padding:var(--sn-space-3);border:1px solid var(--sn-border);border-radius:var(--sn-radius-md);background:var(--sn-surface);color:var(--sn-text-primary);font-size:var(--sn-text-sm);box-sizing:border-box;';
    const LBL = 'display:block;font-size:var(--sn-text-xs);font-weight:var(--sn-weight-semibold);color:var(--sn-text-secondary);margin:var(--sn-space-3) 0 var(--sn-space-1);';
    const MUTED = 'color:var(--sn-text-tertiary);font-size:var(--sn-text-xs);';

    function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    function toast(msg, tipo) {
        const t = document.getElementById('toast'); if (!t) { alert(msg); return; }
        t.textContent = msg; t.className = 'toast show' + (tipo === 'error' ? ' error' : tipo === 'success' ? ' success' : '');
        clearTimeout(t._to); t._to = setTimeout(() => { t.className = 'toast'; }, 3000);
    }
    function fmtMB(mb) { const n = Number(mb) || 0; return n >= 1024 ? (n / 1024).toFixed(1) + ' GB' : n + ' MB'; }
    function fmtDate(v) { if (!v) return '-'; try { return new Date(v).toLocaleString('es-CO'); } catch { return '-'; } }
    // Badge semántico con clases sn-* (sin hex inline)
    function badge(texto, variante) { return `<span class="sn-badge sn-badge--${variante || 'off'}">${escapeHtml(texto)}</span>`; }

    function ensurePage() {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const main = document.querySelector('.app-main');
        let page = document.getElementById('page-salud');
        if (!page) { page = document.createElement('div'); page.id = 'page-salud'; page.className = 'page'; main.appendChild(page); }
        page.classList.add('active');
        return page;
    }
    function activa() { const p = document.getElementById('page-salud'); return p && p.classList.contains('active'); }

    function show() {
        // Guardia defensiva: es un módulo sensible (el drawer ya lo oculta con data-solo-admin).
        if (window.Perms && !Perms.esAdmin()) {
            const page = ensurePage();
            page.innerHTML = `<div class="sn-empty"><i class="fas fa-lock"></i><p>Módulo solo para administradores.</p></div>`;
            return;
        }
        const page = ensurePage();
        page.innerHTML = `
          <div style="padding:var(--sn-space-3);max-width:900px;margin:0 auto;">
            <h2 style="margin:var(--sn-space-1) 0 var(--sn-space-3);font-size:var(--sn-text-xl);color:var(--sn-text-primary);">
              <i class="fas fa-stethoscope" style="color:var(--brand);"></i> Salud del bot / Configuración
            </h2>
            <div class="tabs-bar" id="saludTabs">
              <button class="tab-btn" data-t="interventoria"><i class="fas fa-satellite-dish"></i> Interventoría</button>
              <button class="tab-btn" data-t="ia"><i class="fas fa-robot"></i> IA / Sol</button>
              <button class="tab-btn" data-t="limites"><i class="fas fa-shield-halved"></i> Límites</button>
              <button class="tab-btn" data-t="api"><i class="fas fa-plug"></i> API Oficial</button>
            </div>
            <div id="saludBody" style="margin-top:var(--sn-space-3);">
              <div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>
            </div>
          </div>`;
        page.querySelector('#saludTabs').addEventListener('click', (e) => {
            const b = e.target.closest('.tab-btn'); if (!b) return;
            _tab = b.dataset.t; pintarTabs(); cargarTab();
        });
        pintarTabs(); cargarTab();
        // Auto-refresh SOLO interventoría (lectura). Las pestañas de edición NO se auto-refrescan
        // para no pisar lo que el admin esté escribiendo.
        if (_refresh) clearInterval(_refresh);
        _refresh = setInterval(() => {
            if (activa() && _tab === 'interventoria' && document.visibilityState === 'visible') loadInterventoria();
        }, 15000);
    }

    function pintarTabs() {
        document.querySelectorAll('#saludTabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.t === _tab));
    }
    function cargarTab() {
        if (_tab === 'ia') return loadIA();
        if (_tab === 'limites') return loadLimites();
        if (_tab === 'api') return loadApi();
        return loadInterventoria();
    }
    function body() { return document.getElementById('saludBody'); }

    // ========================= INTERVENTORÍA (Cloud API + almacenamiento) =========================
    async function loadInterventoria() {
        const el = body(); if (!el) return;
        const [ch, st] = await Promise.all([
            API.get('/api/cloud-health').catch(e => ({ error: e.message })),
            API.get('/api/storage-status').catch(e => ({ error: e.message })),
        ]);
        let html = `<div class="sn-section-title">Canal Cloud API (Meta)</div>`;
        html += renderCloudHealth(ch);
        html += `<div class="sn-section-title">Almacenamiento</div>`;
        html += renderStorage(st);
        el.innerHTML = html;
    }

    function stat(label, val, color) {
        const c = color ? `style="color:${color};"` : '';
        return `<div class="sn-stat"><div class="sn-stat__num" ${c}>${val == null ? '—' : val}</div><div class="sn-stat__label">${escapeHtml(label)}</div></div>`;
    }

    function renderCloudHealth(ch) {
        if (!ch || ch.error || ch.ok === false) return `<div class="sn-card" style="${MUTED}">Interventoría no disponible: ${escapeHtml((ch && ch.error) || 'sin datos')}</div>`;
        const s = ch.salidas || {};
        const alc = ch.alertas || [];
        const crit = alc.some(a => a.nivel === 'critico');
        const fr = ch.fallosPorRazon || {}, codes = Object.keys(fr);
        const ff = ch.fallosPorFuente || {}, fu = Object.keys(ff);
        const cola = ch.cola || {};
        const fuenteLbl = (f) => ({ api: 'cobranza/cola', sistema: 'técnicos/visitas', asesor: 'asesor', ia: 'Sol' }[f] || f);

        let html = '';
        if (alc.length) {
            html += `<div class="sn-card" style="border-left:4px solid ${crit ? 'var(--sn-danger)' : 'var(--sn-warning)'};">
                <div style="font-weight:var(--sn-weight-bold);color:var(--sn-text-primary);margin-bottom:var(--sn-space-1);">
                  <i class="fas fa-triangle-exclamation" style="color:${crit ? 'var(--sn-danger)' : 'var(--sn-warning)'};"></i>
                  Alertas del canal Cloud
                </div>
                <div style="${MUTED}">${alc.map(a => (a.nivel === 'critico' ? '🔴 ' : '🟡 ') + escapeHtml(a.msg || '')).join('<br>')}</div>
              </div>`;
        }
        html += `<div class="sn-grid-2">
            <div class="sn-card" style="text-align:center;">
              <div style="margin-bottom:var(--sn-space-1);">${ch.plataforma === 'cloud' ? badge('☁️ Cloud API', 'ok') : badge('Baileys', 'off')}</div>
              <div style="${MUTED}">Proactivos (cobranza): <b>${ch.proactivoPlantillas ?? 0}</b></div>
            </div>
            ${stat('Entrantes', ch.entrantes ?? 0)}
            ${stat('Sol respondió', (ch.sol && ch.sol.respondio) ?? 0)}
            <div class="sn-card" style="text-align:center;">
              <div class="sn-stat__label" style="margin-bottom:var(--sn-space-1);">Entregas</div>
              <div style="${MUTED};line-height:1.6;">
                ✅ entregados: <b>${s.entregados || 0}</b><br>
                👁️ leídos: ${s.leidos || 0}<br>
                ❌ fallidos: <b style="color:var(--sn-danger);">${s.fallidos || 0}</b> (${s.tasaFallo || '0%'})
              </div>
            </div>
          </div>`;
        html += `<div class="sn-card">
            <div class="sn-row__title" style="margin-bottom:var(--sn-space-1);"><i class="fas fa-list-ul" style="color:var(--brand);"></i> Cola cobranza</div>
            <div style="${MUTED}">pendientes: <b>${cola.pendiente || 0}</b> · enviados: ${cola.enviado || 0} · error: ${cola.error || 0}</div>
          </div>`;
        if (codes.length) {
            html += `<div class="sn-card"><div class="sn-row__title" style="margin-bottom:var(--sn-space-2);">❌ Fallos por razón (código Meta)</div>`
                + codes.map(c => `<div style="${MUTED};padding:var(--sn-space-1) 0;">• <b>${escapeHtml(c)}</b> ${escapeHtml(fr[c].titulo || '')} — <b>${fr[c].n}</b> veces · último ${fmtDate(fr[c].ultimo)}</div>`).join('')
                + `</div>`;
        }
        if (fu.length) {
            html += `<div class="sn-card"><div class="sn-row__title" style="margin-bottom:var(--sn-space-2);">❌ Fallos por fuente (qué app)</div>`
                + fu.map(f => `<div style="${MUTED};padding:var(--sn-space-1) 0;">• ${escapeHtml(f)} <span style="${MUTED}">(${escapeHtml(fuenteLbl(f))})</span>: <b>${ff[f]}</b></div>`).join('')
                + `</div>`;
        }
        return html;
    }

    function renderStorage(st) {
        if (!st || st.error || st.ok === false) return `<div class="sn-card" style="${MUTED}">Almacenamiento no disponible${st && st.error ? ': ' + escapeHtml(st.error) : ''}.</div>`;
        let html = '<div class="sn-grid-2">';
        if (st.disco) {
            const p = Number(st.disco.porcentaje) || 0;
            const col = p >= 88 ? 'var(--sn-danger)' : (p >= 75 ? 'var(--sn-warning)' : 'var(--sn-success)');
            html += `<div class="sn-card" style="grid-column:1/-1;">
                <div class="sn-row" style="padding:0;border:none;"><span class="sn-row__title">Disco</span><span style="${MUTED}">${st.disco.usadoGB} / ${st.disco.totalGB} GB · libre ${st.disco.libreGB} GB</span></div>
                <div style="height:9px;background:var(--sn-surface-3);border-radius:var(--sn-radius-full);overflow:hidden;margin-top:var(--sn-space-2);">
                  <div style="height:100%;width:${Math.min(p, 100)}%;background:${col};border-radius:var(--sn-radius-full);transition:width var(--sn-duration-slow);"></div>
                </div>
              </div>`;
        }
        if (st.db) html += stat('Base de datos', fmtMB(st.db.totalMB)) + stat('Filas (aprox)', Number(st.db.filas || 0).toLocaleString('es-CO'));
        if (st.limpieza) {
            const rest = Number(st.limpieza.statusBasuraRestantes) || 0;
            html += stat('Basura por borrar', rest.toLocaleString('es-CO'), rest > 0 ? 'var(--sn-warning)' : 'var(--sn-success)');
        }
        html += '</div>';
        if ((st.topTablas || []).length) {
            html += `<div class="sn-card"><div class="sn-row__title" style="margin-bottom:var(--sn-space-2);">Tablas más pesadas</div>`
                + st.topTablas.map(t => `<div class="sn-row" style="padding:var(--sn-space-2) 0;"><span class="sn-row__main">${escapeHtml(t.tabla)}</span><span style="${MUTED}">${fmtMB(t.mb)} · ${Number(t.filas || 0).toLocaleString('es-CO')} filas</span></div>`).join('')
                + `</div>`;
        }
        return html;
    }

    // ========================= IA / SOL =========================
    async function loadIA() {
        const el = body(); if (!el) return;
        el.innerHTML = `<div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando IA…</div>`;
        let d;
        try { d = await API.get('/api/ia-status'); } catch (e) { el.innerHTML = `<div class="sn-card" style="${MUTED}">No se pudo cargar: ${escapeHtml(e.message)}</div>`; return; }
        _iaConfig = d.config || {};
        const c = _iaConfig;
        const provOpts = (c.proveedores_disponibles || []).map(p => `<option ${p === c.proveedor ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('');
        el.innerHTML = `
          <div class="sn-card">
            <div class="sn-row__title" style="margin-bottom:var(--sn-space-2);">Motor de IA (Sol)</div>
            <div style="${MUTED};margin-bottom:var(--sn-space-2);">Proveedor activo: <b>${escapeHtml(d.proveedor || c.proveedor || '-')}</b></div>
            <label style="${LBL}">Proveedor</label>
            <select id="iaProv" style="${INP}">${provOpts}</select>
            <label style="${LBL}">Modelo</label>
            <select id="iaModelo" style="${INP}"></select>
            <label style="${LBL}">Modelo de respaldo (fallback)</label>
            <select id="iaFallback" style="${INP}"></select>
            <div style="display:flex;gap:var(--sn-space-3);flex-wrap:wrap;">
              <div style="flex:1;min-width:130px;"><label style="${LBL}">Temperatura</label><input id="iaTemp" type="number" step="0.1" min="0" max="2" style="${INP}" value="${c.temperatura ?? 1}"></div>
              <div style="flex:1;min-width:130px;"><label style="${LBL}">Máx tokens respuesta</label><input id="iaTokens" type="number" min="100" step="50" style="${INP}" value="${c.max_tokens ?? 4000}"></div>
            </div>
            <button class="sn-btn sn-btn--primary sn-btn--block" id="iaGuardarMotor" data-perm="configurar_bot" style="margin-top:var(--sn-space-3);"><i class="fas fa-floppy-disk"></i> Guardar motor</button>
          </div>

          <div class="sn-card">
            <div class="sn-row__title" style="margin-bottom:var(--sn-space-2);">API Keys de los proveedores</div>
            <div id="iaKeys" style="${MUTED}">Cargando…</div>
            <button class="sn-btn sn-btn--primary sn-btn--block" id="iaGuardarKeys" data-perm="configurar_bot" style="margin-top:var(--sn-space-3);"><i class="fas fa-key"></i> Guardar keys</button>
            <div style="${MUTED};margin-top:var(--sn-space-2);">Solo pegá una key nueva para reemplazar; las configuradas se muestran como ●●●.</div>
          </div>

          <div class="sn-card">
            <div class="sn-row__title" style="margin-bottom:var(--sn-space-2);">System Prompt (instrucciones a Sol)</div>
            <textarea id="iaPrompt" style="${INP};min-height:240px;white-space:pre-wrap;font-family:var(--sn-font-mono);" placeholder="Cargando…"></textarea>
            <button class="sn-btn sn-btn--primary sn-btn--block" id="iaGuardarPrompt" data-perm="configurar_bot" style="margin-top:var(--sn-space-3);"><i class="fas fa-floppy-disk"></i> Guardar prompt</button>
          </div>`;

        const selP = el.querySelector('#iaProv');
        selP.onchange = () => llenarModelos(selP.value);
        llenarModelos(c.proveedor, c.modelo, c.modelo_fallback);
        el.querySelector('#iaGuardarMotor').onclick = guardarMotorIA;
        el.querySelector('#iaGuardarKeys').onclick = guardarKeysIA;
        el.querySelector('#iaGuardarPrompt').onclick = guardarPromptIA;
        cargarKeysIA(); cargarPromptIA();
        if (window.Perms) Perms.apply(el);
    }
    function llenarModelos(prov, sel, selFb) {
        const md = (_iaConfig.modelos_disponibles || {})[prov] || [];
        const opts = md.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.nombre || m.id)}${m.recomendado ? ' ⭐' : ''}</option>`).join('');
        const mSel = document.getElementById('iaModelo'), mFb = document.getElementById('iaFallback');
        if (mSel) { mSel.innerHTML = opts || '<option value="">(sin modelos)</option>'; if (sel) mSel.value = sel; }
        if (mFb) { mFb.innerHTML = '<option value="">(ninguno)</option>' + opts; if (selFb !== undefined) mFb.value = selFb || ''; }
    }
    async function guardarMotorIA() {
        if (!_iaConfig) return;
        _iaConfig.proveedor = document.getElementById('iaProv').value;
        _iaConfig.modelo = document.getElementById('iaModelo').value;
        _iaConfig.modelo_fallback = document.getElementById('iaFallback').value;
        _iaConfig.temperatura = parseFloat(document.getElementById('iaTemp').value);
        _iaConfig.max_tokens = parseInt(document.getElementById('iaTokens').value, 10);
        try { await API.post('/api/ia-config', _iaConfig); toast('Motor guardado ✓', 'success'); }
        catch (e) { toast(errMsg(e), 'error'); }
    }
    async function cargarKeysIA() {
        const box = document.getElementById('iaKeys'); if (!box) return;
        try {
            const d = await API.get('/api/ia-keys'); const keys = d.keys || {};
            box.innerHTML = Object.keys(keys).map(k => {
                const kk = keys[k];
                return `<label style="${LBL}">${escapeHtml(k)} ${kk.configurada ? badge('configurada', 'ok') : badge('falta', 'warn')}</label>
                        <input data-key="${escapeHtml(k)}" style="${INP}" placeholder="${kk.configurada ? escapeHtml(kk.preview || '●●●') : 'pegar key nueva…'}">`;
            }).join('') || `<div style="${MUTED}">Sin proveedores.</div>`;
        } catch (e) { box.innerHTML = `<div style="${MUTED}">No se pudieron cargar: ${escapeHtml(e.message)}</div>`; }
    }
    async function guardarKeysIA() {
        const payload = {};
        document.querySelectorAll('#iaKeys input').forEach(i => { const v = i.value.trim(); if (v) payload[i.dataset.key] = v; });
        if (!Object.keys(payload).length) { toast('No cambiaste ninguna key'); return; }
        try { await API.post('/api/ia-keys', payload); toast('Keys guardadas (IA reiniciada) ✓', 'success'); cargarKeysIA(); }
        catch (e) { toast(errMsg(e), 'error'); }
    }
    async function cargarPromptIA() {
        const ta = document.getElementById('iaPrompt'); if (!ta) return;
        try { const d = await API.get('/api/ia-prompt'); ta.value = d.actual || d.prompt || ''; }
        catch (e) { ta.value = ''; toast('Prompt: ' + e.message, 'error'); }
    }
    async function guardarPromptIA() {
        const prompt = document.getElementById('iaPrompt').value;
        try { await API.post('/api/ia-prompt', { prompt }); toast('Prompt guardado ✓', 'success'); }
        catch (e) { toast(errMsg(e), 'error'); }
    }

    // ========================= LÍMITES anti-baneo =========================
    async function loadLimites() {
        const el = body(); if (!el) return;
        el.innerHTML = `<div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando límites…</div>`;
        let d;
        try { d = await API.get('/api/limites-envio'); } catch (e) { el.innerHTML = `<div class="sn-card" style="${MUTED}">No se pudo cargar: ${escapeHtml(e.message)}</div>`; return; }
        el.innerHTML = `
          <div class="sn-card">
            <div class="sn-row__title" style="margin-bottom:var(--sn-space-1);">Topes de envío (anti-baneo)</div>
            <div style="${MUTED};margin-bottom:var(--sn-space-2);">Uso hoy: ${d.usoHoy || 0}/${d.maxPerDay} · esta hora: ${d.usoHora || 0}/${d.maxPerHour} · contactos: ${d.contactosHoy || 0}/${d.maxContactosUnicos}</div>
            <label style="${LBL}">Máximo por día</label><input id="limDia" type="number" min="1" style="${INP}" value="${d.maxPerDay ?? ''}">
            <label style="${LBL}">Máximo por hora</label><input id="limHora" type="number" min="1" style="${INP}" value="${d.maxPerHour ?? ''}">
            <label style="${LBL}">Máximo de contactos únicos por día</label><input id="limContactos" type="number" min="1" style="${INP}" value="${d.maxContactosUnicos ?? ''}">
            <button class="sn-btn sn-btn--primary sn-btn--block" id="limGuardar" data-perm="configurar_bot" style="margin-top:var(--sn-space-3);"><i class="fas fa-floppy-disk"></i> Guardar límites</button>
          </div>
          <div class="sn-card" style="border-left:4px solid var(--sn-warning);">
            <div style="${MUTED}">Bajar estos topes reduce el riesgo de baneo pero puede frenar mensajes en horas pico. Los cambios se guardan y sobreviven a reinicios.</div>
          </div>`;
        el.querySelector('#limGuardar').onclick = guardarLimites;
        if (window.Perms) Perms.apply(el);
    }
    async function guardarLimites() {
        const body2 = {
            maxPerDay: document.getElementById('limDia').value,
            maxPerHour: document.getElementById('limHora').value,
            maxContactosUnicos: document.getElementById('limContactos').value,
        };
        try { await API.post('/api/limites-envio', body2); toast('Límites guardados ✓', 'success'); loadLimites(); }
        catch (e) { toast(errMsg(e), 'error'); }
    }

    // ========================= API OFICIAL (Cloud config + seguridad webhook + plantillas Meta) =========================
    async function loadApi() {
        const el = body(); if (!el) return;
        el.innerHTML = `<div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando API Oficial…</div>`;
        let c;
        try { c = await API.get('/api/cloud-config'); } catch (e) { el.innerHTML = `<div class="sn-card" style="${MUTED}">No se pudo cargar: ${escapeHtml(e.message)}</div>`; return; }
        el.innerHTML = `
          <div class="sn-card">
            <div class="sn-row__title" style="margin-bottom:var(--sn-space-2);">Conexión WhatsApp Cloud API</div>
            <label style="${LBL}">Token de acceso (permanente)</label>
            <input id="cfgToken" style="${INP}" placeholder="Pegá un token nuevo para reemplazar…" autocomplete="off">
            <div style="${MUTED};margin-top:var(--sn-space-1);">${c.tiene_token ? 'Token actual: ' + escapeHtml(c.token_masked || '●●●') + ' · actualizado ' + fmtDate(c.updated_at) : 'Sin token configurado'}</div>
            <label style="${LBL}">Phone Number ID</label><input id="cfgPhone" style="${INP}" value="${escapeHtml(c.phone_number_id || '')}">
            <label style="${LBL}">WhatsApp Business Account ID (WABA)</label><input id="cfgWaba" style="${INP}" value="${escapeHtml(c.waba_id || '')}">
            <label style="${LBL}">Verify token del webhook</label><input id="cfgVerify" style="${INP}" value="${escapeHtml(c.verify_token || '')}">
            <div style="display:flex;gap:var(--sn-space-2);margin-top:var(--sn-space-3);flex-wrap:wrap;align-items:center;">
              <button class="sn-btn sn-btn--primary" id="cfgGuardar" data-perm="configurar_bot"><i class="fas fa-floppy-disk"></i> Guardar</button>
              <button class="sn-btn sn-btn--ghost" id="cfgProbar"><i class="fas fa-plug"></i> Probar conexión</button>
              <span id="cfgTest" style="${MUTED}"></span>
            </div>
          </div>

          <div class="sn-card sn-card--accent">
            <div class="sn-row__title" style="margin-bottom:var(--sn-space-2);"><i class="fas fa-lock" style="color:var(--brand);"></i> Seguridad del webhook (firma de Meta)</div>
            <div id="segEstado" style="${MUTED};margin-bottom:var(--sn-space-2);">—</div>
            <label style="${LBL}">App Secret de Meta <span style="${MUTED}">(developers.facebook.com → tu app → Configuración → Básica)</span></label>
            <input id="cfgAppSecret" type="password" style="${INP}" placeholder="Pegá el App Secret (≈32 caracteres)…" autocomplete="off">
            <label style="display:flex;align-items:center;gap:var(--sn-space-2);margin-top:var(--sn-space-3);font-size:var(--sn-text-sm);color:var(--sn-text-primary);">
              <input type="checkbox" id="cfgEnforce" style="width:auto;min-height:auto;"> Rechazar mensajes con firma inválida (bloqueo activo)
            </label>
            <div style="${MUTED};margin-top:var(--sn-space-1);">Recomendado: 1) guardá el App Secret con el bloqueo <b>APAGADO</b> (observación); 2) cuando el estado diga <b>“firma válida recibida”</b>, activá el bloqueo.</div>
            <div style="display:flex;gap:var(--sn-space-2);margin-top:var(--sn-space-3);flex-wrap:wrap;align-items:center;">
              <button class="sn-btn sn-btn--primary" id="segGuardar" data-perm="configurar_bot"><i class="fas fa-floppy-disk"></i> Guardar seguridad</button>
              <span id="segTest" style="${MUTED}"></span>
            </div>
          </div>

          <div class="sn-card" style="border-left:4px solid var(--sn-warning);">
            <div style="${MUTED}">⚠️ Los cambios a las plantillas creadas en Facebook deben ser aprobados por Meta. Editalas en Facebook → WhatsApp Manager → Plantillas.</div>
          </div>

          <div class="sn-card">
            <div class="sn-row" style="padding:0;border:none;margin-bottom:var(--sn-space-2);">
              <span class="sn-row__title sn-row__main">Estado de plantillas en Meta</span>
              <button class="sn-btn sn-btn--ghost sn-btn--sm" id="tplRefrescar"><i class="fas fa-rotate"></i></button>
            </div>
            <div id="cloudTpl" style="${MUTED}">Cargando…</div>
          </div>`;
        el.querySelector('#cfgGuardar').onclick = guardarCfg;
        el.querySelector('#cfgProbar').onclick = probarToken;
        el.querySelector('#segGuardar').onclick = guardarSeguridadWebhook;
        el.querySelector('#tplRefrescar').onclick = cargarCloudTemplates;
        cargarSeguridadWebhook();
        cargarCloudTemplates();
        if (window.Perms) Perms.apply(el);
    }
    async function guardarCfg() {
        const b = {
            phone_number_id: document.getElementById('cfgPhone').value.trim(),
            waba_id: document.getElementById('cfgWaba').value.trim(),
            verify_token: document.getElementById('cfgVerify').value.trim(),
        };
        const tok = document.getElementById('cfgToken').value.trim(); if (tok) b.token = tok;
        try { await API.post('/api/cloud-config', b); toast('Configuración guardada ✓', 'success'); loadApi(); }
        catch (e) { toast(errMsg(e), 'error'); }
    }
    async function probarToken() {
        const el = document.getElementById('cfgTest'); if (el) el.textContent = 'Probando…';
        try {
            const d = await API.get('/api/cloud-config/test');
            if (el) el.innerHTML = d.valido ? badge('✅ Válido · ' + escapeHtml(d.tipo || '') + ' · expira ' + escapeHtml(String(d.expira || '')), 'ok') : badge('❌ ' + escapeHtml(d.error || 'inválido'), 'danger');
        } catch (e) { if (el) el.innerHTML = badge('❌ ' + escapeHtml(e.message), 'danger'); }
    }
    async function cargarSeguridadWebhook() {
        const el = document.getElementById('segEstado'); if (!el) return;
        try {
            const d = await API.get('/api/cloud-health/webhook-seguridad');
            if (!d.ok) { el.textContent = 'No disponible'; return; }
            const firma = d.ultima_firma === 'valida' ? badge('✅ firma válida recibida', 'ok')
                : d.ultima_firma === 'invalida' ? badge('❌ última firma INVÁLIDA', 'danger')
                    : badge('sin firmas aún', 'off');
            el.innerHTML = 'App Secret: ' + (d.app_secret_puesto ? badge('puesto ' + (d.pista || ''), 'ok') : badge('sin configurar', 'warn'))
                + ' · Bloqueo: ' + (d.enforce ? badge('ACTIVO', 'ok') : badge('observación (no bloquea)', 'off'))
                + ' · ' + firma;
            const chk = document.getElementById('cfgEnforce'); if (chk) chk.checked = !!d.enforce;
        } catch (e) { el.textContent = 'Error: ' + e.message; }
    }
    async function guardarSeguridadWebhook() {
        const b = { enforce: document.getElementById('cfgEnforce').checked };
        const sec = document.getElementById('cfgAppSecret').value.trim(); if (sec) b.app_secret = sec;
        const el = document.getElementById('segTest'); if (el) el.textContent = 'Guardando…';
        try {
            const d = await API.put('/api/cloud-health/webhook-seguridad', b);
            if (d && d.ok) { if (el) el.innerHTML = badge('✅ guardado', 'ok'); document.getElementById('cfgAppSecret').value = ''; cargarSeguridadWebhook(); }
            else if (el) el.innerHTML = badge('❌ ' + escapeHtml((d && d.error) || 'error'), 'danger');
        } catch (e) { if (el) el.innerHTML = badge('❌ ' + escapeHtml(errMsg(e)), 'danger'); }
    }
    async function cargarCloudTemplates() {
        const box = document.getElementById('cloudTpl'); if (!box) return;
        box.textContent = 'Cargando…';
        try {
            const d = await API.get('/api/cloud-templates');
            if (!d.ok) { box.innerHTML = badge(d.error || 'no disponible', 'warn'); return; }
            if (!(d.templates || []).length) { box.textContent = 'No hay plantillas en la WABA.'; return; }
            const sb = { APPROVED: 'ok', PENDING: 'warn', REJECTED: 'danger' };
            box.innerHTML = d.templates.map(t => `<div class="sn-row" style="padding:var(--sn-space-2) 0;">
                <span class="sn-row__main">${escapeHtml(t.name)} <span style="${MUTED}">[${escapeHtml(t.language || '')}] ${escapeHtml(t.category || '')}</span></span>
                ${badge(t.status, sb[t.status] || 'off')}</div>`).join('');
        } catch (e) { box.innerHTML = badge('Error: ' + escapeHtml(e.message), 'danger'); }
    }

    function errMsg(e) { const m = (e && e.message) || 'error'; return /admin/i.test(m) ? 'Solo un admin puede hacer este cambio' : ('Error: ' + m); }

    return { show };
})();

if (typeof Router !== 'undefined') Router.register('salud', () => SaludPage.show());
