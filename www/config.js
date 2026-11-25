// 🆕 Configuración de la app móvil SolucNet ADMIN
// App para admin/soporte (no técnicos). Apunta al dashboard cliente.solucnet.com
// y respeta los permisos del usuario logueado.
const APP_CONFIG = {
    APP_NAME: 'SolucNet Admin',
    APP_ID: 'com.solucnet.admin',
    // ⚠️ Sólo es fallback — la fuente de verdad es Capacitor App.getInfo() (versión real del APK)
    APP_VERSION: '1.0.193',
    APP_VERSION_CODE: 194,

    // Detectar si está corriendo en app nativa (Capacitor)
    _isNative: (function() {
        if (typeof window !== 'undefined' && window.Capacitor) return true;
        if (typeof window !== 'undefined' && window.location.protocol === 'capacitor:') return true;
        return false;
    })(),

    // URL del servidor — dashboard principal
    SERVER_URL: 'https://cliente.solucnet.com',

    // Endpoint de login (admin/soporte). NO usar /api/login-tecnicos.
    LOGIN_ENDPOINT: '/api/login',

    // Pantalla principal del dashboard (WebView completo)
    DASHBOARD_PATH: '/',

    // Storage keys para sesión persistente
    STORAGE: {
        TOKEN: 'solucnet_admin_token',
        USER: 'solucnet_admin_user',
        FCM_TOKEN: 'solucnet_admin_fcm_token',
    },

    getApiUrl: function(endpoint) {
        if (!endpoint.startsWith('/')) endpoint = '/' + endpoint;
        return this.SERVER_URL + endpoint;
    },

    redirectTo: function(path) {
        const cleanPath = path.replace(/^\//, '');
        if (this._isNative) {
            window.location.href = cleanPath;
        } else {
            const currentPath = window.location.pathname;
            if (currentPath.includes('/mobile-admin/')) {
                window.location.href = '/mobile-admin/' + cleanPath;
            } else {
                window.location.href = '/' + cleanPath;
            }
        }
    },

    // Abrir el dashboard completo (WebView del panel real)
    openDashboard: function(token) {
        const url = this.SERVER_URL + this.DASHBOARD_PATH + (token ? '?token=' + encodeURIComponent(token) : '');
        window.location.href = url;
    },

    isNative: function() { return this._isNative; }
};

// 🛡️ Asignación EXPLÍCITA al global window. En Capacitor WebView, los `const`
// declarados a top-level no siempre quedan en `window`, lo que hace que módulos
// posteriores que lean `window.APP_CONFIG?.SERVER_URL` reciban undefined y armen
// URLs relativas que terminan cayendo en el bundle local.
window.APP_CONFIG = APP_CONFIG;

console.log('🔧 [ADMIN APP] Config:', {
    isNative: APP_CONFIG.isNative(),
    serverUrl: APP_CONFIG.SERVER_URL,
    version: APP_CONFIG.APP_VERSION
});
