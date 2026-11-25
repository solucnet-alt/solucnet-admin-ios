// 🆕 Auth + sesión
const Auth = (function() {
    function getUser() {
        const raw = localStorage.getItem(APP_CONFIG.STORAGE.USER) || localStorage.getItem('user');
        try { return raw ? JSON.parse(raw) : null; } catch { return null; }
    }
    function getPermisos() {
        const user = getUser();
        if (!user) return {};
        const p = user.permisos;
        if (!p) return {};
        if (typeof p === 'object') return p;
        try { return JSON.parse(p); } catch { return {}; }
    }
    function tienePermiso(key) {
        const perms = getPermisos();
        return !!perms[key];
    }
    async function logout() {
        try {
            localStorage.removeItem(APP_CONFIG.STORAGE.TOKEN);
            localStorage.removeItem('token');
            localStorage.removeItem(APP_CONFIG.STORAGE.USER);
            localStorage.removeItem('user');
            if (window.Capacitor?.Plugins?.Preferences) {
                await window.Capacitor.Plugins.Preferences.remove({ key: APP_CONFIG.STORAGE.TOKEN });
                await window.Capacitor.Plugins.Preferences.remove({ key: APP_CONFIG.STORAGE.USER });
            }
        } catch {}
        window.location.href = 'login.html';
    }
    return { getUser, getPermisos, tienePermiso, logout };
})();
