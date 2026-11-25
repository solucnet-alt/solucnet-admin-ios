// 🆕 Página: Estado del Bot / Salud del Sistema
const EstadoPage = (function() {
    let healthData = {};
    let statsData = {};
    let logsData = [];
    let colaData = null;
    let botHealth = {};
    let autoRefreshInterval = null;

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    }

    function fmtUptime(s) {
        const days = Math.floor(s / 86400);
        const hours = Math.floor((s % 86400) / 3600);
        const min = Math.floor((s % 3600) / 60);
        if (days > 0) return `${days}d ${hours}h ${min}m`;
        if (hours > 0) return `${hours}h ${min}m`;
        return `${min}m`;
    }

    function fmtBytes(mb) {
        if (mb >= 1024) return (mb/1024).toFixed(1) + ' GB';
        return mb + ' MB';
    }

    function renderEstado() {
        const h = healthData;
        const s = statsData?.stats || {};
        const wa = h.whatsapp || {};
        const mem = h.memory || {};
        // 🆕 v2026-09-11: el bot corre por Cloud API (Meta); /api/health y /api/admin/stats reportan el
        // cliente Baileys (null a propósito) → decían "Desconectado/offline" en FALSO. La verdad la da
        // /api/bot-health (whatsappListo + plataforma:'cloud'). Priorizamos ese estado.
        const cloudListo = !!(botHealth && botHealth.whatsappListo);
        const esCloud = cloudListo || !!(botHealth && botHealth.plataforma === 'cloud');
        const waConnected = cloudListo || (wa.connected && wa.ready);
        const waColor = waConnected ? '#16a34a' : '#dc3545';
        const waText = cloudListo ? 'Conectado (Cloud API · Meta)' : (waConnected ? 'Conectado' : (wa.connected ? 'Conectando…' : 'Desconectado'));

        const c = document.getElementById('estado-container');
        if (!c) return;
        c.innerHTML = `
            <!-- Banner WhatsApp -->
            <div style="background:linear-gradient(135deg, ${waColor}, ${waColor}dd); color:white; padding:16px; border-radius:12px; margin-bottom:10px; text-align:center;">
                <div style="font-size:2.5em; margin-bottom:6px;"><i class="fab fa-whatsapp"></i></div>
                <div style="font-weight:700; font-size:1.05em;">WhatsApp ${escapeHtml(waText)}</div>
                <div style="font-size:0.8em; opacity:0.85; margin-top:2px;">
                    ${(!cloudListo && wa.disconnectedSince) ? 'Desconectado desde: ' + new Date(wa.disconnectedSince).toLocaleString('es-CO') : (cloudListo ? (escapeHtml(botHealth.estado || 'Bot activo (API oficial)')) : 'Bot activo')}
                </div>
            </div>

            <!-- Grid estadísticas -->
            <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin-bottom:10px;">
                <div style="background:white; padding:14px; border-radius:12px; text-align:center;">
                    <i class="fas fa-clock" style="color:#0066cc; font-size:1.3em;"></i>
                    <div style="font-size:0.72em; color:#666; margin-top:4px;">Uptime</div>
                    <div style="font-weight:700; font-size:1.05em; margin-top:2px;">${fmtUptime(h.uptime || 0)}</div>
                </div>
                <div style="background:white; padding:14px; border-radius:12px; text-align:center;">
                    <i class="fas fa-memory" style="color:#f59e0b; font-size:1.3em;"></i>
                    <div style="font-size:0.72em; color:#666; margin-top:4px;">Memoria</div>
                    <div style="font-weight:700; font-size:1.05em; margin-top:2px;">${fmtBytes(mem.used || 0)} / ${fmtBytes(mem.total || 0)}</div>
                </div>
                <div style="background:white; padding:14px; border-radius:12px; text-align:center;">
                    <i class="fas fa-users" style="color:#16a34a; font-size:1.3em;"></i>
                    <div style="font-size:0.72em; color:#666; margin-top:4px;">Usuarios activos</div>
                    <div style="font-weight:700; font-size:1.05em; margin-top:2px;">${s.activeUsers || '—'}</div>
                </div>
                <div style="background:white; padding:14px; border-radius:12px; text-align:center;">
                    <i class="fas fa-comment-dots" style="color:#bf59cf; font-size:1.3em;"></i>
                    <div style="font-size:0.72em; color:#666; margin-top:4px;">Mensajes hoy</div>
                    <div style="font-weight:700; font-size:1.05em; margin-top:2px;">${s.messagesToday || 0}</div>
                </div>
                <div style="background:white; padding:14px; border-radius:12px; text-align:center;">
                    <i class="fas fa-comments" style="color:#0ea5e9; font-size:1.3em;"></i>
                    <div style="font-size:0.72em; color:#666; margin-top:4px;">Chats activos</div>
                    <div style="font-weight:700; font-size:1.05em; margin-top:2px;">${h.chatsActivos ?? '—'}</div>
                </div>
                <div style="background:white; padding:14px; border-radius:12px; text-align:center;">
                    <i class="fas fa-globe" style="color:#10b981; font-size:1.3em;"></i>
                    <div style="font-size:0.72em; color:#666; margin-top:4px;">Estado bot</div>
                    <div style="font-weight:700; font-size:1.05em; margin-top:2px; color:${(cloudListo || (h.estado||'').toUpperCase()==='CONNECTED') ? '#16a34a' : '#dc3545'};">${escapeHtml(esCloud ? (botHealth.estado || 'Cloud API') : (h.estado || '—'))}</div>
                </div>
            </div>

            <!-- Info detallada -->
            <div style="background:white; padding:14px; border-radius:12px; margin-bottom:10px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                <div style="font-weight:600; font-size:0.95em; margin-bottom:10px;"><i class="fas fa-server" style="color:#0066cc;"></i> Información del sistema</div>
                <div style="font-size:0.85em;">
                    <div style="padding:6px 0; border-bottom:1px solid #f0f0f0; display:flex; justify-content:space-between;">
                        <span style="color:#666;">Estado del bot</span>
                        <b style="color:${(cloudListo || s.botStatus === 'online') ? '#16a34a' : '#dc3545'};">${escapeHtml(cloudListo ? 'online (Cloud API)' : (s.botStatus || 'desconocido'))}</b>
                    </div>
                    <div style="padding:6px 0; border-bottom:1px solid #f0f0f0; display:flex; justify-content:space-between;">
                        <span style="color:#666;">Canal WhatsApp</span>
                        <b>${esCloud ? 'API oficial (Meta)' : (wa.hasClient ? 'Inicializado' : 'No iniciado')}</b>
                    </div>
                    <div style="padding:6px 0; border-bottom:1px solid #f0f0f0; display:flex; justify-content:space-between;">
                        <span style="color:#666;">WA estabilizado</span>
                        <b style="color:${(cloudListo || s.whatsappEstabilizado) ? '#16a34a' : '#f59e0b'};">${(cloudListo || s.whatsappEstabilizado) ? 'Sí' : 'No'}</b>
                    </div>
                    <div style="padding:6px 0; border-bottom:1px solid #f0f0f0; display:flex; justify-content:space-between;">
                        <span style="color:#666;">Funciones activas</span>
                        <b>${s.activeFunctions || '—'} / ${s.totalFunctions || '—'}</b>
                    </div>
                    <div style="padding:6px 0; border-bottom:1px solid #f0f0f0; display:flex; justify-content:space-between;">
                        <span style="color:#666;">RSS / Heap</span>
                        <b>${fmtBytes(mem.rss || 0)} / ${fmtBytes(mem.used || 0)}</b>
                    </div>
                    <div style="padding:6px 0; display:flex; justify-content:space-between;">
                        <span style="color:#666;">Node version</span>
                        <b>${escapeHtml((h.process || {}).version || '—')}</b>
                    </div>
                </div>
            </div>

            <!-- Acciones -->
            <div style="background:white; padding:14px; border-radius:12px; margin-bottom:10px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                <div style="font-weight:600; font-size:0.95em; margin-bottom:10px;"><i class="fas fa-tools" style="color:#0066cc;"></i> Acciones</div>
                <button onclick="EstadoPage.refresh()" style="background:#f0f2f5; border:none; padding:12px; border-radius:8px; width:100%; text-align:left; font-size:0.9em; margin-bottom:6px; cursor:pointer;">
                    <i class="fas fa-sync-alt" style="color:#0066cc; margin-right:8px;"></i> Refrescar estado
                </button>
                <button onclick="EstadoPage.verLogsAPI()" style="background:#fffbeb; border:none; padding:12px; border-radius:8px; width:100%; text-align:left; font-size:0.9em; color:#92400e; cursor:pointer; margin-bottom:6px;">
                    <i class="fas fa-list-alt" style="color:#f59e0b; margin-right:8px;"></i> Ver logs de API ingresantes
                </button>
                <button onclick="EstadoPage.confirmRestart()" style="background:#fee; border:none; padding:12px; border-radius:8px; width:100%; text-align:left; font-size:0.9em; color:#dc3545; cursor:pointer;">
                    <i class="fas fa-power-off" style="margin-right:8px;"></i> Reiniciar servidor (requiere permiso)
                </button>
            </div>

            <!-- 🆕 Alertas activas + Último error -->
            <div id="alertas-section" style="margin-bottom:10px;">
                <div id="alertas-content"></div>
            </div>

            <!-- Límites del bot -->
            <div id="limites-section" style="background:white; padding:14px; border-radius:12px; margin-bottom:10px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                <div style="font-weight:600; font-size:0.95em; margin-bottom:10px;"><i class="fas fa-chart-bar" style="color:#f59e0b;"></i> Límites de envío</div>
                <div id="limites-content"><div style="color:#999; text-align:center; font-size:0.82em;">Cargando…</div></div>
            </div>

            <!-- Cola de mensajes API con filtros -->
            <div style="background:white; padding:14px; border-radius:12px; margin-bottom:10px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
                    <div style="font-weight:600; font-size:0.95em;"><i class="fas fa-inbox" style="color:#f59e0b;"></i> Cola mensajes API</div>
                    <div style="display:flex; gap:6px;">
                        <select id="cola-filter" onchange="EstadoPage.cambiarFiltroCola(this.value)" style="padding:5px 8px; border-radius:6px; border:1px solid #ddd; font-size:0.78em;">
                            <option value="pendiente">Pendiente</option>
                            <option value="procesando">Procesando</option>
                            <option value="enviado">Enviados</option>
                            <option value="error">Error</option>
                            <option value="descartado">Descartados</option>
                        </select>
                        <button onclick="EstadoPage.borrarTodoCola()" style="background:#fee; color:#dc3545; border:none; padding:6px 10px; border-radius:6px; font-size:0.72em; font-weight:600; cursor:pointer;"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <div id="cola-resumen" style="display:grid; grid-template-columns:repeat(4,1fr); gap:5px; margin-bottom:8px;"></div>
                <div id="cola-list" style="max-height:240px; overflow-y:auto;"><div style="color:#999; text-align:center; padding:8px; font-size:0.82em;">Cargando…</div></div>
            </div>

            <!-- 🆕 Mensajes recientes del chatbot -->
            <div style="background:white; padding:14px; border-radius:12px; margin-bottom:10px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                <div style="font-weight:600; font-size:0.95em; margin-bottom:10px;"><i class="fas fa-comments" style="color:#0066cc;"></i> Mensajes recientes del chatbot</div>
                <div id="mensajes-recientes-content" style="max-height:300px; overflow-y:auto;"><div style="color:#999; text-align:center; padding:8px; font-size:0.82em;">Cargando…</div></div>
            </div>

            <!-- Logs recientes -->
            <div style="background:white; padding:14px; border-radius:12px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                <div style="font-weight:600; font-size:0.95em; margin-bottom:10px;"><i class="fas fa-file-alt" style="color:#0066cc;"></i> Logs recientes</div>
                <div id="estado-logs" style="font-size:0.78em; font-family:monospace; max-height:280px; overflow-y:auto; background:#1a1a1a; color:#86efac; padding:10px; border-radius:6px;">
                    Cargando logs…
                </div>
            </div>
        `;
    }

    // 🆕 v2026-05-25: Render de alertas activas + último error
    function renderAlertasYErrores() {
        const el = document.getElementById('alertas-content');
        if (!el) return;
        const alertas = botHealth?.alertas || [];
        const ultError = botHealth?.ultimoError;
        let html = '';

        // Alertas activas
        if (alertas && alertas.length > 0) {
            html += `
                <div style="background:#fff3cd; border:2px solid #ffc107; border-radius:12px; padding:14px; margin-bottom:8px;">
                    <div style="font-weight:700; font-size:0.95em; color:#856404; margin-bottom:8px;">
                        <i class="fas fa-exclamation-triangle"></i> ${alertas.length} alerta${alertas.length > 1 ? 's' : ''} activa${alertas.length > 1 ? 's' : ''}
                    </div>
                    <div style="font-size:0.82em; color:#856404;">
                        ${alertas.map(a => `<div style="padding:4px 0; border-top:1px solid rgba(133,100,4,0.15);">${escapeHtml(typeof a === 'string' ? a : (a.mensaje || JSON.stringify(a).substring(0,120)))}</div>`).join('')}
                    </div>
                </div>`;
        }

        // Último error
        if (ultError && (ultError.mensaje || ultError.message || ultError.timestamp)) {
            const msg = ultError.mensaje || ultError.message || JSON.stringify(ultError).substring(0, 200);
            const ts = ultError.timestamp ? new Date(ultError.timestamp).toLocaleString('es-CO') : '';
            html += `
                <div style="background:#f8d7da; border:2px solid #f5c6cb; border-radius:12px; padding:14px;">
                    <div style="font-weight:700; font-size:0.95em; color:#721c24; margin-bottom:6px;">
                        <i class="fas fa-bug"></i> Último error
                    </div>
                    <div style="font-size:0.78em; color:#721c24; font-family:monospace; word-break:break-word; background:rgba(255,255,255,0.4); padding:8px; border-radius:6px;">
                        ${escapeHtml(String(msg).substring(0, 400))}
                    </div>
                    ${ts ? `<div style="font-size:0.72em; color:#856404; margin-top:6px;">${ts}</div>` : ''}
                </div>`;
        }

        el.innerHTML = html;
    }

    // 🆕 v2026-05-25: Render de últimos mensajes del chatbot
    function renderMensajesRecientes() {
        const el = document.getElementById('mensajes-recientes-content');
        if (!el) return;
        const mensajes = botHealth?.mensajesChatbot || [];
        if (!mensajes.length) {
            el.innerHTML = '<div style="color:#999; text-align:center; padding:8px; font-size:0.82em;">Sin mensajes recientes</div>';
            return;
        }
        // Mostrar los últimos primero
        const lista = [...mensajes].reverse().slice(0, 30);
        el.innerHTML = lista.map(m => {
            const exitoso = m.exitoso !== false;
            const color = exitoso ? '#16a34a' : '#dc3545';
            const bgColor = exitoso ? '#dcfce7' : '#fee';
            const icon = exitoso ? 'fa-check-circle' : 'fa-times-circle';
            const numero = m.numero || m.numero_destino || m.chatId || '?';
            const texto = (m.mensaje || m.contenido || '').substring(0, 100);
            const fecha = m.timestamp || m.fecha;
            const fechaStr = fecha ? new Date(fecha).toLocaleString('es-CO', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit' }) : '';
            return `
                <div style="background:${bgColor}; padding:8px 10px; border-radius:6px; margin-bottom:5px; border-left:3px solid ${color}; font-size:0.78em;">
                    <div style="display:flex; justify-content:space-between; gap:6px; align-items:start;">
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:600;"><i class="fas ${icon}" style="color:${color};"></i> +${escapeHtml(String(numero))}</div>
                            <div style="color:#444; margin-top:2px; word-break:break-word;">${escapeHtml(texto)}${(m.mensaje||'').length > 100 ? '…' : ''}</div>
                        </div>
                        ${fechaStr ? `<div style="color:#666; font-size:0.85em; white-space:nowrap;">${fechaStr}</div>` : ''}
                    </div>
                    ${m.error ? `<div style="color:#991b1b; font-size:0.85em; margin-top:3px;">⚠ ${escapeHtml(String(m.error).substring(0,80))}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    function renderCola() {
        const el = document.getElementById('cola-resumen');
        if (!el) return;
        const r = colaData?.resumen || {};
        const colorBox = (label, n, bg, fg) => `<div style="background:${bg}; padding:8px; border-radius:6px; text-align:center;"><div style="font-size:1.05em; font-weight:700; color:${fg};">${n||0}</div><div style="font-size:0.66em; color:${fg};">${label}</div></div>`;
        el.innerHTML = colorBox('Pendiente', r.pendiente, '#fffbeb', '#92400e')
            + colorBox('Procesando', r.procesando, '#eff6ff', '#1e40af')
            + colorBox('Enviado', r.enviado, '#dcfce7', '#166534')
            + colorBox('Error', r.error, '#fee', '#b91c1c');
        const list = document.getElementById('cola-list');
        const mensajes = colaData?.mensajes || [];
        if (!mensajes.length) {
            list.innerHTML = '<div style="color:#999; text-align:center; padding:8px; font-size:0.82em;">Cola vacía</div>';
            return;
        }
        list.innerHTML = mensajes.map(m => `
            <div style="background:#f8f9fa; border-radius:6px; padding:8px; margin-bottom:5px; font-size:0.78em;">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:6px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600;">+${escapeHtml(m.numero || '?')}</div>
                        <div style="color:#666; margin-top:2px;">${escapeHtml(m.mensaje_corto || '')}</div>
                        <div style="color:#999; font-size:0.85em; margin-top:2px;">Intento ${m.intentos}/${m.max_intentos}${m.error_mensaje ? ' · ' + escapeHtml(String(m.error_mensaje).substring(0,40)) : ''}</div>
                    </div>
                    <button onclick="EstadoPage.borrarColaItem(${m.id})" style="background:#fee; color:#dc3545; border:none; padding:4px 8px; border-radius:4px; font-size:0.7em; cursor:pointer;"><i class="fas fa-times"></i></button>
                </div>
            </div>
        `).join('');
    }

    let _filtroColaActual = 'pendiente';
    async function loadCola() {
        try {
            colaData = await API.get(`/api/cola-mensajes?estado=${encodeURIComponent(_filtroColaActual)}&limite=50`);
            renderCola();
        } catch { colaData = null; renderCola(); }
    }

    // 🆕 v2026-05-25: cambiar filtro de la cola desde el selector
    async function cambiarFiltroCola(estado) {
        _filtroColaActual = estado || 'pendiente';
        await loadCola();
    }

    async function loadBotHealth() {
        try {
            botHealth = await API.get('/api/bot-health');
            renderLimites();
        } catch { botHealth = {}; renderLimites(); }
    }

    function renderLimites() {
        const el = document.getElementById('limites-content');
        if (!el) return;
        const l = botHealth?.limites || {};
        const m = botHealth?.mensajes || {};
        const bar = (label, valor, max, pct, color) => `
            <div style="margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; font-size:0.82em; margin-bottom:3px;">
                    <span style="color:#555;">${label}</span>
                    <span style="font-weight:600; color:${color};">${valor || 0} / ${max || '?'} (${pct}%)</span>
                </div>
                <div style="background:#eee; border-radius:10px; height:8px; overflow:hidden;">
                    <div style="height:100%; width:${Math.min(100, pct)}%; background:${color}; transition:width 0.3s;"></div>
                </div>
            </div>
        `;
        const pctD = parseFloat(l.porcentajeDiario || 0);
        const pctH = parseFloat(l.porcentajeHora || 0);
        const colorD = pctD > 90 ? '#dc2626' : pctD > 70 ? '#f59e0b' : '#16a34a';
        const colorH = pctH > 90 ? '#dc2626' : pctH > 70 ? '#f59e0b' : '#16a34a';
        const resetD = l.resetDiario ? new Date(l.resetDiario).toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' }) : '—';
        const resetH = l.resetHora ? new Date(l.resetHora).toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' }) : '—';

        el.innerHTML = `
            ${bar(`Mensajes hoy (reset ${resetD})`, l.mensajesHoy, l.maxDiario, pctD, colorD)}
            ${bar(`Mensajes esta hora (reset ${resetH})`, l.mensajesHora, l.maxHora, pctH, colorH)}
            ${bar(`Contactos únicos hoy`, l.contactosUnicos, l.maxContactosUnicos, ((l.contactosUnicos||0)/(l.maxContactosUnicos||1)*100).toFixed(1), '#0066cc')}
            <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:6px; margin-top:10px; font-size:0.78em;">
                <div style="background:#dcfce7; padding:6px; border-radius:5px; text-align:center;"><b style="color:#166534;">${m.exitosos || 0}</b><br><span style="color:#166534; font-size:0.85em;">Exitosos</span></div>
                <div style="background:#fee; padding:6px; border-radius:5px; text-align:center;"><b style="color:#991b1b;">${m.fallidos || 0}</b><br><span style="color:#991b1b; font-size:0.85em;">Fallidos</span></div>
            </div>
            ${m.tasaError ? `<div style="font-size:0.78em; margin-top:8px; color:#666;">Tasa éxito: <b style="color:#16a34a;">${m.tasaExito}%</b> · Tasa error: <b style="color:#dc2626;">${m.tasaError}%</b></div>` : ''}
            ${l.bloqueados ? `
              <div style="background:#fff5f5; border-radius:8px; padding:10px; margin-top:10px; border-left:3px solid #fc8181;">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                      <span style="color:#742a2a; font-size:0.85em; font-weight:600;"><i class="fas fa-ban" style="color:#e53e3e;"></i> Mensajes bloqueados</span>
                      <span style="font-weight:bold; color:#c53030; font-size:1.1em;">${l.bloqueados}</span>
                  </div>
                  <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:5px; font-size:0.75em;">
                      <div style="background:white; padding:6px; border-radius:5px; text-align:center;">
                          <div style="color:#9b2c2c; font-weight:700;">${l.bloqueadosDiario || 0}</div>
                          <div style="color:#666; font-size:0.85em;">Por día</div>
                      </div>
                      <div style="background:white; padding:6px; border-radius:5px; text-align:center;">
                          <div style="color:#9b2c2c; font-weight:700;">${l.bloqueadosHora || 0}</div>
                          <div style="color:#666; font-size:0.85em;">Por hora</div>
                      </div>
                      <div style="background:white; padding:6px; border-radius:5px; text-align:center;">
                          <div style="color:#9b2c2c; font-weight:700;">${l.bloqueadosContactos || 0}</div>
                          <div style="color:#666; font-size:0.85em;">Contactos</div>
                      </div>
                  </div>
              </div>` : ''}
        `;
        // 🆕 v2026-05-25: renderizar las secciones que dependen de botHealth
        renderAlertasYErrores();
        renderMensajesRecientes();
    }

    async function borrarColaItem(id) {
        if (!confirm('¿Eliminar este mensaje de la cola?')) return;
        try {
            await API.del(`/api/cola-mensajes/${id}`);
            showToast('Eliminado');
            await loadCola();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function borrarTodoCola() {
        if (!confirm('¿Borrar TODOS los mensajes pendientes/error de la cola?')) return;
        try {
            await API.del('/api/cola-mensajes');
            showToast('Cola limpiada', 'success');
            await loadCola();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    function renderLogs() {
        const el = document.getElementById('estado-logs');
        if (!el) return;
        if (!logsData.length) {
            el.innerHTML = '<div style="color:#999;">Sin logs recientes</div>';
            return;
        }
        el.innerHTML = logsData.slice(0, 50).map(log => {
            const fecha = log.fecha || log.timestamp || '';
            const msg = (log.mensaje || log.message || JSON.stringify(log)).substring(0, 200);
            return `<div style="margin-bottom:3px; word-break:break-word;">[${escapeHtml(String(fecha).substring(11,19))}] ${escapeHtml(msg)}</div>`;
        }).join('');
    }

    async function loadAll() {
        try {
            const [h, s, bh] = await Promise.all([
                fetch(APP_CONFIG.SERVER_URL + '/api/health').then(r => r.json()).catch(() => ({})),
                API.get('/api/admin/stats').catch(() => ({})),
                API.get('/api/bot-health').catch(() => ({})),   // 🆕 cargar ANTES de renderEstado (estado real Cloud API)
            ]);
            healthData = h || {};
            statsData = s || {};
            botHealth = bh || botHealth || {};
            renderEstado();
        } catch (err) { console.error('Error estado:', err); }
        // Logs (puede fallar si no hay permiso)
        try {
            const data = await API.get('/api/admin/logs?limit=50').catch(() => null);
            logsData = data?.logs || data?.data || (Array.isArray(data) ? data : []);
            renderLogs();
        } catch {}
        // Cola API + bot health
        await Promise.all([loadCola(), loadBotHealth()]);
    }

    async function refresh() {
        showToast('Refrescando…');
        await loadAll();
    }

    async function confirmRestart() {
        if (!confirm('⚠️ ¿REINICIAR el servidor?\n\nEsto desconectará brevemente WhatsApp y todas las conexiones.\n\nSolo continúa si tenés el permiso "reiniciar_servidor".')) return;
        try {
            await API.post('/api/admin/restart-server', {});
            showToast('Reinicio en curso…', 'success');
            setTimeout(loadAll, 15000); // refresh después de 15s
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
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
        let page = document.getElementById('page-estado');
        if (!page) {
            page = document.createElement('div');
            page.id = 'page-estado';
            page.className = 'page';
            main.appendChild(page);
        }
        page.classList.add('active');
        page.innerHTML = `<div id="estado-container"><div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div></div>`;
        loadAll();
        // Auto-refresh cada 30s mientras la página está activa
        if (autoRefreshInterval) clearInterval(autoRefreshInterval);
        autoRefreshInterval = setInterval(() => {
            if (document.getElementById('page-estado')?.classList.contains('active')) loadAll();
            else { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
        }, 30000);
    }

    async function verLogsAPI() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:92vh;">
                <div class="modal-header" style="background:linear-gradient(135deg,#f59e0b,#d97706);"><h3><i class="fas fa-list-alt"></i> Logs de API ingresantes</h3><button class="modal-close" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;">&times;</button></div>
                <div class="modal-body" style="padding:14px 18px;"><div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div></div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();
        try {
            const data = await API.get('/api/logs-api?limit=100');
            const items = data?.logs || data?.data || (Array.isArray(data) ? data : []);
            const body = overlay.querySelector('.modal-body');
            if (!items.length) {
                body.innerHTML = `<div class="empty-state"><p>Sin logs recientes</p></div>`;
                return;
            }
            const estadoColor = (e) => ({ enviado:'#16a34a', encolado:'#0066cc', error:'#dc3545', rechazado:'#dc3545', error_encolado:'#f59e0b' }[(e||'').toLowerCase()] || '#666');
            body.innerHTML = items.map(l => {
                const color = estadoColor(l.estado);
                const fecha = l.fecha ? new Date(l.fecha).toLocaleString('es-CO', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
                return `
                    <div style="background:white; padding:8px; border-radius:6px; margin-bottom:5px; border-left:3px solid ${color}; font-size:0.78em;">
                        <div style="display:flex; justify-content:space-between; gap:6px;">
                            <b>${escapeHtml(l.numero || l.chat_id || '?')}</b>
                            <span style="color:${color}; font-weight:600; font-size:0.85em; text-transform:uppercase;">${escapeHtml(l.estado || '?')}</span>
                        </div>
                        <div style="color:#666; margin-top:2px;">${escapeHtml((l.mensaje || '').substring(0,120))}${l.mensaje?.length > 120 ? '…' : ''}</div>
                        <div style="color:#999; font-size:0.85em; margin-top:2px;">${fecha} · ${escapeHtml(l.token_descripcion || l.api_user || '')}${l.motivo ? ' · ' + escapeHtml(l.motivo) : ''}</div>
                    </div>
                `;
            }).join('');
        } catch (err) { overlay.querySelector('.modal-body').innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`; }
    }

    return { show, refresh, confirmRestart, borrarColaItem, borrarTodoCola, verLogsAPI, cambiarFiltroCola };
})();

if (typeof Router !== 'undefined') Router.register('estado', () => EstadoPage.show());
