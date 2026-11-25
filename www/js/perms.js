/* ============================================================
   SOLUCNET ADMIN — Gateo fino de permisos DENTRO de las pantallas
   2026-10-05. Complementa el drawer (que oculta el menú): acá se
   ocultan/deshabilitan botones/acciones según permiso, para cumplir
   "no mostrar lo que el usuario no puede usar".
   Uso en una página:
     <button class="sn-btn sn-btn--primary" data-perm="gestionar_finanzas">Cerrar período</button>
     // ...y al final del render:
     Perms.apply(contenedor);
   data-perm="a,b"  → basta tener UNO (OR). Admin = superusuario.
   data-perm-hide="disable" → en vez de ocultar, lo deshabilita.
   ============================================================ */
(function () {
  function esAdmin() {
    try {
      var u = (window.Auth && Auth.getUser) ? Auth.getUser() : null;
      return !!(u && String(u.rol || '').toLowerCase() === 'admin');
    } catch (e) { return false; }
  }
  function can(clave) {
    if (!clave) return true;
    if (esAdmin()) return true;
    try { return !!(window.Auth && Auth.tienePermiso && Auth.tienePermiso(clave)); }
    catch (e) { return false; }
  }
  function canAny(lista) {
    if (!lista) return true;
    return String(lista).split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      .some(function (k) { return can(k); });
  }
  function apply(root) {
    root = root || document;
    try {
      root.querySelectorAll('[data-perm]').forEach(function (el) {
        if (canAny(el.getAttribute('data-perm'))) { el.hidden = false; return; }
        if (el.getAttribute('data-perm-hide') === 'disable') {
          el.disabled = true; el.classList.add('is-locked'); el.setAttribute('aria-disabled', 'true');
        } else {
          el.remove();
        }
      });
    } catch (e) { console.warn('[Perms] apply:', e && e.message); }
  }
  window.Perms = { can: can, canAny: canAny, apply: apply, esAdmin: esAdmin };
})();
