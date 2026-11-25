// 🆕 Página: Reportes de visitas completadas
const ReportesPage = (function() {
    let reportes = [];
    let filtros = { fechaDesde: '', fechaHasta: '', cliente: '' };

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    }

    function fmtFecha(ts) {
        if (!ts) return '—';
        try { return new Date(ts).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }
        catch { return '—'; }
    }

    function renderReporte(r) {
        return `
            <div class="rep-card" data-id="${r.id}" style="background:white; border-radius:12px; padding:14px; margin-bottom:8px; box-shadow:0 1px 2px rgba(0,0,0,0.04); border-left:4px solid ${r.tipo_reporte === 'cancelada' ? '#dc2626' : '#16a34a'}; cursor:pointer;">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:0.95em;">${escapeHtml(r.cliente_nombre || 'Cliente')}</div>
                        ${r.tipo_visita === 'campo' ? '<div style="display:inline-block; background:#1f2937; color:#fff; font-size:0.7em; font-weight:700; padding:1px 6px; border-radius:4px; margin-top:2px;"><i class="fas fa-map-marker-alt"></i> VISITA A CAMPO</div>' : ''}
                        ${r.tipo_reporte === 'cancelada' ? '<div style="display:inline-block; background:#dc2626; color:#fff; font-size:0.7em; font-weight:700; padding:1px 6px; border-radius:4px; margin-top:2px;"><i class="fas fa-ban"></i> VISITA CANCELADA</div>' : ''}
                        <div style="font-size:0.78em; color:#666; margin-top:2px;">
                            <i class="fas fa-clock"></i> ${fmtFecha(r.fecha_reporte)}
                            ${r.tecnico_nombre ? ` · <i class="fas fa-hard-hat"></i> ${escapeHtml(r.tecnico_nombre)}` : ''}
                        </div>
                    </div>
                    ${(r.tipo_visita !== 'campo' && r.cliente_satisfecho) ? `<i class="fas fa-smile" style="color:#16a34a; font-size:1.2em;" title="Cliente satisfecho"></i>` : ''}
                </div>
                ${(r.tipo_visita !== 'campo' && r.problemas_encontrados) ? `
                    <div style="margin-top:8px; padding:8px 10px; background:#fee2e2; border-left:3px solid #dc3545; border-radius:4px; font-size:0.82em;">
                        <div style="font-weight:600; color:#991b1b;">Problema</div>
                        <div style="color:#7f1d1d; margin-top:2px;">${escapeHtml(r.problemas_encontrados)}</div>
                    </div>
                ` : ''}
                ${(r.tipo_visita !== 'campo' && r.solucion_aplicada) ? `
                    <div style="margin-top:6px; padding:8px 10px; background:#dcfce7; border-left:3px solid #16a34a; border-radius:4px; font-size:0.82em;">
                        <div style="font-weight:600; color:#14532d;">Solución</div>
                        <div style="color:#166534; margin-top:2px;">${escapeHtml(r.solucion_aplicada)}</div>
                    </div>
                ` : ''}
                ${r.materiales_utilizados ? `
                    <div style="margin-top:6px; padding:6px 10px; background:#f0f9ff; border-radius:4px; font-size:0.78em; color:#075985;">
                        <i class="fas fa-tools"></i> ${escapeHtml(r.materiales_utilizados)}
                    </div>
                ` : ''}
                ${r.tiempo_trabajo ? `<div style="margin-top:6px; font-size:0.78em; color:#666;"><i class="fas fa-stopwatch"></i> ${escapeHtml(r.tiempo_trabajo)}</div>` : ''}
                ${r.requiere_seguimiento ? `<div style="margin-top:6px; font-size:0.78em; color:#f59e0b;"><i class="fas fa-exclamation-triangle"></i> Requiere seguimiento</div>` : ''}
                ${r.latitud && r.longitud ? `
                    <div style="margin-top:8px;">
                        <button onclick="ReportesPage.openMap(${r.latitud}, ${r.longitud})" style="background:#e8f4ff; color:#0066cc; border:none; padding:6px 12px; border-radius:6px; font-size:0.8em; cursor:pointer;">
                            <i class="fas fa-map-marker-alt"></i> Ubicación
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    function applyFiltros() {
        let lista = reportes;
        if (filtros.fechaDesde) {
            const desde = new Date(filtros.fechaDesde).getTime();
            lista = lista.filter(r => new Date(r.fecha_reporte).getTime() >= desde);
        }
        if (filtros.fechaHasta) {
            const hasta = new Date(filtros.fechaHasta + 'T23:59:59').getTime();
            lista = lista.filter(r => new Date(r.fecha_reporte).getTime() <= hasta);
        }
        if (filtros.cliente) {
            const q = filtros.cliente.toLowerCase();
            lista = lista.filter(r =>
                (r.cliente_nombre || '').toLowerCase().includes(q) ||
                (r.notas || '').toLowerCase().includes(q) ||
                (r.problemas_encontrados || '').toLowerCase().includes(q)
            );
        }
        return lista;
    }

    function renderList() {
        const lista = applyFiltros();
        const c = document.getElementById('reportes-list-container');
        if (!c) return;
        document.getElementById('reportes-count').textContent = `${lista.length} reportes`;
        if (!lista.length) {
            c.innerHTML = `<div class="empty-state"><i class="fas fa-file-alt"></i><p>No hay reportes con estos filtros</p></div>`;
            return;
        }
        c.innerHTML = lista.map(renderReporte).join('');
        c.querySelectorAll('.rep-card').forEach(el => {
            el.addEventListener('click', () => {
                const id = parseInt(el.dataset.id);
                const r = lista.find(x => x.id === id);
                if (r) verDetalle(r);
            });
        });
    }

    async function verDetalle(r) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        // 🆕 2026-10-13: visita a campo (sitio sin cliente) → ocultar lo que no aplica.
        const esCampo = (r.tipo_visita === 'campo');
        const row = (k, v, color) => v ? `<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f0f0f0; font-size:0.85em;"><span style="color:#666;">${k}</span><b style="text-align:right; max-width:60%; ${color?'color:'+color:''};">${escapeHtml(String(v))}</b></div>` : '';
        const block = (titulo, contenido, color) => contenido ? `<div style="background:${color}11; border-left:3px solid ${color}; padding:10px; border-radius:6px; margin-top:10px; font-size:0.84em;"><b style="color:${color};">${titulo}</b><div style="margin-top:3px; color:#333; white-space:pre-wrap;">${escapeHtml(contenido)}</div></div>` : '';
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:94vh;">
                <div class="modal-header"><h3><i class="fas fa-file-alt"></i> Detalle reporte #${r.id}</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;">
                    <div style="background:#f0f9ff; padding:10px; border-radius:8px; margin-bottom:10px;">
                        <div style="font-weight:600; font-size:0.95em;">${escapeHtml(r.cliente_nombre || (esCampo ? 'Sitio / punto' : 'Cliente'))}</div>
                        ${esCampo ? '<div style="font-size:0.72em; color:#1f2937; font-weight:700; margin-top:2px;"><i class="fas fa-map-marker-alt"></i> VISITA A CAMPO</div>' : `<div style="font-size:0.78em; color:#666; margin-top:2px;">${escapeHtml(r.cliente_cedula || '—')}${r.cliente_telefono ? ' · ' + escapeHtml(r.cliente_telefono) : ''}</div>`}
                    </div>
                    ${row('Técnico', r.tecnico_nombre)}
                    ${row('Motivo visita', r.motivo_visita)}
                    ${row('Fecha programada', r.fecha_programada ? fmtFecha(r.fecha_programada) : null)}
                    ${row('Fecha reporte', r.fecha_reporte ? fmtFecha(r.fecha_reporte) : null)}
                    ${row('Tiempo trabajo', r.tiempo_trabajo)}
                    ${esCampo ? '' : row('Cliente satisfecho', r.cliente_satisfecho === 'no' ? 'No' : 'Sí', r.cliente_satisfecho === 'no' ? '#dc3545' : '#16a34a')}
                    ${esCampo ? '' : row('Requiere seguimiento', r.requiere_seguimiento ? 'Sí' : 'No', r.requiere_seguimiento ? '#f59e0b' : null)}
                    ${row('Estado final', r.estado_final)}
                    ${esCampo ? '' : block('Problema encontrado', r.problemas_encontrados, '#dc3545')}
                    ${esCampo ? '' : block('Solución aplicada', r.solucion_aplicada, '#16a34a')}
                    ${block('Materiales usados', r.materiales_utilizados, '#0066cc')}
                    ${block('Notas técnico', r.notas, '#6b7280')}
                    ${(r.serial_equipo_retirado || r.serial_equipo_instalado) ? `
                        <div style="background:#fef3c7; padding:10px; border-radius:8px; margin-top:10px; font-size:0.84em;">
                            <div style="font-weight:600; color:#92400e; margin-bottom:4px;"><i class="fas fa-microchip"></i> Equipos</div>
                            ${r.serial_equipo_retirado ? `<div><b>Retirado:</b> <code>${escapeHtml(r.serial_equipo_retirado)}</code></div>` : ''}
                            ${r.serial_equipo_instalado ? `<div><b>Instalado:</b> <code>${escapeHtml(r.serial_equipo_instalado)}</code></div>` : ''}
                        </div>
                    ` : ''}
                    ${(r.latitud && r.longitud) ? `
                        <button onclick="ReportesPage.openMap(${r.latitud}, ${r.longitud})" style="margin-top:12px; width:100%; padding:10px; background:#0066cc; color:white; border:none; border-radius:8px; font-size:0.88em; font-weight:600; cursor:pointer;"><i class="fas fa-map-marker-alt"></i> Ver ubicación GPS</button>
                    ` : ''}
                    <div id="rep-fotos-${r.id}" style="margin-top:14px;"><div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando fotos…</div></div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cerrar</button>
                    <button class="btn-primary" onclick="ReportesPage.descargarPDF(${r.id})"><i class="fas fa-file-pdf"></i> Generar PDF</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        // Cargar fotos del reporte
        try {
            const data = await API.get(`/api/reportes/${r.id}/fotos`);
            const fotos = data?.fotos || [];
            const cont = document.getElementById(`rep-fotos-${r.id}`);
            if (!cont) return;
            if (!fotos.length) {
                cont.innerHTML = '<div style="color:#999; font-size:0.8em; text-align:center; padding:10px;">Sin fotos en este reporte</div>';
                return;
            }
            const resolve = (p) => p?.startsWith('http') ? p : APP_CONFIG.SERVER_URL + (p?.startsWith('/') ? p : '/'+p);
            cont.innerHTML = `
                <div style="font-weight:600; font-size:0.85em; margin-bottom:6px;"><i class="fas fa-camera"></i> Fotos (${fotos.length})</div>
                <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px;">
                    ${fotos.map(f => `<img src="${resolve(f.ruta_archivo)}" onclick="ReportesPage.openLightbox('${resolve(f.ruta_archivo)}')" style="width:100%; aspect-ratio:1; object-fit:cover; border-radius:6px; cursor:pointer; background:#eee;" loading="lazy">`).join('')}
                </div>
            `;
        } catch (err) {
            const cont = document.getElementById(`rep-fotos-${r.id}`);
            if (cont) cont.innerHTML = `<div style="color:#dc3545; font-size:0.8em;">Error cargando fotos</div>`;
        }
    }

    function descargarPDF(reporteId) {
        const url = APP_CONFIG.SERVER_URL + `/api/reportes/${reporteId}/pdf?token=` + encodeURIComponent(API.getToken());
        // 🛡️ v2026-06-13: Capacitor 7 quitó `App.openUrl` — la API correcta ahora es el
        // plugin `@capacitor/browser` (Browser.open). Sin esto el botón no hace nada.
        try {
            if (window.Capacitor?.Plugins?.Browser?.open) {
                window.Capacitor.Plugins.Browser.open({ url, windowName: '_system' });
                return;
            }
        } catch (e) { console.warn('[PDF] Browser.open failed:', e.message); }
        window.open(url, '_blank');
    }

    function openLightbox(src) {
        const box = document.createElement('div');
        box.className = 'lightbox';
        box.innerHTML = `<button class="lightbox-close" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button><img src="${src}">`;
        document.body.appendChild(box);
        box.addEventListener('click', e => { if (e.target === box) box.remove(); });
    }

    async function load() {
        const c = document.getElementById('reportes-list-container');
        if (c) c.innerHTML = `<div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando reportes…</div>`;
        try {
            const data = await API.get('/api/reportes-completados?limit=200');
            reportes = data?.reportes || (Array.isArray(data) ? data : []);
            renderList();
        } catch (err) {
            if (c) c.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle" style="color:#dc3545;"></i><p>Error: ${escapeHtml(err.message)}</p></div>`;
        }
    }

    function openMap(lat, lng) {
        const url = `https://www.google.com/maps?q=${lat},${lng}`;
        try {
            if (window.Capacitor?.Plugins?.Browser?.open) {
                window.Capacitor.Plugins.Browser.open({ url, windowName: '_system' });
                return;
            }
        } catch (e) { console.warn('[openMap] Browser.open failed:', e.message); }
        window.open(url, '_blank');
    }

    function show() {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const page = document.getElementById('page-reportes');
        if (!page) {
            // No existe div, crearlo
            const main = document.querySelector('.app-main');
            const div = document.createElement('div');
            div.id = 'page-reportes';
            div.className = 'page';
            main.appendChild(div);
        }
        const p = document.getElementById('page-reportes');
        p.classList.add('active');
        p.innerHTML = `
            <div style="display:flex; gap:6px; margin-bottom:8px;">
                <button id="rtab-visitas" onclick="ReportesPage.tab('visitas')" style="flex:1; padding:9px; border:none; border-radius:8px; font-weight:600; font-size:0.85em; cursor:pointer; background:#16a34a; color:#fff;"><i class="fas fa-file-alt"></i> Visitas</button>
                <button id="rtab-asistencia" onclick="ReportesPage.tab('asistencia')" style="flex:1; padding:9px; border:none; border-radius:8px; font-weight:600; font-size:0.85em; cursor:pointer; background:#e5e7eb; color:#374151;"><i class="fas fa-user-clock"></i> Asistencia</button>
            </div>
            <div id="reportes-tab-visitas">
                <div style="background:white; padding:12px; border-radius:12px; margin-bottom:8px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                    <div style="font-weight:600; font-size:0.95em; margin-bottom:8px;">
                        <i class="fas fa-file-alt" style="color:#16a34a;"></i> Reportes de visitas
                        <span id="reportes-count" style="font-weight:400; color:#666; font-size:0.85em; float:right;">…</span>
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <input type="date" id="reportes-desde" placeholder="Desde" style="flex:1; min-width:130px; padding:8px 10px; border:1px solid #ddd; border-radius:8px; font-size:0.85em;">
                        <input type="date" id="reportes-hasta" placeholder="Hasta" style="flex:1; min-width:130px; padding:8px 10px; border:1px solid #ddd; border-radius:8px; font-size:0.85em;">
                    </div>
                    <input type="text" id="reportes-buscar" placeholder="Buscar cliente o problema..." style="width:100%; margin-top:6px; padding:8px 10px; border:1px solid #ddd; border-radius:8px; font-size:0.85em;">
                    <button onclick="ReportesPage.exportarCSV()" style="width:100%; margin-top:6px; padding:8px; background:#16a34a; color:white; border:none; border-radius:8px; font-size:0.82em; font-weight:600; cursor:pointer;"><i class="fas fa-file-csv"></i> Exportar CSV</button>
                </div>
                <div id="reportes-list-container"></div>
            </div>
            <div id="reportes-tab-asistencia" style="display:none;">
                <div style="background:white; padding:10px 12px; border-radius:12px; margin-bottom:8px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                        <button onclick="ReportesPage.asistMes(-1)" style="border:1px solid #e5e7eb; background:#f8fafc; border-radius:8px; padding:7px 11px; cursor:pointer;"><i class="fas fa-chevron-left"></i></button>
                        <div id="asist-mes-label" onclick="ReportesPage.loadAsistencia('mes')" style="flex:1; text-align:center; font-weight:700; font-size:0.9em; text-transform:capitalize; cursor:pointer;">—</div>
                        <button onclick="ReportesPage.asistMes(1)" style="border:1px solid #e5e7eb; background:#f8fafc; border-radius:8px; padding:7px 11px; cursor:pointer;"><i class="fas fa-chevron-right"></i></button>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px; margin-top:8px;">
                        <input type="date" id="asist-fecha" onchange="ReportesPage.loadAsistencia('dia')" style="flex:1; padding:7px 10px; border:1px solid #ddd; border-radius:8px; font-size:0.85em;">
                        <span id="asist-count" style="color:#666; font-size:0.8em; white-space:nowrap;">…</span>
                    </div>
                </div>
                <div id="asistencia-list-container"></div>
            </div>
        `;
        document.getElementById('reportes-desde').addEventListener('change', (e) => { filtros.fechaDesde = e.target.value; renderList(); });
        document.getElementById('reportes-hasta').addEventListener('change', (e) => { filtros.fechaHasta = e.target.value; renderList(); });
        document.getElementById('reportes-buscar').addEventListener('input', (e) => { filtros.cliente = e.target.value.trim(); renderList(); });
        _asistLoaded = false;
        load();
    }

    // ── Sub-pestaña Asistencia (jornada de técnicos) ──
    let _asistLoaded = false;
    function _resolveUrl(p) { return p && p.startsWith('http') ? p : APP_CONFIG.SERVER_URL + (p && p.startsWith('/') ? p : '/' + p); }
    function tab(name) {
        const v = document.getElementById('reportes-tab-visitas');
        const a = document.getElementById('reportes-tab-asistencia');
        const bv = document.getElementById('rtab-visitas');
        const ba = document.getElementById('rtab-asistencia');
        if (!v || !a) return;
        if (name === 'asistencia') {
            v.style.display = 'none'; a.style.display = 'block';
            bv.style.background = '#e5e7eb'; bv.style.color = '#374151';
            ba.style.background = '#16a34a'; ba.style.color = '#fff';
            if (!_asistLoaded) loadAsistencia();
        } else {
            a.style.display = 'none'; v.style.display = 'block';
            ba.style.background = '#e5e7eb'; ba.style.color = '#374151';
            bv.style.background = '#16a34a'; bv.style.color = '#fff';
        }
    }
    let _asistMes = null;
    function _asistMesInit() { if (!_asistMes) _asistMes = new Date().toISOString().slice(0, 7); }
    function asistMes(delta) {
        _asistMesInit();
        const [y, m] = _asistMes.split('-').map(Number);
        _asistMes = new Date(y, m - 1 + delta, 1).toISOString().slice(0, 7);
        const f = document.getElementById('asist-fecha'); if (f) f.value = '';
        loadAsistencia('mes');
    }
    async function loadAsistencia(modo) {
        _asistLoaded = true; _asistMesInit();
        const c = document.getElementById('asistencia-list-container');
        const inp = document.getElementById('asist-fecha');
        const lbl = document.getElementById('asist-mes-label');
        let q;
        if (modo === 'dia' && inp && inp.value) { q = `?fecha=${inp.value}`; _asistMes = inp.value.slice(0, 7); }
        else { if (inp) inp.value = ''; q = `?mes=${_asistMes}`; }
        if (lbl) lbl.textContent = new Date(_asistMes + '-01T00:00:00').toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
        if (c) c.innerHTML = `<div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>`;
        try {
            const data = await API.get('/api/jornada/admin' + q);
            renderAsistencia((data && data.registros) || []);
        } catch (e) {
            if (c) c.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error cargando asistencia</p></div>`;
        }
    }
    function _asistCelda(m, color) {
        if (!m) return '<span style="color:#cbd5e1">—</span>';
        const hora = m.hora ? (m.hora.split(' ')[1] || m.hora) : '';
        const foto = m.foto_ruta ? `<span onclick="ReportesPage.openLightbox('${_resolveUrl(m.foto_ruta)}')" style="cursor:pointer">📷</span>` : '';
        const mapa = (m.latitud && m.longitud) ? `<span onclick="ReportesPage.openMap(${m.latitud}, ${m.longitud})" style="cursor:pointer">📍</span>` : '';
        return `<span style="color:${color};font-weight:600">${hora}</span> ${foto} ${mapa}`;
    }
    function renderAsistencia(regs) {
        const c = document.getElementById('asistencia-list-container');
        const cnt = document.getElementById('asist-count');
        if (!c) return;
        if (cnt) cnt.textContent = `${regs.length} marcas`;
        if (!regs.length) { c.innerHTML = `<div class="empty-state"><i class="fas fa-user-clock"></i><p>Sin registros</p></div>`; return; }
        const grupos = {};
        regs.forEach(x => { const k = x.fecha + '|' + x.tecnico_id; grupos[k] = grupos[k] || { fecha: x.fecha, nombre: x.tecnico_nombre || ('Técnico ' + x.tecnico_id) }; grupos[k][x.tipo] = x; });
        const filas = Object.values(grupos).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.nombre.localeCompare(b.nombre));
        let html = `<div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);"><table style="width:100%;border-collapse:collapse;font-size:0.82em;">
            <thead><tr style="background:#f8fafc;text-align:left;"><th style="padding:8px">Día</th><th style="padding:8px">Técnico</th><th style="padding:8px;text-align:center">Entr.</th><th style="padding:8px;text-align:center">Almuerzo</th><th style="padding:8px;text-align:center">Sal.</th></tr></thead><tbody>`;
        filas.forEach(g => {
            // Fecha en TODAS las filas (antes solo la 1ª del día → se veía desorganizado con varios técnicos)
            const fTxt = new Date(g.fecha + 'T00:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short' });
            html += `<tr style="border-top:1px solid #f1f5f9;"><td style="padding:7px 8px;white-space:nowrap"><b>${fTxt}</b></td><td style="padding:7px 8px">${escapeHtml(g.nombre)}</td>
                <td style="padding:7px 8px;text-align:center;white-space:nowrap">${_asistCelda(g.entrada, '#16a34a')}</td>
                <td style="padding:7px 8px;text-align:center;white-space:nowrap">${_asistAlmuerzo(g.almuerzo_inicio, g.almuerzo_fin)}</td>
                <td style="padding:7px 8px;text-align:center;white-space:nowrap">${_asistCelda(g.salida, '#f59e0b')}</td></tr>`;
        });
        html += '</tbody></table></div>';
        c.innerHTML = html;
    }
    function _asistAlmuerzo(ini, fin) {
        const h = m => (m && m.hora) ? (m.hora.split(' ')[1] || m.hora) : null;
        const hIni = h(ini), hFin = h(fin);
        if (!hIni && !hFin) return '<span style="color:#cbd5e1">—</span>';
        let dur = '';
        if (ini && fin && ini.hora && fin.hora) {
            const m = Math.round((new Date(fin.hora.replace(' ', 'T')) - new Date(ini.hora.replace(' ', 'T'))) / 60000);
            if (m > 0) dur = ` <span style="background:#eef2ff;color:#4338ca;border-radius:5px;padding:0 5px;font-size:.9em;">${Math.floor(m / 60)}h ${m % 60}m</span>`;
        }
        if (hIni && hFin) return `<span style="color:#2563eb;font-weight:600">${hIni}</span>–<span style="font-weight:600">${hFin}</span>${dur}`;
        if (hIni) return `<span style="color:#2563eb;font-weight:600">${hIni}</span> <span style="color:#f59e0b;font-size:.85em">(en curso)</span>`;
        return `<span style="color:#94a3b8">fin ${hFin}</span>`;
    }

    function exportarCSV() {
        const filtrados = applyFiltros();
        if (!filtrados.length) return;
        const headers = ['Fecha','Cliente','Teléfono','Técnico','Tipo','Problemas','Solución','Estado','Lat','Lng'];
        const rows = filtrados.map(r => [
            fmtFecha(r.fecha_reporte), r.cliente_nombre || '', r.cliente_telefono || '',
            r.tecnico_nombre || '', r.tipo_visita || '', r.problemas_encontrados || '',
            r.trabajo_realizado || r.solucion || '', r.estado_final || '',
            r.latitud || '', r.longitud || ''
        ]);
        const csv = '﻿' + [headers, ...rows].map(arr => arr.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `reportes-visitas-${Date.now()}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    return { show, openMap, exportarCSV, descargarPDF, openLightbox, tab, loadAsistencia, asistMes };
})();

if (typeof Router !== 'undefined') Router.register('reportes', () => ReportesPage.show());
