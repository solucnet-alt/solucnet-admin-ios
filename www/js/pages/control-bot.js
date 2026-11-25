// 🆕 Página: Control del Bot — Zonas Caídas + IA Whitelist + Omitidos
const ControlBotPage = (function() {
    let zonas = [];
    let whitelist = [];
    let omitidos = [];
    let activeTab = 'zonas';

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    }

    function fmtFechaCorta(ts) {
        if (!ts) return '—';
        try { return new Date(ts).toLocaleString('es-CO', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); }
        catch { return '—'; }
    }

    function renderZona(z) {
        const caida = !!z.caida;
        const color = caida ? '#dc3545' : '#16a34a';
        const txt = caida ? 'CAÍDA' : 'OK';
        return `
            <div data-id="${escapeHtml(z.id)}" style="background:white; border-radius:12px; padding:14px; margin-bottom:8px; box-shadow:0 1px 2px rgba(0,0,0,0.04); border-left:3px solid ${color};">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:1em;">${escapeHtml(z.nombre || z.id)}</div>
                        <div style="font-size:0.78em; color:#666; margin-top:3px; font-family:monospace;">${escapeHtml(z.rango_ip || '—')}</div>
                        ${z.tecnico_asignado ? `<div style="font-size:0.78em; color:#0066cc; margin-top:3px;"><i class="fas fa-hard-hat"></i> ${escapeHtml(z.tecnico_asignado)}</div>` : ''}
                        ${caida && z.caida_inicio ? `<div style="font-size:0.75em; color:#dc3545; margin-top:3px;"><i class="fas fa-clock"></i> Desde ${fmtFechaCorta(z.caida_inicio)}</div>` : ''}
                        ${z.afectados_actuales ? `<div style="font-size:0.78em; color:#92400e; margin-top:3px;"><i class="fas fa-users"></i> ${z.afectados_actuales} afectados</div>` : ''}
                    </div>
                    <div style="display:flex; flex-direction:column; gap:5px; align-items:flex-end; flex-shrink:0;">
                        <span style="background:${caida ? '#fee' : '#dcfce7'}; color:${color}; font-size:0.7em; font-weight:600; padding:3px 8px; border-radius:8px;">${txt}</span>
                        ${caida
                            ? `<button onclick="ControlBotPage.resolver('${escapeHtml(z.id)}', '${escapeHtml(z.nombre || z.id)}')" style="background:#16a34a; color:white; border:none; padding:6px 12px; border-radius:6px; font-size:0.75em; font-weight:600; cursor:pointer;"><i class="fas fa-check"></i> Resolver</button>`
                            : `<button onclick="ControlBotPage.marcarCaida('${escapeHtml(z.id)}', '${escapeHtml(z.nombre || z.id)}')" style="background:#dc3545; color:white; border:none; padding:6px 12px; border-radius:6px; font-size:0.75em; font-weight:600; cursor:pointer;"><i class="fas fa-exclamation-triangle"></i> Marcar caída</button>`}
                        <button onclick="ControlBotPage.editarZona('${escapeHtml(z.id)}')" style="background:#0066cc; color:white; border:none; padding:5px 10px; border-radius:5px; font-size:0.72em; cursor:pointer;"><i class="fas fa-edit"></i> Editar</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderWhitelistItem(w) {
        return `
            <div style="background:white; border-radius:12px; padding:12px; margin-bottom:6px; box-shadow:0 1px 2px rgba(0,0,0,0.04); border-left:3px solid #a855f7;">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:0.92em;">${escapeHtml(w.nombre_cliente || w.telefono || w.chat_id)}</div>
                        <div style="font-size:0.78em; color:#666; margin-top:2px; font-family:monospace;">${escapeHtml(w.telefono || w.chat_id)}</div>
                        <div style="font-size:0.72em; color:#999; margin-top:2px;">Activado: ${fmtFechaCorta(w.fecha_activacion)} ${w.activado_por ? '· por ' + escapeHtml(w.activado_por) : ''}</div>
                        ${w.notas ? `<div style="font-size:0.75em; color:#666; margin-top:3px; font-style:italic;">"${escapeHtml(w.notas)}"</div>` : ''}
                    </div>
                    <button onclick="ControlBotPage.desactivarIA('${escapeHtml(w.chat_id)}')" style="background:#fee; color:#dc3545; border:none; padding:6px 10px; border-radius:6px; font-size:0.72em; font-weight:600; cursor:pointer; flex-shrink:0;"><i class="fas fa-times"></i> Quitar</button>
                </div>
            </div>
        `;
    }

    function renderOmitido(o) {
        return `
            <div style="background:white; border-radius:12px; padding:12px; margin-bottom:6px; box-shadow:0 1px 2px rgba(0,0,0,0.04); border-left:3px solid #dc3545;">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:0.92em; font-family:monospace;">+${escapeHtml(o.numero || '?')}</div>
                        ${o.motivo ? `<div style="font-size:0.78em; color:#92400e; margin-top:3px;"><i class="fas fa-ban"></i> ${escapeHtml(o.motivo)}</div>` : ''}
                        ${o.fecha_creacion ? `<div style="font-size:0.72em; color:#999; margin-top:2px;">Agregado: ${fmtFechaCorta(o.fecha_creacion)}</div>` : ''}
                    </div>
                    <button onclick="ControlBotPage.quitarOmitido(${o.id})" style="background:#fee; color:#dc3545; border:none; padding:6px 10px; border-radius:6px; font-size:0.72em; font-weight:600; cursor:pointer; flex-shrink:0;"><i class="fas fa-times"></i> Quitar</button>
                </div>
            </div>
        `;
    }

    function renderList() {
        const c = document.getElementById('control-bot-list');
        if (!c) return;
        document.querySelectorAll('#page-control-bot .tab-btn').forEach(btn => {
            const f = btn.dataset.tab;
            btn.classList.toggle('active', f === activeTab);
            const countEl = btn.querySelector('.count');
            if (countEl) {
                if (f === 'zonas') countEl.textContent = zonas.length;
                else if (f === 'whitelist') countEl.textContent = whitelist.length;
                else if (f === 'omitidos') countEl.textContent = omitidos.length;
            }
        });
        if (activeTab === 'omitidos') {
            const fab = `<button onclick="ControlBotPage.agregarOmitido()" class="fab" style="position:fixed; bottom:80px; right:16px; z-index:100; width:48px; height:48px; border-radius:50%; background:#dc3545; color:white; border:none; box-shadow:0 4px 12px rgba(0,0,0,0.2); font-size:1.1em; cursor:pointer;"><i class="fas fa-plus"></i></button>`;
            if (!omitidos.length) {
                c.innerHTML = fab + `<div class="empty-state"><i class="fas fa-ban"></i><p>Sin números omitidos</p></div>`;
            } else {
                c.innerHTML = fab + omitidos.map(renderOmitido).join('');
            }
            return;
        }
        if (activeTab === 'whitelist') {
            const fab = `<button onclick="ControlBotPage.activarIA()" class="fab" style="position:fixed; bottom:80px; right:16px; z-index:100; width:48px; height:48px; border-radius:50%; background:#a855f7; color:white; border:none; box-shadow:0 4px 12px rgba(0,0,0,0.2); font-size:1.1em; cursor:pointer;"><i class="fas fa-plus"></i></button>`;
            if (!whitelist.length) {
                c.innerHTML = fab + `<div class="empty-state"><i class="fas fa-robot"></i><p>Sin chats con IA activa</p></div>`;
            } else {
                c.innerHTML = fab + whitelist.map(renderWhitelistItem).join('');
            }
            return;
        }
        if (activeTab === 'zonas') {
            const caidas = zonas.filter(z => z.caida);
            const ok = zonas.filter(z => !z.caida);
            if (!zonas.length) {
                c.innerHTML = `<div class="empty-state"><i class="fas fa-map-marker-alt"></i><p>Sin zonas registradas</p></div>`;
                return;
            }
            let html = '';
            if (caidas.length) {
                html += `<div style="font-size:0.78em; color:#dc3545; font-weight:600; margin:4px 0 6px;"><i class="fas fa-exclamation-circle"></i> EN CAÍDA (${caidas.length})</div>`;
                html += caidas.map(renderZona).join('');
            }
            if (ok.length) {
                html += `<div style="font-size:0.78em; color:#16a34a; font-weight:600; margin:10px 0 6px;"><i class="fas fa-check-circle"></i> NORMAL (${ok.length})</div>`;
                html += ok.map(renderZona).join('');
            }
            c.innerHTML = html;
        }
    }

    function showToast(msg, type='info') {
        let t = document.getElementById('toast');
        if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
        t.className = 'toast show ' + type;
        t.textContent = msg;
        setTimeout(() => t.classList.remove('show'), 2500);
    }

    async function loadZonas() {
        try {
            const data = await API.get('/api/ia-zonas');
            zonas = data?.zonas || [];
            return !data?.error;
        } catch { zonas = []; return false; }
    }

    async function loadWhitelist() {
        try {
            const data = await API.get('/api/ia-whitelist');
            whitelist = data?.chats || [];
        } catch { whitelist = []; }
    }

    async function loadOmitidos() {
        try {
            const data = await API.get('/api/omitted-numbers');
            omitidos = data?.numeros || data?.data || (Array.isArray(data) ? data : []);
        } catch { omitidos = []; }
    }

    function activarIA() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const lbl = 'display:block; font-size:0.78em; font-weight:600; color:#555; margin-bottom:4px;';
        const inp = 'width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:12px; font-size:0.95em;';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3><i class="fas fa-robot"></i> Activar IA en chat</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <label style="${lbl}">Número (con código país, sin +)</label>
                    <input type="tel" id="ia-num" placeholder="573001234567" style="${inp}">
                    <label style="${lbl}">Nombre cliente (opcional)</label>
                    <input type="text" id="ia-nom" placeholder="Nombre" style="${inp}">
                    <label style="${lbl}">Notas (opcional)</label>
                    <textarea id="ia-not" rows="2" placeholder="Motivo / contexto" style="${inp} font-family:inherit;"></textarea>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="ia-save"><i class="fas fa-check"></i> Activar IA</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.querySelector('#ia-save').onclick = async () => {
            const num = overlay.querySelector('#ia-num').value.replace(/\D/g, '');
            const nombre = overlay.querySelector('#ia-nom').value.trim();
            const notas = overlay.querySelector('#ia-not').value.trim();
            if (!num || num.length < 10) return showToast('Número inválido', 'error');
            const chatId = `${num}@c.us`;
            try {
                await API.post('/api/ia-whitelist/activar', { chatId, telefono: num, nombre, activado_por: 'admin-app', notas });
                showToast('IA activada ✓', 'success');
                overlay.remove();
                await loadWhitelist();
                renderList();
            } catch (err) { showToast('Error: ' + err.message, 'error'); }
        };
    }

    async function agregarOmitido() {
        const numero = prompt('Número a omitir (con código país, sin +):');
        if (!numero) return;
        const clean = numero.replace(/\D/g, '');
        if (clean.length < 10) return showToast('Número inválido', 'error');
        const motivo = prompt('Motivo (opcional):', '');
        try {
            await API.post('/api/omitted-numbers', { numero: clean, motivo: motivo || '' });
            showToast('Número agregado a omitidos', 'success');
            await loadOmitidos();
            renderList();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function quitarOmitido(id) {
        if (!confirm('¿Quitar este número de la lista de omitidos?')) return;
        try {
            await API.del(`/api/omitted-numbers/${id}`);
            showToast('Quitado', 'success');
            await loadOmitidos();
            renderList();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    function editarZona(id) {
        const z = zonas.find(x => x.id === id);
        if (!z) return;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const lbl = 'display:block; font-size:0.78em; font-weight:600; color:#555; margin-bottom:4px;';
        const inp = 'width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:12px; font-size:0.95em;';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3><i class="fas fa-edit"></i> Editar zona ${escapeHtml(z.nombre || z.id)}</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <label style="${lbl}">Nombre</label>
                    <input type="text" id="ez-nombre" value="${escapeHtml(z.nombre || '')}" style="${inp}">
                    <label style="${lbl}">Rango IP</label>
                    <input type="text" id="ez-rango" value="${escapeHtml(z.rango_ip || '')}" style="${inp} font-family:monospace;">
                    <label style="${lbl}">Keywords dirección (separadas por coma)</label>
                    <input type="text" id="ez-keys" value="${escapeHtml((z.keywords_direccion || []).join(', '))}" style="${inp}">
                    <label style="${lbl}">Costo instalación COP</label>
                    <input type="number" id="ez-costo" value="${z.costo_instalacion_cop || 0}" style="${inp}">
                    <label style="${lbl}">Mensaje custom en caída (opcional)</label>
                    <textarea id="ez-msg" rows="3" style="${inp} font-family:inherit;">${escapeHtml(z.mensaje_caida_custom || '')}</textarea>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="ez-save"><i class="fas fa-save"></i> Guardar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.querySelector('#ez-save').onclick = async () => {
            const data = {
                nombre: overlay.querySelector('#ez-nombre').value.trim(),
                rango_ip: overlay.querySelector('#ez-rango').value.trim(),
                keywords_direccion: overlay.querySelector('#ez-keys').value.split(',').map(s => s.trim()).filter(Boolean),
                costo_instalacion_cop: parseInt(overlay.querySelector('#ez-costo').value) || 0,
                mensaje_caida_custom: overlay.querySelector('#ez-msg').value.trim() || null,
            };
            try {
                await API.put(`/api/ia-zonas/${id}`, data);
                showToast('Zona actualizada ✓', 'success');
                overlay.remove();
                await loadZonas();
                renderList();
            } catch (err) { showToast('Error: ' + err.message, 'error'); }
        };
    }

    async function marcarCaida(id, nombre) {
        const tecnico = prompt(`Marcar caída en "${nombre}"\n\nTécnico asignado (opcional):`, '');
        if (tecnico === null) return;
        try {
            await API.post(`/api/ia-zonas/${id}/caida`, { tecnico_asignado: tecnico || null });
            showToast(`Caída registrada: ${nombre}`, 'success');
            await loadZonas();
            renderList();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function resolver(id, nombre) {
        if (!confirm(`Resolver caída de "${nombre}"?\n\nSe enviará notificación a los clientes afectados.`)) return;
        try {
            const r = await API.post(`/api/ia-zonas/${id}/resolver`, {});
            const noti = r?.notificacion_masiva;
            showToast(noti ? `Resuelta · ${noti.enviados} notificados` : 'Resuelta', 'success');
            await loadZonas();
            renderList();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function desactivarIA(chatId) {
        if (!confirm('¿Desactivar modo IA para este chat?')) return;
        try {
            await API.post('/api/ia-whitelist/desactivar', { chatId });
            showToast('IA desactivada', 'success');
            await loadWhitelist();
            renderList();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    function show() {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const main = document.querySelector('.app-main');
        let page = document.getElementById('page-control-bot');
        if (!page) {
            page = document.createElement('div');
            page.id = 'page-control-bot';
            page.className = 'page';
            main.appendChild(page);
        }
        page.classList.add('active');
        page.innerHTML = `
            <button onclick="ControlBotPage.abrirConfigIA()" style="width:100%; padding:10px; margin-bottom:8px; background:linear-gradient(135deg,#a855f7,#7c3aed); color:white; border:none; border-radius:10px; font-weight:600; font-size:0.85em; cursor:pointer;">
                <i class="fas fa-cog"></i> Configuración del bot IA (modelo, prompt, empresa, reglas, anti-baneo)
            </button>
            <div class="tabs-bar">
                <button class="tab-btn ${activeTab === 'zonas' ? 'active' : ''}" data-tab="zonas"><i class="fas fa-map-marker-alt"></i> Zonas <span class="count">0</span></button>
                <button class="tab-btn ${activeTab === 'whitelist' ? 'active' : ''}" data-tab="whitelist"><i class="fas fa-robot"></i> IA <span class="count">0</span></button>
                <button class="tab-btn ${activeTab === 'omitidos' ? 'active' : ''}" data-tab="omitidos"><i class="fas fa-ban"></i> Omitidos <span class="count">0</span></button>
            </div>
            <div id="control-bot-list" style="margin-top:6px;">
                <div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>
            </div>
        `;
        page.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                activeTab = btn.dataset.tab;
                if (activeTab === 'omitidos' && !omitidos.length) await loadOmitidos();
                renderList();
            });
        });
        (async () => {
            const ok = await loadZonas();
            await loadWhitelist();
            await loadOmitidos();
            if (!ok && !whitelist.length && !omitidos.length) {
                document.getElementById('control-bot-list').innerHTML = `<div class="empty-state" style="padding:40px 20px;">
                    <i class="fas fa-lock" style="color:#dc3545; font-size:2.5em; margin-bottom:10px;"></i>
                    <p style="font-weight:600;">Sin acceso al Control del Bot</p>
                    <p style="font-size:0.85em; margin-top:6px;">Servicio IA no disponible o sin permisos.</p>
                </div>`;
                return;
            }
            renderList();
        })();
    }

    async function abrirConfigIA() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:94vh;">
                <div class="modal-header"><h3><i class="fas fa-cog"></i> Configuración IA</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <div style="text-align:center; padding:20px;"><i class="fas fa-spinner fa-spin"></i> Cargando configuración…</div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();

        let status = null, promptData = null;
        try {
            [status, promptData] = await Promise.all([
                API.get('/api/ia-status').catch(() => ({ disponible:false })),
                API.get('/api/ia-prompt').catch(() => ({ actual:'' })),
            ]);
        } catch {}

        if (!status?.disponible) {
            overlay.querySelector('.modal-body').innerHTML = `
                <div class="empty-state" style="padding:30px;">
                    <i class="fas fa-exclamation-triangle" style="color:#dc3545;"></i>
                    <p>Servicio IA no disponible</p>
                    <p style="font-size:0.8em; color:#666;">El microservicio del prototipo IA (puerto 3500) no responde.</p>
                </div>
            `;
            return;
        }

        const cfg = status.config || {};
        const emp = cfg.empresa || {};
        const reg = cfg.reglas_negocio || {};
        const ab = cfg.anti_baneo || {};
        const lbl = 'display:block; font-size:0.78em; font-weight:600; color:#555; margin-bottom:4px; margin-top:10px;';
        const inp = 'width:100%; padding:9px; border:1px solid #ddd; border-radius:7px; font-size:0.9em; box-sizing:border-box;';

        overlay.querySelector('.modal-body').innerHTML = `
            <!-- Tabs -->
            <div style="display:flex; gap:4px; overflow-x:auto; border-bottom:2px solid #eee; padding-bottom:6px; margin-bottom:12px;">
                <button class="ia-tab active" data-tab="modelo" style="background:#0066cc; color:white; border:none; padding:6px 10px; border-radius:5px; font-size:0.75em; font-weight:600; cursor:pointer; white-space:nowrap;">🤖 Modelo</button>
                <button class="ia-tab" data-tab="prompt" style="background:#eee; color:#666; border:none; padding:6px 10px; border-radius:5px; font-size:0.75em; cursor:pointer; white-space:nowrap;">📝 Prompt</button>
                <button class="ia-tab" data-tab="empresa" style="background:#eee; color:#666; border:none; padding:6px 10px; border-radius:5px; font-size:0.75em; cursor:pointer; white-space:nowrap;">🏢 Empresa</button>
                <button class="ia-tab" data-tab="horario" style="background:#eee; color:#666; border:none; padding:6px 10px; border-radius:5px; font-size:0.75em; cursor:pointer; white-space:nowrap;">📅 Horario</button>
                <button class="ia-tab" data-tab="reglas" style="background:#eee; color:#666; border:none; padding:6px 10px; border-radius:5px; font-size:0.75em; cursor:pointer; white-space:nowrap;">📋 Reglas</button>
                <button class="ia-tab" data-tab="antiban" style="background:#eee; color:#666; border:none; padding:6px 10px; border-radius:5px; font-size:0.75em; cursor:pointer; white-space:nowrap;">🛡️ Anti-baneo</button>
            </div>

            <!-- TAB Modelo -->
            <div class="ia-section" data-tab="modelo">
                <div style="background:#f0f9ff; padding:8px; border-radius:6px; font-size:0.78em; margin-bottom:10px;">
                    Modelo actual: <b>${escapeHtml(status.modelo || '?')}</b> · Proveedor: <b>${escapeHtml(status.proveedor || '?')}</b>
                </div>
                <label style="${lbl}">Proveedor</label>
                <select id="iac-proveedor" style="${inp}">
                    <option value="gemini" ${cfg.proveedor==='gemini'?'selected':''}>Google Gemini</option>
                    <option value="groq" ${cfg.proveedor==='groq'?'selected':''}>Groq</option>
                    <option value="openai" ${cfg.proveedor==='openai'?'selected':''}>OpenAI</option>
                    <option value="anthropic" ${cfg.proveedor==='anthropic'?'selected':''}>Anthropic Claude</option>
                </select>
                <label style="${lbl}">Modelo</label>
                <input type="text" id="iac-modelo" value="${escapeHtml(cfg.modelo || status.modelo || '')}" style="${inp}">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                    <div>
                        <label style="${lbl}">Temperatura (0-2)</label>
                        <input type="number" id="iac-temp" min="0" max="2" step="0.1" value="${cfg.temperatura ?? 0.7}" style="${inp}">
                    </div>
                    <div>
                        <label style="${lbl}">Max tokens</label>
                        <input type="number" id="iac-maxtok" min="100" max="4000" step="50" value="${cfg.max_tokens ?? 800}" style="${inp}">
                    </div>
                </div>
                ${status.saldo ? `<div style="background:#fffbeb; padding:8px; border-radius:6px; font-size:0.78em; margin-top:10px;">
                    💰 Saldo: <b>${escapeHtml(String(status.saldo.saldo_actual_cop || status.saldo.saldo || '?'))}</b>
                    ${status.saldo.gasto_diario ? ` · Gasto hoy: ${escapeHtml(String(status.saldo.gasto_diario))}` : ''}
                </div>` : ''}
            </div>

            <!-- TAB Prompt -->
            <div class="ia-section" data-tab="prompt" style="display:none;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <b style="font-size:0.85em;">System Prompt</b>
                    <button onclick="ControlBotPage._resetPrompt()" style="background:#fee; color:#dc3545; border:none; padding:5px 10px; border-radius:5px; font-size:0.72em; cursor:pointer;"><i class="fas fa-undo"></i> Default</button>
                </div>
                <textarea id="iac-prompt" rows="14" style="${inp} font-family:monospace; font-size:0.78em; resize:vertical;">${escapeHtml(promptData?.actual || '')}</textarea>
                <div style="background:#eff6ff; font-size:0.72em; color:#1e40af; padding:6px; border-radius:6px; margin-top:6px;">💡 Acá editás las instrucciones de comportamiento de la IA. Cuidado con cambios drásticos.</div>
            </div>

            <!-- TAB Empresa -->
            <div class="ia-section" data-tab="empresa" style="display:none;">
                <label style="${lbl}">Nombre empresa</label>
                <input type="text" id="iac-emp-nombre" value="${escapeHtml(emp.nombre || '')}" style="${inp}">
                <label style="${lbl}">Horario atención</label>
                <input type="text" id="iac-emp-horario" value="${escapeHtml(emp.horario_atencion || '')}" style="${inp}">
                <label style="${lbl}">Página web</label>
                <input type="text" id="iac-emp-web" value="${escapeHtml(emp.pagina_web || '')}" style="${inp}">
                <label style="${lbl}">Portal clientes</label>
                <input type="text" id="iac-emp-portal" value="${escapeHtml(emp.portal_clientes || '')}" style="${inp}">
                <label style="${lbl}">Link registro</label>
                <input type="text" id="iac-emp-registro" value="${escapeHtml(emp.link_registro || '')}" style="${inp}">
                <label style="${lbl}">Link retiro</label>
                <input type="text" id="iac-emp-retiro" value="${escapeHtml(emp.link_retiro || '')}" style="${inp}">
            </div>

            <!-- TAB Horario (calendario laboral) -->
            <div class="ia-section" data-tab="horario" style="display:none;">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                    <div>
                        <label style="${lbl}">Hora inicio (24h)</label>
                        <input type="number" id="iac-hor-inicio" min="0" max="23" value="${(cfg.horario&&Number.isFinite(cfg.horario.hora_inicio))?cfg.horario.hora_inicio:8}" style="${inp}">
                    </div>
                    <div>
                        <label style="${lbl}">Hora cierre (24h)</label>
                        <input type="number" id="iac-hor-fin" min="1" max="24" value="${(cfg.horario&&Number.isFinite(cfg.horario.hora_fin))?cfg.horario.hora_fin:19}" style="${inp}">
                    </div>
                </div>
                <label style="${lbl}">Días de trabajo</label>
                <div id="iac-hor-dias" style="display:flex; gap:5px; flex-wrap:wrap;"></div>
                <label style="${lbl}">Calendario — tocá un día para marcarlo/desmarcarlo fuera de horario</label>
                <div style="background:#eff6ff; font-size:0.72em; color:#1e40af; padding:6px; border-radius:6px; margin-bottom:8px;">🎉 Festivos pre-seleccionados. Los días <b>8 y 22</b> (pago) siempre trabajan. <b>Hoy</b> queda laborable.</div>
                <div style="display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:8px;">
                    <button type="button" onclick="ControlBotPage._horNav(-1)" style="background:#eee; border:none; border-radius:6px; padding:5px 12px; cursor:pointer; font-weight:bold;">‹</button>
                    <div id="iac-hor-mes" style="font-weight:bold; min-width:140px; text-align:center; font-size:0.9em;"></div>
                    <button type="button" onclick="ControlBotPage._horNav(1)" style="background:#eee; border:none; border-radius:6px; padding:5px 12px; cursor:pointer; font-weight:bold;">›</button>
                </div>
                <div id="iac-hor-cal"></div>
                <div style="display:flex; gap:12px; flex-wrap:wrap; justify-content:center; margin-top:10px; font-size:0.72em; color:#555;">
                    <span><span style="display:inline-block;width:12px;height:12px;background:#fed7d7;border:1px solid #e53e3e;border-radius:3px;vertical-align:middle;"></span> Fuera</span>
                    <span><span style="display:inline-block;width:12px;height:12px;background:#fff;border:2px solid #0066cc;border-radius:3px;vertical-align:middle;"></span> Hoy</span>
                </div>
            </div>

            <!-- TAB Reglas -->
            <div class="ia-section" data-tab="reglas" style="display:none;">
                <label style="${lbl}">Plazo máximo de pago (días)</label>
                <input type="number" id="iac-reg-plazo" value="${reg.plazo_pago_dias_maximo ?? 5}" style="${inp}">
                <label style="${lbl}">Tiempo visita técnica (días hábiles)</label>
                <input type="number" id="iac-reg-visita" value="${reg.tiempo_visita_tecnica_dias_habiles ?? 3}" style="${inp}">
                <label style="${lbl}">Permanencia mínima (meses)</label>
                <input type="number" id="iac-reg-permanencia" value="${reg.permanencia_minima_meses ?? 6}" style="${inp}">
                <label style="${lbl}">Formato contraseña WiFi (template)</label>
                <input type="text" id="iac-reg-formato" value="${escapeHtml(reg.formato_contrasena || '')}" style="${inp}">
                <label style="${lbl}">¿Acepta Nequi?</label>
                <select id="iac-reg-nequi" style="${inp}">
                    <option value="true" ${!reg.no_acepta_nequi ? 'selected' : ''}>Sí acepta</option>
                    <option value="false" ${reg.no_acepta_nequi ? 'selected' : ''}>NO acepta</option>
                </select>
                <label style="${lbl}">Zonas de cobertura (una por línea)</label>
                <textarea id="iac-reg-zonas" rows="5" style="${inp} font-family:monospace; font-size:0.8em;">${escapeHtml((reg.zonas_cobertura || []).join('\n'))}</textarea>
            </div>

            <!-- TAB Anti-baneo -->
            <div class="ia-section" data-tab="antiban" style="display:none;">
                <div style="background:#fff7ed; padding:8px; border-radius:6px; font-size:0.78em; color:#9a3412; margin-bottom:10px;">
                    🛡️ Configuración del comportamiento humano para evitar baneos de WhatsApp.
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                    <div>
                        <label style="${lbl}">Pausa lectura mín (ms)</label>
                        <input type="number" id="iac-ab-lecmin" value="${ab.pausa_lectura_min_ms ?? 1500}" style="${inp}">
                    </div>
                    <div>
                        <label style="${lbl}">Pausa lectura máx (ms)</label>
                        <input type="number" id="iac-ab-lecmax" value="${ab.pausa_lectura_max_ms ?? 4000}" style="${inp}">
                    </div>
                    <div>
                        <label style="${lbl}">Ms/caracter mín</label>
                        <input type="number" id="iac-ab-charmin" value="${ab.ms_por_caracter_min ?? 40}" style="${inp}">
                    </div>
                    <div>
                        <label style="${lbl}">Ms/caracter máx</label>
                        <input type="number" id="iac-ab-charmax" value="${ab.ms_por_caracter_max ?? 90}" style="${inp}">
                    </div>
                    <div>
                        <label style="${lbl}">Tiempo escritura max (ms)</label>
                        <input type="number" id="iac-ab-escmax" value="${ab.tiempo_escritura_max_ms ?? 15000}" style="${inp}">
                    </div>
                    <div>
                        <label style="${lbl}">Intervalo mismo chat (ms)</label>
                        <input type="number" id="iac-ab-interv" value="${ab.min_intervalo_mismo_chat_ms ?? 2000}" style="${inp}">
                    </div>
                    <div>
                        <label style="${lbl}">Max msj/min global</label>
                        <input type="number" id="iac-ab-pmin" value="${ab.max_msj_por_minuto ?? 30}" style="${inp}">
                    </div>
                    <div>
                        <label style="${lbl}">Max msj/hora chat</label>
                        <input type="number" id="iac-ab-phora" value="${ab.max_msj_por_hora_chat ?? 20}" style="${inp}">
                    </div>
                    <div>
                        <label style="${lbl}">Bloqueado desde (hr 0-23)</label>
                        <input type="number" id="iac-ab-bloqini" min="0" max="23" value="${ab.horario_bloqueado_inicio ?? 22}" style="${inp}">
                    </div>
                    <div>
                        <label style="${lbl}">Bloqueado hasta (hr 0-23)</label>
                        <input type="number" id="iac-ab-bloqfin" min="0" max="23" value="${ab.horario_bloqueado_fin ?? 7}" style="${inp}">
                    </div>
                </div>
            </div>
            <div style="display:flex; gap:6px; margin-top:16px;">
                <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()" style="flex:1;">Cancelar</button>
                <button class="btn-primary" onclick="ControlBotPage._guardarConfigIA()" style="flex:2;"><i class="fas fa-save"></i> Guardar todo</button>
            </div>
        `;
        // Switch tabs
        overlay.querySelectorAll('.ia-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                overlay.querySelectorAll('.ia-tab').forEach(b => {
                    b.style.background = '#eee'; b.style.color = '#666'; b.classList.remove('active');
                });
                btn.style.background = '#0066cc'; btn.style.color = 'white'; btn.classList.add('active');
                overlay.querySelectorAll('.ia-section').forEach(s => s.style.display = 'none');
                overlay.querySelector(`.ia-section[data-tab="${btn.dataset.tab}"]`).style.display = '';
            });
        });

        // 🆕 v2026-06-14: inicializa estado del calendario laboral
        const h = cfg.horario || {};
        _horApp = {
            dias_trabajo: Array.isArray(h.dias_trabajo) && h.dias_trabajo.length ? h.dias_trabajo.slice() : [1,2,3,4,5,6],
            hora_inicio: Number.isFinite(h.hora_inicio) ? h.hora_inicio : 8,
            hora_fin: Number.isFinite(h.hora_fin) ? h.hora_fin : 19,
            dias_cerrados: new Set(Array.isArray(h.dias_cerrados) ? h.dias_cerrados : []),
            mes: null,
        };
        _horRenderDias();
        _horRenderCal();
    }

    // ============================================================
    // 🆕 v2026-06-14: CALENDARIO LABORAL (app admin)
    // ============================================================
    let _horApp = { dias_trabajo:[1,2,3,4,5,6], hora_inicio:8, hora_fin:19, dias_cerrados:new Set(), mes:null };

    function _horFestivos(year){
        const set=new Set();
        const fmt=(y,m,d)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const trasLunes=(dt)=>{const dow=dt.getUTCDay();if(dow===1)return dt;const f=(8-dow)%7;dt.setUTCDate(dt.getUTCDate()+f);return dt;};
        const fijo=(m,d)=>set.add(fmt(year,m,d));
        const emil=(m,d)=>{const dt=trasLunes(new Date(Date.UTC(year,m-1,d,12)));set.add(fmt(dt.getUTCFullYear(),dt.getUTCMonth()+1,dt.getUTCDate()));};
        fijo(1,1);fijo(5,1);fijo(7,20);fijo(8,7);fijo(12,8);fijo(12,25);
        emil(1,6);emil(3,19);emil(6,29);emil(8,15);emil(10,12);emil(11,1);emil(11,11);
        const a=year%19,b=Math.floor(year/100),c=year%100,d2=Math.floor(b/4),e=b%4,f2=Math.floor((b+8)/25),g=Math.floor((b-f2+1)/3);
        const h2=(19*a+b-d2-g+15)%30,i2=Math.floor(c/4),k=c%4,l=(32+2*e+2*i2-h2-k)%7,m2=Math.floor((a+11*h2+22*l)/451);
        const mes=Math.floor((h2+l-7*m2+114)/31),dia=((h2+l-7*m2+114)%31)+1;
        const pascua=new Date(Date.UTC(year,mes-1,dia,12));
        const addP=(n,t)=>{const dt=new Date(pascua.getTime());dt.setUTCDate(dt.getUTCDate()+n);if(t)trasLunes(dt);set.add(fmt(dt.getUTCFullYear(),dt.getUTCMonth()+1,dt.getUTCDate()));};
        addP(-3,false);addP(-2,false);addP(39,true);addP(60,true);addP(68,true);
        return set;
    }
    function _horISO(y,m,d){ return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
    function _horHoy(){ const b=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Bogota'})); return _horISO(b.getFullYear(),b.getMonth()+1,b.getDate()); }

    function _horRenderDias(){
        const cont=document.getElementById('iac-hor-dias'); if(!cont) return;
        const nombres=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
        cont.innerHTML='';
        [1,2,3,4,5,6,0].forEach(d=>{
            const on=_horApp.dias_trabajo.includes(d);
            const b=document.createElement('button');
            b.type='button'; b.textContent=nombres[d];
            b.style.cssText=`padding:7px 11px;border-radius:7px;cursor:pointer;font-weight:600;font-size:0.8em;border:2px solid ${on?'#16a34a':'#cbd5e0'};background:${on?'#dcfce7':'#fff'};color:${on?'#15803d':'#999'};`;
            b.onclick=()=>{ const i=_horApp.dias_trabajo.indexOf(d); if(i>=0)_horApp.dias_trabajo.splice(i,1); else _horApp.dias_trabajo.push(d); _horRenderDias(); _horRenderCal(); };
            cont.appendChild(b);
        });
    }

    function _horNav(delta){
        if(!_horApp.mes){const b=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Bogota'}));_horApp.mes={y:b.getFullYear(),m:b.getMonth()+1};}
        let {y,m}=_horApp.mes; m+=delta; if(m<1){m=12;y--;} if(m>12){m=1;y++;}
        _horApp.mes={y,m}; _horRenderCal();
    }

    function _horDia(iso){
        const dd=parseInt(iso.slice(8,10),10);
        if(dd===8||dd===22){ showToast('Los días 8 y 22 (pago) siempre se trabaja','info'); return; }
        if(_horApp.dias_cerrados.has(iso)) _horApp.dias_cerrados.delete(iso); else _horApp.dias_cerrados.add(iso);
        _horRenderCal();
    }

    function _horRenderCal(){
        const cont=document.getElementById('iac-hor-cal'); if(!cont) return;
        if(!_horApp.mes){const b=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Bogota'}));_horApp.mes={y:b.getFullYear(),m:b.getMonth()+1};}
        const {y,m}=_horApp.mes;
        const meses=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const tit=document.getElementById('iac-hor-mes'); if(tit) tit.textContent=`${meses[m-1]} ${y}`;
        const festivos=_horFestivos(y);
        const hoy=_horHoy();
        const offset=(new Date(y,m-1,1).getDay()+6)%7;
        const diasMes=new Date(y,m,0).getDate();
        const cab=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
        let html='<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;">';
        cab.forEach(c=>html+=`<div style="text-align:center;font-size:0.68em;color:#888;font-weight:bold;">${c}</div>`);
        for(let i=0;i<offset;i++) html+='<div></div>';
        for(let d=1;d<=diasMes;d++){
            const iso=_horISO(y,m,d);
            const dow=new Date(y,m-1,d).getDay();
            const esFest=festivos.has(iso), es822=(d===8||d===22);
            const diaSemLab=_horApp.dias_trabajo.includes(dow);
            const cerrado=_horApp.dias_cerrados.has(iso);
            const laborable= es822 ? true : (diaSemLab && !cerrado);
            const esHoy=(iso===hoy);
            const bg=laborable?'#fff':'#fed7d7';
            const bc=esHoy?'#0066cc':(laborable?'#e2e8f0':'#e53e3e');
            const bw=esHoy?'2px':'1px';
            let col=laborable?'#2d3748':'#c53030'; if(!diaSemLab&&!es822)col='#a0aec0';
            const marca=es822?'💵':(esFest?'🎉':'');
            html+=`<div onclick="ControlBotPage._horDia('${iso}')" style="cursor:pointer;text-align:center;padding:5px 1px;border-radius:6px;background:${bg};border:${bw} solid ${bc};color:${col};font-size:0.8em;user-select:none;">`;
            html+=`<div style="font-weight:${esHoy?'bold':'normal'};">${d}</div>`;
            if(marca) html+=`<div style="font-size:0.62em;line-height:1;">${marca}</div>`;
            html+='</div>';
        }
        html+='</div>';
        cont.innerHTML=html;
    }

    async function _guardarConfigIA() {
        const $ = (id) => document.getElementById(id);
        const config = {
            proveedor: $('iac-proveedor').value,
            modelo: $('iac-modelo').value,
            temperatura: parseFloat($('iac-temp').value),
            max_tokens: parseInt($('iac-maxtok').value),
            empresa: {
                nombre: $('iac-emp-nombre').value,
                horario_atencion: $('iac-emp-horario').value,
                pagina_web: $('iac-emp-web').value,
                portal_clientes: $('iac-emp-portal').value,
                link_registro: $('iac-emp-registro').value,
                link_retiro: $('iac-emp-retiro').value,
            },
            reglas_negocio: {
                plazo_pago_dias_maximo: parseInt($('iac-reg-plazo').value),
                tiempo_visita_tecnica_dias_habiles: parseInt($('iac-reg-visita').value),
                permanencia_minima_meses: parseInt($('iac-reg-permanencia').value),
                no_acepta_nequi: $('iac-reg-nequi').value !== 'true',
                formato_contrasena: $('iac-reg-formato').value,
                zonas_cobertura: $('iac-reg-zonas').value.split('\n').map(s => s.trim()).filter(Boolean),
            },
            anti_baneo: {
                habilitado: true,
                pausa_lectura_min_ms: parseInt($('iac-ab-lecmin').value),
                pausa_lectura_max_ms: parseInt($('iac-ab-lecmax').value),
                ms_por_caracter_min: parseInt($('iac-ab-charmin').value),
                ms_por_caracter_max: parseInt($('iac-ab-charmax').value),
                tiempo_escritura_max_ms: parseInt($('iac-ab-escmax').value),
                min_intervalo_mismo_chat_ms: parseInt($('iac-ab-interv').value),
                max_msj_por_minuto: parseInt($('iac-ab-pmin').value),
                max_msj_por_hora_chat: parseInt($('iac-ab-phora').value),
                horario_bloqueado_inicio: parseInt($('iac-ab-bloqini').value),
                horario_bloqueado_fin: parseInt($('iac-ab-bloqfin').value),
            },
            horario: {
                dias_trabajo: _horApp.dias_trabajo.slice().sort((a,b)=>a-b),
                hora_inicio: parseInt($('iac-hor-inicio').value),
                hora_fin: parseInt($('iac-hor-fin').value),
                dias_cerrados: Array.from(_horApp.dias_cerrados).sort(),
            },
        };
        const prompt = $('iac-prompt').value;
        try {
            await API.post('/api/ia-config', config);
            await API.post('/api/ia-prompt', { prompt });
            showToast('✓ Configuración guardada', 'success');
            document.querySelector('.modal-overlay')?.remove();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function _resetPrompt() {
        if (!confirm('¿Resetear el system prompt al default?')) return;
        try {
            await API.post('/api/ia-prompt/reset', {});
            const pr = await API.get('/api/ia-prompt');
            const ta = document.getElementById('iac-prompt');
            if (ta) ta.value = pr?.actual || '';
            showToast('Prompt reseteado', 'success');
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    return { show, marcarCaida, resolver, desactivarIA, activarIA, agregarOmitido, quitarOmitido, editarZona, abrirConfigIA, _guardarConfigIA, _resetPrompt, _horNav, _horDia };
})();

if (typeof Router !== 'undefined') Router.register('control-bot', () => ControlBotPage.show());
