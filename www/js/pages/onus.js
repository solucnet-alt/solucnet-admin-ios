// 🆕 Página: ONUs pendientes (críticas)
// Consume /api/visitas/onus-criticas, muestra lista con tabs identificadas/no identificadas
const OnusPage = (function() {
    let onusData = { identificadas: [], no_identificadas: [] };
    let activeTab = 'no_identificadas';

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    }

    function colorRx(rx) {
        if (rx == null) return '#999';
        if (rx >= -22) return '#28a745';
        if (rx >= -25) return '#ffc107';
        if (rx >= -28) return '#fd7e14';
        return '#dc3545';
    }

    function rxLabel(rx) {
        if (rx == null) return 'Sin señal';
        if (rx >= -22) return 'Buena';
        if (rx >= -25) return 'Aceptable';
        if (rx >= -28) return 'Baja';
        return 'Crítica';
    }

    function renderOnu(o, isIdentificada) {
        const rxColor = colorRx(o.rx_power);
        return `
            <div class="onu-card" style="background:white; border-radius:12px; padding:14px; margin-bottom:8px; box-shadow:0 1px 2px rgba(0,0,0,0.04); border-left:4px solid ${rxColor};">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:0.95em; color:#1a1a1a; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${isIdentificada && o.cliente_nombre ? escapeHtml(o.cliente_nombre) : `<i class="fas fa-wifi"></i> ONU ${o.serial_number || ''}`}
                        </div>
                        <div style="font-size:0.78em; color:#666; margin-top:2px;">
                            ${escapeHtml(o.olt_name || 'OLT desconocida')} · Pon ${o.pon_port} / ONU ${o.onu_id}
                        </div>
                        ${o.serial_number ? `<div style="font-size:0.72em; color:#999; font-family:monospace; margin-top:2px;">${escapeHtml(o.serial_number)}</div>` : ''}
                        ${o.description ? `<div style="font-size:0.75em; color:#999; margin-top:2px;">📝 ${escapeHtml(o.description)}</div>` : ''}
                    </div>
                    <div style="text-align:right; flex-shrink:0;">
                        <div style="font-weight:700; font-size:1.05em; color:${rxColor};">${o.rx_power != null ? o.rx_power.toFixed(1) + ' dBm' : 'N/A'}</div>
                        <div style="font-size:0.72em; color:${rxColor}; font-weight:500;">${rxLabel(o.rx_power)}</div>
                    </div>
                </div>
                ${isIdentificada ? `
                    <div style="margin-top:10px; display:flex; gap:6px;">
                        <button onclick="OnusPage.crearVisitaIdentificada(${o.cliente_id || 0})" class="btn-primary" style="flex:1; padding:8px; font-size:0.85em; border-radius:6px;">
                            <i class="fas fa-tools"></i> Crear visita
                        </button>
                    </div>
                ` : `
                    <div style="margin-top:10px;">
                        <button onclick="OnusPage.crearVisitaManual('${escapeHtml(o.serial_number || '')}', '${escapeHtml(o.olt_name || '')}', ${o.pon_port}, ${o.onu_id}, ${o.rx_power || 0})" class="btn-primary" style="width:100%; padding:8px; font-size:0.85em; border-radius:6px;">
                            <i class="fas fa-user-plus"></i> Crear visita manual
                        </button>
                    </div>
                `}
            </div>
        `;
    }

    function renderList() {
        const list = activeTab === 'identificadas' ? onusData.identificadas : onusData.no_identificadas;
        const container = document.getElementById('onus-list-container');
        if (!container) return;
        // Update counters
        document.querySelectorAll('#page-onus .tab-btn').forEach(btn => {
            const f = btn.dataset.filter;
            const countEl = btn.querySelector('.count');
            if (countEl) countEl.textContent = f === 'identificadas' ? onusData.identificadas.length : onusData.no_identificadas.length;
            btn.classList.toggle('active', f === activeTab);
        });
        if (list.length === 0) {
            container.innerHTML = `<div class="empty-state"><i class="fas fa-check-circle" style="color:#28a745;"></i><p>No hay ONUs ${activeTab === 'identificadas' ? 'identificadas' : 'sin identificar'} críticas en este momento.</p></div>`;
            return;
        }
        container.innerHTML = list.map(o => renderOnu(o, activeTab === 'identificadas')).join('');
    }

    async function load() {
        const container = document.getElementById('onus-list-container');
        if (container) container.innerHTML = `<div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando ONUs críticas…</div>`;
        try {
            const data = await API.get('/api/visitas/onus-criticas');
            onusData = {
                identificadas: data?.identificadas || [],
                no_identificadas: data?.no_identificadas || []
            };
            renderList();
            // Badge en bottom nav
            const total = onusData.identificadas.length + onusData.no_identificadas.length;
            const navBadge = document.querySelector('.bottom-nav-item[data-route="onus"] .nav-badge');
            if (navBadge) {
                if (total > 0) { navBadge.textContent = total > 99 ? '99+' : total; navBadge.classList.add('show'); }
                else navBadge.classList.remove('show');
            }
        } catch (err) {
            if (container) container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle" style="color:#dc3545;"></i><p>Error: ${escapeHtml(err.message)}</p></div>`;
        }
    }

    async function crearVisitaManual(serial, olt, port, onuId, rxPower) {
        if (!confirm(`¿Crear visita técnica para ONU ${serial} (${olt}, PON ${port}/ONU ${onuId}, Rx ${rxPower.toFixed(1)} dBm)?\n\nUn técnico debe ser asignado después.`)) return;
        try {
            const data = await API.post('/api/visitas/crear-critica-manual', {
                serial_number: serial,
                olt_name: olt,
                pon_port: port,
                onu_id: onuId,
                rx_power: rxPower,
                motivo: `Revisión señal crítica - ONU ${serial} (${rxPower.toFixed(2)} dBm)`
            });
            if (data?.success) {
                showToast('Visita creada — pasá a Visitas para asignar técnico', 'success');
                load();
            } else {
                showToast(data?.message || 'No se pudo crear la visita', 'error');
            }
        } catch (err) { showToast('Error de red', 'error'); }
    }

    async function crearVisitaIdentificada(clienteId) {
        if (!confirm(`¿Crear visita técnica para este cliente?`)) return;
        try {
            const data = await API.post('/api/visitas/crear-critica-identificada', { cliente_id: clienteId });
            if (data?.success) {
                showToast('Visita creada', 'success');
                load();
            } else {
                showToast(data?.message || 'Error', 'error');
            }
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
        const page = document.getElementById('page-onus');
        page.classList.add('active');
        page.innerHTML = `
            <div class="tabs-bar">
                <button class="tab-btn ${activeTab === 'no_identificadas' ? 'active' : ''}" data-filter="no_identificadas">
                    <i class="fas fa-question-circle"></i> Sin cliente <span class="count">0</span>
                </button>
                <button class="tab-btn ${activeTab === 'identificadas' ? 'active' : ''}" data-filter="identificadas">
                    <i class="fas fa-user-check"></i> Con cliente <span class="count">0</span>
                </button>
            </div>
            <div id="onus-list-container" class="chat-list" style="margin-top:6px;"></div>
        `;
        page.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activeTab = btn.dataset.filter;
                renderList();
            });
        });
        load();
    }

    return { show, load, crearVisitaManual, crearVisitaIdentificada };
})();

if (typeof Router !== 'undefined') Router.register('onus', () => OnusPage.show());
