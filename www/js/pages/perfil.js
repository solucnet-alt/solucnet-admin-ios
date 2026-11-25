// 🆕 Página: Perfil del usuario logueado con permisos y logout
const PerfilPage = (function() {
    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    }

    // Mapa de permisos clave → etiqueta amigable
    const PERMISOS_LABELS = {
        ver_tr069: 'Ver TR-069',
        gestionar_tr069: 'Gestionar TR-069',
        ver_ssgt: 'Ver SSGT',
        agregar_ssgt: 'Agregar SSGT',
        editar_ssgt: 'Editar SSGT',
        eliminar_ssgt: 'Eliminar SSGT',
        ver_historial_chat: 'Ver historial de chats',
        ver_cobranza: 'Ver cobranza',
        reiniciar_servidor: 'Reiniciar servidor',
        ver_isp_guardian: 'Ver ISP Guardian',
        ver_portal_cautivo: 'Ver Portal Cautivo WiFi',
        gestionar_portal_cautivo: 'Gestionar Portal Cautivo WiFi',
        gestionar_mikrotik: 'Gestionar MikroTik',
        gestionar_qos: 'Gestionar QoS',
        gestionar_monitoreo: 'Gestionar monitoreo',
        gestionar_blacklist: 'Gestionar blacklist',
        gestionar_alertas: 'Gestionar alertas',
        ver_mapa_universal: 'Ver mapa universal',
        ver_mapa_enrutamiento: 'Ver mapa de enrutamiento',
        editar_mapa_enrutamiento: 'Editar mapa de enrutamiento',
    };

    async function show() {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const page = document.getElementById('page-perfil');
        page.classList.add('active');
        page.innerHTML = `<div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando perfil…</div>`;

        let user = Auth.getUser();
        try {
            // Refrescar info del servidor (puede haber cambiado permisos)
            const data = await API.get('/api/validate-token');
            if (data?.user) {
                user = data.user;
                localStorage.setItem(APP_CONFIG.STORAGE.USER, JSON.stringify(user));
                localStorage.setItem('user', JSON.stringify(user));
            }
        } catch {}

        const nombre = user?.nombre || user?.username || 'Usuario';
        const username = user?.username || '—';
        const rol = user?.rol || '—';
        const permisos = user?.permisos && typeof user.permisos === 'object' ? user.permisos : {};
        const permisosActivos = Object.keys(permisos).filter(k => permisos[k]);
        const fcmTok = localStorage.getItem(APP_CONFIG.STORAGE.FCM_TOKEN);

        page.innerHTML = `
            <div style="background:linear-gradient(135deg, #0084ff, #0066cc); color:white; padding:24px 16px; border-radius:0 0 16px 16px; text-align:center;">
                <div style="width:90px; height:90px; border-radius:50%; background:white; color:#0084ff; margin:0 auto 12px; display:flex; align-items:center; justify-content:center; font-size:2.4em; font-weight:700; box-shadow:0 4px 12px rgba(0,0,0,0.15);">
                    ${escapeHtml((nombre || '?').charAt(0).toUpperCase())}
                </div>
                <div style="font-size:1.3em; font-weight:700;">${escapeHtml(nombre)}</div>
                <div style="font-size:0.9em; opacity:0.9; margin-top:2px;">${escapeHtml(username)}</div>
                <div style="display:inline-block; margin-top:8px; background:rgba(255,255,255,0.25); padding:4px 14px; border-radius:14px; font-size:0.8em; font-weight:600; text-transform:capitalize;">
                    ${escapeHtml(rol)}
                </div>
            </div>

            <div style="padding:14px 12px;">
                <div style="background:white; border-radius:12px; padding:14px; margin-bottom:10px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                    <div style="font-weight:600; font-size:0.92em; margin-bottom:10px; color:#1a1a1a;">
                        <i class="fas fa-key" style="color:#f59e0b;"></i> Permisos activos (${permisosActivos.length})
                    </div>
                    ${permisosActivos.length === 0 ?
                        '<div style="font-size:0.85em; color:#999;">No tenés permisos específicos asignados.</div>' :
                        permisosActivos.map(k => `<div style="padding:6px 0; border-bottom:1px solid #f0f0f0; font-size:0.88em; color:#555;"><i class="fas fa-check-circle" style="color:#16a34a;"></i> ${escapeHtml(PERMISOS_LABELS[k] || k)}</div>`).join('')
                    }
                </div>

                <div style="background:white; border-radius:12px; padding:14px; margin-bottom:10px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                    <div style="font-weight:600; font-size:0.92em; margin-bottom:10px; color:#1a1a1a;">
                        <i class="fas fa-mobile-alt" style="color:#0084ff;"></i> App
                    </div>
                    <div style="padding:6px 0; font-size:0.85em; color:#555;">
                        <span style="color:#999;">Versión:</span> <b id="perfil-version">cargando…</b>
                    </div>
                    <div style="padding:6px 0; font-size:0.85em; color:#555;">
                        <span style="color:#999;">Servidor:</span> <b>${escapeHtml(APP_CONFIG.SERVER_URL)}</b>
                    </div>
                    <div style="padding:6px 0; font-size:0.85em; color:#555;">
                        <span style="color:#999;">FCM Token:</span> <b>${fcmTok ? 'Registrado' : 'No registrado'}</b>
                    </div>
                </div>

                <div style="background:white; border-radius:12px; padding:14px; margin-bottom:10px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                    <div style="font-weight:600; font-size:0.92em; margin-bottom:10px; color:#1a1a1a;">
                        <i class="fas fa-tools" style="color:#0084ff;"></i> Acciones
                    </div>
                    <button onclick="PerfilPage.checkUpdate()" style="background:#f0f2f5; border:none; padding:12px; border-radius:8px; width:100%; text-align:left; font-size:0.9em; color:#1a1a1a; margin-bottom:6px; cursor:pointer;">
                        <i class="fas fa-cloud-download-alt" style="color:#0066cc; margin-right:8px;"></i> Buscar actualizaciones
                    </button>
                    <button onclick="PerfilPage.openWeb()" style="background:#f0f2f5; border:none; padding:12px; border-radius:8px; width:100%; text-align:left; font-size:0.9em; color:#1a1a1a; margin-bottom:6px; cursor:pointer;">
                        <i class="fas fa-external-link-alt" style="color:#0066cc; margin-right:8px;"></i> Abrir panel web
                    </button>
                </div>

                <button onclick="PerfilPage.logout()" style="background:#dc3545; color:white; border:none; padding:14px; border-radius:10px; width:100%; font-weight:600; font-size:0.95em; box-shadow:0 4px 12px rgba(220,53,69,0.3); cursor:pointer; margin-bottom:20px;">
                    <i class="fas fa-sign-out-alt"></i> Cerrar sesión
                </button>
            </div>
        `;

        // Cargar versión real del APK
        (async () => {
            try {
                let v = APP_CONFIG.APP_VERSION;
                if (window.Capacitor?.Plugins?.App) {
                    const info = await window.Capacitor.Plugins.App.getInfo();
                    if (info?.version) v = info.version;
                }
                document.getElementById('perfil-version').textContent = 'v' + v;
            } catch { document.getElementById('perfil-version').textContent = 'v' + APP_CONFIG.APP_VERSION; }
        })();
    }

    function checkUpdate() {
        if (typeof UpdateChecker !== 'undefined') {
            UpdateChecker.check();
            showToast('Buscando actualizaciones…');
        }
    }

    function openWeb() {
        const url = APP_CONFIG.SERVER_URL;
        try {
            if (window.Capacitor?.Plugins?.Browser?.open) {
                window.Capacitor.Plugins.Browser.open({ url, windowName: '_system' });
                return;
            }
        } catch (e) { console.warn('[openWeb] Browser.open failed:', e.message); }
        window.open(url, '_blank');
    }

    function logout() {
        if (confirm('¿Cerrar sesión?')) Auth.logout();
    }

    function showToast(msg, type='info') {
        let t = document.getElementById('toast');
        if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
        t.className = 'toast show ' + type;
        t.textContent = msg;
        setTimeout(() => t.classList.remove('show'), 2500);
    }

    return { show, checkUpdate, openWeb, logout };
})();

if (typeof Router !== 'undefined') Router.register('perfil', () => PerfilPage.show());
