// 🆕 API wrapper para SolucNet Admin
// Maneja: token automático, retries, errores, timeouts
const API = (function() {
    const TIMEOUT_MS = 20000;

    function getToken() {
        return localStorage.getItem(APP_CONFIG.STORAGE.TOKEN)
            || localStorage.getItem('token')
            || null;
    }

    async function call(method, endpoint, body = null, options = {}) {
        const token = getToken();
        const url = APP_CONFIG.getApiUrl(endpoint);
        const headers = { ...(options.headers || {}) };
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeout || TIMEOUT_MS);

        const fetchOpts = { method, headers, signal: controller.signal };
        if (body) {
            if (body instanceof FormData) {
                fetchOpts.body = body;
            } else {
                headers['Content-Type'] = 'application/json';
                fetchOpts.body = JSON.stringify(body);
            }
        }

        try {
            const resp = await fetch(url, fetchOpts);
            clearTimeout(timeout);
            if (resp.status === 401) {
                // 🔧 v1.0.80: Endpoints externos (GestorOLT, etc) tienen su PROPIO auth
                // independiente del bot. Si dan 401, NO significa que la sesión del admin
                // esté caducada — solo que no tenemos auth válido para ese backend específico.
                // No tirar al login por 401 de endpoints externos.
                const externalEndpoint = endpoint.startsWith('/gestorolt/')
                    || endpoint.startsWith('/tutv/');
                if (externalEndpoint) {
                    console.warn('[API] 401 en endpoint externo', endpoint, '— ignorando (no es session del admin)');
                    return null;
                }
                // 401 en endpoint principal del bot = sesión realmente caducada
                console.warn('[API] 401 en', endpoint, '— cerrando sesión');
                try {
                    localStorage.removeItem(APP_CONFIG.STORAGE.TOKEN);
                    localStorage.removeItem('token');
                    localStorage.removeItem(APP_CONFIG.STORAGE.USER);
                    localStorage.removeItem('user');
                    if (window.Capacitor?.Plugins?.Preferences) {
                        await window.Capacitor.Plugins.Preferences.remove({ key: APP_CONFIG.STORAGE.TOKEN });
                    }
                } catch {}
                window.location.href = 'login.html';
                return null;
            }
            const ct = resp.headers.get('content-type') || '';
            const isJson = ct.includes('application/json');
            const payload = isJson ? await resp.json() : await resp.text();
            // 🛡️ v2026-06-10 (caso ZTEGCC25B9AC OLT Salsipuedes): antes solo se chequeaba
            // resp.status===401. Si el backend respondía 400/422/500 con un JSON de error
            // ({detail: "..."} o {success:false}), la llamada retornaba ese body como si
            // fuera éxito → la app mostraba "ONU autorizada ✓" cuando realmente falló.
            // Ahora: !resp.ok lanza una excepción con el detalle del backend.
            if (!resp.ok) {
                let detail = '';
                if (isJson && payload) {
                    detail = payload.detail || payload.error || payload.message || JSON.stringify(payload).slice(0, 180);
                } else if (typeof payload === 'string') {
                    detail = payload.slice(0, 180);
                }
                const e = new Error(`HTTP ${resp.status}${detail ? ': ' + detail : ''}`);
                e.status = resp.status;
                e.payload = payload;
                throw e;
            }
            return payload;
        } catch (err) {
            clearTimeout(timeout);
            if (err.name === 'AbortError') throw new Error('Timeout de red');
            throw err;
        }
    }

    return {
        get: (ep, opts) => call('GET', ep, null, opts),
        post: (ep, body, opts) => call('POST', ep, body, opts),
        put: (ep, body, opts) => call('PUT', ep, body, opts),
        del: (ep, opts) => call('DELETE', ep, null, opts),
        getToken,
    };
})();
