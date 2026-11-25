// 🆕 Página: Gestión de Usuarios (solo admin)
const UsuariosPage = (function() {
    let usuarios = [];
    let searchTerm = '';

    const PERMISOS_GRUPOS = [
        {
            grupo: 'Visitas técnicas',
            items: {
                ver_visitas: 'Ver visitas',
                agregar_visitas: 'Crear visitas',
                editar_visitas: 'Editar visitas',
                eliminar_visitas: 'Eliminar visitas',
                ver_reportes: 'Ver reportes',
            }
        },
        {
            grupo: 'Inventario',
            items: {
                ver_inventario: 'Ver inventario',
                agregar_inventario: 'Agregar material',
                editar_inventario: 'Editar material',
                eliminar_inventario: 'Eliminar material',
                ver_equipos_retirados: 'Ver equipos retirados',
            }
        },
        {
            grupo: 'Chats',
            items: {
                ver_historial_chat: 'Ver historial chats',
                enviar_mensajes: 'Enviar mensajes',
            }
        },
        {
            grupo: 'Cobranza',
            items: {
                ver_cobranza: 'Ver cobranza',
                gestionar_cobranza: 'Gestionar cobranza',
            }
        },
        {
            grupo: 'OLT / GestorOLT',
            items: {
                ver_olt: 'Ver OLT',
                gestionar_olt: 'Gestionar OLT',
            }
        },
        {
            grupo: 'TR-069',
            items: {
                ver_tr069: 'Ver TR-069',
                gestionar_tr069: 'Gestionar TR-069',
            }
        },
        {
            grupo: 'Sistema',
            items: {
                gestionar_usuarios: 'Gestionar usuarios',
                reiniciar_servidor: 'Reiniciar servidor',
                ver_clientes_mapa: 'Ver clientes en mapa',
            }
        },
        {
            grupo: 'Mapa Universal',
            items: {
                ver_mapa_universal: 'Ver mapa universal',
            }
        },
        {
            grupo: 'Mapa de Enrutamiento',
            items: {
                ver_mapa_enrutamiento: 'Ver mapa de enrutamiento',
                editar_mapa_enrutamiento: 'Editar cajas, rutas y clientes',
            }
        },
    ];

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    }

    function renderUsuario(u) {
        const rolColor = u.rol === 'admin' ? '#dc3545' : u.rol === 'tecnico' ? '#16a34a' : '#0066cc';
        const activo = u.activo === 1 || u.activo === true;
        return `
            <div data-id="${u.id}" class="usuario-card" style="background:white; border-radius:12px; padding:12px; margin-bottom:6px; box-shadow:0 1px 2px rgba(0,0,0,0.04); border-left:3px solid ${activo ? rolColor : '#999'}; cursor:pointer; opacity:${activo ? 1 : 0.55};">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:0.92em;">${escapeHtml(u.nombre || u.username || '?')}</div>
                        <div style="font-size:0.75em; color:#666; margin-top:2px;">@${escapeHtml(u.username || '?')}</div>
                        ${u.ultimo_acceso ? `<div style="font-size:0.72em; color:#999; margin-top:2px;">Último acceso: ${new Date(u.ultimo_acceso).toLocaleString('es-CO', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}</div>` : ''}
                    </div>
                    <div style="text-align:right; flex-shrink:0;">
                        <span style="background:${rolColor}22; color:${rolColor}; font-size:0.7em; font-weight:600; padding:3px 8px; border-radius:8px; text-transform:uppercase;">${escapeHtml(u.rol || '')}</span>
                        ${!activo ? '<div style="font-size:0.68em; color:#999; margin-top:3px;">INACTIVO</div>' : ''}
                    </div>
                </div>
            </div>
        `;
    }

    function applyFiltros() {
        let lista = usuarios;
        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            lista = lista.filter(u =>
                (u.nombre || '').toLowerCase().includes(q) ||
                (u.username || '').toLowerCase().includes(q) ||
                (u.rol || '').toLowerCase().includes(q)
            );
        }
        return lista;
    }

    function renderList() {
        const lista = applyFiltros();
        const c = document.getElementById('usuarios-list-container');
        if (!c) return;
        document.getElementById('usuarios-count').textContent = `${lista.length} usuarios`;
        if (!lista.length) {
            c.innerHTML = `<div class="empty-state"><i class="fas fa-users"></i><p>Sin usuarios</p></div>`;
            return;
        }
        c.innerHTML = lista.map(renderUsuario).join('');
        c.querySelectorAll('.usuario-card').forEach(el => {
            el.addEventListener('click', () => {
                const u = usuarios.find(x => x.id === parseInt(el.dataset.id));
                if (u) openEditor(u);
            });
        });
    }

    async function load() {
        const c = document.getElementById('usuarios-list-container');
        if (c) c.innerHTML = `<div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>`;
        try {
            const data = await API.get('/api/usuarios');
            if (data?.success === false) {
                if (c) c.innerHTML = `<div class="empty-state" style="padding:40px 20px;">
                    <i class="fas fa-lock" style="color:#dc3545; font-size:2.5em; margin-bottom:10px;"></i>
                    <p style="font-weight:600;">${escapeHtml(data.message)}</p>
                    <p style="font-size:0.85em; margin-top:6px;">Solo administradores pueden ver esta sección.</p>
                </div>`;
                return;
            }
            usuarios = data?.usuarios || (Array.isArray(data) ? data : []);
            renderList();
        } catch (err) {
            if (c) c.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle" style="color:#dc3545;"></i><p>Error: ${escapeHtml(err.message)}</p></div>`;
        }
    }

    function openEditor(user = null) {
        const isEdit = !!user;
        const permisos = user?.permisos ? (typeof user.permisos === 'string' ? JSON.parse(user.permisos || '{}') : user.permisos) : {};

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const grupos = PERMISOS_GRUPOS.map(g => `
            <div style="margin-bottom:12px;">
                <div style="font-weight:600; font-size:0.85em; color:#0066cc; margin-bottom:6px;">${escapeHtml(g.grupo)}</div>
                ${Object.entries(g.items).map(([k, label]) => `
                    <label style="display:flex; align-items:center; gap:8px; padding:6px 0; font-size:0.88em; cursor:pointer;">
                        <input type="checkbox" data-permiso="${k}" ${permisos[k] ? 'checked' : ''} style="width:18px; height:18px;">
                        <span>${escapeHtml(label)}</span>
                    </label>
                `).join('')}
            </div>
        `).join('');

        overlay.innerHTML = `
            <div class="modal-content" style="max-height:94vh;">
                <div class="modal-header">
                    <h3><i class="fas fa-user-${isEdit ? 'edit' : 'plus'}"></i> ${isEdit ? 'Editar usuario' : 'Nuevo usuario'}</h3>
                    <button class="icon-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body" style="padding:16px;">
                    <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Usuario *</label>
                    <input type="text" id="u-username" value="${escapeHtml(user?.username || '')}" ${isEdit ? 'disabled' : ''} maxlength="50" style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; margin-bottom:12px; ${isEdit ? 'background:#f5f6f7;' : ''}">

                    <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Nombre completo *</label>
                    <input type="text" id="u-nombre" value="${escapeHtml(user?.nombre || '')}" maxlength="100" style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; margin-bottom:12px;">

                    <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Rol *</label>
                    <select id="u-rol" style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; margin-bottom:12px;">
                        <option value="admin" ${user?.rol === 'admin' ? 'selected' : ''}>Administrador</option>
                        <option value="soporte" ${user?.rol === 'soporte' ? 'selected' : ''}>Soporte</option>
                        <option value="tecnico" ${user?.rol === 'tecnico' ? 'selected' : ''}>Técnico</option>
                    </select>

                    ${isEdit ? '' : `
                        <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Contraseña *</label>
                        <input type="password" id="u-password" placeholder="Mínimo 6 caracteres" style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; margin-bottom:12px;">
                    `}

                    <label style="display:flex; align-items:center; gap:8px; padding:6px 0; margin-bottom:14px;">
                        <input type="checkbox" id="u-activo" ${(user?.activo === 1 || user?.activo === true || !isEdit) ? 'checked' : ''} style="width:18px; height:18px;">
                        <span style="font-size:0.92em;">Usuario activo</span>
                    </label>

                    <div style="border-top:1px solid var(--border); padding-top:14px; margin-top:8px;">
                        <div style="font-weight:600; font-size:0.95em; margin-bottom:10px;"><i class="fas fa-key" style="color:#f59e0b;"></i> Permisos</div>
                        <div style="display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap;">
                            <button type="button" class="plantilla-btn" data-plantilla="admin" style="flex:1; padding:8px; background:#dcfce7; color:#166534; border:none; border-radius:6px; font-size:0.78em; font-weight:600; cursor:pointer;"><i class="fas fa-magic"></i> Admin</button>
                            <button type="button" class="plantilla-btn" data-plantilla="soporte" style="flex:1; padding:8px; background:#dbeafe; color:#1e40af; border:none; border-radius:6px; font-size:0.78em; font-weight:600; cursor:pointer;"><i class="fas fa-magic"></i> Soporte</button>
                            <button type="button" class="plantilla-btn" data-plantilla="tecnico" style="flex:1; padding:8px; background:#fef3c7; color:#92400e; border:none; border-radius:6px; font-size:0.78em; font-weight:600; cursor:pointer;"><i class="fas fa-magic"></i> Técnico</button>
                        </div>
                        ${grupos}
                    </div>
                </div>
                <div class="modal-footer" style="flex-wrap:wrap; gap:6px;">
                    ${isEdit ? `
                        <button class="btn-secondary" id="u-pwd-btn"><i class="fas fa-key"></i> Cambiar contraseña</button>
                        <button class="btn-secondary" style="background:#fee; color:#dc3545;" id="u-delete-btn"><i class="fas fa-trash"></i> Eliminar</button>
                    ` : ''}
                    <button class="btn-primary" id="u-save-btn"><i class="fas fa-save"></i> Guardar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        // Aplicar plantilla de permisos
        const PLANTILLAS = {
            admin: { ver_visitas:true, agregar_visitas:true, editar_visitas:true, eliminar_visitas:true, ver_reportes:true, ver_inventario:true, agregar_inventario:true, editar_inventario:true, eliminar_inventario:true, ver_equipos_retirados:true, gestionar_usuarios:true, ver_historial_chat:true, enviar_mensajes:true, reiniciar_servidor:true, ver_cobranza:true, gestionar_cobranza:true, ver_olt:true, gestionar_olt:true, ver_tr069:true, gestionar_tr069:true, ver_ssgt:true, agregar_ssgt:true, editar_ssgt:true, eliminar_ssgt:true, ver_finanzas:true, agregar_finanzas:true, editar_finanzas:true, eliminar_finanzas:true, ver_clientes_mapa:true, ver_cajas_nap:true, ver_isp_guardian:true, gestionar_mikrotik:true, gestionar_qos:true, gestionar_monitoreo:true, gestionar_blacklist:true, gestionar_alertas:true, gestionar_notif_onu:true, ver_mapa_universal:true, ver_mapa_enrutamiento:true, editar_mapa_enrutamiento:true, ver_portal_cautivo:true, gestionar_portal_cautivo:true },
            soporte: { ver_visitas:true, ver_historial_chat:true, enviar_mensajes:true, ver_ssgt:true, ver_finanzas:true, ver_isp_guardian:true, ver_mapa_universal:true, ver_mapa_enrutamiento:true, ver_portal_cautivo:true },
            tecnico: { ver_visitas:true, agregar_visitas:true, editar_visitas:true, ver_ssgt:true, agregar_ssgt:true, ver_finanzas:true, agregar_finanzas:true }
        };
        overlay.querySelectorAll('.plantilla-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const plantilla = PLANTILLAS[btn.dataset.plantilla] || {};
                overlay.querySelectorAll('input[data-permiso]').forEach(cb => {
                    cb.checked = plantilla[cb.dataset.permiso] === true;
                });
                showToast(`Plantilla ${btn.dataset.plantilla} aplicada`, 'success');
            });
        });

        document.getElementById('u-save-btn').addEventListener('click', async () => {
            const payload = {
                username: document.getElementById('u-username').value.trim(),
                nombre: document.getElementById('u-nombre').value.trim(),
                rol: document.getElementById('u-rol').value,
                activo: document.getElementById('u-activo').checked ? 1 : 0,
            };
            if (!isEdit) payload.password = document.getElementById('u-password').value;

            // Permisos
            const permsObj = {};
            overlay.querySelectorAll('input[data-permiso]').forEach(cb => {
                permsObj[cb.dataset.permiso] = cb.checked;
            });

            if (!payload.username || !payload.nombre) { showToast('Completa los campos requeridos', 'error'); return; }
            if (!isEdit && !payload.password) { showToast('Contraseña requerida', 'error'); return; }

            const btn = document.getElementById('u-save-btn');
            btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            try {
                if (isEdit) {
                    await API.put(`/api/usuarios/${user.id}`, payload);
                    await API.put(`/api/usuarios/${user.id}/permisos`, { permisos: permsObj });
                } else {
                    const created = await API.post('/api/usuarios', payload);
                    const newId = created?.id || created?.usuario?.id;
                    if (newId) await API.put(`/api/usuarios/${newId}/permisos`, { permisos: permsObj });
                }
                showToast(isEdit ? 'Actualizado' : 'Creado', 'success');
                overlay.remove();
                load();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
                btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
            }
        });

        const pwdBtn = document.getElementById('u-pwd-btn');
        if (pwdBtn) pwdBtn.addEventListener('click', () => {
            const nueva = prompt('Nueva contraseña (mínimo 6 caracteres):');
            if (!nueva || nueva.length < 6) { showToast('Mínimo 6 caracteres', 'error'); return; }
            API.put(`/api/usuarios/${user.id}/password`, { password: nueva })
                .then(() => showToast('Contraseña actualizada', 'success'))
                .catch(err => showToast('Error: ' + err.message, 'error'));
        });

        const delBtn = document.getElementById('u-delete-btn');
        if (delBtn) delBtn.addEventListener('click', async () => {
            if (!confirm(`¿Eliminar al usuario "${user.username}"? No se puede deshacer.`)) return;
            try {
                await API.del(`/api/usuarios/${user.id}`);
                showToast('Eliminado', 'success');
                overlay.remove();
                load();
            } catch (err) { showToast('Error: ' + err.message, 'error'); }
        });
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
        let page = document.getElementById('page-usuarios');
        if (!page) {
            page = document.createElement('div');
            page.id = 'page-usuarios';
            page.className = 'page';
            main.appendChild(page);
        }
        page.classList.add('active');
        page.innerHTML = `
            <div style="background:white; padding:10px; border-radius:12px; margin-bottom:8px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                <input type="text" id="usuarios-buscar" placeholder="Buscar usuario..." style="width:100%; padding:8px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.9em;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; gap:6px;">
                    <span id="usuarios-count" style="font-size:0.78em; color:#666; flex:1;">…</span>
                    <button onclick="UsuariosPage.verPermisosNap()" style="background:#0066cc; color:white; border:none; padding:6px 10px; border-radius:6px; font-size:0.72em; font-weight:600; cursor:pointer;"><i class="fas fa-network-wired"></i> NAP/Mapa</button>
                    <button onclick="UsuariosPage.verTokenAPI()" style="background:#f59e0b; color:white; border:none; padding:6px 10px; border-radius:6px; font-size:0.72em; font-weight:600; cursor:pointer;"><i class="fas fa-key"></i> Token API</button>
                </div>
            </div>
            <div id="usuarios-list-container"></div>
            <button class="fab" onclick="UsuariosPage.crear()" title="Nuevo usuario">
                <i class="fas fa-user-plus"></i>
            </button>
        `;
        document.getElementById('usuarios-buscar').addEventListener('input', (e) => { searchTerm = e.target.value.trim(); renderList(); });
        load();
    }

    function crear() { openEditor(null); }

    async function verTokenAPI() {
        try {
            const data = await API.get('/api/admin/token-api');
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header"><h3><i class="fas fa-key"></i> Token API permanente</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                    <div class="modal-body" style="padding:14px 18px;">
                        <div style="background:#fffbeb; padding:10px; border-radius:8px; margin-bottom:10px; font-size:0.82em; color:#92400e;">
                            <i class="fas fa-exclamation-triangle"></i> Este token es <b>permanente</b> y da acceso completo a la API. Cuidado al compartirlo.
                        </div>
                        <label style="display:block; font-weight:600; font-size:0.78em; color:#555; margin-bottom:4px;">Token</label>
                        <textarea id="tok-text" rows="4" readonly style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; font-family:monospace; font-size:0.72em; word-break:break-all; box-sizing:border-box;">${escapeHtml(data.token || '')}</textarea>
                        <button onclick="navigator.clipboard.writeText(document.getElementById('tok-text').value); this.innerHTML='<i class=\\'fas fa-check\\'></i> Copiado';" style="margin-top:8px; width:100%; padding:10px; background:#0066cc; color:white; border:none; border-radius:8px; font-size:0.85em; font-weight:600; cursor:pointer;"><i class="fas fa-copy"></i> Copiar</button>
                        <div style="margin-top:14px; font-size:0.78em; color:#666;"><b>Endpoint principal:</b></div>
                        <code style="display:block; background:#f5f6f7; padding:8px; border-radius:6px; font-size:0.72em; word-break:break-all; margin-top:4px;">${escapeHtml(data?.endpoints?.principal || '')}</code>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-primary" onclick="this.closest('.modal-overlay').remove()">Cerrar</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function verPermisosNap() {
        try {
            const data = await API.get('/api/tecnicos-permisos-nap');
            const tecs = data?.tecnicos || [];
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            const rows = tecs.map(t => {
                let permisos = {};
                try { permisos = typeof t.permisos === 'string' ? JSON.parse(t.permisos || '{}') : (t.permisos || {}); } catch {}
                return `
                    <div style="background:white; border-radius:8px; padding:10px; margin-bottom:6px; border-left:3px solid #0066cc;">
                        <div style="font-weight:600; font-size:0.92em;">${escapeHtml(t.nombre || t.username)}</div>
                        <div style="display:flex; flex-direction:column; gap:5px; margin-top:8px;">
                            <label style="display:flex; align-items:center; gap:6px; font-size:0.85em;">
                                <input type="checkbox" class="pnap-check" data-tipo="nap" data-id="${t.id}" ${t.puede_agregar_naps ? 'checked' : ''}>
                                <i class="fas fa-network-wired" style="color:#0066cc;"></i> Puede agregar Cajas NAP
                            </label>
                            <label style="display:flex; align-items:center; gap:6px; font-size:0.85em;">
                                <input type="checkbox" class="pnap-check" data-tipo="clientes_mapa" data-id="${t.id}" ${permisos.ver_clientes_mapa ? 'checked' : ''}>
                                <i class="fas fa-map" style="color:#16a34a;"></i> Ve clientes en el mapa
                            </label>
                            <label style="display:flex; align-items:center; gap:6px; font-size:0.85em;">
                                <input type="checkbox" class="pnap-check" data-tipo="cajas_nap" data-id="${t.id}" ${permisos.ver_cajas_nap ? 'checked' : ''}>
                                <i class="fas fa-cube" style="color:#f59e0b;"></i> Ve cajas NAP en el mapa
                            </label>
                        </div>
                    </div>
                `;
            }).join('');
            overlay.innerHTML = `
                <div class="modal-content" style="max-height:92vh;">
                    <div class="modal-header"><h3><i class="fas fa-network-wired"></i> Permisos técnicos</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                    <div class="modal-body" style="padding:14px 18px;">
                        <div style="background:#eff6ff; padding:8px; border-radius:6px; font-size:0.78em; color:#1e40af; margin-bottom:10px;">
                            <i class="fas fa-info-circle"></i> Marcá las casillas para activar permisos. Los cambios se aplican al guardar.
                        </div>
                        ${tecs.length ? rows : '<div class="empty-state"><p>No hay técnicos activos</p></div>'}
                    </div>
                    <div class="modal-footer">
                        <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cerrar</button>
                        <button class="btn-primary" id="pnap-save"><i class="fas fa-save"></i> Guardar cambios</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.querySelector('.modal-close').onclick = () => overlay.remove();
            overlay.querySelector('#pnap-save').onclick = async () => {
                const checks = [...overlay.querySelectorAll('.pnap-check')];
                const byUser = new Map();
                checks.forEach(c => {
                    const id = c.dataset.id;
                    if (!byUser.has(id)) byUser.set(id, {});
                    byUser.get(id)[c.dataset.tipo] = c.checked;
                });
                let ok = 0, fail = 0;
                for (const [id, vals] of byUser.entries()) {
                    try {
                        // NAP: endpoint dedicado
                        await API.put(`/api/tecnicos/${id}/permiso-nap`, { puede_agregar_naps: vals.nap });
                        // Permisos mapa: vía /permisos
                        await API.put(`/api/usuarios/${id}/permisos`, { permisos: { ver_clientes_mapa: vals.clientes_mapa, ver_cajas_nap: vals.cajas_nap } });
                        ok++;
                    } catch { fail++; }
                }
                showToast(`✓ ${ok} actualizados${fail ? ' · ' + fail + ' error' : ''}`, fail ? 'error' : 'success');
                overlay.remove();
            };
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    return { show, crear, verTokenAPI, verPermisosNap };
})();

if (typeof Router !== 'undefined') Router.register('usuarios', () => UsuariosPage.show());
