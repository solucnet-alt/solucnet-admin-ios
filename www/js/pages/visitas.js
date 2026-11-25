// 🆕 Página: Visitas técnicas con CRUD completo (crear, asignar, editar, cancelar)
const VisitasPage = (function() {
    let activeTab = 'pendientes';
    let cache = { pendientes: [], asignadas: [], en_progreso: [], completadas: [] };
    let tecnicos = []; // lista de técnicos disponibles
    // 🔍 v1.0.93 (2026-06-04): búsqueda incremental sobre la lista visible
    let searchTerm = '';

    // Normaliza texto para búsqueda: minúsculas + sin acentos
    function normTexto(s) {
        return (s || '').toString().toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    // Aplica búsqueda incremental a un array de visitas
    function filtrarPorBusqueda(visitas) {
        const q = normTexto(searchTerm).trim();
        if (!q) return visitas;
        return visitas.filter(v => {
            const blob = normTexto([
                v.cliente_nombre, v.cliente_cedula, v.cliente_telefono,
                v.cliente_direccion, v.localidad, v.motivo_visita,
                v.tecnico_asignado_nombre, v.tecnico_nombre, v.notas_admin,
                v.estado, v.tipo_visita, v.plan, v.plan_nombre,
                v.id,
            ].filter(Boolean).join(' '));
            return blob.includes(q);
        });
    }

    const TABS = [
        { id: 'pendientes', label: 'Pend.', icon: 'hourglass-half', endpoint: '/api/visitas-no-asignadas' },
        { id: 'asignadas', label: 'Asig.', icon: 'user-clock', endpoint: '/api/visitas-asignadas' },
        { id: 'en_progreso', label: 'Curso', icon: 'truck', endpoint: '/api/visitas-en-progreso' },
        { id: 'completadas', label: 'Hoy ✓', icon: 'check-double', endpoint: '/api/visitas-completadas-hoy' },
        { id: 'por_tecnico', label: 'x Téc.', icon: 'users', endpoint: null }, // virtual: agrupa asignadas+en_progreso
    ];

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    }

    function fmtFecha(ts) {
        if (!ts) return '—';
        try {
            const d = new Date(ts);
            return d.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        } catch { return '—'; }
    }

    function fmtDate(ts) {
        if (!ts) return '';
        try {
            const d = new Date(ts);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        } catch { return ''; }
    }

    function todayDate() {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function estadoColor(estado) {
        const map = {
            'programada': '#0084ff',
            'asignada': '#f59e0b',
            'en_progreso': '#16a34a',
            'completada': '#6b7280',
            'cancelada': '#dc3545'
        };
        return map[estado] || '#999';
    }

    function renderVisita(v) {
        const tieneCoord = v.cliente_coordenadas && v.cliente_coordenadas.includes(',');
        return `
            <div class="visita-card" data-id="${v.id}" style="background:white; border-radius:12px; padding:14px; margin-bottom:8px; box-shadow:0 1px 2px rgba(0,0,0,0.04); border-left:4px solid ${estadoColor(v.estado)}; cursor:pointer;">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:0.95em;">${escapeHtml(v.cliente_nombre || 'Cliente')}</div>
                        <div style="font-size:0.78em; color:#666; margin-top:2px;">
                            CC: ${escapeHtml(v.cliente_cedula || '?')} · Tel: ${escapeHtml(v.cliente_telefono || '?')}
                        </div>
                        <div style="font-size:0.85em; color:#1a1a1a; margin-top:6px; line-height:1.3;">
                            <i class="fas fa-tools" style="color:#f59e0b;"></i> ${escapeHtml(v.motivo_visita || 'Sin motivo')}
                        </div>
                        ${v.localidad ? `<div style="font-size:0.78em; color:#0066cc; margin-top:3px;"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(v.localidad)}</div>` : ''}
                        ${v.tecnico_asignado_nombre ? `
                            <div style="font-size:0.78em; color:#16a34a; margin-top:4px;">
                                <i class="fas fa-user"></i> ${escapeHtml(v.tecnico_asignado_nombre)}
                            </div>
                        ` : '<div style="font-size:0.78em; color:#999; margin-top:4px;"><i class="fas fa-user-slash"></i> Sin técnico asignado</div>'}
                        <div style="font-size:0.75em; color:#999; margin-top:4px;">
                            📅 ${fmtFecha(v.fecha_programada || v.fecha_creacion)}
                        </div>
                    </div>
                    <div style="text-align:right; flex-shrink:0;">
                        <span style="background:${estadoColor(v.estado)}22; color:${estadoColor(v.estado)}; font-size:0.7em; font-weight:600; padding:3px 8px; border-radius:8px; text-transform:uppercase;">${escapeHtml(v.estado || '')}</span>
                    </div>
                </div>
                ${v.notas_admin ? `<div style="margin-top:8px; padding:6px 10px; background:#fffbeb; border-left:3px solid #f59e0b; border-radius:4px; font-size:0.8em; color:#92400e;"><i class="fas fa-sticky-note"></i> ${escapeHtml(v.notas_admin)}</div>` : ''}
            </div>
        `;
    }

    function renderList() {
        const container = document.getElementById('visitas-list-container');
        if (!container) return;
        document.querySelectorAll('#page-visitas .tab-btn').forEach(btn => {
            const f = btn.dataset.filter;
            btn.classList.toggle('active', f === activeTab);
            const countEl = btn.querySelector('.count');
            if (countEl) {
                if (f === 'por_tecnico') {
                    countEl.textContent = (cache.asignadas || []).length + (cache.en_progreso || []).length;
                } else {
                    countEl.textContent = (cache[f] || []).length;
                }
            }
        });
        // Vista agrupada por técnico
        if (activeTab === 'por_tecnico') {
            const activas = filtrarPorBusqueda([...(cache.asignadas || []), ...(cache.en_progreso || [])]);
            if (!activas.length) {
                container.innerHTML = searchTerm
                    ? `<div class="empty-state"><i class="fas fa-search-minus"></i><p>Sin coincidencias para "${escapeHtml(searchTerm)}"</p></div>`
                    : `<div class="empty-state"><i class="fas fa-user-clock"></i><p>No hay visitas activas</p></div>`;
                return;
            }
            // Agrupar por técnico
            const grupos = new Map();
            activas.forEach(v => {
                const key = v.tecnico_asignado_id || 'sin';
                if (!grupos.has(key)) grupos.set(key, { tecnico: v.tecnico_nombre || 'Sin asignar', visitas: [] });
                grupos.get(key).visitas.push(v);
            });
            container.innerHTML = Array.from(grupos.values()).map(g => {
                const visitasHtml = g.visitas.map(v => `
                    <div class="visita-card" data-id="${v.id}" style="background:white; border-radius:8px; padding:10px; margin-top:6px; border-left:3px solid ${estadoColor(v.estado)}; cursor:pointer;">
                        <div style="font-weight:600; font-size:0.88em;">${escapeHtml(v.cliente_nombre || '?')}</div>
                        <div style="font-size:0.74em; color:#666; margin-top:2px;">${fmtFecha(v.fecha_programada)} · ${escapeHtml(v.motivo_visita || '')}</div>
                    </div>
                `).join('');
                return `
                    <div style="background:#f8f9fa; border-radius:12px; padding:10px; margin-bottom:10px;">
                        <div style="font-weight:700; color:#0066cc; padding:4px 6px; display:flex; justify-content:space-between; align-items:center;">
                            <span><i class="fas fa-hard-hat"></i> ${escapeHtml(g.tecnico)}</span>
                            <span style="background:#0066cc; color:white; padding:2px 8px; border-radius:10px; font-size:0.74em;">${g.visitas.length}</span>
                        </div>
                        ${visitasHtml}
                    </div>
                `;
            }).join('');
            // Click handlers
            container.querySelectorAll('.visita-card').forEach(el => {
                el.addEventListener('click', () => {
                    const id = parseInt(el.dataset.id);
                    const v = activas.find(x => x.id === id);
                    if (v) showDetalleModal(v);
                });
            });
            return;
        }
        // Vista normal por tab
        const baseList = cache[activeTab] || [];
        const list = filtrarPorBusqueda(baseList);
        if (list.length === 0) {
            if (baseList.length === 0) {
                container.innerHTML = `<div class="empty-state"><i class="fas fa-clipboard-check"></i><p>No hay visitas en esta categoría</p></div>`;
            } else {
                container.innerHTML = `<div class="empty-state"><i class="fas fa-search-minus"></i><p>Sin coincidencias para "${escapeHtml(searchTerm)}"</p></div>`;
            }
            return;
        }
        list.sort((a, b) => new Date(b.fecha_creacion || 0) - new Date(a.fecha_creacion || 0));
        container.innerHTML = list.map(renderVisita).join('');
        // Click → modal detalle
        container.querySelectorAll('.visita-card').forEach(el => {
            el.addEventListener('click', () => {
                const id = parseInt(el.dataset.id);
                const v = list.find(x => x.id === id);
                if (v) showDetalleModal(v);
            });
        });
    }

    async function loadTab(tabId) {
        const def = TABS.find(t => t.id === tabId);
        if (!def || !def.endpoint) return; // saltar virtuales (por_tecnico)
        try {
            const data = await API.get(def.endpoint);
            cache[tabId] = data?.visitas || (Array.isArray(data) ? data : []);
        } catch { cache[tabId] = []; }
    }

    async function loadTecnicos() {
        try {
            const data = await API.get('/api/tecnicos');
            tecnicos = data?.tecnicos || (Array.isArray(data) ? data : []);
            tecnicos = tecnicos.filter(t => t.activo !== 0 && t.activo !== false);
        } catch { tecnicos = []; }
    }

    function openMap(coords) {
        const [lat, lng] = coords.split(',').map(s => s.trim());
        const url = `https://www.google.com/maps?q=${lat},${lng}`;
        try {
            if (window.Capacitor?.Plugins?.Browser?.open) {
                window.Capacitor.Plugins.Browser.open({ url, windowName: '_system' });
                return;
            }
        } catch (e) { console.warn('[openMap] Browser.open failed:', e.message); }
        window.open(url, '_blank') || (window.location.href = url);
    }

    // 🆕 Modal de detalle/acciones de una visita
    function showDetalleModal(v) {
        const tieneCoord = v.cliente_coordenadas && v.cliente_coordenadas.includes(',');
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const tecnicoActual = v.tecnico_asignado_nombre || 'Sin asignar';
        const fechaProg = fmtDate(v.fecha_programada);
        const minFecha = todayDate();
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:92vh;">
                <div class="modal-header">
                    <h3><i class="fas fa-tools"></i> Visita #${v.id}</h3>
                    <button class="icon-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body" style="padding:16px;">
                    <div style="margin-bottom:14px;">
                        <div style="font-weight:600; font-size:1.05em;">${escapeHtml(v.cliente_nombre || 'Cliente')}</div>
                        <div style="font-size:0.85em; color:#666; margin-top:2px;">CC: ${escapeHtml(v.cliente_cedula || '?')} · Tel: <a href="tel:${escapeHtml(v.cliente_telefono || '')}" style="color:#0066cc;">${escapeHtml(v.cliente_telefono || '?')}</a></div>
                        ${v.cliente_direccion ? `<div style="font-size:0.82em; color:#666; margin-top:2px;"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(v.cliente_direccion)}</div>` : ''}
                    </div>

                    <div style="background:#fffbeb; border-left:3px solid #f59e0b; padding:8px 10px; border-radius:4px; margin-bottom:14px;">
                        <div style="font-size:0.75em; color:#92400e; text-transform:uppercase; margin-bottom:2px;">Motivo</div>
                        <div style="font-size:0.9em;">${escapeHtml(v.motivo_visita || 'Sin motivo')}</div>
                    </div>

                    <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Técnico asignado</label>
                    <select id="visita-tecnico" style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; margin-bottom:12px;">
                        <option value="">— Sin asignar —</option>
                        ${tecnicos.map(t => `<option value="${t.id}" ${v.tecnico_asignado_id === t.id ? 'selected' : ''}>${escapeHtml(t.nombre)}</option>`).join('')}
                    </select>

                    <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Fecha programada</label>
                    <input type="date" id="visita-fecha" min="${minFecha}" value="${fechaProg}" style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; margin-bottom:12px;">

                    <label style="display:block; font-weight:600; font-size:0.85em; color:#555; margin-bottom:6px;">Notas / Observación</label>
                    <textarea id="visita-notas" rows="3" maxlength="1000" placeholder="Notas adicionales..." style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; font-family:inherit; resize:vertical; margin-bottom:14px;">${escapeHtml(v.notas_admin || v.observacion || '')}</textarea>

                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        ${tieneCoord ? `<button class="btn-secondary" onclick="VisitasPage.openMap('${escapeHtml(v.cliente_coordenadas)}')"><i class="fas fa-map-marker-alt"></i> Mapa</button>` : ''}
                        ${v.cliente_telefono ? `<button class="btn-secondary" onclick="window.location.href='tel:${escapeHtml(v.cliente_telefono)}'"><i class="fas fa-phone"></i> Llamar</button>` : ''}
                    </div>
                    <div style="margin-top:12px; padding-top:12px; border-top:1px solid #eee;">
                        <div style="font-size:0.78em; font-weight:600; color:#555; margin-bottom:6px;">Acciones rápidas</div>
                        <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:6px;">
                            <button onclick="VisitasPage.exportarVisitaPDF(${v.id})" style="padding:9px; background:#dc2626; color:white; border:none; border-radius:6px; font-size:0.78em; cursor:pointer;"><i class="fas fa-file-pdf"></i> Generar PDF</button>
                            <button onclick="VisitasPage.duplicarVisita(${v.id})" style="padding:9px; background:#0066cc; color:white; border:none; border-radius:6px; font-size:0.78em; cursor:pointer;"><i class="fas fa-copy"></i> Duplicar</button>
                            <button onclick="VisitasPage.obsUrgente(${v.id})" style="padding:9px; background:#f59e0b; color:white; border:none; border-radius:6px; font-size:0.78em; cursor:pointer;"><i class="fas fa-exclamation-triangle"></i> Obs. urgente</button>
                            ${v.tecnico_asignado_id ? `<button onclick="VisitasPage.marcarEnProgreso(${v.id})" style="padding:9px; background:#16a34a; color:white; border:none; border-radius:6px; font-size:0.78em; cursor:pointer;"><i class="fas fa-truck"></i> En progreso</button>` : ''}
                        </div>
                        ${v.observacion_ultima_hora ? `<div style="margin-top:8px; padding:8px; background:#fef3c7; border-left:3px solid #f59e0b; border-radius:4px; font-size:0.8em; color:#92400e;"><b><i class="fas fa-exclamation-triangle"></i> Obs. urgente:</b><br>${escapeHtml(v.observacion_ultima_hora)}</div>` : ''}
                    </div>
                </div>
                <div class="modal-footer" style="flex-wrap:wrap; gap:6px;">
                    ${v.estado !== 'completada' && v.estado !== 'cancelada' ? `
                        <button class="btn-secondary" style="background:#fee; color:#dc3545;" id="visita-cancelar-btn">
                            <i class="fas fa-times-circle"></i> Cancelar visita
                        </button>
                    ` : ''}
                    <button class="btn-primary" id="visita-guardar-btn">
                        <i class="fas fa-save"></i> Guardar cambios
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        document.getElementById('visita-guardar-btn').addEventListener('click', async () => {
            const tecnicoId = document.getElementById('visita-tecnico').value;
            const fecha = document.getElementById('visita-fecha').value;
            const notas = document.getElementById('visita-notas').value.trim();
            const btn = document.getElementById('visita-guardar-btn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…';
            try {
                // Asignar/desasignar técnico — backend espera tecnicoId (camelCase) NO tecnico_id
                if (tecnicoId && (parseInt(tecnicoId) !== v.tecnico_asignado_id)) {
                    await API.put(`/api/visitas-tecnicas/${v.id}/asignar`, { tecnicoId: parseInt(tecnicoId), enviarNotificacion: true });
                } else if (!tecnicoId && v.tecnico_asignado_id) {
                    await API.put(`/api/visitas-tecnicas/${v.id}/desasignar`, {});
                }
                // Editar fecha/notas
                await API.put(`/api/visitas-tecnicas/${v.id}`, {
                    fecha_programada: fecha || null,
                    notas_admin: notas,
                    observacion: notas
                });
                showToast('Visita actualizada', 'success');
                overlay.remove();
                await loadAll();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-save"></i> Guardar cambios';
            }
        });

        const cancelBtn = document.getElementById('visita-cancelar-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', async () => {
                if (!confirm(`¿Cancelar la visita #${v.id} de ${v.cliente_nombre}? No se puede deshacer.`)) return;
                try {
                    await API.del(`/api/visitas-tecnicas/${v.id}`);
                    showToast('Visita cancelada', 'success');
                    overlay.remove();
                    await loadAll();
                } catch (err) { showToast('Error: ' + err.message, 'error'); }
            });
        }
    }

    // 🆕 Modal crear visita nueva
    // ============ Modal "Nueva visita" con paridad total al web admin ============
    // - Multi-servicio (cliente con varios servicios → submenu)
    // - Panel "Equipos asignados" mostrando todos_los_equipos
    // - Localidad "OTRA" → input adicional
    // - Adjuntar PDFs múltiples
    // - Envía TODOS los campos: cliente_movil, mikrotik_*, equipo_*, servicio_id, archivos_pdf
    function openCrearModal(clientePre = null) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const minFecha = todayDate();
        const lbl = 'display:block; font-weight:600; font-size:0.82em; color:#555; margin-bottom:5px;';
        const inp = 'width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; box-sizing:border-box;';

        overlay.innerHTML = `
            <div class="modal-content" style="max-height:94vh;">
                <div class="modal-header">
                    <h3><i class="fas fa-plus-circle"></i> Programar Visita Técnica</h3>
                    <button class="icon-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body" style="padding:16px;">
                    <!-- CLIENTE NUEVO (no existe en el sistema) -->
                    <button type="button" onclick="this.closest('.modal-overlay').remove(); VisitasPage.openClienteNuevoModal();" style="width:100%; padding:11px; background:#ecfdf5; color:#166534; border:1px dashed #16a34a; border-radius:8px; font-weight:600; font-size:0.85em; cursor:pointer; margin-bottom:14px;">
                        <i class="fas fa-user-plus"></i> ¿Cliente nuevo? Crear desde cero
                    </button>

                    <!-- BUSCADOR -->
                    <label style="${lbl}">Buscar cliente externo *</label>
                    <input type="text" id="vis-buscar" placeholder="Cédula, nombre o usuario PPPoE…" style="${inp}">
                    <div id="vis-resultados" style="margin-top:6px; max-height:280px; overflow-y:auto;"></div>

                    <!-- CLIENTE SELECCIONADO -->
                    <div id="vis-cliente-card" style="display:none; padding:12px; background:#e8f4ff; border-radius:10px; margin-top:10px; border-left:3px solid #0066cc;"></div>

                    <!-- EQUIPOS ASIGNADOS -->
                    <div id="vis-equipos-panel" style="display:none; margin-top:10px;"></div>

                    <!-- LOCALIDAD -->
                    <label style="${lbl} margin-top:14px;">Localidad *</label>
                    <select id="vis-localidad" style="${inp}">
                        <option value="">Seleccione la zona de instalación…</option>
                        <option value="REPOSO">REPOSO</option>
                        <option value="SALVADOR">SALVADOR</option>
                        <option value="CHURIDO">CHURIDO</option>
                        <option value="SALSIPUEDES">SALSIPUEDES</option>
                        <option value="RIO GRANDE">RIO GRANDE</option>
                        <option value="OSITO">OSITO</option>
                        <option value="MI LUCHA">MI LUCHA</option>
                        <option value="BOSQUE">BOSQUE LOS ALMENDROS</option>
                        <option value="OTRA">OTRA LOCALIDAD</option>
                    </select>
                    <input type="text" id="vis-localidad-otra" placeholder="Especificar localidad…" style="${inp} margin-top:8px; display:none;">

                    <!-- MOTIVO -->
                    <label style="${lbl} margin-top:14px;">Motivo de la visita *</label>
                    <select id="vis-motivo" style="${inp}">
                        <option value="">Seleccionar motivo…</option>
                        <option>Luz roja en el equipo</option>
                        <option>Traslado</option>
                        <option>Instalación</option>
                        <option>Cambio de equipo</option>
                        <option>Retiro</option>
                        <option>Otro</option>
                    </select>
                    <textarea id="vis-motivo-otro" rows="2" placeholder="Especificar motivo…" style="${inp} margin-top:8px; font-family:inherit; display:none;"></textarea>

                    <!-- FECHA -->
                    <label style="${lbl} margin-top:14px;">Fecha programada *</label>
                    <input type="date" id="vis-fecha" min="${minFecha}" style="${inp}">

                    <!-- NOTAS -->
                    <label style="${lbl} margin-top:14px;">Notas adicionales</label>
                    <textarea id="vis-notas" rows="3" maxlength="1000" placeholder="Información para el técnico…" style="${inp} font-family:inherit; resize:vertical;"></textarea>

                    <!-- PDFs -->
                    <label style="${lbl} margin-top:14px;">Adjuntar PDFs para el técnico (opcional)</label>
                    <input type="file" id="vis-pdfs" accept=".pdf,image/*" multiple style="${inp}">
                    <div id="vis-pdfs-info" style="font-size:0.75em; color:#666; margin-top:4px;">Podés subir PDFs o fotos (cámara/galería) que el técnico podrá descargar.</div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="vis-crear"><i class="fas fa-save"></i> Programar Visita</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        // Estado local del modal
        let ultimasBusquedas = [];   // array crudo de servicios
        let clienteSel = null;        // servicio seleccionado (1 servicio)

        function validarTelefono(num) {
            if (!num) return '';
            const n = String(num).trim();
            if (n.length < 7 || /^[01]$/.test(n)) return '';
            return n;
        }

        function renderEquiposPanel(c) {
            const panel = document.getElementById('vis-equipos-panel');
            const lines = [];
            if (c.mikrotik_nombre) lines.push(`<div><i class="fas fa-router" style="color:#0066cc;"></i> <b>MikroTik:</b> ${escapeHtml(c.mikrotik_nombre)}</div>`);
            if (c.usuario_ppp) lines.push(`<div><i class="fas fa-user" style="color:#0066cc;"></i> <b>Usuario PPP:</b> <code style="background:#f5f6f7; padding:1px 4px;">${escapeHtml(c.usuario_ppp)}</code></div>`);

            let equiposHtml = '';
            if (c.todos_los_equipos && c.todos_los_equipos.length > 0) {
                equiposHtml = `
                    <div style="background:#fef3c7; border-left:4px solid #f59e0b; padding:10px; border-radius:6px; margin-top:8px;">
                        <div style="font-weight:600; font-size:0.85em; margin-bottom:6px;"><i class="fas fa-microchip"></i> EQUIPOS ASIGNADOS AL CLIENTE (${c.todos_los_equipos.length})</div>
                        ${c.todos_los_equipos.map(e => `
                            <div style="background:white; border-radius:6px; padding:8px; margin-bottom:5px; font-size:0.8em;">
                                <div><b>Tipo:</b> ${escapeHtml(e.tipo || '—')}</div>
                                <div><b>Serial:</b> <code style="color:#0066cc; font-weight:600;">${escapeHtml(e.serial || '—')}</code></div>
                                <div><b>Estado:</b> <span style="background:#dbeafe; color:#1e40af; padding:1px 6px; border-radius:4px;">${escapeHtml(e.estado || '?')}</span></div>
                            </div>
                        `).join('')}
                    </div>
                `;
            } else if (c.serial_equipo_asignado) {
                equiposHtml = `
                    <div style="background:#fef3c7; border-left:4px solid #f59e0b; padding:10px; border-radius:6px; margin-top:8px;">
                        <div style="font-weight:600; font-size:0.85em;"><i class="fas fa-microchip"></i> EQUIPO ASIGNADO</div>
                        <div style="margin-top:6px; font-size:0.8em;">
                            <div><b>Tipo:</b> ${escapeHtml(c.equipo_tipo || '—')}</div>
                            <div><b>Serial:</b> <code style="color:#0066cc;">${escapeHtml(c.serial_equipo_asignado)}</code></div>
                        </div>
                    </div>
                `;
            }

            const otros = [];
            if (c.mikrotik_serial) otros.push(`<span style="background:#0066cc; color:white; padding:2px 6px; border-radius:4px; font-size:0.7em;">MK: ${escapeHtml(c.mikrotik_serial)}</span>`);
            if (c.equipo_mac) otros.push(`<span style="background:#6b7280; color:white; padding:2px 6px; border-radius:4px; font-size:0.7em;">MAC: ${escapeHtml(c.equipo_mac)}</span>`);
            if (c.onu_serial) otros.push(`<span style="background:#16a34a; color:white; padding:2px 6px; border-radius:4px; font-size:0.7em;">ONU cfg: ${escapeHtml(c.onu_serial)}</span>`);
            if (otros.length) lines.push(`<div style="margin-top:6px;">${otros.join(' ')}</div>`);

            if (!lines.length && !equiposHtml) {
                panel.style.display = 'none';
                panel.innerHTML = '';
                return;
            }
            panel.style.display = 'block';
            panel.innerHTML = `
                <div style="background:#f0f9ff; border:1px solid #bae6fd; padding:10px; border-radius:8px; font-size:0.82em;">
                    <div style="font-weight:600; color:#0066cc; margin-bottom:6px;"><i class="fas fa-info-circle"></i> Información técnica</div>
                    ${lines.join('')}
                    ${equiposHtml}
                </div>
            `;
        }

        function pickClienteServicio(idx) {
            const c = ultimasBusquedas[idx];
            if (!c) return;
            clienteSel = c;
            document.getElementById('vis-resultados').innerHTML = '';
            document.getElementById('vis-buscar').value = '';
            const card = document.getElementById('vis-cliente-card');
            const tel = validarTelefono(c.telefono);
            const movil = validarTelefono(c.movil);
            const movilDistinto = movil && movil !== tel ? movil : '';
            const labels = [tel ? `Tel ${tel}` : '', movilDistinto ? `Móvil ${movilDistinto}` : ''].filter(Boolean).join(' · ');
            card.style.display = 'block';
            card.innerHTML = `
                <div style="font-weight:600; font-size:0.95em;">${escapeHtml(c.nombre || 'Sin nombre')}</div>
                <div style="font-size:0.8em; color:#666; margin-top:2px;">CC ${escapeHtml(c.cedula || '?')} · <i class="fas fa-database"></i> <strong>${escapeHtml(c.bd_nombre || c.bd_origen || '?')}</strong></div>
                ${c.direccion ? `<div style="font-size:0.78em; color:#444; margin-top:3px;"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(c.direccion)}</div>` : ''}
                ${labels ? `<div style="font-size:0.78em; color:#444; margin-top:2px;"><i class="fas fa-phone"></i> ${escapeHtml(labels)}</div>` : ''}
                ${c.servicio_id ? `<div style="font-size:0.74em; color:#0066cc; margin-top:3px;"><i class="fas fa-layer-group"></i> Servicio #${c.servicio_id}${c.servicio_status ? ' · ' + escapeHtml(c.servicio_status) : ''}</div>` : ''}
                <div id="vis-pdf-auto-status" style="margin-top:6px; font-size:0.75em; display:none;"></div>
                <button type="button" onclick="VisitasPage._resetCliente()" style="margin-top:8px; background:none; border:none; color:#dc3545; cursor:pointer; font-size:0.8em;"><i class="fas fa-times-circle"></i> Cambiar cliente</button>
            `;
            renderEquiposPanel(c);
            // 🆕 Buscar automáticamente el PDF de inscripción por cédula (igual que el web)
            if (c.cedula) intentarAutoCargarPdfInscripcion(c.cedula);
        }

        // 🆕 Igual que el web admin: busca PDF en solucnet-web/documentos/registros y lo carga al input
        async function intentarAutoCargarPdfInscripcion(cedula) {
            const statusEl = document.getElementById('vis-pdf-auto-status');
            const fileInput = document.getElementById('vis-pdfs');
            if (!statusEl || !fileInput) return;
            try {
                statusEl.style.display = 'block';
                statusEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="color:#666;"></i> <span style="color:#666;">Buscando formulario de inscripción…</span>';
                const resp = await fetch(APP_CONFIG.SERVER_URL + `/api/pdf-instalacion-por-cedula/${encodeURIComponent(cedula)}`, {
                    headers: { 'Authorization': 'Bearer ' + API.getToken() }
                });
                if (!resp.ok) {
                    statusEl.style.display = 'none';
                    return; // sin PDF (normal para clientes ya instalados)
                }
                const cd = resp.headers.get('Content-Disposition') || '';
                let fileName = `Formulario_Registro_${cedula}.pdf`;
                const m = cd.match(/filename="(.+)"/);
                if (m && m[1]) fileName = m[1];
                const blob = await resp.blob();
                const file = new File([blob], fileName, { type: 'application/pdf' });
                const dt = new DataTransfer();
                dt.items.add(file);
                fileInput.files = dt.files;
                statusEl.innerHTML = `<i class="fas fa-check-circle" style="color:#16a34a;"></i> <span style="color:#16a34a;">PDF cargado: ${escapeHtml(fileName)}</span>`;
            } catch (e) {
                if (statusEl) statusEl.style.display = 'none';
            }
        }

        window.VisitasPage = window.VisitasPage || {};
        window.VisitasPage._resetCliente = () => {
            clienteSel = null;
            const card = document.getElementById('vis-cliente-card');
            const panel = document.getElementById('vis-equipos-panel');
            if (card) { card.style.display = 'none'; card.innerHTML = ''; }
            if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
        };

        // 🆕 Si vino con un cliente pre-seleccionado (desde Clientes Externos), saltamos la búsqueda
        if (clientePre) {
            // Insertarlo en ultimasBusquedas para que pickClienteServicio lo encuentre
            ultimasBusquedas = [{
                ...clientePre,
                bd_origen: clientePre.bd_origen || 'solucnet_db (prospecto)',
                estado: clientePre.estado || 'Pendiente',
            }];
            // Llamar la función estándar que ya carga el card + intenta PDF auto
            setTimeout(() => pickClienteServicio(0), 80);
            // Sugerir localidad si el cliente externo tiene barrio/dirección reconocible
            setTimeout(() => {
                const locSel = document.getElementById('vis-localidad');
                if (locSel && clientePre.direccion) {
                    const dir = clientePre.direccion.toLowerCase();
                    const zonas = ['REPOSO','SALVADOR','BOSQUE LOS ALMENDROS','RIO GRANDE','RÍO GRANDE','OSITO','SALSIPUEDES','MILUCHA','CHURIDO'];
                    for (const z of zonas) {
                        if (dir.includes(z.toLowerCase())) {
                            for (const opt of locSel.options) {
                                if (opt.value.toUpperCase() === z) { locSel.value = opt.value; break; }
                            }
                            break;
                        }
                    }
                }
            }, 200);
        }

        function abrirSelectorServiciosMulti(indices) {
            const servicios = indices.map(i => ultimasBusquedas[i]).filter(Boolean);
            if (!servicios.length) return;
            const overlay2 = document.createElement('div');
            overlay2.className = 'modal-overlay';
            overlay2.style.zIndex = '10000';
            overlay2.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header" style="background:linear-gradient(135deg,#f59e0b,#d97706);"><h3><i class="fas fa-layer-group"></i> Selecciona el servicio</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                    <div class="modal-body" style="padding:14px 18px;">
                        <div style="background:#fffbeb; padding:8px; border-radius:6px; font-size:0.78em; color:#92400e; margin-bottom:10px;">
                            <i class="fas fa-info-circle"></i> Este cliente tiene <b>${servicios.length} servicios</b>. Cada uno con su propio PPPoE/dirección/GPS. Elegí cuál atender.
                        </div>
                        <div style="font-weight:600; font-size:0.92em; margin-bottom:8px;">${escapeHtml(servicios[0].nombre)} <small style="color:#666; font-weight:400;">— ${escapeHtml(servicios[0].cedula)}</small></div>
                        ${servicios.map((s, i) => {
                            const tieneCaja = s.servicio_idnap && parseInt(s.servicio_idnap) > 0;
                            const status = (s.servicio_status || '').toUpperCase();
                            const isOnline = status === 'ONLINE';
                            return `
                                <button type="button" data-idx="${indices[i]}" class="srv-pick" style="display:block; width:100%; text-align:left; background:white; border:1px solid #ddd; border-radius:8px; padding:10px; margin-bottom:6px; cursor:pointer;">
                                    <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
                                        <div style="flex:1; min-width:0;">
                                            <div style="font-weight:600;"><i class="fas fa-user"></i> ${escapeHtml(s.usuario_ppp || '(sin PPPoE)')}</div>
                                            <div style="font-size:0.78em; color:#666; margin-top:2px;"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(s.direccion || 'Sin dirección')}</div>
                                            <div style="font-size:0.74em; color:#999; margin-top:2px;">
                                                <i class="fas fa-router"></i> ${escapeHtml(s.mikrotik_nombre || 'Sin MK')}
                                                · <i class="fas fa-network-wired"></i> ${tieneCaja ? `Caja ${s.servicio_idnap}/${s.servicio_portnap || '?'}` : 'Sin NAP'}
                                            </div>
                                        </div>
                                        <span style="background:${isOnline ? '#dcfce7' : '#f3f4f6'}; color:${isOnline ? '#166534' : '#666'}; font-size:0.68em; font-weight:600; padding:2px 6px; border-radius:5px;">${status || 'OFFLINE'}</span>
                                    </div>
                                </button>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
            document.body.appendChild(overlay2);
            overlay2.querySelector('.modal-close').onclick = () => overlay2.remove();
            overlay2.querySelectorAll('.srv-pick').forEach(b => {
                b.addEventListener('click', () => {
                    const idx = parseInt(b.dataset.idx);
                    overlay2.remove();
                    pickClienteServicio(idx);
                });
            });
        }

        // Listeners de UI
        const buscarInput = document.getElementById('vis-buscar');
        let buscarTimer;
        buscarInput.addEventListener('input', () => {
            clearTimeout(buscarTimer);
            const termino = buscarInput.value.trim();
            if (termino.length < 2) {
                document.getElementById('vis-resultados').innerHTML = '';
                return;
            }
            buscarTimer = setTimeout(async () => {
                try {
                    const data = await API.post('/api/buscar-clientes', { termino });
                    const arr = data?.clientes || (Array.isArray(data) ? data : []);
                    ultimasBusquedas = arr;
                    const cont = document.getElementById('vis-resultados');
                    if (!arr.length) {
                        cont.innerHTML = '<div style="padding:10px; color:#999; font-size:0.85em;">Sin resultados</div>';
                        return;
                    }
                    // Agrupar por cliente (bd+cedula+id) para detectar multi-servicio
                    const grupos = new Map();
                    arr.forEach((s, idx) => {
                        const key = `${s.bd_origen || ''}|${s.cedula || ''}|${s.id || ''}`;
                        if (!grupos.has(key)) grupos.set(key, { cliente: s, indices: [] });
                        grupos.get(key).indices.push(idx);
                    });
                    cont.innerHTML = Array.from(grupos.values()).slice(0, 12).map(g => {
                        const c = g.cliente;
                        const multi = g.indices.length > 1;
                        const badge = multi ? `<span style="background:#fef3c7; color:#92400e; font-size:0.65em; font-weight:600; padding:2px 6px; border-radius:5px; margin-left:4px;"><i class="fas fa-layer-group"></i> ${g.indices.length}</span>` : '';
                        const estadoColor = c.estado === 'Activo' ? '#16a34a' : '#dc3545';
                        return `
                            <div class="cli-row" data-multi="${multi ? 1 : 0}" data-indices="${g.indices.join(',')}" data-idx="${g.indices[0]}" style="padding:8px 10px; border-bottom:1px solid #eee; cursor:pointer;">
                                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                                    <div style="flex:1; min-width:0;">
                                        <div style="font-weight:600; font-size:0.88em;">${escapeHtml(c.nombre || 'Sin nombre')}${badge}</div>
                                        <div style="font-size:0.75em; color:#666;">CC ${escapeHtml(c.cedula || '?')} · ${escapeHtml(validarTelefono(c.telefono) || validarTelefono(c.movil) || 'sin tel')}</div>
                                        <div style="font-size:0.72em; color:#0066cc; margin-top:1px;"><i class="fas fa-database"></i> ${escapeHtml(c.bd_nombre || c.bd_origen || '?')}</div>
                                        ${!multi && c.direccion ? `<div style="font-size:0.72em; color:#999;"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(c.direccion.substring(0,60))}${c.direccion.length>60?'…':''}</div>` : ''}
                                    </div>
                                    <span style="background:${estadoColor}22; color:${estadoColor}; font-size:0.64em; font-weight:600; padding:2px 6px; border-radius:5px;">${escapeHtml(c.estado || '?')}</span>
                                </div>
                            </div>
                        `;
                    }).join('');
                    cont.querySelectorAll('.cli-row').forEach(row => {
                        row.addEventListener('click', () => {
                            const multi = row.dataset.multi === '1';
                            if (multi) {
                                const indices = row.dataset.indices.split(',').map(Number);
                                abrirSelectorServiciosMulti(indices);
                            } else {
                                pickClienteServicio(parseInt(row.dataset.idx));
                            }
                        });
                    });
                } catch (err) { console.error(err); }
            }, 300);
        });

        // Localidad OTRA → input
        document.getElementById('vis-localidad').addEventListener('change', (e) => {
            const otra = document.getElementById('vis-localidad-otra');
            otra.style.display = e.target.value === 'OTRA' ? 'block' : 'none';
        });
        // Motivo Otro → textarea
        document.getElementById('vis-motivo').addEventListener('change', (e) => {
            const otro = document.getElementById('vis-motivo-otro');
            otro.style.display = e.target.value === 'Otro' ? 'block' : 'none';
        });

        // Crear
        document.getElementById('vis-crear').onclick = async () => {
            if (!clienteSel) return showToast('Selecciona un cliente', 'error');
            const motivoSel = document.getElementById('vis-motivo').value;
            const motivoOtro = document.getElementById('vis-motivo-otro').value.trim();
            const motivo = motivoSel === 'Otro' ? motivoOtro : motivoSel;
            const fecha = document.getElementById('vis-fecha').value;
            const locSel = document.getElementById('vis-localidad').value;
            const locOtra = document.getElementById('vis-localidad-otra').value.trim();
            const localidad = locSel === 'OTRA' ? locOtra : locSel;
            const notas = document.getElementById('vis-notas').value.trim();
            const pdfs = document.getElementById('vis-pdfs').files;

            if (!localidad) return showToast('Selecciona la localidad', 'error');
            if (!motivo) return showToast('Selecciona un motivo', 'error');
            if (!fecha) return showToast('Selecciona la fecha', 'error');

            const btn = document.getElementById('vis-crear');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Programando…';

            try {
                const fd = new FormData();
                const c = clienteSel;
                fd.append('cliente_id', c.id);
                fd.append('cliente_nombre', c.nombre || '');
                fd.append('cliente_cedula', c.cedula || '');
                fd.append('cliente_telefono', validarTelefono(c.telefono));
                fd.append('cliente_movil', validarTelefono(c.movil));
                fd.append('cliente_direccion', c.direccion || '');
                fd.append('cliente_coordenadas', c.coordenadas || '');
                fd.append('mikrotik_nombre', c.mikrotik_nombre || '');
                fd.append('usuario_ppp', c.usuario_ppp || '');
                fd.append('mikrotik_serial', c.mikrotik_serial || '');
                fd.append('equipo_mac', c.equipo_mac || '');
                fd.append('onu_serial', c.onu_serial || '');
                fd.append('serial_equipo_asignado', c.serial_equipo_asignado || '');
                fd.append('equipo_tipo', c.equipo_tipo || '');
                fd.append('equipo_estado', c.equipo_estado || '');
                if (c.servicio_id) fd.append('servicio_id', c.servicio_id);
                fd.append('localidad', localidad);
                fd.append('motivo_visita', motivo);
                fd.append('fecha_programada', fecha);
                fd.append('notas_admin', notas);
                fd.append('bd_origen', c.bd_origen || '');
                for (let i = 0; i < pdfs.length; i++) fd.append('archivos_pdf', pdfs[i]);

                // 🆕 2026-10-08: timeout real para que NUNCA se quede congelado en "Programando…".
                const _ctrl = new AbortController();
                const _to = setTimeout(() => _ctrl.abort(), 30000);
                let r;
                try {
                    r = await fetch(APP_CONFIG.SERVER_URL + '/api/visitas-tecnicas', {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + API.getToken() },
                        body: fd,
                        signal: _ctrl.signal
                    });
                } finally { clearTimeout(_to); }
                let data = null; try { data = await r.json(); } catch (e) {}
                if (r.ok && data?.success) {
                    showToast('Visita programada ✓', 'success');
                    overlay.remove();
                    clienteSel = null;
                    try { await loadAll(); } catch (e) {}
                } else if (r.status === 401) {
                    showToast('Tu sesión expiró. Cerrá e iniciá sesión de nuevo en el app.', 'error');
                    btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Programar Visita';
                } else {
                    showToast((data && data.message) || ('Error del servidor (HTTP ' + (r ? r.status : '?') + ')'), 'error');
                    btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Programar Visita';
                }
            } catch (err) {
                const _msg = (err && err.name === 'AbortError')
                    ? 'La conexión tardó demasiado (30s). Revisá tu internet y reintentá.'
                    : ('Error de red: ' + (err && err.message ? err.message : 'sin conexión'));
                showToast(_msg, 'error');
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-save"></i> Programar Visita';
            }
        };
    }

    // 🆕 Modal "Crear Cliente Nuevo" — paridad con el web admin
    // Captura manual de un cliente que NO existe en MikroWisp + programa su visita.
    // Endpoint: POST /api/crear-cliente-y-visita (multipart, es_cliente_nuevo=true)
    function openClienteNuevoModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const minFecha = todayDate();
        const lbl = 'display:block; font-weight:600; font-size:0.82em; color:#555; margin-bottom:5px;';
        const inp = 'width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; box-sizing:border-box;';

        overlay.innerHTML = `
            <div class="modal-content" style="max-height:94vh;">
                <div class="modal-header" style="background:linear-gradient(135deg,#16a34a,#0d7836);">
                    <h3><i class="fas fa-user-plus"></i> Crear Cliente Nuevo</h3>
                    <button class="icon-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body" style="padding:16px;">
                    <div style="background:#ecfdf5; border-left:3px solid #16a34a; padding:8px 10px; border-radius:6px; font-size:0.78em; color:#166534; margin-bottom:14px;">
                        <i class="fas fa-info-circle"></i> Para clientes que <b>aún no existen</b> en el sistema. Se crea el registro y se programa la visita.
                    </div>

                    <label style="${lbl}">Nombre completo *</label>
                    <input type="text" id="cli-nombre" style="${inp}">

                    <label style="${lbl} margin-top:12px;">Cédula *</label>
                    <input type="text" id="cli-cedula" inputmode="numeric" style="${inp}">

                    <label style="${lbl} margin-top:12px;">Teléfono *</label>
                    <input type="tel" id="cli-telefono" inputmode="tel" style="${inp}">

                    <label style="${lbl} margin-top:12px;">Móvil *</label>
                    <input type="tel" id="cli-movil" inputmode="tel" style="${inp}">

                    <label style="${lbl} margin-top:12px;">Dirección *</label>
                    <textarea id="cli-direccion" rows="2" style="${inp} font-family:inherit; resize:vertical;"></textarea>

                    <label style="${lbl} margin-top:12px;">Email</label>
                    <input type="email" id="cli-email" style="${inp}">

                    <label style="${lbl} margin-top:12px;">Coordenadas GPS</label>
                    <input type="text" id="cli-coordenadas" placeholder="Latitud, Longitud" style="${inp}">

                    <label style="${lbl} margin-top:14px;">Localidad *</label>
                    <select id="cli-localidad" style="${inp}">
                        <option value="">Seleccione la zona de instalación…</option>
                        <option value="REPOSO">REPOSO</option>
                        <option value="SALVADOR">SALVADOR</option>
                        <option value="CHURIDO">CHURIDO</option>
                        <option value="SALSIPUEDES">SALSIPUEDES</option>
                        <option value="RIO GRANDE">RIO GRANDE</option>
                        <option value="OSITO">OSITO</option>
                        <option value="MI LUCHA">MI LUCHA</option>
                        <option value="BOSQUE">BOSQUE LOS ALMENDROS</option>
                        <option value="OTRA">OTRA LOCALIDAD</option>
                    </select>
                    <input type="text" id="cli-localidad-otra" placeholder="Especificar localidad…" style="${inp} margin-top:8px; display:none;">

                    <label style="${lbl} margin-top:14px;">Motivo de la visita *</label>
                    <select id="cli-motivo" style="${inp}">
                        <option value="">Seleccionar motivo…</option>
                        <option>Luz roja en el equipo</option>
                        <option>Traslado</option>
                        <option>Instalación</option>
                        <option>Cambio de equipo</option>
                        <option>Retiro</option>
                        <option>Otro</option>
                    </select>
                    <textarea id="cli-motivo-otro" rows="2" placeholder="Especificar motivo…" style="${inp} margin-top:8px; font-family:inherit; display:none;"></textarea>

                    <label style="${lbl} margin-top:14px;">Fecha programada *</label>
                    <input type="date" id="cli-fecha" min="${minFecha}" style="${inp}">

                    <label style="${lbl} margin-top:14px;">Notas adicionales</label>
                    <textarea id="cli-notas" rows="3" maxlength="1000" placeholder="Información adicional para el técnico…" style="${inp} font-family:inherit; resize:vertical;"></textarea>

                    <label style="${lbl} margin-top:14px;">Adjuntar archivos para técnico (opcional)</label>
                    <input type="file" id="cli-pdfs" accept=".pdf,image/*" multiple style="${inp}">
                    <div style="font-size:0.75em; color:#666; margin-top:4px;">Podés subir PDFs o fotos (jpg/png/webp) que el técnico podrá descargar.</div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="cli-crear" style="background:#16a34a;"><i class="fas fa-save"></i> Crear y Programar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        // Localidad OTRA → input
        document.getElementById('cli-localidad').addEventListener('change', (e) => {
            document.getElementById('cli-localidad-otra').style.display = e.target.value === 'OTRA' ? 'block' : 'none';
        });
        // Motivo Otro → textarea
        document.getElementById('cli-motivo').addEventListener('change', (e) => {
            document.getElementById('cli-motivo-otro').style.display = e.target.value === 'Otro' ? 'block' : 'none';
        });

        document.getElementById('cli-crear').onclick = async () => {
            const nombre = document.getElementById('cli-nombre').value.trim();
            const cedula = document.getElementById('cli-cedula').value.trim();
            const telefono = document.getElementById('cli-telefono').value.trim();
            const movil = document.getElementById('cli-movil').value.trim();
            const direccion = document.getElementById('cli-direccion').value.trim();
            const email = document.getElementById('cli-email').value.trim();
            const coordenadas = document.getElementById('cli-coordenadas').value.trim();
            const locSel = document.getElementById('cli-localidad').value;
            const locOtra = document.getElementById('cli-localidad-otra').value.trim();
            const localidad = locSel === 'OTRA' ? locOtra : locSel;
            const motivoSel = document.getElementById('cli-motivo').value;
            const motivoOtro = document.getElementById('cli-motivo-otro').value.trim();
            const motivo = motivoSel === 'Otro' ? motivoOtro : motivoSel;
            const fecha = document.getElementById('cli-fecha').value;
            const notas = document.getElementById('cli-notas').value.trim();
            const pdfs = document.getElementById('cli-pdfs').files;

            if (!nombre || !cedula || !telefono || !movil || !direccion) return showToast('Completá nombre, cédula, teléfono, móvil y dirección', 'error');
            if (!localidad) return showToast('Selecciona la localidad', 'error');
            if (!motivo) return showToast('Selecciona un motivo', 'error');
            if (!fecha) return showToast('Selecciona la fecha', 'error');

            const btn = document.getElementById('cli-crear');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando…';

            try {
                const fd = new FormData();
                fd.append('cliente_nombre', nombre);
                fd.append('cliente_cedula', cedula);
                fd.append('cliente_telefono', telefono);
                fd.append('cliente_movil', movil);
                fd.append('cliente_direccion', direccion);
                fd.append('cliente_email', email);
                fd.append('cliente_coordenadas', coordenadas);
                fd.append('localidad', localidad);
                fd.append('motivo_visita', motivo);
                fd.append('fecha_programada', fecha);
                fd.append('notas_admin', notas);
                fd.append('es_cliente_nuevo', 'true');
                for (let i = 0; i < pdfs.length; i++) fd.append('archivos_pdf', pdfs[i]);

                const _ctrl = new AbortController();
                const _to = setTimeout(() => _ctrl.abort(), 30000);
                let r;
                try {
                    r = await fetch(APP_CONFIG.SERVER_URL + '/api/crear-cliente-y-visita', {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + API.getToken() },
                        body: fd,
                        signal: _ctrl.signal
                    });
                } finally { clearTimeout(_to); }
                let data = null; try { data = await r.json(); } catch (e) {}
                if (r.ok && data?.success) {
                    showToast('Cliente creado y visita programada ✓', 'success');
                    overlay.remove();
                    try { await loadAll(); } catch (e) {}
                } else if (r.status === 401) {
                    showToast('Tu sesión expiró. Cerrá e iniciá sesión de nuevo en el app.', 'error');
                    btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Crear y Programar';
                } else {
                    showToast((data && data.message) || ('Error del servidor (HTTP ' + (r ? r.status : '?') + ')'), 'error');
                    btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Crear y Programar';
                }
            } catch (err) {
                const _msg = (err && err.name === 'AbortError')
                    ? 'La conexión tardó demasiado (30s). Revisá tu internet y reintentá.'
                    : ('Error de red: ' + (err && err.message ? err.message : 'sin conexión'));
                showToast(_msg, 'error');
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-save"></i> Crear y Programar';
            }
        };
    }

    async function loadAll() {
        await Promise.all(TABS.map(t => loadTab(t.id)));
        renderList();
    }

    function showToast(msg, type='info') {
        let t = document.getElementById('toast');
        if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
        t.className = 'toast show ' + type;
        t.textContent = msg;
        setTimeout(() => t.classList.remove('show'), 2500);
    }

    async function show() {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const page = document.getElementById('page-visitas');
        page.classList.add('active');
        // 🆕 2026-10-07: reintentar visitas a campo que quedaron sin enviar (offline) al abrir la pestaña.
        try { _flushVisitasCampoPendientes(); } catch (e) {}
        page.innerHTML = `
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-bottom:6px;">
                <button onclick="VisitasPage.openAsignarMasivo()" style="padding:9px 6px; background:linear-gradient(135deg,#0066cc,#0052a3); color:white; border:none; border-radius:10px; font-weight:600; font-size:0.72em; cursor:pointer;">
                    <i class="fas fa-users-cog"></i> Asignar
                </button>
                <button onclick="VisitasPage.openCambiarFechaMasivo()" style="padding:9px 6px; background:linear-gradient(135deg,#f59e0b,#d97706); color:white; border:none; border-radius:10px; font-weight:600; font-size:0.72em; cursor:pointer;">
                    <i class="fas fa-calendar-alt"></i> Cambiar fecha
                </button>
                <button onclick="VisitasPage.openReprogramarMasivo()" style="padding:9px 6px; background:linear-gradient(135deg,#8b5cf6,#6d28d9); color:white; border:none; border-radius:10px; font-weight:600; font-size:0.72em; cursor:pointer;">
                    <i class="fas fa-calendar-day"></i> Reprogramar
                </button>
                <button onclick="VisitasPage.openNotifMasivo()" style="padding:9px 6px; background:linear-gradient(135deg,#25d366,#128c7e); color:white; border:none; border-radius:10px; font-weight:600; font-size:0.72em; cursor:pointer;">
                    <i class="fab fa-whatsapp"></i> Notificar
                </button>
                <button onclick="VisitasPage.openUbicaciones()" style="padding:9px 6px; background:linear-gradient(135deg,#16a34a,#0d7836); color:white; border:none; border-radius:10px; font-weight:600; font-size:0.72em; cursor:pointer;">
                    <i class="fas fa-map-marked-alt"></i> Ubicación
                </button>
                <button onclick="VisitasPage.abrirOnusCriticas()" style="padding:9px 6px; background:linear-gradient(135deg,#dc2626,#991b1b); color:white; border:none; border-radius:10px; font-weight:600; font-size:0.72em; cursor:pointer;">
                    <i class="fas fa-exclamation-triangle"></i> ONUs RX
                </button>
            </div>
            <div style="background:white; border-radius:10px; padding:6px 8px; margin-bottom:6px; display:flex; align-items:center; gap:6px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                <i class="fas fa-search" style="color:#0084ff; font-size:0.85em;"></i>
                <input type="search" id="vis-search" placeholder="Buscar: nombre, cédula, teléfono, dirección, técnico…" value="${escapeHtml(searchTerm)}"
                    style="flex:1; border:none; outline:none; padding:6px 4px; font-size:0.88em; background:transparent;" autocomplete="off">
                <button id="vis-search-clear" title="Limpiar búsqueda" style="background:none; border:none; color:#888; font-size:1em; cursor:pointer; padding:4px 6px; display:${searchTerm ? 'inline-block' : 'none'};"><i class="fas fa-times-circle"></i></button>
            </div>
            <div class="tabs-bar">
                ${TABS.map(t => `<button class="tab-btn ${t.id === activeTab ? 'active' : ''}" data-filter="${t.id}"><i class="fas fa-${t.icon}"></i> ${t.label} <span class="count">0</span></button>`).join('')}
            </div>
            <div id="visitas-list-container" class="chat-list" style="margin-top:6px;">
                <div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>
            </div>
            <button class="fab" onclick="VisitasPage.openCrearModal()" title="Crear visita técnica">
                <i class="fas fa-plus"></i>
            </button>
            <button class="fab" onclick="VisitasPage.openCrearCampoModal()" title="Crear visita a campo (sitio/punto)" style="bottom:86px; background:linear-gradient(135deg,#0ea5e9,#0369a1);">
                <i class="fas fa-map-marked-alt"></i>
            </button>
        `;
        page.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activeTab = btn.dataset.filter;
                renderList();
            });
        });
        // 🔍 v1.0.93: búsqueda incremental
        const searchInput = page.querySelector('#vis-search');
        const searchClear = page.querySelector('#vis-search-clear');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                searchTerm = searchInput.value;
                if (searchClear) searchClear.style.display = searchTerm ? 'inline-block' : 'none';
                renderList();
            });
        }
        if (searchClear) {
            searchClear.addEventListener('click', () => {
                searchTerm = '';
                if (searchInput) searchInput.value = '';
                searchClear.style.display = 'none';
                renderList();
            });
        }
        loadTecnicos();
        loadAll();
    }

    // ============ Asignación masiva ============
    function openAsignarMasivo() {
        // Las "pendientes" en la app son visitas sin técnico asignado (programadas listas para asignar)
        const programadas = (cache.pendientes || []).filter(v => !v.tecnico_asignado_id && v.estado !== 'completada' && v.estado !== 'cancelada');
        if (!programadas.length) { showToast('No hay visitas sin asignar', 'info'); return; }
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const lblStyle = 'display:block; font-size:0.78em; font-weight:600; color:#555; margin-bottom:4px;';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3><i class="fas fa-users-cog"></i> Asignación masiva</h3><button class="modal-close" style="background:none; border:none; color:white; font-size:1.4em; cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <div style="background:#eff6ff; padding:10px; border-radius:8px; margin-bottom:12px; font-size:0.85em;">
                        <b>${programadas.length}</b> visitas programadas sin técnico
                    </div>
                    <label style="${lblStyle}">Técnico</label>
                    <select id="asg-tecnico" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:10px;">
                        <option value="">— Selecciona técnico —</option>
                        ${tecnicos.map(t => `<option value="${t.id}">${escapeHtml(t.nombre || t.username)}</option>`).join('')}
                    </select>
                    <label style="${lblStyle}">Visitas a asignar (${programadas.length})</label>
                    <div id="asg-visitas-list" style="max-height:240px; overflow-y:auto; border:1px solid #eee; border-radius:8px; padding:6px;">
                        <div style="padding:4px 0; font-size:0.78em;">
                            <label style="cursor:pointer;"><input type="checkbox" id="asg-toggle-all" checked> <b>Seleccionar/deseleccionar todas</b></label>
                        </div>
                        <hr style="margin:6px 0; border:0; border-top:1px solid #eee;">
                        ${programadas.map(v => `
                            <label style="display:block; padding:6px 4px; cursor:pointer; font-size:0.82em; border-bottom:1px solid #f5f5f5;">
                                <input type="checkbox" class="asg-vis-check" data-id="${v.id}" checked>
                                <b>${escapeHtml(v.cliente_nombre || 'Cliente')}</b>
                                <div style="color:#666; font-size:0.92em; margin-left:22px;">
                                    📅 ${fmtFecha(v.fecha_programada)}${v.localidad ? ` · 📍 ${escapeHtml(v.localidad)}` : ''}
                                </div>
                                <div style="color:#999; font-size:0.85em; margin-left:22px;">🔧 ${escapeHtml(v.motivo_visita || 'Sin motivo')}</div>
                            </label>
                        `).join('')}
                    </div>
                </div>
                <label style="display:flex; align-items:center; gap:8px; padding:10px; background:#dcfce7; border-radius:8px; margin-top:10px; cursor:pointer; font-size:0.86em; color:#166534;">
                    <input type="checkbox" id="asg-notif" checked style="width:18px; height:18px; cursor:pointer;">
                    <i class="fab fa-whatsapp" style="font-size:1.2em;"></i>
                    <span><b>Enviar WhatsApp al cliente</b> con la fecha de visita</span>
                </label>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="asg-submit"><i class="fas fa-check"></i> Asignar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.querySelector('#asg-toggle-all').onchange = (e) => {
            overlay.querySelectorAll('.asg-vis-check').forEach(c => c.checked = e.target.checked);
        };
        overlay.querySelector('#asg-submit').onclick = async () => {
            const tecnicoId = parseInt(overlay.querySelector('#asg-tecnico').value);
            if (!tecnicoId) return showToast('Selecciona un técnico', 'error');
            const ids = [...overlay.querySelectorAll('.asg-vis-check:checked')].map(c => parseInt(c.dataset.id));
            if (!ids.length) return showToast('Selecciona al menos una visita', 'error');
            const enviarNotificacion = overlay.querySelector('#asg-notif').checked;

            // 🆕 Validar fechas: si alguna visita no tiene fecha de hoy, preguntar si cambiar
            const hoy = todayDate(); // YYYY-MM-DD local
            const visitasSel = ids.map(id => programadas.find(v => v.id === id)).filter(Boolean);
            const noEsHoy = visitasSel.filter(v => {
                const f = (v.fecha_programada || '').substring(0, 10);
                return f && f !== hoy;
            });
            let cambiarFechas = false;
            if (noEsHoy.length > 0) {
                const pregunta = `⚠️ ${noEsHoy.length} de ${visitasSel.length} visitas NO tienen fecha de hoy (${hoy}).\n\n¿Querés cambiar TODAS las visitas seleccionadas a la fecha de HOY?\n\n• OK = cambiar fechas a hoy\n• Cancelar = mantener fechas originales`;
                cambiarFechas = confirm(pregunta);
            }

            const confirmMsg = enviarNotificacion
                ? `¿Asignar ${ids.length} visitas${cambiarFechas ? ' con fecha de HOY' : ''}?\n\n📱 Se enviará WhatsApp a cada cliente con la fecha de su visita.`
                : `¿Asignar ${ids.length} visitas${cambiarFechas ? ' con fecha de HOY' : ''}?\n\n⚠️ Los clientes NO serán notificados.`;
            if (!confirm(confirmMsg)) return;
            const btn = overlay.querySelector('#asg-submit');
            btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Asignando…';
            let ok = 0, fail = 0, notificados = 0;
            const visitasAsignadasParaNotif = [];
            for (const id of ids) {
                try {
                    // Si se pidió cambiar fecha, hacerlo primero
                    if (cambiarFechas) {
                        try { await API.put(`/api/visitas-tecnicas/${id}`, { fecha_programada: hoy }); } catch {}
                    }
                    const data = await API.put(`/api/visitas-tecnicas/${id}/asignar`, { tecnicoId, enviarNotificacion: false });
                    ok++;
                    // Guardar info para notificación masiva si el cliente no estaba ya notificado
                    if (enviarNotificacion && data && !data.clienteNotificado) {
                        const visita = (cache.pendientes || []).find(v => v.id === id);
                        if (visita && (visita.cliente_telefono || visita.cliente_movil)) {
                            visitasAsignadasParaNotif.push({
                                id: visita.id,
                                cliente_telefono: visita.cliente_movil || visita.cliente_telefono,
                                cliente_nombre: visita.cliente_nombre,
                                // 🆕 Si cambiamos la fecha, mandar la nueva
                                fecha_programada: cambiarFechas ? hoy : visita.fecha_programada,
                            });
                        }
                    }
                } catch { fail++; }
                btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${ok}/${ids.length}…`;
            }
            // Si se pidió notificar y hay visitas con teléfono, llamar al endpoint masivo
            if (enviarNotificacion && visitasAsignadasParaNotif.length) {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Notificando…';
                try {
                    const r = await API.post('/api/enviar-notificaciones-visitas', { visitas: visitasAsignadasParaNotif });
                    notificados = r?.enviados || 0;
                } catch (e) { console.error('Error notif:', e); }
            }
            const msg = `✓ ${ok} asignadas${notificados ? ` · ${notificados} notificadas` : ''}${fail ? ` · ${fail} con error` : ''}`;
            showToast(msg, fail ? 'error' : 'success');
            overlay.remove();
            await loadAll();
        };
    }

    // ============ Cambiar fecha masivo ============
    function openCambiarFechaMasivo() {
        const todasLasVisitas = [
            ...(cache.pendientes || []),
            ...(cache.asignadas || [])
        ].filter(v => v.estado !== 'completada' && v.estado !== 'cancelada');
        if (!todasLasVisitas.length) { showToast('No hay visitas para cambiar fecha', 'info'); return; }
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const lblStyle = 'display:block; font-size:0.78em; font-weight:600; color:#555; margin-bottom:4px;';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header" style="background:linear-gradient(135deg,#f59e0b,#d97706);"><h3><i class="fas fa-calendar-alt"></i> Cambio de fecha masivo</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <label style="${lblStyle}">Nueva fecha programada *</label>
                    <input type="date" id="cfm-fecha" min="${todayDate()}" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:12px;">
                    <label style="${lblStyle}">Visitas a actualizar (${todasLasVisitas.length})</label>
                    <div style="max-height:280px; overflow-y:auto; border:1px solid #eee; border-radius:8px; padding:6px;">
                        <div style="padding:4px 0; font-size:0.78em;">
                            <label style="cursor:pointer;"><input type="checkbox" id="cfm-toggle-all" checked> <b>Todas</b></label>
                        </div>
                        <hr style="margin:6px 0; border:0; border-top:1px solid #eee;">
                        ${todasLasVisitas.map(v => `
                            <label style="display:block; padding:6px 4px; cursor:pointer; font-size:0.82em; border-bottom:1px solid #f5f5f5;">
                                <input type="checkbox" class="cfm-vis-check" data-id="${v.id}" checked>
                                <b>${escapeHtml(v.cliente_nombre || 'Cliente')}</b>
                                <div style="color:#666; font-size:0.92em; margin-left:22px;">
                                    📅 ${fmtFecha(v.fecha_programada)}${v.localidad ? ` · 📍 ${escapeHtml(v.localidad)}` : ''}
                                </div>
                                <div style="color:#999; font-size:0.85em; margin-left:22px;">
                                    🔧 ${escapeHtml(v.motivo_visita || 'Sin motivo')} · 👷 ${escapeHtml(v.tecnico_asignado_nombre || v.tecnico_nombre || 'Sin asignar')}
                                </div>
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="cfm-submit"><i class="fas fa-save"></i> Aplicar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.querySelector('#cfm-toggle-all').onchange = (e) => {
            overlay.querySelectorAll('.cfm-vis-check').forEach(c => c.checked = e.target.checked);
        };
        overlay.querySelector('#cfm-submit').onclick = async () => {
            const fecha = overlay.querySelector('#cfm-fecha').value;
            if (!fecha) return showToast('Selecciona una fecha', 'error');
            const ids = [...overlay.querySelectorAll('.cfm-vis-check:checked')].map(c => parseInt(c.dataset.id));
            if (!ids.length) return showToast('Selecciona al menos una visita', 'error');
            if (!confirm(`¿Cambiar fecha de ${ids.length} visitas a ${fecha}?`)) return;
            const btn = overlay.querySelector('#cfm-submit');
            btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 0…';
            let ok = 0, fail = 0;
            for (const id of ids) {
                try {
                    await API.put(`/api/visitas-tecnicas/${id}`, { fecha_programada: fecha });
                    ok++;
                } catch { fail++; }
                btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${ok}/${ids.length}…`;
            }
            showToast(`✓ ${ok} actualizadas${fail ? ' · ' + fail + ' con error' : ''}`, fail ? 'error' : 'success');
            overlay.remove();
            await loadAll();
        };
    }

    // ============ Reprogramar masivo (solo asignadas) ============
    function openReprogramarMasivo() {
        // Solo visitas asignadas (estado=asignada con técnico) — el día se acabó y hay que reprogramar
        const candidatos = (cache.asignadas || []).filter(v => v.tecnico_asignado_id && v.estado !== 'completada' && v.estado !== 'cancelada');
        if (!candidatos.length) { showToast('No hay visitas asignadas para reprogramar', 'info'); return; }
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const lblStyle = 'display:block; font-size:0.78em; font-weight:600; color:#555; margin-bottom:4px;';
        // Fecha por defecto: mañana
        const manana = new Date(); manana.setDate(manana.getDate() + 1);
        const fechaDefault = manana.toISOString().split('T')[0];
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:92vh;">
                <div class="modal-header" style="background:linear-gradient(135deg,#8b5cf6,#6d28d9);"><h3><i class="fas fa-calendar-day"></i> Reprogramar visitas</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <div style="background:#f5f3ff; padding:10px; border-radius:8px; font-size:0.82em; color:#6d28d9; margin-bottom:12px;">
                        <i class="fas fa-info-circle"></i> Las visitas seleccionadas <b>bajarán del técnico</b>, pasarán a <b>"sin asignar"</b> con la nueva fecha, y se enviará <b>mensaje de disculpa al cliente</b>.
                    </div>
                    <label style="${lblStyle}">Nueva fecha *</label>
                    <input type="date" id="rep-fecha" min="${todayDate()}" value="${fechaDefault}" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:12px;">
                    <label style="${lblStyle}">Mensaje custom (opcional)</label>
                    <textarea id="rep-mensaje" rows="3" placeholder="Deja vacío para usar el mensaje predeterminado. Variables: {NOMBRE}, {FECHA}" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:12px; font-family:inherit; resize:vertical;"></textarea>
                    <label style="${lblStyle}">Visitas a reprogramar (${candidatos.length})</label>
                    <div style="max-height:260px; overflow-y:auto; border:1px solid #eee; border-radius:8px; padding:6px;">
                        <div style="padding:4px 0; font-size:0.78em;">
                            <label style="cursor:pointer;"><input type="checkbox" id="rep-toggle-all" checked> <b>Todas</b></label>
                        </div>
                        <hr style="margin:6px 0; border:0; border-top:1px solid #eee;">
                        ${candidatos.map(v => `
                            <label style="display:block; padding:6px 4px; cursor:pointer; font-size:0.82em; border-bottom:1px solid #f5f5f5;">
                                <input type="checkbox" class="rep-vis-check" data-id="${v.id}" checked>
                                <b>${escapeHtml(v.cliente_nombre || 'Cliente')}</b>
                                <div style="color:#666; font-size:0.92em; margin-left:22px;">
                                    📅 ${fmtFecha(v.fecha_programada)}${v.localidad ? ` · 📍 ${escapeHtml(v.localidad)}` : ''} · 👷 ${escapeHtml(v.tecnico_asignado_nombre || 'Sin nombre')}
                                </div>
                                <div style="color:#999; font-size:0.85em; margin-left:22px;">${escapeHtml(v.motivo_visita || '')}</div>
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="rep-submit" style="background:#8b5cf6;"><i class="fas fa-calendar-check"></i> Reprogramar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.querySelector('#rep-toggle-all').onchange = (e) => {
            overlay.querySelectorAll('.rep-vis-check').forEach(c => c.checked = e.target.checked);
        };
        overlay.querySelector('#rep-submit').onclick = async () => {
            const nuevaFecha = overlay.querySelector('#rep-fecha').value;
            if (!nuevaFecha) return showToast('Selecciona una fecha', 'error');
            const mensajeCustom = overlay.querySelector('#rep-mensaje').value.trim();
            const visitaIds = [...overlay.querySelectorAll('.rep-vis-check:checked')].map(c => parseInt(c.dataset.id));
            if (!visitaIds.length) return showToast('Selecciona al menos una visita', 'error');
            if (!confirm(`¿Reprogramar ${visitaIds.length} visitas para ${nuevaFecha}?\n\nLas visitas:\n• Bajarán del técnico actual\n• Pasarán a "sin asignar"\n• Se enviará mensaje de disculpa por WhatsApp`)) return;
            const btn = overlay.querySelector('#rep-submit');
            btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reprogramando…';
            try {
                const data = await API.post('/api/visitas/reprogramar-masivo', {
                    visitaIds, nuevaFecha, mensajePersonalizado: mensajeCustom
                });
                if (data?.success) {
                    showToast(`✓ ${data.actualizadas} reprogramadas · ${data.notificados} notificados`, 'success');
                    overlay.remove();
                    await loadAll();
                } else {
                    showToast(data?.message || 'Error', 'error');
                    btn.disabled = false; btn.innerHTML = '<i class="fas fa-calendar-check"></i> Reprogramar';
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
                btn.disabled = false; btn.innerHTML = '<i class="fas fa-calendar-check"></i> Reprogramar';
            }
        };
    }

    // ============ Notificar masivo por WhatsApp ============
    function openNotifMasivo() {
        const candidatos = [...(cache.asignadas || []), ...(cache.pendientes || [])]
            .filter(v => v.estado !== 'completada' && v.estado !== 'cancelada' && (v.cliente_telefono || v.cliente_movil));
        if (!candidatos.length) { showToast('No hay visitas con teléfono para notificar', 'info'); return; }
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const lblStyle = 'display:block; font-size:0.78em; font-weight:600; color:#555; margin-bottom:4px;';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header" style="background:linear-gradient(135deg,#25d366,#128c7e);"><h3><i class="fab fa-whatsapp"></i> Notificar por WhatsApp</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <div style="background:#dcfce7; padding:8px; border-radius:6px; font-size:0.8em; color:#166534; margin-bottom:10px;">
                        <i class="fas fa-info-circle"></i> Envío de recordatorio de visita a cada cliente. Deja vacío para usar el mensaje predeterminado.
                    </div>
                    <label style="${lblStyle}">Mensaje personalizado (opcional)</label>
                    <textarea id="nm-mensaje" rows="3" placeholder="Hola {{nombre}}, recordamos su visita técnica programada para {{fecha}}. — SolucNet" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:12px; font-family:inherit; resize:vertical;"></textarea>
                    <label style="${lblStyle}">Visitas a notificar (${candidatos.length})</label>
                    <div style="max-height:240px; overflow-y:auto; border:1px solid #eee; border-radius:8px; padding:6px;">
                        <div style="padding:4px 0; font-size:0.78em;">
                            <label style="cursor:pointer;"><input type="checkbox" id="nm-toggle-all" checked> <b>Todas</b></label>
                        </div>
                        <hr style="margin:6px 0; border:0; border-top:1px solid #eee;">
                        ${candidatos.map(v => `
                            <label style="display:block; padding:6px 4px; cursor:pointer; font-size:0.82em; border-bottom:1px solid #f5f5f5;">
                                <input type="checkbox" class="nm-vis-check" data-id="${v.id}" data-tel="${escapeHtml(v.cliente_movil || v.cliente_telefono || '')}" data-nombre="${escapeHtml(v.cliente_nombre || '')}" data-fecha="${escapeHtml(v.fecha_programada || '')}" checked>
                                <b>${escapeHtml(v.cliente_nombre || 'Cliente')}</b> <span style="color:#16a34a;">📱 ${escapeHtml(v.cliente_movil || v.cliente_telefono)}</span>
                                <div style="color:#666; font-size:0.92em; margin-left:22px;">
                                    📅 ${fmtFecha(v.fecha_programada)}${v.localidad ? ` · 📍 ${escapeHtml(v.localidad)}` : ''}
                                </div>
                                <div style="color:#999; font-size:0.85em; margin-left:22px;">🔧 ${escapeHtml(v.motivo_visita || 'Sin motivo')}</div>
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="nm-submit" style="background:#25d366;"><i class="fab fa-whatsapp"></i> Enviar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.querySelector('#nm-toggle-all').onchange = (e) => {
            overlay.querySelectorAll('.nm-vis-check').forEach(c => c.checked = e.target.checked);
        };
        overlay.querySelector('#nm-submit').onclick = async () => {
            const mensajePersonalizado = overlay.querySelector('#nm-mensaje').value.trim();
            const checks = [...overlay.querySelectorAll('.nm-vis-check:checked')];
            if (!checks.length) return showToast('Selecciona al menos una visita', 'error');
            if (!confirm(`¿Enviar WhatsApp a ${checks.length} clientes?`)) return;
            const visitas = checks.map(c => ({
                id: parseInt(c.dataset.id),
                cliente_telefono: c.dataset.tel,
                cliente_nombre: c.dataset.nombre,
                fecha_programada: c.dataset.fecha
            }));
            const btn = overlay.querySelector('#nm-submit');
            btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando…';
            try {
                const data = await API.post('/api/enviar-notificaciones-visitas', { visitas, mensajePersonalizado });
                const ok = data?.enviados ?? 0;
                const err = data?.errores ?? 0;
                showToast(`✓ ${ok} enviados${err ? ' · ' + err + ' fallidos' : ''}`, err ? 'error' : 'success');
                overlay.remove();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
                btn.disabled = false; btn.innerHTML = '<i class="fab fa-whatsapp"></i> Enviar';
            }
        };
    }

    // ============ Ubicación técnicos ============
    async function openUbicaciones() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:85vh;">
                <div class="modal-header"><h3><i class="fas fa-map-marked-alt"></i> Ubicación de técnicos</h3><button class="modal-close" style="background:none; border:none; color:white; font-size:1.4em; cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;" id="ubic-body">
                    <div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Consultando ubicaciones…</div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        try {
            const data = await API.get('/api/tecnicos/ubicaciones');
            const ubs = data?.ubicaciones || data?.data || (Array.isArray(data) ? data : []);
            const body = overlay.querySelector('#ubic-body');
            if (!ubs.length) {
                body.innerHTML = `<div class="empty-state"><i class="fas fa-map"></i><p>Sin ubicaciones registradas</p></div>`;
                return;
            }
            body.innerHTML = ubs.map(u => {
                const tiempo = u.timestamp ? fmtFecha(u.timestamp) : '—';
                const lat = u.latitud || u.lat;
                const lng = u.longitud || u.lng;
                const mins = u.timestamp ? Math.floor((Date.now() - new Date(u.timestamp).getTime()) / 60000) : null;
                const recent = mins !== null && mins < 15;
                return `
                    <div style="background:white; padding:12px; border-radius:10px; margin-bottom:8px; border-left:3px solid ${recent ? '#16a34a' : '#999'}; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                        <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                            <div style="flex:1; min-width:0;">
                                <div style="font-weight:600;">${escapeHtml(u.tecnico_nombre || u.nombre || 'Técnico')}</div>
                                <div style="font-size:0.78em; color:#666; margin-top:2px;">
                                    <i class="fas fa-clock"></i> ${tiempo}
                                    ${mins !== null ? ` · hace ${mins < 60 ? mins + 'min' : Math.floor(mins/60) + 'h'}` : ''}
                                </div>
                                ${u.bateria != null ? `<div style="font-size:0.75em; color:#999; margin-top:2px;"><i class="fas fa-battery-half"></i> Batería: ${u.bateria}%</div>` : ''}
                            </div>
                            ${(lat && lng) ? `<button onclick="VisitasPage.openMap('${lat},${lng}')" style="background:#0066cc; color:white; border:none; padding:8px 12px; border-radius:6px; font-size:0.78em; cursor:pointer; flex-shrink:0;"><i class="fas fa-map"></i> Ver mapa</button>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        } catch (err) {
            overlay.querySelector('#ubic-body').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle" style="color:#dc3545;"></i><p>Error: ${escapeHtml(err.message)}</p></div>`;
        }
    }

    // ============ Acciones individuales sobre visita ============
    function exportarVisitaPDF(visitaId) {
        // El backend tiene /api/reportes/:id/pdf pero no /api/visitas/:id/pdf
        // Para visitas, usamos un fallback: si está completada, mostrar reporte; sino exportar como texto plano
        const v = findVisita(visitaId);
        if (!v) return;
        if (v.estado === 'completada') {
            // Buscar el reporte_id asociado y descargar
            const url = APP_CONFIG.SERVER_URL + `/api/reportes/${visitaId}/pdf?token=` + encodeURIComponent(API.getToken());
            // 🛡️ v2026-06-13: Capacitor 7 — `App.openUrl` ya no existe, usamos plugin Browser.
            try {
                if (window.Capacitor?.Plugins?.Browser?.open) { window.Capacitor.Plugins.Browser.open({ url, windowName: '_system' }); return; }
            } catch (e) { console.warn('[PDF] Browser.open failed:', e.message); }
            window.open(url, '_blank');
        } else {
            // Generar resumen imprimible de la visita programada
            const html = `
                <html><head><title>Visita #${v.id}</title>
                <style>body{font-family:Arial;padding:30px;}h1{color:#0066cc;}table{width:100%;border-collapse:collapse;margin-top:20px;}td{padding:6px;border-bottom:1px solid #ddd;}td:first-child{font-weight:bold;width:200px;color:#555;}</style>
                </head><body>
                <h1>Orden de visita técnica #${v.id}</h1>
                <table>
                    <tr><td>Cliente</td><td>${escapeHtml(v.cliente_nombre || '')}</td></tr>
                    <tr><td>Cédula</td><td>${escapeHtml(v.cliente_cedula || '')}</td></tr>
                    <tr><td>Teléfono</td><td>${escapeHtml(v.cliente_telefono || '')} / ${escapeHtml(v.cliente_movil || '')}</td></tr>
                    <tr><td>Dirección</td><td>${escapeHtml(v.cliente_direccion || '')}</td></tr>
                    <tr><td>Localidad</td><td>${escapeHtml(v.localidad || '')}</td></tr>
                    <tr><td>Motivo</td><td>${escapeHtml(v.motivo_visita || '')}</td></tr>
                    <tr><td>Fecha</td><td>${escapeHtml(v.fecha_programada || '')}</td></tr>
                    <tr><td>Técnico</td><td>${escapeHtml(v.tecnico_asignado_nombre || v.tecnico_nombre || 'Sin asignar')}</td></tr>
                    <tr><td>Notas</td><td>${escapeHtml(v.notas_admin || '')}</td></tr>
                    ${v.observacion_ultima_hora ? `<tr><td style="color:#f59e0b;">⚠️ Obs. urgente</td><td>${escapeHtml(v.observacion_ultima_hora)}</td></tr>` : ''}
                </table>
                <p style="margin-top:30px;color:#999;font-size:12px;">Generado desde SolucNet Admin v1.0.21 · ${new Date().toLocaleString()}</p>
                </body></html>
            `;
            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 30000);
        }
    }

    function findVisita(id) {
        for (const tab of Object.keys(cache)) {
            const found = (cache[tab] || []).find(v => v.id === id);
            if (found) return found;
        }
        return null;
    }

    async function duplicarVisita(visitaId) {
        const v = findVisita(visitaId);
        if (!v) return;
        if (!confirm(`¿Crear nueva visita duplicando los datos de #${v.id}?`)) return;
        try {
            const fd = new FormData();
            fd.append('cliente_id', v.cliente_id || '');
            fd.append('cliente_nombre', v.cliente_nombre || '');
            fd.append('cliente_cedula', v.cliente_cedula || '');
            fd.append('cliente_telefono', v.cliente_telefono || '');
            fd.append('cliente_movil', v.cliente_movil || '');
            fd.append('cliente_direccion', v.cliente_direccion || '');
            fd.append('cliente_coordenadas', v.cliente_coordenadas || '');
            fd.append('motivo_visita', v.motivo_visita || '');
            fd.append('fecha_programada', todayDate()); // fecha actual por defecto
            fd.append('localidad', v.localidad || '');
            fd.append('notas_admin', (v.notas_admin || '') + ' [Duplicado de #' + v.id + ']');
            fd.append('bd_origen', v.bd_origen || '');
            const r = await fetch(APP_CONFIG.SERVER_URL + '/api/visitas-tecnicas', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + API.getToken() },
                body: fd
            });
            const data = await r.json();
            if (data?.success) {
                showToast('Visita duplicada', 'success');
                document.querySelector('.modal-overlay')?.remove();
                await loadAll();
            } else { showToast(data?.message || 'Error', 'error'); }
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function obsUrgente(visitaId) {
        const obs = prompt('Observación urgente (se mostrará destacada al técnico):');
        if (!obs || !obs.trim()) return;
        try {
            await API.post('/api/agregar-observacion-urgente', { visitaId, observacion: obs.trim() });
            showToast('Observación enviada', 'success');
            document.querySelector('.modal-overlay')?.remove();
            await loadAll();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function marcarEnProgreso(visitaId) {
        if (!confirm('¿Marcar la visita como En progreso?')) return;
        try {
            await API.put(`/api/visitas-tecnicas/${visitaId}`, { estado: 'en_progreso' });
            showToast('Visita marcada en progreso', 'success');
            document.querySelector('.modal-overlay')?.remove();
            await loadAll();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function abrirOnusCriticas() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:92vh;">
                <div class="modal-header" style="background:linear-gradient(135deg,#dc2626,#991b1b);"><h3><i class="fas fa-exclamation-triangle"></i> ONUs con señal crítica</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;"><div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Consultando ONUs críticas…</div></div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        try {
            const data = await API.get('/api/visitas/onus-criticas');
            if (!data?.success) throw new Error(data?.message || 'Error');
            const { identificadas = [], no_identificadas = [], total = 0 } = data;
            const body = overlay.querySelector('.modal-body');
            if (total === 0) {
                body.innerHTML = `<div class="empty-state"><i class="fas fa-check-circle" style="color:#16a34a;"></i><p>No hay ONUs con señal crítica</p></div>`;
                return;
            }
            const conVisita = identificadas.filter(o => o.visita);
            const sinVisita = identificadas.filter(o => !o.visita);
            body.innerHTML = `
                <div style="background:#fef2f2; padding:10px; border-radius:8px; margin-bottom:10px; font-size:0.82em;">
                    Total: <b>${total}</b> · Con visita: <b style="color:#16a34a;">${conVisita.length}</b> · Sin visita: <b style="color:#dc2626;">${sinVisita.length + no_identificadas.length}</b>
                </div>
                ${sinVisita.length ? `<div style="font-weight:600; color:#dc2626; font-size:0.85em; margin:10px 0 6px;"><i class="fas fa-user"></i> Identificadas sin visita (${sinVisita.length})</div>${sinVisita.map(o => renderOnuCritica(o, true)).join('')}` : ''}
                ${no_identificadas.length ? `<div style="font-weight:600; color:#dc2626; font-size:0.85em; margin:10px 0 6px;"><i class="fas fa-question-circle"></i> No identificadas (${no_identificadas.length})</div>${no_identificadas.map(o => renderOnuCritica(o, false)).join('')}` : ''}
                ${conVisita.length ? `<div style="font-weight:600; color:#16a34a; font-size:0.85em; margin:10px 0 6px;"><i class="fas fa-check"></i> Ya con visita (${conVisita.length})</div>${conVisita.map(o => renderOnuCritica(o, false, true)).join('')}` : ''}
            `;
        } catch (err) {
            overlay.querySelector('.modal-body').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle" style="color:#dc3545;"></i><p>Error: ${escapeHtml(err.message)}</p></div>`;
        }
    }

    function renderOnuCritica(o, puedeCrear, yaConVisita) {
        const rxColor = (o.rx_power == null) ? '#999' : (o.rx_power > -25 ? '#16a34a' : o.rx_power > -28 ? '#f59e0b' : '#dc2626');
        return `
            <div style="background:white; padding:10px; border-radius:8px; margin-bottom:5px; border-left:3px solid ${yaConVisita ? '#16a34a' : '#dc2626'};">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:0.88em;">${escapeHtml(o.cliente_nombre || o.descripcion || o.serial || 'ONU')}</div>
                        <div style="font-size:0.74em; color:#666; margin-top:2px; font-family:monospace;">${escapeHtml(o.serial || '—')} · PON ${o.pon_port || '?'}/${o.onu_id || '?'}</div>
                        <div style="font-size:0.76em; margin-top:3px;"><span style="color:${rxColor}; font-weight:600;">RX: ${o.rx_power != null ? o.rx_power.toFixed(2) + ' dBm' : '—'}</span></div>
                        ${yaConVisita ? `<div style="font-size:0.72em; color:#16a34a; margin-top:2px;"><i class="fas fa-check"></i> Visita #${o.visita.id} (${escapeHtml(o.visita.estado)})</div>` : ''}
                    </div>
                    ${puedeCrear ? `<button onclick="VisitasPage.crearVisitaCritica('${escapeHtml(o.cedula || '')}', '${escapeHtml(o.cliente_nombre || '')}', '${escapeHtml(o.serial || '')}')" style="background:#dc2626; color:white; border:none; padding:6px 10px; border-radius:5px; font-size:0.72em; cursor:pointer;"><i class="fas fa-plus"></i> Crear</button>` : ''}
                </div>
            </div>
        `;
    }

    function crearVisitaCritica(cedula, nombre, serial) {
        document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
        openCrearModal();
        setTimeout(() => {
            const inp = document.getElementById('vis-buscar');
            if (inp && cedula) {
                inp.value = cedula;
                inp.dispatchEvent(new Event('input'));
            }
            setTimeout(() => {
                const motivo = document.getElementById('vis-motivo');
                if (motivo) {
                    motivo.value = 'Luz roja en el equipo';
                    motivo.dispatchEvent(new Event('change'));
                }
                const notas = document.getElementById('vis-notas');
                if (notas) notas.value = `ONU con señal crítica detectada. Serial: ${serial}`;
            }, 400);
        }, 200);
    }

    // ═══════════════ 🆕 2026-10-07 VISITA A CAMPO (a un sitio/punto, sin cliente) ═══════════════
    // Crea una visita tipo 'campo' (coordenada + fotos + materiales al completar; sin equipos/caja/firma).
    // Funciona OFFLINE 100%: si no hay red (o el POST falla), se guarda en localStorage y se reintenta
    // al reconectar (flush en 'online' y al abrir la pestaña). No lleva archivos → payload JSON simple.
    const _CAMPO_PEND_KEY = 'visitas_campo_pendientes';
    function _campoPendientes() { try { return JSON.parse(localStorage.getItem(_CAMPO_PEND_KEY) || '[]'); } catch (e) { return []; } }
    function _campoGuardarPend(list) { try { localStorage.setItem(_CAMPO_PEND_KEY, JSON.stringify(list)); } catch (e) {} }

    // 🆕 2026-10-08: data URL (base64) → Blob, para enviar la foto como archivo (y poder guardarla
    // offline en la cola como base64 y reconstruirla al reconectar).
    function _dataUrlToBlob(dataUrl) {
        try {
            const [cab, b64] = String(dataUrl).split(',');
            const mime = (cab.match(/data:([^;]+)/) || [,'image/jpeg'])[1];
            const bin = atob(b64); const len = bin.length; const arr = new Uint8Array(len);
            for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
            return new Blob([arr], { type: mime });
        } catch (e) { return null; }
    }

    async function _postVisitaCampo(payload) {
        const fd = new FormData();
        fd.append('tipo_visita', 'campo');
        fd.append('cliente_nombre', payload.sitio);
        fd.append('motivo_visita', payload.motivo);
        if (payload.coordenadas) fd.append('cliente_coordenadas', payload.coordenadas);
        if (payload.localidad) fd.append('localidad', payload.localidad);
        if (payload.direccion) fd.append('cliente_direccion', payload.direccion);
        if (payload.fecha) fd.append('fecha_programada', payload.fecha);
        if (payload.notas) { fd.append('notas_admin', payload.notas); fd.append('observacion', payload.notas); }
        // Fotos (base64) → archivos_pdf (el backend ya acepta imágenes y las guarda como adjunto de la visita).
        if (Array.isArray(payload.fotos)) {
            payload.fotos.forEach((durl, i) => { const b = _dataUrlToBlob(durl); if (b) fd.append('archivos_pdf', b, `foto_campo_${Date.now()}_${i}.jpg`); });
        }
        // Timeout con AbortController: si la subida se traba, NO dejar el botón colgado;
        // se trata como "sin red" y cae a la cola offline.
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 45000);
        let r;
        try {
            r = await fetch(APP_CONFIG.SERVER_URL + '/api/visitas-tecnicas', {
                method: 'POST', headers: { 'Authorization': 'Bearer ' + API.getToken() }, body: fd, signal: ctrl.signal
            });
        } catch (e) {
            throw Object.assign(new Error('No se pudo conectar (sin red o tiempo agotado)'), { network: true });
        } finally { clearTimeout(to); }
        let data = null;
        try { data = await r.json(); } catch (e) { /* respuesta no-JSON */ }
        if (r.ok && data && data.success) return data;
        // El server respondió con un mensaje (p.ej. "Máximo 5 archivos", validación) → rechazo real.
        if (data && (data.message || data.success === false)) throw Object.assign(new Error(data.message || 'Rechazado por el servidor'), { serverRejected: true });
        // Sin JSON útil (502/500/HTML, server reiniciando) → transitorio: encolar.
        throw Object.assign(new Error('HTTP ' + r.status), { network: true });
    }

    async function _flushVisitasCampoPendientes() {
        if (!navigator.onLine) return;
        let pend = _campoPendientes();
        if (!pend.length) return;
        const quedan = [];
        for (const p of pend) {
            try { await _postVisitaCampo(p); } catch (e) { quedan.push(p); }
        }
        _campoGuardarPend(quedan);
        const enviadas = pend.length - quedan.length;
        if (enviadas > 0) { try { showToast(`${enviadas} visita(s) a campo sincronizada(s) ✓`, 'success'); } catch (e) {} try { await loadAll(); } catch (e) {} }
    }
    try { window.addEventListener('online', () => { _flushVisitasCampoPendientes(); }); } catch (e) {}

    function openCrearCampoModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const minFecha = todayDate();
        const lbl = 'display:block; font-weight:600; font-size:0.82em; color:#555; margin:12px 0 5px;';
        const inp = 'width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.95em; box-sizing:border-box;';
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:94vh;">
                <div class="modal-header" style="background:linear-gradient(135deg,#0ea5e9,#0369a1); color:#fff;">
                    <h3><i class="fas fa-map-marked-alt"></i> Nueva Visita a Campo</h3>
                    <button class="icon-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body" style="padding:16px;">
                    <p style="font-size:0.8em; color:#666; margin:0 0 6px;"><i class="fas fa-info-circle"></i> Visita a un <b>sitio/punto</b> (sin cliente). Al completarla el técnico solo registra <b>coordenada + fotos + materiales</b>.</p>
                    <label style="${lbl}">Sitio / Lugar *</label>
                    <input type="text" id="vc-sitio" placeholder="Ej: Caja NAP Reposo 12 / Poste CL 21 / Nodo Churidó" style="${inp}">
                    <label style="${lbl}">Motivo *</label>
                    <input type="text" id="vc-motivo" placeholder="Ej: Mantenimiento de caja / Revisión de red" style="${inp}">
                    <label style="${lbl}">Coordenada (lat,lng)</label>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <input type="text" id="vc-coord" placeholder="Tomala con GPS o escribila" style="${inp} flex:1;">
                        <button type="button" id="vc-gps" title="Tomar GPS" style="padding:10px 13px; background:#e0f2fe; color:#0369a1; border:1px solid #7dd3fc; border-radius:8px;"><i class="fas fa-location-crosshairs"></i></button>
                        <a id="vc-vermapa" href="#" target="_blank" rel="noopener" title="Ver en mapa" style="display:none; padding:10px 13px; background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; border-radius:8px; text-decoration:none;"><i class="fas fa-map-marked-alt"></i></a>
                    </div>
                    <small id="vc-coord-est" style="color:#888; font-size:.78em; display:block; margin-top:4px;">Tomala con GPS (en el sitio) o escribila.</small>
                    <label style="${lbl}">Foto(s) del sitio</label>
                    <div style="display:flex; gap:8px;">
                        <button type="button" id="vc-btn-camara" style="flex:1; padding:11px; background:#0ea5e9; color:#fff; border:none; border-radius:8px; font-weight:600;"><i class="fas fa-camera"></i><br><small>Tomar Foto</small></button>
                        <button type="button" id="vc-btn-galeria" style="flex:1; padding:11px; background:#10b981; color:#fff; border:none; border-radius:8px; font-weight:600;"><i class="fas fa-images"></i><br><small>Galería</small></button>
                    </div>
                    <input type="file" id="vc-foto-camara" accept="image/*" capture="environment" style="display:none;">
                    <input type="file" id="vc-foto-galeria" accept="image/*" multiple style="display:none;">
                    <div id="vc-fotos-prev" style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;"></div>
                    <label style="${lbl}">Localidad</label>
                    <select id="vc-localidad" style="${inp}">
                        <option value="">(Sin especificar)</option>
                        <option value="REPOSO">REPOSO</option><option value="SALVADOR">SALVADOR</option>
                        <option value="CHURIDO">CHURIDO</option><option value="SALSIPUEDES">SALSIPUEDES</option>
                        <option value="RIO GRANDE">RIO GRANDE</option><option value="OSITO">OSITO</option>
                        <option value="MI LUCHA">MI LUCHA</option><option value="BOSQUE">BOSQUE LOS ALMENDROS</option>
                    </select>
                    <label style="${lbl}">Dirección / referencia (opcional)</label>
                    <input type="text" id="vc-direccion" placeholder="Referencia del lugar" style="${inp}">
                    <label style="${lbl}">Fecha programada (opcional)</label>
                    <input type="date" id="vc-fecha" min="${minFecha}" style="${inp}">
                    <label style="${lbl}">Notas (opcional)</label>
                    <textarea id="vc-notas" rows="2" style="${inp} font-family:inherit;"></textarea>
                    <button id="vc-guardar" style="width:100%; margin-top:16px; padding:12px; background:linear-gradient(135deg,#0ea5e9,#0369a1); color:#fff; border:none; border-radius:8px; font-weight:600; cursor:pointer;">
                        <i class="fas fa-save"></i> Crear visita a campo
                    </button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        // Coordenada: tomar por GPS IGUAL que al completar una visita técnica (alta precisión,
        // hasta 5 reintentos buscando ≤9 m) o escribirla a mano.
        const _coordEl = overlay.querySelector('#vc-coord');
        const _estEl = overlay.querySelector('#vc-coord-est');
        const _mapaEl = overlay.querySelector('#vc-vermapa');
        function _refrescarMapa() {
            const m = (_coordEl.value || '').trim().match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
            if (m) { _mapaEl.href = 'https://www.google.com/maps?q=' + m[1] + ',' + m[2]; _mapaEl.style.display = ''; }
            else { _mapaEl.style.display = 'none'; }
        }
        _coordEl.addEventListener('input', _refrescarMapa);
        const _gpsBtn = overlay.querySelector('#vc-gps');
        _gpsBtn.onclick = function () {
            if (!navigator.geolocation) { _estEl.textContent = 'Sin GPS en este dispositivo; escribí la coordenada.'; _estEl.style.color = '#dc2626'; return; }
            _gpsBtn.disabled = true; const _htmlOrig = _gpsBtn.innerHTML; _gpsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            const intentar = (intento = 1, max = 5) => {
                _estEl.style.color = '#888'; _estEl.textContent = `📍 Obteniendo ubicación GPS… (intento ${intento}/${max})`;
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        const acc = pos.coords.accuracy;
                        _coordEl.value = pos.coords.latitude.toFixed(8) + ',' + pos.coords.longitude.toFixed(8);
                        _refrescarMapa();
                        if (acc <= 9 || intento >= max) {
                            _gpsBtn.disabled = false; _gpsBtn.innerHTML = _htmlOrig;
                            _estEl.style.color = acc <= 9 ? '#16a34a' : '#d97706';
                            _estEl.textContent = (acc <= 9 ? '✓ Precisión ' : '⚠️ Precisión ') + acc.toFixed(1) + ' m. Podés ajustarla a mano si hace falta.';
                        } else {
                            _estEl.textContent = `⚠️ Precisión ${acc.toFixed(1)} m. Reintentando… (${intento}/${max})`;
                            setTimeout(() => intentar(intento + 1, max), 2000);
                        }
                    },
                    (err) => {
                        if (intento < max && err.code !== err.PERMISSION_DENIED) { setTimeout(() => intentar(intento + 1, max), 2000); return; }
                        _gpsBtn.disabled = false; _gpsBtn.innerHTML = _htmlOrig;
                        _estEl.style.color = '#dc2626';
                        _estEl.textContent = (err.code === err.PERMISSION_DENIED ? 'Permiso de ubicación denegado — habilitalo o escribí la coordenada.' : 'No se pudo tomar la ubicación. Escribila a mano.');
                    },
                    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
                );
            };
            intentar();
        };
        // Foto(s): 2 botones (Tomar Foto / Galería) IGUAL que al completar una visita técnica,
        // acumulando en base64 (sirve online y para la cola offline).
        const _fotosCampo = [];
        // Comprime a JPEG (máx 1600px, calidad 0.7) para que la subida sea liviana y no se trabe
        // en datos móviles. Si algo falla, usa el original.
        function _comprimirImagen(file) {
            return new Promise((res) => {
                const r = new FileReader();
                r.onload = () => {
                    const img = new Image();
                    img.onload = () => {
                        try {
                            const MAX = 1600; let w = img.width, h = img.height;
                            if (w > MAX || h > MAX) { const s = Math.min(MAX / w, MAX / h); w = Math.round(w * s); h = Math.round(h * s); }
                            const c = document.createElement('canvas'); c.width = w; c.height = h;
                            c.getContext('2d').drawImage(img, 0, 0, w, h);
                            res(c.toDataURL('image/jpeg', 0.7));
                        } catch (e) { res(r.result); }
                    };
                    img.onerror = () => res(r.result);
                    img.src = r.result;
                };
                r.onerror = () => res(null);
                r.readAsDataURL(file);
            });
        }
        function _renderFotosCampo() {
            const cont = overlay.querySelector('#vc-fotos-prev'); cont.innerHTML = '';
            _fotosCampo.forEach((durl, idx) => {
                const wrap = document.createElement('div'); wrap.style.cssText = 'position:relative;';
                const img = document.createElement('img'); img.src = durl; img.style.cssText = 'width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid #ddd;';
                const x = document.createElement('button'); x.type = 'button'; x.innerHTML = '&times;'; x.style.cssText = 'position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:#ef4444;color:#fff;border:none;line-height:1;cursor:pointer;padding:0;';
                x.onclick = () => { _fotosCampo.splice(idx, 1); _renderFotosCampo(); };
                wrap.appendChild(img); wrap.appendChild(x); cont.appendChild(wrap);
            });
        }
        async function _agregarFotosCampo(input) {
            for (const f of Array.from(input.files || [])) {
                if (_fotosCampo.length >= 5) { showToast('Máximo 5 fotos por visita', 'warning'); break; }
                const d = await _comprimirImagen(f); if (d) _fotosCampo.push(d);
            }
            input.value = ''; _renderFotosCampo();
        }
        overlay.querySelector('#vc-btn-camara').onclick = () => overlay.querySelector('#vc-foto-camara').click();
        overlay.querySelector('#vc-btn-galeria').onclick = () => overlay.querySelector('#vc-foto-galeria').click();
        overlay.querySelector('#vc-foto-camara').addEventListener('change', function () { _agregarFotosCampo(this); });
        overlay.querySelector('#vc-foto-galeria').addEventListener('change', function () { _agregarFotosCampo(this); });

        overlay.querySelector('#vc-guardar').onclick = async function () {
            const btn = this;
            const sitio = (overlay.querySelector('#vc-sitio').value || '').trim();
            const motivo = (overlay.querySelector('#vc-motivo').value || '').trim();
            if (!sitio || !motivo) { showToast('El sitio y el motivo son obligatorios', 'error'); return; }
            btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando…';
            const fotos = _fotosCampo.slice();
            const payload = {
                sitio, motivo,
                coordenadas: (_coordEl.value || '').trim(),
                localidad: overlay.querySelector('#vc-localidad').value || '',
                direccion: (overlay.querySelector('#vc-direccion').value || '').trim(),
                fecha: overlay.querySelector('#vc-fecha').value || '',
                notas: (overlay.querySelector('#vc-notas').value || '').trim(),
                fotos
            };
            if (navigator.onLine) {
                try {
                    await _postVisitaCampo(payload);
                    showToast('Visita a campo creada ✓', 'success');
                    overlay.remove();
                    try { await loadAll(); } catch (e) {}
                    return;
                } catch (err) {
                    // Rechazo EXPLÍCITO del servidor → avisar y dejar corregir (no encolar).
                    if (err && err.serverRejected) {
                        showToast(err.message || 'El servidor rechazó la visita', 'error');
                        btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Crear visita a campo';
                        return;
                    }
                    // Red / timeout / otro → cae a la cola offline (abajo).
                }
            }
            // Offline (o no se pudo enviar ahora): encolar y avisar SIEMPRE (no se pierde).
            const pend = _campoPendientes(); pend.push(payload); _campoGuardarPend(pend);
            showToast('✓ Visita a campo guardada. Se enviará automáticamente cuando haya conexión 📶', 'success');
            overlay.remove();
            // Reintento en segundo plano por si ya hay señal.
            setTimeout(() => { try { _flushVisitasCampoPendientes(); } catch (e) {} }, 3000);
        };
    }

    return { show, openMap, openCrearModal, openCrearCampoModal, openClienteNuevoModal, openAsignarMasivo, openUbicaciones, openCambiarFechaMasivo, openNotifMasivo, openReprogramarMasivo, exportarVisitaPDF, duplicarVisita, obsUrgente, marcarEnProgreso, abrirOnusCriticas, crearVisitaCritica, _flushVisitasCampoPendientes };
})();

if (typeof Router !== 'undefined') Router.register('visitas', () => VisitasPage.show());
