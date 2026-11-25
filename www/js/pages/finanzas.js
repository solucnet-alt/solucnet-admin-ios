// 🆕 Página: Finanzas (períodos + gastos + CRUD + cerrar período)
const FinanzasPage = (function() {
    let periodos = [];
    let gastos = [];
    let categorias = [];
    let deudas = [];
    let lineas = [];
    let resumenMes = null;
    let mesActual = new Date().getMonth() + 1; // 1-12
    let anioActual = new Date().getFullYear();
    let activeTab = 'resumen';
    // 🆕 Filtros de gastos (igual que el web)
    let filtroPagado = '';      // '' | 'true' | 'false'
    let filtroEmpresa = '';     // '' | 'true' | 'false' (empresa | personal)
    let filtroCategoria = '';   // categoria_id o ''
    let filtroTipo = 'todos';   // 'todos' | 'gasto_fijo' | 'gasto_extra' | 'inversion' | 'ingreso'
    let filtroBuscar = '';

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    }

    function fmtMoney(n) {
        if (n == null) return '—';
        return '$ ' + Number(n).toLocaleString('es-CO', { maximumFractionDigits: 0 });
    }

    function fmtFecha(ts) {
        if (!ts) return '—';
        try { return new Date(ts).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' }); }
        catch { return '—'; }
    }

    const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

    function renderPeriodo(p) {
        const cerrado = p.cerrado === 1 || p.cerrado === true;
        return `
            <div data-id="${p.id}" style="background:white; border-radius:12px; padding:14px; margin-bottom:8px; box-shadow:0 1px 2px rgba(0,0,0,0.04); border-left:3px solid ${cerrado ? '#999' : '#16a34a'};">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:1em;">${MESES[(p.mes||1)-1]} ${p.anio || ''}</div>
                        <div style="font-size:0.78em; color:#666; margin-top:3px;">
                            <span style="color:#16a34a; cursor:pointer; text-decoration:underline dotted;" onclick="event.stopPropagation(); FinanzasPage.editarIngresoEstimado(${p.id}, ${p.total_ingresos || 0})">↑ Ingresos: ${fmtMoney(p.total_ingresos || 0)}</span>
                            · <span style="color:#dc3545;">↓ Gastos: ${fmtMoney(p.total_gastos || 0)}</span>
                        </div>
                        <div style="margin-top:5px;">
                            <button onclick="event.stopPropagation(); FinanzasPage.configurarInternet(${p.id})" style="background:#0066cc; color:white; border:none; padding:3px 8px; border-radius:4px; font-size:0.68em; cursor:pointer;"><i class="fas fa-globe"></i> Internet ISP</button>
                        </div>
                        <div style="font-size:0.9em; font-weight:600; margin-top:3px; color:${(p.total_ingresos - p.total_gastos) >= 0 ? '#16a34a' : '#dc3545'};">
                            Balance: ${fmtMoney((p.total_ingresos || 0) - (p.total_gastos || 0))}
                        </div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:5px; align-items:flex-end;">
                        <span style="background:${cerrado ? '#f3f4f6' : '#dcfce7'}; color:${cerrado ? '#666' : '#166534'}; font-size:0.7em; font-weight:600; padding:3px 8px; border-radius:8px;">${cerrado ? 'CERRADO' : 'ABIERTO'}</span>
                        ${cerrado
                            ? `<button onclick="FinanzasPage.reabrirPeriodo(${p.id})" style="background:#0066cc; color:white; border:none; padding:5px 10px; border-radius:5px; font-size:0.72em; cursor:pointer;"><i class="fas fa-unlock"></i> Reabrir</button>`
                            : `<button onclick="FinanzasPage.cerrarPeriodo(${p.id})" style="background:#f59e0b; color:white; border:none; padding:5px 10px; border-radius:5px; font-size:0.72em; cursor:pointer;"><i class="fas fa-lock"></i> Cerrar</button>`}
                        <button onclick="FinanzasPage.rolloverPeriodo(${p.id})" style="background:#6b7280; color:white; border:none; padding:5px 10px; border-radius:5px; font-size:0.72em; cursor:pointer;" title="Pasar pendientes al mes siguiente"><i class="fas fa-forward"></i> Rollover</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderGasto(g) {
        const pagado = g.pagado === 1 || g.pagado === true;
        return `
            <div data-id="${g.id}" style="background:white; border-radius:12px; padding:12px; margin-bottom:6px; box-shadow:0 1px 2px rgba(0,0,0,0.04); border-left:3px solid ${pagado ? '#16a34a' : '#dc3545'};">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                    <div style="flex:1; min-width:0; cursor:pointer;" onclick="FinanzasPage.editarGasto(${g.id})">
                        <div style="font-weight:600; font-size:0.92em;">${escapeHtml(g.descripcion || g.concepto || 'Gasto')}</div>
                        <div style="font-size:0.78em; color:#666; margin-top:2px;">${escapeHtml(g.categoria_nombre || g.categoria || '—')}</div>
                        ${g.notas ? `<div style="font-size:0.75em; color:#999; margin-top:2px;">${escapeHtml(g.notas)}</div>` : ''}
                        <div style="font-size:0.72em; color:#999; margin-top:2px;">${fmtFecha(g.fecha_pago || g.fecha)}${pagado ? ' · ✓ Pagado' : ' · ⏳ Pendiente'}</div>
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:5px; flex-shrink:0;">
                        <div style="font-size:1em; font-weight:700; color:#dc3545;">${fmtMoney(g.valor || g.monto)}</div>
                        <div style="display:flex; gap:4px;">
                            <button title="Subir comprobante" onclick="FinanzasPage.subirComprobante(${g.id})" style="background:#0066cc; color:white; border:none; padding:5px 7px; border-radius:5px; font-size:0.68em; cursor:pointer;"><i class="fas fa-paperclip"></i></button>
                            ${!pagado ? `<button title="Marcar pagado" onclick="FinanzasPage.pagarGasto(${g.id})" style="background:#16a34a; color:white; border:none; padding:5px 7px; border-radius:5px; font-size:0.68em; cursor:pointer;"><i class="fas fa-check"></i></button>` : ''}
                            <button title="Eliminar" onclick="FinanzasPage.eliminarGasto(${g.id})" style="background:#fee; color:#dc3545; border:none; padding:5px 7px; border-radius:5px; font-size:0.68em; cursor:pointer;"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async function loadPeriodos() {
        try {
            const data = await API.get('/api/finanzas/periodos');
            if (data?.error) return false;
            periodos = data?.periodos || (Array.isArray(data) ? data : []);
            return true;
        } catch { return false; }
    }

    async function loadGastos() {
        try {
            const data = await API.get('/api/finanzas/gastos?limit=100');
            gastos = data?.gastos || (Array.isArray(data) ? data : []);
        } catch { gastos = []; }
    }

    async function loadCategorias() {
        try {
            const data = await API.get('/api/finanzas/categorias');
            categorias = data?.categorias || (Array.isArray(data) ? data : []);
        } catch { categorias = []; }
    }

    function showToast(msg, type='info') {
        let t = document.getElementById('toast');
        if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
        t.className = 'toast show ' + type;
        t.textContent = msg;
        setTimeout(() => t.classList.remove('show'), 2500);
    }

    async function cerrarPeriodo(id) {
        if (!confirm('¿Cerrar este período? Los gastos pendientes pasarán al siguiente mes.')) return;
        try {
            await API.post(`/api/finanzas/periodos/${id}/cerrar`, {});
            showToast('Período cerrado ✓', 'success');
            await loadPeriodos();
            renderTab();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function reabrirPeriodo(id) {
        if (!confirm('¿Reabrir este período cerrado?')) return;
        try {
            await API.post(`/api/finanzas/periodos/${id}/reabrir`, {});
            showToast('Período reabierto ✓', 'success');
            await loadPeriodos();
            renderTab();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function pagarGasto(id) {
        const g = gastos.find(x => x.id === id);
        if (!g) return;
        const metodo = prompt('Método de pago (efectivo / transferencia / tarjeta):', g.metodo_pago || 'efectivo');
        if (metodo === null) return;
        try {
            await API.put(`/api/finanzas/gastos/${id}/pagar`, { metodo_pago: metodo.trim(), fecha_pago_real: new Date().toISOString().split('T')[0] });
            showToast('Gasto marcado como pagado ✓', 'success');
            await loadGastos();
            await loadPeriodos();
            renderTab();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function eliminarGasto(id) {
        if (!confirm('¿Eliminar este gasto?')) return;
        try {
            await API.del(`/api/finanzas/gastos/${id}`);
            showToast('Eliminado ✓', 'success');
            await loadGastos();
            await loadPeriodos();
            renderTab();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    function editarGasto(id) {
        const g = id ? gastos.find(x => x.id === id) : null;
        openGastoEditor(g);
    }

    function openGastoEditor(g) {
        const isEdit = !!g;
        const periodosAbiertos = periodos.filter(p => !(p.cerrado === 1 || p.cerrado === true));
        if (!isEdit && !periodosAbiertos.length) {
            showToast('No hay períodos abiertos', 'error');
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const lbl = 'display:block; font-size:0.78em; font-weight:600; color:#555; margin-bottom:4px;';
        const inp = 'width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:12px; font-size:0.95em; box-sizing:border-box;';
        const periodoOptions = periodosAbiertos.map(p => `<option value="${p.id}" ${g?.periodo_id === p.id ? 'selected' : ''}>${MESES[(p.mes||1)-1]} ${p.anio}</option>`).join('')
            || (g ? `<option value="${g.periodo_id}" selected>Período actual</option>` : '');
        const catOptions = categorias.map(c => `<option value="${c.id}" ${g?.categoria_id === c.id ? 'selected' : ''}>${escapeHtml(c.nombre)}</option>`).join('');

        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3><i class="fas fa-receipt"></i> ${isEdit ? 'Editar' : 'Nuevo'} gasto</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <label style="${lbl}">Período *</label>
                    <select id="gas-periodo" style="${inp}">${periodoOptions || '<option value="">Sin períodos</option>'}</select>
                    <label style="${lbl}">Categoría *</label>
                    <select id="gas-categoria" style="${inp}">${catOptions || '<option value="">Sin categorías</option>'}</select>
                    <label style="${lbl}">Descripción *</label>
                    <input type="text" id="gas-desc" value="${escapeHtml(g?.descripcion || '')}" placeholder="Concepto del gasto" style="${inp}">
                    <label style="${lbl}">Valor (COP) *</label>
                    <input type="number" id="gas-valor" value="${g?.valor || ''}" min="0" step="1000" placeholder="0" style="${inp}">
                    <label style="${lbl}">Fecha de pago</label>
                    <input type="date" id="gas-fecha" value="${g?.fecha_pago ? String(g.fecha_pago).substring(0,10) : new Date().toISOString().split('T')[0]}" style="${inp}">
                    <label style="${lbl}">Notas</label>
                    <textarea id="gas-notas" rows="2" placeholder="Notas u observaciones" style="${inp} font-family:inherit;">${escapeHtml(g?.notas || '')}</textarea>
                    <!-- Toggle ¿Ya pagado? -->
                    <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:#f9fafb; border-radius:8px; margin-bottom:10px;">
                        <span style="font-size:0.9em; font-weight:600; color:#374151;"><i class="fas fa-check-circle" style="color:#16a34a;"></i> Ya pagado</span>
                        <label class="switch-toggle">
                            <input type="checkbox" id="gas-pagado" ${g?.pagado ? 'checked' : ''} style="display:none;">
                            <span class="switch-slider"></span>
                        </label>
                    </div>
                    <!-- Toggle ¿De qué es? Empresa vs Personal -->
                    <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:#f9fafb; border-radius:8px; margin-bottom:10px;">
                        <span style="font-size:0.9em; font-weight:600; color:#374151;"><i class="fas fa-building" style="color:#2563eb;"></i> ¿De qué es el gasto?</span>
                        <label class="switch-toggle" title="ON = Empresa · OFF = Personal">
                            <input type="checkbox" id="gas-empresa" ${(g?.es_de_empresa ?? 1) ? 'checked' : ''} style="display:none;">
                            <span class="switch-slider" data-on="Empresa" data-off="Personal"></span>
                        </label>
                    </div>
                    <label style="${lbl}"><i class="fas fa-paperclip"></i> Adjuntar comprobantes (PDF / imágenes)</label>
                    <input type="file" id="gas-comprobantes" accept="image/*,.pdf" multiple style="${inp} padding:8px;">
                    <div style="font-size:0.72em; color:#888; margin-top:-8px;">Podés subir hasta 3 archivos a la vez. Se adjuntan al guardar.</div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="gas-save"><i class="fas fa-save"></i> Guardar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.querySelector('#gas-save').onclick = async () => {
            const data = {
                periodo_id: parseInt(overlay.querySelector('#gas-periodo').value) || null,
                categoria_id: parseInt(overlay.querySelector('#gas-categoria').value) || null,
                descripcion: overlay.querySelector('#gas-desc').value.trim(),
                valor: parseFloat(overlay.querySelector('#gas-valor').value) || 0,
                fecha_pago: overlay.querySelector('#gas-fecha').value || null,
                pagado: overlay.querySelector('#gas-pagado').checked,
                es_de_empresa: overlay.querySelector('#gas-empresa').checked,
                notas: overlay.querySelector('#gas-notas').value.trim(),
            };
            if (!data.periodo_id || !data.categoria_id || !data.descripcion || data.valor <= 0) {
                return showToast('Completa los campos obligatorios', 'error');
            }
            try {
                let gastoId = isEdit ? g.id : null;
                if (isEdit) {
                    await API.put(`/api/finanzas/gastos/${g.id}`, data);
                } else {
                    const resp = await API.post('/api/finanzas/gastos', data);
                    gastoId = resp?.id || resp?.gasto_id || null;
                }
                // 🆕 Subir comprobantes si seleccionó archivos
                const files = overlay.querySelector('#gas-comprobantes').files;
                if (files && files.length > 0 && gastoId) {
                    try {
                        const fd = new FormData();
                        for (const f of files) fd.append('archivos', f);
                        await fetch(APP_CONFIG.SERVER_URL + `/api/finanzas/gastos/${gastoId}/comprobante`, {
                            method: 'POST',
                            headers: { 'Authorization': 'Bearer ' + API.getToken() },
                            body: fd
                        });
                    } catch (upErr) {
                        showToast('Gasto guardado, pero error subiendo comprobantes: ' + upErr.message, 'error');
                    }
                }
                showToast(isEdit ? 'Actualizado ✓' : 'Creado ✓', 'success');
                overlay.remove();
                await loadGastos();
                await loadPeriodos();
                renderTab();
            } catch (err) { showToast('Error: ' + err.message, 'error'); }
        };
    }

    function renderTab() {
        const c = document.getElementById('finanzas-list');
        if (!c) return;
        document.querySelectorAll('#page-finanzas .tab-btn').forEach(btn => {
            const f = btn.dataset.tab;
            btn.classList.toggle('active', f === activeTab);
        });
        if (activeTab === 'resumen') {
            renderResumen(c);
        } else if (activeTab === 'gastos') {
            // 🆕 Filtrar gastos del mes seleccionado y aplicar filtros
            const periodoDelMes = periodos.find(p => p.mes === mesActual && p.anio === anioActual);
            const periodoId = periodoDelMes?.id;
            let gastosFiltrados = gastos.filter(g => {
                // Filtro mes
                if (periodoId && g.periodo_id) {
                    if (g.periodo_id !== periodoId) return false;
                } else {
                    const f = g.fecha_pago || g.fecha;
                    if (!f) return false;
                    const d = new Date(f);
                    if (d.getMonth() + 1 !== mesActual || d.getFullYear() !== anioActual) return false;
                }
                // Filtro pagado
                if (filtroPagado === 'true' && !(g.pagado === 1 || g.pagado === true)) return false;
                if (filtroPagado === 'false' && (g.pagado === 1 || g.pagado === true)) return false;
                // Filtro empresa/personal
                if (filtroEmpresa === 'true' && !(g.es_de_empresa === 1 || g.es_de_empresa === true)) return false;
                if (filtroEmpresa === 'false' && (g.es_de_empresa === 1 || g.es_de_empresa === true)) return false;
                // Filtro categoría
                if (filtroCategoria && String(g.categoria_id) !== String(filtroCategoria)) return false;
                // Filtro tipo
                if (filtroTipo !== 'todos' && g.categoria_tipo && g.categoria_tipo !== filtroTipo) return false;
                // Filtro búsqueda
                if (filtroBuscar) {
                    const q = filtroBuscar.toLowerCase();
                    const tex = (g.descripcion || '') + ' ' + (g.notas || '') + ' ' + (g.categoria_nombre || '');
                    if (!tex.toLowerCase().includes(q)) return false;
                }
                return true;
            }).sort((a, b) => {
                const da = new Date(a.fecha_pago || a.fecha || 0).getTime();
                const db = new Date(b.fecha_pago || b.fecha || 0).getTime();
                return db - da;
            });

            const totalFiltrado = gastosFiltrados.reduce((s, g) => s + (Number(g.valor || g.monto) || 0), 0);
            const pagados = gastosFiltrados.filter(g => g.pagado === 1 || g.pagado === true).length;

            // 🆕 Barra de filtros (estilo web admin)
            const inputCss = 'padding:7px 8px; border:1px solid #ddd; border-radius:6px; font-size:0.78em; background:white; width:100%; box-sizing:border-box;';
            const filtrosHtml = `
                <div style="background:white; padding:8px; border-radius:8px; margin-bottom:6px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                    <input type="text" id="gf-buscar" placeholder="🔍 Buscar concepto, notas, categoría..." value="${escapeHtml(filtroBuscar)}" style="${inputCss} margin-bottom:6px;">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:5px;">
                        <select id="gf-pagado" style="${inputCss}">
                            <option value="">📋 Todos</option>
                            <option value="true" ${filtroPagado==='true'?'selected':''}>✓ Pagados</option>
                            <option value="false" ${filtroPagado==='false'?'selected':''}>⏳ Pendientes</option>
                        </select>
                        <select id="gf-empresa" style="${inputCss}">
                            <option value="">🏢 Todos</option>
                            <option value="true" ${filtroEmpresa==='true'?'selected':''}>Empresa</option>
                            <option value="false" ${filtroEmpresa==='false'?'selected':''}>Personal</option>
                        </select>
                        <select id="gf-tipo" style="${inputCss}">
                            <option value="todos">🔖 Todos los tipos</option>
                            <option value="gasto_fijo" ${filtroTipo==='gasto_fijo'?'selected':''}>Fijos</option>
                            <option value="gasto_extra" ${filtroTipo==='gasto_extra'?'selected':''}>Extras</option>
                            <option value="inversion" ${filtroTipo==='inversion'?'selected':''}>Inversión</option>
                            <option value="ingreso" ${filtroTipo==='ingreso'?'selected':''}>Ingresos</option>
                        </select>
                        <select id="gf-categoria" style="${inputCss}">
                            <option value="">🏷️ Todas categ.</option>
                            ${categorias.map(c => `<option value="${c.id}" ${String(filtroCategoria)===String(c.id)?'selected':''}>${escapeHtml(c.nombre)}</option>`).join('')}
                        </select>
                    </div>
                    ${(filtroBuscar || filtroPagado || filtroEmpresa || filtroCategoria || filtroTipo !== 'todos') ? `
                        <button onclick="FinanzasPage.limpiarFiltrosGastos()" style="margin-top:6px; width:100%; padding:6px; background:#fef2f2; color:#dc2626; border:none; border-radius:6px; font-size:0.78em; cursor:pointer;"><i class="fas fa-times"></i> Limpiar filtros</button>
                    ` : ''}
                </div>
                <div style="background:#eff6ff; padding:8px 10px; border-radius:8px; margin-bottom:6px; font-size:0.84em;">
                    <b>${gastosFiltrados.length}</b> resultados · <b style="color:#16a34a;">${pagados} pagados</b> · Total: <b>${fmtMoney(totalFiltrado)}</b>
                </div>
            `;

            if (!gastosFiltrados.length) {
                c.innerHTML = filtrosHtml + `<div class="empty-state"><i class="fas fa-receipt"></i><p>Sin gastos con esos filtros</p></div>`;
            } else {
                c.innerHTML = filtrosHtml + gastosFiltrados.map(renderGasto).join('');
            }
            // Listeners de filtros
            const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
            document.getElementById('gf-buscar').addEventListener('input', debounce((e) => { filtroBuscar = e.target.value.trim(); renderTab(); }, 300));
            document.getElementById('gf-pagado').addEventListener('change', (e) => { filtroPagado = e.target.value; renderTab(); });
            document.getElementById('gf-empresa').addEventListener('change', (e) => { filtroEmpresa = e.target.value; renderTab(); });
            document.getElementById('gf-tipo').addEventListener('change', (e) => { filtroTipo = e.target.value; renderTab(); });
            document.getElementById('gf-categoria').addEventListener('change', (e) => { filtroCategoria = e.target.value; renderTab(); });
        } else if (activeTab === 'categorias') {
            if (!categorias.length) {
                c.innerHTML = `<div class="empty-state"><i class="fas fa-tags"></i><p>Sin categorías</p></div>`;
                return;
            }
            c.innerHTML = categorias.map(cat => `
                <div data-id="${cat.id}" style="background:white; border-radius:10px; padding:12px; margin-bottom:6px; border-left:3px solid ${cat.activo === 0 ? '#ccc' : '#16a34a'}; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-weight:600; font-size:0.92em;">${escapeHtml(cat.nombre || 'Sin nombre')}</div>
                        <div style="font-size:0.74em; color:#666; margin-top:2px;">${escapeHtml(cat.descripcion || cat.tipo || '—')}</div>
                    </div>
                    <button onclick="FinanzasPage.editarCategoria(${cat.id})" style="background:#0066cc; color:white; border:none; padding:6px 10px; border-radius:5px; font-size:0.72em; cursor:pointer;"><i class="fas fa-edit"></i></button>
                </div>
            `).join('');
        } else if (activeTab === 'lineas') {
            if (!lineas.length) {
                c.innerHTML = `<div class="empty-state"><i class="fas fa-phone"></i><p>Sin líneas telefónicas</p></div>`;
                return;
            }
            c.innerHTML = lineas.map(l => `
                <div data-id="${l.id}" style="background:white; border-radius:10px; padding:12px; margin-bottom:6px; border-left:3px solid ${l.activa === 0 ? '#ccc' : '#0066cc'}; display:flex; justify-content:space-between; align-items:center;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:0.9em;">${escapeHtml(l.numero || '?')} <span style="font-weight:normal; color:#666; font-size:0.85em;">${escapeHtml(l.operador || '')}</span></div>
                        <div style="font-size:0.78em; color:#666; margin-top:2px;">${escapeHtml(l.responsable || '—')} · ${escapeHtml(l.tipo || '')}</div>
                        <div style="font-size:0.8em; color:#dc3545; margin-top:2px;">${fmtMoney(l.costo_mensual || 0)}/mes</div>
                    </div>
                    <div style="display:flex; gap:4px;">
                        <button onclick="FinanzasPage.editarLinea(${l.id})" style="background:#0066cc; color:white; border:none; padding:6px 8px; border-radius:5px; font-size:0.7em; cursor:pointer;"><i class="fas fa-edit"></i></button>
                        <button onclick="FinanzasPage.eliminarLinea(${l.id})" style="background:#fee; color:#dc3545; border:none; padding:6px 8px; border-radius:5px; font-size:0.7em; cursor:pointer;"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            `).join('');
        } else if (activeTab === 'deudas') {
            if (!deudas.length) {
                c.innerHTML = `<div class="empty-state"><i class="fas fa-credit-card"></i><p>Sin deudas registradas</p></div>`;
                return;
            }
            c.innerHTML = deudas.map(d => {
                const pendiente = (d.valor_total || 0) - (d.valor_pagado || 0);
                const progreso = d.valor_total ? Math.min(100, ((d.valor_pagado || 0) / d.valor_total) * 100) : 0;
                const completada = pendiente <= 0;
                return `
                    <div data-id="${d.id}" style="background:white; border-radius:10px; padding:12px; margin-bottom:6px; border-left:3px solid ${completada ? '#16a34a' : '#dc3545'}; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                        <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
                            <div style="flex:1; min-width:0; cursor:pointer;" onclick="FinanzasPage.editarDeuda(${d.id})">
                                <div style="font-weight:600; font-size:0.92em;">${escapeHtml(d.descripcion || d.acreedor || 'Deuda')}</div>
                                <div style="font-size:0.78em; color:#666; margin-top:2px;">${escapeHtml(d.acreedor || '')} · Cuota ${d.cuotas_pagadas || 0}/${d.cuotas_total || '?'}</div>
                                <div style="margin-top:6px; background:#eee; border-radius:10px; height:6px; overflow:hidden;"><div style="height:100%; width:${progreso}%; background:${completada ? '#16a34a' : '#0066cc'};"></div></div>
                                <div style="font-size:0.78em; color:#666; margin-top:4px;">Total: <b>${fmtMoney(d.valor_total)}</b> · Pagado: <b style="color:#16a34a;">${fmtMoney(d.valor_pagado)}</b> · Falta: <b style="color:#dc3545;">${fmtMoney(pendiente)}</b></div>
                            </div>
                            <div style="display:flex; flex-direction:column; gap:4px;">
                                ${!completada ? `<button onclick="FinanzasPage.pagarCuota(${d.id})" style="background:#16a34a; color:white; border:none; padding:6px 10px; border-radius:5px; font-size:0.7em; cursor:pointer;"><i class="fas fa-money-bill"></i> Pago</button>` : ''}
                                <button onclick="FinanzasPage.eliminarDeuda(${d.id})" style="background:#fee; color:#dc3545; border:none; padding:6px 10px; border-radius:5px; font-size:0.7em; cursor:pointer;"><i class="fas fa-trash"></i></button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    async function loadResumen() {
        try {
            const data = await API.get(`/api/finanzas/resumen/${anioActual}/${mesActual}`);
            resumenMes = data?.resumen || data || null;
        } catch { resumenMes = null; }
    }

    function renderResumen(c) {
        const r = resumenMes;
        if (!r || !r.periodo) {
            c.innerHTML = `
                <div class="empty-state" style="padding:30px 16px;">
                    <i class="fas fa-calendar-times" style="color:#999;"></i>
                    <p>Sin período registrado para <b>${MESES[mesActual-1]} ${anioActual}</b></p>
                    <p style="font-size:0.78em; color:#888; margin-top:4px;">Cambiá de mes con las flechas o usá el web admin para crear el período</p>
                </div>
            `;
            return;
        }
        const p = r.periodo;
        // 🆕 Helper: convertir DECIMAL (string) a Number, manejar null/undefined
        const num = (v) => v == null ? 0 : (typeof v === 'number' ? v : parseFloat(v) || 0);

        // Ingresos: campo real en BD es `ingreso_estimado` (no `total_ingresos`)
        const ingresos = num(p.ingreso_estimado || p.total_ingresos || p.ingresos_estimados);

        // Totales por tipo (vienen como string "15427641.00")
        const porTipo = {};
        (r.totales || []).forEach(t => {
            porTipo[t.tipo] = {
                total: num(t.total),
                pagado: num(t.pagado),
                pendiente: num(t.pendiente),
                cantidad: t.cantidad || 0,
            };
        });
        const fijo = porTipo['gasto_fijo'] || { total: 0, pagado: 0, pendiente: 0, cantidad: 0 };
        const extra = porTipo['gasto_extra'] || { total: 0, pagado: 0, pendiente: 0, cantidad: 0 };
        const inversion = porTipo['inversion'] || { total: 0, pagado: 0, pendiente: 0, cantidad: 0 };

        // Total gastos = suma de fijos + extras (no inversión, eso es aparte para el balance)
        const totalGastos = fijo.total + extra.total + inversion.total;
        const totalPagado = fijo.pagado + extra.pagado + inversion.pagado;
        const totalPendiente = fijo.pendiente + extra.pendiente + inversion.pendiente;
        const balance = ingresos - totalGastos;
        const balanceColor = balance >= 0 ? '#16a34a' : '#dc3545';

        // KPI card
        const kpi = (titulo, valor, color, icon, sub) => `
            <div style="background:white; padding:12px; border-radius:10px; box-shadow:0 1px 2px rgba(0,0,0,0.04); flex:1; min-width:130px;">
                <div style="display:flex; align-items:center; gap:6px; font-size:0.72em; color:#666; margin-bottom:3px;">
                    <i class="${icon}" style="color:${color};"></i> ${titulo}
                </div>
                <div style="font-size:1.05em; font-weight:700; color:${color};">${valor}</div>
                ${sub ? `<div style="font-size:0.7em; color:#999; margin-top:2px;">${sub}</div>` : ''}
            </div>
        `;

        const cerrado = p.cerrado === 1 || p.cerrado === true;
        const proximosHtml = (r.proximosPagos || []).slice(0, 5).map(pg => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:#fff7ed; border-radius:6px; margin-bottom:4px; font-size:0.82em;">
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(pg.descripcion || pg.concepto || 'Gasto')}</div>
                    <div style="font-size:0.78em; color:#92400e;">${escapeHtml(pg.categoria_nombre || '')} · ${fmtFecha(pg.fecha_pago)}</div>
                </div>
                <div style="font-weight:700; color:#dc2626; flex-shrink:0;">${fmtMoney(num(pg.valor))}</div>
            </div>
        `).join('');

        // Por categoría (parsear total como número)
        const categoriasHtml = (r.porCategoria || []).map(cat => {
            const total = num(cat.total);
            const pct = totalGastos > 0 ? Math.round((total / totalGastos) * 100) : 0;
            const colorCat = cat.color || '#6b7280';
            // Resolver el ícono FontAwesome (BD guarda solo "fa-users" o "fa-tag")
            let iconClass = cat.icono || 'fa-tag';
            if (!iconClass.startsWith('fa')) iconClass = 'fa-' + iconClass;
            const iconFull = `fas ${iconClass}`;
            return `
                <div style="margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; font-size:0.84em; margin-bottom:3px;">
                        <span><i class="${iconFull}" style="color:${colorCat};"></i> ${escapeHtml(cat.nombre)} <span style="color:#999; font-size:0.85em;">(${cat.cantidad})</span></span>
                        <span style="font-weight:600;">${fmtMoney(total)} <span style="color:#999; font-size:0.85em;">${pct}%</span></span>
                    </div>
                    <div style="background:#eee; height:6px; border-radius:3px; overflow:hidden;">
                        <div style="height:100%; width:${pct}%; background:${colorCat};"></div>
                    </div>
                </div>
            `;
        }).join('');

        c.innerHTML = `
            <!-- Encabezado del período -->
            <div style="background:linear-gradient(135deg,${cerrado ? '#999' : '#0066cc'},${cerrado ? '#666' : '#0052a3'}); color:white; padding:14px; border-radius:12px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-size:1.1em; font-weight:700;">${MESES[mesActual-1]} ${anioActual}</div>
                    <div style="font-size:0.8em; opacity:0.9;">${cerrado ? '🔒 Cerrado' : '✓ Abierto'} · ${(r.proximosPagos || []).length} pagos pendientes</div>
                </div>
                <div style="text-align:right;">
                    ${cerrado
                        ? `<button onclick="FinanzasPage.reabrirPeriodo(${p.id})" style="background:rgba(255,255,255,0.2); border:1px solid rgba(255,255,255,0.4); color:white; padding:6px 12px; border-radius:6px; font-size:0.78em; cursor:pointer;"><i class="fas fa-unlock"></i> Reabrir</button>`
                        : `<button onclick="FinanzasPage.cerrarPeriodo(${p.id})" style="background:rgba(255,255,255,0.2); border:1px solid rgba(255,255,255,0.4); color:white; padding:6px 12px; border-radius:6px; font-size:0.78em; cursor:pointer;"><i class="fas fa-lock"></i> Cerrar</button>`}
                </div>
            </div>

            <!-- KPIs principales (grid 2x2) -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:10px;">
                ${kpi('Ingresos', fmtMoney(ingresos), '#16a34a', 'fas fa-arrow-down', '<a href="javascript:FinanzasPage.editarIngresoEstimado(' + p.id + ',' + ingresos + ')" style="color:#0066cc; text-decoration:underline;">Editar</a>')}
                ${kpi('Gastos', fmtMoney(totalGastos), '#dc3545', 'fas fa-arrow-up', `${fijo.cantidad + extra.cantidad + inversion.cantidad} mov.`)}
                ${kpi('Pagado', fmtMoney(totalPagado), '#0066cc', 'fas fa-check', `${totalGastos > 0 ? Math.round(totalPagado/totalGastos*100) : 0}% del total`)}
                ${kpi('Pendiente', fmtMoney(totalPendiente), '#f59e0b', 'fas fa-clock', `${totalGastos > 0 ? Math.round(totalPendiente/totalGastos*100) : 0}% del total`)}
            </div>
            <!-- Balance destacado -->
            <div style="background:linear-gradient(135deg,${balanceColor},${balanceColor}dd); color:white; padding:12px; border-radius:10px; margin-bottom:10px; text-align:center;">
                <div style="font-size:0.78em; opacity:0.9;"><i class="fas ${balance >= 0 ? 'fa-check-circle' : 'fa-exclamation-triangle'}"></i> BALANCE DEL MES</div>
                <div style="font-size:1.4em; font-weight:800; margin-top:3px;">${fmtMoney(balance)}</div>
                <div style="font-size:0.74em; opacity:0.9; margin-top:2px;">${balance >= 0 ? '✓ A favor' : '⚠️ En contra'}</div>
            </div>

            <!-- Desglose por tipo -->
            <div style="background:white; padding:12px; border-radius:10px; margin-bottom:10px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                <div style="font-weight:600; font-size:0.95em; margin-bottom:8px; color:#0066cc;"><i class="fas fa-chart-pie"></i> Desglose por tipo</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:0.85em;">
                    <div style="background:#fef2f2; padding:8px; border-radius:6px;">
                        <div style="color:#991b1b; font-size:0.75em;">Gastos fijos</div>
                        <div style="font-weight:700; color:#dc2626;">${fmtMoney(fijo.total)}</div>
                        <div style="font-size:0.72em; color:#666;">Pagado: ${fmtMoney(fijo.pagado)} · Pendiente: ${fmtMoney(fijo.pendiente)}</div>
                    </div>
                    <div style="background:#fff7ed; padding:8px; border-radius:6px;">
                        <div style="color:#9a3412; font-size:0.75em;">Gastos extras</div>
                        <div style="font-weight:700; color:#ea580c;">${fmtMoney(extra.total)}</div>
                        <div style="font-size:0.72em; color:#666;">Pagado: ${fmtMoney(extra.pagado)} · Pendiente: ${fmtMoney(extra.pendiente)}</div>
                    </div>
                    <div style="background:#eff6ff; padding:8px; border-radius:6px;">
                        <div style="color:#1e40af; font-size:0.75em;">Inversiones</div>
                        <div style="font-weight:700; color:#0066cc;">${fmtMoney(inversion.total)}</div>
                        <div style="font-size:0.72em; color:#666;">${inversion.cantidad} mov.</div>
                    </div>
                    <div style="background:#f0fdf4; padding:8px; border-radius:6px;">
                        <div style="color:#15803d; font-size:0.75em;">Legalizado</div>
                        <div style="font-weight:700; color:#16a34a;">${fmtMoney(num(r.legalizado?.legalizado))}</div>
                        <div style="font-size:0.72em; color:#666;">No leg.: ${fmtMoney(num(r.legalizado?.no_legalizado))}</div>
                    </div>
                </div>
            </div>

            ${(r.porCategoria && r.porCategoria.length) ? `
                <div style="background:white; padding:12px; border-radius:10px; margin-bottom:10px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                    <div style="font-weight:600; font-size:0.95em; margin-bottom:10px; color:#0066cc;"><i class="fas fa-tags"></i> Por categoría</div>
                    ${categoriasHtml}
                </div>
            ` : ''}

            ${proximosHtml ? `
                <div style="background:white; padding:12px; border-radius:10px; margin-bottom:10px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                    <div style="font-weight:600; font-size:0.95em; margin-bottom:8px; color:#dc2626;"><i class="fas fa-clock"></i> Próximos pagos pendientes</div>
                    ${proximosHtml}
                </div>
            ` : ''}

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:10px;">
                <button onclick="FinanzasPage.configurarInternet(${p.id})" style="padding:10px; background:#0066cc; color:white; border:none; border-radius:8px; font-size:0.84em; font-weight:600; cursor:pointer;"><i class="fas fa-globe"></i> Internet ISP</button>
                <button onclick="FinanzasPage.rolloverPeriodo(${p.id})" style="padding:10px; background:#6b7280; color:white; border:none; border-radius:8px; font-size:0.84em; font-weight:600; cursor:pointer;"><i class="fas fa-forward"></i> Rollover</button>
            </div>
        `;
    }

    async function loadDeudas() {
        try {
            const data = await API.get('/api/finanzas/deudas');
            deudas = data?.deudas || (Array.isArray(data) ? data : []);
        } catch { deudas = []; }
    }

    async function loadLineas() {
        try {
            const data = await API.get('/api/finanzas/lineas');
            lineas = data?.lineas || (Array.isArray(data) ? data : []);
        } catch { lineas = []; }
    }

    function editarLinea(id) {
        const l = id ? lineas.find(x => x.id === id) : null;
        openLineaEditor(l);
    }

    function openLineaEditor(l) {
        const isEdit = !!l;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const lbl = 'display:block; font-size:0.78em; font-weight:600; color:#555; margin-bottom:4px;';
        const inp = 'width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:12px; box-sizing:border-box;';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3><i class="fas fa-phone"></i> ${isEdit ? 'Editar' : 'Nueva'} línea telefónica</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <label style="${lbl}">Número *</label>
                    <input type="text" id="ln-num" value="${escapeHtml(l?.numero || '')}" style="${inp}">
                    <label style="${lbl}">Operador (Claro/Tigo/Movistar…)</label>
                    <input type="text" id="ln-op" value="${escapeHtml(l?.operador || '')}" style="${inp}">
                    <label style="${lbl}">Responsable / Asignado a</label>
                    <input type="text" id="ln-resp" value="${escapeHtml(l?.responsable || '')}" style="${inp}">
                    <label style="${lbl}">Tipo</label>
                    <select id="ln-tipo" style="${inp}">
                        <option value="empresarial" ${l?.tipo==='empresarial'?'selected':''}>Empresarial</option>
                        <option value="personal" ${l?.tipo==='personal'?'selected':''}>Personal</option>
                        <option value="postpago" ${l?.tipo==='postpago'?'selected':''}>Postpago</option>
                        <option value="prepago" ${l?.tipo==='prepago'?'selected':''}>Prepago</option>
                    </select>
                    <label style="${lbl}">Costo mensual COP</label>
                    <input type="number" id="ln-costo" value="${l?.costo_mensual || 0}" style="${inp}">
                    <label style="${lbl}">Notas</label>
                    <textarea id="ln-notas" rows="2" style="${inp} font-family:inherit;">${escapeHtml(l?.notas || '')}</textarea>
                    <label style="display:block; font-size:0.85em;"><input type="checkbox" id="ln-activa" ${(l?.activa !== 0) ? 'checked' : ''}> Activa</label>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="ln-save"><i class="fas fa-save"></i> Guardar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.querySelector('#ln-save').onclick = async () => {
            const data = {
                numero: overlay.querySelector('#ln-num').value.trim(),
                operador: overlay.querySelector('#ln-op').value.trim(),
                responsable: overlay.querySelector('#ln-resp').value.trim(),
                tipo: overlay.querySelector('#ln-tipo').value,
                costo_mensual: parseFloat(overlay.querySelector('#ln-costo').value) || 0,
                notas: overlay.querySelector('#ln-notas').value.trim(),
                activa: overlay.querySelector('#ln-activa').checked ? 1 : 0,
            };
            if (!data.numero) return showToast('Número requerido', 'error');
            try {
                if (isEdit) await API.put(`/api/finanzas/lineas/${l.id}`, data);
                else await API.post('/api/finanzas/lineas', data);
                showToast(isEdit ? 'Actualizada ✓' : 'Creada ✓', 'success');
                overlay.remove();
                await loadLineas();
                renderTab();
            } catch (err) { showToast('Error: ' + err.message, 'error'); }
        };
    }

    async function eliminarLinea(id) {
        if (!confirm('¿Eliminar esta línea telefónica?')) return;
        try {
            await API.del(`/api/finanzas/lineas/${id}`);
            showToast('Eliminada ✓', 'success');
            await loadLineas();
            renderTab();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function configurarInternet(periodoId) {
        let current = null;
        try {
            const data = await API.get(`/api/finanzas/internet?periodo_id=${periodoId}`);
            current = data?.internet?.[0] || data?.internet || null;
        } catch {}
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const lbl = 'display:block; font-size:0.78em; font-weight:600; color:#555; margin-bottom:4px;';
        const inp = 'width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:12px; box-sizing:border-box;';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header" style="background:linear-gradient(135deg,#0066cc,#0052a3);"><h3><i class="fas fa-globe"></i> Internet ISP del período</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <label style="${lbl}">Proveedor</label>
                    <input type="text" id="ind-prov" value="${escapeHtml(current?.proveedor || '')}" placeholder="Ej: ETB, ETP, etc." style="${inp}">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div><label style="${lbl}">Megas contratados</label><input type="number" id="ind-megas" value="${current?.megas || 0}" style="${inp}"></div>
                        <div><label style="${lbl}">Costo por mega COP</label><input type="number" id="ind-cmega" value="${current?.costo_mega || 0}" style="${inp}"></div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div><label style="${lbl}">Costo total COP</label><input type="number" id="ind-total" value="${current?.costo_total || 0}" style="${inp}"></div>
                        <div><label style="${lbl}">IVA %</label><input type="number" id="ind-iva" value="${current?.iva || 19}" style="${inp}"></div>
                    </div>
                    <label style="${lbl}">Notas</label>
                    <textarea id="ind-notas" rows="2" style="${inp} font-family:inherit;">${escapeHtml(current?.notas || '')}</textarea>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="ind-save"><i class="fas fa-save"></i> Guardar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.querySelector('#ind-save').onclick = async () => {
            const data = {
                periodo_id: periodoId,
                proveedor: overlay.querySelector('#ind-prov').value.trim(),
                megas: parseInt(overlay.querySelector('#ind-megas').value) || 0,
                costo_mega: parseFloat(overlay.querySelector('#ind-cmega').value) || 0,
                costo_total: parseFloat(overlay.querySelector('#ind-total').value) || 0,
                iva: parseFloat(overlay.querySelector('#ind-iva').value) || 0,
                notas: overlay.querySelector('#ind-notas').value.trim(),
            };
            try {
                await API.post('/api/finanzas/internet', data);
                showToast('Internet ISP guardado ✓', 'success');
                overlay.remove();
            } catch (err) { showToast('Error: ' + err.message, 'error'); }
        };
    }

    async function editarIngresoEstimado(periodoId, actual) {
        const valor = prompt('Ingreso estimado del período (COP):', actual || 0);
        if (valor === null) return;
        const n = parseFloat(valor);
        if (isNaN(n) || n < 0) return showToast('Valor inválido', 'error');
        try {
            await API.put(`/api/finanzas/periodos/${periodoId}`, { total_ingresos: n });
            showToast('Ingreso actualizado ✓', 'success');
            await loadPeriodos();
            renderTab();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    function editarDeuda(id) {
        const d = id ? deudas.find(x => x.id === id) : null;
        openDeudaEditor(d);
    }

    function openDeudaEditor(d) {
        const isEdit = !!d;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const lbl = 'display:block; font-size:0.78em; font-weight:600; color:#555; margin-bottom:4px;';
        const inp = 'width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:12px; box-sizing:border-box;';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3><i class="fas fa-credit-card"></i> ${isEdit ? 'Editar' : 'Nueva'} deuda</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <label style="${lbl}">Acreedor / Banco *</label>
                    <input type="text" id="d-acreedor" value="${escapeHtml(d?.acreedor || '')}" style="${inp}">
                    <label style="${lbl}">Descripción *</label>
                    <input type="text" id="d-desc" value="${escapeHtml(d?.descripcion || '')}" style="${inp}">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div><label style="${lbl}">Valor total (COP)</label><input type="number" id="d-total" value="${d?.valor_total || ''}" style="${inp}"></div>
                        <div><label style="${lbl}">Valor cuota</label><input type="number" id="d-cuota" value="${d?.valor_cuota || ''}" style="${inp}"></div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div><label style="${lbl}">Total cuotas</label><input type="number" id="d-tot-cuotas" value="${d?.cuotas_total || ''}" style="${inp}"></div>
                        <div><label style="${lbl}">Cuotas pagadas</label><input type="number" id="d-pag-cuotas" value="${d?.cuotas_pagadas || 0}" style="${inp}"></div>
                    </div>
                    <label style="${lbl}">Fecha primera cuota</label>
                    <input type="date" id="d-fecha" value="${d?.fecha_inicio ? String(d.fecha_inicio).substring(0,10) : ''}" style="${inp}">
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="d-save"><i class="fas fa-save"></i> Guardar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.querySelector('#d-save').onclick = async () => {
            const data = {
                acreedor: overlay.querySelector('#d-acreedor').value.trim(),
                descripcion: overlay.querySelector('#d-desc').value.trim(),
                valor_total: parseFloat(overlay.querySelector('#d-total').value) || 0,
                valor_cuota: parseFloat(overlay.querySelector('#d-cuota').value) || 0,
                cuotas_total: parseInt(overlay.querySelector('#d-tot-cuotas').value) || 0,
                cuotas_pagadas: parseInt(overlay.querySelector('#d-pag-cuotas').value) || 0,
                fecha_inicio: overlay.querySelector('#d-fecha').value || null,
            };
            if (!data.acreedor || !data.descripcion) return showToast('Falta acreedor/descripción', 'error');
            try {
                if (isEdit) await API.put(`/api/finanzas/deudas/${d.id}`, data);
                else await API.post('/api/finanzas/deudas', data);
                showToast(isEdit ? 'Actualizada ✓' : 'Creada ✓', 'success');
                overlay.remove();
                await loadDeudas();
                renderTab();
            } catch (err) { showToast('Error: ' + err.message, 'error'); }
        };
    }

    async function pagarCuota(id) {
        if (!confirm('¿Registrar pago de una cuota?')) return;
        try {
            await API.put(`/api/finanzas/deudas/${id}/pago-cuota`, {});
            showToast('Cuota registrada ✓', 'success');
            await loadDeudas();
            renderTab();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function eliminarDeuda(id) {
        if (!confirm('¿Eliminar esta deuda?')) return;
        try {
            await API.del(`/api/finanzas/deudas/${id}`);
            showToast('Eliminada ✓', 'success');
            await loadDeudas();
            renderTab();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function cambiarMes(delta) {
        mesActual += delta;
        if (mesActual < 1) { mesActual = 12; anioActual--; }
        if (mesActual > 12) { mesActual = 1; anioActual++; }
        document.getElementById('mes-label').textContent = `${MESES[mesActual-1]} ${anioActual}`;
        // Refrescar resumen para el nuevo mes
        if (activeTab === 'resumen') {
            const c = document.getElementById('finanzas-list');
            if (c) c.innerHTML = '<div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>';
            await loadResumen();
        }
        renderTab();
    }

    async function rolloverPeriodo(id) {
        if (!confirm('¿Hacer ROLLOVER de este período? Pasa el saldo y gastos pendientes al siguiente mes.')) return;
        try {
            await API.post(`/api/finanzas/periodos/${id}/rollover`, {});
            showToast('Rollover completado ✓', 'success');
            await loadPeriodos();
            renderTab();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function subirComprobante(gastoId) {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*,.pdf';
        inp.multiple = true;
        inp.onchange = async () => {
            if (!inp.files.length) return;
            const fd = new FormData();
            for (let i = 0; i < inp.files.length; i++) fd.append('archivos', inp.files[i]);
            try {
                const r = await fetch(APP_CONFIG.SERVER_URL + `/api/finanzas/gastos/${gastoId}/comprobante`, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + API.getToken() },
                    body: fd
                });
                const data = await r.json();
                if (data?.success) showToast('Comprobante subido ✓', 'success');
                else showToast('Error', 'error');
            } catch (err) { showToast('Error: ' + err.message, 'error'); }
        };
        inp.click();
    }

    function editarCategoria(id) {
        const cat = id ? categorias.find(c => c.id === id) : null;
        openCategoriaEditor(cat);
    }

    function openCategoriaEditor(cat) {
        const isEdit = !!cat;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const lbl = 'display:block; font-size:0.78em; font-weight:600; color:#555; margin-bottom:4px;';
        const inp = 'width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-bottom:12px; box-sizing:border-box;';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3><i class="fas fa-tag"></i> ${isEdit ? 'Editar' : 'Nueva'} categoría</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <label style="${lbl}">Nombre *</label>
                    <input type="text" id="cat-nombre" value="${escapeHtml(cat?.nombre || '')}" style="${inp}">
                    <label style="${lbl}">Descripción</label>
                    <input type="text" id="cat-desc" value="${escapeHtml(cat?.descripcion || '')}" style="${inp}">
                    <label style="${lbl}">Tipo</label>
                    <select id="cat-tipo" style="${inp}">
                        <option value="gasto" ${cat?.tipo === 'gasto' ? 'selected' : ''}>Gasto</option>
                        <option value="ingreso" ${cat?.tipo === 'ingreso' ? 'selected' : ''}>Ingreso</option>
                    </select>
                    <label style="display:block; font-size:0.85em;"><input type="checkbox" id="cat-activo" ${(cat?.activo !== 0) ? 'checked' : ''}> Activo</label>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="cat-save"><i class="fas fa-save"></i> Guardar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        overlay.querySelector('#cat-save').onclick = async () => {
            const data = {
                nombre: overlay.querySelector('#cat-nombre').value.trim(),
                descripcion: overlay.querySelector('#cat-desc').value.trim(),
                tipo: overlay.querySelector('#cat-tipo').value,
                activo: overlay.querySelector('#cat-activo').checked ? 1 : 0
            };
            if (!data.nombre) return showToast('Nombre requerido', 'error');
            try {
                if (isEdit) await API.put(`/api/finanzas/categorias/${cat.id}`, data);
                else await API.post('/api/finanzas/categorias', data);
                showToast(isEdit ? 'Actualizada ✓' : 'Creada ✓', 'success');
                overlay.remove();
                await loadCategorias();
                renderTab();
            } catch (err) { showToast('Error: ' + err.message, 'error'); }
        };
    }

    function show() {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const main = document.querySelector('.app-main');
        let page = document.getElementById('page-finanzas');
        if (!page) {
            page = document.createElement('div');
            page.id = 'page-finanzas';
            page.className = 'page';
            main.appendChild(page);
        }
        page.classList.add('active');
        page.innerHTML = `
            <div style="background:white; padding:8px; border-radius:10px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                <button onclick="FinanzasPage.cambiarMes(-1)" style="background:#f0f2f5; border:none; padding:8px 12px; border-radius:6px; cursor:pointer;"><i class="fas fa-chevron-left"></i></button>
                <span id="mes-label" style="font-weight:700; font-size:0.95em; color:#0066cc;">${MESES[mesActual-1]} ${anioActual}</span>
                <button onclick="FinanzasPage.cambiarMes(1)" style="background:#f0f2f5; border:none; padding:8px 12px; border-radius:6px; cursor:pointer;"><i class="fas fa-chevron-right"></i></button>
            </div>
            <div class="tabs-bar">
                <button class="tab-btn ${activeTab === 'resumen' ? 'active' : ''}" data-tab="resumen"><i class="fas fa-chart-pie"></i> Resumen</button>
                <button class="tab-btn ${activeTab === 'gastos' ? 'active' : ''}" data-tab="gastos"><i class="fas fa-receipt"></i> Gastos</button>
                <button class="tab-btn ${activeTab === 'deudas' ? 'active' : ''}" data-tab="deudas"><i class="fas fa-credit-card"></i> Deudas</button>
                <button class="tab-btn ${activeTab === 'lineas' ? 'active' : ''}" data-tab="lineas"><i class="fas fa-phone"></i> Líneas</button>
                <button class="tab-btn ${activeTab === 'categorias' ? 'active' : ''}" data-tab="categorias"><i class="fas fa-tags"></i> Categ.</button>
            </div>
            <div id="finanzas-list" style="margin-top:6px;">
                <div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>
            </div>
            <button class="fab" onclick="FinanzasPage.fabAction()" title="Nuevo">
                <i class="fas fa-plus"></i>
            </button>
        `;
        page.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                activeTab = btn.dataset.tab;
                if (activeTab === 'resumen' && !resumenMes) await loadResumen();
                if (activeTab === 'deudas' && !deudas.length) await loadDeudas();
                if (activeTab === 'lineas' && !lineas.length) await loadLineas();
                renderTab();
            });
        });
        (async () => {
            const ok = await loadPeriodos();
            if (!ok) {
                document.getElementById('finanzas-list').innerHTML = `<div class="empty-state" style="padding:40px 20px;">
                    <i class="fas fa-lock" style="color:#dc3545; font-size:2.5em; margin-bottom:10px;"></i>
                    <p style="font-weight:600;">Sin permiso Finanzas</p>
                    <p style="font-size:0.85em; margin-top:6px;">Requiere permiso <b>ver_finanzas</b>.</p>
                </div>`;
                return;
            }
            await Promise.all([loadGastos(), loadCategorias(), loadDeudas(), loadLineas(), loadResumen()]);
            renderTab();
        })();
    }

    function fabAction() {
        if (activeTab === 'categorias') editarCategoria(null);
        else if (activeTab === 'deudas') editarDeuda(null);
        else if (activeTab === 'lineas') editarLinea(null);
        else editarGasto();
    }

    function limpiarFiltrosGastos() {
        filtroBuscar = '';
        filtroPagado = '';
        filtroEmpresa = '';
        filtroCategoria = '';
        filtroTipo = 'todos';
        renderTab();
    }

    return { show, cerrarPeriodo, reabrirPeriodo, editarGasto, pagarGasto, eliminarGasto, editarCategoria, fabAction, editarDeuda, pagarCuota, eliminarDeuda, cambiarMes, rolloverPeriodo, subirComprobante, editarLinea, eliminarLinea, configurarInternet, editarIngresoEstimado, limpiarFiltrosGastos };
})();

if (typeof Router !== 'undefined') Router.register('finanzas', () => FinanzasPage.show());
