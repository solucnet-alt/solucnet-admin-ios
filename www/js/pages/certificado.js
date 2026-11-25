// 🔐 Página: Certificado SSL de velocidad.solucnet.com (monitor + validación de token Cloudflare)
// - Muestra días restantes del cert (se auto-renueva cada 90 días).
// - Banner FIJO ARRIBA en toda la app cuando está por vencer / venció / falló la renovación.
// - Guía paso a paso + campo del token de Cloudflare con VALIDACIÓN en vivo.
// - Cuando el cert ya renovó, el conteo se reinicia solo (el banner se oculta solo).
const CertificadoPage = (function () {
    let data = null;

    function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

    async function loadEstado() {
        try {
            data = await API.get('/api/isp/velocidad-cert/estado');
        } catch (e) {
            data = { ok: false, alcanzable: false, mensaje: e.message };
        }
        render();
        // refrescar el banner global con el dato nuevo
        try { pintarBanner(data); } catch (_) {}
    }

    function render() {
        const c = document.getElementById('cert-container');
        if (!c) return;
        const d = data || {};
        const est = d.estado || (d.ok ? 'ok' : 'error');
        const MAP = {
            ok: ['#16a34a', 'fa-lock', 'Vigente'],
            aviso: ['#f59e0b', 'fa-triangle-exclamation', 'Por vencer'],
            critico: ['#ea580c', 'fa-triangle-exclamation', 'Crítico'],
            vencido: ['#dc3545', 'fa-lock-open', 'VENCIDO'],
            error: ['#6b7280', 'fa-circle-question', 'Sin datos'],
        };
        const [col, icon, label] = MAP[est] || MAP.error;
        const dias = (typeof d.dias === 'number') ? d.dias : null;

        c.innerHTML = `
            <div style="background:linear-gradient(135deg,${col},${col}dd); color:white; padding:20px; border-radius:14px; margin-bottom:12px; text-align:center;">
                <div style="font-size:2.4em;"><i class="fas ${icon}"></i></div>
                <div style="font-weight:700; font-size:1.1em; margin-top:4px;">velocidad.solucnet.com</div>
                <div style="font-size:.95em; opacity:.95; margin-top:2px;">Certificado SSL · ${label}</div>
                ${dias !== null ? `
                    <div style="font-size:2.2em; font-weight:800; margin-top:10px; line-height:1;">${dias >= 0 ? dias : 0}<span style="font-size:.38em; font-weight:600;"> días</span></div>
                    <div style="font-size:.78em; opacity:.85; margin-top:4px;">vence: ${esc(d.notAfter)}</div>
                ` : `<div style="font-size:.9em; opacity:.9; margin-top:10px;">${esc(d.mensaje || 'No se pudo leer el certificado')}</div>`}
            </div>

            <div style="background:#eef6ff; border:1px solid #cfe3ff; border-radius:12px; padding:12px; margin-bottom:12px; font-size:.83em; color:#1e40af; line-height:1.5;">
                <i class="fas fa-circle-info"></i> El certificado <b>se renueva solo cada 90 días</b> (Let's Encrypt + Cloudflare). Solo tienes que actuar si te avisa que la renovación falló — normalmente porque el <b>token de Cloudflare venció o fue revocado</b>.
            </div>

            <div style="background:white; border-radius:12px; padding:16px; margin-bottom:12px;">
                <div style="font-weight:700; margin-bottom:10px;"><i class="fas fa-key" style="color:#0066cc;"></i> Renovar el token de Cloudflare</div>
                <div style="font-size:.82em; color:#555; line-height:1.6;">
                    <b>1.</b> Entra a <b>dash.cloudflare.com</b> → tu perfil (arriba der.) → <b>My Profile → API Tokens → Create Token</b>.<br>
                    <b>2.</b> Plantilla <b>"Edit zone DNS"</b>.<br>
                    <b>3.</b> Zone Resources → <b>solucnet.com</b>. Deja la expiración <b>vacía</b>.<br>
                    <b>4.</b> Crea, copia el token, pégalo aquí y dale <b>Validar</b>.
                </div>
                <input id="cert-token" type="text" placeholder="Pega aquí el token de Cloudflare" autocomplete="off" autocapitalize="off" spellcheck="false"
                    style="width:100%; box-sizing:border-box; margin-top:12px; padding:12px; border:1px solid #ccc; border-radius:9px; font-size:.9em; font-family:monospace;">
                <div id="cert-token-msg" style="font-size:.85em; margin-top:8px; min-height:18px;"></div>
                <button id="cert-validar-btn" style="width:100%; margin-top:6px; padding:13px; background:#0066cc; color:white; border:none; border-radius:9px; font-weight:700; font-size:.95em; cursor:pointer;">
                    <i class="fas fa-shield-halved"></i> Validar token
                </button>
                <div id="cert-aplicar-box" style="display:none; margin-top:12px; padding:12px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:9px; font-size:.83em; color:#166534; line-height:1.6;"></div>
            </div>

            <button onclick="CertificadoPage.refresh()" style="width:100%; padding:12px; background:#eef2f7; color:#333; border:none; border-radius:9px; font-weight:600; font-size:.88em; cursor:pointer;">
                <i class="fas fa-rotate"></i> Actualizar estado
            </button>
        `;
        const btn = document.getElementById('cert-validar-btn');
        if (btn) btn.addEventListener('click', validarToken);
    }

    async function validarToken() {
        const inp = document.getElementById('cert-token');
        const msg = document.getElementById('cert-token-msg');
        const box = document.getElementById('cert-aplicar-box');
        const btn = document.getElementById('cert-validar-btn');
        const token = (inp && inp.value || '').trim();
        if (!token) { if (msg) msg.innerHTML = '<span style="color:#dc3545;">Pega el token primero.</span>'; return; }
        if (btn) btn.disabled = true;
        if (msg) msg.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Validando con Cloudflare…';
        if (box) box.style.display = 'none';
        try {
            const r = await API.post('/api/isp/velocidad-cert/validar-token', { token });
            if (r && r.valido) {
                if (msg) msg.innerHTML = '<span style="color:#16a34a; font-weight:700;"><i class="fas fa-circle-check"></i> ' + esc(r.mensaje || 'Token válido ✓') + '</span>';
                if (box) {
                    box.style.display = 'block';
                    box.innerHTML = '<b>✅ Token válido y con acceso a solucnet.com.</b>'
                        + '<div style="margin-top:8px;">Aplicalo y renová el certificado automáticamente — se guarda en el firewall y se renueva solo de aquí en adelante:</div>'
                        + '<button id="cert-aplicar-btn" style="width:100%; margin-top:10px; padding:13px; background:#16a34a; color:white; border:none; border-radius:9px; font-weight:700; font-size:.95em; cursor:pointer;"><i class="fas fa-rotate-right"></i> Aplicar y renovar ahora</button>'
                        + '<div id="cert-aplicar-msg" style="font-size:.85em; margin-top:8px; min-height:18px;"></div>'
                        + '<small style="color:#3f6212; display:block; margin-top:6px;">Tarda alrededor de 1 minuto. No cierres la pantalla mientras renueva.</small>';
                    const ab = document.getElementById('cert-aplicar-btn');
                    if (ab) ab.addEventListener('click', function () { aplicarToken(token); });
                }
            } else {
                if (msg) msg.innerHTML = '<span style="color:#dc3545; font-weight:700;"><i class="fas fa-circle-xmark"></i> ' + esc((r && r.mensaje) || 'Token inválido') + '</span>';
            }
        } catch (e) {
            if (msg) msg.innerHTML = '<span style="color:#dc3545;">Error: ' + esc(e.message) + '</span>';
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function aplicarToken(token) {
        const am = document.getElementById('cert-aplicar-msg');
        const ab = document.getElementById('cert-aplicar-btn');
        if (!token) return;
        if (ab) ab.disabled = true;
        if (am) am.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aplicando token y renovando el certificado… (~1 min)';
        try {
            const r = await API.post('/api/isp/velocidad-cert/aplicar-token', { token });
            if (r && r.ok) {
                if (am) am.innerHTML = '<span style="color:#16a34a; font-weight:700;"><i class="fas fa-circle-check"></i> ¡Certificado renovado!' + (r.notAfter ? ' Vence: ' + esc(r.notAfter) : '') + '</span>';
                setTimeout(function () { try { CertificadoPage.refresh(); } catch (_) {} }, 1800);
            } else {
                if (am) am.innerHTML = '<span style="color:#dc3545; font-weight:700;"><i class="fas fa-circle-xmark"></i> ' + esc((r && r.mensaje) || 'No se pudo renovar') + '</span>'
                    + (r && r.detalle ? '<pre style="white-space:pre-wrap; font-size:.72em; color:#7f1d1d; background:#fef2f2; padding:8px; border-radius:7px; margin-top:6px; max-height:160px; overflow:auto;">' + esc(r.detalle) + '</pre>' : '');
            }
        } catch (e) {
            if (am) am.innerHTML = '<span style="color:#b45309;">La renovación quedó corriendo en el firewall. Si no ves el cambio, tocá “Actualizar estado” en un minuto. <small>(' + esc(e.message) + ')</small></span>';
        } finally {
            if (ab) ab.disabled = false;
        }
    }

    function refresh() {
        const c = document.getElementById('cert-container');
        if (c) c.innerHTML = '<div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>';
        loadEstado();
    }

    function show() {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const main = document.querySelector('.app-main');
        let page = document.getElementById('page-certificado');
        if (!page) {
            page = document.createElement('div');
            page.id = 'page-certificado';
            page.className = 'page';
            main.appendChild(page);
        }
        page.classList.add('active');
        page.innerHTML = '<div id="cert-container"><div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div></div>';
        loadEstado();
    }

    // ---- Banner global (fijo arriba, en toda la app) ----
    function pintarBanner(d) {
        const alerta = d && (d.ok === false || d.estado === 'aviso' || d.estado === 'critico' || d.estado === 'vencido');
        let b = document.getElementById('cert-alert-banner');
        if (!alerta) { if (b) b.style.display = 'none'; return; }
        if (!b) {
            b = document.createElement('div');
            b.id = 'cert-alert-banner';
            b.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:9999; padding:11px 14px; color:white; font-size:.85em; font-weight:600; text-align:center; cursor:pointer; box-shadow:0 2px 10px rgba(0,0,0,.3);';
            b.addEventListener('click', () => { try { if (typeof Router !== 'undefined') Router.navigate('certificado'); } catch (_) {} });
            document.body.appendChild(b);
        }
        const col = d.estado === 'vencido' ? '#dc3545' : (d.estado === 'critico' ? '#ea580c' : (d.ok === false ? '#6b7280' : '#f59e0b'));
        b.style.background = col;
        b.style.display = 'block';
        let txt;
        if (d.ok === false) txt = 'No se pudo leer el certificado de velocidad.solucnet.com';
        else if (d.estado === 'vencido') txt = '⚠️ El certificado de velocidad.solucnet.com VENCIÓ';
        else txt = '⚠️ El certificado de velocidad.solucnet.com vence en ' + d.dias + ' día' + (d.dias === 1 ? '' : 's');
        b.innerHTML = '<i class="fas fa-lock-open"></i> ' + txt + ' — toca para renovar';
    }

    function checkBanner() {
        API.get('/api/isp/velocidad-cert/estado').then(pintarBanner).catch(() => {});
    }

    return { show, refresh, validarToken, checkBanner };
})();

if (typeof Router !== 'undefined') Router.register('certificado', () => CertificadoPage.show());

// Auto-arranque del banner: al cargar la app y cada 6 horas. Solo aparece si hay alerta.
(function () {
    function run() { try { CertificadoPage.checkBanner(); } catch (_) {} }
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(run, 3500);
    else document.addEventListener('DOMContentLoaded', function () { setTimeout(run, 3500); });
    setInterval(run, 6 * 60 * 60 * 1000);
})();
