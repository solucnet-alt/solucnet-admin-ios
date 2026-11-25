// 🆕 Página: Plantillas CRUD (crear, editar, borrar, ver)
const PlantillasPage = (function() {
    let plantillas = [];

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    }

    function renderItem(p) {
        const preview = (p.mensaje || '').substring(0, 80);
        const archivos = (p.archivos || []).length;
        return `
            <div style="background:white; border-radius:12px; padding:14px; margin-bottom:8px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:0.95em; color:#1a1a1a;">
                            <i class="fas fa-bolt" style="color:#f59e0b;"></i> ${escapeHtml(p.nombre)}
                        </div>
                        ${preview ? `<div style="font-size:0.82em; color:#666; margin-top:4px; line-height:1.3;">${escapeHtml(preview)}${p.mensaje.length > 80 ? '…' : ''}</div>` : ''}
                        ${archivos > 0 ? `<div style="font-size:0.75em; color:#f59e0b; margin-top:4px;"><i class="fas fa-paperclip"></i> ${archivos} archivo${archivos !== 1 ? 's' : ''}</div>` : ''}
                    </div>
                    <div style="display:flex; gap:4px; flex-shrink:0;">
                        <button onclick="PlantillasPage.editar(${p.id})" class="icon-btn" style="background:#e3f2fd; color:#0066cc; width:36px; height:36px;" title="Editar">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="PlantillasPage.borrar(${p.id})" class="icon-btn" style="background:#fee; color:#dc3545; width:36px; height:36px;" title="Eliminar">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderList() {
        const c = document.getElementById('plantillas-list-container');
        if (!c) return;
        if (!plantillas.length) {
            c.innerHTML = `<div class="empty-state"><i class="fas fa-bolt" style="color:#f59e0b;"></i><p>No tenés plantillas creadas.<br>Tocá <b>+</b> para crear una.</p></div>`;
            return;
        }
        c.innerHTML = plantillas.map(renderItem).join('');
    }

    async function load() {
        try {
            const data = await API.get('/api/plantillas');
            plantillas = data?.plantillas || [];
            renderList();
        } catch (err) {
            showToast('Error cargando plantillas', 'error');
        }
    }

    function openEditor(plantilla = null) {
        const isEdit = !!plantilla;
        const archivosExistentes = plantilla ? [...(plantilla.archivos || [])] : [];
        const archivosNuevos = [];

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-height: 92vh;">
                <div class="modal-header">
                    <h3><i class="fas fa-bolt"></i> ${isEdit ? 'Editar plantilla' : 'Nueva plantilla'}</h3>
                    <button class="icon-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body" style="padding: 16px;">
                    <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Nombre</label>
                    <input type="text" id="tpl-nombre" maxlength="120" placeholder="Ej: Saludo, Cobertura..." value="${escapeHtml(plantilla?.nombre || '')}" style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; margin-bottom:12px;">

                    <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Mensaje</label>
                    <textarea id="tpl-mensaje" rows="6" maxlength="5000" placeholder="Texto que se enviará al cliente" style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; font-family:inherit; resize:vertical; margin-bottom:12px;">${escapeHtml(plantilla?.mensaje || '')}</textarea>

                    <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Archivos adjuntos</label>
                    <div id="tpl-archivos-existentes"></div>
                    <div id="tpl-archivos-nuevos"></div>
                    <input type="file" id="tpl-file-input" multiple style="display:none;">
                    <button onclick="document.getElementById('tpl-file-input').click()" style="background:#f0f2f5; border:1px dashed #999; padding:12px; border-radius:8px; width:100%; color:#555; cursor:pointer;">
                        <i class="fas fa-paperclip"></i> Adjuntar archivos
                    </button>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="tpl-save-btn">
                        <i class="fas fa-save"></i> Guardar
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const renderArchivos = () => {
            const existentesEl = document.getElementById('tpl-archivos-existentes');
            const nuevosEl = document.getElementById('tpl-archivos-nuevos');
            const fmtSize = b => b < 1024 ? b + 'B' : b < 1048576 ? (b/1024).toFixed(1) + 'KB' : (b/1048576).toFixed(1) + 'MB';
            const item = (a, isNew, idx) => `
                <div style="display:flex; align-items:center; gap:8px; padding:8px 10px; background:#f5f6f7; border-radius:6px; margin-bottom:4px; font-size:0.85em;">
                    <i class="fas fa-file" style="color:#999;"></i>
                    <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(isNew ? a.name : a.originalName)}</span>
                    <span style="color:#999; font-size:0.85em;">${fmtSize(a.size)}</span>
                    <button onclick="window._tplRemArchivo(${isNew}, ${idx})" style="background:none; border:none; color:#dc3545; cursor:pointer;"><i class="fas fa-times"></i></button>
                </div>
            `;
            existentesEl.innerHTML = archivosExistentes.map((a, i) => item(a, false, i)).join('');
            nuevosEl.innerHTML = archivosNuevos.map((a, i) => item(a, true, i)).join('');
        };
        window._tplRemArchivo = (isNew, idx) => {
            if (isNew) archivosNuevos.splice(idx, 1);
            else archivosExistentes.splice(idx, 1);
            renderArchivos();
        };

        renderArchivos();

        document.getElementById('tpl-file-input').addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            files.forEach(f => archivosNuevos.push(f));
            e.target.value = '';
            renderArchivos();
        });

        document.getElementById('tpl-save-btn').addEventListener('click', async () => {
            const nombre = document.getElementById('tpl-nombre').value.trim();
            const mensaje = document.getElementById('tpl-mensaje').value;
            if (!nombre) { showToast('Pon un nombre', 'error'); return; }
            if (!mensaje.trim() && archivosExistentes.length === 0 && archivosNuevos.length === 0) {
                showToast('La plantilla debe tener mensaje o archivos', 'error');
                return;
            }
            const btn = document.getElementById('tpl-save-btn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…';
            try {
                const fd = new FormData();
                fd.append('nombre', nombre);
                fd.append('mensaje', mensaje);
                if (isEdit) {
                    fd.append('archivosExistentes', JSON.stringify(archivosExistentes));
                    archivosNuevos.forEach(f => fd.append('nuevosArchivos', f));
                    const r = await fetch(APP_CONFIG.SERVER_URL + `/api/plantillas/${plantilla.id}`, {
                        method: 'PUT',
                        headers: { 'Authorization': 'Bearer ' + API.getToken() },
                        body: fd
                    });
                    const data = await r.json();
                    if (data?.success) {
                        showToast('Plantilla actualizada', 'success');
                        overlay.remove();
                        load();
                    } else showToast(data?.message || 'Error', 'error');
                } else {
                    archivosNuevos.forEach(f => fd.append('archivos', f));
                    const r = await fetch(APP_CONFIG.SERVER_URL + '/api/plantillas', {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + API.getToken() },
                        body: fd
                    });
                    const data = await r.json();
                    if (data?.success) {
                        showToast('Plantilla creada', 'success');
                        overlay.remove();
                        load();
                    } else showToast(data?.message || 'Error', 'error');
                }
            } catch (err) {
                showToast('Error de red', 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
            }
        });
    }

    function editar(id) {
        const p = plantillas.find(p => p.id === id);
        if (p) openEditor(p);
    }

    async function borrar(id) {
        if (!confirm('¿Eliminar esta plantilla? Los archivos adjuntos también se borrarán.')) return;
        try {
            const data = await API.del(`/api/plantillas/${id}`);
            if (data?.success) {
                showToast('Eliminada', 'success');
                load();
            } else showToast('Error', 'error');
        } catch (err) { showToast('Error de red', 'error'); }
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
        const page = document.getElementById('page-plantillas');
        page.classList.add('active');
        page.innerHTML = `
            <div id="plantillas-list-container" class="chat-list" style="margin-top:6px;">
                <div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando plantillas…</div>
            </div>
            <button class="fab" onclick="PlantillasPage.nueva()" title="Nueva plantilla">
                <i class="fas fa-plus"></i>
            </button>
        `;
        load();
    }

    function nueva() { openEditor(null); }

    return { show, load, nueva, editar, borrar };
})();

if (typeof Router !== 'undefined') Router.register('plantillas', () => PlantillasPage.show());
