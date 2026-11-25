// 🆕 Detalle de chat — pantalla con mensajes, envío, responder, reaccionar, reenviar, borrar
const ChatDetailPage = (function() {
    let currentChatId = null;
    let _firstUnreadId = null; // 🆕 v2026-07: id del primer mensaje no leído (divisor + botón "jump")
    let currentChat = null;
    let messages = [];
    let replyingTo = null;
    let isLoading = false;
    let lastMessagesHash = '';
    let messagesOffset = 0;       // 🆕 para scroll infinito
    let hasMoreMessages = true;   // 🆕 indica si hay más en BD
    let isLoadingMore = false;    // 🆕 evita disparar múltiples cargas
    const PAGE_SIZE = 50;

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
    }

    function formatTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    }

    function formatDateSeparator(ts) {
        const d = new Date(ts);
        const now = new Date();
        const sameDay = d.toDateString() === now.toDateString();
        const yest = new Date(now); yest.setDate(yest.getDate() - 1);
        const isYest = d.toDateString() === yest.toDateString();
        if (sameDay) return 'Hoy';
        if (isYest) return 'Ayer';
        return d.toLocaleDateString('es-CO', { weekday: 'long', day: '2-digit', month: 'long' });
    }

    function statusIcon(msg) {
        if (!msg.fromMe) return '';
        // 🆕 Preferir ack_level (estado real de entrega) si está disponible.
        // 🛡️ v2026-07-31: mapeo alineado a la escala Cloud API (= estándar): -1=error, 0=pendiente,
        // 1=enviado (✓), 2=entregado (✓✓ gris), 3=leído (✓✓ azul), 4-5=leído/reproducido (✓✓ azul).
        // Antes estaba CORRIDO (1-2=enviado, 3=entregado, 4-5=leído) → con Cloud, "entregado" se veía
        // como "enviado" y "leído" como "entregado". Cloud manda sent=1/delivered=2/read=3/failed=-1.
        const ack = (typeof msg.ack_level === 'number') ? msg.ack_level : null;
        if (ack === -1) {
            const errTitle = msg.ack_error ? `title="No entregado: ${msg.ack_error.replace(/"/g,'&quot;')}"` : 'title="Mensaje no entregado"';
            return `<i class="fas fa-exclamation-circle msg-status failed" ${errTitle}></i>`;
        }
        // ack 0 = sin confirmación registrada (historial viejo / aún sin webhook de estado). Un mensaje
        // persistido saliente ya salió → ✓ "enviado" (no un reloj de "pendiente", que da falsa impresión
        // de que no se mandó). El estado "enviando" real lo lleva el optimista con status='sending'.
        if (ack === 0 || ack === 1) return '<i class="fas fa-check msg-status sent" title="Enviado"></i>';
        if (ack === 2) return '<i class="fas fa-check-double msg-status delivered" title="Entregado"></i>';
        if (ack >= 3) return '<i class="fas fa-check-double msg-status read" title="Leído"></i>';
        // 🆕 v2026-07: mensaje optimista que FALLÓ al enviar → ícono de error TAPPABLE para reintentar.
        // (Antes caía al fallback y mostraba un reloj de "pendiente", engañoso: el asesor no sabía que falló.)
        if (msg.status === 'failed') return `<i class="fas fa-exclamation-circle msg-status failed" onclick="event.stopPropagation(); ChatDetailPage.retryMessage('${escapeHtml(String(msg.id))}')" style="cursor:pointer;" title="No enviado — tocá para reenviar"></i>`;
        // Fallback al status legacy si no hay ack_level
        if (msg.status === 'read') return '<i class="fas fa-check-double msg-status read"></i>';
        if (msg.status === 'delivered') return '<i class="fas fa-check-double msg-status"></i>';
        if (msg.status === 'sent') return '<i class="fas fa-check msg-status"></i>';
        return '<i class="far fa-clock msg-status pending"></i>';
    }

    // 🆕 Convertir mediaUrl relativo a absoluto. El backend devuelve paths como
    // /uploads/files/foo.pdf pero la WebView está en localhost, no en el server.
    function resolveMediaUrl(url) {
        if (!url) return '';
        if (url.startsWith('data:') || url.startsWith('blob:')) return url;
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        // Path relativo → prependear server
        const base = APP_CONFIG.SERVER_URL.replace(/\/$/, '');
        const path = url.startsWith('/') ? url : ('/' + url);
        return base + path;
    }

    // 🆕 v1.0.100 (2026-06-06): badge "quién atendió" para mensajes salientes
    function buildSenderBadge(msg) {
        if (!msg || !msg.fromMe) return '';
        const tipo = msg.senderTipo || msg.sender_tipo;
        if (!tipo) return '';
        const nombre = msg.senderNombre || msg.sender_nombre;
        let icon, label;
        switch (tipo) {
            case 'ia':      icon = '🤖'; label = nombre || 'Sol (IA)'; break;
            case 'asesor':  icon = '👤'; label = nombre || 'Asesor'; break;
            case 'sistema': icon = '⚙️'; label = nombre || 'Sistema'; break;
            case 'api':     icon = '🔗'; label = nombre || 'API'; break;
            default: return '';
        }
        return `<span class="sender-badge sender-${tipo}" title="Enviado por ${escapeHtml(label)}">${icon} ${escapeHtml(label)}</span>`;
    }

    // 🔗 v2026-07-30 (Parte B): convierte URLs del texto en enlaces clickeables (como WhatsApp).
    // 🆕 v2026-08: además de linkificar URLs, interpreta el formato estilo WhatsApp de las plantillas
    // (*negrita*, _cursiva_, ~tachado~, ```mono```) y respeta los saltos de línea. Antes salía todo en
    // una sola línea y con los asteriscos literales ("se veían mal" las plantillas enviadas).
    function linkify(text) {
        let esc = escapeHtml(text || '').replace(/\r\n?/g, '\n');
        // 1) Proteger URLs con placeholders para que el markdown no las rompa
        const links = [];
        esc = esc.replace(/(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi, (u) => {
            const href = u.startsWith('http') ? u : 'http://' + u;
            links.push(`<a href="${href}" target="_blank" rel="noopener" onclick="event.stopPropagation();" style="color:#0a84ff; text-decoration:underline; word-break:break-all;">${u}</a>`);
            return `${links.length - 1}`;
        });
        // 2) Formato WhatsApp (sin lookbehind, por compatibilidad con WebViews viejos)
        esc = esc
            .replace(/```([^`]+?)```/g, '<code>$1</code>')
            .replace(/\*([^\s*][^*\n]*?)\*/g, '<b>$1</b>')
            .replace(/_([^\s_][^_\n]*?)_/g, '<i>$1</i>')
            .replace(/~([^\s~][^~\n]*?)~/g, '<s>$1</s>');
        // 3) Restaurar URLs y convertir saltos de línea
        return esc.replace(/(\d+)/g, (_, i) => links[i]).replace(/\n/g, '<br>');
    }
    // 🖼️ v2026-07-30 (Parte B): visor de foto a pantalla completa (tocar la imagen), con descargar.
    function verFotoFull(url) {
        const ov = document.createElement('div');
        // 🛡️ v2026-07-31: clase para que el botón ATRÁS de Android cierre la imagen (no el chat).
        ov.className = 'img-fullview';
        ov.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:12000; display:flex; align-items:center; justify-content:center;';
        ov.innerHTML = `
            <img src="${escapeHtml(url)}" style="max-width:98vw; max-height:88vh; object-fit:contain; border-radius:6px;">
            <a href="${escapeHtml(url)}" download target="_blank" rel="noopener" onclick="event.stopPropagation();" style="position:absolute; top:16px; right:60px; color:#fff; font-size:1.4em;" title="Descargar"><i class="fas fa-download"></i></a>
            <button style="position:absolute; top:12px; right:14px; background:none; border:none; color:#fff; font-size:1.8em; cursor:pointer;">&times;</button>`;
        ov.addEventListener('click', e => { if (e.target === ov || e.target.tagName === 'BUTTON') ov.remove(); });
        document.body.appendChild(ov);
    }

    function renderMessage(msg, prevMsg) {
        const fromMe = msg.fromMe;
        const time = formatTime(msg.timestamp);
        let mediaHtml = '';
        // 🆕 Aceptar tanto mediaUrl (camelCase del backend) como media_url, y resolver a URL absoluta
        const rawMediaUrl = msg.mediaUrl || msg.media_url;
        const mediaUrl = resolveMediaUrl(rawMediaUrl);
        const mediaFilename = msg.filename || msg.media_filename;
        if (mediaUrl) {
            const t = (msg.type || '').toLowerCase();
            if (t === 'image' || t === 'sticker') {
                mediaHtml = `<img class="msg-media" src="${escapeHtml(mediaUrl)}" loading="lazy" alt="imagen" onclick="event.stopPropagation(); ChatDetailPage.openLightbox('${escapeHtml(mediaUrl)}')" style="cursor:pointer;">`;
            } else if (t === 'video') {
                // 🎨 v2026-08-27 (pedido: "compará como se ve en WhatsApp real"): ANTES esto era un
                // <video controls> nativo del navegador metido en la burbuja — se veía como un
                // reproductor de PC, nada que ver con WhatsApp (miniatura + botón play + duración,
                // que recién abre reproductor al tocar). Ahora: miniatura con overlay de play y
                // badge de duración (se completa solo cuando el video carga sus metadatos), y al
                // tocar abre un reproductor a pantalla completa real.
                const vidId = 'vid_' + _imgHashId(String(msg.id));
                mediaHtml = `<div class="msg-video-thumb" id="wrap_${vidId}" onclick="event.stopPropagation(); ChatDetailPage.openVideoFull('${escapeHtml(mediaUrl)}')">
                    <video id="${vidId}" preload="metadata" muted playsinline src="${escapeHtml(mediaUrl)}"
                        onloadedmetadata="ChatDetailPage._setVideoDuration('${vidId}')"></video>
                    <div class="video-play-overlay"><i class="fas fa-play"></i></div>
                    <div class="video-duration-badge" id="dur_${vidId}">…</div>
                </div>`;
            } else if (t === 'audio' || t === 'ptt' || t === 'voice') {
                // 🎨 v2026-08-27: ANTES era un <audio controls> nativo (barra fea del navegador).
                // Ahora: burbuja de nota de voz estilo WhatsApp — botón circular play/pausa +
                // forma de onda (determinística por mensaje, no cambia entre renders) que se va
                // "rellenando" a medida que avanza la reproducción + tiempo transcurrido/total.
                const audId = 'aud_' + _imgHashId(String(msg.id));
                const bars = _waveformBars(String(msg.id));
                const barsHtml = bars.map(h => `<span class="wf-bar" style="height:${Math.round(h * 100)}%"></span>`).join('');
                mediaHtml = `<div class="msg-audio" id="wrap_${audId}">
                    <button class="audio-play-btn" onclick="event.stopPropagation(); ChatDetailPage.toggleAudio('${audId}')"><i class="fas fa-play"></i></button>
                    <div class="audio-waveform" onclick="event.stopPropagation(); ChatDetailPage.seekAudio(event,'${audId}')">
                        ${barsHtml}
                        <div class="wf-progress" id="prog_${audId}" style="width:0%;">${barsHtml}</div>
                    </div>
                    <div class="audio-meta">
                        <span class="audio-time" id="time_${audId}">0:00</span>
                        <button class="audio-speed-btn" onclick="event.stopPropagation(); ChatDetailPage.cycleAudioSpeed(this)" title="Velocidad">1x</button>
                    </div>
                    <audio id="${audId}" preload="metadata" src="${escapeHtml(mediaUrl)}" style="display:none;"
                        ontimeupdate="ChatDetailPage._onAudioTick('${audId}')" onended="ChatDetailPage._onAudioEnded('${audId}')"
                        onloadedmetadata="ChatDetailPage._onAudioTick('${audId}')"></audio>
                    <div class="audio-transcript" id="tr_${audId}">${msg.transcripcion
                        ? `<div class="audio-transcript-text">${escapeHtml(msg.transcripcion)}</div>`
                        : `<button class="audio-transcript-btn" onclick="event.stopPropagation(); ChatDetailPage.transcribirAudioMsg('${escapeHtml(msg.id)}','${audId}')"><i class="fas fa-closed-captioning"></i> Transcribir</button>`}</div>
                </div>`;
            } else if (t === 'document') {
                const fname = mediaFilename || 'documento';
                mediaHtml = `<div class="msg-file" onclick="event.stopPropagation(); ChatDetailPage.abrirVisorDocumento('${escapeHtml(mediaUrl)}', '${escapeHtml(fname)}')" style="cursor:pointer;">
                    <i class="fas fa-file-pdf"></i>
                    <div style="overflow:hidden;">
                        <div style="font-weight:600; font-size:0.9em;">${escapeHtml(fname)}</div>
                        <div style="font-size:0.75em; color:#999;">Tocar para abrir</div>
                    </div>
                </div>`;
            } else {
                const fname = mediaFilename || 'archivo';
                mediaHtml = `<div class="msg-file" onclick="event.stopPropagation(); ChatDetailPage.abrirVisorDocumento('${escapeHtml(mediaUrl)}', '${escapeHtml(fname)}')" style="cursor:pointer;">
                    <i class="fas fa-file"></i> ${escapeHtml(fname)}
                </div>`;
            }
        }
        let quotedHtml = '';
        if (msg.quotedMsg || msg.quoted_msg_body || msg.quoted_msg_id) {
            const qBody = msg.quoted_msg_body || msg.quotedMsg?.body || '';
            const qAuthor = msg.quoted_from_me ? 'Tú' : 'Cliente';
            const qId = msg.quoted_msg_id || msg.quotedMsg?.id || '';
            const authorColor = msg.quoted_from_me ? '#0066cc' : '#16a34a';
            quotedHtml = `<div class="msg-quoted" data-quoted-id="${escapeHtml(qId)}" onclick="event.stopPropagation(); ChatDetailPage.scrollToQuoted('${escapeHtml(qId)}')" style="cursor:pointer; border-left:3px solid ${authorColor}; padding:5px 8px; margin:2px 0 5px; background:rgba(0,0,0,0.04); border-radius:4px;">
                <div style="font-size:0.78em; font-weight:700; color:${authorColor};">${qAuthor}</div>
                <div style="font-size:0.82em; color:#444; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml((qBody || '(mensaje no disponible)').substring(0, 100))}</div>
            </div>`;
        }
        const body = (msg.body || '').trim();
        const textHtml = body ? `<div class="msg-text">${linkify(body)}</div>` : '';
        // 🆕 v2026-08: botones de plantilla (Pagar en efectivo, Necesito ayuda…) — se ven como en WhatsApp,
        // debajo del texto, separados por una línea. Los URL son clicables; los demás solo informan.
        let botonesHtml = '';
        if (Array.isArray(msg.botones) && msg.botones.length) {
            botonesHtml = `<div class="msg-tpl-botones" style="margin-top:5px; border-top:1px solid rgba(0,0,0,0.08);">` + msg.botones.map(b => {
                const t = (b.type || '').toUpperCase();
                const ic = t === 'URL' ? 'fa-up-right-from-square' : t === 'PHONE_NUMBER' ? 'fa-phone' : 'fa-reply';
                const label = escapeHtml(b.text || '');
                const st = 'display:block; text-align:center; padding:9px 6px; color:#0084ff; font-weight:600; font-size:0.9em; text-decoration:none; border-top:1px solid rgba(0,0,0,0.06);';
                if (t === 'URL' && b.url) {
                    return `<a href="${escapeHtml(b.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation();" style="${st}"><i class="fas ${ic}" style="margin-right:6px;"></i>${label}</a>`;
                }
                return `<div style="${st}"><i class="fas ${ic}" style="margin-right:6px;"></i>${label}</div>`;
            }).join('') + `</div>`;
        }
        // 🆕 v2026-07-30: NO renderizar burbujas VACÍAS (mensajes entrantes sin texto, media, cita ni
        // reacción — suelen ser eventos/reacciones que llegan sin cuerpo). Antes se veían "sin nada".
        if (!textHtml && !mediaHtml && !quotedHtml && !msg.reaccion && !botonesHtml) return '';

        // Date separator?
        let separator = '';
        if (!prevMsg || new Date(msg.timestamp).toDateString() !== new Date(prevMsg.timestamp).toDateString()) {
            separator = `<div class="msg-date-separator"><span>${formatDateSeparator(msg.timestamp)}</span></div>`;
        }
        // 🆕 v2026-07: divisor "mensajes no leídos" antes del primer no leído
        if (_firstUnreadId && msg.id === _firstUnreadId) {
            separator += `<div class="msg-unread-divider" style="text-align:center; margin:8px 0;"><span style="background:#e7f3ff; color:#0066cc; font-size:0.72em; font-weight:700; padding:2px 12px; border-radius:12px;">─ mensajes no leídos ─</span></div>`;
        }

        // 🆕 v1.0.100 (2026-06-06): badge "quién atendió" debajo de mensajes salientes
        const senderBadge = buildSenderBadge(msg);
        // 🛡️ v2026-06-08: marca "(editado)" si el cliente editó el mensaje
        const editedTag = msg.editado ? `<span class="msg-edited" style="font-size:0.72em; color:#999; margin-right:4px;">(editado)</span>` : '';

        return `${separator}
            <div class="msg-row ${fromMe ? 'outgoing' : 'incoming'}">
                <div class="msg-bubble" data-msgid="${escapeHtml(msg.id)}" data-frommee="${fromMe}" data-body="${escapeHtml(body)}">
                    ${quotedHtml}
                    ${mediaHtml}
                    ${textHtml}
                    <div class="msg-time">${senderBadge}${editedTag}${time}${statusIcon(msg)}</div>
                    ${botonesHtml}
                    ${msg.reaccion ? `<div class="msg-reaccion" style="text-align:${fromMe ? 'right' : 'left'}; margin-top:1px;"><span style="display:inline-block; background:#fff; border:1px solid #e0e0e0; border-radius:12px; padding:0 6px; font-size:0.95em; box-shadow:0 1px 3px rgba(0,0,0,0.12);">${escapeHtml(msg.reaccion)}</span></div>` : ''}
                </div>
            </div>
        `;
    }

    // scrollMode: 'bottom' (carga inicial / msg nuevo), 'preserve' (prepend de viejos), 'keep' (sin tocar)
    function renderMessages(scrollMode = 'bottom') {
        const area = document.getElementById('chat-messages-area');
        if (!area) return;
        const newHash = messages.map(m => m.id + '|' + m.body + '|' + m.status + '|' + (m.ack_level ?? '') + '|' + (m.botones ? 'B' : '')).join(',');
        if (newHash === lastMessagesHash) return; // sin cambios
        lastMessagesHash = newHash;
        if (messages.length === 0) {
            area.innerHTML = `<div class="empty-state" style="padding:40px 20px;">
                <i class="fas fa-comment-dots" style="color:#888;"></i>
                <p>No hay mensajes todavía</p>
            </div>`;
            return;
        }
        // Capturar altura previa ANTES de mutar el DOM (para preservar posición)
        const prevScrollHeight = area.scrollHeight;
        const prevScrollTop = area.scrollTop;
        // Ordenar por timestamp ascendente
        const sorted = [...messages].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        const html = sorted.map((m, i) => renderMessage(m, sorted[i - 1])).join('');
        // 🆕 v2026-07-30: preservar el AUDIO que se está reproduciendo — antes, al llegar un mensaje
        // nuevo, el rebuild del DOM destruía el <audio> y cortaba la reproducción. Guardamos src+tiempo
        // y lo reanudamos tras el re-render.
        let _audioPlaying = null;
        try {
            for (const au of area.querySelectorAll('audio')) {
                if (!au.paused && !au.ended && au.currentTime > 0) { _audioPlaying = { src: au.getAttribute('src'), time: au.currentTime, rate: au.playbackRate }; break; }
            }
        } catch {}
        area.innerHTML = html;
        if (_audioPlaying) {
            try {
                for (const au of area.querySelectorAll('audio')) {
                    if (au.getAttribute('src') === _audioPlaying.src) {
                        au.currentTime = _audioPlaying.time || 0;
                        au.playbackRate = _audioPlaying.rate || 1;
                        au.play().catch(() => {});
                        break;
                    }
                }
            } catch {}
        }
        // Setup long-press
        area.querySelectorAll('.msg-bubble').forEach(bubble => {
            attachLongPress(bubble);
        });
        // Manejo de scroll según el modo
        if (scrollMode === 'preserve') {
            // Mantener al usuario en la misma posición visual tras prepend de viejos
            area.scrollTop = area.scrollHeight - prevScrollHeight + prevScrollTop;
        } else if (scrollMode === 'bottom') {
            area.scrollTop = area.scrollHeight;
        }
        // 'keep' → no tocamos scrollTop
    }

    function attachLongPress(el) {
        let pressTimer;
        let movedDuringPress = false;
        const start = (e) => {
            movedDuringPress = false;
            pressTimer = setTimeout(() => {
                if (!movedDuringPress) {
                    e.preventDefault?.();
                    showContextMenu(el, e);
                }
            }, 450);
        };
        const cancel = () => clearTimeout(pressTimer);
        const move = () => { movedDuringPress = true; cancel(); };
        el.addEventListener('touchstart', start, { passive: true });
        el.addEventListener('touchend', cancel);
        el.addEventListener('touchcancel', cancel);
        el.addEventListener('touchmove', move, { passive: true });
        el.addEventListener('mousedown', start);
        el.addEventListener('mouseup', cancel);
        el.addEventListener('mouseleave', cancel);
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); showContextMenu(el, e); });
    }

    function showContextMenu(bubble, evt) {
        closeAllPopups();
        const msgId = bubble.dataset.msgid;
        const body = bubble.dataset.body || '';
        const fromMe = bubble.dataset.frommee === 'true';
        bubble.classList.add('selected');

        const menu = document.createElement('div');
        menu.className = 'msg-ctx-menu';
        const items = [
            { action: 'reply', icon: 'reply', label: 'Responder' },
            { action: 'react', icon: 'smile', label: 'Reaccionar' },
            { action: 'forward', icon: 'share', label: 'Reenviar' },
            { action: 'copy', icon: 'copy', label: 'Copiar' },
            { action: 'info', icon: 'info-circle', label: 'Info' },
        ];
        if (fromMe) items.push({ action: 'delete-everyone', icon: 'trash', label: 'Eliminar para todos', danger: true });
        items.push({ action: 'delete-me', icon: 'eraser', label: 'Eliminar para mí', danger: true });

        menu.innerHTML = items.map(it => `
            <div class="msg-ctx-item ${it.danger ? 'danger' : ''}" data-action="${it.action}">
                <i class="fas fa-${it.icon}"></i> ${it.label}
            </div>
        `).join('');

        const backdrop = document.createElement('div');
        backdrop.className = 'ctx-backdrop';
        backdrop.addEventListener('click', closeAllPopups);
        document.body.appendChild(backdrop);
        document.body.appendChild(menu);

        // Posicionar el menú
        const x = Math.min(evt.clientX || (evt.touches?.[0]?.clientX) || 100, window.innerWidth - 200);
        const y = Math.min((evt.clientY || (evt.touches?.[0]?.clientY) || 100), window.innerHeight - 320);
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';

        menu.querySelectorAll('.msg-ctx-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                closeAllPopups();
                handleAction(action, msgId, body, fromMe, bubble);
            });
        });
    }

    function closeAllPopups() {
        document.querySelectorAll('.msg-bubble.selected').forEach(b => b.classList.remove('selected'));
        document.querySelectorAll('.msg-ctx-menu, .ctx-backdrop, .emoji-picker').forEach(e => e.remove());
    }

    function handleAction(action, msgId, body, fromMe, bubble) {
        if (action === 'reply') {
            replyingTo = { id: msgId, body, fromMe };
            updateReplyBanner();
            document.getElementById('chat-input-text').focus();
        } else if (action === 'react') {
            showEmojiPicker(msgId, bubble);
        } else if (action === 'forward') {
            openForwardModal(msgId);
        } else if (action === 'copy') {
            navigator.clipboard.writeText(body || '').then(() => showToast('Copiado'));
        } else if (action === 'info') {
            showMessageInfo(msgId);
        } else if (action === 'delete-everyone') {
            confirmDialog('¿Eliminar para todos?', 'No se puede deshacer.', () => deleteMessage(msgId, true, bubble));
        } else if (action === 'delete-me') {
            confirmDialog('¿Eliminar solo para ti?', 'Solo se borra de tu lado.', () => deleteMessage(msgId, false, bubble));
        }
    }

    function showEmojiPicker(msgId, bubble) {
        const picker = document.createElement('div');
        picker.className = 'emoji-picker';
        picker.innerHTML = ['👍','❤️','😂','😮','😢','🙏','✖️'].map(e =>
            `<span data-emoji="${e === '✖️' ? '' : e}">${e}</span>`
        ).join('');
        const backdrop = document.createElement('div');
        backdrop.className = 'ctx-backdrop';
        backdrop.addEventListener('click', closeAllPopups);
        document.body.appendChild(backdrop);
        document.body.appendChild(picker);

        const rect = bubble.getBoundingClientRect();
        picker.style.left = Math.max(10, rect.left) + 'px';
        picker.style.top = Math.max(10, rect.top - 60) + 'px';

        picker.querySelectorAll('span[data-emoji]').forEach(sp => {
            sp.addEventListener('click', async () => {
                const emoji = sp.dataset.emoji;
                closeAllPopups();
                try {
                    await API.post(`/api/messages/${encodeURIComponent(msgId)}/react`, { emoji });
                    showToast(emoji ? `Reaccionaste con ${emoji}` : 'Reacción quitada');
                } catch (err) { showToast('Error al reaccionar', 'error'); }
            });
        });
    }

    // 🆕 Modal de info del mensaje (datos del backend + locales)
    async function showMessageInfo(msgId) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:80vh;">
                <div class="modal-header">
                    <h3><i class="fas fa-info-circle"></i> Información del mensaje</h3>
                    <button class="icon-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body" id="msg-info-body" style="padding:18px;">
                    <div class="loading-center"><i class="fas fa-spinner fa-spin"></i></div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        try {
            const data = await API.get(`/api/messages/${encodeURIComponent(msgId)}/info`);
            const body = document.getElementById('msg-info-body');
            if (!body) return;
            if (data?.success) {
                const fecha = new Date(data.timestamp).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'medium' });
                body.innerHTML = `
                    <div style="padding:10px 0; border-bottom:1px solid #eee;">
                        <div style="font-size:0.78em; color:#999; text-transform:uppercase;">Estado</div>
                        <div style="font-size:0.95em; font-weight:600; color:#0066cc; margin-top:2px;">
                            <i class="fas fa-${data.fromMe ? 'paper-plane' : 'inbox'}"></i> ${escapeHtml(data.statusText || 'Desconocido')}
                        </div>
                    </div>
                    <div style="padding:10px 0; border-bottom:1px solid #eee;">
                        <div style="font-size:0.78em; color:#999; text-transform:uppercase;">Fecha y hora</div>
                        <div style="font-size:0.9em; margin-top:2px;">${escapeHtml(fecha)}</div>
                    </div>
                    <div style="padding:10px 0; border-bottom:1px solid #eee;">
                        <div style="font-size:0.78em; color:#999; text-transform:uppercase;">Tipo</div>
                        <div style="font-size:0.9em; margin-top:2px; text-transform:capitalize;">${escapeHtml(data.type || 'texto')}</div>
                    </div>
                    ${data.mediaFilename ? `
                        <div style="padding:10px 0; border-bottom:1px solid #eee;">
                            <div style="font-size:0.78em; color:#999; text-transform:uppercase;">Archivo</div>
                            <div style="font-size:0.9em; margin-top:2px; word-break:break-all;">${escapeHtml(data.mediaFilename)}</div>
                        </div>
                    ` : ''}
                    <div style="padding:10px 0;">
                        <div style="font-size:0.78em; color:#999; text-transform:uppercase;">ID</div>
                        <div style="font-size:0.72em; color:#999; font-family:monospace; word-break:break-all; margin-top:2px;">${escapeHtml(data.id)}</div>
                    </div>
                `;
            } else {
                body.innerHTML = `<div class="empty-state"><p>No se pudo cargar la información del mensaje</p></div>`;
            }
        } catch (err) {
            const body = document.getElementById('msg-info-body');
            if (body) body.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
        }
    }

    // 🆕 Mini-modal de confirmación (reemplaza confirm() nativo que cuelga en algunos Android WebView)
    function confirmDialog(titulo, mensaje, onConfirm) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px;';
        overlay.innerHTML = `
            <div style="background:white; border-radius:14px; max-width:340px; width:100%; padding:20px; box-shadow:0 12px 32px rgba(0,0,0,0.3);">
                <div style="font-weight:700; font-size:1.05em; color:#dc3545; margin-bottom:6px;">${titulo}</div>
                <div style="font-size:0.9em; color:#555; margin-bottom:18px;">${mensaje}</div>
                <div style="display:flex; gap:8px; justify-content:flex-end;">
                    <button class="dlg-cancel" style="background:#e5e7eb; color:#374151; border:none; padding:10px 18px; border-radius:8px; font-weight:600; cursor:pointer;">Cancelar</button>
                    <button class="dlg-ok" style="background:#dc3545; color:white; border:none; padding:10px 18px; border-radius:8px; font-weight:600; cursor:pointer;">Eliminar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.dlg-cancel').onclick = () => overlay.remove();
        overlay.querySelector('.dlg-ok').onclick = () => { overlay.remove(); try { onConfirm(); } catch (e) { console.error(e); } };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    async function deleteMessage(msgId, everyone, bubble) {
        if (!msgId) { showToast('msgId vacío', 'error'); return; }
        // Bloquear si el msgId es temp (mensaje optimistic aún no confirmado por WhatsApp)
        if (String(msgId).startsWith('temp-')) {
            showToast('Aún no podés eliminar este mensaje (esperá 1-2 segundos)', 'error');
            return;
        }
        showToast('Eliminando…');
        try {
            console.log('[deleteMessage] →', msgId, 'everyone:', everyone);
            const data = await API.del(`/api/messages/${encodeURIComponent(msgId)}?everyone=${everyone}`, { timeout: 12000 });
            console.log('[deleteMessage] respuesta:', data);
            if (data?.success) {
                // ☁️ v2026-07-30: en Cloud API "eliminar para todos" NO existe (Meta no lo permite) →
                // el server responde soloLocal:true. Ser honesto: se oculta en el panel, no en el cliente.
                showToast(data.soloLocal ? '🚫 Ocultado en tu panel (la API oficial de WhatsApp no lo borra del celular del cliente)' : (everyone ? 'Eliminado para todos ✓' : 'Eliminado para ti ✓'), data.soloLocal ? 'info' : 'success');
                bubble.style.opacity = '0.3';
                // Forzar refresh de mensajes para reflejar el cambio (muestra "🚫 Mensaje eliminado")
                setTimeout(() => refresh(), 800);
            } else {
                showToast(data?.message || 'No se pudo eliminar', 'error');
            }
        } catch (err) {
            console.error('[deleteMessage] error:', err);
            showToast('Error: ' + (err.message || 'red'), 'error');
        }
    }

    function openForwardModal(msgId) {
        // Cargar lista de chats activa
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-share"></i> Reenviar a…</h3>
                    <button class="icon-btn" id="forward-close"><i class="fas fa-times"></i></button>
                </div>
                <div style="padding: 10px 16px;">
                    <input type="text" id="forward-search" placeholder="Buscar chat…" style="width:100%; padding:8px 12px; border:1px solid var(--border); border-radius:8px; font-size:0.92em;">
                </div>
                <div class="modal-body" id="forward-list">
                    <div class="loading-center"><i class="fas fa-spinner fa-spin"></i></div>
                </div>
                <div class="modal-footer">
                    <span id="forward-count" style="flex:1; align-self:center; font-size:0.85em; color:var(--text-secondary);">0 chats</span>
                    <button class="btn-secondary" id="forward-cancel">Cancelar</button>
                    <button class="btn-primary" id="forward-send" disabled>
                        <i class="fas fa-paper-plane"></i> Reenviar
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const selected = new Set();
        const updateBtn = () => {
            const cnt = selected.size;
            document.getElementById('forward-count').textContent = `${cnt} chat${cnt !== 1 ? 's' : ''}`;
            document.getElementById('forward-send').disabled = cnt === 0;
        };
        const close = () => overlay.remove();
        overlay.querySelector('#forward-close').addEventListener('click', close);
        overlay.querySelector('#forward-cancel').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        // Cargar chats
        API.get('/api/chats').then(data => {
            const list = (data?.chats || []).filter(c => c.id !== currentChatId);
            const renderList = (filter = '') => {
                const q = filter.toLowerCase();
                const filtered = filter ? list.filter(c =>
                    (c.name || '').toLowerCase().includes(q) || (c.id || '').toLowerCase().includes(q)
                ) : list;
                const container = document.getElementById('forward-list');
                if (!container) return;
                container.innerHTML = filtered.slice(0, 80).map(c => {
                    const num = (c.id || '').replace('@c.us', '').replace('@lid', '');
                    const isSel = selected.has(c.id) ? 'checked' : '';
                    return `
                        <label class="forward-chat-item">
                            <input type="checkbox" data-id="${c.id}" ${isSel}>
                            <div class="forward-chat-item-info">
                                <div class="forward-chat-item-name">${escapeHtml(c.name || '+' + num)}</div>
                                <div class="forward-chat-item-num">${num}</div>
                            </div>
                        </label>
                    `;
                }).join('');
                container.querySelectorAll('input[type=checkbox]').forEach(cb => {
                    cb.addEventListener('change', () => {
                        const id = cb.dataset.id;
                        if (cb.checked) selected.add(id); else selected.delete(id);
                        updateBtn();
                    });
                });
            };
            renderList();
            overlay.querySelector('#forward-search').addEventListener('input', (e) => renderList(e.target.value.trim()));
        });

        overlay.querySelector('#forward-send').addEventListener('click', async () => {
            const ids = Array.from(selected);
            if (!ids.length) return;
            try {
                const data = await API.post(`/api/messages/${encodeURIComponent(msgId)}/forward`, { targetChatIds: ids });
                if (data?.success) {
                    const ok = (data.resultados || []).filter(x => x.success).length;
                    showToast(`Reenviado a ${ok} chats`);
                    close();
                } else { showToast(data?.message || 'No se pudo reenviar', 'error'); }
            } catch (e) { showToast('Error de red', 'error'); }
        });
    }

    function updateReplyBanner() {
        const banner = document.getElementById('reply-preview');
        if (replyingTo) {
            const text = (replyingTo.body || '').substring(0, 80);
            banner.style.display = 'flex';
            banner.querySelector('.reply-preview-text').innerHTML = `
                <b>${replyingTo.fromMe ? 'Tú' : 'Cliente'}</b>
                <span>${escapeHtml(text)}</span>
            `;
        } else {
            banner.style.display = 'none';
        }
    }

    function cancelReply() {
        replyingTo = null;
        updateReplyBanner();
    }

    // ══════════════════════════════════════════════════════════════════
    // 🆕 v2026-10-25 BANDEJA DE SALIDA DURABLE (tipo WhatsApp): un mensaje con mala señal NO se pierde —
    // queda "esperando señal" (reloj ⏱️) y se reenvía SOLO al reconectar. localStorage, sobrevive recargas.
    // Dedup: anti-duplicados 15s del backend + al llegar la confirmación (socket) se saca de la bandeja.
    // ══════════════════════════════════════════════════════════════════
    const PwaOutbox = {
        KEY: 'pwa_outbox_v1',
        _load() { try { return JSON.parse(localStorage.getItem(this.KEY) || '{}'); } catch { return {}; } },
        _save(o) { try { localStorage.setItem(this.KEY, JSON.stringify(o)); } catch {} },
        add(chatId, e) { const o = this._load(); (o[chatId] = o[chatId] || []).push(e); this._save(o); },
        setStatus(chatId, tempId, status) { const o = this._load(); const a = o[chatId]; if (a) { const x = a.find(y => y.tempId === tempId); if (x) { x.status = status; this._save(o); } } },
        remove(chatId, tempId) { const o = this._load(); if (o[chatId]) { o[chatId] = o[chatId].filter(y => y.tempId !== tempId); if (!o[chatId].length) delete o[chatId]; this._save(o); } },
        confirmByBody(chatId, body, ts) { const o = this._load(); if (o[chatId]) { o[chatId] = o[chatId].filter(y => !(y.body === body && Math.abs((y.ts || 0) - (ts || 0)) < 60000)); if (!o[chatId].length) delete o[chatId]; this._save(o); } },
        all() { const o = this._load(); const r = []; for (const c in o) for (const e of (o[c] || [])) r.push(Object.assign({ chatId: c }, e)); return r; }
    };
    let _pwaFlushing = false;
    async function _redeliverFromOutbox(it) {
        try {
            let resp;
            if (it.quoted_msg_id) resp = await API.post(`/api/chats/${encodeURIComponent(it.chatId)}/reply`, { quotedMessageId: it.quoted_msg_id, message: it.body });
            else resp = await API.post('/api/send-message', { chatId: it.chatId, message: it.body, skipDelay: true });
            if (resp?.messageId) {
                PwaOutbox.remove(it.chatId, it.tempId);
                if (it.chatId === currentChatId) { const m = messages.find(x => x.id === it.tempId); if (m) { m.id = resp.messageId; m.status = 'sent'; lastMessagesHash = ''; renderMessages('keep'); } }
            }
        } catch (err) {
            if (err && err.status === 423) PwaOutbox.remove(it.chatId, it.tempId);
            else if (err && typeof err.status === 'number') PwaOutbox.setStatus(it.chatId, it.tempId, 'failed');
            // falta de señal → queda 'pending', reintenta en el próximo tick
        }
    }
    async function flushPwaOutbox() {
        if (_pwaFlushing || !navigator.onLine) return;
        _pwaFlushing = true;
        try {
            for (const it of PwaOutbox.all()) {
                if (it.status === 'failed') continue; // rechazos del server → reenvío manual
                await _redeliverFromOutbox(it);
                await new Promise(r => setTimeout(r, 350));
            }
        } finally { _pwaFlushing = false; }
    }
    try { window.addEventListener('online', () => { setTimeout(flushPwaOutbox, 800); }); } catch {}

    async function sendMessage() {
        const input = document.getElementById('chat-input-text');
        const text = input.value.trim();
        if (!text) return;
        const sendBtn = document.getElementById('chat-send-btn');
        sendBtn.disabled = true;

        // UI optimistic: agregar mensaje al render inmediato
        const tempId = 'temp-' + Date.now();
        const optimisticMsg = {
            id: tempId,
            body: text,
            fromMe: true,
            timestamp: Date.now(),
            status: 'sending',
            type: 'text'
        };
        // 🆕 Si es un reply (con quote), incluir los datos del mensaje citado para que se vea la cita
        if (replyingTo) {
            optimisticMsg.quoted_msg_id = replyingTo.id;
            optimisticMsg.quoted_msg_body = replyingTo.body || '';
            optimisticMsg.quoted_from_me = !!replyingTo.fromMe;
        }
        messages.push(optimisticMsg);
        input.value = '';
        input.style.height = 'auto';
        if (replyingTo) cancelReply();
        renderMessages();

        // 🆕 v2026-10-25 Bandeja durable: persistir ANTES de enviar (si falla por señal, no se pierde).
        PwaOutbox.add(currentChatId, { tempId, body: text, quoted_msg_id: optimisticMsg.quoted_msg_id || null, ts: optimisticMsg.timestamp, status: 'pending' });

        const ok = await _deliverMessage(optimisticMsg);
        if (!ok) showToast('No se pudo enviar — tocá el mensaje para reenviar', 'error');
        sendBtn.disabled = false;
    }

    // 🆕 v2026-07: entrega un mensaje optimista ya presente en `messages`. Reemplaza su
    // tempId por el id real si el server confirma, o lo marca 'failed'. Detecta reply por
    // la presencia de quoted_msg_id. Devuelve true/false. Usado por sendMessage y retryMessage.
    async function _deliverMessage(msg) {
        const _tempId = msg.id; // id temporal (clave en la bandeja durable)
        try {
            let resp;
            if (msg.quoted_msg_id) {
                resp = await API.post(`/api/chats/${encodeURIComponent(currentChatId)}/reply`, {
                    quotedMessageId: msg.quoted_msg_id,
                    message: msg.body
                });
            } else {
                resp = await API.post('/api/send-message', {
                    chatId: currentChatId,
                    message: msg.body,
                    skipDelay: true
                });
            }
            if (resp?.messageId) {
                msg.id = resp.messageId;
                msg.status = 'sent';
                try { PwaOutbox.remove(currentChatId, _tempId); } catch {}
                lastMessagesHash = ''; renderMessages('keep');
            }
            // 🆕 v2026-08: al RESPONDER se borra el número de pendientes (no al abrir). Local
            // instantáneo + persistir en el servidor. Así el badge = "me falta contestar".
            try { ChatsPage.marcarLeidoLocal(currentChatId); } catch {}
            try { API.post(`/api/chats/${encodeURIComponent(currentChatId)}/mark-read`, {}).catch(() => {}); } catch {}
            return true;
        } catch (err) {
            console.error(err);
            // 🔒 v2026-07-30: candado — otro asesor tomó el chat (HTTP 423). Quitar el optimista y bloquear.
            if (err && err.status === 423) {
                const idx = messages.findIndex(m => m.id === msg.id);
                if (idx >= 0) messages.splice(idx, 1);
                try { PwaOutbox.remove(currentChatId, _tempId); } catch {}
                lastMessagesHash = ''; renderMessages('keep');
                showToast((err.message || '').replace(/^HTTP 423:\s*/, '') || 'Otro asesor está atendiendo este chat', 'error');
                try { aplicarCandado(); } catch {}
                return false;
            }
            // 🆕 v2026-10-25: RECHAZO del server (tiene err.status) → falló (⚠️ tocar para reenviar);
            // FALTA DE SEÑAL (timeout/red, sin status) → "esperando señal" (reloj) y se reenvía solo al reconectar.
            if (err && typeof err.status === 'number') {
                msg.status = 'failed';
                try { PwaOutbox.setStatus(currentChatId, _tempId, 'failed'); } catch {}
            } else {
                msg.status = 'sending';
                try { PwaOutbox.setStatus(currentChatId, _tempId, 'pending'); } catch {}
            }
            lastMessagesHash = ''; renderMessages('keep');
            return false;
        }
    }

    // 🆕 v2026-07: reintentar un mensaje que quedó 'failed' (tap en el ícono ⚠️).
    async function retryMessage(id) {
        const msg = messages.find(m => String(m.id) === String(id));
        if (!msg || msg.status !== 'failed') return;
        msg.status = 'sending'; // reloj (esperando) mientras reintenta
        try { PwaOutbox.setStatus(currentChatId, msg.id, 'pending'); } catch {}
        lastMessagesHash = ''; renderMessages('keep');
        const ok = await _deliverMessage(msg);
        if (!ok) showToast('Sigue sin enviarse. Revisá la conexión.', 'error');
    }

    // 🆕 v1.0.137 (2026-06-15): Cache local de mensajes (sensación WhatsApp nativa)
    // Guarda los últimos 50 msgs de cada chat en localStorage. Al abrir un chat,
    // pinta INSTANTÁNEAMENTE del cache y EN PARALELO refresca desde el servidor.
    // Si llegaron mensajes nuevos → mergea y re-renderiza. Si no → vista estable.
    // Si el cache falla por cualquier motivo → fallback al flujo original.
    const _CACHE_KEY_PREFIX = 'chat-cache-v1:';
    const _CACHE_MAX_CHATS  = 100;           // cuántos chats máximo guardar localmente
    const _CACHE_MAX_MSGS   = 50;            // mensajes por chat

    function _cacheGet(chatId) {
        try {
            const raw = localStorage.getItem(_CACHE_KEY_PREFIX + chatId);
            if (!raw) return null;
            const data = JSON.parse(raw);
            // accesar índice para LRU
            try { localStorage.setItem(_CACHE_KEY_PREFIX + chatId, raw); } catch {}
            return Array.isArray(data?.messages) ? data : null;
        } catch { return null; }
    }
    function _cacheSet(chatId, msgs) {
        try {
            const payload = JSON.stringify({ messages: msgs.slice(-_CACHE_MAX_MSGS), ts: Date.now() });
            try {
                localStorage.setItem(_CACHE_KEY_PREFIX + chatId, payload);
            } catch (e) {
                // QuotaExceeded → limpiar los más viejos y reintentar
                _cachePurge(_CACHE_MAX_CHATS / 2);
                try { localStorage.setItem(_CACHE_KEY_PREFIX + chatId, payload); } catch {}
            }
        } catch {}
    }
    function _cachePurge(keepN) {
        try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(_CACHE_KEY_PREFIX)) keys.push(k);
            }
            if (keys.length <= keepN) return;
            // sort por ts ascendente (más viejos primero)
            keys.sort((a, b) => {
                try { return (JSON.parse(localStorage.getItem(a) || '{}').ts || 0) - (JSON.parse(localStorage.getItem(b) || '{}').ts || 0); }
                catch { return 0; }
            });
            for (let i = 0; i < keys.length - keepN; i++) {
                try { localStorage.removeItem(keys[i]); } catch {}
            }
        } catch {}
    }
    function _mapMsg(m) {
        return {
            id: m.id || m.mensaje_id,
            body: m.body || m.contenido_texto || '',
            fromMe: !!(m.fromMe || m.from_me),
            timestamp: typeof m.timestamp === 'number' ? (m.timestamp > 1e12 ? m.timestamp : m.timestamp * 1000) : new Date(m.timestamp).getTime(),
            type: m.type || m.tipo_mensaje || 'text',
            mediaUrl: m.mediaUrl || m.media_url,
            filename: m.filename || m.media_filename,
            hasMedia: m.hasMedia || !!(m.mediaUrl || m.media_url),
            status: m.status || (m.fromMe || m.from_me ? 'sent' : 'received'),
            quoted_msg_id: m.quoted_msg_id || m.quotedMsg?.id || null,
            quoted_msg_body: m.quoted_msg_body || m.quotedMsg?.body,
            quoted_from_me: m.quoted_from_me || m.quotedMsg?.fromMe,
            senderTipo: m.senderTipo || m.sender_tipo || null,
            senderNombre: m.senderNombre || m.sender_nombre || null,
            editado: !!(m.editado || m.edited),
            fechaEdicion: m.fechaEdicion || m.fecha_edicion || null,
            ack_level: m.ack_level,
            reaccion: m.reaccion || null, // 🆕 v2026-07: emoji de reacción sobre este mensaje
            botones: Array.isArray(m.botones) && m.botones.length ? m.botones : null, // 🆕 v2026-08: botones de plantilla
        };
    }

    // 🆕 v2026-08-27: precarga el cache de UN chat sin necesidad de tenerlo abierto — la llama
    // el listener de push notifications apenas llega un aviso, así el chat queda listo (offline
    // incluido) para cuando el asesor realmente lo abra, en vez de esperar a esa apertura.
    async function precargarChat(chatId) {
        if (!chatId) return;
        try {
            const data = await API.get(`/api/chats/${encodeURIComponent(chatId)}/messages?limit=${PAGE_SIZE}&offset=0`);
            const list = data?.messages || data?.data || (Array.isArray(data) ? data : []);
            if (list.length) _cacheSet(chatId, list.map(_mapMsg));
        } catch (e) { console.warn('[precargarChat] falló (sin red probablemente):', e.message); }
    }

    async function loadMessages() {
        if (!currentChatId) return;
        isLoading = true;
        messagesOffset = 0;
        hasMoreMessages = true;
        const chatIdSnapshot = currentChatId;

        // 🆕 PASO 1: pintar del cache INSTANTÁNEAMENTE si existe
        let _renderedFromCache = false;
        try {
            const cached = _cacheGet(chatIdSnapshot);
            if (cached?.messages?.length) {
                messages = cached.messages.map(_mapMsg);
                messagesOffset = messages.length;
                renderMessages();
                _renderedFromCache = true;
            }
        } catch (e) { /* ignorar errores de cache, sigue al fetch */ }

        // 🆕 PASO 2: refrescar desde el servidor en paralelo (fuente de verdad)
        try {
            const data = await API.get(`/api/chats/${encodeURIComponent(chatIdSnapshot)}/messages?limit=${PAGE_SIZE}&offset=0`);
            if (currentChatId !== chatIdSnapshot) {
                console.warn(`[loadMessages] Chat cambió durante la carga inicial — descartando`);
                return;
            }
            const list = data?.messages || data?.data || (Array.isArray(data) ? data : []);
            hasMoreMessages = data?.hasMore !== undefined ? data.hasMore : (list.length >= PAGE_SIZE);
            messagesOffset = list.length;
            const fresh = list.map(_mapMsg);

            // Comparar hash rápido para evitar re-render innecesario si nada cambió
            const oldHash = messages.map(m => m.id + (m.botones ? 'B' : '')).join('|');
            const newHash = fresh.map(m => m.id + (m.botones ? 'B' : '')).join('|');
            messages = fresh;
            // 🆕 v2026-07: jump-a-no-leídos — id del 1er no leído (los últimos `unread` entrantes)
            _firstUnreadId = null;
            const _unread = currentChat?.unreadCount || 0;
            if (_unread > 0) {
                let _c = 0;
                for (let i = messages.length - 1; i >= 0; i--) {
                    if (!messages[i].fromMe) { _c++; if (_c === _unread) { _firstUnreadId = messages[i].id; break; } }
                }
            }
            if (!_renderedFromCache || oldHash !== newHash) {
                renderMessages();
            }
            if (_firstUnreadId) _showUnreadJump(_unread);
            // Guardar en cache para próxima apertura instantánea
            try { _cacheSet(chatIdSnapshot, fresh); } catch {}
        } catch (err) {
            console.error('[chat-detail] Error:', err);
            // Si ya pintamos del cache, NO mostrar toast (el user ya ve algo) — solo un aviso chico.
            // 🆕 v2026-08-27: sin conexión Y sin nada en cache (chat nunca abierto antes) → mensaje
            // claro en vez de dejar la pantalla en blanco/girando para siempre.
            if (!_renderedFromCache) {
                const area = document.getElementById('chat-messages-area');
                if (area) area.innerHTML = `<div class="empty-state" style="padding:40px 20px;">
                    <i class="fas fa-exclamation-triangle" style="color:#f59e0b;"></i>
                    <p>Sin conexión. No hay mensajes guardados de este chat todavía.</p>
                </div>`;
                showToast('Sin conexión — no se pudo cargar', 'error');
            } else {
                showToast('Sin conexión — viendo lo último guardado', 'error');
            }
        } finally {
            isLoading = false;
        }
    }

    function showToast(msg, type = 'info') {
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        toast.className = 'toast ' + type + ' show';
        toast.textContent = msg;
        setTimeout(() => toast.classList.remove('show'), 2200);
    }

    // 🆕 v2026-07: "escribiendo…" del cliente. El backend solo avisa isTyping:true; auto-limpiamos.
    let _typingTimer = null;
    let _statusOriginal = null;
    function onTyping(data) {
        if (!data || data.chatId !== currentChatId) return;
        const el = document.querySelector('.chat-detail-status');
        if (!el) return;
        if (!_typingTimer) _statusOriginal = el.textContent; // guardar el status real solo la 1ra vez
        el.textContent = 'escribiendo…';
        el.style.fontStyle = 'italic';
        clearTimeout(_typingTimer);
        _typingTimer = setTimeout(() => {
            const cur = document.querySelector('.chat-detail-status');
            if (cur) { cur.textContent = _statusOriginal || ''; cur.style.fontStyle = ''; }
            _typingTimer = null; _statusOriginal = null;
        }, 5000);
    }

    // 🆕 v2026-07: reacción entrante en vivo — pinta el emoji sobre el mensaje objetivo.
    function onReaction(data) {
        if (!data || !data.msgId) return;
        const m = messages.find(x => String(x.id) === String(data.msgId));
        if (m) { m.reaccion = data.emoji || null; lastMessagesHash = ''; renderMessages('keep'); }
    }

    // 🆕 v2026-07: botón flotante "N no leídos" que salta al divisor. Auto-oculta a los 8s.
    function _showUnreadJump(n) {
        document.getElementById('unread-jump-btn')?.remove();
        const btn = document.createElement('button');
        btn.id = 'unread-jump-btn';
        btn.style.cssText = 'position:fixed; right:14px; bottom:150px; z-index:9995; background:var(--primary,#0066cc); color:#fff; border:none; border-radius:18px; padding:7px 14px; font-size:0.8em; font-weight:700; box-shadow:0 2px 10px rgba(0,0,0,0.25); cursor:pointer;';
        btn.innerHTML = `<i class="fas fa-arrow-down"></i> ${n} no leído${n > 1 ? 's' : ''}`;
        btn.onclick = () => {
            document.querySelector('.msg-unread-divider')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            btn.remove();
        };
        document.body.appendChild(btn);
        setTimeout(() => btn.remove(), 8000);
    }

    function show(params) {
        const chatId = decodeURIComponent(params[0] || '');
        if (!chatId) {
            Router.navigate('chats');
            return;
        }
        currentChatId = chatId;
        document.body.classList.add('in-chat-detail');
        document.documentElement.classList.add('in-chat-detail');

        // 🛡️ v2026-06-13: al abrir un chat, limpiar todas las notificaciones del Android
        // que correspondan a este chatId. Antes quedaban fijas en la barra aunque el
        // asesor ya hubiese atendido al cliente.
        try {
            const PN = window.Capacitor?.Plugins?.PushNotifications;
            if (PN?.getDeliveredNotifications) {
                PN.getDeliveredNotifications().then(({ notifications }) => {
                    const norm = (s) => String(s || '').replace(/@(c\.us|s\.whatsapp\.net|lid)$/, '').replace(/^\+/, '');
                    const target = norm(chatId);
                    const toRemove = (notifications || []).filter(n => {
                        const ncid = n.data?.chatId || n.extra?.chatId;
                        return ncid && norm(ncid) === target;
                    });
                    if (toRemove.length) {
                        PN.removeDeliveredNotifications({ notifications: toRemove }).catch(() => {});
                        console.log(`🧹 [PUSH] Limpiadas ${toRemove.length} notifs del chat ${target}`);
                    }
                }).catch(() => {});
            }
        } catch {}

        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const page = document.getElementById('page-chat');
        page.classList.add('active');

        // 🆕 Ajustar altura del chat al viewport visible (clave para teclado en Android)
        // Usar visualViewport API si está disponible — se reduce cuando el teclado aparece
        installViewportSync();

        // 🆕 v2026-08 (pedido del usuario): abrir/ver el chat YA NO borra el número de pendientes.
        // El badge de no-leídos se mantiene como "me falta contestar este" y solo desaparece cuando
        // el asesor RESPONDE (ver marcarLeido en _deliverMessage). Antes se borraba al abrir (jul-31).

        // Encontrar info del chat en la cache de chatsPage
        const allChats = ChatsPage._cache || [];
        currentChat = allChats.find(c => c.id === chatId) || { id: chatId, name: chatId };
        const num = (chatId || '').replace('@c.us', '').replace('@lid', '');
        // 🆕 v2026-10-25: usuario de WhatsApp sin número (id "CO.<dígitos>") → no mostrar "+CO.xxx".
        const _esUsuarioWA = !/^\+?\d{7,15}$/.test(num);
        const _nombreOK = currentChat?.name && !currentChat.name.startsWith('+') && !/^CO\.\d+$/i.test(currentChat.name);
        const name = _nombreOK ? currentChat.name : (_esUsuarioWA ? '👤 Usuario de WhatsApp' : '+' + num);

        page.innerHTML = `
            <div class="chat-detail-header">
                <button class="chat-back-btn" onclick="ChatDetailPage.back()">
                    <i class="fas fa-arrow-left"></i>
                </button>
                <div class="chat-detail-info" onclick="ChatDetailPage.showContactInfo()">
                    <div class="chat-detail-avatar">${(name || '?').charAt(0).toUpperCase()}</div>
                    <div class="chat-detail-text">
                        <div class="chat-detail-name">+${num}</div>
                        <div class="chat-detail-status">${escapeHtml(name && name !== '+' + num ? name : 'Sin nombre')}</div>
                        <div class="chat-detail-ips" id="chat-detail-ips" style="font-size:0.75em; color:rgba(255,255,255,0.85); margin-top:2px;"></div>
                    </div>
                </div>
                <div class="chat-detail-actions">
                    <button class="chat-take-btn" id="chat-take-btn" onclick="ChatDetailPage.toggleTomarChat(event)" title="Tomar el chat"
                            style="display:flex; align-items:center; gap:5px; height:36px; padding:0 12px; border:none; border-radius:18px; background:rgba(255,255,255,0.18); color:#fff; font-weight:700; font-size:0.82em; cursor:pointer; white-space:nowrap; flex-shrink:0;">
                        <i class="fas fa-hand-paper" id="chat-take-icon"></i><span id="chat-take-label">Tomar</span>
                    </button>
                    <button class="icon-btn" onclick="ChatDetailPage.toggleSearch()" title="Buscar en chat">
                        <i class="fas fa-search"></i>
                    </button>
                    <button class="icon-btn" onclick="ChatDetailPage.showHeaderMenu(event)" title="Más opciones">
                        <i class="fas fa-ellipsis-vertical"></i>
                    </button>
                </div>
            </div>
            <div id="chat-search-bar" style="display:none; background:white; padding:8px 12px; border-bottom:1px solid var(--border);">
                <div style="display:flex; align-items:center; gap:8px;">
                    <div class="search-bar" style="margin:0; flex:1;">
                        <i class="fas fa-search search-icon"></i>
                        <input type="text" id="chat-search-input" placeholder="Buscar en este chat...">
                    </div>
                    <span id="chat-search-counter" style="font-size:0.8em; color:#667781; min-width:44px; text-align:center; white-space:nowrap;"></span>
                    <button class="icon-btn" id="chat-search-prev" onclick="ChatDetailPage.searchPrev()" title="Anterior (más antiguo)" style="width:32px; height:32px;"><i class="fas fa-chevron-up"></i></button>
                    <button class="icon-btn" id="chat-search-next" onclick="ChatDetailPage.searchNext()" title="Siguiente (más reciente)" style="width:32px; height:32px;"><i class="fas fa-chevron-down"></i></button>
                    <button class="icon-btn" onclick="ChatDetailPage.toggleSearch()" title="Cerrar búsqueda" style="width:32px; height:32px;"><i class="fas fa-times"></i></button>
                </div>
            </div>
            <div class="chat-messages-area" id="chat-messages-area" style="flex:1; min-height:0; overflow-y:auto;">
                <div class="loading-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>
            </div>
            <div class="chat-input-bar">
                <div class="reply-preview" id="reply-preview" style="display:none;">
                    <div class="reply-preview-text"></div>
                    <button class="reply-preview-close" onclick="ChatDetailPage.cancelReply()"><i class="fas fa-times"></i></button>
                </div>
                <input type="file" id="chat-file-input" style="display:none;" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip">
                <input type="file" id="chat-camera-input" style="display:none;" accept="image/*" capture="environment">
                <div class="input-container">
                    <button class="icon-btn" title="Adjuntar" onclick="ChatDetailPage.toggleAttach(event)">
                        <i class="fas fa-paperclip"></i>
                    </button>
                    <button class="icon-btn" title="Emoji" onclick="ChatDetailPage.toggleEmoji(event)">
                        <i class="far fa-smile"></i>
                    </button>
                    <textarea class="chat-textarea" id="chat-input-text" placeholder="Mensaje" rows="1"
                              spellcheck="true" autocorrect="on" autocapitalize="sentences" autocomplete="on" lang="es" inputmode="text"></textarea>
                    <div class="recording-bar" id="recording-bar">
                        <div class="rec-dot"></div>
                        <div class="rec-time" id="rec-time">0:00</div>
                        <div class="rec-slide-hint" id="rec-slide-hint">
                            <i class="fas fa-chevron-left"></i>
                            <span>Desliza para cancelar</span>
                        </div>
                        <button class="recording-cancel-btn" onclick="ChatDetailPage.cancelRecording()">Cancelar</button>
                    </div>
                    <button class="icon-btn" id="chat-templates-btn" title="Plantillas" onclick="ChatDetailPage.openTemplates()">
                        <i class="fas fa-bolt" style="color:#f59e0b;"></i>
                    </button>
                    <button class="send-btn" id="chat-send-btn"
                            onmousedown="ChatDetailPage.onMicPress(event)"
                            ontouchstart="ChatDetailPage.onMicPress(event)"
                            onmouseup="ChatDetailPage.onMicRelease(event)"
                            ontouchend="ChatDetailPage.onMicRelease(event)"
                            ontouchcancel="ChatDetailPage.onMicRelease(event)"
                            onclick="ChatDetailPage.onSendOrMicTap(event)">
                        <i class="fas fa-microphone" id="chat-send-icon"></i>
                    </button>
                </div>
                <div class="input-bloqueada" id="input-bloqueada" style="display:none; padding:12px 14px; text-align:center; background:#fff7ed; border-top:1px solid #fed7aa;">
                    <div id="bloqueada-desbloquear">
                        <div style="font-size:0.8em; color:#9a3412; margin-bottom:9px; line-height:1.35;">🔒 Pasaron más de 24h desde el último mensaje del cliente. WhatsApp no permite escribir libre — mandá un saludo para reabrir la conversación.</div>
                        <button onclick="ChatDetailPage.desbloquearChat()" style="background:#16a34a; color:#fff; border:none; border-radius:22px; padding:10px 24px; font-weight:700; font-size:0.92em; cursor:pointer;">🔓 Desbloquear chat</button>
                    </div>
                    <div id="bloqueada-esperando" style="display:none; font-size:0.82em; color:#9a3412; line-height:1.4;">⏳ Ya le enviaste una plantilla — esperando que el cliente responda. Cuando conteste, el chat se habilita solo.</div>
                </div>
                <div id="input-candado" style="display:none; padding:12px 14px; text-align:center; background:#fef2f2; border-top:1px solid #fecaca;">
                    <div style="font-size:0.82em; color:#991b1b; margin-bottom:9px; line-height:1.35;">🔒 Este chat lo está atendiendo <b id="candado-asesor">otro asesor</b>. Para escribir, tomalo vos.</div>
                    <button onclick="ChatDetailPage.tomarChat()" style="background:#0066cc; color:#fff; border:none; border-radius:22px; padding:9px 22px; font-weight:700; font-size:0.9em; cursor:pointer;">✋ Tomar el chat</button>
                </div>
            </div>
        `;

        // Auto-resize textarea + cambiar mic <→ send según haya texto
        const ta = document.getElementById('chat-input-text');
        const updateSendIcon = () => {
            const icon = document.getElementById('chat-send-icon');
            if (!icon) return;
            const hasText = ta.value.trim().length > 0;
            icon.className = hasText ? 'fas fa-paper-plane' : 'fas fa-microphone';
        };
        ta.addEventListener('input', () => {
            ta.style.height = 'auto';
            ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
            updateSendIcon();
        });
        updateSendIcon();
        // Enter para enviar (sin shift)
        ta.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !window.matchMedia('(max-width: 768px)').matches) {
                e.preventDefault();
                sendMessage();
            }
        });
        // 🆕 En móvil NO abrir teclado automático al entrar al chat — causaba que el viewport
        // quedara comprimido (la app se veía "machucada"). El usuario toca el textarea cuando quiera escribir.
        const isMobileViewport = window.matchMedia('(max-width: 768px)').matches;
        if (!isMobileViewport) {
            ta.focus();
        } else {
            // Asegurar que NO hay focus residual de otra pantalla (resetea el viewport)
            try { document.activeElement?.blur(); } catch {}
        }
        replyingTo = null;
        lastMessagesHash = '';
        // 🛡️ Reset del estado global al abrir un chat nuevo: no arrastrar mensajes/nombre del anterior
        // (evita que un evento de socket o un poll en vuelo pinte datos del chat viejo en el nuevo).
        messages = [];
        hasMoreMessages = true;
        messagesOffset = 0;
        _firstUnreadId = null;
        clienteNombreActual = '';
        clienteCedulaActual = ''; clienteIdActual = null; clienteBdActual = null; // 🆕 no arrastrar cliente anterior

        // 🆕 Scroll infinito: cargar más al subir cerca del top
        const area = document.getElementById('chat-messages-area');
        if (area) {
            area.addEventListener('scroll', () => {
                if (area.scrollTop < 100 && hasMoreMessages && !isLoadingMore) {
                    loadMoreMessages();
                }
            });
        }
        loadMessages();
        aplicarVentana24h();   // 🔒 chequear ventana 24h → habilitar/deshabilitar barra
        aplicarCandado();      // 🔒 candado de atención: si otro asesor lo tomó, bloquear la barra
        startPoll();
        try { flushPwaOutbox(); } catch {} // 🆕 v2026-10-25: al abrir, reenviar lo que quedó esperando señal
        pintarClienteInfoDesdeCache(); // 🆕 v2026-08: muestra lo último conocido AL INSTANTE
        loadClienteIPs();
        startIPPoll();
    }

    // 🆕 Cargar IPs del cliente y mostrar como hipervínculos en el header
    let ipPollId = null;
    let clienteNombreActual = '';   // 🔧 nombre del cliente identificado (para "Crear visita")
    let clienteCedulaActual = '';   // 🆕 2026-11: cédula del cliente del chat (para iniciar monitoreo 24h)
    let clienteIdActual = null;     // 🆕 2026-11: idcliente MikroWisp (para link "Ver en MikroWisp")
    let clienteBdActual = null;     // 🆕 2026-11: en qué MikroWisp (.50/.11/.2) está el cliente

    // 🆕 v2026-08: caché PERSISTENTE del cliente (nombre + IPs) por número, en localStorage.
    // Objetivo: que el nombre/IP aparezca AL INSTANTE al abrir el chat (con lo último conocido),
    // sin depender de que MikroWisp responda rápido esta vez. Antes el header arrancaba vacío y
    // "muchas veces no aparecía" cuando la 1ª consulta tardaba o venía vacía.
    const _CLI_INFO_KEY = 'cli_info_cache_v1';
    function _cliInfoCacheGet(numero) {
        try { const m = JSON.parse(localStorage.getItem(_CLI_INFO_KEY) || '{}'); return m[numero] || null; } catch { return null; }
    }
    function _cliInfoCacheSet(numero, info) {
        try {
            const m = JSON.parse(localStorage.getItem(_CLI_INFO_KEY) || '{}');
            m[numero] = { ...info, ts: Date.now() };
            // poda: conservar los 300 más recientes
            const keys = Object.keys(m);
            if (keys.length > 300) {
                keys.sort((a, b) => (m[a].ts || 0) - (m[b].ts || 0)).slice(0, keys.length - 300).forEach(k => delete m[k]);
            }
            localStorage.setItem(_CLI_INFO_KEY, JSON.stringify(m));
        } catch {}
    }
    function _pintarClienteInfo(nombreCli, ips) {
        const el = document.getElementById('chat-detail-ips');
        if (!el) return;
        if (!nombreCli && (!ips || !ips.length)) return;
        el.style.display = '';
        const nombreHtml = nombreCli ? `<div style="color:white; font-weight:600; font-size:0.92em; margin-bottom:2px;">${escapeHtml(nombreCli)}</div>` : '';
        el.innerHTML = nombreHtml + (ips || []).map(o => {
            const isOnline = (o.status || '').toUpperCase() === 'ONLINE';
            const color = isOnline ? '#86efac' : '#fcd34d';
            return `<a href="http://${o.ip}" target="_blank" rel="noopener" onclick="event.stopPropagation();" style="color:white; text-decoration:underline; font-family:monospace; margin-right:8px;"><i class="fas fa-network-wired" style="color:${color}; font-size:0.9em;"></i> ${o.ip}</a>`;
        }).join('');
    }
    // Pinta al instante lo último conocido del número (desde la caché) — se llama al abrir el chat.
    function pintarClienteInfoDesdeCache() {
        const numero = (currentChatId || '').replace(/@(c\.us|s\.whatsapp\.net|lid)$/, '').replace(/^\+/, '');
        const c = _cliInfoCacheGet(numero);
        if (c) {
            if (c.nombre) clienteNombreActual = c.nombre;
            if (c.cedula) clienteCedulaActual = c.cedula;
            if (c.id != null) clienteIdActual = c.id;
            if (c.bd) clienteBdActual = c.bd;
            _pintarClienteInfo(c.nombre, c.ips);
        }
    }
    async function loadClienteIPs() {
        const el = document.getElementById('chat-detail-ips');
        if (!el || !currentChatId) return;
        // 🛡️ Guard anti-contaminación: si el usuario cambia de chat mientras MikroWisp responde,
        // descartamos (si no, pintaríamos el nombre/IPs del cliente viejo en el header del chat nuevo).
        const chatIdSnapshot = currentChatId;
        const numero = (currentChatId || '').replace(/@(c\.us|s\.whatsapp\.net|lid)$/, '').replace(/^\+/, '');
        try {
            const data = await API.get(`/api/cliente-ips/${encodeURIComponent(numero)}`);
            if (currentChatId !== chatIdSnapshot) return; // el usuario abrió otro chat: no pintar el viejo
            const ips = data?.ips || [];
            const nombreCli = data?.cliente_nombre;
            if (nombreCli) clienteNombreActual = nombreCli; // solo actualizar si vino nombre
            // 🆕 2026-11: cédula + idcliente (para monitoreo 24h y link MikroWisp)
            if (data?.cliente_cedula) clienteCedulaActual = String(data.cliente_cedula);
            if (data?.cliente_id != null) clienteIdActual = data.cliente_id;
            if (data?.bd) clienteBdActual = data.bd;
            // 🆕 v2026-07-30: si la consulta viene VACÍA (MikroWisp lento/caído), NO limpiar — mantener
            // lo último mostrado (DOM o caché). Antes borraba el nombre/IPs → parpadeo cada 30s.
            if (!ips.length && !nombreCli) return;
            _pintarClienteInfo(nombreCli, ips);
            // 🆕 v2026-08: persistir para que la próxima apertura muestre el dato al instante.
            _cliInfoCacheSet(numero, { nombre: nombreCli || (_cliInfoCacheGet(numero)?.nombre || null), ips,
                cedula: clienteCedulaActual || null, id: clienteIdActual, bd: clienteBdActual });
        } catch { /* 🆕 v2026-07-30: error de red → NO limpiar, mantener el nombre/IPs ya mostrados (evita parpadeo). */ }
    }
    function startIPPoll() {
        if (ipPollId) clearInterval(ipPollId);
        ipPollId = setInterval(loadClienteIPs, 30000); // cada 30s para mantener actualizado
    }
    function stopIPPoll() {
        if (ipPollId) { clearInterval(ipPollId); ipPollId = null; }
    }

    async function loadMoreMessages() {
        if (isLoadingMore || !hasMoreMessages || !currentChatId) return;
        isLoadingMore = true;
        // 🆕 v2026-05-25: capturar el chatId Y el offset del momento de la llamada para detectar race conditions
        // (cuando el usuario cambia de chat mientras se cargan los viejos del anterior).
        const chatIdSnapshot = currentChatId;
        const offsetSnapshot = messagesOffset;
        const area = document.getElementById('chat-messages-area');
        // Mostrar loading inline arriba
        const loadingBar = document.createElement('div');
        loadingBar.id = 'load-more-bar';
        loadingBar.style.cssText = 'text-align:center; padding:10px; color:#999; font-size:0.85em;';
        loadingBar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando mensajes anteriores…';
        if (area) area.insertBefore(loadingBar, area.firstChild);
        try {
            const data = await API.get(`/api/chats/${encodeURIComponent(chatIdSnapshot)}/messages?limit=${PAGE_SIZE}&offset=${offsetSnapshot}`);
            // 🛡️ Verificar que el chat SIGA siendo el mismo cuando llega la respuesta.
            // Si el usuario cambió de chat, descartar — los mensajes pertenecen al chat anterior.
            if (currentChatId !== chatIdSnapshot) {
                console.warn(`[loadMore] Chat cambió durante la carga (${chatIdSnapshot} → ${currentChatId}), descartando ${(data?.messages || []).length} mensajes para evitar mezcla`);
                return;
            }
            const list = data?.messages || (Array.isArray(data) ? data : []);
            hasMoreMessages = data?.hasMore !== undefined ? data.hasMore : (list.length >= PAGE_SIZE);
            // Mapear y prepender (los nuevos van al inicio, son anteriores)
            const olderMessages = list.map(m => ({
                id: m.id || m.mensaje_id,
                body: m.body || m.contenido_texto || '',
                fromMe: !!(m.fromMe || m.from_me),
                timestamp: typeof m.timestamp === 'number' ? (m.timestamp > 1e12 ? m.timestamp : m.timestamp * 1000) : new Date(m.timestamp).getTime(),
                type: m.type || m.tipo_mensaje || 'text',
                mediaUrl: m.mediaUrl || m.media_url,
                filename: m.filename || m.media_filename,
                hasMedia: m.hasMedia || !!(m.mediaUrl || m.media_url),
                status: m.status || (m.fromMe || m.from_me ? 'sent' : 'received'),
                quoted_msg_id: m.quoted_msg_id || m.quotedMsg?.id || null,
                quoted_msg_body: m.quoted_msg_body || m.quotedMsg?.body,
                quoted_from_me: m.quoted_from_me || m.quotedMsg?.fromMe,
                // 🆕 v1.0.100: propagar sender info
                senderTipo: m.senderTipo || m.sender_tipo || null,
                senderNombre: m.senderNombre || m.sender_nombre || null,
                editado: !!(m.editado || m.edited),
                fechaEdicion: m.fechaEdicion || m.fecha_edicion || null,
                ack_level: m.ack_level,
            }));
            // Dedup: solo agregar mensajes que NO existan ya
            const existingIds = new Set(messages.map(m => m.id));
            const nuevos = olderMessages.filter(m => !existingIds.has(m.id));
            // 🔧 Avance del offset: usar el TOTAL recibido (no solo los nuevos), así no quedamos atascados
            // si hay duplicados intermedios — la próxima iteración apunta al siguiente bloque correctamente.
            messagesOffset = offsetSnapshot + list.length;
            if (nuevos.length === 0 && list.length < PAGE_SIZE) {
                // Realmente no hay más (server devolvió menos del page size)
                hasMoreMessages = false;
            } else if (nuevos.length > 0) {
                messages = nuevos.concat(messages);
                lastMessagesHash = '';
                renderMessages('preserve'); // ← preserva posición visual del usuario
            }
            // Si list.length === PAGE_SIZE pero todos eran duplicados, NO marcar hasMoreMessages=false;
            // la siguiente iteración continuará desde messagesOffset actualizado.
        } catch (err) {
            console.error('[loadMore] Error:', err);
        } finally {
            const bar = document.getElementById('load-more-bar');
            if (bar) bar.remove();
            // Si ya no hay más, mostrar marca de fin
            if (!hasMoreMessages && area && !document.getElementById('history-end-bar')) {
                const endBar = document.createElement('div');
                endBar.id = 'history-end-bar';
                endBar.style.cssText = 'text-align:center; padding:14px 10px; color:#999; font-size:0.78em; border-bottom:1px solid #eee;';
                endBar.innerHTML = '<i class="fas fa-flag-checkered"></i> Inicio del historial';
                area.insertBefore(endBar, area.firstChild);
            }
            isLoadingMore = false;
        }
    }

    function back() {
        stopPoll();
        stopIPPoll();
        document.body.classList.remove('in-chat-detail');
        document.documentElement.classList.remove('in-chat-detail');
        uninstallViewportSync();
        Router.navigate('chats');
    }

    // 🆕 Sincroniza altura del chat con el viewport visible (clave para teclado en Android)
    // 🛡️ v2026-08-27 (reporte real: "minimizo la app con el teclado abierto y al volver queda
    // el espacio del teclado aunque ya no está"): Android cierra el teclado solo al mandar la app
    // a segundo plano, pero el WebView NO siempre dispara `visualViewport.resize` en ese momento
    // (o lo dispara antes de que `page-chat` vuelva a estar `.active`) — el `page.style.height`
    // quedaba pegado al alto chico de cuando el teclado SÍ estaba abierto. Fix: además de los
    // resize/scroll de siempre, reaplicar `apply()` cuando la app vuelve a primer plano
    // (visibilitychange Y el evento nativo `resume` de Capacitor — cualquiera que dispare primero),
    // con un par de reintentos cortos porque el WebView a veces reporta un alto viejo/transicional
    // en el primer tick tras volver.
    let _viewportListener = null;
    let _viewportResumeHandlers = null;
    function installViewportSync() {
        if (_viewportListener) return; // ya instalado
        const apply = () => {
            const page = document.getElementById('page-chat');
            if (!page || !page.classList.contains('active')) return;
            const h = (window.visualViewport?.height) || window.innerHeight;
            page.style.height = h + 'px';
            // Mantener scroll de mensajes al fondo si el usuario estaba cerca
            const area = document.getElementById('chat-messages-area');
            if (area) {
                const nearBottom = (area.scrollHeight - area.scrollTop - area.clientHeight) < 200;
                if (nearBottom) area.scrollTop = area.scrollHeight;
            }
        };
        const onResume = () => { apply(); setTimeout(apply, 150); setTimeout(apply, 500); };
        _viewportListener = apply;
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', apply);
            window.visualViewport.addEventListener('scroll', apply);
        }
        window.addEventListener('resize', apply);
        const onVisibility = () => { if (!document.hidden) onResume(); };
        document.addEventListener('visibilitychange', onVisibility);
        let capacitorSub = null;
        try {
            window.Capacitor?.Plugins?.App?.addListener('resume', onResume).then(sub => { capacitorSub = sub; });
        } catch (_) {}
        _viewportResumeHandlers = { onVisibility, capacitorSubRef: () => capacitorSub };
        // Aplicar inicialmente
        setTimeout(apply, 50);
    }
    function uninstallViewportSync() {
        if (!_viewportListener) return;
        if (window.visualViewport) {
            window.visualViewport.removeEventListener('resize', _viewportListener);
            window.visualViewport.removeEventListener('scroll', _viewportListener);
        }
        window.removeEventListener('resize', _viewportListener);
        _viewportListener = null;
        if (_viewportResumeHandlers) {
            document.removeEventListener('visibilitychange', _viewportResumeHandlers.onVisibility);
            try { _viewportResumeHandlers.capacitorSubRef()?.remove(); } catch (_) {}
            _viewportResumeHandlers = null;
        }
        // Limpiar el estilo inline
        const page = document.getElementById('page-chat');
        if (page) page.style.height = '';
    }

    function refresh() { lastMessagesHash = ''; loadMessages(); }

    // 🔒 v2026-07-30: ventana de 24h. Si el cliente no escribe hace +24h (cloud), WhatsApp no deja
    // texto libre → deshabilitamos la barra y mostramos "Desbloquear chat" (manda plantilla saludo).
    async function aplicarVentana24h() {
        try {
            if (!currentChatId) return;
            const r = await API.get(`/api/chats/${encodeURIComponent(currentChatId)}/ventana`);
            const cerrada = r && r.cloud && r.abierta === false;
            const cont = document.querySelector('.input-container');
            const bloq = document.getElementById('input-bloqueada');
            const bDes = document.getElementById('bloqueada-desbloquear');
            const bEsp = document.getElementById('bloqueada-esperando');
            if (cerrada) {
                if (cont) cont.style.display = 'none';
                if (bloq) bloq.style.display = 'block';
                // 🆕 v2026-07-30: si ya se le mandó plantilla y esperamos respuesta → NO ofrecer desbloquear otra vez.
                const esperando = !!(r && r.yaEnviamos);
                if (bDes) bDes.style.display = esperando ? 'none' : 'block';
                if (bEsp) bEsp.style.display = esperando ? 'block' : 'none';
            } else { if (cont) cont.style.display = ''; if (bloq) bloq.style.display = 'none'; }
        } catch (e) { /* fail-open: dejar la barra habilitada */ }
    }

    // 🔒 v2026-07-30: CANDADO de atención. Si otro asesor tomó el chat → no se puede escribir hasta tomarlo.
    let _asignadoAMi = false;
    async function aplicarCandado() {
        if (!currentChatId) return;
        const cont = document.querySelector('.input-container');
        const candado = document.getElementById('input-candado');
        try {
            const yo = (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser() : null;
            const miId = yo && (yo.id ?? yo.usuario_id ?? yo.user_id);
            const r = await API.get('/api/chats/asignaciones');
            let a = null;
            if (r && r.asignaciones) {
                const nuc = String(currentChatId).replace(/\D/g, '').slice(-10);
                for (const [k, v] of Object.entries(r.asignaciones)) { if (String(k).replace(/\D/g, '').slice(-10) === nuc) { a = v; break; } }
            }
            const tomadoPorOtro = !!(a && a.asesor_id && String(a.asesor_id) !== String(miId));
            _asignadoAMi = !!(a && a.asesor_id && String(a.asesor_id) === String(miId));
            if (tomadoPorOtro) {
                if (cont) cont.style.display = 'none';
                if (candado) { candado.style.display = 'block'; const el = document.getElementById('candado-asesor'); if (el) el.textContent = a.asesor_nombre || 'otro asesor'; }
            } else {
                if (candado) candado.style.display = 'none';
                const bloq = document.getElementById('input-bloqueada');
                if (cont && (!bloq || bloq.style.display === 'none')) cont.style.display = '';
            }
            actualizarBotonTomar();
        } catch (e) { /* fail-open */ }
    }
    // 🆕 v2026-08-16 (pedido usuario): botón Tomar/Soltar en la barra superior, junto a Buscar.
    // Refleja _asignadoAMi: si YO tomé el chat → "Soltar" (verde); si no → "Tomar".
    function actualizarBotonTomar() {
        const btn = document.getElementById('chat-take-btn');
        if (!btn) return;
        const icon = document.getElementById('chat-take-icon');
        const label = document.getElementById('chat-take-label');
        if (_asignadoAMi) {
            btn.title = 'Soltar el chat (vuelve al bot)';
            if (icon) icon.className = 'fas fa-lock-open';
            if (label) label.textContent = 'Soltar';
            btn.style.background = '#16a34a';
        } else {
            btn.title = 'Tomar el chat';
            if (icon) icon.className = 'fas fa-hand-paper';
            if (label) label.textContent = 'Tomar';
            btn.style.background = 'rgba(255,255,255,0.18)';
        }
    }
    function toggleTomarChat(evt) {
        try { evt?.stopPropagation?.(); } catch {}
        if (_asignadoAMi) liberarChatAsig();
        else tomarChat();
    }
    async function tomarChat() {
        try { await API.post(`/api/chats/${encodeURIComponent(currentChatId)}/asignar`, {}); showToast('✅ Tomaste el chat', 'success'); await aplicarCandado(); try { ChatsPage.refresh?.(); } catch {} }
        catch (e) { showToast('No se pudo tomar', 'error'); }
    }
    async function liberarChatAsig() {
        // Soltar = liberar la asignación + devolver al bot (Sol vuelve a responder). Fusiona el
        // viejo "Soltar (volver al bot)". No manda despedida.
        try {
            await API.del(`/api/chats/${encodeURIComponent(currentChatId)}/asignar`);
            try { await API.post(`/api/chats/${encodeURIComponent(currentChatId)}/mark-finished`, {}); } catch {}
            showToast('🤖 Chat soltado — vuelve al bot', 'success');
            _asignadoAMi = false; await aplicarCandado();
            try { ChatsPage.refresh?.(); } catch {}
            refresh();
        } catch (e) { showToast('No se pudo soltar', 'error'); }
    }

    async function desbloquearChat() {
        try {
            showToast('Enviando saludo…');
            const r = await API.post(`/api/chats/${encodeURIComponent(currentChatId)}/desbloquear`, {});
            if (r && r.ok) { showToast('✅ Saludo enviado. Cuando el cliente responda ya podés escribir libre.', 'success'); setTimeout(() => { aplicarVentana24h(); refresh(); }, 900); }
            else showToast(r?.message || 'No se pudo desbloquear', 'error');
        } catch (e) { showToast('Error: ' + (e.message || 'red'), 'error'); }
    }

    // 📷 v2026-07-30: galería de fotos del cliente (de sus visitas técnicas).
    async function verFotosCliente() {
        const numero = (currentChatId || '').replace(/@(c\.us|s\.whatsapp\.net|lid)$/, '').replace(/^\+/, '').replace(/\D/g, '');
        showToast('Cargando fotos…');
        try {
            const r = await API.get(`/api/cliente-fotos/${encodeURIComponent(numero)}`);
            const fotos = (r && r.fotos) || [];
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.innerHTML = `
                <div class="modal-content" style="max-height:92vh;">
                    <div class="modal-header"><h3><i class="fas fa-images"></i> Fotos del cliente (${fotos.length})</h3>
                        <button class="icon-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button></div>
                    <div class="modal-body" style="padding:12px; overflow-y:auto;">
                        ${fotos.length ? `<div style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px;">${fotos.map(f => `
                            <a href="${f.ruta_archivo}" target="_blank" rel="noopener" style="display:block;" title="${escapeHtml((f.motivo_visita || '') + ' · ' + (f.fecha || ''))}"><img src="${f.ruta_archivo}" loading="lazy" style="width:100%; height:100px; object-fit:cover; border-radius:8px; background:#eee;"></a>`).join('')}</div>`
                            : '<div style="text-align:center; color:#888; padding:34px;">Este cliente no tiene fotos de visitas registradas.</div>'}
                    </div>
                </div>`;
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
            document.body.appendChild(overlay);
        } catch (e) { showToast('No se pudieron cargar las fotos', 'error'); }
    }

    // 🆕 v2026-08-28: "Multimedia del chat" — galería de lo que se intercambió EN ESTA
    // conversación (fotos/videos/documentos), igual que "Multimedia, enlaces y documentos" de
    // WhatsApp real. Distinto de "Fotos del cliente" (esas son fotos de VISITAS técnicas).
    async function verMultimediaChat() {
        const chatId = currentChatId;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-height:92vh;">
                <div class="modal-header"><h3><i class="fas fa-photo-video"></i> Multimedia del chat</h3>
                    <button class="icon-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button></div>
                <div class="media-gallery-tabs">
                    <button class="media-gallery-tab active" data-tipo="image">Fotos</button>
                    <button class="media-gallery-tab" data-tipo="video">Videos</button>
                    <button class="media-gallery-tab" data-tipo="document">Documentos</button>
                </div>
                <div class="modal-body" id="media-gallery-body" style="padding:12px; overflow-y:auto;">
                    <div class="loading-center"><i class="fas fa-spinner fa-spin"></i></div>
                </div>
            </div>`;
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);

        const cargarTipo = async (tipo) => {
            const body = overlay.querySelector('#media-gallery-body');
            body.innerHTML = '<div class="loading-center"><i class="fas fa-spinner fa-spin"></i></div>';
            try {
                const r = await API.get(`/api/chats/${encodeURIComponent(chatId)}/media?tipo=${tipo}`);
                const items = (r && r.items) || [];
                if (!items.length) {
                    body.innerHTML = '<div style="text-align:center; color:#888; padding:34px;">Sin elementos de este tipo en el chat.</div>';
                    return;
                }
                if (tipo === 'document') {
                    body.innerHTML = items.map(it => {
                        const url = resolveMediaUrl(it.mediaUrl);
                        const fname = it.filename || 'documento';
                        const fecha = new Date(it.timestamp).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
                        return `<div class="msg-file" style="margin-bottom:8px; cursor:pointer;" onclick="ChatDetailPage.abrirVisorDocumento('${escapeHtml(url)}','${escapeHtml(fname)}')">
                            <i class="fas fa-file-pdf"></i>
                            <div style="overflow:hidden;">
                                <div style="font-weight:600; font-size:0.9em;">${escapeHtml(fname)}</div>
                                <div style="font-size:0.75em; color:#999;">${fecha}</div>
                            </div>
                        </div>`;
                    }).join('');
                } else {
                    body.innerHTML = `<div class="media-gallery-grid">${items.map(it => {
                        const url = resolveMediaUrl(it.mediaUrl);
                        if (tipo === 'video') {
                            return `<div class="media-gallery-thumb" onclick="ChatDetailPage.openVideoFull('${escapeHtml(url)}')">
                                <video src="${escapeHtml(url)}" preload="metadata" muted></video>
                                <i class="fas fa-play media-gallery-play"></i>
                            </div>`;
                        }
                        return `<div class="media-gallery-thumb" onclick="ChatDetailPage.openLightbox('${escapeHtml(url)}')">
                            <img src="${escapeHtml(url)}" loading="lazy">
                        </div>`;
                    }).join('')}</div>`;
                }
            } catch (e) { body.innerHTML = '<div style="text-align:center; color:#e03131; padding:34px;">Error cargando multimedia.</div>'; }
        };
        overlay.querySelectorAll('.media-gallery-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                overlay.querySelectorAll('.media-gallery-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                cargarTipo(btn.dataset.tipo);
            });
        });
        cargarTipo('image');
    }

    function openTemplates() {
        // Cargar plantillas y mostrar modal de selección
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-bolt"></i> Plantillas</h3>
                    <button class="icon-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body" id="templates-list">
                    <div class="loading-center"><i class="fas fa-spinner fa-spin"></i></div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        API.get('/api/plantillas').then(data => {
            const plantillas = data?.plantillas || [];
            const container = document.getElementById('templates-list');
            if (!container) return;
            if (!plantillas.length) {
                container.innerHTML = `<div class="empty-state" style="padding:30px;"><i class="fas fa-bolt"></i><p>No hay plantillas. Creá una desde el panel web por ahora.</p></div>`;
                return;
            }
            container.innerHTML = plantillas.map(p => {
                const preview = (p.mensaje || '').substring(0, 60);
                const archivos = (p.archivos || []).length;
                return `
                    <div class="forward-chat-item" style="border:none; border-bottom:1px solid var(--border);" data-id="${p.id}">
                        <div class="forward-chat-item-info">
                            <div class="forward-chat-item-name">${escapeHtml(p.nombre)}</div>
                            ${preview ? `<div class="forward-chat-item-num">${escapeHtml(preview)}${p.mensaje.length > 60 ? '…' : ''}</div>` : ''}
                            ${archivos ? `<div class="forward-chat-item-num" style="color:#f59e0b;"><i class="fas fa-paperclip"></i> ${archivos} archivo(s)</div>` : ''}
                        </div>
                        <i class="fas fa-paper-plane" style="color:var(--primary);"></i>
                    </div>
                `;
            }).join('');
            container.querySelectorAll('[data-id]').forEach(el => {
                el.addEventListener('click', async () => {
                    const id = el.dataset.id;
                    overlay.remove();
                    try {
                        await API.post(`/api/plantillas/${id}/send`, { chatId: currentChatId });
                        showToast('Plantilla enviada');
                        setTimeout(() => refresh(), 1500);
                    } catch (e) { showToast('Error enviando plantilla', 'error'); }
                });
            });
        });
    }

    // ─────────── Búsqueda DENTRO del chat, estilo WhatsApp ───────────
    // 🆕 v2026-09: en vez de reemplazar la conversación por una lista, mantiene el chat visible,
    // resalta el término y navega ↑/↓ entre coincidencias (contador n/total). Busca en TODO el
    // historial vía servidor (con fallback local sobre lo ya cargado).
    let _searchTimer = null;
    let _searchMatches = [];   // ids de mensajes que coinciden, en orden cronológico (viejo→nuevo)
    let _searchIndex = -1;     // índice de la coincidencia actual
    let _searchTerm = '';

    function toggleSearch() {
        const bar = document.getElementById('chat-search-bar');
        if (!bar) return;
        if (bar.style.display === 'none') {
            bar.style.display = 'block';
            const input = document.getElementById('chat-search-input');
            input.value = '';
            input.removeEventListener('input', filterMessages);
            input.addEventListener('input', filterMessages);
            input.removeEventListener('keydown', _searchKeydown);
            input.addEventListener('keydown', _searchKeydown);
            input.focus();
        } else {
            bar.style.display = 'none';
            _clearSearchHighlights();
            _searchMatches = []; _searchIndex = -1; _searchTerm = '';
            _updateSearchCounter();
        }
    }

    // Enter = coincidencia anterior (más antigua), como WhatsApp; Shift+Enter = siguiente.
    function _searchKeydown(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (e.shiftKey) searchNext(); else searchPrev();
    }

    function filterMessages() {
        clearTimeout(_searchTimer);
        const q = (document.getElementById('chat-search-input')?.value || '').trim();
        _searchTerm = q;
        if (!q) { _searchMatches = []; _searchIndex = -1; _clearSearchHighlights(); _updateSearchCounter(); return; }
        // Feedback inmediato: coincidencias sobre lo ya cargado mientras llega el servidor.
        _setMatches(_matchIdsLocal(q));
        if (q.length < 2) return; // el endpoint requiere >= 2 caracteres
        _searchTimer = setTimeout(() => _runInChatSearch(q), 300);
    }

    function _matchIdsLocal(q) {
        const ql = q.toLowerCase();
        return messages
            .filter(m => (m.body || '').toLowerCase().includes(ql))
            .sort((a, b) => (new Date(a.timestamp).getTime() || 0) - (new Date(b.timestamp).getTime() || 0))
            .map(m => String(m.id));
    }

    async function _runInChatSearch(q) {
        try {
            const resp = await API.get(`/api/chats/${encodeURIComponent(currentChatId)}/search?q=${encodeURIComponent(q)}&limit=200`);
            const currentQ = (document.getElementById('chat-search-input')?.value || '').trim();
            if (currentQ !== q) return; // el término cambió: ignorar esta respuesta
            if (resp?.success && Array.isArray(resp.messages)) {
                const ids = [...resp.messages]
                    .sort((a, b) => (new Date(a.timestamp).getTime() || 0) - (new Date(b.timestamp).getTime() || 0))
                    .map(m => String(m.id));
                if (ids.length) _setMatches(ids);
            }
        } catch (e) {
            console.warn('[search] servidor falló, se mantiene filtro local:', e?.message || e);
        }
    }

    function _setMatches(ids) {
        const same = ids.length === _searchMatches.length && ids.every((v, i) => v === _searchMatches[i]);
        _searchMatches = ids;
        if (!ids.length) { _searchIndex = -1; _updateSearchCounter(); _clearSearchHighlights(); return; }
        if (!same || _searchIndex < 0) {
            _searchIndex = ids.length - 1; // arrancar en la MÁS RECIENTE (como WhatsApp)
            _updateSearchCounter();
            _gotoMatch(_searchIndex);
        } else {
            _updateSearchCounter();
        }
    }

    function _updateSearchCounter() {
        const el = document.getElementById('chat-search-counter');
        if (el) el.textContent = _searchMatches.length ? `${_searchIndex + 1}/${_searchMatches.length}` : (_searchTerm ? '0' : '');
        const prev = document.getElementById('chat-search-prev');
        const next = document.getElementById('chat-search-next');
        if (prev) prev.disabled = !(_searchIndex > 0);
        if (next) next.disabled = !(_searchIndex >= 0 && _searchIndex < _searchMatches.length - 1);
    }

    function searchPrev() { if (_searchMatches.length && _searchIndex > 0) _gotoMatch(_searchIndex - 1); }             // ↑ más antiguo
    function searchNext() { if (_searchMatches.length && _searchIndex < _searchMatches.length - 1) _gotoMatch(_searchIndex + 1); } // ↓ más reciente

    async function _gotoMatch(i) {
        if (i < 0 || i >= _searchMatches.length) return;
        _searchIndex = i;
        _updateSearchCounter();
        await _scrollHighlightMatch(_searchMatches[i]);
    }

    // Trae al mensaje a la vista (cargando historial si hace falta) + lo resalta + marca el término.
    async function _scrollHighlightMatch(id) {
        const area = document.getElementById('chat-messages-area');
        if (!area || !id) return;
        const find = () => area.querySelector(`.msg-bubble[data-msgid="${CSS.escape(String(id))}"]`);
        let target = find();
        if (!target) {
            let attempts = 0;
            while (!target && hasMoreMessages && attempts < 15) {
                attempts++;
                await loadMoreMessages();
                target = find();
            }
        }
        _clearSearchHighlights();
        if (!target) { showToast('Mensaje no cargado'); return; }
        target.classList.add('search-current');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (_searchTerm) _highlightTermInBubble(target, _searchTerm);
    }

    // Marca (<span class="search-hit">) las apariciones del término dentro del texto de la burbuja.
    function _highlightTermInBubble(bubble, term) {
        const cont = bubble.querySelector('.msg-text');
        if (!cont || !term) return;
        const rx = new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        const walker = document.createTreeWalker(cont, NodeFilter.SHOW_TEXT, null);
        const nodes = [];
        let n; while ((n = walker.nextNode())) nodes.push(n);
        nodes.forEach(node => {
            const val = node.nodeValue;
            rx.lastIndex = 0;
            if (!rx.test(val)) return;
            rx.lastIndex = 0;
            const frag = document.createDocumentFragment();
            let last = 0, m;
            while ((m = rx.exec(val)) !== null) {
                if (m.index > last) frag.appendChild(document.createTextNode(val.slice(last, m.index)));
                const mark = document.createElement('span');
                mark.className = 'search-hit';
                mark.textContent = m[0];
                frag.appendChild(mark);
                last = m.index + m[0].length;
                if (m[0].length === 0) rx.lastIndex++;
            }
            if (last < val.length) frag.appendChild(document.createTextNode(val.slice(last)));
            node.parentNode.replaceChild(frag, node);
        });
    }

    function _clearSearchHighlights() {
        const area = document.getElementById('chat-messages-area');
        if (!area) return;
        area.querySelectorAll('.msg-bubble.search-current').forEach(b => b.classList.remove('search-current'));
        area.querySelectorAll('span.search-hit').forEach(s => {
            const t = document.createTextNode(s.textContent);
            s.parentNode.replaceChild(t, s);
            s.remove?.();
        });
    }

    function showHeaderMenu(evt) {
        evt.stopPropagation();
        closeAllPopups();
        const menu = document.createElement('div');
        menu.className = 'msg-ctx-menu';
        menu.innerHTML = `
            <div class="msg-ctx-item" data-action="contact"><i class="fas fa-user-circle"></i> Ver contacto</div>
            <div class="msg-ctx-item" data-action="crear-visita"><i class="fas fa-tools" style="color:#f59e0b;"></i> Crear visita técnica</div>
            <div class="msg-ctx-item" data-action="monitoreo24h"><i class="fas fa-wave-square" style="color:#10b981;"></i> Iniciar monitoreo 24h</div>
            <div class="msg-ctx-item" data-action="multimedia"><i class="fas fa-photo-video" style="color:#0ea5e9;"></i> Multimedia del chat</div>
            <div class="msg-ctx-item" data-action="fotos-cliente"><i class="fas fa-images" style="color:#8b5cf6;"></i> Fotos del cliente</div>
            <div class="msg-ctx-item" data-action="search"><i class="fas fa-search"></i> Buscar en chat</div>
            <div class="msg-ctx-item" data-action="notas"><i class="fas fa-sticky-note"></i> Notas internas</div>
            ${_asignadoAMi
                ? '<div class="msg-ctx-item" data-action="soltar-asig"><i class="fas fa-lock-open" style="color:#16a34a;"></i> Soltar chat (liberar)</div>'
                : '<div class="msg-ctx-item" data-action="tomar-asig"><i class="fas fa-hand-paper" style="color:#0066cc;"></i> Tomar chat</div>'}
            <div class="msg-ctx-item" data-action="etiquetas"><i class="fas fa-tags"></i> Etiquetas</div>
            <div class="msg-ctx-item" data-action="refresh"><i class="fas fa-sync-alt"></i> Refrescar</div>
            <div class="msg-ctx-item" data-action="mark-finished"><i class="fas fa-check-double"></i> Marcar finalizado</div>
            <div class="msg-ctx-item" data-action="toggle-mode"><i class="fas fa-exchange-alt"></i> Cambiar modo</div>
            <div class="msg-ctx-item danger" data-action="end"><i class="fas fa-times-circle"></i> Cerrar chat</div>
        `;
        const backdrop = document.createElement('div');
        backdrop.className = 'ctx-backdrop';
        backdrop.addEventListener('click', closeAllPopups);
        document.body.appendChild(backdrop);
        document.body.appendChild(menu);
        // Posicionar arriba a la derecha
        menu.style.right = '8px';
        menu.style.top = '60px';
        menu.style.left = 'auto';
        menu.querySelectorAll('.msg-ctx-item').forEach(item => {
            item.addEventListener('click', async () => {
                const action = item.dataset.action;
                closeAllPopups();
                if (action === 'contact') showContactInfo();
                else if (action === 'crear-visita') {
                    // 🔧 v2026-07-30: abrir el modal de crear visita (reusa VisitasPage) y pre-buscar
                    // al cliente identificado del chat. Si tiene 2 servicios, el modal deja elegir.
                    if (typeof VisitasPage !== 'undefined' && VisitasPage.openCrearModal) {
                        VisitasPage.openCrearModal();
                        setTimeout(() => {
                            const inp = document.getElementById('vis-buscar');
                            if (inp && clienteNombreActual) {
                                inp.value = clienteNombreActual;
                                inp.dispatchEvent(new Event('input', { bubbles: true }));
                                inp.focus();
                            }
                        }, 350);
                    } else { showToast('Módulo de visitas no disponible', 'error'); }
                }
                else if (action === 'monitoreo24h') iniciarMonitoreo24h();
                else if (action === 'multimedia') verMultimediaChat();
                else if (action === 'fotos-cliente') verFotosCliente();
                else if (action === 'search') toggleSearch();
                else if (action === 'notas') openNotas();
                else if (action === 'tomar-asig') tomarChat();
                else if (action === 'soltar-asig') liberarChatAsig();
                else if (action === 'etiquetas') openEtiquetas();
                else if (action === 'refresh') refresh();
                else if (action === 'mark-finished') {
                    if (confirm('¿Marcar este chat como finalizado?')) {
                        try {
                            await API.post(`/api/chats/${encodeURIComponent(currentChatId)}/mark-finished`, {});
                            // 🆕 v2026-06-19: reflejar el soft-finalize en la lista local AL INSTANTE
                            // (vuelve a Bot, visible) sin depender del refresco de red.
                            try { ChatsPage.applyLocalFinalize(currentChatId); } catch {}
                            showToast('Chat finalizado'); back();
                        } catch (e) { showToast('Error', 'error'); }
                    }
                }
                else if (action === 'toggle-mode') {
                    try {
                        const data = await API.post(`/api/chats/${encodeURIComponent(currentChatId)}/toggle-mode`, {});
                        showToast(`Modo: ${data?.mode || 'cambiado'}`);
                    } catch (e) { showToast('Error', 'error'); }
                }
                else if (action === 'end') {
                    if (confirm('¿Cerrar este chat? El cliente recibirá un mensaje de despedida.')) {
                        try {
                            await API.post(`/api/chats/${encodeURIComponent(currentChatId)}/end`, {});
                            // 🆕 v2026-06-19: reflejar el soft-finalize en la lista local AL INSTANTE.
                            try { ChatsPage.applyLocalFinalize(currentChatId); } catch {}
                            showToast('Chat cerrado'); back();
                        } catch (e) { showToast('Error', 'error'); }
                    }
                }
            });
        });
    }

    function showContactInfo() {
        const num = (currentChatId || '').replace('@c.us', '').replace('@lid', '');
        const name = currentChat?.name || '+' + num;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-user-circle"></i> Información del contacto</h3>
                    <button class="icon-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body" style="padding:24px; text-align:center;">
                    <div style="width:90px; height:90px; border-radius:50%; background:linear-gradient(135deg, var(--primary), var(--primary-dark)); color:white; margin:0 auto 16px; display:flex; align-items:center; justify-content:center; font-size:2.5em; font-weight:700;">
                        ${name.charAt(0).toUpperCase()}
                    </div>
                    <div style="font-size:1.2em; font-weight:600;">${escapeHtml(name)}</div>
                    <div style="font-size:0.9em; color:var(--text-secondary); margin-top:4px;">${num}</div>
                    <div style="margin-top:20px; text-align:left; font-size:0.88em;">
                        <div style="padding:10px 0; border-bottom:1px solid var(--border);">
                            <span style="color:var(--text-tertiary);">Modo:</span> <b>${currentChat?.mode === 'human' ? 'Humano (asesor)' : 'Bot (IA)'}</b>
                        </div>
                        <div style="padding:10px 0; border-bottom:1px solid var(--border);">
                            <span style="color:var(--text-tertiary);">Pendiente:</span> <b>${currentChat?.pendiente ? 'Sí' : 'No'}</b>
                        </div>
                        ${currentChat?.urgente ? `<div style="padding:10px 0; color:var(--danger);"><i class="fas fa-exclamation-triangle"></i> <b>URGENTE</b> — asesor inactivo >20 min</div>` : ''}
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    // 🆕 2026-11: inicia un monitoreo de calidad de 24h para el cliente del chat.
    // Reusa el sistema QoS (ISP Guardian › Calidad de Servicio). La duración por defecto es 24h.
    async function iniciarMonitoreo24h() {
        const ced = clienteCedulaActual;
        if (!ced) { showToast('No pude identificar la cédula del cliente de este chat.', 'error'); return; }
        if (!confirm('¿Iniciar un monitoreo de calidad de 24 horas para este cliente?\n\nQueda en ISP Guardian › Calidad de Servicio.')) return;
        try {
            const r = await API.post('/api/chat/monitoreo-24h', { cedula: ced });
            if (r?.yaActivo) showToast('El cliente ya tiene un monitoreo 24h en curso.');
            else if (r?.success) showToast('Monitoreo 24h iniciado ✅');
            else showToast(r?.message || 'No se pudo iniciar (sin IP/ONU del cliente).', 'error');
        } catch (e) {
            showToast('Error iniciando el monitoreo.', 'error');
        }
    }

    function toggleAttach(evt) {
        evt.stopPropagation();
        closeAllPopups();
        const menu = document.createElement('div');
        menu.className = 'msg-ctx-menu';
        menu.style.bottom = '70px';
        menu.style.top = 'auto';
        menu.style.left = '16px';
        menu.innerHTML = `
            <div class="msg-ctx-item" data-action="camera"><i class="fas fa-camera" style="color:#dc3545;"></i> Cámara</div>
            <div class="msg-ctx-item" data-action="gallery"><i class="fas fa-images" style="color:#bf59cf;"></i> Galería</div>
            <div class="msg-ctx-item" data-action="document"><i class="fas fa-file" style="color:#5f66cd;"></i> Documento</div>
        `;
        const backdrop = document.createElement('div');
        backdrop.className = 'ctx-backdrop';
        backdrop.addEventListener('click', closeAllPopups);
        document.body.appendChild(backdrop);
        document.body.appendChild(menu);
        menu.querySelectorAll('.msg-ctx-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                closeAllPopups();
                if (action === 'camera') document.getElementById('chat-camera-input').click();
                else if (action === 'gallery' || action === 'document') document.getElementById('chat-file-input').click();
            });
        });
    }

    function toggleEmoji(evt) {
        evt.stopPropagation();
        closeAllPopups();
        const picker = document.createElement('div');
        picker.className = 'emoji-picker';
        picker.style.bottom = '70px';
        picker.style.top = 'auto';
        picker.style.left = '16px';
        picker.style.flexWrap = 'wrap';
        picker.style.maxWidth = '300px';
        picker.style.maxHeight = '260px';
        picker.style.overflowY = 'auto';
        picker.style.padding = '12px';
        // 🆕 v2026-07: set ampliado (caras, gestos, corazones, símbolos, objetos de soporte)
        const emojis = [
            '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥳','🤩','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','😶','😐','😑','😬','🙄','😯','😲','🥱','😴','🤤','😪','🥴','🤢','🤮','🤧','😷','🤒','🤕',
            '👍','👎','👊','✊','🤛','🤜','👏','🙌','👐','🤲','🙏','🤝','💪','👋','🤚','✋','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','👈','👉','👆','👇','☝️','👀','🫡',
            '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💯','💢','💥','💫','⭐','🌟','✨','🔥','🎉','🎊','✅','❌','⚠️','❗','❓','💤','💦',
            '📱','💻','🖥️','📞','☎️','📶','🔌','🔋','🛠️','🔧','🌐','📡','📷','📎','📄','📅','💰','💵','🧾','🚀','📍','🏠'
        ];
        picker.innerHTML = emojis.map(e => `<span data-emoji="${e}">${e}</span>`).join('');
        const backdrop = document.createElement('div');
        backdrop.className = 'ctx-backdrop';
        backdrop.addEventListener('click', closeAllPopups);
        document.body.appendChild(backdrop);
        document.body.appendChild(picker);
        picker.querySelectorAll('span[data-emoji]').forEach(sp => {
            sp.addEventListener('click', () => {
                const input = document.getElementById('chat-input-text');
                input.value += sp.dataset.emoji;
                input.dispatchEvent(new Event('input'));
                input.focus();
            });
        });
    }

    // Hook para enviar archivos cuando se selecciona del file input
    document.addEventListener('change', async (e) => {
        if (e.target.id === 'chat-file-input' || e.target.id === 'chat-camera-input') {
            const files = Array.from(e.target.files || []);
            e.target.value = ''; // permitir re-seleccionar el mismo archivo después
            if (!files.length || !currentChatId) return;
            // 🆕 v2026-07: mostrar PREVIEW antes de enviar (evita mandar el adjunto equivocado).
            // Se captura el chatId ahora para que el envío siga al chat correcto aunque el
            // asesor cambie de chat mientras confirma.
            _showAttachPreview(files, currentChatId);
        }
    });

    // 🆕 v2026-07: preview de adjuntos antes de enviar.
    let _pendingAttach = null; // { files, chatId, urls }
    function _showAttachPreview(files, chatId) {
        _cancelAttachPreview(); // limpiar cualquier preview anterior
        const urls = [];
        const cards = files.map((file, i) => {
            const type = file.type || '';
            let media;
            if (type.startsWith('image/')) {
                const u = URL.createObjectURL(file); urls.push(u);
                media = `<div style="position:relative; display:inline-block;">
                    <img src="${u}" style="max-width:150px; max-height:200px; border-radius:8px; object-fit:cover;">
                    <button onclick="ChatDetailPage._editImage(${i})" title="Editar / anotar" style="position:absolute; top:5px; right:5px; background:rgba(0,0,0,0.6); color:#fff; border:none; border-radius:50%; width:30px; height:30px; cursor:pointer;"><i class="fas fa-pen"></i></button>
                </div>`;
            } else if (type.startsWith('video/')) {
                const u = URL.createObjectURL(file); urls.push(u);
                media = `<video src="${u}" style="max-width:150px; max-height:200px; border-radius:8px;" muted playsinline></video>`;
            } else {
                media = `<div style="width:120px;height:120px;display:flex;align-items:center;justify-content:center;background:#eee;border-radius:8px;"><i class="fas fa-file" style="font-size:2.4em;color:#888;"></i></div>`;
            }
            const size = file.size > 1048576 ? (file.size/1048576).toFixed(1)+' MB' : Math.max(1, Math.round(file.size/1024))+' KB';
            return `<div style="text-align:center; max-width:160px;">
                ${media}
                <div style="color:#fff; font-size:0.75em; margin-top:4px; word-break:break-word;">${escapeHtml(file.name)}</div>
                <div style="color:#bbb; font-size:0.7em;">${size}</div>
            </div>`;
        }).join('');
        _pendingAttach = { files, chatId, urls };
        const ov = document.createElement('div');
        ov.id = 'attach-preview-overlay';
        ov.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.82); z-index:99999; display:flex; flex-direction:column;';
        ov.innerHTML = `
            <div style="padding:14px 16px; color:#fff; font-weight:600; font-size:1.05em;">Enviar ${files.length} archivo${files.length>1?'s':''}</div>
            <div style="flex:1; overflow:auto; padding:12px; display:flex; flex-wrap:wrap; gap:14px; justify-content:center; align-content:flex-start;">${cards}</div>
            <div style="padding:6px 16px;">
                <input id="attach-caption-input" placeholder="Agregá un texto (opcional)…" style="width:100%; padding:10px; border:none; border-radius:8px; font-size:0.95em; box-sizing:border-box;">
            </div>
            <div style="padding:12px 16px; display:flex; gap:12px;">
                <button onclick="ChatDetailPage._cancelAttachPreview()" style="flex:1; padding:12px; border-radius:10px; border:none; background:#444; color:#fff; font-weight:600;">Cancelar</button>
                <button onclick="ChatDetailPage._confirmAttachPreview()" style="flex:2; padding:12px; border-radius:10px; border:none; background:var(--primary,#0066cc); color:#fff; font-weight:700;"><i class="fas fa-paper-plane"></i> Enviar</button>
            </div>`;
        document.body.appendChild(ov);
    }
    function _cancelAttachPreview() {
        if (_pendingAttach?.urls) _pendingAttach.urls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
        _pendingAttach = null;
        document.getElementById('attach-preview-overlay')?.remove();
    }
    function _confirmAttachPreview() {
        const pend = _pendingAttach;
        _pendingAttach = null; // evitar doble envío por doble tap
        const caption = (document.getElementById('attach-caption-input')?.value || '').trim();
        if (pend?.urls) pend.urls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
        document.getElementById('attach-preview-overlay')?.remove();
        if (pend) _uploadFiles(pend.files, pend.chatId, caption);
    }

    // 🆕 v2026-07: sube los archivos al server con XHR para mostrar PROGRESO real.
    async function _uploadFiles(files, chatIdEnvio, caption) {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                // caption solo en el 1er archivo (evita repetir el texto en cada media del lote)
                await _uploadOne(file, chatIdEnvio, i + 1, files.length, i === 0 ? caption : '');
                showToast(`✅ ${file.name} enviado`, 'success');
            } catch (err) {
                console.error('[upload]', err);
                showToast(`Error enviando ${file.name}`, 'error');
            }
        }
        _hideUploadProgress();
        // Solo refrescar si seguimos en el mismo chat
        if (currentChatId === chatIdEnvio) {
            setTimeout(() => refresh(), 1500);
        }
    }

    // Sube UN archivo vía XMLHttpRequest reportando progreso de subida. Resuelve si el
    // server responde 2xx. Nota: XHR (a diferencia de fetch+keepalive) se aborta si el
    // WebView se destruye; por eso mostramos la barra para que el asesor espere.
    function _uploadOne(file, chatIdEnvio, n, total, caption) {
        return new Promise((resolve, reject) => {
            const fd = new FormData();
            fd.append('chatId', chatIdEnvio);
            fd.append('file', file);
            if (caption) fd.append('caption', caption);
            const xhr = new XMLHttpRequest();
            xhr.open('POST', APP_CONFIG.SERVER_URL + '/api/send-file');
            xhr.setRequestHeader('Authorization', 'Bearer ' + API.getToken());
            xhr.upload.onprogress = (ev) => {
                if (ev.lengthComputable) {
                    _showUploadProgress(file.name, Math.round((ev.loaded / ev.total) * 100), n, total);
                }
            };
            xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error('HTTP ' + xhr.status));
            xhr.onerror = () => reject(new Error('network'));
            xhr.onabort = () => reject(new Error('abort'));
            _showUploadProgress(file.name, 0, n, total);
            xhr.send(fd);
        });
    }

    function _showUploadProgress(name, pct, n, total) {
        let el = document.getElementById('upload-progress-bar');
        if (!el) {
            el = document.createElement('div');
            el.id = 'upload-progress-bar';
            el.style.cssText = 'position:fixed; left:12px; right:12px; bottom:76px; background:#fff; border:1px solid var(--border,#ddd); border-radius:10px; padding:10px 12px; z-index:99998; box-shadow:0 2px 12px rgba(0,0,0,0.15);';
            document.body.appendChild(el);
        }
        const label = total > 1 ? `Enviando ${n}/${total}: ${name}` : `Enviando: ${name}`;
        el.innerHTML = `
            <div style="font-size:0.8em; color:#444; margin-bottom:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(label)} — ${pct}%</div>
            <div style="background:#eee; border-radius:6px; height:8px; overflow:hidden;">
                <div style="background:var(--primary,#0066cc); height:100%; width:${pct}%; transition:width 0.2s;"></div>
            </div>`;
    }
    function _hideUploadProgress() {
        document.getElementById('upload-progress-bar')?.remove();
    }

    // 🆕 GRABACIÓN DE AUDIO (mantener presionado el botón mic)
    let mediaRecorder = null;
    let audioChunks = [];
    let recordingStream = null;
    let recordTimerInterval = null;
    let recordStartTime = 0;
    let isRecording = false;
    let pressDetectTimer = null;
    let recordingCanceled = false;
    // 🆕 Swipe-to-cancel estilo WhatsApp
    let swipeStartX = null;
    let willCancel = false;
    const SWIPE_CANCEL_THRESHOLD = 100; // px hacia la izquierda para cancelar

    async function startRecording() {
        try {
            if (!navigator.mediaDevices?.getUserMedia) {
                showToast('Tu navegador no soporta grabación', 'error');
                return false;
            }
            recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioChunks = [];
            recordingCanceled = false;
            const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
                       : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
                       : 'audio/mp4';
            mediaRecorder = new MediaRecorder(recordingStream, { mimeType: mime });
            mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) audioChunks.push(e.data);
            };
            mediaRecorder.onstop = async () => {
                if (recordingStream) {
                    recordingStream.getTracks().forEach(t => t.stop());
                    recordingStream = null;
                }
                if (recordingCanceled) { audioChunks = []; return; }
                if (audioChunks.length === 0) return;
                const blob = new Blob(audioChunks, { type: mime });
                if (blob.size < 800) {
                    showToast('Audio muy corto', 'error');
                    return;
                }
                await uploadAudio(blob, mime);
            };
            // 🛡️ v2026-05-29 (caso +573143221036 16:53): NO usar timeslice.
            // Con start(timeslice), Chrome emite chunks sin el header EBML completo
            // → ffmpeg no puede parsear el webm → fallback envía el archivo crudo a WhatsApp
            // → cliente recibe como "documento" en vez de audio.
            // Con start() sin args, ondataavailable solo dispara al stop() con el blob completo.
            mediaRecorder.start();
            isRecording = true;
            recordStartTime = Date.now();
            updateRecordingUI(true);
            recordTimerInterval = setInterval(() => {
                const sec = Math.floor((Date.now() - recordStartTime) / 1000);
                const t = `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
                const el = document.getElementById('rec-time');
                if (el) el.textContent = t;
                if (sec > 180) stopRecording(); // límite 3 min
            }, 250);
            return true;
        } catch (err) {
            console.error('[RECORD] Error:', err);
            showToast('No se pudo acceder al micrófono', 'error');
            isRecording = false;
            return false;
        }
    }

    function stopRecording() {
        if (!isRecording) return;
        isRecording = false;
        clearInterval(recordTimerInterval);
        updateRecordingUI(false);
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try { mediaRecorder.stop(); } catch {}
        }
    }

    function cancelRecording() {
        if (!isRecording) return;
        recordingCanceled = true;
        stopRecording();
        showToast('Grabación cancelada');
    }

    function updateRecordingUI(active) {
        const bar = document.getElementById('recording-bar');
        const sendBtn = document.getElementById('chat-send-btn');
        const ta = document.getElementById('chat-input-text');
        const tplBtn = document.getElementById('chat-templates-btn');
        if (bar) bar.classList.toggle('active', active);
        if (sendBtn) sendBtn.classList.toggle('recording', active);
        if (ta) ta.style.display = active ? 'none' : '';
        if (tplBtn) tplBtn.style.display = active ? 'none' : '';
        if (active) {
            document.getElementById('rec-time').textContent = '0:00';
            // 🆕 Listeners globales para swipe-to-cancel (touch + mouse para test desktop)
            document.addEventListener('touchmove', onMicMove, { passive: true });
            document.addEventListener('mousemove', onMicMove, { passive: true });
        } else {
            document.removeEventListener('touchmove', onMicMove);
            document.removeEventListener('mousemove', onMicMove);
            // Limpieza visual final
            if (sendBtn) sendBtn.style.transform = '';
            bar?.classList.remove('sliding', 'will-cancel');
            sendBtn?.classList.remove('will-cancel');
        }
    }

    async function uploadAudio(blob, mime) {
        showToast('Enviando audio…');
        const ext = mime.includes('mp4') ? '.m4a' : '.webm';
        const fd = new FormData();
        fd.append('chatId', currentChatId);
        fd.append('file', blob, 'audio-' + Date.now() + ext);
        try {
            const r = await fetch(APP_CONFIG.SERVER_URL + '/api/send-file', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + API.getToken() },
                body: fd
            });
            if (r.ok) {
                showToast('Audio enviado');
                setTimeout(() => refresh(), 1200);
            } else {
                // 🛡️ v2026-05-29: si el server detectó audio corrupto (status 422), avisar específicamente
                try {
                    const data = await r.json();
                    if (data && data.audioInvalido) {
                        showToast(data.message || 'Audio corrupto, regrabá', 'error');
                    } else {
                        showToast(data?.message || 'Error enviando audio', 'error');
                    }
                } catch {
                    showToast('Error enviando audio', 'error');
                }
            }
        } catch (err) { showToast('Error de red', 'error'); }
    }

    // Lógica del botón mic/send unificado
    function onMicPress(e) {
        const ta = document.getElementById('chat-input-text');
        // Si hay texto, NO grabar (será tap de send)
        if (ta && ta.value.trim()) return;
        e?.preventDefault?.();
        // Guardar X inicial para swipe-to-cancel
        const touch = e.touches?.[0] || e;
        swipeStartX = (typeof touch.clientX === 'number') ? touch.clientX : null;
        willCancel = false;
        // Hold de 250ms para detectar press-and-hold
        clearTimeout(pressDetectTimer);
        pressDetectTimer = setTimeout(() => {
            startRecording();
        }, 250);
    }
    // 🆕 Movimiento del dedo durante la grabación → swipe-to-cancel
    function onMicMove(e) {
        if (!isRecording || swipeStartX == null) return;
        const touch = e.touches?.[0] || e;
        const currentX = (typeof touch.clientX === 'number') ? touch.clientX : null;
        if (currentX == null) return;
        const deltaX = currentX - swipeStartX;
        const bar = document.getElementById('recording-bar');
        const sendBtn = document.getElementById('chat-send-btn');
        if (deltaX < 0) {
            const absDelta = Math.abs(deltaX);
            const limited = Math.min(absDelta, SWIPE_CANCEL_THRESHOLD + 40);
            bar?.classList.add('sliding');
            if (sendBtn) sendBtn.style.transform = `translateX(${-limited}px)`;
            if (absDelta >= SWIPE_CANCEL_THRESHOLD) {
                willCancel = true;
                bar?.classList.add('will-cancel');
                sendBtn?.classList.add('will-cancel');
            } else {
                willCancel = false;
                bar?.classList.remove('will-cancel');
                sendBtn?.classList.remove('will-cancel');
            }
        } else {
            // Volvió a la derecha o no se movió
            bar?.classList.remove('sliding', 'will-cancel');
            sendBtn?.classList.remove('will-cancel');
            if (sendBtn) sendBtn.style.transform = '';
            willCancel = false;
        }
    }
    function onMicRelease(e) {
        clearTimeout(pressDetectTimer);
        // Limpiar visual del swipe
        const bar = document.getElementById('recording-bar');
        const sendBtn = document.getElementById('chat-send-btn');
        bar?.classList.remove('sliding', 'will-cancel');
        sendBtn?.classList.remove('will-cancel');
        if (sendBtn) sendBtn.style.transform = '';
        if (isRecording) {
            e?.preventDefault?.();
            if (willCancel) {
                cancelRecording();
            } else {
                stopRecording();
            }
        }
        swipeStartX = null;
        willCancel = false;
    }
    function onSendOrMicTap(e) {
        const ta = document.getElementById('chat-input-text');
        if (ta && ta.value.trim()) {
            // Hay texto → enviar
            sendMessage();
        } else if (!isRecording) {
            // Tap sin texto → hint
            showToast('Mantén presionado para grabar audio');
        }
    }

    // 🆕 Lightbox para ver imagen en grande
    // 🛡️ v2026-06-13: pinch-zoom + pan + doble tap (WebView de Capacitor no soporta zoom nativo)
    function openLightbox(src) {
        const box = document.createElement('div');
        box.className = 'lightbox';
        box.innerHTML = `
            <button class="lightbox-close"><i class="fas fa-times"></i></button>
            <button class="lightbox-download" onclick="event.stopPropagation(); ChatDetailPage.descargarArchivo('${escapeHtml(src)}', 'imagen_${Date.now()}.jpg')"><i class="fas fa-download"></i></button>
            <img src="${escapeHtml(src)}" style="touch-action:none; transform-origin:center center; will-change:transform;">
        `;
        document.body.appendChild(box);
        const close = () => box.remove();
        box.addEventListener('click', (e) => {
            if (e.target === box || e.target.closest('.lightbox-close')) close();
        });

        const img = box.querySelector('img');
        let scale = 1, tx = 0, ty = 0;
        let startDist = 0, startScale = 1;
        let startTx = 0, startTy = 0, startX = 0, startY = 0;
        let lastTap = 0;

        const apply = () => { img.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; };
        const dist = (a, b) => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

        img.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                startDist = dist(e.touches[0], e.touches[1]);
                startScale = scale;
            } else if (e.touches.length === 1) {
                const now = Date.now();
                if (now - lastTap < 300) {
                    // Doble tap → toggle zoom
                    e.preventDefault();
                    if (scale > 1.05) { scale = 1; tx = 0; ty = 0; } else { scale = 2.5; }
                    apply();
                }
                lastTap = now;
                if (scale > 1) {
                    startX = e.touches[0].clientX;
                    startY = e.touches[0].clientY;
                    startTx = tx;
                    startTy = ty;
                }
            }
        }, { passive: false });

        img.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                scale = Math.max(1, Math.min(5, startScale * (dist(e.touches[0], e.touches[1]) / startDist)));
                if (scale === 1) { tx = 0; ty = 0; }
                apply();
            } else if (e.touches.length === 1 && scale > 1) {
                e.preventDefault();
                tx = startTx + (e.touches[0].clientX - startX);
                ty = startTy + (e.touches[0].clientY - startY);
                apply();
            }
        }, { passive: false });
    }
    // Click en imagen de mensaje → lightbox
    document.addEventListener('click', (e) => {
        if (e.target.classList?.contains('msg-media')) {
            openLightbox(e.target.src);
        }
    });

    // Normaliza chatIds para que matcheen aunque vengan en formato distinto
    function normChatId(id) {
        if (!id) return '';
        return String(id).replace(/@(c\.us|s\.whatsapp\.net|lid)$/, '').replace(/^\+/, '');
    }

    // 🛡️ v2026-06-08: Recibe edición de mensaje en vivo. Actualiza el body del mensaje
    // existente y marca editado=true para que renderMessages muestre "(editado)".
    function onMessageEdited(data) {
        if (!data || !data.messageId) return;
        // Comparar chatIds normalizados
        if (data.chatId && normChatId(data.chatId) !== normChatId(currentChatId)) return;
        const idx = messages.findIndex(m => m.id === data.messageId);
        if (idx < 0) return;
        messages[idx] = {
            ...messages[idx],
            body: data.newBody || '',
            editado: true,
            fechaEdicion: data.editedAt || Date.now(),
        };
        lastMessagesHash = ''; // forzar re-render
        renderMessages('keep');
    }

    // 🆕 Recibe mensaje en vivo de Socket.IO
    function onNewMessage(data) {
        if (!data) return;
        // Comparar chatIds normalizados (sin sufijo @c.us / @s.whatsapp.net)
        if (normChatId(data.chatId) !== normChatId(currentChatId)) return;
        const msg = data.message || {};
        // Si ya tenemos un mensaje con este id, ignorar
        if (msg.id && messages.some(m => m.id === msg.id)) return;
        // 🆕 v2026-07-30: reconciliar con el mensaje optimista (temp-) para NO duplicar lo que
        // acabamos de escribir. Si el socket trae un saliente propio que coincide en cuerpo+tiempo
        // con un temp- nuestro, se reemplaza el temp (no se empuja otro). Igual que pollRefresh.
        if (msg.fromMe) {
            const _mTs = msg.timestamp || Date.now();
            // 🆕 Confirmación de un propio → sacarlo de la bandeja durable (evita reenvío/duplicado en el flush).
            try { PwaOutbox.confirmByBody(currentChatId, msg.body || '', _mTs); } catch {}
            const tempMatch = messages.find(x =>
                typeof x.id === 'string' && x.id.startsWith('temp-') &&
                x.fromMe && (x.body || '') === (msg.body || '') &&
                Math.abs((x.timestamp || 0) - _mTs) < 60000
            );
            if (tempMatch) {
                if (msg.id) tempMatch.id = msg.id;
                tempMatch.status = msg.status || 'sent';
                if (typeof msg.ack_level === 'number') tempMatch.ack_level = msg.ack_level;
                if (msg.senderTipo || msg.sender_tipo) tempMatch.senderTipo = msg.senderTipo || msg.sender_tipo;
                lastMessagesHash = '';
                renderMessages('keep');
                return;
            }
        }
        messages.push({
            id: msg.id || ('rt-' + Date.now()),
            body: msg.body || '',
            fromMe: !!msg.fromMe,
            timestamp: msg.timestamp || Date.now(),
            type: msg.type || 'text',
            mediaUrl: msg.mediaUrl || msg.media_url,
            hasMedia: msg.hasMedia || !!(msg.mediaUrl || msg.media_url),
            status: msg.status || (msg.fromMe ? 'sent' : 'received'),
            ack_level: typeof msg.ack_level === 'number' ? msg.ack_level : (msg.fromMe ? 0 : null),
            quoted_msg_id: msg.quoted_msg_id || msg.quotedMsg?.id || null,
            quoted_msg_body: msg.quoted_msg_body || msg.quotedMsg?.body,
            quoted_from_me: msg.quoted_from_me || msg.quotedMsg?.fromMe,
            // 🆕 v1.0.100: sender info en mensajes en vivo (websocket)
            senderTipo: msg.senderTipo || msg.sender_tipo || null,
            senderNombre: msg.senderNombre || msg.sender_nombre || null,
            editado: !!(msg.editado || msg.edited),
            fechaEdicion: msg.fechaEdicion || msg.fecha_edicion || null,
            botones: Array.isArray(msg.botones) && msg.botones.length ? msg.botones : null, // 🆕 v2026-08
        });
        lastMessagesHash = '';
        // Solo bajar al fondo si el usuario ya estaba cerca del fondo (no interrumpir lectura de historial)
        const area = document.getElementById('chat-messages-area');
        const nearBottom = !area || (area.scrollHeight - area.scrollTop - area.clientHeight) < 200;
        renderMessages(nearBottom ? 'bottom' : 'keep');
        // 🔓 v2026-08-04: un mensaje ENTRANTE del cliente reabre la ventana de 24h → re-evaluar la barra
        // en vivo (antes solo se chequeaba al ABRIR el chat, así que la barra seguía bloqueada aunque el
        // cliente ya hubiera respondido a la plantilla; había que cerrar/reabrir el chat).
        if (!msg.fromMe) { try { aplicarVentana24h(); } catch (e) {} }
    }

    // 🆕 Recibe ACKs en vivo (✓/✓✓/✓✓ azul) — emitido por bot cuando WhatsApp confirma
    function onMessageAckUpdate(data) {
        if (!data || !data.mensaje_id) return;
        const idx = messages.findIndex(m => m.id === data.mensaje_id);
        if (idx < 0) return;
        // No degradar: si ya está en nivel superior, ignorar (excepto si llega -1 = error)
        const current = messages[idx].ack_level ?? 0;
        const incoming = data.ack_level;
        if (incoming === -1) {
            messages[idx].ack_level = -1;
            messages[idx].ack_error = data.error || 'Sin entrega confirmada';
        } else if (typeof incoming === 'number' && incoming > current) {
            messages[idx].ack_level = incoming;
        } else {
            return; // sin cambio, no rerender
        }
        lastMessagesHash = '';
        renderMessages('keep');
    }

    // 🆕 Polling de respaldo: refresh cada 6s para asegurar que nada se pierde
    // (incluye mensajes enviados desde el celular vinculado, replies con metadata)
    async function pollRefresh() {
        // 🆕 v2026-10-25: aprovechar el tick para reenviar lo que quedó esperando señal (si hay y hay red).
        try { if (navigator.onLine && PwaOutbox.all().length) flushPwaOutbox(); } catch {}
        if (!currentChatId || isLoading || isLoadingMore) return;
        // 🛡️ Guard anti-contaminación: si el usuario cambia de chat mientras este fetch está en vuelo,
        // descartamos la respuesta (si no, mergearíamos mensajes del chat viejo en el chat nuevo).
        const chatIdSnapshot = currentChatId;
        // Solo si el usuario está cerca del fondo (no interrumpir lectura)
        const area = document.getElementById('chat-messages-area');
        const nearBottom = !area || (area.scrollHeight - area.scrollTop - area.clientHeight) < 250;
        try {
            const data = await API.get(`/api/chats/${encodeURIComponent(chatIdSnapshot)}/messages?limit=${PAGE_SIZE}&offset=0`);
            if (currentChatId !== chatIdSnapshot) return; // el usuario abrió otro chat: no pintar el viejo
            const list = data?.messages || data?.data || (Array.isArray(data) ? data : []);
            // Mergear: agregar solo mensajes que no tenemos por id
            const existingIds = new Set(messages.map(m => m.id));
            let agregados = 0;
            for (const m of list) {
                const id = m.id || m.mensaje_id;
                if (!id || existingIds.has(id)) continue;
                const mBody = m.body || m.contenido_texto || '';
                const mFromMe = !!(m.fromMe || m.from_me);
                const mTs = typeof m.timestamp === 'number' ? (m.timestamp > 1e12 ? m.timestamp : m.timestamp * 1000) : new Date(m.timestamp).getTime();
                // Si es un mensaje propio que coincide con un optimistic temp-* enviado en los últimos 60s,
                // reemplazar el temp con el real (evita duplicación visual del mensaje enviado desde la app)
                if (mFromMe) {
                    const tempMatch = messages.find(x =>
                        typeof x.id === 'string' && x.id.startsWith('temp-') &&
                        x.fromMe && (x.body || '') === mBody &&
                        Math.abs((x.timestamp || 0) - mTs) < 60000
                    );
                    if (tempMatch) {
                        tempMatch.id = id;
                        tempMatch.timestamp = mTs;
                        tempMatch.status = m.status || 'sent';
                        // Sincronizar quote info desde server (por si el optimistic se hizo sin quote
                        // o si el server completó datos faltantes)
                        if (m.quoted_msg_id || m.quotedMsg?.id) {
                            tempMatch.quoted_msg_id = m.quoted_msg_id || m.quotedMsg?.id;
                            tempMatch.quoted_msg_body = m.quoted_msg_body || m.quotedMsg?.body || tempMatch.quoted_msg_body;
                            tempMatch.quoted_from_me = m.quoted_from_me ?? m.quotedMsg?.fromMe ?? tempMatch.quoted_from_me;
                        }
                        existingIds.add(id);
                        continue;
                    }
                }
                messages.push({
                    id,
                    body: mBody,
                    fromMe: mFromMe,
                    timestamp: mTs,
                    type: m.type || m.tipo_mensaje || 'text',
                    mediaUrl: m.mediaUrl || m.media_url,
                    filename: m.filename || m.media_filename,
                    hasMedia: m.hasMedia || !!(m.mediaUrl || m.media_url),
                    status: m.status || (mFromMe ? 'sent' : 'received'),
                    quoted_msg_id: m.quoted_msg_id || m.quotedMsg?.id || null,
                    quoted_msg_body: m.quoted_msg_body || m.quotedMsg?.body,
                    quoted_from_me: m.quoted_from_me || m.quotedMsg?.fromMe,
                    // 🆕 v1.0.100: sender info en poll refresh
                    senderTipo: m.senderTipo || m.sender_tipo || null,
                    senderNombre: m.senderNombre || m.sender_nombre || null,
                    ack_level: m.ack_level,
                });
                agregados++;
            }
            if (agregados > 0) {
                lastMessagesHash = '';
                renderMessages(nearBottom ? 'bottom' : 'keep');
            } else {
                // Aunque no haya nuevos, actualizar status de los existentes (sent → read)
                let cambios = 0;
                for (const m of list) {
                    const id = m.id || m.mensaje_id;
                    if (!id) continue;
                    const existente = messages.find(x => x.id === id);
                    if (existente && existente.status !== m.status) {
                        existente.status = m.status;
                        cambios++;
                    }
                }
                if (cambios > 0) {
                    lastMessagesHash = '';
                    renderMessages('keep');
                }
            }
        } catch {}
    }

    let pollIntervalId = null;
    function startPoll() {
        if (pollIntervalId) clearInterval(pollIntervalId);
        pollIntervalId = setInterval(pollRefresh, 6000);
    }
    function stopPoll() {
        if (pollIntervalId) { clearInterval(pollIntervalId); pollIntervalId = null; }
    }

    // 🆕 Scroll al mensaje citado + highlight breve (estilo WhatsApp)
    async function scrollToQuoted(quotedId) {
        if (!quotedId) return;
        const area = document.getElementById('chat-messages-area');
        if (!area) return;
        const tryFind = () => area.querySelector(`.msg-bubble[data-msgid="${CSS.escape(quotedId)}"]`);
        let target = tryFind();

        // Si no está cargado, cargar más mensajes hasta encontrarlo (o hasta el final del historial)
        if (!target) {
            showToast('Buscando mensaje original…');
            let attempts = 0;
            while (!target && hasMoreMessages && attempts < 10) {
                attempts++;
                await loadMoreMessages();
                target = tryFind();
            }
        }

        if (!target) {
            showToast('Mensaje original no disponible', 'error');
            return;
        }

        // Scroll suave
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Highlight animado
        const original = target.style.boxShadow;
        const originalBg = target.style.background;
        target.style.transition = 'box-shadow 0.3s, background 0.3s';
        target.style.boxShadow = '0 0 0 3px #f59e0b';
        target.style.background = '#fef3c7';
        setTimeout(() => {
            target.style.boxShadow = original || '';
            target.style.background = originalBg || '';
        }, 1800);
    }

    // 🆕 Abrir archivo (PDF/doc) usando FileOpener en Capacitor o nueva pestaña en web
    async function abrirArchivo(url, filename) {
        try {
            const isNative = !!(window.Capacitor && (window.Capacitor.isNativePlatform?.() || window.Capacitor.platform !== 'web'));
            if (isNative && window.Capacitor.Plugins?.Filesystem && window.Capacitor.Plugins?.FileOpener) {
                const { Filesystem, FileOpener } = window.Capacitor.Plugins;
                const safeName = (filename || 'archivo').replace(/[^a-zA-Z0-9._-]/g, '_') || 'archivo';
                showToast('Descargando…');
                const result = await Filesystem.downloadFile({
                    url,
                    path: safeName,
                    directory: 'CACHE'
                });
                await FileOpener.open({ filePath: result.path, openWithDefault: true });
                return;
            }
        } catch (e) {
            console.warn('[abrirArchivo] Capacitor falló, usando fallback web:', e.message);
        }
        // Fallback navegador / web
        try { window.open(url, '_blank'); }
        catch { window.location.href = url; }
    }

    // ============================================================
    // 🆕 v2026-08-27: VISOR DE DOCUMENTOS IN-APP (PDF, Word, Excel)
    // Antes "abrir archivo" descargaba y lo mandaba a una app externa (visor de PDF del
    // celular, etc.) — ahora los tipos soportados se ven DENTRO de la app, como WhatsApp.
    // Lo que no se puede previsualizar (tipos raros) sigue cayendo al comportamiento viejo
    // (abrir con la app externa por defecto del celular).
    // ============================================================
    const _VISOR_EXTENSIONES = { pdf: 'pdf', doc: 'word', docx: 'word', xls: 'excel', xlsx: 'excel' };
    const _scriptsVisorCargados = {};
    function _cargarScriptVisor(src) {
        if (_scriptsVisorCargados[src]) return _scriptsVisorCargados[src];
        _scriptsVisorCargados[src] = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('No se pudo cargar ' + src));
            document.head.appendChild(s);
        });
        return _scriptsVisorCargados[src];
    }
    function _extDeArchivo(filename, url) {
        const nombre = (filename || url || '').split('?')[0];
        const m = /\.([a-zA-Z0-9]+)$/.exec(nombre);
        return m ? m[1].toLowerCase() : '';
    }
    // Lee los bytes del documento: en nativo lo descarga a caché (Filesystem) — eso de paso lo
    // deja disponible para reabrir sin red la próxima vez; en web hace fetch normal.
    async function _leerBytesDocumento(url, filename) {
        const isNative = !!(window.Capacitor && (window.Capacitor.isNativePlatform?.() || window.Capacitor.platform !== 'web'));
        if (isNative && window.Capacitor.Plugins?.Filesystem) {
            const { Filesystem } = window.Capacitor.Plugins;
            const safeName = (filename || 'archivo').replace(/[^a-zA-Z0-9._-]/g, '_') || 'archivo';
            try {
                await Filesystem.stat({ path: safeName, directory: 'CACHE' });
            } catch (_) {
                await Filesystem.downloadFile({ url, path: safeName, directory: 'CACHE' });
            }
            const leido = await Filesystem.readFile({ path: safeName, directory: 'CACHE' });
            const base64 = leido.data;
            const bin = atob(base64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return bytes.buffer;
        }
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('No se pudo descargar el archivo (HTTP ' + resp.status + ')');
        return await resp.arrayBuffer();
    }

    async function abrirVisorDocumento(url, filename) {
        const ext = _extDeArchivo(filename, url);
        const tipo = _VISOR_EXTENSIONES[ext];
        if (!tipo) { return abrirArchivo(url, filename); } // tipo no soportado → comportamiento de siempre

        // 🛡️ v2026-08-28 (reporte real: "queda el espacio como si el teclado estuviera abierto"):
        // si el teclado estaba abierto (el asesor venía escribiendo) y toca un documento, hay que
        // sacarle el foco al input YA para que el teclado se cierre — si no, la pantalla queda con
        // el hueco del teclado atascado. _reaplicarViewport() es el mismo fix ya usado para volver
        // de segundo plano (installViewportSync) — se dispara igual al abrir Y al cerrar el visor.
        try { document.activeElement?.blur?.(); } catch (_) {}
        _reaplicarViewport();

        const ov = document.createElement('div');
        ov.className = 'doc-viewer-overlay';
        ov.innerHTML = `
            <div class="doc-viewer-topbar">
                <button onclick="ChatDetailPage._cerrarVisorDocumento()"><i class="fas fa-arrow-left"></i></button>
                <span class="doc-viewer-title">${escapeHtml(filename || 'Documento')}</span>
                <button onclick="ChatDetailPage.descargarArchivo('${escapeHtml(url)}','${escapeHtml(filename || '')}')"><i class="fas fa-download"></i></button>
            </div>
            <div class="doc-viewer-body" id="doc-viewer-body">
                <div class="doc-viewer-loading"><i class="fas fa-spinner fa-spin"></i> Cargando documento…</div>
            </div>`;
        document.body.appendChild(ov);

        const body = ov.querySelector('#doc-viewer-body');
        try {
            const buffer = await _leerBytesDocumento(url, filename);
            if (tipo === 'pdf') await _renderizarPDF(buffer, body);
            else if (tipo === 'word') await _renderizarWord(buffer, body);
            else if (tipo === 'excel') await _renderizarExcel(buffer, body);
        } catch (e) {
            console.error('[VisorDocumento] Error:', e);
            body.innerHTML = `
                <div class="doc-viewer-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>No se pudo previsualizar este documento.</p>
                    <button class="img-ed-pill-btn primary" onclick="ChatDetailPage._cerrarVisorDocumento(); ChatDetailPage.abrirArchivo('${escapeHtml(url)}','${escapeHtml(filename || '')}')">Abrir con otra app</button>
                </div>`;
        }
    }
    function _cerrarVisorDocumento() {
        document.querySelector('.doc-viewer-overlay')?.remove();
        _reaplicarViewport();
    }
    // Dispara el mismo resize que ya escucha installViewportSync (window 'resize') para que
    // page-chat recalcule su alto real — cubre el caso "el teclado se cerró pero el hueco quedó".
    // Reintentos cortos porque a veces el WebView reporta el alto viejo en el primer tick.
    function _reaplicarViewport() {
        try {
            window.dispatchEvent(new Event('resize'));
            setTimeout(() => window.dispatchEvent(new Event('resize')), 150);
            setTimeout(() => window.dispatchEvent(new Event('resize')), 500);
        } catch (_) {}
    }

    // 🆕 v2026-08-28: pinch-zoom + doble-tap genérico — mismo mecanismo YA probado en
    // openLightbox (fotos), generalizado para aplicarlo a cualquier contenedor (acá, las
    // páginas del PDF). touch-action:pan-y deja el scroll vertical normal cuando NO está
    // haciendo zoom; nuestro JS toma el control (preventDefault) en pinch/pan-con-zoom.
    function _habilitarPinchZoom(el) {
        let scale = 1, tx = 0, ty = 0;
        let startDist = 0, startScale = 1;
        let startTx = 0, startTy = 0, startX = 0, startY = 0;
        let lastTap = 0;
        el.style.transformOrigin = 'top center';
        el.style.touchAction = 'pan-y';
        el.style.willChange = 'transform';
        const apply = () => { el.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; };
        const dist = (a, b) => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        el.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                startDist = dist(e.touches[0], e.touches[1]);
                startScale = scale;
            } else if (e.touches.length === 1) {
                const now = Date.now();
                if (now - lastTap < 300) {
                    e.preventDefault();
                    if (scale > 1.05) { scale = 1; tx = 0; ty = 0; } else { scale = 2.2; }
                    apply();
                }
                lastTap = now;
                if (scale > 1) { startX = e.touches[0].clientX; startY = e.touches[0].clientY; startTx = tx; startTy = ty; }
            }
        }, { passive: false });
        el.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                scale = Math.max(1, Math.min(5, startScale * (dist(e.touches[0], e.touches[1]) / startDist)));
                if (scale === 1) { tx = 0; ty = 0; }
                apply();
            } else if (e.touches.length === 1 && scale > 1) {
                e.preventDefault();
                tx = startTx + (e.touches[0].clientX - startX);
                ty = startTy + (e.touches[0].clientY - startY);
                apply();
            }
        }, { passive: false });
    }

    async function _renderizarPDF(buffer, body) {
        await _cargarScriptVisor('vendor/pdfjs/pdf.min.js');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
        const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
        body.innerHTML = '';
        const cont = document.createElement('div');
        cont.className = 'doc-viewer-pdf';
        body.appendChild(cont);
        // 🛡️ v2026-08-28: se veía borroso — el canvas se dibujaba a resolución de píxeles CSS
        // (~380px) sin tener en cuenta devicePixelRatio. En una pantalla retina/alta densidad
        // (2x-3x) eso queda pixelado. Mismo fix ya aplicado antes en el editor de imagen: el
        // BUFFER interno del canvas va a mayor resolución (scale × dpr), pero el tamaño CSS
        // (canvas.style.width/height) se fija aparte al tamaño de pantalla real — así el
        // navegador reduce la imagen de más píxeles a menos, en vez de mostrarla 1:1 pixelada.
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        for (let n = 1; n <= pdf.numPages; n++) {
            const page = await pdf.getPage(n);
            const cssWidth = cont.clientWidth || 360;
            const baseWidth = page.getViewport({ scale: 1 }).width;
            const cssScale = cssWidth / baseWidth;
            const viewport = page.getViewport({ scale: cssScale * dpr });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.width = cssWidth + 'px';
            canvas.style.height = (viewport.height / dpr) + 'px';
            cont.appendChild(canvas);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        }
        // 🆕 v2026-08-28: pedían poder hacer zoom — antes el PDF quedaba fijo al ancho de
        // pantalla sin forma de acercar el detalle. Pinch (2 dedos) + doble tap, mismo
        // mecanismo ya probado en el lightbox de fotos (openLightbox).
        _habilitarPinchZoom(cont);
    }
    async function _renderizarWord(buffer, body) {
        await _cargarScriptVisor('vendor/mammoth/mammoth.browser.min.js');
        const result = await window.mammoth.convertToHtml({ arrayBuffer: buffer });
        body.innerHTML = `<div class="doc-viewer-word">${result.value}</div>`;
    }
    async function _renderizarExcel(buffer, body) {
        await _cargarScriptVisor('vendor/xlsx/xlsx.full.min.js');
        const wb = window.XLSX.read(buffer, { type: 'array' });
        body.innerHTML = '';
        const tabs = document.createElement('div');
        tabs.className = 'doc-viewer-excel-tabs';
        const tablesWrap = document.createElement('div');
        tablesWrap.className = 'doc-viewer-excel-tables';
        body.appendChild(tabs);
        body.appendChild(tablesWrap);
        wb.SheetNames.forEach((name, i) => {
            const btn = document.createElement('button');
            btn.textContent = name;
            btn.className = 'doc-viewer-excel-tab' + (i === 0 ? ' active' : '');
            btn.onclick = () => {
                tabs.querySelectorAll('.doc-viewer-excel-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                tablesWrap.querySelectorAll('.doc-viewer-excel-sheet').forEach(t => t.style.display = 'none');
                tablesWrap.querySelector(`[data-sheet="${i}"]`).style.display = 'block';
            };
            tabs.appendChild(btn);
            const div = document.createElement('div');
            div.className = 'doc-viewer-excel-sheet';
            div.dataset.sheet = i;
            div.style.display = i === 0 ? 'block' : 'none';
            div.innerHTML = window.XLSX.utils.sheet_to_html(wb.Sheets[name]);
            tablesWrap.appendChild(div);
        });
    }

    // 🆕 v2026-05-25: Descargar archivo/imagen al almacenamiento del usuario (NO solo abrir)
    // Pide permiso de archivos si no lo tiene. Guarda en Documents/SolucNet (visible al usuario).
    async function descargarArchivo(url, filename) {
        const isNative = !!(window.Capacitor && (window.Capacitor.isNativePlatform?.() || window.Capacitor.platform !== 'web'));
        const safeName = (filename || `archivo_${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_') || `archivo_${Date.now()}`;

        if (isNative && window.Capacitor.Plugins?.Filesystem) {
            const { Filesystem } = window.Capacitor.Plugins;
            // 1) Verificar / pedir permisos de almacenamiento si la API existe
            try {
                if (typeof Filesystem.checkPermissions === 'function') {
                    const check = await Filesystem.checkPermissions();
                    const state = check?.publicStorage || check?.publicStorage?.state || check?.state;
                    if (state && state !== 'granted') {
                        showToast('Pidiendo permiso de almacenamiento…');
                        const req = await Filesystem.requestPermissions();
                        const newState = req?.publicStorage || req?.state;
                        if (newState && newState !== 'granted') {
                            showToast('Sin permiso de archivos. Activá "Archivos y multimedia" en Ajustes → Apps → SolucNet Admin', 'error');
                            return;
                        }
                    }
                }
            } catch (permErr) {
                console.warn('[descargarArchivo] No se pudo verificar permisos, intentando descarga directa:', permErr.message);
            }

            // 2) Descargar al directorio DOCUMENTS (visible al usuario en la app Files)
            try {
                showToast('Descargando…');
                const result = await Filesystem.downloadFile({
                    url,
                    path: `SolucNet/${safeName}`,
                    directory: 'DOCUMENTS',
                    recursive: true
                });
                showToast(`✅ Guardado en Documents/SolucNet/${safeName}`, 'success');
                return result;
            } catch (e) {
                console.error('[descargarArchivo] Falló DOCUMENTS, intentando CACHE:', e.message);
                // Fallback: cache (al menos queda accesible para abrir)
                try {
                    await Filesystem.downloadFile({ url, path: safeName, directory: 'CACHE' });
                    showToast('Descargado en cache (usar Compartir para guardar)', 'info');
                } catch (e2) {
                    showToast('Error descargando: ' + e2.message, 'error');
                }
                return;
            }
        }

        // Fallback web (navegador)
        try {
            const a = document.createElement('a');
            a.href = url;
            a.download = safeName;
            a.target = '_blank';
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch {
            window.open(url, '_blank');
        }
    }

    // 🆕 Pegar imagen desde el portapapeles (teclado Android: long-press → Pegar, Gboard, screenshots, Ctrl+V)
    async function enviarBlobComoImagen(blob, mimeType) {
        if (!currentChatId || !blob) return false;
        const type = mimeType || blob.type || 'image/png';
        const ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        const file = new File([blob], `imagen_pegada_${Date.now()}.${ext}`, { type });
        showToast(`Enviando imagen…`);
        const fd = new FormData();
        fd.append('chatId', currentChatId);
        fd.append('file', file);
        try {
            const r = await fetch(APP_CONFIG.SERVER_URL + '/api/send-file', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + API.getToken() },
                body: fd
            });
            if (r.ok) { showToast('Imagen enviada'); setTimeout(() => refresh(), 1500); return true; }
            showToast('Error enviando imagen', 'error'); return false;
        } catch (err) { showToast('Error de red', 'error'); return false; }
    }

    async function handlePaste(e) {
        // Solo procesar si estamos en un chat (sin importar activeElement — long-press en Android
        // puede mover el foco momentáneamente)
        if (!currentChatId) return;
        const cd = e.clipboardData || e.originalEvent?.clipboardData;
        if (!cd) return;

        // 1) Items tipo File (la vía más común — screenshots, Gboard panel imágenes, copiar imagen)
        const items = cd.items || [];
        for (const item of items) {
            if (item.kind === 'file' && (item.type || '').startsWith('image/')) {
                e.preventDefault();
                const blob = item.getAsFile();
                if (blob) { await enviarBlobComoImagen(blob, item.type); return; }
            }
        }

        // 2) Algunos teclados Android entregan la imagen como una URL en text/uri-list
        const uri = cd.getData?.('text/uri-list') || '';
        if (uri && /^(content:|file:|https?:|data:image)/i.test(uri)) {
            // Si es data: URL la convertimos directo
            if (uri.startsWith('data:image')) {
                try {
                    const r = await fetch(uri);
                    const blob = await r.blob();
                    e.preventDefault();
                    await enviarBlobComoImagen(blob);
                    return;
                } catch {}
            }
            // content:// y file:// no son fetcheables desde el WebView, pero algunas
            // veces vienen también como File arriba — silencioso si no.
        }

        // 3) text/html con <img src="data:..."> (algunos clientes)
        const html = cd.getData?.('text/html') || '';
        const m = html.match(/<img[^>]+src=["']?(data:image[^"'>\s]+)/i);
        if (m && m[1]) {
            try {
                const r = await fetch(m[1]);
                const blob = await r.blob();
                e.preventDefault();
                await enviarBlobComoImagen(blob);
            } catch {}
        }
    }

    // Registrar el listener paste una vez (delegación global a document)
    // Removido el filtro de activeElement — en Android long-press → Pegar puede no tener foco en el textarea
    if (!window.__chatPasteListenerRegistered) {
        document.addEventListener('paste', handlePaste, true);
        // Fallback adicional: algunos teclados disparan 'beforeinput' con inputType insertFromPaste
        document.addEventListener('beforeinput', (e) => {
            if (e.inputType === 'insertFromPaste' && e.dataTransfer) {
                handlePaste({ clipboardData: e.dataTransfer, preventDefault: () => e.preventDefault() });
            }
        }, true);
        window.__chatPasteListenerRegistered = true;
    }

    // ============================================================
    // 🆕 v2026-07: CRM del chat — notas internas, asignación, etiquetas.
    // Si el bot aún no fue reiniciado (endpoints 404), degrada suave (vacío, sin crash).
    // ============================================================
    function _crmOverlay(inner) {
        document.getElementById('crm-overlay')?.remove();
        const ov = document.createElement('div');
        ov.id = 'crm-overlay';
        ov.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:99997; display:flex; align-items:flex-end; justify-content:center;';
        ov.innerHTML = `<div style="background:#fff; width:100%; max-width:560px; max-height:80vh; overflow:auto; border-radius:14px 14px 0 0; padding:16px;">${inner}</div>`;
        ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
        document.body.appendChild(ov);
    }
    function _crmClose() { document.getElementById('crm-overlay')?.remove(); }

    // 🆕 v2026-07: cicla la velocidad de reproducción de una nota de voz (1x → 1.5x → 2x).
    // 🛡️ v2026-08-27: buscar el <audio> desde `.msg-audio` (no del padre inmediato) — el rediseño
    // estilo WhatsApp movió el botón de velocidad adentro de `.audio-meta`, ya no es hermano directo.
    function cycleAudioSpeed(btn) {
        const audio = btn.closest('.msg-audio')?.querySelector('audio');
        if (!audio) return;
        const speeds = [1, 1.5, 2];
        const idx = speeds.indexOf(audio.playbackRate || 1);
        const next = speeds[(idx + 1) % speeds.length];
        audio.playbackRate = next;
        btn.textContent = next + 'x';
    }

    // ============================================================
    // 🎨 v2026-08-27: notas de voz y video estilo WhatsApp real (antes usaban los controles
    // nativos feos del navegador). Ver renderMessage() para el HTML de cada burbuja.
    // ============================================================
    // Hash corto y estable a partir del id del mensaje — para IDs de elementos DOM y como
    // "semilla" de la forma de onda (mismo mensaje → misma forma de onda siempre, no random en
    // cada render).
    function _imgHashId(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
        return Math.abs(h).toString(36);
    }
    // Forma de onda determinística (no es la onda REAL del audio — decodificarla de verdad
    // implicaría bajar y procesar cada nota de voz con Web Audio API solo para dibujarla, muy
    // costoso en una lista larga de chat). Se ve auténtica y es 100% estable por mensaje.
    function _waveformBars(seed) {
        const N = 32;
        let s = 0;
        for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
        const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 8) / 16777216; };
        const bars = [];
        let base = 0.4;
        for (let i = 0; i < N; i++) {
            base += (rnd() - 0.5) * 0.5;
            base = Math.max(0.15, Math.min(1, base));
            bars.push(Math.max(0.12, base * (0.55 + rnd() * 0.45)));
        }
        return bars;
    }
    function _audioTimeStr(sec) {
        if (!isFinite(sec) || sec < 0) sec = 0;
        const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
        return m + ':' + String(s).padStart(2, '0');
    }
    function toggleAudio(audId) {
        const audio = document.getElementById(audId);
        if (!audio) return;
        if (audio.paused) {
            // Estilo WhatsApp: al reproducir una nota, pausar cualquier otra que estuviera sonando.
            document.querySelectorAll('#chat-messages-area audio').forEach(a => { if (a !== audio && !a.paused) a.pause(); });
            audio.play().catch(() => {});
        } else {
            audio.pause();
        }
    }
    function _audioPlayBtn(audId) { return document.getElementById('wrap_' + audId)?.querySelector('.audio-play-btn i'); }
    function _onAudioTick(audId) {
        const audio = document.getElementById(audId);
        const prog = document.getElementById('prog_' + audId);
        const timeEl = document.getElementById('time_' + audId);
        const icon = _audioPlayBtn(audId);
        if (!audio) return;
        if (icon) icon.className = audio.paused ? 'fas fa-play' : 'fas fa-pause';
        const dur = audio.duration;
        if (prog && dur > 0) prog.style.width = Math.min(100, (audio.currentTime / dur) * 100) + '%';
        if (timeEl) timeEl.textContent = _audioTimeStr(audio.paused && audio.currentTime === 0 ? (dur || 0) : audio.currentTime);
    }
    function _onAudioEnded(audId) {
        const audio = document.getElementById(audId);
        const prog = document.getElementById('prog_' + audId);
        const timeEl = document.getElementById('time_' + audId);
        const icon = _audioPlayBtn(audId);
        if (icon) icon.className = 'fas fa-play';
        if (prog) prog.style.width = '0%';
        if (timeEl && audio) timeEl.textContent = _audioTimeStr(audio.duration || 0);
    }
    // Tocar la forma de onda busca (seek) a esa posición — igual que WhatsApp.
    function seekAudio(evt, audId) {
        const audio = document.getElementById(audId);
        if (!audio || !isFinite(audio.duration) || !audio.duration) return;
        const wf = evt.currentTarget;
        const r = wf.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (evt.clientX - r.left) / r.width));
        audio.currentTime = pct * audio.duration;
        _onAudioTick(audId);
    }
    // 🆕 v2026-08-27: transcripción bajo demanda de una nota de voz (estilo "Transcribir" de WhatsApp).
    // No se transcribe automáticamente (costo/latencia) — el asesor toca el botón cuando la necesita.
    async function transcribirAudioMsg(msgId, audId) {
        const el = document.getElementById('tr_' + audId);
        if (el) el.innerHTML = `<div class="audio-transcript-loading"><i class="fas fa-spinner fa-spin"></i> Transcribiendo…</div>`;
        try {
            const r = await API.post(`/api/messages/${encodeURIComponent(msgId)}/transcribir`, {});
            if (r?.success && r.transcripcion) {
                const m = messages.find(x => x.id === msgId);
                if (m) m.transcripcion = r.transcripcion;
                if (el) el.innerHTML = `<div class="audio-transcript-text">${escapeHtml(r.transcripcion)}</div>`;
            } else {
                if (el) el.innerHTML = `<button class="audio-transcript-btn" onclick="event.stopPropagation(); ChatDetailPage.transcribirAudioMsg('${escapeHtml(msgId)}','${escapeHtml(audId)}')"><i class="fas fa-closed-captioning"></i> Transcribir</button>`;
                showToast(r?.message || 'No se pudo transcribir', 'error');
            }
        } catch (e) {
            if (el) el.innerHTML = `<button class="audio-transcript-btn" onclick="event.stopPropagation(); ChatDetailPage.transcribirAudioMsg('${escapeHtml(msgId)}','${escapeHtml(audId)}')"><i class="fas fa-closed-captioning"></i> Transcribir</button>`;
            showToast('Error al transcribir', 'error');
        }
    }
    function _setVideoDuration(vidId) {
        const video = document.getElementById(vidId);
        const badge = document.getElementById('dur_' + vidId);
        if (video && badge && isFinite(video.duration)) badge.textContent = _audioTimeStr(video.duration);
    }
    // Reproductor de video a pantalla completa (se abre recién al tocar la miniatura — igual que WhatsApp).
    function openVideoFull(url) {
        const ov = document.createElement('div');
        ov.className = 'img-fullview';
        ov.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.95); z-index:12000; display:flex; align-items:center; justify-content:center;';
        ov.innerHTML = `
            <video src="${escapeHtml(url)}" controls autoplay playsinline style="max-width:98vw; max-height:88vh; border-radius:6px;"></video>
            <a href="${escapeHtml(url)}" download target="_blank" rel="noopener" onclick="event.stopPropagation();" style="position:absolute; top:16px; right:60px; color:#fff; font-size:1.4em;" title="Descargar"><i class="fas fa-download"></i></a>
            <button style="position:absolute; top:12px; right:14px; background:none; border:none; color:#fff; font-size:1.8em; cursor:pointer;">&times;</button>`;
        ov.addEventListener('click', e => { if (e.target === ov || e.target.tagName === 'BUTTON') { ov.querySelector('video')?.pause(); ov.remove(); } });
        document.body.appendChild(ov);
    }

    // ============================================================
    // 🆕 v2026-08-27: Editor de imagen estilo WhatsApp — recortar/rotar, dibujar
    // (con grosor y borrador), texto y stickers, antes de enviar.
    // Frontend puro: exporta el canvas final a blob y reemplaza el archivo en _pendingAttach.
    // ============================================================
    let _imgEd = null;
    const IMG_ED_COLORS = ['#ffffff', '#000000', '#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#af52de'];
    const IMG_ED_STICKERS = ['😀', '😂', '😍', '😎', '🙌', '👍', '🔥', '💯', '❤️', '⭐', '✅', '❌', '⚠️', '🎉', '💰', '📍', '📸', '🚀', '👏', '🙏'];

    function _editImage(idx) {
        const pend = _pendingAttach;
        if (!pend || !pend.files[idx] || !(pend.files[idx].type || '').startsWith('image/')) return;
        const url = URL.createObjectURL(pend.files[idx]);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); _openImageEditor(idx, img); };
        img.onerror = () => { URL.revokeObjectURL(url); showToast('No se pudo abrir la imagen', 'error'); };
        img.src = url;
    }

    function _openImageEditor(idx, img) {
        document.getElementById('img-editor-overlay')?.remove();
        const ov = document.createElement('div');
        ov.id = 'img-editor-overlay';
        ov.style.cssText = 'position:fixed; inset:0; background:#000; z-index:100000; display:flex; flex-direction:column;';
        ov.innerHTML = `
            <div class="img-ed-topbar">
                <button class="img-ed-iconbtn" onclick="ChatDetailPage._imgEdCancel()"><i class="fas fa-times"></i></button>
                <div class="img-ed-tools">
                    <button class="img-ed-iconbtn" data-tool="crop" onclick="ChatDetailPage._imgEdSetTool('crop')" title="Recortar/rotar"><i class="fas fa-crop-alt"></i></button>
                    <button class="img-ed-iconbtn" data-tool="draw" onclick="ChatDetailPage._imgEdSetTool('draw')" title="Dibujar"><i class="fas fa-pen"></i></button>
                    <button class="img-ed-iconbtn" data-tool="text" onclick="ChatDetailPage._imgEdSetTool('text')" title="Texto"><i class="fas fa-font"></i></button>
                    <button class="img-ed-iconbtn" data-tool="sticker" onclick="ChatDetailPage._imgEdSetTool('sticker')" title="Stickers"><i class="fas fa-icons"></i></button>
                    <button class="img-ed-iconbtn" onclick="ChatDetailPage._imgEdUndo()" title="Deshacer"><i class="fas fa-undo"></i></button>
                </div>
                <button class="img-ed-done" onclick="ChatDetailPage._imgEdDone()"><i class="fas fa-check"></i></button>
            </div>
            <div class="img-ed-canvas-wrap" id="img-ed-canvas-wrap"></div>
            <div class="img-ed-bottombar" id="img-ed-bottombar"></div>`;
        // 🛡️ v2026-08-27 (reporte real: "la imagen aparece pequeña"): ANTES el canvas se
        // dimensionaba según el tamaño de la IMAGEN (escalada a max 1280px) y se confiaba en
        // `max-width/max-height:100%` de CSS para que "se ajustara solo" al contenedor — frágil,
        // y en el dispositivo real terminaba chico. Patrón correcto (igual que cualquier editor de
        // fotos real): MEDIR el contenedor de verdad ya en el DOM, calcular el tamaño que le
        // corresponde a la imagen ADENTRO de ese espacio (contain), y fijar canvas.width/height
        // (buffer real, con devicePixelRatio para que no se vea pixelado) Y canvas.style.width/height
        // (tamaño en pantalla) EXPLÍCITAMENTE — nada librado al ajuste automático del navegador.
        document.body.appendChild(ov); // se agrega YA al DOM para poder medir el contenedor real
        const wrap = document.getElementById('img-ed-canvas-wrap');
        const wrapR = wrap.getBoundingClientRect();
        const PAD = 12;
        const availW = Math.max(50, wrapR.width - PAD * 2);
        const availH = Math.max(50, wrapR.height - PAD * 2);
        const fitScale = Math.min(availW / img.naturalWidth, availH / img.naturalHeight);
        const cssW = Math.max(1, Math.round(img.naturalWidth * fitScale));
        const cssH = Math.max(1, Math.round(img.naturalHeight * fitScale));
        const dpr = Math.min(window.devicePixelRatio || 1, 3);

        const canvas = document.createElement('canvas');
        canvas.id = 'img-ed-canvas';
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.width = cssW + 'px';
        canvas.style.height = cssH + 'px';
        canvas.style.touchAction = 'none';
        canvas.style.borderRadius = '4px';
        wrap.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        _imgEd = {
            idx, canvas, ctx, w: canvas.width, h: canvas.height,
            tool: 'draw', color: '#ff3b30', brush: 'md', eraser: false,
            history: [canvas.toDataURL('image/jpeg', 0.92)],
            crop: null, pending: null,
        };
        _imgEdBindCanvasEvents();
        _imgEdSetTool('draw');
    }

    function _imgEdBrushWidth() {
        const e = _imgEd;
        const base = Math.max(2, Math.round(e.w / 220));
        return e.brush === 'sm' ? base : e.brush === 'lg' ? base * 4 : base * 2;
    }
    function _imgEdCanvasPos(evt) {
        const canvas = _imgEd.canvas;
        const r = canvas.getBoundingClientRect();
        return { x: (evt.clientX - r.left) * (canvas.width / r.width), y: (evt.clientY - r.top) * (canvas.height / r.height) };
    }
    function _imgEdBindCanvasEvents() {
        const canvas = _imgEd.canvas;
        let drawing = false;
        canvas.onpointerdown = (evt) => {
            const e = _imgEd; if (!e) return;
            if (e.tool === 'draw') {
                drawing = true;
                canvas.setPointerCapture?.(evt.pointerId);
                const p = _imgEdCanvasPos(evt);
                e.ctx.globalCompositeOperation = e.eraser ? 'destination-out' : 'source-over';
                e.ctx.strokeStyle = e.color; e.ctx.lineWidth = _imgEdBrushWidth(); e.ctx.lineCap = 'round'; e.ctx.lineJoin = 'round';
                e.ctx.beginPath(); e.ctx.moveTo(p.x, p.y);
            } else if (e.tool === 'text') {
                const wrapR = document.getElementById('img-ed-canvas-wrap').getBoundingClientRect();
                _imgEdAddText(evt.clientX - wrapR.left, evt.clientY - wrapR.top);
            }
        };
        canvas.onpointermove = (evt) => {
            const e = _imgEd; if (!e || !drawing || e.tool !== 'draw') return;
            const p = _imgEdCanvasPos(evt);
            e.ctx.lineTo(p.x, p.y); e.ctx.stroke();
        };
        const endDraw = () => {
            if (drawing) { _imgEd.ctx.globalCompositeOperation = 'source-over'; _imgEdPushHistory(); }
            drawing = false;
        };
        canvas.onpointerup = endDraw;
        canvas.onpointercancel = endDraw;
    }
    function _imgEdPushHistory() {
        const e = _imgEd; if (!e) return;
        e.history.push(e.canvas.toDataURL('image/jpeg', 0.92));
        if (e.history.length > 20) e.history.shift();
    }
    function _imgEdUndo() {
        const e = _imgEd; if (!e || e.history.length < 2) return;
        _imgEdDiscardPending();
        e.history.pop();
        const last = e.history[e.history.length - 1];
        const img = new Image();
        img.onload = () => {
            e.canvas.width = img.naturalWidth; e.canvas.height = img.naturalHeight; e.w = img.naturalWidth; e.h = img.naturalHeight;
            e.ctx.clearRect(0, 0, e.canvas.width, e.canvas.height);
            e.ctx.drawImage(img, 0, 0);
        };
        img.src = last;
    }

    function _imgEdSetTool(tool) {
        const e = _imgEd; if (!e) return;
        _imgEdCommitPending(); // confirmar texto/sticker pendiente al cambiar de herramienta
        e.tool = tool;
        _imgEdClearCropUI();
        if (tool === 'crop') _imgEdInitCrop();
        _imgEdRenderBottomBar();
    }
    function _imgEdRenderBottomBar() {
        const e = _imgEd; if (!e) return;
        document.querySelectorAll('#img-editor-overlay [data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === e.tool));
        const bar = document.getElementById('img-ed-bottombar'); if (!bar) return;
        const swatches = (onColor) => IMG_ED_COLORS.map(c =>
            `<span class="img-ed-swatch ${c === e.color ? 'active' : ''}" style="background:${c}" onclick="ChatDetailPage.${onColor}('${c}')"></span>`).join('');
        if (e.tool === 'draw') {
            bar.innerHTML = `
                <div class="img-ed-swatches">${swatches('_imgEdColor')}
                    <button class="img-ed-iconbtn img-ed-eraser-toggle ${e.eraser ? 'active' : ''}" onclick="ChatDetailPage._imgEdToggleEraser()" title="Borrador"><i class="fas fa-eraser"></i></button>
                </div>
                <div class="img-ed-sizes">
                    <span class="img-ed-size-dot ${e.brush === 'sm' ? 'active' : ''}" style="width:10px;height:10px;" onclick="ChatDetailPage._imgEdSetBrush('sm')"></span>
                    <span class="img-ed-size-dot ${e.brush === 'md' ? 'active' : ''}" style="width:16px;height:16px;" onclick="ChatDetailPage._imgEdSetBrush('md')"></span>
                    <span class="img-ed-size-dot ${e.brush === 'lg' ? 'active' : ''}" style="width:24px;height:24px;" onclick="ChatDetailPage._imgEdSetBrush('lg')"></span>
                </div>`;
        } else if (e.tool === 'text') {
            bar.innerHTML = `<div class="img-ed-swatches">${swatches('_imgEdColor')}</div>
                <div style="color:#ccc; font-size:0.78em;">Tocá la imagen para escribir</div>`;
        } else if (e.tool === 'sticker') {
            bar.innerHTML = `<div class="img-ed-sticker-grid">${IMG_ED_STICKERS.map(s => `<span onclick="ChatDetailPage._imgEdPickSticker('${s}')">${s}</span>`).join('')}</div>`;
        } else if (e.tool === 'crop') {
            bar.innerHTML = `<div class="img-ed-crop-actions">
                <button class="img-ed-pill-btn" onclick="ChatDetailPage._imgEdRotate()"><i class="fas fa-redo"></i> Rotar</button>
                <button class="img-ed-pill-btn primary" onclick="ChatDetailPage._imgEdApplyCrop()"><i class="fas fa-check"></i> Aplicar recorte</button>
            </div>`;
        }
    }
    // Cambiar color/grosor/borrador NO debe "hornear" un texto/sticker en edición — solo repinta.
    function _imgEdColor(c) { if (!_imgEd) return; _imgEd.color = c; _imgEdRestylePending(); _imgEdRenderBottomBar(); }
    function _imgEdSetBrush(sz) { if (!_imgEd) return; _imgEd.brush = sz; _imgEdRenderBottomBar(); }
    function _imgEdToggleEraser() { if (!_imgEd) return; _imgEd.eraser = !_imgEd.eraser; _imgEdRenderBottomBar(); }

    function _imgEdCancel() { document.getElementById('img-editor-overlay')?.remove(); _imgEd = null; }
    function _imgEdDone() {
        const e = _imgEd; if (!e) { _imgEdCancel(); return; }
        _imgEdCommitPending();
        e.canvas.toBlob((blob) => {
            if (blob && _pendingAttach && _pendingAttach.files[e.idx]) {
                const orig = _pendingAttach.files[e.idx];
                _pendingAttach.files[e.idx] = new File([blob], (orig.name || 'imagen').replace(/\.\w+$/, '') + '-editada.jpg', { type: 'image/jpeg' });
            }
            document.getElementById('img-editor-overlay')?.remove();
            _imgEd = null;
            if (_pendingAttach) _showAttachPreview(_pendingAttach.files, _pendingAttach.chatId); // re-pintar preview con la editada
        }, 'image/jpeg', 0.9);
    }

    // --- Texto / stickers: elemento flotante draggable sobre el canvas, se "hornea" al confirmar ---
    function _imgEdAddText(screenX, screenY) {
        _imgEdCommitPending();
        const e = _imgEd;
        const wrap = document.getElementById('img-ed-canvas-wrap');
        const el = document.createElement('div');
        el.className = 'img-ed-floating';
        el.style.left = screenX + 'px'; el.style.top = screenY + 'px';
        el.innerHTML = `<div class="img-ed-floating-text" contenteditable="true" style="color:${e.color};"></div>
            <div class="img-ed-floating-del" onclick="ChatDetailPage._imgEdDiscardPending()"><i class="fas fa-times"></i></div>`;
        wrap.appendChild(el);
        const textEl = el.querySelector('.img-ed-floating-text');
        setTimeout(() => textEl.focus(), 50);
        _imgEdMakeDraggable(el, textEl);
        e.pending = { type: 'text', el, textEl, screenX, screenY };
    }
    function _imgEdPickSticker(emoji) {
        _imgEdCommitPending();
        const e = _imgEd;
        const wrap = document.getElementById('img-ed-canvas-wrap');
        const wrapR = wrap.getBoundingClientRect();
        const screenX = wrapR.width / 2, screenY = wrapR.height / 2;
        const el = document.createElement('div');
        el.className = 'img-ed-floating';
        el.style.left = screenX + 'px'; el.style.top = screenY + 'px';
        el.innerHTML = `<div class="img-ed-floating-sticker">${emoji}</div>
            <div class="img-ed-floating-del" onclick="ChatDetailPage._imgEdDiscardPending()"><i class="fas fa-times"></i></div>`;
        wrap.appendChild(el);
        _imgEdMakeDraggable(el, el);
        e.pending = { type: 'sticker', el, emoji, screenX, screenY, fontSize: 56 };
    }
    function _imgEdRestylePending() {
        const e = _imgEd; if (!e || !e.pending || e.pending.type !== 'text') return;
        e.pending.textEl.style.color = e.color;
    }
    function _imgEdMakeDraggable(el, handle) {
        let dragging = false, offX = 0, offY = 0;
        el.addEventListener('pointerdown', (evt) => {
            if (handle.isContentEditable && document.activeElement === handle) return; // dejar escribir/poner cursor
            dragging = true;
            const r = el.getBoundingClientRect();
            offX = evt.clientX - r.left; offY = evt.clientY - r.top;
            el.setPointerCapture?.(evt.pointerId);
        });
        el.addEventListener('pointermove', (evt) => {
            if (!dragging) return;
            const wrapR = document.getElementById('img-ed-canvas-wrap').getBoundingClientRect();
            const x = evt.clientX - wrapR.left - offX + el.offsetWidth / 2;
            const y = evt.clientY - wrapR.top - offY + el.offsetHeight / 2;
            el.style.left = x + 'px'; el.style.top = y + 'px';
            if (_imgEd && _imgEd.pending) { _imgEd.pending.screenX = x; _imgEd.pending.screenY = y; }
        });
        const end = () => { dragging = false; };
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
    }
    function _imgEdCommitPending() {
        const e = _imgEd; if (!e || !e.pending) return;
        const p = e.pending;
        const wrap = document.getElementById('img-ed-canvas-wrap');
        const wrapR = wrap.getBoundingClientRect();
        const canvasR = e.canvas.getBoundingClientRect();
        const canvasOffX = canvasR.left - wrapR.left, canvasOffY = canvasR.top - wrapR.top;
        const scaleX = e.canvas.width / canvasR.width, scaleY = e.canvas.height / canvasR.height;
        const cx = (p.screenX - canvasOffX) * scaleX, cy = (p.screenY - canvasOffY) * scaleY;
        if (p.type === 'text') {
            const txt = (p.textEl.textContent || '').trim();
            if (txt) {
                const lh = Math.round(38 * scaleX);
                e.ctx.font = `700 ${Math.round(34 * scaleX)}px sans-serif`;
                e.ctx.fillStyle = e.color;
                e.ctx.textAlign = 'center'; e.ctx.textBaseline = 'middle';
                e.ctx.shadowColor = 'rgba(0,0,0,0.45)'; e.ctx.shadowBlur = 4;
                const lines = txt.split('\n');
                lines.forEach((line, i) => e.ctx.fillText(line, cx, cy + (i - (lines.length - 1) / 2) * lh));
                e.ctx.shadowBlur = 0;
                _imgEdPushHistory();
            }
        } else if (p.type === 'sticker') {
            e.ctx.font = `${Math.round(p.fontSize * scaleX)}px sans-serif`;
            e.ctx.textAlign = 'center'; e.ctx.textBaseline = 'middle';
            e.ctx.fillText(p.emoji, cx, cy);
            _imgEdPushHistory();
        }
        p.el.remove();
        e.pending = null;
    }
    function _imgEdDiscardPending() {
        const e = _imgEd; if (!e || !e.pending) return;
        e.pending.el.remove();
        e.pending = null;
    }

    // --- Recortar / rotar ---
    function _imgEdInitCrop() {
        const e = _imgEd;
        const canvasR = e.canvas.getBoundingClientRect();
        const wrapR = document.getElementById('img-ed-canvas-wrap').getBoundingClientRect();
        const cLeft = canvasR.left - wrapR.left, cTop = canvasR.top - wrapR.top;
        const pad = Math.min(canvasR.width, canvasR.height) * 0.1;
        e.crop = { x: cLeft + pad, y: cTop + pad, w: canvasR.width - pad * 2, h: canvasR.height - pad * 2, cLeft, cTop, cw: canvasR.width, ch: canvasR.height };
        _imgEdBuildCropUI();
    }
    function _imgEdClearCropUI() {
        document.querySelectorAll('.img-ed-crop-mask, .img-ed-crop-rect, .img-ed-crop-handle').forEach(el => el.remove());
        _imgEdCropEls = null;
    }
    // 🛡️ v2026-08-27 (reporte real: "el recuadro de recortar no deja moverlo arrastado completo"):
    // causa real encontrada — ANTES cada pointermove del arrastre llamaba a la función que BORRA
    // Y RECREA todos los divs del recorte. Al remover del DOM el elemento que tenía la captura del
    // puntero (setPointerCapture), el navegador la pierde a mitad del gesto (se dispara
    // lostpointercapture) — por eso el arrastre se sentía roto/incompleto. Ahora los elementos se
    // crean UNA sola vez (_imgEdBuildCropUI) y durante el arrastre solo se les actualiza el estilo
    // en el lugar (_imgEdUpdateCropUI), sin tocar el DOM — la captura del puntero nunca se pierde.
    let _imgEdCropEls = null;
    function _imgEdBuildCropUI() {
        _imgEdClearCropUI();
        const wrap = document.getElementById('img-ed-canvas-wrap');
        const mk = (cls) => { const d = document.createElement('div'); d.className = cls; wrap.appendChild(d); return d; };
        const top = mk('img-ed-crop-mask'), bot = mk('img-ed-crop-mask'), left = mk('img-ed-crop-mask'), right = mk('img-ed-crop-mask');
        const rect = mk('img-ed-crop-rect');
        const handles = {};
        ['nw', 'ne', 'sw', 'se'].forEach(corner => {
            const hd = document.createElement('div');
            hd.className = 'img-ed-crop-handle';
            wrap.appendChild(hd);
            handles[corner] = hd;
            _imgEdBindCropHandle(hd, corner);
        });
        _imgEdCropEls = { top, bot, left, right, rect, handles };
        _imgEdBindCropDrag(rect);
        _imgEdUpdateCropUI();
    }
    function _imgEdUpdateCropUI() {
        const c = _imgEd && _imgEd.crop; const els = _imgEdCropEls;
        if (!c || !els) return;
        els.top.style.cssText = `left:${c.cLeft}px; top:${c.cTop}px; width:${c.cw}px; height:${Math.max(0, c.y - c.cTop)}px;`;
        els.bot.style.cssText = `left:${c.cLeft}px; top:${c.y + c.h}px; width:${c.cw}px; height:${Math.max(0, (c.cTop + c.ch) - (c.y + c.h))}px;`;
        els.left.style.cssText = `left:${c.cLeft}px; top:${c.y}px; width:${Math.max(0, c.x - c.cLeft)}px; height:${c.h}px;`;
        els.right.style.cssText = `left:${c.x + c.w}px; top:${c.y}px; width:${Math.max(0, (c.cLeft + c.cw) - (c.x + c.w))}px; height:${c.h}px;`;
        els.rect.style.cssText = `left:${c.x}px; top:${c.y}px; width:${c.w}px; height:${c.h}px;`;
        els.handles.nw.style.left = c.x + 'px'; els.handles.nw.style.top = c.y + 'px';
        els.handles.ne.style.left = (c.x + c.w) + 'px'; els.handles.ne.style.top = c.y + 'px';
        els.handles.sw.style.left = c.x + 'px'; els.handles.sw.style.top = (c.y + c.h) + 'px';
        els.handles.se.style.left = (c.x + c.w) + 'px'; els.handles.se.style.top = (c.y + c.h) + 'px';
    }
    function _imgEdBindCropHandle(handle, corner) {
        let dragging = false;
        const MIN = 40;
        handle.addEventListener('pointerdown', (evt) => { dragging = true; handle.setPointerCapture?.(evt.pointerId); evt.stopPropagation(); });
        handle.addEventListener('pointermove', (evt) => {
            if (!dragging) return;
            const c = _imgEd.crop;
            const wrapR = document.getElementById('img-ed-canvas-wrap').getBoundingClientRect();
            const px = evt.clientX - wrapR.left, py = evt.clientY - wrapR.top;
            if (corner.includes('w')) { const nx = Math.min(px, c.x + c.w - MIN); c.w += c.x - nx; c.x = Math.max(c.cLeft, nx); }
            else { c.w = Math.max(MIN, Math.min(px, c.cLeft + c.cw) - c.x); }
            if (corner.includes('n')) { const ny = Math.min(py, c.y + c.h - MIN); c.h += c.y - ny; c.y = Math.max(c.cTop, ny); }
            else { c.h = Math.max(MIN, Math.min(py, c.cTop + c.ch) - c.y); }
            _imgEdUpdateCropUI();
        });
        const end = () => { dragging = false; };
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
    }
    function _imgEdBindCropDrag(rect) {
        let dragging = false, startX = 0, startY = 0, origX = 0, origY = 0;
        rect.addEventListener('pointerdown', (evt) => {
            dragging = true; rect.setPointerCapture?.(evt.pointerId);
            startX = evt.clientX; startY = evt.clientY;
            origX = _imgEd.crop.x; origY = _imgEd.crop.y;
        });
        rect.addEventListener('pointermove', (evt) => {
            if (!dragging) return;
            const c = _imgEd.crop;
            let nx = origX + (evt.clientX - startX), ny = origY + (evt.clientY - startY);
            nx = Math.max(c.cLeft, Math.min(nx, c.cLeft + c.cw - c.w));
            ny = Math.max(c.cTop, Math.min(ny, c.cTop + c.ch - c.h));
            c.x = nx; c.y = ny;
            _imgEdUpdateCropUI();
        });
        const end = () => { dragging = false; };
        rect.addEventListener('pointerup', end);
        rect.addEventListener('pointercancel', end);
    }
    function _imgEdApplyCrop() {
        const e = _imgEd; const c = e && e.crop; if (!e || !c) return;
        const scaleX = e.canvas.width / c.cw, scaleY = e.canvas.height / c.ch;
        const sx = (c.x - c.cLeft) * scaleX, sy = (c.y - c.cTop) * scaleY;
        const sw = c.w * scaleX, sh = c.h * scaleY;
        const tmp = document.createElement('canvas');
        tmp.width = Math.max(1, Math.round(sw)); tmp.height = Math.max(1, Math.round(sh));
        tmp.getContext('2d').drawImage(e.canvas, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height);
        e.canvas.width = tmp.width; e.canvas.height = tmp.height; e.w = tmp.width; e.h = tmp.height;
        e.ctx.clearRect(0, 0, tmp.width, tmp.height);
        e.ctx.drawImage(tmp, 0, 0);
        e.crop = null;
        _imgEdClearCropUI();
        _imgEdPushHistory();
        showToast('Imagen recortada', 'success');
    }
    function _imgEdRotate() {
        const e = _imgEd; if (!e) return;
        const tmp = document.createElement('canvas');
        tmp.width = e.canvas.height; tmp.height = e.canvas.width;
        const tctx = tmp.getContext('2d');
        tctx.translate(tmp.width / 2, tmp.height / 2);
        tctx.rotate(Math.PI / 2);
        tctx.drawImage(e.canvas, -e.canvas.width / 2, -e.canvas.height / 2);
        e.canvas.width = tmp.width; e.canvas.height = tmp.height; e.w = tmp.width; e.h = tmp.height;
        e.ctx.clearRect(0, 0, tmp.width, tmp.height);
        e.ctx.drawImage(tmp, 0, 0);
        _imgEdPushHistory();
        if (e.tool === 'crop') _imgEdInitCrop(); // recalcular el rectángulo tras rotar
    }
    function _crmNum() { return (currentChatId || '').replace('@c.us', '').replace('@lid', '').replace('@s.whatsapp.net', ''); }

    // --- Notas internas ---
    async function openNotas() {
        let notas = [];
        try { const r = await API.get(`/api/chats/${encodeURIComponent(currentChatId)}/notas`); if (r?.success) notas = r.notas || []; } catch (e) {}
        const items = notas.length ? notas.map(n => `
            <div style="border-bottom:1px solid #eee; padding:8px 0; display:flex; justify-content:space-between; gap:8px;">
                <div style="min-width:0;">
                    <div style="font-size:0.9em; color:#222; white-space:pre-wrap; word-break:break-word;">${escapeHtml(n.nota)}</div>
                    <div style="font-size:0.72em; color:#999;">${escapeHtml(n.autor_nombre || 'Asesor')} · ${escapeHtml(new Date(n.created_at).toLocaleString('es-CO'))}</div>
                </div>
                <button onclick="ChatDetailPage._crmDelNota(${n.id})" style="border:none; background:none; color:#c00; cursor:pointer; flex:0 0 auto;"><i class="fas fa-trash"></i></button>
            </div>`).join('') : '<div style="color:#999; padding:12px 0;">Sin notas todavía.</div>';
        _crmOverlay(`
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <strong><i class="fas fa-sticky-note" style="color:#f0ad4e;"></i> Notas internas</strong>
                <button onclick="ChatDetailPage._crmClose()" style="border:none; background:none; font-size:1.2em; cursor:pointer;">✕</button>
            </div>
            <div style="max-height:42vh; overflow:auto;">${items}</div>
            <div style="display:flex; gap:8px; margin-top:12px;">
                <input id="crm-nota-input" placeholder="Escribí una nota interna…" style="flex:1; padding:10px; border:1px solid #ccc; border-radius:8px;" onkeydown="if(event.key==='Enter')ChatDetailPage._crmAddNota()">
                <button onclick="ChatDetailPage._crmAddNota()" style="border:none; background:var(--primary,#0066cc); color:#fff; border-radius:8px; padding:0 14px; cursor:pointer;"><i class="fas fa-plus"></i></button>
            </div>`);
    }
    async function _crmAddNota() {
        const txt = (document.getElementById('crm-nota-input')?.value || '').trim();
        if (!txt) return;
        try { await API.post(`/api/chats/${encodeURIComponent(currentChatId)}/notas`, { nota: txt }); openNotas(); }
        catch (e) { showToast('No se pudo guardar la nota', 'error'); }
    }
    async function _crmDelNota(id) {
        try { await API.del(`/api/chats/notas/${id}`); openNotas(); }
        catch (e) { showToast('No se pudo borrar', 'error'); }
    }

    // --- Asignación a asesor ("yo lo tomo") ---
    async function openAsignar() {
        let asig = null;
        try { const r = await API.get('/api/chats/asignaciones'); if (r?.success) asig = (r.asignaciones || {})[_crmNum()]; } catch (e) {}
        const actual = asig?.asesor_nombre
            ? `<div style="margin:8px 0; color:#222;">Atendido por: <strong>${escapeHtml(asig.asesor_nombre)}</strong></div>`
            : '<div style="margin:8px 0; color:#999;">Nadie lo tomó todavía.</div>';
        _crmOverlay(`
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <strong><i class="fas fa-user-check" style="color:#0066cc;"></i> Asignación</strong>
                <button onclick="ChatDetailPage._crmClose()" style="border:none; background:none; font-size:1.2em; cursor:pointer;">✕</button>
            </div>
            ${actual}
            <div style="display:flex; gap:8px; margin-top:12px;">
                <button onclick="ChatDetailPage._crmTomar()" style="flex:2; border:none; background:var(--primary,#0066cc); color:#fff; border-radius:8px; padding:12px; font-weight:700; cursor:pointer;"><i class="fas fa-hand-paper"></i> Yo lo tomo</button>
                <button onclick="ChatDetailPage._crmLiberar()" style="flex:1; border:none; background:#eee; color:#333; border-radius:8px; padding:12px; cursor:pointer;">Liberar</button>
            </div>`);
    }
    async function _crmTomar() {
        try { await API.post(`/api/chats/${encodeURIComponent(currentChatId)}/asignar`, {}); showToast('Chat asignado a vos', 'success'); _crmClose(); try { ChatsPage.refresh?.(); } catch (e) {} }
        catch (e) { showToast('No se pudo asignar', 'error'); }
    }
    async function _crmLiberar() {
        try { await API.del(`/api/chats/${encodeURIComponent(currentChatId)}/asignar`); showToast('Chat liberado'); _crmClose(); try { ChatsPage.refresh?.(); } catch (e) {} }
        catch (e) { showToast('No se pudo liberar', 'error'); }
    }

    // --- Etiquetas (catálogo reusable, igual que "Administrar etiquetas" de WhatsApp Business) ---
    const _ETQ_COLORES = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#64748b', '#0f766e'];
    let _etqCatalogo = [];
    async function openEtiquetas() {
        let etqs = [];
        try { const r = await API.get(`/api/chats/${encodeURIComponent(currentChatId)}/etiquetas`); if (r?.success) etqs = r.etiquetas || []; } catch (e) {}
        try { const rc = await API.get('/api/etiquetas/catalogo'); if (rc?.success) _etqCatalogo = rc.etiquetas || []; } catch (e) { _etqCatalogo = []; }
        const appliedIds = new Set(etqs.map(e => e.catalogo_id).filter(Boolean));
        const chips = etqs.length ? etqs.map(e => `
            <span style="display:inline-flex; align-items:center; gap:6px; background:${escapeHtml(e.color || '#888')}; color:#fff; border-radius:14px; padding:4px 10px; font-size:0.8em; margin:3px;">
                ${escapeHtml(e.etiqueta)} <i class="fas fa-times" style="cursor:pointer;" onclick="ChatDetailPage._crmDelEtiqueta(${e.id})"></i>
            </span>`).join('') : '<div style="color:#999; padding:8px 0;">Sin etiquetas en este chat.</div>';
        const catalogChips = _etqCatalogo.length ? _etqCatalogo.map(c => {
            const applied = appliedIds.has(c.id);
            return `<button onclick="ChatDetailPage._crmToggleEtiquetaCatalogo(${c.id})" style="border:${applied ? '2px solid #333' : 'none'}; background:${escapeHtml(c.color)}; color:#fff; border-radius:14px; padding:6px 12px; font-size:0.8em; margin:3px; cursor:pointer; opacity:${applied ? '0.6' : '1'};">${applied ? '✓ ' : '+ '}${escapeHtml(c.nombre)}</button>`;
        }).join('') : '<div style="color:#999; padding:8px 0; font-size:0.85em;">No hay etiquetas creadas todavía.</div>';
        _crmOverlay(`
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <strong><i class="fas fa-tags" style="color:#8b5cf6;"></i> Etiquetas</strong>
                <button onclick="ChatDetailPage._crmClose()" style="border:none; background:none; font-size:1.2em; cursor:pointer;">✕</button>
            </div>
            <div style="margin-bottom:12px;">${chips}</div>
            <div style="font-size:0.8em; color:#666; margin-bottom:6px;">Etiquetas disponibles:</div>
            <div style="margin-bottom:14px;">${catalogChips}</div>
            <button onclick="ChatDetailPage.openAdministrarEtiquetas()" style="width:100%; border:1px dashed #8b5cf6; background:none; color:#8b5cf6; border-radius:10px; padding:10px; font-size:0.85em; cursor:pointer;">
                <i class="fas fa-cog"></i> Administrar etiquetas
            </button>`);
    }
    async function _crmToggleEtiquetaCatalogo(catalogoId) {
        try {
            const r = await API.get(`/api/chats/${encodeURIComponent(currentChatId)}/etiquetas`);
            const actual = (r?.etiquetas || []).find(e => e.catalogo_id === catalogoId);
            if (actual) await API.del(`/api/chats/etiquetas/${actual.id}`);
            else await API.post(`/api/chats/${encodeURIComponent(currentChatId)}/etiquetas`, { catalogo_id: catalogoId });
            openEtiquetas();
            try { ChatsPage.refresh?.(); } catch (e) {}
        } catch (e) { showToast('No se pudo actualizar la etiqueta', 'error'); }
    }
    async function _crmDelEtiqueta(id) {
        try { await API.del(`/api/chats/etiquetas/${id}`); openEtiquetas(); try { ChatsPage.refresh?.(); } catch (e) {} }
        catch (e) { showToast('No se pudo quitar', 'error'); }
    }

    // --- Administrar etiquetas (crear / renombrar / recolorear / borrar del catálogo) ---
    let _etqAdminColorSel = _ETQ_COLORES[0];
    async function openAdministrarEtiquetas() {
        try { const rc = await API.get('/api/etiquetas/catalogo'); if (rc?.success) _etqCatalogo = rc.etiquetas || []; } catch (e) { _etqCatalogo = []; }
        _renderAdministrarEtiquetas();
    }
    function _renderAdministrarEtiquetas() {
        const rows = _etqCatalogo.length ? _etqCatalogo.map((c, idx) => `
            <div style="display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid #f0f0f0;">
                <span style="width:16px; height:16px; border-radius:50%; background:${escapeHtml(c.color)}; flex-shrink:0;"></span>
                <span style="flex:1; font-size:0.9em;">${escapeHtml(c.nombre)}</span>
                <i class="fas fa-pen" style="cursor:pointer; color:#666; padding:6px;" onclick="ChatDetailPage._etqAdminEdit(${idx})"></i>
                <i class="fas fa-trash" style="cursor:pointer; color:#ef4444; padding:6px;" onclick="ChatDetailPage._etqAdminDelete(${idx})"></i>
            </div>`).join('') : '<div style="color:#999; padding:10px 0;">No hay etiquetas creadas todavía.</div>';
        const swatches = _ETQ_COLORES.map(col => `
            <span onclick="ChatDetailPage._etqAdminPickColor('${col}')" style="display:inline-block; width:22px; height:22px; border-radius:50%; background:${col}; margin:3px; cursor:pointer; border:${col === _etqAdminColorSel ? '3px solid #333' : '2px solid transparent'};"></span>`).join('');
        _crmOverlay(`
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <strong><i class="fas fa-cog" style="color:#8b5cf6;"></i> Administrar etiquetas</strong>
                <button onclick="ChatDetailPage._crmClose()" style="border:none; background:none; font-size:1.2em; cursor:pointer;">✕</button>
            </div>
            <div style="margin-bottom:14px;">${rows}</div>
            <div style="font-size:0.8em; color:#666; margin-bottom:6px;">Nueva etiqueta:</div>
            <input id="etq-admin-nombre" type="text" placeholder="Nombre" maxlength="60" style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #ddd; border-radius:8px; font-size:0.9em; margin-bottom:8px;">
            <div style="margin-bottom:10px;">${swatches}</div>
            <button onclick="ChatDetailPage._etqAdminCrear()" style="width:100%; border:none; background:#8b5cf6; color:#fff; border-radius:10px; padding:10px; font-size:0.9em; cursor:pointer;">
                <i class="fas fa-plus"></i> Crear etiqueta
            </button>
            <button onclick="ChatDetailPage.openEtiquetas()" style="width:100%; border:none; background:none; color:#666; padding:10px; font-size:0.85em; cursor:pointer; margin-top:4px;">
                ← Volver
            </button>`);
    }
    function _etqAdminPickColor(color) { _etqAdminColorSel = color; _renderAdministrarEtiquetas(); }
    async function _etqAdminCrear() {
        const input = document.getElementById('etq-admin-nombre');
        const nombre = (input?.value || '').trim();
        if (!nombre) { showToast('Escribí un nombre para la etiqueta', 'error'); return; }
        try {
            await API.post('/api/etiquetas/catalogo', { nombre, color: _etqAdminColorSel });
            _etqAdminColorSel = _ETQ_COLORES[0];
            await openAdministrarEtiquetas();
            try { ChatsPage.refresh?.(); } catch (e) {}
        } catch (e) { showToast(e?.message || 'No se pudo crear la etiqueta', 'error'); }
    }
    async function _etqAdminEdit(idx) {
        const c = _etqCatalogo[idx];
        if (!c) return;
        const nuevoNombre = prompt('Nuevo nombre para la etiqueta:', c.nombre);
        if (nuevoNombre === null) return;
        const nombre = nuevoNombre.trim();
        if (!nombre) { showToast('El nombre no puede quedar vacío', 'error'); return; }
        try {
            await API.put(`/api/etiquetas/catalogo/${c.id}`, { nombre, color: c.color });
            await openAdministrarEtiquetas();
            try { ChatsPage.refresh?.(); } catch (e) {}
        } catch (e) { showToast('No se pudo actualizar', 'error'); }
    }
    async function _etqAdminDelete(idx) {
        const c = _etqCatalogo[idx];
        if (!c) return;
        if (!confirm(`¿Borrar la etiqueta "${c.nombre}"? Se quitará de todos los chats que la tengan.`)) return;
        try {
            await API.del(`/api/etiquetas/catalogo/${c.id}`);
            await openAdministrarEtiquetas();
            try { ChatsPage.refresh?.(); } catch (e) {}
        } catch (e) { showToast('No se pudo borrar', 'error'); }
    }

    return {
        show, back, sendMessage, cancelReply, refresh, openTemplates, desbloquearChat,
        tomarChat, liberarChatAsig, toggleTomarChat, verFotoFull,
        toggleSearch, searchPrev, searchNext, toggleAttach, toggleEmoji, showHeaderMenu, showContactInfo, onNewMessage, onMessageEdited,
        // 🆕 ACKs estilo WhatsApp (✓/✓✓/✓✓ azul)
        onMessageAckUpdate,
        // Grabación de audio
        onMicPress, onMicRelease, onSendOrMicTap, cancelRecording,
        openLightbox, scrollToQuoted, abrirArchivo, descargarArchivo,
        abrirVisorDocumento, _cerrarVisorDocumento, precargarChat,
        // 🆕 v2026-07: reintentar envío fallido + preview de adjuntos
        retryMessage, _confirmAttachPreview, _cancelAttachPreview,
        // 🆕 v2026-07: CRM (notas, asignación, etiquetas)
        openNotas, _crmAddNota, _crmDelNota, openAsignar, _crmTomar, _crmLiberar,
        openEtiquetas, _crmToggleEtiquetaCatalogo, _crmDelEtiqueta, _crmClose,
        openAdministrarEtiquetas, _etqAdminPickColor, _etqAdminCrear, _etqAdminEdit, _etqAdminDelete,
        // 🆕 v2026-07: velocidad de nota de voz
        cycleAudioSpeed,
        // 🆕 v2026-08-27: notas de voz (waveform) y video (miniatura + reproductor) estilo WhatsApp
        toggleAudio, seekAudio, _onAudioTick, _onAudioEnded, _setVideoDuration, openVideoFull, transcribirAudioMsg,
        // 🆕 v2026-08-27: editor de imagen estilo WhatsApp (recortar/rotar, dibujar, texto, stickers)
        _editImage, _imgEdCancel, _imgEdColor, _imgEdUndo, _imgEdDone, _imgEdSetTool,
        _imgEdSetBrush, _imgEdToggleEraser, _imgEdPickSticker, _imgEdDiscardPending,
        _imgEdRotate, _imgEdApplyCrop,
        // 🆕 v2026-07: "escribiendo…" del cliente + reacción entrante
        onTyping, onReaction
    };
})();

// Registrar la ruta `chat/:chatId`
if (typeof Router !== 'undefined') {
    Router.register('chat', (params) => ChatDetailPage.show(params));
}
