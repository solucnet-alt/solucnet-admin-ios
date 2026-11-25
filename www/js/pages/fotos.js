// 🆕 Página: Fotos de reportes de visitas (galería con lightbox)
const FotosPage = (function() {
    let reportes = [];
    let fotosCargadas = new Map(); // reporteId → fotos
    let searchTerm = '';

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    }

    function fmtFecha(ts) {
        if (!ts) return '—';
        try { return new Date(ts).toLocaleString('es-CO', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); }
        catch { return '—'; }
    }

    function resolveUrl(path) {
        if (!path) return '';
        if (path.startsWith('http')) return path;
        return APP_CONFIG.SERVER_URL + (path.startsWith('/') ? path : '/' + path);
    }

    function renderReporte(r, fotos) {
        const fotosHtml = fotos.length
            ? `<div style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-top:8px;">
                ${fotos.map(f => `
                    <img src="${resolveUrl(f.ruta_archivo)}" onclick="FotosPage.openLightbox('${resolveUrl(f.ruta_archivo)}')" loading="lazy" style="width:100%; aspect-ratio:1; object-fit:cover; border-radius:6px; cursor:pointer; background:#f0f0f0;">
                `).join('')}
            </div>`
            : '<div style="font-size:0.8em; color:#999; margin-top:6px;">Sin fotos</div>';

        return `
            <div style="background:white; border-radius:12px; padding:14px; margin-bottom:8px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:0.92em;">${escapeHtml(r.cliente_nombre || 'Cliente')}</div>
                        <div style="font-size:0.75em; color:#666; margin-top:2px;"><i class="fas fa-clock"></i> ${fmtFecha(r.fecha_reporte)}</div>
                        ${r.problemas_encontrados ? `<div style="font-size:0.8em; color:#7f1d1d; margin-top:4px;"><i class="fas fa-exclamation-triangle"></i> ${escapeHtml(r.problemas_encontrados.substring(0, 80))}${r.problemas_encontrados.length > 80 ? '…' : ''}</div>` : ''}
                    </div>
                    <span style="background:#dcfce7; color:#16a34a; font-size:0.7em; font-weight:600; padding:3px 8px; border-radius:8px;">${fotos.length} foto${fotos.length !== 1 ? 's' : ''}</span>
                </div>
                ${fotosHtml}
            </div>
        `;
    }

    function applyFiltros() {
        if (!searchTerm) return reportes;
        const q = searchTerm.toLowerCase();
        return reportes.filter(r =>
            (r.cliente_nombre || '').toLowerCase().includes(q) ||
            (r.problemas_encontrados || '').toLowerCase().includes(q) ||
            (r.notas || '').toLowerCase().includes(q)
        );
    }

    async function renderList() {
        const lista = applyFiltros();
        const c = document.getElementById('fotos-list-container');
        if (!c) return;
        document.getElementById('fotos-count').textContent = `${lista.length} reportes`;
        if (!lista.length) {
            c.innerHTML = `<div class="empty-state"><i class="fas fa-camera"></i><p>Sin reportes</p></div>`;
            return;
        }
        // Cargar fotos en paralelo (con cache)
        c.innerHTML = '<div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando fotos…</div>';
        await Promise.all(lista.map(async r => {
            if (!fotosCargadas.has(r.id)) {
                try {
                    const data = await API.get(`/api/reportes/${r.id}/fotos`);
                    fotosCargadas.set(r.id, data?.fotos || []);
                } catch { fotosCargadas.set(r.id, []); }
            }
        }));
        // Filtrar solo los que tienen fotos
        const conFotos = lista.filter(r => (fotosCargadas.get(r.id) || []).length > 0);
        if (!conFotos.length) {
            c.innerHTML = `<div class="empty-state"><i class="fas fa-camera"></i><p>Ninguno de los reportes tiene fotos</p></div>`;
            return;
        }
        c.innerHTML = conFotos.map(r => renderReporte(r, fotosCargadas.get(r.id) || [])).join('');
    }

    async function load() {
        const c = document.getElementById('fotos-list-container');
        if (c) c.innerHTML = `<div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando reportes…</div>`;
        try {
            const data = await API.get('/api/reportes-completados?limit=50');
            reportes = data?.reportes || (Array.isArray(data) ? data : []);
            fotosCargadas.clear();
            await renderList();
        } catch (err) {
            if (c) c.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle" style="color:#dc3545;"></i><p>Error: ${escapeHtml(err.message)}</p></div>`;
        }
    }

    function openLightbox(src) {
        const box = document.createElement('div');
        box.className = 'lightbox';
        box.innerHTML = `
            <button class="lightbox-close" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>
            <button class="lightbox-download" onclick="window.open('${escapeHtml(src)}', '_blank')"><i class="fas fa-external-link-alt"></i></button>
            <img src="${escapeHtml(src)}">
        `;
        document.body.appendChild(box);
        box.addEventListener('click', (e) => { if (e.target === box) box.remove(); });
    }

    function show() {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const main = document.querySelector('.app-main');
        let page = document.getElementById('page-fotos');
        if (!page) {
            page = document.createElement('div');
            page.id = 'page-fotos';
            page.className = 'page';
            main.appendChild(page);
        }
        page.classList.add('active');
        page.innerHTML = `
            <div style="background:white; padding:10px; border-radius:12px; margin-bottom:8px; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                <input type="text" id="fotos-buscar" placeholder="Buscar cliente o problema..." style="width:100%; padding:8px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.9em;">
                <div id="fotos-count" style="font-size:0.78em; color:#666; text-align:center; margin-top:6px;">…</div>
            </div>
            <div id="fotos-list-container"></div>
        `;
        document.getElementById('fotos-buscar').addEventListener('input', (e) => { searchTerm = e.target.value.trim(); renderList(); });
        load();
    }

    return { show, openLightbox };
})();

if (typeof Router !== 'undefined') Router.register('fotos', () => FotosPage.show());
