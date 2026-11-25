// 🆕 Sistema de detección de actualizaciones para SolucNet Admin
// Consulta /api/admin-app-version al arrancar y cada N minutos.
// Si hay versión más nueva, muestra modal con botón "Actualizar".
const UpdateChecker = (function() {
    const CHECK_INTERVAL_MS = 10 * 60 * 1000; // cada 10 min
    let timer = null;
    let bannerShown = false;

    function compareVersions(a, b) {
        const pa = (a || '0.0.0').split('.').map(n => parseInt(n) || 0);
        const pb = (b || '0.0.0').split('.').map(n => parseInt(n) || 0);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            if ((pa[i] || 0) > (pb[i] || 0)) return 1;
            if ((pa[i] || 0) < (pb[i] || 0)) return -1;
        }
        return 0;
    }

    // 🆕 Descarga el APK directo con Filesystem y lo abre con FileOpener.
    // No depende de que el WebView abra URLs externas (que en Capacitor es problemático).
    async function openDownloadUrl(url) {
        console.log('[UPDATE] Iniciando descarga de:', url);

        // En Capacitor: descargar con Filesystem + abrir con FileOpener
        if (window.Capacitor?.Plugins?.Filesystem) {
            try {
                await downloadAndInstallApk(url);
                return;
            } catch (err) {
                console.error('[UPDATE] Descarga falló:', err);
                showUpdateError('No se pudo descargar el APK: ' + err.message);
                return;
            }
        }

        // Fallback web: anchor con download
        try {
            const a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => a.remove(), 100);
        } catch (e) {
            window.location.href = url;
        }
    }

    async function downloadAndInstallApk(url) {
        const { Filesystem } = window.Capacitor.Plugins;
        const FileOpener = window.Capacitor.Plugins.FileOpener || window.Capacitor.Plugins.fileOpener;

        showDownloadProgress(0, 'Conectando…');

        // Detectar nombre del archivo desde la URL
        const fileName = (url.split('/').pop().split('?')[0]) || ('SolucNetAdmin-' + Date.now() + '.apk');

        // 🆕 PROGRESO REAL — usar fetch + ReadableStream para mostrar % verdadero
        let blob;
        try {
            const resp = await fetch(url, { cache: 'no-store' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const total = parseInt(resp.headers.get('Content-Length') || '0', 10);
            const reader = resp.body?.getReader?.();
            if (reader && total > 0) {
                const chunks = [];
                let received = 0;
                showDownloadProgress(0, 'Descargando v' + (url.match(/v(\d+\.\d+\.\d+)/)?.[1] || 'nueva') + '…');
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    received += value.length;
                    showDownloadProgress((received / total) * 100,
                        `Descargando… ${Math.round(received / 1024 / 1024 * 10) / 10}/${Math.round(total / 1024 / 1024 * 10) / 10} MB`);
                }
                blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
            } else {
                blob = await resp.blob();
                showDownloadProgress(95, 'Guardando…');
            }
        } catch (e) {
            console.error('[UPDATE] Error en fetch con progreso, fallback a Filesystem.downloadFile:', e);
            // Fallback al método viejo (sin progreso real)
            return await fallbackDownloadFile(url, fileName, FileOpener);
        }

        // Escribir el blob a Filesystem como base64
        showDownloadProgress(100, 'Guardando APK…');
        const rd = new FileReader();
        await new Promise((resolve, reject) => {
            rd.onloadend = resolve;
            rd.onerror = reject;
            rd.readAsDataURL(blob);
        });
        const base64 = String(rd.result).split(',')[1] || '';

        let writeResult;
        try {
            writeResult = await Filesystem.writeFile({
                path: fileName,
                data: base64,
                directory: 'EXTERNAL_STORAGE',
                recursive: true
            });
        } catch (e1) {
            console.warn('[UPDATE] EXTERNAL_STORAGE falló, probando DOCUMENTS:', e1);
            writeResult = await Filesystem.writeFile({
                path: fileName,
                data: base64,
                directory: 'DOCUMENTS',
                recursive: true
            });
        }

        const filePath = writeResult.uri || writeResult.path;
        if (!filePath) throw new Error('No se obtuvo path del archivo guardado');
        showDownloadProgress(100, 'Abriendo instalador de Android…');

        // 🆕 Auto-lanzar instalador: usar FileOpener con flag para abrir directamente
        if (FileOpener) {
            try {
                await FileOpener.open({
                    filePath,
                    contentType: 'application/vnd.android.package-archive',
                    openWithDefault: true
                });
                hideDownloadProgress();
                return;
            } catch (eOpener) {
                console.warn('[UPDATE] FileOpener falló:', eOpener);
            }
        }
        // Fallback: App.openUrl
        try {
            if (window.Capacitor?.Plugins?.App?.openUrl) {
                await window.Capacitor.Plugins.App.openUrl({ url: 'file://' + filePath });
                hideDownloadProgress();
                return;
            }
        } catch {}
        hideDownloadProgress();
        showUpdateError('APK descargado. Abre desde Descargas para instalar.');
    }

    // Fallback al método anterior si fetch con progreso falla
    async function fallbackDownloadFile(url, fileName, FileOpener) {
        const { Filesystem } = window.Capacitor.Plugins;
        showDownloadProgress(50, 'Descargando…');
        let result;
        try {
            result = await Filesystem.downloadFile({ url, path: fileName, directory: 'EXTERNAL_STORAGE', recursive: true });
        } catch {
            result = await Filesystem.downloadFile({ url, path: fileName, directory: 'DOCUMENTS', recursive: true });
        }
        showDownloadProgress(100, 'Abriendo instalador…');
        const filePath = result.path || result.uri;
        if (FileOpener) {
            try {
                await FileOpener.open({ filePath, contentType: 'application/vnd.android.package-archive', openWithDefault: true });
                hideDownloadProgress();
                return;
            } catch {}
        }
        hideDownloadProgress();
        showUpdateError('APK descargado. Abre desde Descargas para instalar.');
    }

    function showDownloadProgress(pct, text) {
        let dl = document.getElementById('update-download-bar');
        if (!dl) {
            dl = document.createElement('div');
            dl.id = 'update-download-bar';
            dl.style.cssText = `
                position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                background: white; padding: 14px 20px; border-radius: 12px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.2); z-index: 99999;
                min-width: 240px; text-align: center; font-size: 0.9em;
            `;
            document.body.appendChild(dl);
        }
        dl.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; color:#0066cc;">
                <i class="fas fa-download fa-bounce"></i>
                <b>${text}</b>
            </div>
            <div style="background:#e0e0e0; height:6px; border-radius:3px; overflow:hidden;">
                <div style="background:linear-gradient(90deg, #0084ff, #0066cc); height:100%; width:${pct}%; transition:width 0.3s;"></div>
            </div>
        `;
    }
    function hideDownloadProgress() {
        const dl = document.getElementById('update-download-bar');
        if (dl) dl.remove();
    }
    function showUpdateError(msg) {
        hideDownloadProgress();
        let err = document.createElement('div');
        err.style.cssText = `
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            background: #dc3545; color: white; padding: 12px 18px; border-radius: 10px;
            z-index: 99999; max-width: 90%; text-align: center; font-size: 0.88em;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        `;
        err.textContent = msg;
        document.body.appendChild(err);
        setTimeout(() => err.remove(), 5000);
    }

    // 🆕 Lee la versión REAL del APK instalado (no la hardcoded del config.js)
    async function getCurrentVersion() {
        // 1) Capacitor App plugin (versión real del AndroidManifest)
        try {
            if (window.Capacitor?.Plugins?.App) {
                const info = await window.Capacitor.Plugins.App.getInfo();
                if (info?.version) return info.version;
            }
        } catch {}
        // 2) Fallback al config.js (web/dev)
        return APP_CONFIG.APP_VERSION;
    }

    // iPhone: no hay APK — las versiones nuevas llegan por TestFlight / App Store (la app se actualiza sola desde allí)
    const esIOS = !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'ios');

    async function check() {
        if (esIOS) return null;
        try {
            const url = APP_CONFIG.SERVER_URL + '/api/admin-app-version';
            const resp = await fetch(url, { cache: 'no-store' });
            if (!resp.ok) return;
            const data = await resp.json();
            if (!data || !data.version) return;
            const currentVersion = await getCurrentVersion();
            const cmp = compareVersions(data.version, currentVersion);
            console.log(`[UPDATE] Actual: ${currentVersion}, Servidor: ${data.version}, cmp: ${cmp}`);
            if (cmp > 0) {
                if (!bannerShown) {
                    bannerShown = true;
                    showUpdateBanner(data);
                }
            } else {
                // Misma versión o más nueva → no mostrar banner
                bannerShown = false;
            }
        } catch (err) {
            console.warn('[UPDATE] Error verificando:', err.message);
        }
    }

    function showUpdateBanner(versionInfo) {
        // No mostrar si el usuario ya ignoró esta misma versión
        const dismissedVersion = localStorage.getItem('admin_update_dismissed_v');
        if (dismissedVersion === versionInfo.version && !versionInfo.force) {
            console.log('[UPDATE] Versión ya descartada por el usuario');
            return;
        }
        // Cerrar cualquier banner anterior
        const old = document.getElementById('update-banner');
        if (old) old.remove();

        const banner = document.createElement('div');
        banner.id = 'update-banner';
        banner.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0;
            background: linear-gradient(135deg, #f59e0b, #f97316);
            color: white;
            padding: calc(env(safe-area-inset-top, 0px) + 12px) 16px 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 99999;
            display: flex;
            align-items: center;
            gap: 12px;
            animation: slideDown 0.3s ease-out;
        `;
        const changelogHtml = (versionInfo.changelog || []).slice(0, 3).map(c => `<li>${escapeHtml(c)}</li>`).join('');
        banner.innerHTML = `
            <div style="font-size: 1.5em;">🚀</div>
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 700; font-size: 0.95em;">Nueva versión disponible</div>
                <div style="font-size: 0.78em; opacity: 0.9; margin-top: 1px;">
                    v${versionInfo.version} ${versionInfo.force ? '(obligatoria)' : ''}
                </div>
            </div>
            <button id="update-btn" style="background: white; color: #f59e0b; border: none; padding: 8px 14px; border-radius: 18px; font-weight: 700; font-size: 0.85em; cursor: pointer;">
                Actualizar
            </button>
            ${versionInfo.force ? '' : '<button id="update-dismiss-btn" style="background: rgba(255,255,255,0.2); color: white; border: none; padding: 8px 10px; border-radius: 50%; cursor: pointer; font-size: 0.9em;"><i class="fas fa-times"></i></button>'}
        `;
        // Inyectar estilos animación
        if (!document.getElementById('update-banner-style')) {
            const style = document.createElement('style');
            style.id = 'update-banner-style';
            style.textContent = `@keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }`;
            document.head.appendChild(style);
        }
        document.body.appendChild(banner);

        // Acciones
        document.getElementById('update-btn').addEventListener('click', () => {
            const url = APP_CONFIG.SERVER_URL + versionInfo.downloadUrl;
            openDownloadUrl(url);
        });
        const dismissBtn = document.getElementById('update-dismiss-btn');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', () => {
                localStorage.setItem('admin_update_dismissed_v', versionInfo.version);
                banner.remove();
            });
        }

        // Si es force, mostrar modal pantalla completa que no se puede cerrar
        if (versionInfo.force) showForceUpdateModal(versionInfo);
    }

    function showForceUpdateModal(versionInfo) {
        const overlay = document.createElement('div');
        overlay.id = 'force-update-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.92);
            color: white;
            z-index: 99998;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 24px;
            text-align: center;
        `;
        const changelog = (versionInfo.changelog || []).map(c => `<li>${escapeHtml(c)}</li>`).join('');
        overlay.innerHTML = `
            <div style="font-size: 4em; margin-bottom: 16px;">🚀</div>
            <h2 style="font-size: 1.4em; margin-bottom: 8px;">Actualización obligatoria</h2>
            <p style="opacity: 0.85; margin-bottom: 14px;">SolucNet Admin v${versionInfo.version}</p>
            <ul style="text-align: left; padding-left: 20px; margin-bottom: 24px; font-size: 0.92em; opacity: 0.9;">${changelog}</ul>
            <button id="force-update-btn" style="background: linear-gradient(135deg, #f59e0b, #f97316); color: white; border: none; padding: 14px 30px; border-radius: 22px; font-size: 1em; font-weight: 700; cursor: pointer; box-shadow: 0 4px 16px rgba(245,158,11,0.4);">
                <i class="fas fa-download"></i> Descargar e instalar
            </button>
        `;
        document.body.appendChild(overlay);
        document.getElementById('force-update-btn').addEventListener('click', () => {
            const url = APP_CONFIG.SERVER_URL + versionInfo.downloadUrl;
            openDownloadUrl(url);
        });
    }

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
    }

    function listenToSocket() {
        // Si existe socket conectado y emite admin:nueva_version, recargar info
        if (typeof window.io !== 'undefined' && typeof socketAdmin !== 'undefined' && socketAdmin) {
            socketAdmin.on('admin:nueva_version', (data) => {
                console.log('[UPDATE] Socket avisó nueva versión:', data);
                if (data && compareVersions(data.version, APP_CONFIG.APP_VERSION) > 0) {
                    bannerShown = false; // permitir nuevo banner
                    showUpdateBanner(data);
                }
            });
        }
    }

    function start() {
        if (esIOS) return;
        // Check inmediato
        check();
        // Polling cada 10 min
        if (timer) clearInterval(timer);
        timer = setInterval(check, CHECK_INTERVAL_MS);
        // Socket listener (si está disponible)
        listenToSocket();
    }

    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
    }

    return { start, stop, check };
})();
