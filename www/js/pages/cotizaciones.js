// Página: Cotizaciones y Facturas (app admin) — réplica del panel web public/cotizaciones.html
// Mismo patrón que verificacion-pagos.js / chats.js (IIFE + Router.register + ensurePage).
//
// Endpoints backend (ya existentes; requireAuth + requireCotizaciones → permiso ver_cotizaciones):
//   GET  /api/cotizaciones?tipo=&q=            → historial (listar/filtrar/buscar)
//   GET  /api/cotizaciones/:id                 → detalle (duplicar / convertir a factura)
//   POST /api/cotizaciones                     → crear {tipo, cliente_nombre, cliente_contacto, asunto, datos, total}
//   POST /api/cotizaciones/:id/anular          → anular (no borra)
//   GET  /api/cotizaciones/:id/pdf?token=&download=1  → PDF protegido (abrir/descargar)
//        (requireAuth acepta token por query → se abre con window.open usando APP_CONFIG.getApiUrl)
//
// Las calculadoras CCTV y Solar replican EXACTAMENTE la lógica del panel web.
const CotizacionesPage = (function () {
    let _tab = 'internet';   // internet | cctv | solar | factura | historial
    let _rendered = false;   // los forms (con asistentes) se montan una sola vez

    // ---------- utilidades ----------
    const $ = id => document.getElementById(id);
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    function fmt(n) { return '$ ' + (Math.round((+n || 0) * 100) / 100).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function toast(msg, tipo) {
        const t = document.getElementById('toast'); if (!t) { alert(msg); return; }
        t.textContent = msg; t.className = 'toast show' + (tipo === 'error' ? ' error' : tipo === 'success' ? ' success' : '');
        clearTimeout(t._to); t._to = setTimeout(() => { t.className = 'toast'; }, 3500);
    }
    function pdfUrl(id, download) {
        const tk = API.getToken() || '';
        return APP_CONFIG.getApiUrl('/api/cotizaciones/' + id + '/pdf?token=' + encodeURIComponent(tk) + (download ? '&download=1' : ''));
    }
    const badgeTipo = { internet: 'sn-badge--info', cctv: 'sn-badge--info', solar: 'sn-badge--warn', factura: 'sn-badge--ok' };

    // ---------- estilos scoped (tokens del sistema de diseño, sin hex crudos) ----------
    function ensureStyle() {
        if (document.getElementById('cot-style')) return;
        const st = document.createElement('style');
        st.id = 'cot-style';
        st.textContent = `
          #page-cotizaciones { padding: 0 0 var(--sn-space-10); }
          #page-cotizaciones .cot-wrap { padding: var(--sn-space-4); max-width: 960px; margin: 0 auto; }
          #page-cotizaciones .cot-tabs { display: flex; gap: var(--sn-space-2); overflow-x: auto; padding: var(--sn-space-3) var(--sn-space-4); position: sticky; top: 0; z-index: 5; background: var(--sn-surface); border-bottom: 1px solid var(--sn-border-soft); }
          #page-cotizaciones .cot-tabs .sn-btn { white-space: nowrap; }
          #page-cotizaciones label { display: block; font-size: var(--sn-text-xs); font-weight: var(--sn-weight-semibold); color: var(--sn-text-secondary); margin: var(--sn-space-3) 0 var(--sn-space-1); }
          #page-cotizaciones input, #page-cotizaciones select, #page-cotizaciones textarea {
            width: 100%; padding: .55rem .7rem; font-size: var(--sn-text-sm); font-family: var(--sn-font-sans);
            color: var(--sn-text-primary); background: var(--sn-surface);
            border: 1px solid var(--sn-border); border-radius: var(--sn-radius-md); box-sizing: border-box;
          }
          #page-cotizaciones input:focus, #page-cotizaciones select:focus, #page-cotizaciones textarea:focus { outline: none; border-color: var(--sn-border-focus); }
          #page-cotizaciones textarea { min-height: 60px; resize: vertical; }
          #page-cotizaciones .cot-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sn-space-3); }
          @media (max-width: 640px) { #page-cotizaciones .cot-row2 { grid-template-columns: 1fr; } }
          #page-cotizaciones table.cot-items { width: 100%; border-collapse: collapse; margin-top: var(--sn-space-2); }
          #page-cotizaciones table.cot-items th { background: var(--sn-surface-2); color: var(--sn-text-secondary); font-size: var(--sn-text-xs); text-transform: uppercase; padding: var(--sn-space-2); }
          #page-cotizaciones table.cot-items td { border: 1px solid var(--sn-border-soft); padding: 2px; }
          #page-cotizaciones table.cot-items td input { border: none; border-radius: 0; padding: .4rem; }
          #page-cotizaciones .cot-tot { margin: var(--sn-space-3) 0 0 auto; max-width: 320px; background: var(--sn-surface-2); border: 1px solid var(--sn-border-soft); border-radius: var(--sn-radius-lg); padding: var(--sn-space-2) var(--sn-space-3); }
          #page-cotizaciones .cot-tot-row { display: flex; align-items: center; justify-content: space-between; padding: 3px 0; font-size: var(--sn-text-sm); color: var(--sn-text-secondary); }
          #page-cotizaciones .cot-tot-row input { width: 84px; text-align: right; }
          #page-cotizaciones .cot-tot-row.total { border-top: 1px dashed var(--sn-border); margin-top: 4px; padding-top: var(--sn-space-2); font-weight: var(--sn-weight-bold); color: var(--brand); }
          #page-cotizaciones .cot-asist { border: 1px solid var(--sn-border-soft); border-radius: var(--sn-radius-lg); margin-bottom: var(--sn-space-4); overflow: hidden; }
          #page-cotizaciones .cot-asist-head { background: var(--brand-grad); color: var(--sn-on-primary, #fff); padding: var(--sn-space-3) var(--sn-space-4); font-weight: var(--sn-weight-semibold); display: flex; align-items: center; gap: var(--sn-space-2); font-size: var(--sn-text-sm); }
          #page-cotizaciones .cot-asist-head .cot-toggle { margin-left: auto; background: transparent; border: none; color: inherit; font-size: 1.1rem; cursor: pointer; min-height: auto; padding: 0 6px; }
          #page-cotizaciones .cot-asist-body { padding: var(--sn-space-3) var(--sn-space-4); }
          #page-cotizaciones .cot-asist.col .cot-asist-body { display: none; }
          #page-cotizaciones .cot-asist-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--sn-space-3); margin-bottom: var(--sn-space-3); }
          #page-cotizaciones .cot-asist-grid label { margin: 0 0 3px; }
          #page-cotizaciones .cot-help { margin: 0 0 var(--sn-space-3); color: var(--sn-text-tertiary); font-size: var(--sn-text-xs); }
          #page-cotizaciones .cot-resumen { margin-top: var(--sn-space-3); font-size: var(--sn-text-xs); color: var(--sn-text-secondary); background: var(--sn-surface); border: 1px dashed var(--sn-border); border-radius: var(--sn-radius-md); padding: var(--sn-space-2) var(--sn-space-3); }
          #page-cotizaciones .cot-resumen:empty { display: none; }
          #page-cotizaciones .cot-actions { display: flex; gap: var(--sn-space-3); margin-top: var(--sn-space-4); flex-wrap: wrap; align-items: center; }
          #page-cotizaciones .cot-muted { color: var(--sn-text-tertiary); font-size: var(--sn-text-xs); }
          #page-cotizaciones .cot-del { background: var(--sn-danger); color: #fff; border: none; border-radius: var(--sn-radius-sm); padding: .4rem .6rem; cursor: pointer; }
          #page-cotizaciones .cot-hist-toolbar { display: flex; gap: var(--sn-space-2); flex-wrap: wrap; margin-bottom: var(--sn-space-3); }
          #page-cotizaciones .cot-hist-toolbar select, #page-cotizaciones .cot-hist-toolbar input { max-width: 260px; }
          #page-cotizaciones .cot-hist-card { display: flex; justify-content: space-between; gap: var(--sn-space-3); }
          #page-cotizaciones .cot-hist-acc { display: flex; gap: var(--sn-space-2); flex-wrap: wrap; margin-top: var(--sn-space-2); }
          #page-cotizaciones .cot-hist-acc .sn-btn { text-decoration: none; }
          #page-cotizaciones .hidden { display: none; }
        `;
        document.head.appendChild(st);
    }

    // ---------- page container ----------
    function ensurePage() {
        document.body.classList.remove('in-chat-detail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const main = document.querySelector('.app-main');
        let page = document.getElementById('page-cotizaciones');
        if (!page) { page = document.createElement('div'); page.id = 'page-cotizaciones'; page.className = 'page'; main.appendChild(page); }
        page.classList.add('active');
        return page;
    }

    // ============================================================
    //  CALCULADORAS (idénticas al panel web)
    // ============================================================
    function _breaker(a) { const s = [10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160]; return s.find(x => x >= a) || 200; }
    function _calibre(a) {
        const t = [[15, '2,5 mm² (#14 AWG)'], [20, '4 mm² (#12)'], [30, '6 mm² (#10)'], [40, '10 mm² (#8)'], [55, '16 mm² (#6)'], [70, '25 mm² (#4)'], [95, '35 mm² (#2)'], [130, '50 mm² (#1/0)']];
        for (const [m, c] of t) if (a <= m) return c; return '70 mm² (#2/0) o mayor';
    }

    function calcSolar() {
        const tipo = $('sol-tipo').value, kwh = +$('sol-kwh').value || 0, hsp = +$('sol-hsp').value || 4.8, panelW = +$('sol-panelw').value || 550;
        const dias = +$('sol-dias').value || 1, vb = +$('sol-vbanco').value || 24, bat = $('sol-bat').value, batAh = +$('sol-batah').value || 100, dist = +$('sol-dist').value || 10;
        const offgrid = tipo !== 'ongrid';
        const EdiaWh = kwh * 1000 / 30;
        const arrayW = Math.ceil(EdiaWh / (hsp * (offgrid ? 0.7 : 0.8)));
        const nPaneles = Math.max(1, Math.ceil(arrayW / panelW));
        const arrayReal = nPaneles * panelW;
        const inversorW = Math.max(1000, Math.ceil(arrayReal / 500) * 500);
        const items = [];
        items.push({ descripcion: `Panel solar monocristalino ${panelW}W`, cantidad: nPaneles, unitario: 0 });
        items.push({ descripcion: `Inversor ${offgrid ? 'cargador ' : 'grid-tie '}${inversorW}W${offgrid ? ' ' + vb + 'V' : ''}`, cantidad: 1, unitario: 0 });
        let corrDC;
        if (offgrid) {
            const DoD = bat === 'litio' ? 0.9 : 0.5;
            const bancoAh = Math.ceil((EdiaWh * dias / (DoD * 0.9)) / vb);
            const nBat = Math.max(1, Math.ceil(bancoAh / batAh));
            items.push({ descripcion: `Batería ${bat === 'litio' ? 'Litio LiFePO4' : 'AGM/Gel'} ${batAh}Ah${vb === 12 ? ' 12V' : ''}`, cantidad: nBat, unitario: 0 });
            const ctrlA = Math.ceil(arrayReal / vb * 1.25);
            items.push({ descripcion: `Controlador de carga MPPT ${_breaker(ctrlA)}A ${vb}V`, cantidad: 1, unitario: 0 });
            corrDC = arrayReal / vb;
        } else { corrDC = arrayReal / 120; }
        const calibreCC = _calibre(corrDC * 1.25);
        items.push({ descripcion: `Cable solar fotovoltaico ${calibreCC} (rojo + negro)`, cantidad: Math.ceil(dist * 2), unitario: 0 });
        items.push({ descripcion: `Protección DC: breaker/fusible ${_breaker(corrDC * 1.25)}A + portafusible`, cantidad: 1, unitario: 0 });
        items.push({ descripcion: `Tablero y breaker AC ${_breaker(inversorW / 120 * 1.25)}A`, cantidad: 1, unitario: 0 });
        items.push({ descripcion: `Estructura de montaje para ${nPaneles} paneles`, cantidad: 1, unitario: 0 });
        items.push({ descripcion: `Conectores MC4 (par) y accesorios`, cantidad: nPaneles, unitario: 0 });
        items.push({ descripcion: `Puesta a tierra + DPS (protección contra sobretensiones)`, cantidad: 1, unitario: 0 });
        items.push({ descripcion: `Instalación, cableado y puesta en marcha`, cantidad: 1, unitario: 0 });
        setItems('solar', items);
        $('solar-asunto').value = `Oferta sistema de energía solar (${offgrid ? 'aislado' : 'interconectado'}) — ${(arrayReal / 1000).toFixed(2)} kWp`;
        $('sol-resumen').innerHTML = `<b>Resultado:</b> ${nPaneles} paneles = <b>${(arrayReal / 1000).toFixed(2)} kWp</b> · inversor ${inversorW}W${offgrid ? ' · banco ' + vb + 'V' : ''} · cable CC ${calibreCC}.<br><small>⚠️ Verificá la caída de tensión según la distancia real y ajustá los precios.</small>`;
    }

    function calcCCTV() {
        const n = +$('cc-num').value || 1, tec = $('cc-tec').value, res = +$('cc-res').value || 4, dias = +$('cc-dias').value || 15, dist = +$('cc-dist').value || 20;
        const ext = Math.min(+$('cc-ext').value || 0, n), interiores = n - ext;
        const canales = [4, 8, 16, 32, 64].find(x => x >= n) || 128;
        const bitrate = { 2: 2, 4: 4, 5: 6, 8: 8 }[res] || 4;
        const totalGB = Math.ceil((bitrate * 86400 / 8 / 1000) * n * dias * 1.1);
        const tb = [1, 2, 3, 4, 6, 8, 10, 12].find(x => x * 1000 >= totalGB) || 14;
        const resTxt = { 2: '2MP', 4: '4MP', 5: '5MP', 8: '4K' }[res];
        const items = [];
        if (ext > 0) items.push({ descripcion: `Cámara ${tec === 'ip' ? 'IP' : 'HDTVI'} ${resTxt} tipo bala exterior (IP66)`, cantidad: ext, unitario: 0 });
        if (interiores > 0) items.push({ descripcion: `Cámara ${tec === 'ip' ? 'IP' : 'HDTVI'} ${resTxt} tipo domo interior`, cantidad: interiores, unitario: 0 });
        items.push({ descripcion: `${tec === 'ip' ? 'NVR' : 'DVR'} de ${canales} canales${tec === 'ip' && canales <= 16 ? ' con PoE' : ''}`, cantidad: 1, unitario: 0 });
        items.push({ descripcion: `Disco duro para videovigilancia ${tb} TB`, cantidad: 1, unitario: 0 });
        if (tec === 'ip') {
            items.push({ descripcion: `Cable UTP Cat6 exterior`, cantidad: n * dist, unitario: 0, um: 'm' });
            items.push({ descripcion: `Conectores RJ45 blindados`, cantidad: n * 2, unitario: 0 });
            if (canales > 16) items.push({ descripcion: `Switch PoE ${canales} puertos`, cantidad: 1, unitario: 0 });
        } else {
            items.push({ descripcion: `Fuente de poder 12V ${Math.ceil(n * 0.5 + 1)}A`, cantidad: 1, unitario: 0 });
            items.push({ descripcion: `Cable coaxial siamés (video + energía)`, cantidad: n * dist, unitario: 0, um: 'm' });
            items.push({ descripcion: `Conectores BNC + plug de energía`, cantidad: n * 2, unitario: 0 });
        }
        items.push({ descripcion: `Monitor/TV para visualización`, cantidad: 1, unitario: 0 });
        items.push({ descripcion: `Gabinete/rack y organización`, cantidad: 1, unitario: 0 });
        items.push({ descripcion: `UPS + DPS (protección eléctrica del grabador)`, cantidad: 1, unitario: 0 });
        items.push({ descripcion: `Instalación, configuración y acceso remoto (app)`, cantidad: 1, unitario: 0 });
        setItems('cctv', items);
        $('cctv-asunto').value = `Oferta CCTV ${n} cámaras ${resTxt} (${tec === 'ip' ? 'IP' : 'analógico'})`;
        $('cc-resumen').innerHTML = `<b>Resultado:</b> ${n} cámaras · ${tec === 'ip' ? 'NVR' : 'DVR'} ${canales}CH · disco <b>${tb} TB</b> (~${totalGB} GB para ${dias} días) · cable ${n * dist} m.<br><small>Ajustá cantidades y precios según el sitio.</small>`;
    }

    function toggleAsist(btn) { btn.closest('.cot-asist').classList.toggle('col'); }
    function toggleBatBloque(sel) { const b = $('sol-bloque-bat'); if (b) b.style.display = sel.value === 'ongrid' ? 'none' : 'contents'; }

    // ============================================================
    //  FORMULARIOS DE ÍTEMS (cctv / solar / factura)
    // ============================================================
    function asistenteSolarHtml() {
        return `
          <div class="cot-asist" id="as-solar">
            <div class="cot-asist-head"><i class="fas fa-calculator"></i> Asistente / Calculadora Solar
              <button type="button" class="cot-toggle" onclick="CotizacionesPage.toggleAsist(this)">▾</button></div>
            <div class="cot-asist-body">
              <p class="cot-help">Respondé lo básico que quiere el cliente y calculo <b>paneles, inversor, baterías, controlador, calibre de cable y protecciones</b>. Después ajustás precios.</p>
              <div class="cot-asist-grid">
                <div><label>Tipo de sistema</label><select id="sol-tipo" onchange="CotizacionesPage.toggleBat(this)"><option value="ongrid">Interconectado (sin baterías)</option><option value="offgrid" selected>Aislado (con baterías)</option><option value="hibrido">Híbrido</option></select></div>
                <div><label>Consumo mensual (kWh)</label><input id="sol-kwh" type="number" min="0" value="300"></div>
                <div><label>Horas sol pico (HSP)</label><input id="sol-hsp" type="number" step="0.1" value="4.8"></div>
                <div><label>Potencia por panel (W)</label><input id="sol-panelw" type="number" value="550"></div>
                <span id="sol-bloque-bat" style="display:contents;">
                  <div><label>Autonomía (días)</label><input id="sol-dias" type="number" value="1"></div>
                  <div><label>Voltaje del banco (V)</label><select id="sol-vbanco"><option>12</option><option selected>24</option><option>48</option></select></div>
                  <div><label>Tipo de batería</label><select id="sol-bat"><option value="litio">Litio LiFePO4 (DoD 90%)</option><option value="agm">AGM/Gel (DoD 50%)</option></select></div>
                  <div><label>Capacidad batería (Ah)</label><input id="sol-batah" type="number" value="100"></div>
                </span>
                <div><label>Distancia paneles→inversor (m)</label><input id="sol-dist" type="number" value="10"></div>
              </div>
              <button type="button" class="sn-btn sn-btn--primary sn-btn--sm" onclick="CotizacionesPage.calcSolar()"><i class="fas fa-bolt"></i> Calcular y llenar ítems</button>
              <div id="sol-resumen" class="cot-resumen"></div>
            </div>
          </div>`;
    }
    function asistenteCctvHtml() {
        return `
          <div class="cot-asist" id="as-cctv">
            <div class="cot-asist-head"><i class="fas fa-calculator"></i> Asistente / Calculadora CCTV
              <button type="button" class="cot-toggle" onclick="CotizacionesPage.toggleAsist(this)">▾</button></div>
            <div class="cot-asist-body">
              <p class="cot-help">Respondé qué necesita el cliente y calculo <b>cámaras, grabador, disco, fuente/PoE, cable y protecciones</b>.</p>
              <div class="cot-asist-grid">
                <div><label>N° de cámaras</label><input id="cc-num" type="number" min="1" value="4"></div>
                <div><label>Tecnología</label><select id="cc-tec"><option value="ip">IP (PoE)</option><option value="analogo">Analógico (HD/TVI)</option></select></div>
                <div><label>Resolución</label><select id="cc-res"><option value="2">2MP (1080p)</option><option value="4" selected>4MP</option><option value="5">5MP</option><option value="8">8MP (4K)</option></select></div>
                <div><label>Días de grabación</label><input id="cc-dias" type="number" value="15"></div>
                <div><label>Distancia prom. por cámara (m)</label><input id="cc-dist" type="number" value="20"></div>
                <div><label>Cámaras exteriores</label><input id="cc-ext" type="number" min="0" value="2"></div>
              </div>
              <button type="button" class="sn-btn sn-btn--primary sn-btn--sm" onclick="CotizacionesPage.calcCCTV()"><i class="fas fa-bolt"></i> Calcular y llenar ítems</button>
              <div id="cc-resumen" class="cot-resumen"></div>
            </div>
          </div>`;
    }
    function formItems(tipo, opts) {
        const conceptoField = tipo === 'factura'
            ? `<label>Concepto</label><textarea id="${tipo}-concepto" placeholder="Concepto de la cuenta de cobro"></textarea>`
            : `<label>Introducción / observación</label><textarea id="${tipo}-intro"></textarea>`;
        return `
          <div class="cot-row2">
            <div><label>Cliente / Empresa *</label><input id="${tipo}-cliente"></div>
            <div><label>Contacto (dirección / tel / correo)</label><input id="${tipo}-contacto"></div>
          </div>
          <label>Asunto</label><input id="${tipo}-asunto" placeholder="${esc(opts.asunto || '')}">
          ${conceptoField}
          <label style="margin-top:10px;">Ítems</label>
          <div style="overflow-x:auto;">
          <table class="cot-items" id="${tipo}-items"><thead><tr><th>Descripción</th><th style="width:64px;">Cant.</th><th style="width:120px;">Vr. Unitario</th><th style="width:120px;">Vr. Total</th><th style="width:38px;"></th></tr></thead><tbody></tbody></table>
          </div>
          <button class="sn-btn sn-btn--ghost sn-btn--sm" style="margin-top:8px;" onclick="CotizacionesPage.addItem('${tipo}')"><i class="fas fa-plus"></i> Agregar ítem</button>
          <div class="cot-tot">
            <div class="cot-tot-row"><span>Subtotal</span><b id="${tipo}-subtotal">$ 0,00</b></div>
            <div class="cot-tot-row"><span>Descuento (%)</span><input id="${tipo}-descuento" type="number" min="0" max="100" value="0" oninput="CotizacionesPage.recalcTipo('${tipo}')"></div>
            <div class="cot-tot-row"><span>IVA (%)</span><input id="${tipo}-iva" type="number" min="0" max="100" value="0" oninput="CotizacionesPage.recalcTipo('${tipo}')"></div>
            <div class="cot-tot-row total"><span>TOTAL</span><b id="${tipo}-total">$ 0,00</b></div>
          </div>
          ${tipo !== 'factura' ? `<label>Validez (días)</label><input id="${tipo}-validez" value="30" style="max-width:120px;">` : ''}
          <label>Notas adicionales</label><textarea id="${tipo}-notas"></textarea>
          <div class="cot-actions">
            <button class="sn-btn sn-btn--primary" data-perm="ver_cotizaciones" onclick="CotizacionesPage.generar('${tipo}')"><i class="fas fa-file-pdf"></i> Generar ${tipo === 'factura' ? 'factura' : 'cotización'}</button>
            <span class="cot-muted">Se guarda en el historial y se abre el PDF protegido.</span>
          </div>`;
    }
    function itemRow() {
        return `<tr>
          <td><input class="it-desc" placeholder="Descripción del equipo/servicio"></td>
          <td><input class="it-cant" type="number" min="0" value="1" oninput="CotizacionesPage.recalc(this)"></td>
          <td><input class="it-uni" type="number" min="0" value="0" oninput="CotizacionesPage.recalc(this)"></td>
          <td><input class="it-sub" value="$ 0,00" readonly></td>
          <td><button class="cot-del" onclick="const t=this.closest('table');this.closest('tr').remove();CotizacionesPage.recalcTablaEl(t)"><i class="fas fa-trash"></i></button></td></tr>`;
    }
    function addItem(tipo) { $(tipo + '-items').querySelector('tbody').insertAdjacentHTML('beforeend', itemRow()); }
    function recalc(inp) { recalcTablaEl(inp.closest('table')); }
    function recalcTipo(tipo) { recalcTablaEl($(tipo + '-items')); }
    function recalcTablaEl(tbl) {
        if (!tbl) return { total: 0 };
        let subtotal = 0;
        tbl.querySelectorAll('tbody tr').forEach(tr => {
            const c = +tr.querySelector('.it-cant').value || 0, u = +tr.querySelector('.it-uni').value || 0, s = c * u;
            tr.querySelector('.it-sub').value = fmt(s); subtotal += s;
        });
        const tipo = tbl.id.split('-')[0];
        return recalcTotales(tipo, subtotal);
    }
    function recalcTotales(tipo, subtotal) {
        const desc = +(($(tipo + '-descuento') || {}).value) || 0, iva = +(($(tipo + '-iva') || {}).value) || 0;
        const baseDesc = subtotal * (1 - desc / 100);
        const total = baseDesc * (1 + iva / 100);
        const st = $(tipo + '-subtotal'); if (st) st.textContent = fmt(subtotal);
        const t = $(tipo + '-total'); if (t) t.textContent = fmt(total);
        return { subtotal, desc, iva, total };
    }
    function leerItems(tipo) {
        return [...$(tipo + '-items').querySelectorAll('tbody tr')].map(tr => ({
            descripcion: tr.querySelector('.it-desc').value, cantidad: +tr.querySelector('.it-cant').value || 0, unitario: +tr.querySelector('.it-uni').value || 0
        })).filter(r => r.descripcion);
    }
    function setItems(tipo, items) {
        const tb = $(tipo + '-items').querySelector('tbody'); tb.innerHTML = '';
        (items || []).forEach(it => {
            tb.insertAdjacentHTML('beforeend', itemRow());
            const tr = tb.lastElementChild;
            tr.querySelector('.it-desc').value = it.descripcion || '';
            tr.querySelector('.it-cant').value = it.cantidad != null ? it.cantidad : 1;
            tr.querySelector('.it-uni').value = it.unitario != null ? it.unitario : 0;
        });
        if (!(items && items.length)) addItem(tipo);
        recalcTipo(tipo);
    }

    // ============================================================
    //  PLANES DE INTERNET (filas)
    // ============================================================
    function planRow(d = {}) {
        return `<tr>
          <td><input value="${esc(d.descuento || '0%')}" placeholder="Desc %"></td>
          <td><input value="${esc(d.megas || '300')}"></td>
          <td><input value="${esc(d.meses || '0')}"></td>
          <td><input value="${esc(d.instalacion || '')}" placeholder="$ o GRATIS"></td>
          <td><input value="${esc(d.mensual || '')}" placeholder="$ mensual"></td>
          <td><button class="cot-del" onclick="this.closest('tr').remove()"><i class="fas fa-trash"></i></button></td></tr>`;
    }
    function addPlan(tblId, d) { $(tblId).querySelector('tbody').insertAdjacentHTML('beforeend', planRow(d)); }
    function leerPlanes(tblId) {
        return [...$(tblId).querySelectorAll('tbody tr')].map(tr => {
            const i = tr.querySelectorAll('input');
            return { descuento: i[0].value, megas: i[1].value, meses: i[2].value, instalacion: i[3].value, mensual: i[4].value };
        }).filter(r => r.mensual || r.instalacion);
    }

    // ============================================================
    //  GENERAR (crear + abrir PDF)
    // ============================================================
    async function generar(tipo) {
        let payload = { tipo };
        if (tipo === 'internet') {
            payload.cliente_nombre = $('int-cliente').value.trim();
            payload.cliente_contacto = $('int-contacto').value.trim();
            payload.asunto = 'Oferta servicio internet.';
            const corp = leerPlanes('int-corp'), ded = leerPlanes('int-ded');
            payload.datos = { megas: $('int-megas').value, validez: $('int-validez').value, intro: $('int-intro').value.trim(), corporativo: corp, dedicado: ded, notas: $('int-notas').value.trim() };
            payload.total = ded.length ? (parseFloat(ded[ded.length - 1].mensual) || 0) : 0;
        } else {
            payload.cliente_nombre = $(tipo + '-cliente').value.trim();
            payload.cliente_contacto = $(tipo + '-contacto').value.trim();
            payload.asunto = $(tipo + '-asunto').value.trim();
            const items = leerItems(tipo);
            const subtotal = items.reduce((s, i) => s + i.cantidad * i.unitario, 0);
            const tt = recalcTotales(tipo, subtotal);
            payload.datos = { items, descuento_pct: tt.desc, iva_pct: tt.iva, notas: $(tipo + '-notas').value.trim() };
            if (tipo === 'factura') payload.datos.concepto = $('factura-concepto').value.trim();
            else { payload.datos.intro = $(tipo + '-intro').value.trim(); payload.datos.validez = $(tipo + '-validez').value; }
            payload.total = tt.total;
        }
        if (!payload.cliente_nombre) { toast('Poné el nombre del cliente/empresa.', 'error'); return; }
        try {
            const d = await API.post('/api/cotizaciones', payload);
            if (!d || !d.ok) throw new Error((d && d.error) || 'Error');
            window.open(pdfUrl(d.id, false), '_blank');
            toast('✅ ' + (tipo === 'factura' ? 'Factura' : 'Cotización') + ' ' + d.numero + ' generada y guardada.', 'success');
        } catch (e) { toast('Error: ' + e.message, 'error'); }
    }

    // ============================================================
    //  DUPLICAR / CONVERTIR A FACTURA / ANULAR
    // ============================================================
    async function cargarCotDetalle(id) {
        const d = await API.get('/api/cotizaciones/' + id);
        if (!d || !d.ok) throw new Error((d && d.error) || 'Error'); return d.cotizacion;
    }
    async function duplicarCot(id) {
        try {
            const c = await cargarCotDetalle(id), dt = c.datos || {};
            if (c.tipo === 'internet') {
                mostrarTab('internet');
                $('int-cliente').value = c.cliente_nombre || ''; $('int-contacto').value = c.cliente_contacto || '';
                $('int-megas').value = dt.megas || '300'; $('int-validez').value = dt.validez || '30';
                $('int-intro').value = dt.intro || ''; $('int-notas').value = dt.notas || '';
                $('int-corp').querySelector('tbody').innerHTML = ''; (dt.corporativo || []).forEach(r => addPlan('int-corp', r));
                $('int-ded').querySelector('tbody').innerHTML = ''; (dt.dedicado || []).forEach(r => addPlan('int-ded', r));
            } else {
                mostrarTab(c.tipo);
                $(c.tipo + '-cliente').value = c.cliente_nombre || ''; $(c.tipo + '-contacto').value = c.cliente_contacto || '';
                $(c.tipo + '-asunto').value = c.asunto || '';
                if (c.tipo === 'factura') $('factura-concepto').value = dt.concepto || '';
                else { $(c.tipo + '-intro').value = dt.intro || ''; $(c.tipo + '-validez').value = dt.validez || '30'; }
                if ($(c.tipo + '-descuento')) $(c.tipo + '-descuento').value = dt.descuento_pct || 0;
                if ($(c.tipo + '-iva')) $(c.tipo + '-iva').value = dt.iva_pct || 0;
                $(c.tipo + '-notas').value = dt.notas || '';
                setItems(c.tipo, dt.items);
            }
            toast('📋 Copiado a un formulario nuevo. Revisá y "Generar" — número nuevo.', 'success');
        } catch (e) { toast('Error: ' + e.message, 'error'); }
    }
    async function crearFacturaDesde(id) {
        try {
            const c = await cargarCotDetalle(id), dt = c.datos || {};
            mostrarTab('factura');
            $('factura-cliente').value = c.cliente_nombre || ''; $('factura-contacto').value = c.cliente_contacto || '';
            $('factura-asunto').value = 'Factura de ' + c.numero;
            let items = dt.items;
            if (c.tipo === 'internet' || !(items && items.length)) {
                items = [{ descripcion: 'Servicio/instalación de internet (según cotización ' + c.numero + ')', cantidad: 1, unitario: parseFloat(c.total) || 0 }];
                $('factura-concepto').value = 'Servicio de internet según cotización ' + c.numero + '.';
            } else {
                $('factura-concepto').value = (c.asunto || 'Según cotización ' + c.numero) + ' (ref. ' + c.numero + ')';
            }
            if ($('factura-descuento')) $('factura-descuento').value = dt.descuento_pct || 0;
            if ($('factura-iva')) $('factura-iva').value = dt.iva_pct || 0;
            $('factura-notas').value = 'Basada en la cotización ' + c.numero + '.';
            setItems('factura', items);
            toast('🧾 Factura cargada desde ' + c.numero + '. Revisá y "Generar factura".', 'success');
        } catch (e) { toast('Error: ' + e.message, 'error'); }
    }
    async function anular(id) {
        if (!confirm('¿Anular esta cotización/factura? Queda marcada como ANULADA (no se borra).')) return;
        try {
            const d = await API.post('/api/cotizaciones/' + id + '/anular', {});
            if (!d || !d.ok) throw new Error((d && d.error) || 'Error');
            toast('Anulada ✓', 'success'); cargarHistorial();
        } catch (e) { toast('Error: ' + e.message, 'error'); }
    }

    // ============================================================
    //  HISTORIAL
    // ============================================================
    async function cargarHistorial() {
        const cont = $('cot-hist-cont'); if (!cont) return;
        cont.innerHTML = `<div class="sn-empty"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>`;
        try {
            const tipo = $('cot-hist-tipo').value, q = $('cot-hist-q').value.trim();
            const params = new URLSearchParams(); if (tipo) params.set('tipo', tipo); if (q) params.set('q', q);
            const d = await API.get('/api/cotizaciones?' + params.toString());
            const rows = (d && d.cotizaciones) || [];
            if (!rows.length) { cont.innerHTML = `<div class="sn-empty"><i class="fas fa-folder-open"></i> Sin registros.</div>`; return; }
            cont.innerHTML = rows.map(c => {
                const anulada = c.estado === 'anulada';
                const esFactura = c.tipo === 'factura';
                return `<div class="sn-card">
                  <div class="cot-hist-card">
                    <div style="min-width:0;">
                      <div class="sn-row__title"><b>${esc(c.numero)}</b> <span class="sn-badge ${badgeTipo[c.tipo] || 'sn-badge--off'}">${esc(c.tipo)}</span>${anulada ? ' <span class="sn-badge sn-badge--danger">ANULADA</span>' : ''}</div>
                      <div style="color:var(--sn-text-primary);font-size:var(--sn-text-sm);margin-top:2px;">${esc(c.cliente_nombre || '')}</div>
                      ${c.asunto ? `<div class="sn-row__sub">${esc(c.asunto)}</div>` : ''}
                      <div class="sn-row__sub">${esc(c.fecha || '')}</div>
                    </div>
                    <div style="text-align:right;white-space:nowrap;font-weight:var(--sn-weight-bold);color:var(--brand);">${fmt(c.total)}</div>
                  </div>
                  <div class="cot-hist-acc">
                    <a class="sn-btn sn-btn--ghost sn-btn--sm" href="${pdfUrl(c.id, false)}" target="_blank" rel="noopener"><i class="fas fa-eye"></i> Ver</a>
                    <a class="sn-btn sn-btn--ghost sn-btn--sm" href="${pdfUrl(c.id, true)}" target="_blank" rel="noopener"><i class="fas fa-download"></i></a>
                    <button class="sn-btn sn-btn--ghost sn-btn--sm" data-perm="ver_cotizaciones" onclick="CotizacionesPage.duplicar(${c.id})"><i class="fas fa-copy"></i> Duplicar</button>
                    ${(!esFactura && !anulada) ? `<button class="sn-btn sn-btn--success sn-btn--sm" data-perm="ver_cotizaciones" onclick="CotizacionesPage.crearFactura(${c.id})"><i class="fas fa-file-invoice"></i> Factura</button>` : ''}
                    ${!anulada ? `<button class="sn-btn sn-btn--danger sn-btn--sm" data-perm="ver_cotizaciones" onclick="CotizacionesPage.anular(${c.id})"><i class="fas fa-ban"></i></button>` : ''}
                  </div>
                </div>`;
            }).join('');
            if (window.Perms) Perms.apply(cont);
        } catch (e) { cont.innerHTML = `<div class="sn-empty" style="color:var(--sn-danger);">Error: ${esc(e.message)}</div>`; }
    }

    // ============================================================
    //  TABS + RENDER
    // ============================================================
    function mostrarTab(t) {
        _tab = t;
        const page = document.getElementById('page-cotizaciones'); if (!page) return;
        page.querySelectorAll('.cot-tab-btn').forEach(b => {
            const on = b.dataset.tab === t;
            b.classList.toggle('sn-btn--primary', on);
            b.classList.toggle('sn-btn--ghost', !on);
        });
        page.querySelectorAll('.cot-pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== t));
        if (t === 'historial') cargarHistorial();
    }

    function render(page) {
        page.innerHTML = `
          <div class="cot-tabs">
            <button class="sn-btn cot-tab-btn" data-tab="internet" onclick="CotizacionesPage.mostrarTab('internet')"><i class="fas fa-wifi"></i> Internet</button>
            <button class="sn-btn cot-tab-btn" data-tab="cctv" onclick="CotizacionesPage.mostrarTab('cctv')"><i class="fas fa-video"></i> CCTV</button>
            <button class="sn-btn cot-tab-btn" data-tab="solar" onclick="CotizacionesPage.mostrarTab('solar')"><i class="fas fa-solar-panel"></i> Solar</button>
            <button class="sn-btn cot-tab-btn" data-tab="factura" onclick="CotizacionesPage.mostrarTab('factura')"><i class="fas fa-receipt"></i> Factura</button>
            <button class="sn-btn cot-tab-btn" data-tab="historial" onclick="CotizacionesPage.mostrarTab('historial')"><i class="fas fa-clock-rotate-left"></i> Historial</button>
          </div>
          <div class="cot-wrap">
            <!-- INTERNET -->
            <div class="cot-pane" data-pane="internet">
              <div class="sn-card sn-card--accent">
                <div class="sn-section-title"><i class="fas fa-wifi"></i> Cotización de Internet (Corporativo vs Dedicado)</div>
                <div class="cot-row2">
                  <div><label>Cliente / Empresa *</label><input id="int-cliente" placeholder="FUNDACION RIO DE ESPERANZA PARA TODOS"></div>
                  <div><label>Contacto (dirección / tel / correo)</label><input id="int-contacto" placeholder="Dirección, teléfono o correo"></div>
                </div>
                <div class="cot-row2">
                  <div><label>Megas del plan</label><input id="int-megas" value="300"></div>
                  <div><label>Validez (días)</label><input id="int-validez" value="30"></div>
                </div>
                <label>Introducción / observación</label>
                <textarea id="int-intro" placeholder="Se usa un texto estándar si lo dejás vacío."></textarea>
                <div class="cot-row2" style="margin-top:6px;">
                  <div>
                    <label>Internet corporativo (compartido)</label>
                    <div style="overflow-x:auto;"><table class="cot-items" id="int-corp"><thead><tr><th>Desc.</th><th>Megas</th><th>Meses</th><th>Instalación</th><th>Mensual</th><th></th></tr></thead><tbody></tbody></table></div>
                    <button class="sn-btn sn-btn--ghost sn-btn--sm" style="margin-top:6px;" onclick="CotizacionesPage.addPlan('int-corp')"><i class="fas fa-plus"></i> Fila</button>
                  </div>
                  <div>
                    <label>Internet dedicado</label>
                    <div style="overflow-x:auto;"><table class="cot-items" id="int-ded"><thead><tr><th>Desc.</th><th>Megas</th><th>Meses</th><th>Instalación</th><th>Mensual</th><th></th></tr></thead><tbody></tbody></table></div>
                    <button class="sn-btn sn-btn--ghost sn-btn--sm" style="margin-top:6px;" onclick="CotizacionesPage.addPlan('int-ded')"><i class="fas fa-plus"></i> Fila</button>
                  </div>
                </div>
                <label>Notas adicionales</label><textarea id="int-notas"></textarea>
                <div class="cot-actions">
                  <button class="sn-btn sn-btn--primary" data-perm="ver_cotizaciones" onclick="CotizacionesPage.generar('internet')"><i class="fas fa-file-pdf"></i> Generar cotización</button>
                  <span class="cot-muted">Se guarda en el historial y se abre el PDF protegido.</span>
                </div>
              </div>
            </div>
            <!-- CCTV -->
            <div class="cot-pane hidden" data-pane="cctv">
              <div class="sn-card sn-card--accent">
                <div class="sn-section-title"><i class="fas fa-video"></i> Cotización de CCTV (videovigilancia)</div>
                <div id="form-cctv"></div>
              </div>
            </div>
            <!-- SOLAR -->
            <div class="cot-pane hidden" data-pane="solar">
              <div class="sn-card sn-card--accent">
                <div class="sn-section-title"><i class="fas fa-solar-panel"></i> Cotización de Sistema Solar</div>
                <div id="form-solar"></div>
              </div>
            </div>
            <!-- FACTURA -->
            <div class="cot-pane hidden" data-pane="factura">
              <div class="sn-card sn-card--accent">
                <div class="sn-section-title"><i class="fas fa-receipt"></i> Factura / Cuenta de cobro</div>
                <div id="form-factura"></div>
              </div>
            </div>
            <!-- HISTORIAL -->
            <div class="cot-pane hidden" data-pane="historial">
              <div class="sn-card">
                <div class="sn-section-title"><i class="fas fa-clock-rotate-left"></i> Historial</div>
                <div class="cot-hist-toolbar">
                  <select id="cot-hist-tipo" onchange="CotizacionesPage.cargarHistorial()">
                    <option value="">Todos los tipos</option>
                    <option value="internet">Internet</option><option value="cctv">CCTV</option>
                    <option value="solar">Solar</option><option value="factura">Factura</option>
                  </select>
                  <input id="cot-hist-q" placeholder="Buscar por número, cliente o asunto…" onkeydown="if(event.key==='Enter')CotizacionesPage.cargarHistorial()">
                  <button class="sn-btn sn-btn--primary sn-btn--sm" onclick="CotizacionesPage.cargarHistorial()"><i class="fas fa-search"></i> Buscar</button>
                </div>
                <div id="cot-hist-cont"><div class="sn-empty">Cargando…</div></div>
              </div>
            </div>
          </div>`;

        // Montar formularios de ítems (con asistentes) y prefill de internet
        $('form-cctv').innerHTML = asistenteCctvHtml() + formItems('cctv', { asunto: 'Oferta sistema de CCTV (videovigilancia).' });
        $('form-solar').innerHTML = asistenteSolarHtml() + formItems('solar', { asunto: 'Oferta sistema de energía solar.' });
        $('form-factura').innerHTML = formItems('factura', { asunto: 'Servicios prestados.' });
        ['cctv', 'solar', 'factura'].forEach(t => addItem(t));

        // Prefill internet con la plantilla de referencia (idéntico a la web)
        [['0%', '300', '0', '300000', '300000'], ['5%', '300', '12', '150000', '276000'], ['25%', '300', '24', 'GRATIS', '240000']]
            .forEach(r => addPlan('int-corp', { descuento: r[0], megas: r[1], meses: r[2], instalacion: r[3], mensual: r[4] }));
        [['0%', '300', '0', '300000', '1600125'], ['5%', '300', '12', '150000', '1472115'], ['25%', '300', '24', 'GRATIS', '1280100']]
            .forEach(r => addPlan('int-ded', { descuento: r[0], megas: r[1], meses: r[2], instalacion: r[3], mensual: r[4] }));

        if (window.Perms) Perms.apply(page);
        _rendered = true;
    }

    async function show() {
        ensureStyle();
        const page = ensurePage();
        if (!_rendered || !page.querySelector('.cot-tabs')) render(page);
        mostrarTab(_tab || 'internet');
    }

    return {
        show,
        mostrarTab, cargarHistorial,
        addItem, addPlan, recalc, recalcTipo, recalcTablaEl,
        calcSolar, calcCCTV, toggleAsist, toggleBat: toggleBatBloque,
        generar, duplicar: duplicarCot, crearFactura: crearFacturaDesde, anular
    };
})();

if (typeof Router !== 'undefined') Router.register('cotizaciones', () => CotizacionesPage.show());
