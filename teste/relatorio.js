'use strict';
// Relatório de impressão do NOVA: pré-visualização em iframe, páginas escolhidas e opções de layout.
// Usa funções do renderer.js (field, fmt, fmtNum, formatDate, rgOf, groupLabel, prioShort, priorityMatch...).

const REPORT_DEFAULTS = {
  title: 'Relatório de estoque', scope: 'all', sort: 'atual', pages: '', rows: '',
  orient: 'landscape', paper: 'A4', font: 'normal', margin: '10',
  summary: true, filters: true, pageNo: true, total: true, zebra: true, grid: false, eco: false,
  cols: ['prio', 'desc', 'rg', 'dtent', 'peso', 'op', 'partida', 'gram', 'cmc', 'ender', 'almox']
};
const REPORT_STORE = 'nova_report_opts_v1';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const REPORT_COLS = [
  { id: 'prio', label: 'Prioridade', cls: 'c', get: r => prioShort(r), pill: true },
  { id: 'desc', label: 'Descrição', cls: 'l', clip: 70, get: r => groupLabel(r) },
  { id: 'rg', label: 'RG', get: r => rgOf(r) || '—' },
  { id: 'dtent', label: 'Data de entrada', short: 'Entrada', get: r => formatDate(field(r, 'Z5_DTENT')) },
  { id: 'peso', label: 'Peso atual (kg)', short: 'Peso (kg)', cls: 'n', get: r => fmtNum(field(r, 'Z5_PESOATU'), 2), sum: true },
  { id: 'op', label: 'OP', get: r => fmt(field(r, 'Z5_OP')) },
  { id: 'partida', label: 'Partida', get: r => fmt(field(r, 'Z5_PARTIDA')) },
  { id: 'gram', label: 'Gramatura', cls: 'n', get: r => fmtNum(field(r, 'Z5_GRAMATU'), 0, 2) },
  { id: 'gideal', label: 'Gramatura ideal (faixa)', short: 'Gram. ideal', cls: 'n', get: r => { const k = priorityRuleFor(r); if (!k) return '—'; const i = Number(k.gramatura), t = Number(k.tolerance ?? DEFAULT_TOLERANCE); return `${fmtNum(i, 0, 2)} (${fmtNum(i * (1 - t / 100), 0, 1)}–${fmtNum(i * (1 + t / 100), 0, 1)})`; } },
  { id: 'cmc', label: 'CMC', cls: 'n', get: r => fmtNum(field(r, 'Z5_CMC'), 2) },
  { id: 'ender', label: 'Endereço', cls: 'b', get: r => fmt(field(r, 'Z5_ENDEREC')) },
  { id: 'almox', label: 'Armazém', cls: 'c', get: r => fmt(field(r, 'Z5_ALMOXA')) },
  { id: 'tdesc', label: 'Desc. tonalidade', short: 'Desc. tonal.', cls: 'l', clip: 40, get: r => fmt(field(r, 'ZL_DESCRUP') || field(r, 'ZL_DESTONA')) },
  { id: 'lote', label: 'Lote', get: r => fmt(field(r, 'Z6_LOTECTL')) },
  { id: 'prod', label: 'Produto', get: r => fmt(field(r, 'Z5_PROD')) },
  { id: 'conf', label: 'Conferido', cls: 'c', get: () => '☐' }
];

const COL_WEIGHT = { prio: 13, desc: 24, rg: 10, dtent: 11, peso: 11, op: 9, partida: 9, gram: 12, gideal: 16, cmc: 7, ender: 10, almox: 8, tonal: 9, tdesc: 18, lote: 9, doccq: 10, roman: 10, prod: 13, conf: 8 };
let rOpts = null, rTimer = null, rLast = null;

function loadReportOpts() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(REPORT_STORE) || '{}') || {}; } catch { /* sem armazenamento */ }
  const o = { ...REPORT_DEFAULTS, ...saved };
  o.cols = (Array.isArray(o.cols) ? o.cols : REPORT_DEFAULTS.cols).filter(id => REPORT_COLS.some(c => c.id === id));
  if (!o.cols.length) o.cols = [...REPORT_DEFAULTS.cols];
  o.pages = ''; // a seleção de páginas vale apenas para a impressão atual
  return o;
}
function saveReportOpts() { try { const { pages, ...keep } = rOpts; localStorage.setItem(REPORT_STORE, JSON.stringify(keep)); } catch { /* ignora */ } }

function readReportForm() {
  const o = { ...rOpts };
  o.title = $('rTitle').value.trim() || REPORT_DEFAULTS.title;
  o.scope = $('rScope').value; o.sort = $('rSort').value; o.pages = $('rPages').value; o.rows = $('rRows').value;
  o.orient = $('rOrient').value; o.paper = $('rPaper').value; o.font = $('rFont').value; o.margin = $('rMargin').value;
  o.summary = $('oSummary').checked; o.filters = $('oFilters').checked; o.pageNo = $('oPageNo').checked;
  o.total = $('oTotal').checked; o.zebra = $('oZebra').checked; o.grid = $('oGrid').checked; o.eco = $('oEco').checked;
  o.cols = REPORT_COLS.filter(c => { const el = document.querySelector(`#rCols input[data-col="${c.id}"]`); return el && el.checked; }).map(c => c.id);
  return o;
}
function fillReportForm(o) {
  $('rTitle').value = o.title; $('rScope').value = o.scope; $('rSort').value = o.sort; $('rPages').value = o.pages; $('rRows').value = o.rows;
  $('rOrient').value = o.orient; $('rPaper').value = o.paper; $('rFont').value = o.font; $('rMargin').value = o.margin;
  $('oSummary').checked = o.summary; $('oFilters').checked = o.filters; $('oPageNo').checked = o.pageNo;
  $('oTotal').checked = o.total; $('oZebra').checked = o.zebra; $('oGrid').checked = o.grid; $('oEco').checked = o.eco;
  const box = $('rCols'); box.replaceChildren();
  REPORT_COLS.forEach(c => {
    const label = document.createElement('label'); label.className = 'rc';
    const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.col = c.id; input.checked = o.cols.includes(c.id);
    label.append(input, document.createTextNode(' ' + c.label)); box.append(label);
  });
}

/* ------------------------------ montagem ------------------------------ */
function reportRows(o) {
  let rows = visibleRows.filter(r => o.scope === 'all' ? true : o.scope === 'ideal' ? priorityMatch(r) : !priorityMatch(r));
  const num = r => parseNumber(field(r, 'Z5_PESOATU')) || 0;
  const cmp = {
    endereco: (a, b) => String(field(a, 'Z5_ENDEREC')).localeCompare(String(field(b, 'Z5_ENDEREC')), 'pt-BR', { numeric: true }),
    entrada: (a, b) => dateValue(field(b, 'Z5_DTENT')) - dateValue(field(a, 'Z5_DTENT')),
    peso: (a, b) => num(b) - num(a),
    rg: (a, b) => rgOf(a).localeCompare(rgOf(b), 'pt-BR', { numeric: true })
  }[o.sort];
  if (cmp) rows = [...rows].sort(cmp);
  else if (o.sort === 'op') rows = groupRows(rows).flatMap(g => g.rows); // grupos na ordem da prioridade
  return rows;
}
function reportLayout(o) {
  const paper = { A4: [210, 297], Carta: [215.9, 279.4], A3: [297, 420] }[o.paper] || [210, 297];
  let [w, h] = paper; if (o.orient === 'landscape') [w, h] = [h, w];
  const m = Number(o.margin) || 10;
  const f = { small: { pt: 7.5, row: 5.8 }, normal: { pt: 9, row: 7.2 }, large: { pt: 10.5, row: 8.8 } }[o.font] || { pt: 9, row: 7.2 };
  const innerW = w - 2 * m, innerH = h - 2 * m - 1;
  const head = 20, foot = 9, thead = f.row * 1.35, sum = 20;
  const avail = innerH - head - foot - thead - 4;
  const max = Math.max(5, Math.floor(avail / f.row));
  const wanted = parseInt(o.rows, 10);
  const cap = Number.isFinite(wanted) && wanted >= 5 ? Math.min(wanted, max) : max;
  const rowH = Math.min(avail / cap, f.row * 1.8); // estica as linhas para preencher a folha sem estourar
  return { w, h, m, innerW, innerH, f, head, foot, thead, sum, cap, max, rowH, firstCap: o.summary ? Math.max(3, cap - Math.ceil(sum / rowH)) : cap };
}
function parsePages(text, total) {
  const t = String(text || '').trim();
  const all = Array.from({ length: total }, (_, i) => i + 1);
  if (!t || /^todas?$/i.test(t)) return { list: all };
  const set = new Set();
  for (const part of t.split(/[;,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) return { error: `Trecho inválido: “${part}”. Use, por exemplo, 1-3, 5.` };
    let a = +m[1], b = m[2] ? +m[2] : a; if (a > b) [a, b] = [b, a];
    if (a < 1 || b > total) return { error: `As páginas devem estar entre 1 e ${total}.` };
    for (let i = a; i <= b; i++) set.add(i);
  }
  return { list: [...set].sort((x, y) => x - y) };
}
function filterDescription() {
  const v = $('filterValue').value.trim(), a = $('addressFilter').value;
  return [punhoCtx ? `Punho p/ malha ${punhoCtx.malha.code} (${punhoCtx.ops.size} OP)` : '', a ? `Endereço: ${a}` : '', v ? `${$('filterType').selectedOptions[0].textContent}: “${v}”` : ''].filter(Boolean).join(' · ');
}

function buildReport(o) {
  const L = reportLayout(o);
  const cols = REPORT_COLS.filter(c => o.cols.includes(c.id));
  const rows = reportRows(o);
  const items = rows.map(r => ({ r }));
  if (o.total && rows.length) items.push({ total: true });
  // paginação por capacidade fixa (linhas de altura fixa)
  const pages = []; let i = 0;
  while (i < items.length || !pages.length) {
    const cap = pages.length === 0 ? L.firstCap : L.cap;
    pages.push(items.slice(i, i + cap)); i += cap;
    if (i >= items.length) break;
  }
  const totalPages = pages.length;
  const sel = parsePages(o.pages, totalPages);

  const now = new Date();
  const stamp = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const userTxt = String(currentUser || '').trim();
  const product = selected ? `${selected.code}${selected.description ? ' — ' + selected.description : ''}` : '';
  const totalWeight = rows.reduce((s, r) => s + (parseNumber(field(r, 'Z5_PESOATU')) || 0), 0);
  const ideal = rows.filter(priorityMatch).length;
  const addrs = new Set(rows.map(r => String(field(r, 'Z5_ENDEREC') ?? '').trim()).filter(Boolean)).size;
  const scopeTxt = { all: '', ideal: 'Somente aprovados para amostra', other: 'Somente não indicados para amostra' }[o.scope];
  const subParts = [product, o.filters ? filterDescription() : '', scopeTxt].filter(Boolean);

  // Larguras pelo conteúdo real: nada de dados cortados; só Descrição encolhe e, se preciso, a letra reduz.
  const FLEX = new Set(['desc', 'tdesc']);
  const maxLen = cols.map(c => {
    let m = String(c.short || c.label).length * 1.15;
    for (const r of rows) { const t = c.pill ? prioShort(r) : String(c.get(r)); if (t.length + (c.pill ? 4 : 0) > m) m = t.length + (c.pill ? 4 : 0); }
    return m;
  });
  let scale = 1, widths = [];
  for (const sc of [1, 0.93, 0.86, 0.79, 0.72]) {
    scale = sc;
    const cw = L.f.pt * 0.3528 * 0.56 * sc, pad = (sc === 1 ? 5.4 : 4.2);
    widths = cols.map((c, i) => maxLen[i] * cw + pad + (c.cls === 'n' ? 1 : 0));
    let total = widths.reduce((x, y) => x + y, 0);
    if (total > L.innerW) { // encolhe as colunas flexíveis (mín. 22 mm)
      let deficit = total - L.innerW;
      cols.forEach((c, i) => { if (FLEX.has(c.id) && deficit > 0) { const cut = Math.min(deficit, Math.max(0, widths[i] - 22)); widths[i] -= cut; deficit -= cut; } });
      total = widths.reduce((x, y) => x + y, 0);
    }
    if (total <= L.innerW + 0.01) break;
  }
  const wTotal = widths.reduce((x, y) => x + y, 0);
  const extra = Math.max(0, L.innerW - wTotal);
  const finalW = widths.map(w => w + extra * (w / wTotal)); // sobra distribuída proporcionalmente
  const colgroup = `<colgroup>${finalW.map(w => `<col style="width:${(w / L.innerW * 100).toFixed(2)}%">`).join('')}</colgroup>`;
  const ink = o.eco ? '#000' : '#1a2040';
  const css = `
@page{size:${o.paper === 'Carta' ? 'letter' : o.paper} ${o.orient};margin:${L.m}mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:"Segoe UI",Arial,Helvetica,sans-serif;font-size:${L.f.pt}pt;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{position:relative;width:${L.w}mm;height:${L.h}mm;padding:${L.m}mm;background:#fff;overflow:hidden}
.inner{position:relative;width:${L.innerW}mm;height:${L.innerH}mm;overflow:hidden}
.ph{height:${L.head}mm;display:flex;flex-direction:column;justify-content:flex-start;align-items:center;text-align:center;padding-bottom:2.5mm;border-bottom:.5mm solid ${ink}}
.ph h1{margin:0 0 1.2mm;font-size:${L.f.pt + 5}pt;line-height:1.1;letter-spacing:.01em;color:${ink}}
.ph .sub{font-size:${L.f.pt - 0.5}pt;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.ph .meta{text-align:center;font-size:${L.f.pt - 1}pt;color:#444;line-height:1.5;padding-top:.8mm}
.sum{display:flex;gap:4mm;height:${L.sum - 6}mm;margin:3.5mm 0 2.5mm}
.sum div{flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;justify-content:center;border:.25mm solid ${o.eco ? '#555' : '#c9d6e2'};border-radius:1.2mm;padding:0 3.5mm;${o.eco ? '' : 'background:#f4f8fb'}}
.sum span{display:block;font-size:${L.f.pt - 2}pt;letter-spacing:.06em;text-transform:uppercase;color:#555;margin-bottom:.8mm}
.sum b{font-size:${L.f.pt + 4}pt;line-height:1.1;color:${ink}}
table{border-collapse:collapse;width:100%;table-layout:fixed;margin-top:${o.summary ? 0 : 3}mm;font-size:${(L.f.pt * scale).toFixed(2)}pt}
th{height:${L.thead}mm;text-align:center;vertical-align:middle;font-size:.88em;text-transform:uppercase;letter-spacing:.03em;padding:0 ${scale === 1 ? 2 : 1.5}mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:${o.eco ? '#e4e4e4' : '#232b6b'};color:${o.eco ? '#000' : '#fff'};${o.eco ? 'border-top:.3mm solid #000;border-bottom:.3mm solid #000' : ''}}
td{text-align:center;height:${L.rowH}mm;padding:0 ${scale === 1 ? 2.2 : 1.6}mm;vertical-align:middle;white-space:nowrap;line-height:1.1;overflow:hidden;text-overflow:ellipsis;border-bottom:.15mm solid ${o.eco ? '#888' : '#d3dce5'};${o.grid ? 'border:.15mm solid #888;' : ''}}
th,td{text-align:center}
${o.grid ? 'th{border:.15mm solid #888}' : ''}
td.b{font-weight:700}
${o.zebra ? `tbody tr:nth-child(even) td{background:${o.eco ? '#f0f0f0' : '#f3f6f9'}}` : ''}
tr.tot td{font-weight:700;border-top:.4mm solid #000;background:${o.eco ? '#e4e4e4' : '#e8eef4'}!important}
.pp{display:inline-block;padding:.5mm 2.4mm;border-radius:2.5mm;font-weight:700;font-size:.85em;line-height:1.2;${o.eco ? 'border:.2mm solid #000' : ''}}
${o.eco ? '.pp.ok,.pp.op{background:#000;color:#fff}' : '.pp.op{background:#ffefc2;color:#6b4500}.pp.ok{background:#dcf3e4;color:#14673a}.pp.out{background:#fde7e4;color:#9b2c1f}.pp.no{background:#fde7e4;color:#9b2c1f}'}
.pf{position:absolute;left:0;right:0;bottom:0;height:${L.foot}mm;display:flex;justify-content:center;align-items:flex-end;gap:7mm;text-align:center;font-size:${L.f.pt - 1.5}pt;color:#444;border-top:.25mm solid #999;padding-top:1.4mm}
.pf span:nth-child(2){font-weight:700;color:#222}
.empty{padding:20mm;text-align:center;color:#555}
@media screen{
  body{background:#cfd8e0;padding:10px;zoom:var(--z,1);display:flex;flex-direction:column;align-items:center}
  .sheet{margin:0 0 12px;flex:none;box-shadow:0 2px 10px rgba(0,0,0,.28)}
}
@media print{
  .sheet{height:${L.innerH}mm;width:${L.innerW}mm;padding:0;margin:0;page-break-after:always;break-after:page}
  .sheet:last-child{page-break-after:auto;break-after:auto}
}`;

  const pageHtml = (items, n) => {
    const first = n === 1;
    const head = `<div class="ph"><div><h1>${esc(o.title)}</h1><div class="sub">${esc(subParts.join('  ·  '))}</div></div><div class="meta">Gerado em ${esc(stamp)}${userTxt ? ' · por ' + esc(userTxt) : ''}</div></div>`;
    const summary = first && o.summary ? `<div class="sum"><div><span>Posições</span><b>${rows.length.toLocaleString('pt-BR')}</b></div><div><span>Aprovados p/ amostra</span><b>${ideal.toLocaleString('pt-BR')}</b></div><div><span>Peso total</span><b>${totalWeight.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg</b></div><div><span>Endereços</span><b>${addrs.toLocaleString('pt-BR')}</b></div></div>` : '';
    const thead = `<thead><tr>${cols.map(c => `<th class="${c.cls === 'n' ? 'n' : c.cls === 'c' ? 'c' : ''}">${esc(c.short || c.label)}</th>`).join('')}</tr></thead>`;
    const body = items.map(it => {
      if (it.total) {
        return `<tr class="tot">${cols.map((c, idx) => {
          let t = '';
          if (c.sum) t = totalWeight.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          else if (idx === 0) t = `TOTAL (${rows.length})`;
          return `<td class="${c.cls === 'n' ? 'n' : c.cls === 'c' ? 'c' : ''}">${esc(t)}</td>`;
        }).join('')}</tr>`;
      }
      return `<tr>${cols.map(c => {
        const t = c.get(it.r);
        let inner = esc(t);
        if (c.pill) { const k = defectFor(it.r) ? 'no' : opMatch(it.r) ? 'op' : priorityMatch(it.r) ? 'ok' : priorityRuleFor(it.r) ? 'out' : 'no'; inner = `<span class="pp ${k}">${o.eco && k === 'ok' ? '✓ ' : ''}${esc(t)}</span>`; }
        return `<td class="${c.cls === 'n' ? 'n' : c.cls === 'c' ? 'c' : c.cls === 'b' ? 'b' : ''}" title="${esc(t)}">${inner}</td>`;
      }).join('')}</tr>`;
    }).join('');
    const start = pages.slice(0, n - 1).reduce((s, p) => s + p.length, 0);
    const realRows = items.filter(x => !x.total).length;
    const range = realRows ? `Linhas ${start + 1}–${start + realRows} de ${rows.length}` : '';
    const foot = `<div class="pf"><span>NOVA — Consulta de Estoque</span><span>${o.pageNo ? `Página ${n} de ${totalPages}` : ''}</span><span>${esc(range)}</span></div>`;
    const content = rows.length ? `<table>${colgroup}${thead}<tbody>${body}</tbody></table>` : '<div class="empty">Nenhuma posição para imprimir com as opções escolhidas.</div>';
    return `<div class="sheet"><div class="inner">${head}${summary}${content}${foot}</div></div>`;
  };

  const chosen = sel.list ? sel.list : [];
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(o.title)}</title><style>${css}</style></head><body>${chosen.map(n => pageHtml(pages[n - 1], n)).join('')}</body></html>`;
  return { html, totalPages, chosen, error: sel.error || '', rowCount: rows.length, cap: L.cap, max: L.max, sheetWidthMm: L.w };
}

/* ------------------------------ interface ------------------------------ */
function renderReport() {
  rOpts = readReportForm();
  const rep = buildReport(rOpts);
  rLast = rep;
  const msg = $('rPagesMsg');
  msg.textContent = rep.error || `O relatório tem ${rep.totalPages} página(s)${rep.chosen.length !== rep.totalPages ? ` — imprimindo ${rep.chosen.length}` : ''}.`;
  msg.classList.toggle('error', !!rep.error);
  $('rRows').placeholder = `Automático (máx. ${rep.max})`;
  $('reportInfo').textContent = `${rep.rowCount.toLocaleString('pt-BR')} posição(ões) · ${rep.totalPages} página(s) · imprimindo ${rep.chosen.length}`;
  $('reportPrint').disabled = !!rep.error || !rep.rowCount || !rep.chosen.length;
  if (rep.error) return;
  const frame = $('reportFrame');
  const pane = frame.parentElement.clientWidth - 24;
  const zoom = Math.min(1, Math.max(0.2, pane / (rep.sheetWidthMm * 3.7795)));
  frame.srcdoc = rep.html.replace('<style>', `<style>:root{--z:${zoom.toFixed(3)}}`);
}
function scheduleReport() { clearTimeout(rTimer); rTimer = setTimeout(renderReport, 120); }
function openReport() {
  if (!visibleRows.length) return message('Não há posições para imprimir.', 'error');
  rOpts = loadReportOpts();
  fillReportForm(rOpts);
  $('reportModal').classList.remove('hidden');
  renderReport();
}
function closeReport() { saveReportOpts(); $('reportModal').classList.add('hidden'); $('reportFrame').srcdoc = ''; }
function printReport() {
  if (!rLast || rLast.error) return;
  saveReportOpts();
  const frame = $('reportFrame');
  try { frame.contentWindow.focus(); frame.contentWindow.print(); window.focus(); }
  catch (e) { message('Não foi possível abrir a impressão: ' + e.message, 'error'); }
}

$('closeReport').onclick = closeReport;
$('reportCancel').onclick = closeReport;
$('reportPrint').onclick = printReport;
$('reportCsv').onclick = () => exportCsv();
$('rReset').onclick = () => { rOpts = { ...REPORT_DEFAULTS }; fillReportForm(rOpts); renderReport(); };
$('reportModal').addEventListener('input', scheduleReport);
$('reportModal').addEventListener('change', scheduleReport);
$('reportModal').addEventListener('mousedown', e => { if (e.target === $('reportModal')) closeReport(); });
window.addEventListener('resize', () => { if (!$('reportModal').classList.contains('hidden')) scheduleReport(); });
