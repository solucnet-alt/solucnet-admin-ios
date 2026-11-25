// 🆕 Router SPA por hash (#chats, #onus, #visitas, #plantillas, #perfil, #chat/:id)
const Router = (function() {
    const routes = {};
    let current = null;

    function register(name, handler) { routes[name] = handler; }

    function parseHash() {
        const hash = window.location.hash.replace(/^#/, '') || 'chats';
        const [name, ...params] = hash.split('/');
        return { name, params };
    }

    async function navigate(hash) {
        if (!hash.startsWith('#')) hash = '#' + hash;
        if (window.location.hash === hash) {
            // Re-renderizar la página actual
            await render();
        } else {
            window.location.hash = hash;
        }
    }

    async function render() {
        const { name, params } = parseHash();
        const handler = routes[name];
        if (!handler) {
            console.warn('[Router] No handler para:', name);
            return;
        }
        current = name;
        try {
            await handler(params);
        } catch (err) {
            console.error('[Router] Error renderizando', name, err);
        }
        // Actualizar bottom nav active
        document.querySelectorAll('.bottom-nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.route === name);
        });
    }

    function init() {
        window.addEventListener('hashchange', render);
        // Renderizar al arrancar
        if (!window.location.hash) window.location.hash = '#chats';
        else render();
    }

    return { register, navigate, render, init, current: () => current };
})();
