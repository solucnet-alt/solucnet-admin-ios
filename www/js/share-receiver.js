// 🆕 SHARE RECEIVER — Recibe archivos compartidos desde otras apps Android.
// Cuando el usuario hace "Compartir" en otra app (galería, WhatsApp, navegador, etc.)
// y elige SolucNet Admin, este módulo lee el archivo recibido y muestra un selector
// de chat (con barra de búsqueda) para reenviar el contenido.
const ShareReceiver = (function() {
    let processing = false;

    async function init() {
        // Solo en Capacitor nativo
        if (!window.Capacitor || !window.Capacitor.isNativePlatform?.()) return;
        // Plugin send-intent expone window.Capacitor.Plugins.SendIntent o requiere import dinámico
        // Capacitor v7 hace el plugin global automáticamente cuando se sincroniza
        const SendIntent = window.Capacitor.Plugins?.SendIntent;
        if (!SendIntent) {
            console.warn('[ShareReceiver] Plugin SendIntent no disponible');
            return;
        }
        // 1) Revisar si hay un intent pendiente al abrir la app
        try {
            const result = await SendIntent.checkSendIntentReceived();
            if (result && (result.url || result.title || result.description)) {
                handleSharedContent(result);
            }
        } catch (e) {
            // Silencioso — sin intent pendiente
        }
        // 2) Escuchar nuevos intents mientras la app está abierta
        window.addEventListener('sendIntentReceived', async () => {
            try {
                const result = await SendIntent.checkSendIntentReceived();
                if (result && (result.url || result.title)) handleSharedContent(result);
            } catch {}
        });
    }

    async function handleSharedContent(intent) {
        if (processing) return; // Evitar reentrada
        processing = true;
        try {
            // intent.url: URI del archivo (file:// o content://)
            // intent.title: si compartió texto
            // intent.type: mime type
            console.log('[ShareReceiver] Intent recibido:', intent);
            await mostrarSelectorChat(intent);
        } catch (e) {
            console.error('[ShareReceiver] Error procesando:', e);
            if (typeof showToast === 'function') showToast('Error procesando archivo compartido', 'error');
        } finally {
            processing = false;
            // Limpiar el intent en el plugin para evitar duplicados al reabrir
            try {
                const SendIntent = window.Capacitor.Plugins?.SendIntent;
                if (SendIntent?.finish) await SendIntent.finish();
            } catch {}
        }
    }

    async function mostrarSelectorChat(intent) {
        // Cargar la lista de chats
        let chats = [];
        try {
            const data = await API.get('/api/chats');
            chats = data?.chats || data || [];
        } catch (e) {
            alert('No se pudo cargar la lista de chats: ' + e.message);
            return;
        }
        // Filtrar grupos y vacíos
        chats = chats.filter(c => c.id && !c.id.includes('@g.us'));

        const isText = !intent.url && (intent.title || intent.description);
        const fileName = intent.url ? (intent.url.split('/').pop() || 'archivo') : '';
        const previewType = (intent.type || '').startsWith('image/') ? 'image'
                          : (intent.type === 'application/pdf' ? 'pdf' : 'file');

        // Crear overlay
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.zIndex = 99997;
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:92vh; display:flex; flex-direction:column;">
                <div class="modal-header" style="background:linear-gradient(135deg,#0084ff,#0066cc);">
                    <h3><i class="fas fa-share-square"></i> Enviar a chat</h3>
                    <button class="modal-close" style="background:none; border:none; color:white; font-size:1.4em; cursor:pointer;">&times;</button>
                </div>
                <div style="padding:12px 16px; background:#f8f9fa; border-bottom:1px solid #eee;">
                    ${isText ? `
                        <div style="font-size:0.85em; color:#666; margin-bottom:4px;"><i class="fas fa-quote-left"></i> Texto compartido:</div>
                        <div style="background:white; padding:8px; border-radius:6px; max-height:80px; overflow-y:auto; font-size:0.88em;">${escapeHtml((intent.title || intent.description || '').substring(0, 500))}</div>
                    ` : `
                        <div style="display:flex; gap:10px; align-items:center;">
                            <div style="width:42px; height:42px; background:${previewType==='image'?'#10b981':previewType==='pdf'?'#dc3545':'#6366f1'}; color:white; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.3em;">
                                <i class="fas fa-${previewType==='image'?'image':previewType==='pdf'?'file-pdf':'paperclip'}"></i>
                            </div>
                            <div style="flex:1; min-width:0;">
                                <div style="font-weight:600; font-size:0.9em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(fileName)}</div>
                                <div style="font-size:0.75em; color:#888;">${escapeHtml(intent.type || 'archivo')}</div>
                            </div>
                        </div>
                    `}
                </div>
                <div style="padding:10px 14px; border-bottom:1px solid #eee;">
                    <input id="share-search" type="text" placeholder="Buscar número o nombre…" style="width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:0.92em; box-sizing:border-box;">
                </div>
                <div id="share-chats-list" style="flex:1; overflow-y:auto; padding:6px;"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.modal-close').onclick = () => overlay.remove();

        // Renderizar lista de chats
        const cont = overlay.querySelector('#share-chats-list');
        const renderChats = (term = '') => {
            const t = term.toLowerCase().trim();
            const filtered = !t ? chats : chats.filter(c => {
                const num = (c.id || '').replace('@c.us', '').replace('@lid', '').toLowerCase();
                const name = (c.name || '').toLowerCase();
                return num.includes(t) || name.includes(t);
            });
            if (!filtered.length) {
                cont.innerHTML = '<div style="text-align:center; color:#999; padding:30px;">Sin resultados</div>';
                return;
            }
            cont.innerHTML = filtered.slice(0, 60).map(c => {
                const num = (c.id || '').replace('@c.us', '').replace('@lid', '');
                const nombre = c.name && c.name !== num ? c.name : '';
                const initial = (nombre || '+' + num).charAt(0).toUpperCase();
                return `
                    <div data-chat-id="${escapeHtml(c.id)}" data-chat-name="${escapeHtml(nombre || num)}" class="share-chat-row" style="display:flex; gap:10px; align-items:center; padding:9px 10px; border-bottom:1px solid #f3f3f3; cursor:pointer;">
                        <div style="width:38px; height:38px; background:linear-gradient(135deg,#667eea,#764ba2); color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:600;">${escapeHtml(initial)}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:600; font-size:0.9em;">+${escapeHtml(num)}</div>
                            ${nombre ? `<div style="font-size:0.75em; color:#777; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(nombre)}</div>` : ''}
                        </div>
                        <i class="fas fa-paper-plane" style="color:#0066cc;"></i>
                    </div>
                `;
            }).join('');
            cont.querySelectorAll('.share-chat-row').forEach(row => {
                row.addEventListener('click', () => enviarA(row.dataset.chatId, row.dataset.chatName));
            });
        };
        renderChats('');
        overlay.querySelector('#share-search').addEventListener('input', (e) => renderChats(e.target.value));

        async function enviarA(chatId, chatName) {
            if (!confirm(`¿Enviar a "${chatName || chatId}"?`)) return;
            const cardBtn = cont.querySelector(`[data-chat-id="${CSS.escape(chatId)}"]`);
            if (cardBtn) cardBtn.style.opacity = '0.5';
            try {
                if (isText) {
                    // Enviar como mensaje de texto
                    const msg = (intent.title || intent.description || '').toString();
                    const resp = await API.post('/api/send-message', { chatId, message: msg, skipDelay: true });
                    if (resp?.success) {
                        showToast?.('Texto enviado ✓', 'success');
                        overlay.remove();
                    } else {
                        showToast?.('Error: ' + (resp?.message || 'no se pudo enviar'), 'error');
                        if (cardBtn) cardBtn.style.opacity = '1';
                    }
                    return;
                }
                // Enviar archivo: leer URI, convertir a blob, FormData
                const blob = await fetchFileFromUri(intent.url);
                if (!blob) { showToast?.('No se pudo leer el archivo', 'error'); if (cardBtn) cardBtn.style.opacity = '1'; return; }
                const file = new File([blob], fileName || `archivo_${Date.now()}`, { type: intent.type || blob.type || 'application/octet-stream' });
                const fd = new FormData();
                fd.append('chatId', chatId);
                fd.append('file', file);
                const r = await fetch(APP_CONFIG.SERVER_URL + '/api/send-file', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + API.getToken() },
                    body: fd
                });
                if (r.ok) { showToast?.('Archivo enviado ✓', 'success'); overlay.remove(); }
                else { showToast?.('Error enviando archivo', 'error'); if (cardBtn) cardBtn.style.opacity = '1'; }
            } catch (e) {
                console.error('[ShareReceiver] enviarA error:', e);
                showToast?.('Error: ' + e.message, 'error');
                if (cardBtn) cardBtn.style.opacity = '1';
            }
        }
    }

    // Lee un content:// o file:// URI y devuelve un Blob
    async function fetchFileFromUri(uri) {
        try {
            // Para content:// y file://, en Capacitor podemos usar fetch directo
            const resp = await fetch(uri);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return await resp.blob();
        } catch (e) {
            console.warn('[ShareReceiver] fetch directo falló, intentando Filesystem.readFile:', e);
            try {
                const Filesystem = window.Capacitor.Plugins?.Filesystem;
                if (!Filesystem) return null;
                // readFile devuelve base64
                const result = await Filesystem.readFile({ path: uri });
                const base64 = result.data;
                // Convertir base64 → Blob
                const byteChars = atob(base64);
                const byteNumbers = new Array(byteChars.length);
                for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
                return new Blob([new Uint8Array(byteNumbers)]);
            } catch (e2) {
                console.error('[ShareReceiver] Filesystem.readFile falló:', e2);
                return null;
            }
        }
    }

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
    }
    function showToast(msg, type) {
        // Reusar el del módulo si existe, sino un toast simple
        const t = document.createElement('div');
        t.style.cssText = `position:fixed; bottom:30px; left:50%; transform:translateX(-50%); background:${type==='error'?'#dc3545':'#16a34a'}; color:white; padding:10px 18px; border-radius:8px; z-index:999999; font-size:0.88em;`;
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2200);
    }

    return { init };
})();

// Auto-init después de DOMContentLoaded (esperar Capacitor)
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => ShareReceiver.init(), 600);
});
