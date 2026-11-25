// 🆕 Página: GestorOLT (OLTs + ONUs pendientes + autorizar + ONUs activas + acciones)
const GestorOLTPage = (function() {
    let olts = [];
    let pending = [];
    let activeTab = 'olts';
    let selectedOlt = null;        // OLT en vista de detalle
    let oltOnus = [];              // ONUs activas del OLT seleccionado
    let onuSearchTerm = '';        // 🆕 búsqueda en la lista de ONUs del OLT
    let profilesCache = new Map(); // oltId → { line: [], srv: [] }

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    function showToast(msg, type='info') {
        let t = document.getElementById('toast');
        if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
        t.className = 'toast show ' + type;
        t.textContent = msg;
        setTimeout(() => t.classList.remove('show'), 2800);
    }

    // ============ Render principales ============
    function renderOLT(o) {
        const online = o.connected === true || o.connection_status === 'connected' || o.status === 'online';
        return `
            <div data-id="${o.id}" class="olt-card" onclick="GestorOLTPage.openOlt(${o.id})" style="background:white; border-radius:12px; padding:14px; margin-bottom:8px; box-shadow:0 1px 2px rgba(0,0,0,0.04); border-left:3px solid ${online ? '#16a34a' : '#dc3545'}; cursor:pointer;">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:1em;">${escapeHtml(o.name || 'OLT')}</div>
                        <div style="font-size:0.8em; color:#666; margin-top:3px;">
                            <i class="fas fa-globe"></i> ${escapeHtml(o.host || o.ip || '?')}
                            ${o.brand ? ` · <span style="text-transform:capitalize;">${escapeHtml(o.brand)}</span>` : ''}
                            ${o.model ? ` · ${escapeHtml(o.model)}` : ''}
                        </div>
                        ${o.location ? `<div style="font-size:0.75em; color:#999; margin-top:2px;"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(o.location)}</div>` : ''}
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px; flex-shrink:0;">
                        <span style="background:${online ? '#dcfce7' : '#fee'}; color:${online ? '#16a34a' : '#dc3545'}; font-size:0.7em; font-weight:600; padding:3px 8px; border-radius:8px;">${online ? 'ONLINE' : 'OFFLINE'}</span>
                        <i class="fas fa-chevron-right" style="color:#ccc; font-size:0.75em;"></i>
                    </div>
                </div>
            </div>
        `;
    }

    function renderPending(p) {
        // 🛡️ v2026-06-01: data-attributes en vez de onclick inline para evitar problemas
        // de escaping y para que el botón tenga su propio handler explícito.
        return `
            <div class="onu-pending-card" data-olt-id="${p.olt_id}" data-pon-port="${p.pon_port}" data-serial="${escapeHtml(p.serial_number || '')}" style="background:white; border-radius:12px; padding:12px; margin-bottom:6px; box-shadow:0 1px 2px rgba(0,0,0,0.04); border-left:3px solid #f59e0b; cursor:pointer;">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:0.9em;">${escapeHtml(p.olt_name || 'OLT')}</div>
                        <div style="font-size:0.75em; color:#666; margin-top:2px;">PON ${p.pon_port ?? '?'}</div>
                        <div style="font-size:0.78em; font-family:monospace; color:#0066cc; margin-top:3px;">${escapeHtml(p.serial_number || '—')}</div>
                        ${p.description ? `<div style="font-size:0.75em; color:#999; margin-top:2px;">${escapeHtml(p.description)}</div>` : ''}
                    </div>
                    <div style="text-align:right; flex-shrink:0;">
                        <button type="button" class="btn-autorizar-onu" style="background:#16a34a; color:white; border:none; padding:6px 12px; border-radius:6px; font-size:0.75em; font-weight:600; cursor:pointer;"><i class="fas fa-check"></i> Autorizar</button>
                    </div>
                </div>
            </div>
        `;
    }

    // 🛡️ v2026-06-01: handler delegado (se setea una sola vez en show()) para los cards de
    // ONUs pendientes y su botón Autorizar. Evita el bug de inline onclick que en algunos
    // dispositivos no disparaba.
    function bindPendingHandlers() {
        const container = document.getElementById('olt-list-container');
        if (!container || container.dataset.pendingBound === '1') return;
        container.dataset.pendingBound = '1';
        container.addEventListener('click', (e) => {
            const card = e.target.closest('.onu-pending-card');
            if (!card) return;
            // Si fue el botón, prevenir bubbling adicional y disparar igual
            const isBtn = e.target.closest('.btn-autorizar-onu');
            if (isBtn) { e.stopPropagation(); }
            const oltId = parseInt(card.dataset.oltId, 10);
            const ponPort = parseInt(card.dataset.ponPort, 10);
            const serial = card.dataset.serial || '';
            if (!isNaN(oltId) && !isNaN(ponPort)) {
                openAuthorizeModal(oltId, ponPort, serial);
            } else {
                console.warn('[autorizar] datos del card inválidos', { oltId, ponPort, serial });
                showToast('Datos de la ONU incompletos', 'error');
            }
        });
    }

    function renderList() {
        const c = document.getElementById('olt-list-container');
        if (!c) return;
        document.querySelectorAll('#page-gestorolt .tab-btn').forEach(btn => {
            const f = btn.dataset.tab;
            btn.classList.toggle('active', f === activeTab);
            const countEl = btn.querySelector('.count');
            if (countEl) countEl.textContent = f === 'olts' ? olts.length : pending.length;
        });
        if (activeTab === 'olts') {
            c.innerHTML = olts.length ? olts.map(renderOLT).join('')
                : `<div class="empty-state"><i class="fas fa-server"></i><p>No hay OLTs registradas</p></div>`;
        } else {
            c.innerHTML = pending.length ? pending.map(renderPending).join('')
                : `<div class="empty-state"><i class="fas fa-check-circle" style="color:#16a34a;"></i><p>Sin ONUs pendientes</p></div>`;
            bindPendingHandlers();
        }
    }

    async function loadOlts() {
        try {
            const data = await API.get('/gestorolt/api/olts');
            olts = data?.olts || (Array.isArray(data) ? data : []);
        } catch { olts = []; }
    }

    async function loadPending() {
        try {
            const data = await API.get('/gestorolt/api/unified/pending');
            pending = data?.pending || (Array.isArray(data) ? data : []);
        } catch { pending = []; }
    }

    // ============ Autorizar pendiente ============
    async function loadProfiles(oltId) {
        if (profilesCache.has(oltId)) return profilesCache.get(oltId);
        const result = { line: [], srv: [] };
        try {
            // El endpoint correcto es /olts/{olt_id}/profiles/line (NO ?olt_id=)
            const [lineRes, srvRes] = await Promise.all([
                API.get(`/gestorolt/api/olts/${oltId}/profiles/line`).catch(() => null),
                API.get(`/gestorolt/api/olts/${oltId}/profiles/srv`).catch(() => null),
            ]);
            // El backend devuelve directamente un array (no objeto con profiles)
            const lineArr = Array.isArray(lineRes) ? lineRes : (lineRes?.profiles || []);
            const srvArr = Array.isArray(srvRes) ? srvRes : (srvRes?.profiles || []);
            result.line = lineArr.filter(p => p && (p.name || p.profile_name));
            result.srv = srvArr.filter(p => p && (p.name || p.profile_name));
        } catch (err) {
            console.error('[loadProfiles]', err);
        }
        profilesCache.set(oltId, result);
        return result;
    }

    async function openAuthorizeModal(oltId, ponPort, serialNumber) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const lblStyle = 'display:block; font-size:0.78em; font-weight:600; color:#555; margin-bottom:4px;';
        const inputStyle = 'width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:12px; font-size:0.95em; box-sizing:border-box;';

        // 🆕 Auto-calcular ONU ID: siguiente disponible en este puerto PON (igual que el web React)
        let nextOnuId = 1;
        try {
            const data = await API.get(`/gestorolt/api/olts/${oltId}/onus`);
            const onus = Array.isArray(data) ? data : (data?.onus || data?.items || []);
            const usadosEnPuerto = onus.filter(o => o.pon_port === ponPort).map(o => o.onu_id);
            const usedSet = new Set(usadosEnPuerto);
            while (usedSet.has(nextOnuId)) nextOnuId++;
        } catch {}

        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-check-circle"></i> Autorizar ONU</h3>
                    <button class="modal-close" style="background:none; border:none; color:white; font-size:1.4em; cursor:pointer;">&times;</button>
                </div>
                <div class="modal-body" style="padding:14px 18px;">
                    <div style="background:#f0f9ff; padding:10px; border-radius:8px; margin-bottom:12px; font-size:0.85em;">
                        <div><b>Serial:</b> <span style="font-family:monospace; color:#0066cc;">${escapeHtml(serialNumber)}</span></div>
                        <div><b>OLT:</b> ${oltId} · <b>PON:</b> ${ponPort}</div>
                    </div>
                    <label style="${lblStyle}">Descripción / Cliente *</label>
                    <input type="text" id="auth-desc" placeholder="Nombre cliente" maxlength="60" style="${inputStyle}">
                    <label style="${lblStyle}">ID ONU <small style="color:#16a34a; font-weight:normal;">(auto-calculado: ${nextOnuId})</small></label>
                    <input type="number" id="auth-onu-id" value="${nextOnuId}" min="1" max="128" style="${inputStyle}">
                    <label style="${lblStyle}">Line Profile <small style="color:#16a34a; font-weight:normal;">(auto)</small></label>
                    <select id="auth-line" style="${inputStyle}"><option value="">Cargando…</option></select>
                    <label style="${lblStyle}">Service Profile <small style="color:#999; font-weight:normal;">(opcional)</small></label>
                    <select id="auth-srv" style="${inputStyle}"><option value="">Cargando…</option></select>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="auth-submit"><i class="fas fa-check"></i> Autorizar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

        // Cargar perfiles
        const profiles = await loadProfiles(oltId);
        const lineSel = overlay.querySelector('#auth-line');
        const srvSel = overlay.querySelector('#auth-srv');

        // 🛡️ v2026-06-10 (caso ZTEGCC25B9AC OLT Salsipuedes — CData GPON):
        // El comando del OLT espera el ID NUMÉRICO del profile, NO el nombre.
        // Antes la app mandaba "line-profile_0" → OLT respondía "% Unknown command".
        // Mismo patrón que React (ONUList.tsx ln 1276): si hay srvProfiles, usar p.id;
        // sino (VSOL etc.), usar p.name.
        const useIdAsValue = profiles.srv && profiles.srv.length > 0;
        const profileValue = (p) => useIdAsValue ? String(p.id ?? p.profile_id ?? p.name) : (p.name || p.profile_name || p.id);

        // Auto-seleccionar line profile: el que tenga "PON_N" en el nombre (mismo patrón del web React)
        let autoLineProfile = null;
        if (profiles.line.length) {
            autoLineProfile = profiles.line.find(p => {
                const n = (p.name || p.profile_name || '').toLowerCase();
                return n.includes(`pon_${ponPort}`) || n.includes(`pon${ponPort}`);
            });
        }
        lineSel.innerHTML = profiles.line.length
            ? profiles.line.map(p => {
                const v = profileValue(p);
                const label = (p.name || p.profile_name || p.id) + (useIdAsValue ? ` (ID: ${p.id ?? p.profile_id})` : '');
                const isAuto = autoLineProfile && (autoLineProfile.name === p.name || autoLineProfile.profile_name === p.profile_name);
                return `<option value="${escapeHtml(v)}" ${isAuto ? 'selected' : ''}>${escapeHtml(label)}${isAuto ? ' ✓' : ''}</option>`;
            }).join('')
            : '<option value="">Sin perfiles disponibles</option>';
        // Service profile: opción vacía + lista (no es obligatorio en el web React)
        srvSel.innerHTML = '<option value="">— (sin service profile)</option>' + (profiles.srv.length
            ? profiles.srv.map(p => {
                const v = profileValue(p);
                const label = (p.name || p.profile_name || p.id) + (useIdAsValue ? ` (ID: ${p.id ?? p.profile_id})` : '');
                return `<option value="${escapeHtml(v)}">${escapeHtml(label)}</option>`;
            }).join('')
            : '');

        overlay.querySelector('#auth-submit').onclick = async () => {
            const desc = overlay.querySelector('#auth-desc').value.trim();
            const onuId = parseInt(overlay.querySelector('#auth-onu-id').value);
            const linePro = lineSel.value;
            const srvPro = srvSel.value; // puede estar vacío (opcional)
            if (!desc) return showToast('Falta descripción', 'error');
            if (!onuId || onuId < 1) return showToast('Falta ID de ONU', 'error');
            if (!linePro) return showToast('Selecciona un line profile', 'error');

            const btn = overlay.querySelector('#auth-submit');
            btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Autorizando…';
            try {
                const res = await API.post(`/gestorolt/api/olts/${oltId}/onus/authorize`, {
                    pon_port: ponPort,
                    onu_id: onuId,
                    serial_number: serialNumber,
                    line_profile: linePro,
                    srv_profile: srvPro || '', // permitir vacío como el web
                    description: desc,
                });
                // 🛡️ v2026-06-10 (caso ZTEGCC25B9AC): el backend retorna 200 OK con
                // {success:false, error:"..."} cuando los comandos del OLT fallan.
                // Antes no se chequeaba y el toast mostraba "ONU autorizada ✓" en vacío.
                if (res && res.success === false) {
                    throw new Error(res.error || 'El OLT rechazó la autorización');
                }
                showToast('ONU autorizada ✓', 'success');
                overlay.remove();
                await loadPending();
                renderList();
            } catch (err) {
                showToast('Error: ' + (err.message || 'autorización fallida'), 'error');
                btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Autorizar';
            }
        };
    }

    // ============ Detalle OLT ============
    async function openOlt(oltId) {
        selectedOlt = olts.find(o => o.id === oltId);
        if (!selectedOlt) return;
        const c = document.getElementById('olt-list-container');
        c.innerHTML = `
            <div style="background:white; border-radius:12px; padding:12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
                <button onclick="GestorOLTPage.backToList()" style="background:none; border:none; color:#0066cc; font-size:0.9em; cursor:pointer;"><i class="fas fa-arrow-left"></i> OLTs</button>
                <div style="font-weight:600;">${escapeHtml(selectedOlt.name)}</div>
                <div style="width:60px;"></div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:6px; margin-bottom:6px;">
                <button onclick="GestorOLTPage.abrirMacTable(${oltId})" style="padding:8px; background:#6b7280; color:white; border:none; border-radius:8px; font-size:0.76em; font-weight:600; cursor:pointer;"><i class="fas fa-table"></i> MAC</button>
                <button onclick="GestorOLTPage.abrirVlans(${oltId})" style="padding:8px; background:#7c3aed; color:white; border:none; border-radius:8px; font-size:0.76em; font-weight:600; cursor:pointer;"><i class="fas fa-project-diagram"></i> VLANs</button>
                <button onclick="GestorOLTPage.abrirAlarmas(${oltId})" style="padding:8px; background:#dc2626; color:white; border:none; border-radius:8px; font-size:0.76em; font-weight:600; cursor:pointer;"><i class="fas fa-bell"></i> Alarmas</button>
                <button onclick="GestorOLTPage.abrirBackups(${oltId})" style="padding:8px; background:#16a34a; color:white; border:none; border-radius:8px; font-size:0.76em; font-weight:600; cursor:pointer;"><i class="fas fa-save"></i> Backups</button>
            </div>
            <div style="display:flex; gap:6px; margin-bottom:8px;">
                <button onclick="GestorOLTPage.toggleConexion(${oltId}, 'connect')" style="flex:1; padding:8px; background:#0066cc; color:white; border:none; border-radius:8px; font-size:0.76em; font-weight:600; cursor:pointer;"><i class="fas fa-plug"></i> Conectar</button>
                <button onclick="GestorOLTPage.toggleConexion(${oltId}, 'disconnect')" style="flex:1; padding:8px; background:#f59e0b; color:white; border:none; border-radius:8px; font-size:0.76em; font-weight:600; cursor:pointer;"><i class="fas fa-power-off"></i> Desconectar</button>
            </div>
            <div style="background:white; padding:8px; border-radius:8px; margin-bottom:6px;">
                <input type="text" id="onu-search" placeholder="Buscar por serial, descripción, PON o cliente..." value="${escapeHtml(onuSearchTerm)}" style="width:100%; padding:9px 12px; border:1px solid #ddd; border-radius:6px; font-size:0.9em;">
            </div>
            <div id="olt-onus-count" style="font-size:0.76em; color:#666; padding:0 4px 4px;"></div>
            <div id="olt-onus-list"><div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando ONUs…</div></div>
        `;
        document.getElementById('onu-search').addEventListener('input', (e) => {
            onuSearchTerm = e.target.value.trim();
            renderOnusList(oltId);
        });
        try {
            // El endpoint NO acepta paginación — siempre llamar sin params
            const data = await API.get(`/gestorolt/api/olts/${oltId}/onus`);
            oltOnus = Array.isArray(data) ? data : (data?.onus || data?.items || []);
        } catch { oltOnus = []; }
        renderOnusList(oltId);
    }

    function renderOnusList(oltId) {
        const list = document.getElementById('olt-onus-list');
        const countEl = document.getElementById('olt-onus-count');
        if (!list) return;
        if (!oltOnus.length) {
            list.innerHTML = `<div class="empty-state"><i class="fas fa-wifi"></i><p>Sin ONUs en este OLT</p></div>`;
            if (countEl) countEl.textContent = '';
            return;
        }
        const q = onuSearchTerm.toLowerCase();
        const filtradas = !q ? oltOnus : oltOnus.filter(o =>
            (o.serial_number || '').toLowerCase().includes(q) ||
            (o.description || '').toLowerCase().includes(q) ||
            (o.mac_address || '').toLowerCase().includes(q) ||
            String(o.pon_port).includes(q) ||
            `${o.pon_port}/${o.onu_id}`.includes(q)
        );
        if (countEl) {
            const online = filtradas.filter(o => (o.status||'').toLowerCase() === 'online').length;
            countEl.innerHTML = `${filtradas.length} de ${oltOnus.length} ONUs · <span style="color:#16a34a;">${online} online</span> · <span style="color:#dc3545;">${filtradas.length - online} offline</span>`;
        }
        if (!filtradas.length) {
            list.innerHTML = `<div class="empty-state"><i class="fas fa-search"></i><p>Sin resultados para "${escapeHtml(onuSearchTerm)}"</p></div>`;
            return;
        }
        list.innerHTML = filtradas.map(o => renderOnu(o, oltId)).join('');
    }

    function renderOnu(o, oltId) {
        const online = (o.status || '').toLowerCase() === 'online';
        const rx = o.rx_power_dbm != null ? o.rx_power_dbm : (o.rx_power != null ? o.rx_power : null);
        const distance = o.distance_m != null ? o.distance_m : o.distance;
        const rxColor = (rx == null) ? '#999' : (rx > -25 ? '#16a34a' : rx > -28 ? '#f59e0b' : '#dc3545');
        return `
            <div style="background:white; border-radius:12px; padding:12px; margin-bottom:6px; border-left:3px solid ${online ? '#16a34a' : '#dc3545'};">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                    <div style="flex:1; min-width:0; cursor:pointer;" onclick="GestorOLTPage.openOnuDetail(${oltId},${o.pon_port},${o.onu_id})">
                        <div style="font-weight:600; font-size:0.9em;">PON ${o.pon_port}/${o.onu_id} · ${escapeHtml(o.description || 'Sin nombre')}</div>
                        <div style="font-size:0.74em; font-family:monospace; color:#0066cc; margin-top:2px;">${escapeHtml(o.serial_number || o.mac_address || o.mac || '—')}</div>
                        <div style="font-size:0.75em; margin-top:3px;">
                            <span style="color:${rxColor}; font-weight:600;">RX: ${rx != null ? Number(rx).toFixed(2) + ' dBm' : '—'}</span>
                            ${distance != null ? ` · <span style="color:#666;">Dist: ${distance}m</span>` : ''}
                            ${o.signal_quality ? ` · <span style="color:${rxColor};">${escapeHtml(o.signal_quality)}</span>` : ''}
                        </div>
                    </div>
                    <div style="display:flex; gap:4px; flex-shrink:0;">
                        <button title="Detalle / tráfico" onclick="GestorOLTPage.openOnuDetail(${oltId},${o.pon_port},${o.onu_id})" style="background:#16a34a; color:white; border:none; padding:6px 8px; border-radius:6px; font-size:0.7em; cursor:pointer;"><i class="fas fa-chart-line"></i></button>
                        <button title="Editar descripción" onclick="GestorOLTPage.editDesc(${oltId},${o.pon_port},${o.onu_id},'${escapeHtml(o.description || '')}')" style="background:#0066cc; color:white; border:none; padding:6px 8px; border-radius:6px; font-size:0.7em; cursor:pointer;"><i class="fas fa-edit"></i></button>
                        <button title="Reiniciar" onclick="GestorOLTPage.rebootOnu(${oltId},${o.pon_port},${o.onu_id})" style="background:#f59e0b; color:white; border:none; padding:6px 8px; border-radius:6px; font-size:0.7em; cursor:pointer;"><i class="fas fa-redo"></i></button>
                        <button title="Eliminar" onclick="GestorOLTPage.deleteOnu(${oltId},${o.pon_port},${o.onu_id})" style="background:#dc3545; color:white; border:none; padding:6px 8px; border-radius:6px; font-size:0.7em; cursor:pointer;"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            </div>
        `;
    }

    async function openOnuDetail(oltId, port, onuId) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:92vh;">
                <div class="modal-header"><h3><i class="fas fa-microchip"></i> ONU ${port}/${onuId}</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;"><div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando datos…</div></div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        try {
            const [detalle, optical, traffic, distance] = await Promise.all([
                API.get(`/gestorolt/api/olts/${oltId}/onus/port/${port}/${onuId}`).catch(() => null),
                API.get(`/gestorolt/api/olts/${oltId}/onus/port/${port}/${onuId}/optical`).catch(() => null),
                API.get(`/gestorolt/api/olts/${oltId}/onus/port/${port}/${onuId}/traffic-instant`).catch(() => null),
                API.get(`/gestorolt/api/olts/${oltId}/onus/port/${port}/${onuId}/distance`).catch(() => null),
            ]);
            const d = detalle?.onu || detalle || {};
            const opt = optical || {};
            const t = traffic || {};
            const row = (k, v, color) => v != null && v !== '' ? `<div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid #f0f0f0; font-size:0.84em;"><span style="color:#666;">${k}</span><b style="${color?'color:'+color:''};">${escapeHtml(String(v))}</b></div>` : '';
            // Fallback: si el endpoint /optical no devuelve nada, usar campos del detalle
            const rxPower = opt.rx_power != null ? opt.rx_power : (opt.rx_power_dbm != null ? opt.rx_power_dbm : (d.rx_power_dbm != null ? d.rx_power_dbm : null));
            const txPower = opt.tx_power != null ? opt.tx_power : (opt.tx_power_dbm != null ? opt.tx_power_dbm : (d.tx_power_dbm != null ? d.tx_power_dbm : null));
            const voltage = opt.voltage != null ? opt.voltage : opt.voltage_v;
            const bias = opt.bias != null ? opt.bias : opt.bias_current_ma;
            const temp = opt.temperature != null ? opt.temperature : (opt.temperature_c != null ? opt.temperature_c : d.temperature_c);
            const dist = distance?.distance_m != null ? distance.distance_m : (distance?.distance != null ? distance.distance : (d.distance_m != null ? d.distance_m : d.distance));
            // Traffic: el backend devuelve download_kbps/upload_kbps + waiting flag
            const dlKbps = t.download_kbps != null ? t.download_kbps : (t.rx_kbps != null ? t.rx_kbps : null);
            const ulKbps = t.upload_kbps != null ? t.upload_kbps : (t.tx_kbps != null ? t.tx_kbps : null);
            const trafficWaiting = t.waiting === true;
            const rxColor = (rxPower == null) ? '#999' : (rxPower > -25 ? '#16a34a' : rxPower > -28 ? '#f59e0b' : '#dc3545');
            overlay.querySelector('.modal-body').innerHTML = `
                <div style="background:#f0f9ff; padding:10px; border-radius:8px; margin-bottom:12px;">
                    <div style="font-weight:600;">${escapeHtml(d.description || 'Sin descripción')}</div>
                    <div style="font-size:0.78em; color:#666; margin-top:2px; font-family:monospace;">${escapeHtml(d.serial_number || d.mac_address || d.mac || '?')}</div>
                </div>
                <div style="font-weight:600; color:#0066cc; margin-bottom:6px;"><i class="fas fa-info-circle"></i> Datos</div>
                ${row('Estado', d.status, (d.status || '').toLowerCase() === 'online' ? '#16a34a' : '#dc3545')}
                ${row('Line profile', d.line_profile)}
                ${row('Srv profile', d.srv_profile)}
                ${row('Calidad señal', d.signal_quality, d.signal_quality === 'good' ? '#16a34a' : d.signal_quality === 'warning' ? '#f59e0b' : d.signal_quality ? '#dc3545' : null)}
                ${row('Distancia', dist != null ? dist + ' m' : null)}
                ${row('VLAN', d.vlan_id)}
                ${row('Última subida', d.last_online ? new Date(d.last_online).toLocaleString() : null)}

                <div style="font-weight:600; color:#0066cc; margin:14px 0 6px;"><i class="fas fa-bolt"></i> Señal óptica</div>
                ${row('RX power', rxPower != null ? Number(rxPower).toFixed(2) + ' dBm' : null, rxColor)}
                ${row('TX power', txPower != null ? Number(txPower).toFixed(2) + ' dBm' : null)}
                ${row('Voltaje', voltage != null ? voltage + ' V' : null)}
                ${row('Corriente bias', bias != null ? bias + ' mA' : null)}
                ${row('Temperatura', temp != null ? temp + ' °C' : null)}

                <div style="font-weight:600; color:#0066cc; margin:14px 0 6px;"><i class="fas fa-tachometer-alt"></i> Tráfico instantáneo</div>
                ${trafficWaiting ? '<div style="background:#fffbeb; padding:8px; border-radius:6px; font-size:0.78em; color:#92400e;"><i class="fas fa-spinner fa-spin"></i> Esperando primera muestra de tráfico…</div>' : ''}
                ${row('Descarga', dlKbps != null ? fmtKbps(dlKbps) : null, '#16a34a')}
                ${row('Subida', ulKbps != null ? fmtKbps(ulKbps) : null, '#dc2626')}

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:14px;">
                    <button onclick="GestorOLTPage.editDesc(${oltId},${port},${onuId},'${escapeHtml(d.description || '')}')" style="padding:10px; background:#0066cc; color:white; border:none; border-radius:6px; font-size:0.85em; cursor:pointer;"><i class="fas fa-edit"></i> Editar desc</button>
                    <button onclick="GestorOLTPage.editProfile(${oltId},${port},${onuId},'${escapeHtml(d.line_profile || '')}','${escapeHtml(d.srv_profile || '')}')" style="padding:10px; background:#7c3aed; color:white; border:none; border-radius:6px; font-size:0.85em; cursor:pointer;"><i class="fas fa-project-diagram"></i> Cambiar VLAN</button>
                    <button onclick="GestorOLTPage.rebootOnu(${oltId},${port},${onuId})" style="padding:10px; background:#f59e0b; color:white; border:none; border-radius:6px; font-size:0.85em; cursor:pointer;"><i class="fas fa-redo"></i> Reiniciar</button>
                    <button onclick="GestorOLTPage.deleteOnu(${oltId},${port},${onuId})" style="padding:10px; background:#dc3545; color:white; border:none; border-radius:6px; font-size:0.85em; cursor:pointer;"><i class="fas fa-trash"></i> Eliminar</button>
                    <button onclick="GestorOLTPage.openOnuDetail(${oltId},${port},${onuId})" style="padding:10px; grid-column:span 2; background:#16a34a; color:white; border:none; border-radius:6px; font-size:0.85em; cursor:pointer;"><i class="fas fa-sync-alt"></i> Refrescar</button>
                </div>
            `;
        } catch (err) {
            overlay.querySelector('.modal-body').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle" style="color:#dc3545;"></i><p>Error: ${escapeHtml(err.message)}</p></div>`;
        }
    }

    function fmtKbps(kbps) {
        if (kbps == null) return '—';
        if (kbps >= 1e6) return (kbps/1e6).toFixed(2) + ' Gbps';
        if (kbps >= 1e3) return (kbps/1e3).toFixed(2) + ' Mbps';
        return Number(kbps).toFixed(0) + ' Kbps';
    }

    async function abrirMacTable(oltId) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:92vh;">
                <div class="modal-header"><h3><i class="fas fa-table"></i> Tabla MAC del OLT</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;"><div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Consultando…</div></div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        try {
            const data = await API.get(`/gestorolt/api/olts/${oltId}/mac-table`);
            const items = data?.macs || data?.mac_table || (Array.isArray(data) ? data : []);
            const body = overlay.querySelector('.modal-body');
            if (!items.length) { body.innerHTML = `<div class="empty-state"><p>Sin entradas</p></div>`; return; }
            body.innerHTML = `
                <div style="font-size:0.78em; color:#666; margin-bottom:6px;">${items.length} MACs</div>
                <div style="max-height:60vh; overflow-y:auto;">
                    ${items.slice(0,200).map(m => `
                        <div style="background:white; padding:8px; border-bottom:1px solid #eee; font-size:0.78em;">
                            <div style="font-family:monospace; font-weight:600;">${escapeHtml(m.mac || m.mac_address || '?')}</div>
                            <div style="color:#666;">VLAN ${escapeHtml(String(m.vlan || '?'))} · Puerto ${escapeHtml(String(m.port || m.pon_port || '?'))}/${escapeHtml(String(m.onu_id || ''))}</div>
                        </div>
                    `).join('')}
                </div>
            `;
        } catch (err) { overlay.querySelector('.modal-body').innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`; }
    }

    async function abrirAlarmas(oltId) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:92vh;">
                <div class="modal-header" style="background:linear-gradient(135deg,#dc2626,#991b1b);"><h3><i class="fas fa-bell"></i> Alarmas del OLT</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;"><div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div></div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        try {
            const data = await API.get(`/gestorolt/api/olts/${oltId}/alarms?acknowledged=false`);
            const items = Array.isArray(data) ? data : (data?.alarms || []);
            const body = overlay.querySelector('.modal-body');
            if (!items.length) {
                body.innerHTML = `<div class="empty-state"><i class="fas fa-check-circle" style="color:#16a34a;"></i><p>Sin alarmas activas</p></div>`;
                return;
            }
            const sevColor = (sev) => ({ critical:'#dc2626', major:'#ef4444', minor:'#f59e0b', warning:'#f59e0b', info:'#0066cc' }[(sev||'').toLowerCase()] || '#666');
            body.innerHTML = items.map(a => {
                const color = sevColor(a.severity);
                return `
                    <div style="background:white; padding:10px; border-radius:8px; margin-bottom:5px; border-left:3px solid ${color};">
                        <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
                            <div style="flex:1; min-width:0;">
                                <div style="font-weight:600; font-size:0.88em;">${escapeHtml(a.alarm_type || a.type || 'Alarma')}</div>
                                <div style="font-size:0.78em; color:#444; margin-top:2px;">${escapeHtml(a.description || a.message || '')}</div>
                                <div style="font-size:0.72em; color:#999; margin-top:3px;">${a.created_at ? new Date(a.created_at).toLocaleString('es-CO') : ''}${a.pon_port != null ? ` · PON ${a.pon_port}` : ''}${a.onu_id != null ? `/${a.onu_id}` : ''}</div>
                            </div>
                            <div style="display:flex; flex-direction:column; gap:5px; align-items:flex-end;">
                                <span style="background:${color}; color:white; font-size:0.66em; font-weight:600; padding:2px 6px; border-radius:5px; text-transform:uppercase;">${escapeHtml(a.severity || '?')}</span>
                                ${!a.is_acknowledged ? `<button onclick="GestorOLTPage.ackAlarma(${oltId}, ${a.id})" style="background:#16a34a; color:white; border:none; padding:4px 8px; border-radius:5px; font-size:0.7em; cursor:pointer;"><i class="fas fa-check"></i> ACK</button>` : '<span style="color:#16a34a; font-size:0.7em;">✓ ACK</span>'}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (err) { overlay.querySelector('.modal-body').innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`; }
    }

    async function ackAlarma(oltId, alarmId) {
        try {
            await API.post(`/gestorolt/api/olts/${oltId}/alarms/${alarmId}/acknowledge`, {});
            showToast('Alarma reconocida ✓', 'success');
            document.querySelector('.modal-overlay')?.remove();
            abrirAlarmas(oltId);
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function abrirBackups(oltId) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:92vh;">
                <div class="modal-header" style="background:linear-gradient(135deg,#16a34a,#0d7836);"><h3><i class="fas fa-save"></i> Backups del OLT</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;"><div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div></div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        try {
            const data = await API.get(`/gestorolt/api/olts/${oltId}/backups`);
            const items = Array.isArray(data) ? data : (data?.backups || []);
            const body = overlay.querySelector('.modal-body');
            body.innerHTML = `
                <button onclick="GestorOLTPage.crearBackup(${oltId})" style="width:100%; padding:10px; background:#16a34a; color:white; border:none; border-radius:8px; font-size:0.88em; font-weight:600; cursor:pointer; margin-bottom:10px;"><i class="fas fa-plus"></i> Crear backup ahora</button>
                ${items.length ? items.map(b => `
                    <div style="background:white; padding:10px; border-radius:8px; margin-bottom:5px; border-left:3px solid #0066cc;">
                        <div style="font-weight:600; font-size:0.86em;">${escapeHtml(b.filename || 'backup-' + b.id)}</div>
                        <div style="font-size:0.76em; color:#666; margin-top:2px;">${b.created_at ? new Date(b.created_at).toLocaleString('es-CO') : ''} · ${b.size_bytes ? Math.round(b.size_bytes/1024) + ' KB' : ''}</div>
                        <div style="margin-top:6px; display:flex; gap:5px;">
                            <button onclick="GestorOLTPage.descargarBackup(${oltId}, ${b.id})" style="background:#0066cc; color:white; border:none; padding:5px 10px; border-radius:5px; font-size:0.74em; cursor:pointer;"><i class="fas fa-download"></i> Descargar</button>
                            <button onclick="GestorOLTPage.previewBackup(${oltId}, ${b.id})" style="background:#6b7280; color:white; border:none; padding:5px 10px; border-radius:5px; font-size:0.74em; cursor:pointer;"><i class="fas fa-eye"></i> Ver</button>
                        </div>
                    </div>
                `).join('') : '<div class="empty-state"><p>Sin backups</p></div>'}
            `;
        } catch (err) { overlay.querySelector('.modal-body').innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`; }
    }

    async function crearBackup(oltId) {
        if (!confirm('¿Crear un backup ahora? Puede demorar 30-60 seg.')) return;
        showToast('Creando backup…');
        try {
            await API.post(`/gestorolt/api/olts/${oltId}/backups`, {});
            showToast('Backup creado ✓', 'success');
            document.querySelector('.modal-overlay')?.remove();
            abrirBackups(oltId);
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    function descargarBackup(oltId, backupId) {
        const url = APP_CONFIG.SERVER_URL + `/gestorolt/api/backup-scheduler/backups/${oltId}/download/${backupId}?token=` + encodeURIComponent(API.getToken());
        try {
            if (window.Capacitor?.Plugins?.Browser?.open) { window.Capacitor.Plugins.Browser.open({ url, windowName: '_system' }); return; }
        } catch (e) { console.warn('[backup] Browser.open failed:', e.message); }
        window.open(url, '_blank');
    }

    async function previewBackup(oltId, backupId) {
        try {
            const data = await API.get(`/gestorolt/api/backup-scheduler/backups/${oltId}/preview/${backupId}`);
            const content = data?.content || data?.preview || JSON.stringify(data);
            const w = window.open('', '_blank');
            if (w) w.document.write(`<pre style="font-family:monospace; padding:20px; font-size:11px;">${content.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>`);
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function toggleConexion(oltId, accion) {
        if (!confirm(`¿${accion === 'connect' ? 'CONECTAR' : 'DESCONECTAR'} el OLT?`)) return;
        try {
            await API.post(`/gestorolt/api/olts/${oltId}/${accion}`, {});
            showToast(accion === 'connect' ? 'Conectado ✓' : 'Desconectado ✓', 'success');
            await loadOlts();
            if (selectedOlt) await openOlt(oltId);
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function abrirVlans(oltId) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:92vh;">
                <div class="modal-header"><h3><i class="fas fa-project-diagram"></i> VLANs del OLT</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;"><div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Consultando…</div></div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        try {
            const data = await API.get(`/gestorolt/api/olts/${oltId}/vlans`);
            const items = data?.vlans || (Array.isArray(data) ? data : []);
            const body = overlay.querySelector('.modal-body');
            if (!items.length) { body.innerHTML = `<div class="empty-state"><p>Sin VLANs</p></div>`; return; }
            body.innerHTML = items.map(v => `
                <div style="background:white; padding:10px; border-radius:6px; margin-bottom:5px; border-left:3px solid #0066cc;">
                    <div style="font-weight:600;">VLAN ${escapeHtml(String(v.vlan_id || v.id))}</div>
                    <div style="font-size:0.78em; color:#666;">${escapeHtml(v.name || v.description || '')}</div>
                    ${v.uplink ? `<div style="font-size:0.72em; color:#16a34a; margin-top:2px;"><i class="fas fa-arrow-up"></i> Uplink</div>` : ''}
                </div>
            `).join('');
        } catch (err) { overlay.querySelector('.modal-body').innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`; }
    }

    async function editDesc(oltId, port, onuId, currentDesc) {
        const newDesc = prompt('Nueva descripción:', currentDesc);
        if (newDesc === null) return;
        try {
            await API.put(`/gestorolt/api/olts/${oltId}/onus/port/${port}/${onuId}/description`, { description: newDesc.trim() });
            showToast('Descripción actualizada ✓', 'success');
            await openOlt(oltId); // refresh
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    // 🆕 v1.0.91 (2026-06-03): Cambiar VLAN/perfil de una ONU (paridad con web).
    // Cambia el line_profile (que en MikroWisp/C-Data está bundleado con la VLAN) o el srv_profile.
    // Por debajo PUT /olts/{id}/onus/port/{port}/{onuId}/profile — mismo endpoint que usa el web.
    async function editProfile(oltId, port, onuId, currentLineProfile, currentSrvProfile) {
        // Cargar perfiles disponibles del OLT (usa cache de profilesCache)
        const profiles = await loadProfiles(oltId);
        if (!profiles.line.length && !profiles.srv.length) {
            showToast('No hay perfiles configurados en este OLT', 'error');
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const lbl = 'display:block; font-size:0.82em; font-weight:600; color:#555; margin-bottom:6px;';
        const sel = 'width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:12px; font-size:0.95em; box-sizing:border-box;';

        // Auto-sugerir line_profile que tenga PON_${port} en el nombre (mismo patrón que autorizar)
        const sugerirLine = profiles.line.find(p => {
            const n = (p.name || p.profile_name || '').toLowerCase();
            return n.includes(`pon_${port}`) || n.includes(`pon${port}`);
        });

        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header" style="background:linear-gradient(135deg,#7c3aed,#5b21b6);">
                    <h3><i class="fas fa-project-diagram"></i> Cambiar VLAN / Perfil</h3>
                    <button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button>
                </div>
                <div class="modal-body" style="padding:14px 18px;">
                    <div style="background:#f5f3ff; padding:10px; border-radius:8px; margin-bottom:14px; font-size:0.85em;">
                        <div><b>ONU:</b> ${oltId}/${port}/${onuId}</div>
                        <div><b>Line profile actual:</b> ${escapeHtml(currentLineProfile || '—')}</div>
                        <div><b>Service profile actual:</b> ${escapeHtml(currentSrvProfile || '—')}</div>
                    </div>
                    <label style="${lbl}">Nuevo Line Profile (define la VLAN)</label>
                    <select id="ep-line" style="${sel}">
                        <option value="">— Mantener actual —</option>
                        ${profiles.line.map(p => {
                            const n = p.name || p.profile_name || p.id;
                            const isAuto = sugerirLine && (sugerirLine.name === p.name || sugerirLine.profile_name === p.profile_name);
                            return `<option value="${escapeHtml(n)}" ${isAuto ? '' : ''}>${escapeHtml(n)}${isAuto ? ' (sugerido)' : ''}</option>`;
                        }).join('')}
                    </select>
                    <label style="${lbl}">Nuevo Service Profile <small style="font-weight:normal;color:#888;">(opcional)</small></label>
                    <select id="ep-srv" style="${sel}">
                        <option value="">— Mantener actual —</option>
                        ${profiles.srv.map(p => {
                            const n = p.name || p.profile_name || p.id;
                            return `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`;
                        }).join('')}
                    </select>
                    <div style="background:#fef3c7; padding:8px; border-radius:6px; font-size:0.8em; color:#92400e; border-left:3px solid #f59e0b;">
                        <i class="fas fa-info-circle"></i> El cambio se aplica al OLT en vivo. La ONU puede reconectar en pocos segundos.
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="ep-submit" style="background:#7c3aed;"><i class="fas fa-check"></i> Aplicar cambio</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        overlay.querySelector('#ep-submit').onclick = async () => {
            const newLine = overlay.querySelector('#ep-line').value.trim();
            const newSrv = overlay.querySelector('#ep-srv').value.trim();
            if (!newLine && !newSrv) {
                showToast('Elegí al menos uno de los perfiles', 'warning');
                return;
            }
            const btn = overlay.querySelector('#ep-submit');
            btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aplicando…';
            try {
                const body = {};
                if (newLine) body.line_profile = newLine;
                if (newSrv) body.srv_profile = newSrv;
                await API.put(`/gestorolt/api/olts/${oltId}/onus/port/${port}/${onuId}/profile`, body);
                showToast('Perfil/VLAN actualizado ✓', 'success');
                overlay.remove();
                // Refrescar el detalle de la ONU para mostrar los nuevos valores
                setTimeout(() => openOnuDetail(oltId, port, onuId), 400);
            } catch (err) {
                showToast('Error: ' + (err.message || 'no se pudo cambiar'), 'error');
                btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Aplicar cambio';
            }
        };
    }

    async function rebootOnu(oltId, port, onuId) {
        if (!confirm(`¿Reiniciar ONU ${port}/${onuId}?`)) return;
        try {
            await API.post(`/gestorolt/api/olts/${oltId}/onus/port/${port}/${onuId}/reboot`, {});
            showToast('ONU reiniciada ✓', 'success');
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function deleteOnu(oltId, port, onuId) {
        if (!confirm(`⚠️ ¿ELIMINAR ONU ${port}/${onuId}?\n\nEsto desautoriza el equipo del OLT.`)) return;
        try {
            await API.del(`/gestorolt/api/olts/${oltId}/onus/port/${port}/${onuId}`);
            showToast('ONU eliminada ✓', 'success');
            await openOlt(oltId);
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    function backToList() {
        selectedOlt = null;
        renderList();
    }

    function show() {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const main = document.querySelector('.app-main');
        let page = document.getElementById('page-gestorolt');
        if (!page) {
            page = document.createElement('div');
            page.id = 'page-gestorolt';
            page.className = 'page';
            main.appendChild(page);
        }
        page.classList.add('active');
        page.innerHTML = `
            <div class="tabs-bar">
                <button class="tab-btn ${activeTab === 'olts' ? 'active' : ''}" data-tab="olts"><i class="fas fa-server"></i> OLTs <span class="count">0</span></button>
                <button class="tab-btn ${activeTab === 'pending' ? 'active' : ''}" data-tab="pending"><i class="fas fa-hourglass-half"></i> Pendientes <span class="count">0</span></button>
            </div>
            <div id="olt-list-container" style="margin-top:6px;">
                <div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>
            </div>
        `;
        page.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activeTab = btn.dataset.tab;
                selectedOlt = null;
                renderList();
            });
        });
        (async () => {
            await Promise.all([loadOlts(), loadPending()]);
            if (!olts.length && !pending.length) {
                document.getElementById('olt-list-container').innerHTML = `<div class="empty-state" style="padding:40px 20px;">
                    <i class="fas fa-lock" style="color:#dc3545; font-size:2.5em; margin-bottom:10px;"></i>
                    <p style="font-weight:600;">Sin acceso a GestorOLT</p>
                    <p style="font-size:0.85em; margin-top:6px;">Requiere permiso <b>ver_olt</b>.</p>
                </div>`;
                return;
            }
            renderList();
        })();
    }

    return { show, openAuthorizeModal, openOlt, backToList, editDesc, editProfile, rebootOnu, deleteOnu, openOnuDetail, abrirMacTable, abrirVlans, abrirAlarmas, ackAlarma, abrirBackups, crearBackup, descargarBackup, previewBackup, toggleConexion };
})();

if (typeof Router !== 'undefined') Router.register('gestorolt', () => GestorOLTPage.show());
