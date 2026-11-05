'use strict';
const $ = id => document.getElementById(id);
const SEARCH_TIMEOUT_MS = 200000; // a pesquisa pode ler várias páginas; o servidor limita em ~170 s
const DEFAULT_TOLERANCE = 7;
let connected = false, selected = null, currentRows = [], visibleRows = [];
let priorityRules = [];        // regras gravadas na planilha (usadas no ranking)
let draftRules = [];           // cópia editável dentro da janela (só vira regra ao salvar)
let draftSnapshot = '';        // para detectar alterações não salvas
let messageTimer = null;

/* ---------------------------- utilidades ---------------------------- */
// Versão GitHub/celular: não há servidor; protheus.js atende as mesmas rotas dentro do navegador.
const NOVA_STATIC = !!window.NovaLocal;
async function api(path, options = {}, timeoutMs = 65000) {
  if (NOVA_STATIC) return window.NovaLocal.handle(path, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    let d = {};
    try { d = await r.json(); } catch { /* resposta sem JSON */ }
    if (!r.ok) throw Object.assign(new Error(d.error || `Falha HTTP ${r.status}`), { status: r.status });
    return d;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`A API não respondeu em ${Math.round(timeoutMs / 1000)} segundos. A rede pode estar acessível, mas o serviço não concluiu a operação. Verifique a rede/VPN ou acione o TI (serviço REST do Protheus).`);
    if (e instanceof TypeError) throw new Error(['127.0.0.1', 'localhost'].includes(location.hostname)
      ? 'Não foi possível falar com o serviço local do NOVA. Confira se a janela do servidor (INICIAR_NOVA.bat) continua aberta.'
      : 'Sem conexão com o computador do NOVA. Confira se o celular está no Wi-Fi da empresa e se o computador está ligado com o NOVA aberto.');
    throw e;
  } finally { clearTimeout(timer); }
}

// kind: 'error' | 'success' | 'info' (true = error, compatível com chamadas antigas)
function message(text, kind = 'info') {
  if (kind === true) kind = 'error';
  if (kind === false) kind = 'info';
  clearTimeout(messageTimer);
  $('messageText').textContent = text;
  const box = $('message');
  box.classList.remove('hidden', 'error', 'success');
  if (kind === 'error') box.classList.add('error');
  if (kind === 'success') box.classList.add('success');
  box.querySelector('.message-icon').textContent = kind === 'error' ? '!' : kind === 'success' ? '✓' : 'i';
  if (kind !== 'error') messageTimer = setTimeout(clearMessage, 9000);
}
function clearMessage() { clearTimeout(messageTimer); $('message').classList.add('hidden'); }

function field(o, k) {
  if (!o || typeof o !== 'object') return '';
  const wanted = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
  const x = Object.keys(o).find(a => String(a).toLowerCase() === String(k).toLowerCase())
    || Object.keys(o).find(a => String(a).toLowerCase().replace(/[^a-z0-9]/g, '') === wanted);
  return x === undefined ? '' : o[x];
}
function fmt(v) { if (v === null || v === undefined) return '—'; const s = String(v).trim(); return s === '' ? '—' : s; }

// Aceita 1234.5, "1234,5", "1.234,5", "150 g/m²".
function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value ?? '').trim().replace(/\s/g, '');
  const m = s.match(/-?[0-9][0-9.,]*/);
  if (!m) return null;
  s = m[0].replace(/[.,]+$/, '');
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc >= 0) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const numericValue = parseNumber;

function dateParts(value) {
  const s = String(value ?? '').trim();
  let m;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return { y: +m[1], mo: +m[2], d: +m[3] };
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return { y: +m[1], mo: +m[2], d: +m[3] };
  if ((m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/))) return { y: +m[3], mo: +m[2], d: +m[1] };
  return null;
}
function dateValue(value) {
  const p = dateParts(value);
  if (!p || p.y < 1900 || p.mo < 1 || p.mo > 12 || p.d < 1 || p.d > 31) return 0;
  return Date.UTC(p.y, p.mo - 1, p.d);
}
function formatDate(value) {
  const p = dateParts(value);
  if (!p || !dateValue(value)) return fmt(value);
  return `${String(p.d).padStart(2, '0')}/${String(p.mo).padStart(2, '0')}/${p.y}`;
}
function normalizeFilter(value) { return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('pt-BR').replace(/[^A-Z0-9]/g, ''); }

/* ------------------------------- tema -------------------------------- */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('nova_theme', t); } catch { /* sem armazenamento local */ }
  const b = $('themeToggle'), dark = t === 'dark';
  b.textContent = dark ? '☀ Tema claro' : '☾ Tema escuro';
  b.setAttribute('aria-label', dark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro');
  $('themeToggle2').textContent = dark ? '☀' : '☾';
}

/* ------------------------------ celular ------------------------------ */
const IS_THIS_PC = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
let qrLibP = null;
function loadQrLib() {
  if (window.QRCode) return Promise.resolve();
  if (!qrLibP) qrLibP = new Promise((ok, fail) => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; sc.onload = ok; sc.onerror = fail; document.head.append(sc); });
  return qrLibP;
}
async function openPhone() {
  $('phoneModal').classList.remove('hidden');
  try {
    const d = await api('/api/network');
    $('phoneOn').classList.toggle('hidden', !d.lan); $('phoneOff').classList.toggle('hidden', !!d.lan);
    if (!d.lan) return;
    const list = d.interfaces && d.interfaces.length ? d.interfaces : d.urls.map(u => ({ url: u, name: '' }));
    const box = $('phoneUrls'); box.replaceChildren();
    if (!list.length) { const c = document.createElement('code'); c.textContent = '(nenhum endereço de rede encontrado)'; box.append(c); $('phoneQr').replaceChildren(); return; }
    const showQr = async it => {
      box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.url === it.url));
      const qr = $('phoneQr'); qr.replaceChildren(); qr.classList.remove('qr-off');
      try { await loadQrLib(); new window.QRCode(qr, { text: it.url, width: 180, height: 180, colorDark: '#0f1533', colorLight: '#ffffff' }); }
      catch { qr.textContent = 'Sem internet para gerar o código QR — digite o endereço no celular.'; qr.classList.add('qr-off'); }
    };
    list.forEach(it => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'phone-url'; b.dataset.url = it.url;
      const c = document.createElement('code'); c.textContent = it.url;
      const n = document.createElement('small'); n.textContent = it.name ? (it.wifi ? `${it.name} · rede do Wi-Fi` : `${it.name} · rede do cabo`) : '';
      b.append(c, n); b.onclick = () => showQr(it); box.append(b);
    });
    if (list.length > 1) { const h = document.createElement('p'); h.className = 'phone-hint'; h.textContent = 'Este computador está em mais de uma rede. Use o endereço que começa igual ao IP do celular (iPhone: Ajustes › Wi-Fi › ⓘ › Endereço IP). Toque em outro endereço para trocar o código QR.'; box.append(h); }
    await showQr(list[0]);
  } catch (e) { message(e.message, 'error'); }
}

/* --------------------------- telas e sessão --------------------------- */
const CODE_LEN = 12, CODE_RE = /^[A-Z0-9]{12}$/;
let currentUser = '';
function showView(name) {
  ['loginView', 'searchView', 'resultsView'].forEach(v => $(v).classList.toggle('hidden', v !== name + 'View'));
  document.body.dataset.view = name;
}
function setConnection(ok, user = '') {
  connected = ok; currentUser = ok ? user : '';
  document.querySelectorAll('[data-user]').forEach(e => { e.textContent = currentUser; });
  document.querySelectorAll('[data-avatar]').forEach(e => { e.textContent = currentUser ? currentUser.slice(0, 1).toUpperCase() : '?'; });
}
function loginError(text) { const b = $('loginError'); b.textContent = text || ''; b.classList.toggle('hidden', !text); }
function goLogin(text) {
  $('stockSection').classList.add('hidden');
  setConnection(false); showView('login'); loginError(text || '');
  $('password').value = '';
  ($('username').value ? $('password') : $('username')).focus();
}
function goSearch() {
  $('stockSection').classList.add('hidden');
  showView('search'); clearMessage();
  $('codeInput').value = ''; updateCodeInput(); renderRecent();
  $('codeInput').focus();
}
async function login(e) {
  if (e) e.preventDefault();
  if ($('connectBtn').disabled) return;
  const username = $('username').value.trim(), password = $('password').value;
  if (!username || !password) { loginError('Informe usuário e senha do Protheus.'); (username ? $('password') : $('username')).focus(); return; }
  $('connectBtn').disabled = true; $('connectBtn').innerHTML = '<span class="spinner"></span> Validando acesso…'; loginError('');
  try {
    const d = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password, remember: $('remember').checked, apiUrl: $('apiUrl') ? $('apiUrl').value.trim() : '' }) }, 45000);
    $('password').value = '';
    setConnection(true, d.username);
    goSearch();
    if (d.remembered && d.savedOnDisk === false) message('Conectado por 30 dias. Se o computador do NOVA for reiniciado ou a janela do servidor for fechada, será preciso entrar de novo.', 'info');
  } catch (err) {
    loginError(err.message || 'Não foi possível validar o acesso.');
    if (err.status === 401) { $('password').value = ''; $('password').focus(); }
  } finally { $('connectBtn').disabled = false; $('connectBtn').textContent = 'Entrar'; }
}
async function logout() {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch { /* sessão local já descartada */ }
  currentRows = []; visibleRows = [];
  goLogin(''); message('Sessão encerrada.', 'info');
}
function requireLogin() { goLogin('Sua sessão expirou ou o Protheus recusou as credenciais. Entre novamente.'); }

function cleanCode(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN); }
function updateCodeInput() {
  const el = $('codeInput'), v = cleanCode(el.value);
  if (el.value !== v) el.value = v;
  $('codeCount').textContent = `${v.length}/${CODE_LEN}`;
  $('codeCount').classList.toggle('done', v.length === CODE_LEN);
  $('codeBtn').disabled = v.length !== CODE_LEN;
}
const HISTORY_KEY = 'nova_history_v1', HISTORY_MAX = 50;
function getHistory() {
  try { const a = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); return Array.isArray(a) ? a.filter(x => x && CODE_RE.test(x.code)).slice(0, HISTORY_MAX) : []; } catch { return []; }
}
function saveHistory(list) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))); } catch { /* sem armazenamento local */ } }
function addHistory(code, description, positions, approved) { saveHistory([{ code, description, positions, approved, at: Date.now() }, ...getHistory()]); }
function rerun(code) { closeHistory(); $('codeInput').value = code; updateCodeInput(); search(code, document.body.dataset.view === 'results' ? 'results' : 'search'); }
// Os atalhos de pesquisas recentes saíram da tela; o histórico completo fica em "Ver histórico".
function renderRecent() { $('openHistory').classList.toggle('hidden', !getHistory().length); }

function fmtWhen(ts) {
  const d = new Date(ts); if (!ts || isNaN(d)) return '—';
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function renderHistory() {
  const term = normalizeFilter($('historyFilter').value), box = $('historyList'); box.replaceChildren();
  const all = getHistory(), list = all.filter(h => !term || normalizeFilter(h.code + ' ' + (h.description || '')).includes(term));
  $('historyCount').textContent = `${all.length} de ${HISTORY_MAX} consultas guardadas`;
  if (!list.length) { const e = document.createElement('div'); e.className = 'history-empty'; e.textContent = all.length ? 'Nenhuma consulta corresponde ao filtro.' : 'Nenhuma consulta ainda.'; box.append(e); return; }
  list.forEach(h => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'history-item'; b.title = `Pesquisar ${h.code} novamente`;
    const code = document.createElement('b'); code.textContent = h.code;
    const desc = document.createElement('span'); desc.className = 'h-desc'; desc.textContent = h.description || 'Descrição não informada';
    const meta = document.createElement('span'); meta.className = 'h-meta';
    meta.textContent = [Number.isFinite(h.positions) ? `${h.positions} rolo(s)` : '', Number.isFinite(h.approved) ? `${h.approved} aprovado(s)` : ''].filter(Boolean).join(' · ');
    const when = document.createElement('time'); when.textContent = fmtWhen(h.at);
    b.append(code, desc, meta, when); b.onclick = () => rerun(h.code); box.append(b);
  });
}
function openHistory() { $('historyFilter').value = ''; renderHistory(); $('historyModal').classList.remove('hidden'); $('historyFilter').focus(); }
function closeHistory() { $('historyModal').classList.add('hidden'); }

/* ------------------------- gramatura / ranking ------------------------ */
function gramaturaValue(row) { return parseNumber(field(row, 'Z5_GRAMATU')); }
// Ordem das regras: 1) planilha local (grupo ou código do produto) — permite ajustar/sobrescrever;
// 2) gramatura ideal do cadastro de grupos do Protheus (SBM.BM_GRAMTIN), com tolerância padrão.
// Uma regra local desativada também desativa a do Protheus para aquele grupo.
function priorityRuleFor(row) {
  const keys = [field(row, 'Z6_GRUPO'), field(row, 'B1_GRUPO'), field(row, 'Z5_PROD')].map(normalizeFilter).filter(Boolean);
  if (!keys.length) return null;
  const local = priorityRules.find(rule => keys.includes(normalizeFilter(rule.group)));
  if (local) return local.active !== false ? { ...local, source: 'planilha' } : null;
  const ideal = parseNumber(field(row, 'BM_GRAMTIN'));
  if (ideal !== null && ideal > 0) {
    return { group: String(field(row, 'Z6_GRUPO') || field(row, 'B1_GRUPO') || '').trim(), description: String(field(row, 'BM_DESC') || '').trim(), gramatura: ideal, tolerance: DEFAULT_TOLERANCE, active: true, source: 'protheus' };
  }
  return null;
}
const ruleSourceLabel = rule => rule?.source === 'protheus' ? 'Protheus (SBM · BM_GRAMTIN)' : 'planilha local';
// Aprovado para amostra = gramatura no padrão E sem defeito registrado para a OP.
function priorityMatch(row) { return !defectFor(row) && gramaturaOk(row); }
function gramaturaOk(row) {
  const rule = priorityRuleFor(row), gram = gramaturaValue(row);
  if (!rule || gram === null) return false;
  const ideal = Number(rule.gramatura), tol = Number(rule.tolerance ?? DEFAULT_TOLERANCE);
  if (!Number.isFinite(ideal) || !Number.isFinite(tol)) return false;
  // pequena folga evita falha por arredondamento de ponto flutuante nos limites da faixa
  const eps = 1e-9;
  return gram >= ideal * (1 - tol / 100) - eps && gram <= ideal * (1 + tol / 100) + eps;
}
/* ------------------------- local prioritário ------------------------- */
// Rolos no armazém 93 e/ou nos endereços AM01 / AM02 sobem para o topo.
const PRIORITY_WAREHOUSE = '93', PRIORITY_ADDR_PREFIXES = ['AM01', 'AM02'];
function locationScore(r) {
  const wh = String(field(r, 'Z5_ALMOXA') ?? '').trim() === PRIORITY_WAREHOUSE;
  const ad = normalizeFilter(field(r, 'Z5_ENDEREC'));
  const am = PRIORITY_ADDR_PREFIXES.some(p => ad.startsWith(p));
  return (wh ? 1 : 0) + (am ? 1 : 0);
}
function locationTag(r) {
  if (!locationScore(r)) return null;
  const parts = [];
  if (String(field(r, 'Z5_ALMOXA') ?? '').trim() === PRIORITY_WAREHOUSE) parts.push('Arm. 93');
  const ad = normalizeFilter(field(r, 'Z5_ENDEREC')), pre = PRIORITY_ADDR_PREFIXES.find(p => ad.startsWith(p));
  if (pre) parts.push(pre);
  const t = document.createElement('span'); t.className = 'loc-tag'; t.textContent = '📍 ' + parts.join(' · ');
  t.title = 'Local prioritário (armazém 93 / endereços AM01 e AM02)'; return t;
}

/* --------------------------- malhas com defeito --------------------------- */
// Planilha dados/MALHAS_RUINS.csv: uma linha por produto + OP.
const DEFECT_OPTIONS = [['BARRAMENTO', 'Barramento'], ['QUEBRADURA', 'Quebradura'], ['MANCHAS', 'Manchas'], ['SUJA', 'Suja'], ['OUTROS', 'Outros']];
let defects = new Map(), defectTarget = null;
const defectKey = (prod, op) => `${String(prod || '').trim().toUpperCase()}|${String(op || '').trim()}`;
function setDefects(rows) { defects = new Map((rows || []).map(d => [defectKey(d.produto, d.op), d])); }
async function loadDefects() { if (!connected) return; const d = await api('/api/defects'); setDefects(d.rows); return d; }
function defectFor(r) { return defects.get(defectKey(field(r, 'Z5_PROD'), field(r, 'Z5_OP'))) || null; }
function defectText(d) { return d.defeitos.map(x => x === 'OUTROS' && d.outros ? d.outros.toUpperCase() : x).join(' · '); }
function defectPill(d) {
  const pill = document.createElement('span'); pill.className = 'priority-pill defect';
  pill.textContent = '✕ ' + defectText(d);
  pill.title = `Defeito registrado${d.usuario ? ' por ' + d.usuario : ''}${d.data ? ' em ' + d.data : ''}${d.observacao ? ' — ' + d.observacao : ''}`;
  return pill;
}
function openDefect(g) {
  const prod = String(field(g.rows[0], 'Z5_PROD') || selected?.code || '').trim().toUpperCase();
  defectTarget = { produto: prod, op: g.op, partida: g.partida };
  const cur = defects.get(defectKey(prod, g.op));
  $('defectSub').textContent = `Produto ${prod} · OP ${g.op || '—'} · Partida ${g.partida || '—'}`;
  const box = $('defectOptions'); box.replaceChildren();
  DEFECT_OPTIONS.forEach(([v, label]) => {
    const l = document.createElement('label'); l.className = 'defect-opt';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = v; cb.checked = !!cur && cur.defeitos.includes(v);
    cb.onchange = () => { $('defectError').classList.add('hidden'); l.classList.toggle('on', cb.checked); if (v === 'OUTROS') { $('defectOtherWrap').classList.toggle('hidden', !cb.checked); if (cb.checked) $('defectOther').focus(); } };
    const t = document.createElement('span'); t.textContent = label;
    l.append(cb, t); l.classList.toggle('on', cb.checked); box.append(l);
  });
  $('defectOther').value = cur?.outros || ''; $('defectOtherWrap').classList.toggle('hidden', !(cur && cur.defeitos.includes('OUTROS')));
  $('defectObs').value = cur?.observacao || '';
  $('defectInfo').textContent = cur ? `Registrado${cur.usuario ? ' por ' + cur.usuario : ''}${cur.data ? ' em ' + cur.data : ''}.` : '';
  $('defectRemove').classList.toggle('hidden', !cur);
  $('defectError').classList.add('hidden');
  $('defectModal').classList.remove('hidden');
}
function closeDefect() { $('defectModal').classList.add('hidden'); defectTarget = null; }
function defectError(t) { $('defectError').textContent = t; $('defectError').classList.remove('hidden'); }
async function saveDefect() {
  if (!defectTarget) return;
  const defeitos = [...$('defectOptions').querySelectorAll('input:checked')].map(x => x.value);
  if (!defeitos.length) return defectError('Selecione pelo menos um defeito.');
  if (defeitos.includes('OUTROS') && !$('defectOther').value.trim()) { $('defectOther').focus(); return defectError('Descreva o defeito em "Outros".'); }
  const btn = $('defectSave'); btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    const d = await api('/api/defects', { method: 'POST', body: JSON.stringify({ ...defectTarget, defeitos, outros: $('defectOther').value, observacao: $('defectObs').value }) });
    setDefects(d.rows); const op = defectTarget.op; closeDefect(); refreshAfterDefect();
    message(`Defeito registrado para a OP ${op}: ${defectText(d.row)}. ${NOVA_STATIC ? 'Guardado neste aparelho.' : 'Gravado na planilha MALHAS_RUINS.csv.'}`, 'success');
  } catch (e) { defectError(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Salvar na planilha'; }
}
async function removeDefect() {
  if (!defectTarget || !confirm(`Remover a marcação de defeito da OP ${defectTarget.op}?`)) return;
  try {
    const d = await api(`/api/defects?produto=${encodeURIComponent(defectTarget.produto)}&op=${encodeURIComponent(defectTarget.op)}`, { method: 'DELETE' });
    setDefects(d.rows); const op = defectTarget.op; closeDefect(); refreshAfterDefect();
    message(`Marcação de defeito removida da OP ${op}.`, 'success');
  } catch (e) { defectError(e.message); }
}
// redesenha a lista (a OP com defeito vai para o fim) e reabre o mesmo grupo na janela
function refreshAfterDefect() {
  const key = groupIndex >= 0 ? currentGroups[groupIndex]?.key : null;
  applyFilters();
  if (key && !$('groupModal').classList.contains('hidden')) { const i = currentGroups.findIndex(g => g.key === key); if (i >= 0) openGroup(i); }
}

/* ------------------------------- pastas ------------------------------- */
// Pastas de separação: OPs salvas com seus rolos, para buscar depois e marcar o que já foi pego.
// Compartilhadas: gravadas numa Planilha Google (Apps Script) — todos os usuários e aparelhos veem as mesmas.
// Sem planilha configurada: ficam só neste aparelho (navegador).
const FOLDERS_KEY = 'nova_pastas_v1', FCACHE_KEY = 'nova_pastas_cache_v1', FACTIVE_KEY = 'nova_pastas_active', PURL_KEY = 'nova_pastas_url', PKEY_KEY = 'nova_pastas_key';
const FOLDER_POLL_MS = 20000;
let folderOpenId = null, folderShow = 'todo', folderPickPending = null, folderTimer = null, folderSyncAt = 0, folderBusy = false;
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const lsDel = k => { try { localStorage.removeItem(k); } catch { /* sem armazenamento */ } };
const pastasUrl = () => String((window.NOVA_CONFIG && window.NOVA_CONFIG.pastasUrl) || lsGet(PURL_KEY, '') || '').trim();
const teamKey = () => String(lsGet(PKEY_KEY, '') || '');
const isShared = () => !!(pastasUrl() && teamKey());
function localFolders() { const d = lsGet(FOLDERS_KEY, null); return d && Array.isArray(d.folders) ? d : { active: null, folders: [] }; }
function readFolders() {
  if (!isShared()) return localFolders();
  const c = lsGet(FCACHE_KEY, null);
  return { active: lsGet(FACTIVE_KEY, null), folders: c && Array.isArray(c.folders) ? c.folders : [] };
}
// modo compartilhado: aqui só se guarda a pasta ativa deste aparelho; o conteúdo vai pela planilha
function writeFolders(d) {
  if (isShared()) return lsSet(FACTIVE_KEY, d.active || null);
  if (!lsSet(FOLDERS_KEY, d)) { message('Não foi possível guardar a pasta neste aparelho (armazenamento cheio ou bloqueado).', 'error'); return false; }
  return true;
}
function setActive(id) { const d = readFolders(); d.active = id; writeFolders(d); }
async function remote(action, data = {}, { url = pastasUrl(), key = teamKey() } = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
  let r;
  try {
    // text/plain: o Google aceita sem pedido prévio de permissão (CORS)
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, key, user: currentUser || '', ...data }), redirect: 'follow', signal: ctl.signal, cache: 'no-store' });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'A planilha das pastas não respondeu em 30 segundos. Confira a internet.' : 'Sem conexão com a planilha das pastas. Confira a internet.');
  } finally { clearTimeout(t); }
  let j;
  try { j = await r.json(); } catch { throw new Error('A planilha das pastas respondeu de um jeito inesperado. Confira o endereço (URL do app da Web) configurado.'); }
  if (!j || !j.ok) throw new Error((j && j.error) || 'Falha ao falar com a planilha das pastas.');
  if (Array.isArray(j.folders) && url === pastasUrl()) { lsSet(FCACHE_KEY, { folders: j.folders, at: Date.now() }); folderSyncAt = Date.now(); }
  return j;
}
async function syncFolders(silent = true) {
  if (!isShared()) return false;
  try { await remote('list'); return true; }
  catch (e) { if (!silent) message(`${e.message} Mostrando a última cópia baixada.`, 'error'); return false; }
}
function rerenderFolders() {
  if ($('foldersModal').classList.contains('hidden')) return;
  if (!$('folderView').classList.contains('hidden')) renderFolder(); else renderFoldersList();
}
function startFolderPoll() {
  stopFolderPoll();
  if (!isShared()) return;
  folderTimer = setInterval(async () => { if (folderBusy || document.hidden) return; if (await syncFolders(true)) { rerenderFolders(); updateFolderUi(); } }, FOLDER_POLL_MS);
}
function stopFolderPoll() { if (folderTimer) clearInterval(folderTimer); folderTimer = null; }
// executa uma gravação: compartilhada (planilha) ou local; depois atualiza a tela
async function folderOp(sharedFn, localFn) {
  if (isShared()) {
    folderBusy = true;
    try { await sharedFn(); return true; }
    catch (e) { message(e.message, 'error'); await syncFolders(true); return false; }
    finally { folderBusy = false; rerenderFolders(); updateFolderUi(); }
  }
  const ok = localFn() !== false; rerenderFolders(); updateFolderUi(); return ok;
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const folderById = (d, id) => d.folders.find(f => f.id === id) || null;
const activeFolder = () => { const d = readFolders(); return folderById(d, d.active); };
const itemKey = (prod, op, partida) => `${String(prod || '').trim().toUpperCase()}|${String(op || '').trim()}|${String(partida || '').trim()}`;
function folderStats(f) {
  let total = 0, done = 0;
  f.items.forEach(it => it.rolos.forEach(r => { total++; if (r.picked) done++; }));
  return { ops: f.items.length, total, done };
}
function updateFolderUi() {
  const f = activeFolder();
  $('activeFolderBar').classList.toggle('hidden', !f);
  if (f) $('activeFolderName').textContent = f.name;
  $('foldersBtn2Label').textContent = f ? f.name : 'Pastas';
  $('foldersBtn2').classList.toggle('active', !!f);
  const h = document.querySelector('#codeForm h1');
  if (h) h.textContent = f ? 'Qual código deseja procurar?' : 'Consultar material';
  updateSaveBtn();
}
function updateSaveBtn() {
  const btn = $('saveGroupBtn'), g = currentGroups[groupIndex];
  if (!btn || !g || btn.dataset.busy) return;
  const f = activeFolder(), k = itemKey(field(g.rows[0], 'Z5_PROD'), g.op, g.partida);
  const saved = f && f.items.some(it => it.key === k);
  btn.classList.toggle('saved', !!saved);
  btn.textContent = saved ? `✓ Salvo em ${f.name}` : (f ? `💾 Salvar em ${f.name}` : '💾 Salvar');
  btn.title = saved ? 'Toque para atualizar os rolos ou remover da pasta' : 'Salvar esta OP e os rolos numa pasta';
}
function snapshotGroup(g) {
  const prod = String(field(g.rows[0], 'Z5_PROD') || selected?.code || '').trim().toUpperCase();
  const addrs = [...new Set(g.rows.map(addrOf).filter(Boolean))];
  return {
    key: itemKey(prod, g.op, g.partida), produto: prod, descricao: selected?.description || groupLabel(g.rows[0]),
    op: g.op, partida: g.partida, enderecos: addrs.join(' - '), savedAt: Date.now(),
    status: (() => { const d = defectFor(g.rows[0]); return d ? 'DEFEITO: ' + defectText(d) : opMatch(g.rows[0]) ? 'INDICADO POR OP' : g.rows.some(priorityMatch) ? 'APROVADO P/ AMOSTRA' : 'NÃO INDICADO'; })(),
    rolos: g.rows.map(r => ({ rg: rgOf(r), endereco: addrOf(r), armazem: String(field(r, 'Z5_ALMOXA') ?? '').trim(), peso: numericValue(field(r, 'Z5_PESOATU')), gramatura: gramaturaValue(r), cmc: numericValue(field(r, 'Z5_CMC')), picked: false }))
      .sort((a, b) => a.endereco.localeCompare(b.endereco, 'pt-BR', { numeric: true }))
  };
}
async function saveGroupTo(folderId) {
  const g = currentGroups[groupIndex]; if (!g) return;
  const snap = snapshotGroup(g), btn = $('saveGroupBtn');
  const before = folderById(readFolders(), folderId), existed = !!(before && before.items.some(it => it.key === snap.key));
  btn.disabled = true; btn.dataset.busy = '1'; btn.textContent = 'Salvando…';
  const ok = await folderOp(
    async () => { await remote('saveItem', { folderId, item: snap }); setActive(folderId); },
    () => {
      const d = readFolders(), f = folderById(d, folderId); if (!f) return false;
      const old = f.items.find(it => it.key === snap.key);
      if (old) { const picked = new Set(old.rolos.filter(r => r.picked).map(r => r.rg)); snap.rolos.forEach(r => { r.picked = picked.has(r.rg); }); f.items[f.items.indexOf(old)] = snap; }
      else f.items.push(snap);
      d.active = f.id; f.updatedAt = Date.now();
      return writeFolders(d);
    });
  btn.disabled = false; delete btn.dataset.busy; updateSaveBtn();
  const f = folderById(readFolders(), folderId);
  if (ok && f) message(`${existed ? 'Atualizado' : 'Salvo'} em "${f.name}"${isShared() ? ' (compartilhada)' : ''}: OP ${snap.op} · ${snap.rolos.length} rolo(s) · ${snap.enderecos || 'sem endereço'}.`, 'success');
}
async function removeItemFrom(folderId, key) {
  return folderOp(
    () => remote('removeItem', { folderId, itemKey: key }),
    () => { const d = readFolders(), f = folderById(d, folderId); if (!f) return false; f.items = f.items.filter(x => x.key !== key); f.updatedAt = Date.now(); return writeFolders(d); });
}
async function onSaveGroup() {
  const g = currentGroups[groupIndex]; if (!g) return;
  const f = activeFolder();
  if (!f) { folderPickPending = true; openFolders(); return; }
  const k = itemKey(field(g.rows[0], 'Z5_PROD'), g.op, g.partida);
  if (f.items.some(it => it.key === k)) {
    if (confirm(`A OP ${g.op} já está na pasta "${f.name}".\n\nOK = remover da pasta\nCancelar = atualizar os rolos (mantém o que já foi pego)`)) {
      if (await removeItemFrom(f.id, k)) message(`OP ${g.op} removida da pasta "${f.name}".`, 'info');
      return;
    }
  }
  saveGroupTo(f.id);
}
function fmtDay(ts) { const d = new Date(ts); return !ts || isNaN(d) ? '' : d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
async function openFolders() {
  $('folderView').classList.add('hidden'); $('foldersList').classList.remove('hidden');
  $('folderPickMsg').classList.toggle('hidden', !folderPickPending);
  if (folderPickPending) $('folderPickMsg').textContent = 'Escolha a pasta onde salvar esta OP, ou crie uma nova.';
  renderFoldersList();
  $('foldersModal').classList.remove('hidden');
  if (folderPickPending) $('newFolderName').focus();
  startFolderPoll();
  if (await syncFolders(false)) { rerenderFolders(); updateFolderUi(); }
}
function closeFolders() { $('foldersModal').classList.add('hidden'); folderPickPending = null; stopFolderPoll(); }
function renderSharedBox() {
  const box = $('sharedBox'); box.replaceChildren();
  const fixedUrl = !!(window.NOVA_CONFIG && window.NOVA_CONFIG.pastasUrl);
  if (isShared()) {
    box.className = 'shared-box on';
    const t = document.createElement('span');
    t.textContent = `🟢 Compartilhadas com a equipe (Planilha Google)${folderSyncAt ? ' · atualizado ' + new Date(folderSyncAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}`;
    const up = document.createElement('button'); up.type = 'button'; up.className = 'link-btn'; up.textContent = '↻ Atualizar';
    up.onclick = async () => { if (await syncFolders(false)) { rerenderFolders(); updateFolderUi(); } };
    const off = document.createElement('button'); off.type = 'button'; off.className = 'link-btn'; off.textContent = 'Desconectar';
    off.onclick = () => { if (!confirm('Desconectar este aparelho das pastas compartilhadas? (nada é apagado da planilha)')) return; lsDel(PKEY_KEY); if (!fixedUrl) lsDel(PURL_KEY); lsDel(FCACHE_KEY); stopFolderPoll(); renderFoldersList(); updateFolderUi(); };
    box.append(t, up, off);
    const local = localFolders().folders.filter(f => f.items.length);
    if (local.length) {
      const mig = document.createElement('button'); mig.type = 'button'; mig.className = 'secondary migrate-btn';
      mig.textContent = `⇪ Enviar ${local.length} pasta(s) deste aparelho para a planilha`;
      mig.onclick = migrateLocal; box.append(mig);
    }
    return;
  }
  box.className = 'shared-box off';
  const p = document.createElement('p'); p.innerHTML = '<b>Estas pastas estão só neste aparelho.</b> Para todos verem as mesmas pastas, conecte a planilha da equipe:';
  const form = document.createElement('form'); form.className = 'shared-form'; form.noValidate = true;
  const url = document.createElement('input'); url.type = 'url'; url.placeholder = 'URL do app da Web (https://script.google.com/…)'; url.autocomplete = 'off'; url.setAttribute('aria-label', 'URL da planilha das pastas'); url.value = lsGet(PURL_KEY, '') || '';
  const key = document.createElement('input'); key.type = 'password'; key.placeholder = 'Código da equipe'; key.autocomplete = 'off'; key.setAttribute('aria-label', 'Código da equipe');
  const go = document.createElement('button'); go.type = 'submit'; go.className = 'primary'; go.textContent = 'Conectar';
  if (!fixedUrl) form.append(url);
  form.append(key, go);
  form.onsubmit = async e => {
    e.preventDefault();
    const u = fixedUrl ? pastasUrl() : url.value.trim(), k = key.value.trim();
    if (!fixedUrl && !/^https:\/\/script\.google(usercontent)?\.com\//i.test(u)) return message('Cole o "URL do app da Web" do Apps Script (começa com https://script.google.com/).', 'error');
    if (!k) { key.focus(); return message('Digite o código da equipe.', 'error'); }
    go.disabled = true; go.textContent = 'Conectando…';
    try {
      const j = await remote('list', {}, { url: u, key: k });
      if (!fixedUrl) lsSet(PURL_KEY, u);
      lsSet(PKEY_KEY, k); lsSet(FCACHE_KEY, { folders: j.folders || [], at: Date.now() }); folderSyncAt = Date.now();
      message(`Conectado às pastas da equipe: ${(j.folders || []).length} pasta(s).`, 'success');
      renderFoldersList(); updateFolderUi(); startFolderPoll();
    } catch (err) { message(err.message, 'error'); }
    finally { go.disabled = false; go.textContent = 'Conectar'; }
  };
  box.append(p, form);
}
async function migrateLocal() {
  const local = localFolders().folders.filter(f => f.items.length);
  if (!local.length) return;
  folderBusy = true; let n = 0;
  try {
    for (const lf of local) {
      const j = await remote('createFolder', { name: lf.name });
      for (const it of lf.items) { await remote('saveItem', { folderId: j.folder.id, item: it }); n++; }
    }
    const d = localFolders(); d.folders = d.folders.filter(f => !local.some(l => l.id === f.id)); lsSet(FOLDERS_KEY, d);
    message(`${local.length} pasta(s) e ${n} OP(s) enviadas para a planilha da equipe.`, 'success');
  } catch (e) { message(`${e.message} (${n} OP(s) enviadas até aqui — pode tentar de novo, não duplica).`, 'error'); }
  finally { folderBusy = false; await syncFolders(true); rerenderFolders(); updateFolderUi(); }
}
function renderFoldersList() {
  renderSharedBox();
  const d = readFolders(), box = $('foldersItems'); box.replaceChildren();
  if (!d.folders.length) { const e = document.createElement('div'); e.className = 'history-empty'; e.textContent = 'Nenhuma pasta ainda. Dê um nome acima e toque em Criar pasta.'; box.append(e); return; }
  [...d.folders].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)).forEach(f => {
    const st = folderStats(f);
    const card = document.createElement('div'); card.className = 'folder-card' + (f.id === d.active ? ' active' : '');
    const info = document.createElement('button'); info.type = 'button'; info.className = 'folder-info';
    const n = document.createElement('b'); n.textContent = '📁 ' + f.name + (f.id === d.active ? '  · ativa' : '');
    const m = document.createElement('span'); m.textContent = `${st.ops} OP(s) · ${st.done} de ${st.total} rolo(s) pegos${f.createdBy ? ' · criada por ' + f.createdBy : ''} · ${fmtDay(f.createdAt)}`;
    const bar = document.createElement('i'); bar.className = 'mini-bar'; bar.style.setProperty('--p', st.total ? (st.done / st.total * 100).toFixed(0) + '%' : '0%');
    info.append(n, m, bar);
    info.onclick = () => { if (folderPickPending) { folderPickPending = null; closeFolders(); saveGroupTo(f.id); } else openFolder(f.id); };
    card.append(info);
    if (folderPickPending) { const b = document.createElement('button'); b.type = 'button'; b.className = 'primary'; b.textContent = 'Salvar aqui'; b.onclick = info.onclick; card.append(b); }
    box.append(card);
  });
}
async function createFolder(name) {
  name = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) { $('newFolderName').focus(); return message('Dê um nome para a pasta.', 'error'); }
  let id = null, existed = false;
  const btn = $('newFolderForm').querySelector('.primary'); btn.disabled = true;
  const ok = await folderOp(
    async () => { const j = await remote('createFolder', { name }); id = j.folder.id; existed = !!j.folder.existed; setActive(id); },
    () => {
      const d = readFolders();
      if (d.folders.some(f => f.name.toLowerCase() === name.toLowerCase())) { message(`Já existe uma pasta "${name}". Abra-a na lista.`, 'error'); return false; }
      const f = { id: newId(), name, createdAt: Date.now(), updatedAt: Date.now(), createdBy: currentUser || '', items: [] };
      d.folders.push(f); d.active = f.id; id = f.id; return writeFolders(d);
    });
  btn.disabled = false;
  if (!ok || !id) return;
  $('newFolderName').value = '';
  updateFolderUi();
  if (folderPickPending) { folderPickPending = null; closeFolders(); return saveGroupTo(id); }
  closeFolders();
  // pasta criada: volta para a pesquisa perguntando o código
  if (document.body.dataset.view !== 'search') goSearch(); else { $('codeInput').value = ''; updateCodeInput(); $('codeInput').focus(); }
  message(existed ? `A pasta "${name}" já existia e agora está ativa. Qual código deseja procurar?` : `Pasta "${name}" criada. Qual código deseja procurar? Abra a OP e toque em 💾 Salvar.`, 'success');
}
async function openFolder(id) {
  folderOpenId = id;
  $('foldersList').classList.add('hidden'); $('folderView').classList.remove('hidden');
  $('foldersModal').classList.remove('hidden');
  renderFolder();
  startFolderPoll();
  if (await syncFolders(false)) { rerenderFolders(); updateFolderUi(); }
}
async function deleteFolderAction() {
  const d = readFolders(), f = folderById(d, folderOpenId);
  if (!f || !confirm(`Excluir a pasta "${f.name}" e todas as OPs salvas nela?${isShared() ? '\n\nEla some para TODOS os usuários.' : ''}`)) return;
  const ok = await folderOp(
    async () => { await remote('deleteFolder', { folderId: f.id }); if (lsGet(FACTIVE_KEY, null) === f.id) setActive(null); },
    () => { d.folders = d.folders.filter(x => x.id !== f.id); if (d.active === f.id) d.active = null; return writeFolders(d); });
  if (ok) { openFolders(); message(`Pasta "${f.name}" excluída.`, 'info'); }
}
function renderFolder() {
  const d = readFolders(), f = folderById(d, folderOpenId);
  if (!f) { $('folderView').classList.add('hidden'); $('foldersList').classList.remove('hidden'); renderFoldersList(); return; }
  const st = folderStats(f);
  $('folderName').textContent = '📁 ' + f.name;
  $('folderSub').textContent = `${st.ops} OP(s) · ${st.done} de ${st.total} rolo(s) pegos${isShared() ? ' · compartilhada' : ' · só neste aparelho'}`;
  $('folderBar').style.width = st.total ? (st.done / st.total * 100).toFixed(1) + '%' : '0%';
  $('folderUse').textContent = d.active === f.id ? '✓ Pasta ativa' : 'Usar para salvar';
  $('folderUse').disabled = d.active === f.id;
  document.querySelectorAll('#folderView .seg button').forEach(b => b.classList.toggle('on', b.dataset.show === folderShow));
  const body = $('folderBody'); body.replaceChildren();
  if (!f.items.length) { const e = document.createElement('div'); e.className = 'history-empty'; e.textContent = 'Pasta vazia. Toque em "Pesquisar código", abra a OP e use 💾 Salvar.'; body.append(e); return; }
  const byProd = new Map();
  f.items.forEach(it => { if (!byProd.has(it.produto)) byProd.set(it.produto, []); byProd.get(it.produto).push(it); });
  let shown = 0;
  byProd.forEach((items, prod) => {
    const sec = document.createElement('section'); sec.className = 'folder-prod';
    const h = document.createElement('div'); h.className = 'folder-prod-head';
    const t = document.createElement('b'); t.textContent = prod;
    const ds = document.createElement('span'); ds.textContent = items[0].descricao || '';
    const again = document.createElement('button'); again.type = 'button'; again.className = 'link-btn'; again.textContent = '🔍 Pesquisar de novo';
    again.onclick = () => { closeFolders(); rerun(prod); };
    h.append(t, ds, again); sec.append(h);
    let secShown = 0;
    items.forEach(it => {
      const rolls = it.rolos.filter(r => folderShow === 'all' || (folderShow === 'done' ? r.picked : !r.picked));
      if (!rolls.length) return;
      secShown++; shown += rolls.length;
      const card = document.createElement('div'); card.className = 'folder-op' + (it.rolos.every(r => r.picked) ? ' all-done' : '');
      const top = document.createElement('div'); top.className = 'folder-op-top';
      const op = document.createElement('b'); op.textContent = `OP ${it.op || '—'} · Partida ${it.partida || '—'}`;
      const cnt = document.createElement('span'); cnt.className = 'folder-op-count'; cnt.textContent = `${it.rolos.filter(r => r.picked).length}/${it.rolos.length}`;
      const del = document.createElement('button'); del.type = 'button'; del.className = 'remove-priority'; del.textContent = '×'; del.title = 'Tirar esta OP da pasta'; del.setAttribute('aria-label', 'Tirar esta OP da pasta');
      del.onclick = async () => { if (!confirm(`Tirar a OP ${it.op} da pasta "${f.name}"?`)) return; await removeItemFrom(f.id, it.key); updateSaveBtn(); };
      top.append(op, cnt, del);
      const ad = document.createElement('div'); ad.className = 'folder-op-addr'; ad.textContent = '📍 ' + (it.enderecos || 'sem endereço');
      const st2 = document.createElement('div'); st2.className = 'folder-op-status'; st2.textContent = [it.status || '', it.savedBy ? 'salvo por ' + it.savedBy : ''].filter(Boolean).join(' · ');
      if (/^DEFEITO/.test(it.status || '')) st2.classList.add('bad');
      card.append(top, ad, st2);
      const ul = document.createElement('div'); ul.className = 'folder-rolls';
      rolls.forEach(r => {
        const l = document.createElement('label'); l.className = 'folder-roll' + (r.picked ? ' picked' : '');
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!r.picked; cb.setAttribute('aria-label', `Peguei o rolo ${r.rg}`);
        cb.onchange = () => togglePicked(f.id, it.key, r, cb.checked, l, cnt);
        const rg = document.createElement('b'); rg.textContent = r.rg || '—';
        const ed = document.createElement('span'); ed.className = 'roll-addr'; ed.textContent = r.endereco || '—';
        const meta = document.createElement('small');
        meta.textContent = [r.armazem ? 'Arm. ' + r.armazem : '', r.peso !== null && r.peso !== undefined ? fmtNum(r.peso, 2) + ' kg' : '', r.gramatura ? fmtNum(r.gramatura, 0, 2) + ' g/m²' : '', r.picked && r.pickedBy ? '✓ ' + r.pickedBy : ''].filter(Boolean).join(' · ');
        l.append(cb, rg, ed, meta); ul.append(l);
      });
      card.append(ul); sec.append(card);
    });
    if (secShown) body.append(sec);
  });
  if (!shown) { const e = document.createElement('div'); e.className = 'history-empty'; e.textContent = folderShow === 'todo' ? '🎉 Tudo pego nesta pasta.' : 'Nenhum rolo marcado como pego ainda.'; body.append(e); }
}
// marca/desmarca: muda na hora na tela e grava (planilha ou aparelho); se falhar, volta
async function togglePicked(folderId, key, r, picked, label, cnt) {
  const apply = d => { const f = folderById(d, folderId), it = f && f.items.find(x => x.key === key), rr = it && it.rolos.find(x => x.rg === r.rg && x.endereco === r.endereco); if (rr) { rr.picked = picked; rr.pickedAt = picked ? Date.now() : null; rr.pickedBy = picked ? (currentUser || '') : ''; } return { f, it }; };
  label.classList.toggle('picked', picked);
  const showNow = () => {
    const d = readFolders(), f = folderById(d, folderId), it = f && f.items.find(x => x.key === key); if (!f || !it) return;
    const s2 = folderStats(f); $('folderSub').textContent = `${s2.ops} OP(s) · ${s2.done} de ${s2.total} rolo(s) pegos${isShared() ? ' · compartilhada' : ' · só neste aparelho'}`;
    $('folderBar').style.width = s2.total ? (s2.done / s2.total * 100).toFixed(1) + '%' : '0%';
    cnt.textContent = `${it.rolos.filter(x => x.picked).length}/${it.rolos.length}`;
  };
  if (isShared()) {
    const c = lsGet(FCACHE_KEY, { folders: [] }); apply(c); lsSet(FCACHE_KEY, c); showNow();
    folderBusy = true;
    try { await remote('setPicked', { folderId, itemKey: key, rg: r.rg, endereco: r.endereco, picked }); }
    catch (e) { message(`${e.message} A marcação não foi gravada.`, 'error'); await syncFolders(true); }
    finally { folderBusy = false; }
  } else {
    const d = readFolders(); apply(d); d.folders.find(f => f.id === folderId).updatedAt = Date.now(); writeFolders(d); showNow();
  }
  if (folderShow !== 'all') setTimeout(rerenderFolders, 300); else if (isShared()) rerenderFolders();
}
// planilha: pasta;produto;descricao;op;partida;enderecos;rg;endereco;armazem;peso;gramatura;cmc;pego;status
function exportFolder() {
  const f = folderById(readFolders(), folderOpenId); if (!f) return;
  const q = v => { const t = String(v ?? '').replace(/[\r\n]+/g, ' '); return /[;"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const num = v => (v === null || v === undefined || v === '') ? '' : String(v).replace('.', ',');
  const lines = ['pasta;produto;descricao;op;partida;enderecos;rg;endereco;armazem;peso;gramatura;cmc;pego;pego_por;status'];
  f.items.forEach(it => it.rolos.forEach(r => lines.push([f.name, it.produto, it.descricao, it.op, it.partida, it.enderecos, r.rg, r.endereco, r.armazem, num(r.peso), num(r.gramatura), num(r.cmc), r.picked ? 'sim' : 'nao', r.pickedBy || '', it.status].map(q).join(';'))));
  const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `PASTA_${f.name.replace(/[^\w-]+/g, '_')}.csv`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  message(`Planilha da pasta "${f.name}" baixada.`, 'success');
}
function splitCsv(line) { const out = []; let v = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"' && q && line[i + 1] === '"') { v += '"'; i++; } else if (c === '"') q = !q; else if (c === ';' && !q) { out.push(v.trim()); v = ''; } else v += c; } out.push(v.trim()); return out; }
// lê um CSV exportado pelo NOVA e devolve [{ name, items:[...] }]
function parseFoldersCsv(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const head = splitCsv(lines[0] || '').map(h => h.toLowerCase()), ix = k => head.indexOf(k);
  if (ix('pasta') < 0 || ix('op') < 0 || ix('rg') < 0) throw new Error('Planilha inválida: use um arquivo exportado pelo NOVA (botão Exportar planilha).');
  const folders = new Map(); let nRolls = 0;
  const pn = v => { const n = parseNumber(v); return n === null ? null : n; };
  lines.slice(1).forEach(l => {
    const c = splitCsv(l), g = k => (ix(k) >= 0 ? c[ix(k)] ?? '' : '');
    const name = g('pasta').trim(); if (!name) return;
    const lk = name.toLowerCase(); if (!folders.has(lk)) folders.set(lk, { name, items: [] });
    const f = folders.get(lk), key = itemKey(g('produto'), g('op'), g('partida'));
    let it = f.items.find(x => x.key === key);
    if (!it) { it = { key, produto: g('produto').toUpperCase(), descricao: g('descricao'), op: g('op'), partida: g('partida'), enderecos: g('enderecos'), status: g('status'), savedAt: Date.now(), rolos: [] }; f.items.push(it); }
    it.rolos.push({ rg: g('rg'), endereco: g('endereco'), armazem: g('armazem'), peso: pn(g('peso')), gramatura: pn(g('gramatura')), cmc: pn(g('cmc')), picked: /^(sim|s|1|true)$/i.test(g('pego')), pickedBy: g('pego_por') });
    nRolls++;
  });
  return { folders: [...folders.values()], nRolls };
}
async function importFolders(text) {
  const parsed = parseFoldersCsv(text);
  if (isShared()) {
    folderBusy = true;
    try { for (const pf of parsed.folders) { const j = await remote('createFolder', { name: pf.name }); for (const it of pf.items) await remote('saveItem', { folderId: j.folder.id, item: it }); } }
    finally { folderBusy = false; await syncFolders(true); }
    return { nFolders: parsed.folders.length, nRolls: parsed.nRolls };
  }
  const d = readFolders(); let nFolders = 0;
  parsed.folders.forEach(pf => {
    let f = d.folders.find(x => x.name.toLowerCase() === pf.name.toLowerCase());
    if (!f) { f = { id: newId(), name: pf.name, createdAt: Date.now(), updatedAt: Date.now(), items: [] }; d.folders.push(f); nFolders++; }
    pf.items.forEach(pit => {
      const it = f.items.find(x => x.key === pit.key);
      if (!it) { f.items.push(pit); return; }
      pit.rolos.forEach(roll => { const ex = it.rolos.find(r => r.rg === roll.rg && r.endereco === roll.endereco); if (ex) ex.picked = ex.picked || roll.picked; else it.rolos.push(roll); });
    });
    f.updatedAt = Date.now();
  });
  writeFolders(d);
  return { nFolders, nRolls: parsed.nRolls };
}

/* ------------------------------- punhos ------------------------------- */
// Malha 40M090900010 → punho 40P090900010 (troca o M da 3ª posição pelo P).
let punhoSelecting = false;        // caixinhas de seleção visíveis na malha
const punhoSelected = new Set();   // grupos OP|Partida da malha marcados
let punhoCtx = null;               // { malha:{code,description}, malhaRows, ops:Set } quando a tela mostra o punho
function punhoCodeOf(code) {
  const c = String(code || '').toUpperCase();
  if (c[2] === 'M') return c.slice(0, 2) + 'P' + c.slice(3);
  const i = c.indexOf('M'); return i >= 0 ? c.slice(0, i) + 'P' + c.slice(i + 1) : null;
}
function opMatch(r) { return !!punhoCtx && punhoCtx.ops.has(opOf(r)); }
function updatePunhoUi() {
  const inPunho = !!punhoCtx, code = !inPunho && selected ? punhoCodeOf(selected.code) : null;
  const btn = $('punhoBtn');
  btn.classList.toggle('hidden', inPunho);
  btn.disabled = !code; btn.classList.toggle('active', punhoSelecting);
  btn.title = code ? `Indicar punho (${code}) pelas OPs desta malha` : 'Este código não tem M para trocar por P';
  $('selCol').classList.toggle('hidden', !punhoSelecting || inPunho);
  $('punhoBar').classList.toggle('hidden', !punhoSelecting || inPunho);
  if (punhoSelecting && !inPunho) {
    const ops = selectedOps();
    $('punhoBarText').textContent = punhoSelected.size
      ? `${punhoSelected.size} grupo(s) selecionado(s)`
      : 'Marque as OPs da malha (pode marcar várias) para indicar o punho.';
    $('punhoBarText').title = ops.size ? `OP: ${[...ops].join(', ')}` : '';
    $('punhoGo').disabled = !ops.size; $('punhoGo').textContent = `Buscar punho ${code || ''} →`;
    const all = currentGroups.length && currentGroups.every(g => punhoSelected.has(g.key));
    $('selAll').checked = !!all; $('selAll').indeterminate = !all && punhoSelected.size > 0;
  }
  $('punhoBanner').classList.toggle('hidden', !inPunho);
  if (inPunho) {
    const matched = new Set(currentRows.filter(opMatch).map(opOf));
    $('punhoBannerText').textContent = `Punho indicado para a malha ${punhoCtx.malha.code}. `
      + (matched.size ? `${currentRows.filter(opMatch).length} rolo(s) de punho com a mesma OP` : 'Nenhum punho com a mesma OP — seguindo a prioridade normal');
    $('punhoBannerText').title = `OP selecionada(s): ${[...punhoCtx.ops].join(', ')}`;
  }
}
function selectedOps() {
  const ops = new Set();
  currentGroups.forEach(g => { if (punhoSelected.has(g.key) && g.op) ops.add(g.op); });
  return ops;
}
function togglePunhoMode() {
  punhoSelecting = !punhoSelecting;
  if (!punhoSelecting) punhoSelected.clear();
  renderStock(visibleRows);
}
async function searchPunho() {
  const code = punhoCodeOf(selected?.code), ops = selectedOps();
  if (!code || !ops.size) return;
  const btn = $('punhoGo'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Consultando punho…'; clearMessage();
  try {
    const [d] = await Promise.all([api(`/api/stock?code=${encodeURIComponent(code)}`, {}, SEARCH_TIMEOUT_MS), loadDefects().catch(() => {})]);
    const rows = Array.isArray(d.rows) ? d.rows : [];
    if (!rows.length) { message(`Nenhum rolo de punho ${code} com estoque nos armazéns 01/93.`, 'error'); return; }
    const malha = { ...selected }, malhaRows = currentRows;
    punhoCtx = { malha, malhaRows, ops, malhaSelected: new Set(punhoSelected) };
    const desc = String(d.product?.description || '').trim();
    $('term').value = code;
    stock({ code, description: desc, punho: true }, rows);
    addHistory(code, desc, rows.length, rows.filter(priorityMatch).length);
    const n = rows.filter(opMatch).length;
    message(n ? `${n} rolo(s) de punho com a mesma OP da malha foram colocados primeiro (Indicado por OP).` : 'Nenhum punho com a mesma OP da malha. A lista segue a prioridade normal (amostra).', n ? 'success' : 'info');
  } catch (e) {
    if (e.status === 401 || e.status === 403) { requireLogin(); return; }
    message(e.message || 'Falha ao consultar o punho.', 'error');
  } finally { btn.disabled = false; updatePunhoUi(); }
}
function backToMalha() {
  if (!punhoCtx) return;
  const { malha, malhaRows, malhaSelected } = punhoCtx;
  punhoCtx = null; punhoSelecting = true;
  punhoSelected.clear(); malhaSelected.forEach(k => punhoSelected.add(k));
  $('term').value = malha.code;
  stock(malha, malhaRows);
}
function resetPunho() { punhoCtx = null; punhoSelecting = false; punhoSelected.clear(); }

// Status para amostra: aprovado = gramatura medida dentro da faixa do padrão do grupo.
function sampleStatus(r) {
  const d = defectFor(r);
  if (d) return { ok: false, defect: d, label: defectText(d), reason: 'malha com defeito registrado' };
  if (priorityMatch(r)) return { ok: true, label: 'Aprovado para amostra', reason: 'gramatura dentro do padrão' };
  const rule = priorityRuleFor(r);
  const reason = !rule ? 'sem padrão de gramatura para o grupo' : gramaturaValue(r) === null ? 'gramatura não informada' : 'gramatura fora do padrão';
  return { ok: false, label: 'Não indicado para amostra', reason };
}
// Ordem: OP com defeito sempre por último · (punho) mesma OP da malha · local prioritário (armazém 93 / AM01 / AM02)
// → aprovados para amostra → menor CMC → entrada mais recente.
function rankRows(rows) {
  return [...rows].sort((a, b) => {
    const da = defectFor(a) ? 1 : 0, db = defectFor(b) ? 1 : 0; if (da !== db) return da - db;
    if (punhoCtx) { const op = Number(opMatch(b)) - Number(opMatch(a)); if (op) return op; }
    const loc = locationScore(b) - locationScore(a); if (loc) return loc;
    const ok = Number(priorityMatch(b)) - Number(priorityMatch(a));
    if (ok) return ok;
    const ca = numericValue(field(a, 'Z5_CMC')), cb = numericValue(field(b, 'Z5_CMC'));
    if (ca !== null && cb !== null && ca !== cb) return ca - cb;
    if (ca !== null && cb === null) return -1;
    if (cb !== null && ca === null) return 1;
    return dateValue(field(b, 'Z5_DTENT')) - dateValue(field(a, 'Z5_DTENT'));
  });
}

/* ------------------------------ pesquisa ------------------------------ */
let searching = false;
// from: 'search' (tela central) ou 'results' (barra do topo da tela de endereços)
async function search(codeArg, from = 'search') {
  if (searching) return;
  clearMessage();
  if (!connected) return goLogin('Entre no Protheus antes de pesquisar.');
  const code = cleanCode(codeArg ?? (from === 'results' ? $('term').value : $('codeInput').value));
  if (!CODE_RE.test(code)) return message(`O código do produto deve ter ${CODE_LEN} caracteres (letras e números). Você digitou ${code.length}.`, 'error');
  const btn = from === 'results' ? $('searchBtn') : $('codeBtn');
  const label = btn.innerHTML;
  searching = true; btn.disabled = true; $('codeInput').disabled = true; $('term').disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Consultando Protheus…';
  try {
    const [d] = await Promise.all([
      api(`/api/stock?code=${encodeURIComponent(code)}`, {}, SEARCH_TIMEOUT_MS),
      loadPriority().catch(() => {}), // recarrega a planilha: pega edições feitas no Excel
      loadDefects().catch(() => {})
    ]);
    const rows = Array.isArray(d.rows) ? d.rows : [];
    if (!rows.length) {
      const dg = d.diagnostic || {};
      const tried = (dg.attempts || []).map(a => `${a.label}: ${a.error ? 'erro' : a.rows + ' linha(s)'}`).join(' · ');
      let why;
      if (dg.productExists > 0) why = `O código ${code} existe na SZ5, mas nenhuma posição tem peso atual > 0 nos armazéns 01/93.`;
      else if (dg.productExists === 0) why = `Nenhum registro na SZ5 para o código ${code}. Confira o código digitado.`;
      else why = 'A API respondeu sem linhas e não foi possível confirmar se o código existe.';
      message(`${why} Tentativas: ${tried || 'nenhuma'}.`, 'error');
      return;
    }
    const desc = String(d.product?.description || field(rows[0], 'Z9_DESC') || '').trim();
    resetPunho();
    showView('results'); $('term').value = code;
    stock({ code, description: desc }, rows);
    addHistory(code, desc, rows.length, rows.filter(priorityMatch).length);
    if (d.mode === 'prefixo') message(`Nenhum código exatamente igual a ${code}; exibindo códigos que começam com ele.`, 'info');
    if (d.notice) message(d.notice, 'error');
    if (d.truncated) message('Atenção: a consulta atingiu o limite de páginas/tempo e pode estar incompleta. Tente novamente.', 'error');
  } catch (e) {
    if (e.status === 401 || e.status === 403) { requireLogin(); return; }
    message(e.message || 'Falha ao consultar o estoque no Protheus.', 'error');
  } finally {
    searching = false; btn.innerHTML = label;
    $('codeInput').disabled = false; $('term').disabled = false; $('searchBtn').disabled = false;
    updateCodeInput();
    if (from === 'search' && document.body.dataset.view === 'search') $('codeInput').focus();
  }
}
function stock(p, rows = []) {
  selected = p; currentRows = Array.isArray(rows) ? rows : []; visibleRows = []; currentGroups = [];
  $('selectedProduct').textContent = `${p.code} — ${p.description || 'Descrição não informada'}${p.punho ? ' · PUNHO' : ''}`;
  $('stockSection').classList.remove('hidden');
  $('stockBody').replaceChildren(); $('stats').replaceChildren();
  $('emptyStock').classList.add('hidden'); $('printBtn').disabled = true;
  $('filterValue').value = '';
  fillAddressFilter();
  applyFilters();
}
const addrOf = r => String(field(r, 'Z5_ENDEREC') ?? '').trim();
function fillAddressFilter() {
  const counts = new Map();
  currentRows.forEach(r => { const a = addrOf(r) || '(sem endereço)'; counts.set(a, (counts.get(a) || 0) + 1); });
  const sel = $('addressFilter'); sel.replaceChildren();
  const all = document.createElement('option'); all.value = ''; all.textContent = `Todos os endereços (${counts.size})`; sel.append(all);
  [...counts.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })).forEach(a => {
    const o = document.createElement('option'); o.value = a; o.textContent = `${a} — ${counts.get(a)} rolo(s)`; sel.append(o);
  });
  sel.disabled = counts.size < 2;
}
function updateFilterHint() {
  const hints = {
    Z5_ENDEREC: ['Parte do endereço', 'Ex.: A-01'], RG: ['RG', 'Ex.: FPK4997'], Z5_OP: ['OP', 'Digite o número da OP…'],
    Z5_PARTIDA: ['Partida', 'Digite a partida…'], Z5_ALMOXA: ['Armazém', 'Ex.: 01'], Z6_GRUPO: ['Grupo de produto', 'Digite o código do grupo…'], Z5_TONALID: ['Tonalidade', 'Digite a tonalidade…']
  };
  const hint = hints[$('filterType').value] || ['Valor do filtro', 'Digite para filtrar…'];
  $('filterValueLabel').textContent = hint[0]; $('filterValue').placeholder = hint[1];
}
const FILTER_ALIASES = { Z5_ALMOXA: 'ALMOXARIFADO', Z5_OP: 'OP', Z5_PARTIDA: 'PARTIDA', Z5_ENDEREC: 'ENDERECO', Z6_GRUPO: 'GRUPO', Z5_TONALID: 'TONALIDADE' };
function rowCandidate(r, type) {
  const value = k => String(field(r, k) ?? '').trim();
  if (type === 'RG') {
    const joined = normalizeFilter(value('Z5_SERIE')) + normalizeFilter(value('Z5_NUMERO'));
    const alt = Object.entries(r || {}).filter(([k]) => /serie|numero|rg/i.test(k)).map(([, v]) => normalizeFilter(v)).join('');
    return `${joined}|${alt}`;
  }
  let c = normalizeFilter(value(type));
  if (!c && FILTER_ALIASES[type]) c = normalizeFilter(value(FILTER_ALIASES[type]));
  return c;
}
function applyFilters() {
  const type = $('filterType').value, term = normalizeFilter($('filterValue').value);
  const addr = $('addressFilter').value;
  const filtered = currentRows.filter(r => (!addr || (addrOf(r) || '(sem endereço)') === addr) && (!term || rowCandidate(r, type).includes(term)));
  visibleRows = rankRows(filtered);
  const ng = renderStock(visibleRows);
  $('filterCount').textContent = `${visibleRows.length} de ${currentRows.length} rolos · ${ng} grupo(s)`;
}
// Nomes exibidos nos detalhes de cada rolo. Campos em DETAIL_HIDDEN não aparecem.
const DETAIL_LABELS = {
  Z5_PROD: 'Produto', Z5_OP: 'OP', Z5_PARTIDA: 'Partida', Z5_ALMOXA: 'Armazém', Z5_DTENT: 'Data de entrada',
  Z5_PESOATU: 'Peso atual', Z5_ULTATU: 'Ult. atualização', Z5_ENDEREC: 'Endereço', Z5_4KDTEND: 'Data de endereçamento',
  Z5_GRAMATU: 'Gramatura', Z5_CMC: 'CMC', Z6_GRUPO: 'Grupo', Z9_DESC: 'Descrição do grupo', Z6_TONALID: 'Tonalidade (grupo)',
  ZL_TONALID: 'Tonalidade (cadastro)', ZL_DESCRUP: 'Descrição da tonalidade', ZL_DESTONA: 'Descrição da tonalidade (alt.)', Z6_LOTECTL: 'Lote'
};
const DETAIL_HIDDEN = new Set(['Z6_GRUPO', 'Z9_DESC', 'Z5_ROMAN', 'Z5_SERIE', 'Z5_NUMERO', 'Z5_DOCCQ', 'Z5_TONALID', 'B1_GRUPO', 'B1_DESC', 'BM_DESC', 'BM_GRAMTIN']);
const DETAIL_ORDER = ['Z5_PROD', 'Z5_OP', 'Z5_PARTIDA', 'Z5_ENDEREC', 'Z5_ALMOXA', 'Z5_PESOATU', 'Z5_GRAMATU', 'Z5_CMC', 'Z5_DTENT', 'Z5_4KDTEND', 'Z5_ULTATU'];
// Helpers compartilhados com o relatório de impressão
function rgOf(r) { return `${String(field(r, 'Z5_SERIE') ?? '').trim()}${String(field(r, 'Z5_NUMERO') ?? '').trim()}`; }
function groupLabel(r) {
  const g = String(field(r, 'Z6_GRUPO') || field(r, 'B1_GRUPO') || '').trim();
  const d = String(field(r, 'Z9_DESC') || field(r, 'BM_DESC') || field(r, 'B1_DESC') || '').trim();
  return g && d ? `${g} - ${d}` : (g || d || '—');
}
function fmtNum(v, min = 0, max = min) {
  const n = parseNumber(v);
  return n === null ? fmt(v) : n.toLocaleString('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });
}
function prioShort(r) { const d = defectFor(r); if (d) return '✕ ' + defectText(d); return opMatch(r) ? 'INDICADO POR OP' : priorityMatch(r) ? 'APROVADO P/ AMOSTRA' : 'NÃO INDICADO'; }

function toggleDetail(tr, r, btn) {
  const next = tr.nextElementSibling;
  if (next && next.classList.contains('detail-row')) { next.remove(); tr.classList.remove('open'); if (btn) btn.textContent = '＋ Detalhes'; return; }
  const dtr = document.createElement('tr'); dtr.className = 'detail-row';
  const td = document.createElement('td'); td.colSpan = tr.children.length;
  const grid = document.createElement('div'); grid.className = 'detail-grid';
  const addItem = (label, value, raw) => {
    const item = document.createElement('div');
    const a = document.createElement('span'); a.textContent = label; if (raw) a.title = raw;
    const b = document.createElement('b'); b.textContent = value;
    item.append(a, b); grid.append(item); return item;
  };
  const rule = priorityRuleFor(r);
  if (rule) {
    const ideal = Number(rule.gramatura), tol = Number(rule.tolerance ?? DEFAULT_TOLERANCE);
    const lo = ideal * (1 - tol / 100), hi = ideal * (1 + tol / 100);
    const it = addItem(`Padrão de gramatura — ${ruleSourceLabel(rule)}`, `${fmtNum(ideal, 0, 2)} g/m² ±${fmtNum(tol, 0, 2)}% (faixa ${fmtNum(lo, 0, 2)} a ${fmtNum(hi, 0, 2)}) — ${gramaturaOk(r) ? 'dentro da faixa' : 'fora da faixa'}`);
    it.classList.add('wide');
  }
  addItem('RG', rgOf(r) || '—');
  const keys = Object.keys(r).filter(k => !DETAIL_HIDDEN.has(k.toUpperCase()));
  const pos = k => { const i = DETAIL_ORDER.indexOf(k.toUpperCase()); return i < 0 ? 999 : i; };
  keys.sort((a, b) => pos(a) - pos(b)).map(k => [k, r[k]]).forEach(([k, v]) => {
    let text = (v !== null && typeof v === 'object') ? JSON.stringify(v) : fmt(v);
    if (/DT|DATA|ULTATU/i.test(k) && dateParts(v)) text = formatDate(v);
    else if (k === 'Z5_PESOATU') text = `${fmtNum(v, 2)} kg`;
    else if (k === 'Z5_CMC') text = fmtNum(v, 2);
    else if (k === 'Z5_GRAMATU') text = `${fmtNum(v, 0, 2)} g/m²`;
    addItem(DETAIL_LABELS[k.toUpperCase()] || k, text, k);
  });
  td.append(grid); dtr.append(td); tr.after(dtr); tr.classList.add('open');
  if (btn) btn.textContent = '− Ocultar';
}
// ---------- agrupamento por OP + Partida ----------
const opOf = r => String(field(r, 'Z5_OP') ?? '').trim(), partidaOf = r => String(field(r, 'Z5_PARTIDA') ?? '').trim();
const groupKey = r => `${opOf(r)}|${partidaOf(r)}`;
// rows já vêm ordenados (melhor primeiro): o grupo herda a posição do seu melhor rolo
function groupRows(rows) {
  const map = new Map();
  rows.forEach(r => { const k = groupKey(r); if (!map.has(k)) map.set(k, { key: k, op: opOf(r), partida: partidaOf(r), rows: [] }); map.get(k).rows.push(r); });
  return [...map.values()];
}
function rangeText(values, min = 0, max = 2) {
  const v = values.filter(x => x !== null);
  if (!v.length) return '—';
  const lo = Math.min(...v), hi = Math.max(...v);
  return lo === hi ? fmtNum(lo, min, max) : `${fmtNum(lo, min, max)} – ${fmtNum(hi, min, max)}`;
}
function opPill() {
  const pill = document.createElement('span'); pill.className = 'priority-pill op-match';
  pill.textContent = '★ Indicado por OP'; pill.title = 'Mesma OP da malha selecionada'; return pill;
}
function statusPill(ok, rule) {
  const pill = document.createElement('span');
  pill.className = 'priority-pill ' + (ok ? 'match' : rule ? 'outside' : 'no-rule');
  pill.textContent = ok ? '✓ Aprovado para amostra' : 'Não indicado para amostra';
  return pill;
}
// rótulos usados no layout em cartões (celular)
const GROUP_LABELS = ['Prioridade', 'OP', 'Partida', 'Descrição', 'Rolos', 'Entrada', 'Peso total', 'Gramatura', 'CMC', 'Endereços', ''];
const ROLL_LABELS = ['Prioridade', 'RG', 'Endereço', 'Armazém', 'Data de entrada', 'Peso atual', 'Gramatura', 'CMC', ''];
function labelCells(tr, labels) { [...tr.children].filter(td => !td.classList.contains('sel-cell')).forEach((td, i) => { if (labels[i]) td.dataset.label = labels[i]; }); }
function rollTable(g, allRows) {
  const wrap = document.createElement('div'); wrap.className = 'roll-wrap';
  const t = document.createElement('table'); t.className = 'roll-table';
  const head = document.createElement('thead'); const hr = document.createElement('tr');
  [['Prioridade'], ['RG'], ['Endereço'], ['Armazém'], ['Data de entrada'], ['Peso atual', 'num-cell'], ['Gramatura', 'num-cell'], ['CMC', 'num-cell'], ['']].forEach(([h, c]) => { const th = document.createElement('th'); th.textContent = h; if (c) th.className = c; hr.append(th); });
  head.append(hr); t.append(head);
  const body = document.createElement('tbody');
  g.rows.forEach(r => {
    const tr = document.createElement('tr'), st = sampleStatus(r), rule = priorityRuleFor(r);
    const om = opMatch(r) && !st.defect;
    tr.className = 'stock-item-row roll-row' + (st.defect ? ' defect-row' : om ? ' op-row' : st.ok ? ' priority-match' : '');
    const add = (text, cls) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.append(td); return td; };
    const status = document.createElement('td'); status.className = 'priority-cell';
    const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = String(allRows.indexOf(r) + 1); rank.title = 'Posição geral do rolo';
    const pill = statusPill(st.ok, rule);
    pill.title = rule ? `Padrão: ${fmtNum(rule.gramatura, 0, 2)} g/m² ± ${fmtNum(rule.tolerance ?? DEFAULT_TOLERANCE, 0, 2)}% · origem: ${ruleSourceLabel(rule)}` : 'Sem gramatura padrão cadastrada para o grupo';
    status.append(rank, st.defect ? defectPill(st.defect) : om ? opPill() : pill);
    const lt = locationTag(r); if (lt) status.append(lt);
    if (!st.defect && (om || !st.ok)) { const why = document.createElement('small'); why.className = 'pill-why'; why.textContent = om ? `mesma OP da malha · ${st.ok ? 'aprovado para amostra' : st.reason}` : st.reason; status.append(why); }
    tr.append(status);
    add(rgOf(r) || '—', 'rg-cell');
    add(fmt(field(r, 'Z5_ENDEREC')), 'address-cell');
    add(fmt(field(r, 'Z5_ALMOXA')));
    add(formatDate(field(r, 'Z5_DTENT')), 'date-cell');
    add(`${fmtNum(field(r, 'Z5_PESOATU'), 2)} kg`, 'num-cell');
    add(fmtNum(field(r, 'Z5_GRAMATU'), 0, 2), 'num-cell');
    add(fmtNum(field(r, 'Z5_CMC'), 2), 'num-cell');
    const dt = document.createElement('td'); dt.className = 'detail-cell';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'detail-btn'; btn.textContent = '＋ Detalhes'; btn.title = 'Ver todas as informações deste rolo';
    btn.onclick = e => { e.stopPropagation(); toggleDetail(tr, r, btn); };
    dt.append(btn); tr.append(dt);
    labelCells(tr, ROLL_LABELS);
    body.append(tr);
  });
  t.append(body); wrap.append(t); return wrap;
}
// ---------- janela com os rolos de um grupo OP/Partida ----------
let currentGroups = [], groupIndex = -1;
function openGroup(index) {
  const g = currentGroups[index]; if (!g) return;
  groupIndex = index;
  const n = g.rows.length, approved = g.rows.filter(priorityMatch).length;
  const weight = g.rows.reduce((s, r) => s + (numericValue(field(r, 'Z5_PESOATU')) || 0), 0);
  $('groupTitle').textContent = `OP ${g.op || '—'} · Partida ${g.partida || '—'}`;
  $('groupSub').textContent = `${selected?.code || ''} — ${groupLabel(g.rows[0])} · grupo ${index + 1} de ${currentGroups.length}`;
  const box = $('groupStats'); box.replaceChildren();
  [['Rolos', String(n)], ['Peso total', `${fmtNum(weight, 2)} kg`],
   ['Endereços', String(new Set(g.rows.map(addrOf).filter(Boolean)).size)]].forEach(([a, b]) => {
    const d = document.createElement('div'); const l = document.createElement('span'); l.textContent = a; const v = document.createElement('strong'); v.textContent = b; d.append(l, v); box.append(d);
  });
  $('groupTable').replaceChildren(rollTable(g, visibleRows));
  const gd = defectFor(g.rows[0]);
  $('groupDefect').classList.toggle('hidden', !gd);
  if (gd) $('groupDefect').textContent = `✕ Malha com defeito: ${defectText(gd)}${gd.observacao ? ' — ' + gd.observacao : ''}${gd.usuario ? ' (registrado por ' + gd.usuario + (gd.data ? ' em ' + gd.data : '') + ')' : ''}`;
  $('defectBtn').textContent = gd ? '✎ Editar defeito' : '⚠ Indicar defeito';
  updateSaveBtn();
  $('groupTable').scrollTop = 0;
  $('groupPrev').disabled = index <= 0; $('groupNext').disabled = index >= currentGroups.length - 1;
  $('groupModal').classList.remove('hidden');
  $('closeGroup').focus();
}
function closeGroup() { $('groupModal').classList.add('hidden'); groupIndex = -1; }
function renderStock(rows) {
  const tbody = $('stockBody'); tbody.replaceChildren();
  const groups = groupRows(rows);
  groups.forEach((g, gi) => {
    const tr = document.createElement('tr');
    const approved = g.rows.filter(priorityMatch).length, n = g.rows.length;
    const gd = defectFor(g.rows[0]), om = opMatch(g.rows[0]) && !gd;
    tr.className = 'group-row' + (gd ? ' defect-row' : om ? ' op-row' : approved ? ' priority-match' : '');
    const add = (text, cls) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.append(td); return td; };
    if (punhoSelecting && !punhoCtx) {
      const sel = document.createElement('td'); sel.className = 'sel-cell';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = punhoSelected.has(g.key);
      cb.setAttribute('aria-label', `Selecionar OP ${g.op || '—'} partida ${g.partida || '—'}`);
      cb.onclick = e => e.stopPropagation();
      cb.onchange = () => { cb.checked ? punhoSelected.add(g.key) : punhoSelected.delete(g.key); tr.classList.toggle('selected', cb.checked); updatePunhoUi(); };
      sel.onclick = e => { e.stopPropagation(); if (e.target !== cb) { cb.checked = !cb.checked; cb.onchange(); } };
      sel.append(cb); tr.append(sel); tr.classList.toggle('selected', cb.checked);
    }
    const status = document.createElement('td'); status.className = 'priority-cell';
    const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = String(gi + 1); rank.title = 'Posição do grupo OP/Partida';
    const pill = gd ? defectPill(gd) : om ? opPill() : statusPill(approved > 0, g.rows.some(r => priorityRuleFor(r)));
    const sub = document.createElement('small'); sub.className = 'pill-why';
    sub.textContent = gd ? 'malha com defeito — não pegar' : (om ? 'mesma OP da malha · ' : '') + `${approved} de ${n} rolo(s) aprovado(s)`;
    status.append(rank, pill);
    const best = g.rows.find(r => locationScore(r)); const lt = best && locationTag(best); if (lt) status.append(lt);
    status.append(sub); tr.append(status);
    add(g.op || '—', 'op-cell');
    add(g.partida || '—', 'op-cell');
    add(groupLabel(g.rows[0]), 'desc-cell');
    add(String(n), 'num-cell');
    const latest = g.rows.reduce((a, r) => dateValue(field(r, 'Z5_DTENT')) > dateValue(field(a, 'Z5_DTENT')) ? r : a, g.rows[0]);
    add(formatDate(field(latest, 'Z5_DTENT')), 'date-cell');
    add(`${fmtNum(g.rows.reduce((s, r) => s + (numericValue(field(r, 'Z5_PESOATU')) || 0), 0), 2)} kg`, 'num-cell');
    add(rangeText(g.rows.map(r => gramaturaValue(r)), 0, 2), 'num-cell');
    add(rangeText(g.rows.map(r => numericValue(field(r, 'Z5_CMC'))), 2, 2), 'num-cell');
    const addrs = [...new Set(g.rows.map(addrOf).filter(Boolean))];
    const at = add(addrs.length ? addrs.slice(0, 3).join(', ') + (addrs.length > 3 ? ` +${addrs.length - 3}` : '') : '—', 'address-cell');
    at.title = addrs.join(', ');
    const dt = document.createElement('td'); dt.className = 'detail-cell';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'expand-btn';
    btn.textContent = `＋ Exibir mais (${n})`; btn.title = 'Ver os rolos deste grupo';
    btn.onclick = e => { e.stopPropagation(); openGroup(gi); };
    dt.append(btn); tr.append(dt);
    labelCells(tr, GROUP_LABELS);
    tr.onclick = () => {
      const cb = tr.querySelector('.sel-cell input');
      if (cb) { cb.checked = !cb.checked; cb.onchange(); } else openGroup(gi);
    };
    tbody.append(tr);
  });
  currentGroups = groups;
  updatePunhoUi();
  const weight = rows.reduce((sum, r) => sum + (numericValue(field(r, 'Z5_PESOATU')) || 0), 0);
  const matched = rows.filter(priorityMatch).length;
  const addresses = new Set(rows.map(addrOf).filter(Boolean));
  const cards = [...(punhoCtx ? [['INDICADOS POR OP', rows.filter(opMatch).length.toLocaleString('pt-BR')]] : []), ['GRUPOS OP / PARTIDA', groups.length.toLocaleString('pt-BR')], ['ROLOS EXIBIDOS', rows.length.toLocaleString('pt-BR')], ['APROVADOS PARA AMOSTRA', matched.toLocaleString('pt-BR')], ['NÃO INDICADOS', (rows.length - matched).toLocaleString('pt-BR')], ['PESO TOTAL', `${weight.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg`], ['ENDEREÇOS', addresses.size.toLocaleString('pt-BR')]];
  $('stats').replaceChildren();
  cards.forEach(([a, b]) => { const x = document.createElement('div'); x.className = 'stat'; const l = document.createElement('span'); l.textContent = a; const v = document.createElement('strong'); v.textContent = b; x.append(l, v); $('stats').append(x); });
  $('stats').classList.remove('hidden');
  $('emptyStock').classList.toggle('hidden', rows.length > 0);
  $('printBtn').disabled = !rows.length;
  return groups.length;
}

/* ------------------ planilha de gramaturas (gravação local) ------------------ */
function countActive() { return priorityRules.filter(x => x.active !== false).length; }
function updatePriorityCount() { if ($('priorityConfigCount')) $('priorityConfigCount').textContent = `Gramatura ideal: Protheus (SBM) · ${countActive()} ajuste(s) na planilha local`; }
function showPriorityPath(p) { if (p) { $('priorityFilePath').textContent = p; $('priorityFilePath').title = p; } }
function showWarnings(list) {
  const box = $('priorityWarnings');
  box.replaceChildren();
  if (!list || !list.length) { box.classList.add('hidden'); return; }
  const t = document.createElement('b'); t.textContent = 'Avisos ao ler a planilha:'; box.append(t);
  list.slice(0, 8).forEach(w => { const d = document.createElement('div'); d.textContent = '• ' + w; box.append(d); });
  if (list.length > 8) { const d = document.createElement('div'); d.textContent = `… e mais ${list.length - 8} aviso(s).`; box.append(d); }
  box.classList.remove('hidden');
}
async function loadPriority() {
  const d = await api('/api/priority');
  priorityRules = (d.rows || []).map(x => ({ ...x }));
  updatePriorityCount(); showPriorityPath(d.filePath);
  return d;
}
const cloneRules = rules => rules.map(x => ({ group: x.group ?? '', description: x.description ?? '', gramatura: x.gramatura ?? '', tolerance: x.tolerance ?? DEFAULT_TOLERANCE, active: x.active !== false }));
const snapshotOf = rules => JSON.stringify(rules.map(x => [String(x.group).trim(), String(x.description).trim(), String(x.gramatura), String(x.tolerance), x.active !== false]));
const isDirty = () => !$('priorityModal').classList.contains('hidden') && snapshotOf(draftRules) !== draftSnapshot;
function resetDraft() { draftRules = cloneRules(priorityRules); draftSnapshot = snapshotOf(draftRules); }

function renderPriorityEditor(focusLast = false) {
  const body = $('priorityRows'); body.replaceChildren();
  if (!draftRules.length) {
    const tr = document.createElement('tr'), td = document.createElement('td');
    td.colSpan = 6; td.className = 'empty-priority'; td.textContent = 'Nenhum grupo cadastrado. Clique em “Adicionar grupo”.';
    tr.append(td); body.append(tr); return;
  }
  draftRules.forEach((rule, index) => {
    const tr = document.createElement('tr');
    const cells = Array.from({ length: 6 }, () => document.createElement('td'));
    const make = (value, label, type = 'text') => { const input = document.createElement('input'); input.type = type; input.value = value ?? ''; input.setAttribute('aria-label', label); return input; };
    const group = make(rule.group, 'Código do grupo'); group.oninput = () => { draftRules[index].group = group.value; group.classList.remove('invalid'); };
    const desc = make(rule.description, 'Descrição do grupo'); desc.oninput = () => { draftRules[index].description = desc.value; };
    const gram = make(rule.gramatura, 'Gramatura ideal', 'number'); gram.min = '0.01'; gram.step = 'any'; gram.oninput = () => { draftRules[index].gramatura = gram.value; gram.classList.remove('invalid'); };
    const tol = make(rule.tolerance, 'Tolerância percentual', 'number'); tol.min = '0'; tol.max = '100'; tol.step = 'any'; tol.oninput = () => { draftRules[index].tolerance = tol.value; tol.classList.remove('invalid'); };
    const active = document.createElement('input'); active.type = 'checkbox'; active.checked = rule.active !== false; active.setAttribute('aria-label', 'Regra ativa'); active.onchange = () => { draftRules[index].active = active.checked; };
    const del = document.createElement('button'); del.type = 'button'; del.className = 'remove-priority'; del.textContent = '×'; del.title = 'Remover regra'; del.setAttribute('aria-label', 'Remover regra');
    del.onclick = () => { draftRules.splice(index, 1); renderPriorityEditor(); };
    group.dataset.col = 'group'; gram.dataset.col = 'gram'; tol.dataset.col = 'tol';
    [group, desc, gram, tol, active, del].forEach((el, i) => cells[i].append(el));
    cells.forEach(c => tr.append(c)); body.append(tr);
  });
  if (focusLast) { const inputs = body.querySelectorAll('input[data-col="group"]'); const last = inputs[inputs.length - 1]; if (last) { last.focus(); last.scrollIntoView({ block: 'nearest' }); } }
}
function validateDraft() {
  const seen = new Set(); let firstBad = null;
  const rows = [...$('priorityRows').querySelectorAll('tr')];
  rows.forEach(tr => tr.querySelectorAll('input.invalid').forEach(i => i.classList.remove('invalid')));
  const bad = (idx, col, text) => { const el = rows[idx]?.querySelector(`input[data-col="${col}"]`); if (el) el.classList.add('invalid'); if (!firstBad) { firstBad = text; if (el) el.focus(); } };
  draftRules.forEach((r, i) => {
    const group = String(r.group ?? '').trim();
    if (!group) return bad(i, 'group', `Linha ${i + 1}: informe o código do grupo (ou remova a linha).`);
    const key = normalizeFilter(group);
    if (seen.has(key)) return bad(i, 'group', `O grupo ${group} está cadastrado mais de uma vez.`);
    seen.add(key);
    const g = parseNumber(r.gramatura);
    if (g === null || g <= 0) return bad(i, 'gram', `Informe a gramatura ideal (maior que zero) do grupo ${group}.`);
    const raw = String(r.tolerance ?? '').trim();
    if (raw !== '') { const t = parseNumber(raw); if (t === null || t < 0 || t > 100) return bad(i, 'tol', `A tolerância do grupo ${group} deve estar entre 0 e 100%.`); }
  });
  return firstBad;
}
async function openPriorityEditor() {
  try {
    const d = await loadPriority();
    resetDraft(); renderPriorityEditor(); showWarnings(d.warnings);
    $('priorityModal').classList.remove('hidden');
  } catch (e) { message(e.message, 'error'); }
}
function closePriorityEditor(force = false) {
  if (!force && isDirty() && !confirm('Há alterações que ainda não foram salvas na planilha. Descartar?')) return false;
  $('priorityModal').classList.add('hidden'); return true;
}
async function savePriority() {
  const problem = validateDraft();
  if (problem) return message(problem, 'error');
  const btn = $('savePriority'); btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    const d = await api('/api/priority', { method: 'PUT', body: JSON.stringify({ rows: draftRules.map(x => ({ ...x, tolerance: String(x.tolerance ?? '').trim() === '' ? DEFAULT_TOLERANCE : x.tolerance })) }) });
    priorityRules = (d.rows || []).map(x => ({ ...x }));
    updatePriorityCount(); showPriorityPath(d.filePath || d.savedPath);
    closePriorityEditor(true);
    if (document.body.dataset.view === 'results') applyFilters();
    message(`Regras salvas na planilha local (${priorityRules.length} grupo(s)): ${d.savedPath || d.filePath}`, 'success');
  } catch (e) { message(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Salvar regras'; }
}
// Traz os grupos da SBM com BM_GRAMTIN > 0 para a janela de regras (para ajustar tolerância/ativar).
// Grupos que já estão na planilha mantêm os valores locais; só a descrição vazia é completada.
async function importFromProtheus() {
  if (!connected) return message('Entre no Protheus antes de importar os grupos da SBM.', 'error');
  const btn = $('importSbm'); btn.disabled = true; btn.textContent = 'Lendo SBM…';
  try {
    const d = await api('/api/sbm?refresh=1', {}, 150000);
    const byKey = new Map(draftRules.map(r => [normalizeFilter(r.group), r]));
    let added = 0, kept = 0, differ = 0;
    for (const g of d.groups || []) {
      if (!g.gramatura) continue;
      const cur = byKey.get(normalizeFilter(g.group));
      if (cur) {
        kept++;
        if (!String(cur.description || '').trim()) cur.description = g.description;
        if (parseNumber(cur.gramatura) !== g.gramatura) differ++;
        continue;
      }
      const rule = { group: g.group, description: g.description, gramatura: g.gramatura, tolerance: DEFAULT_TOLERANCE, active: true };
      draftRules.push(rule); byKey.set(normalizeFilter(g.group), rule); added++;
    }
    draftRules.sort((a, b) => String(a.group).localeCompare(String(b.group)));
    renderPriorityEditor();
    const total = (d.groups || []).length;
    let txt = `SBM: ${total} grupo(s) lidos, ${d.withGramatura} com BM_GRAMTIN. ${added} adicionado(s) à lista`;
    if (kept) txt += `; ${kept} já estavam na planilha e foram mantidos${differ ? ` (${differ} com gramatura diferente da SBM)` : ''}`;
    txt += '. Revise e clique em Salvar regras para gravar.';
    if (d.truncated) txt += ' Atenção: a leitura da SBM foi interrompida pelo limite de tempo e pode estar incompleta.';
    message(txt, added || kept ? 'success' : 'info');
  } catch (e) {
    if (e.status === 401 || e.status === 403) { closePriorityEditor(true); requireLogin(); }
    message(e.message || 'Falha ao ler a SBM no Protheus.', 'error');
  } finally { btn.disabled = false; btn.textContent = '⇣ Importar do Protheus (SBM)'; }
}
async function reloadPriorityFromDisk() {
  if (isDirty() && !confirm('Recarregar da planilha vai descartar as alterações ainda não salvas. Continuar?')) return;
  try { const d = await loadPriority(); resetDraft(); renderPriorityEditor(); showWarnings(d.warnings); message('Regras recarregadas da planilha.', 'success'); }
  catch (e) { message(e.message, 'error'); }
}

/* ------------------------------ exportação ------------------------------ */
function exportCsv() {
  const cols = []; visibleRows.forEach(r => Object.keys(r).forEach(k => { if (!cols.includes(k)) cols.push(k); }));
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const status = r => { const st = sampleStatus(r); if (st.defect) return `DEFEITO: ${st.label}`; if (opMatch(r)) return `INDICADO POR OP (${st.ok ? 'aprovado para amostra' : st.reason})`; return st.ok ? st.label.toUpperCase() : `${st.label.toUpperCase()} (${st.reason})`; };
  const lines = [['PRIORIDADE', ...cols].map(q).join(';'), ...visibleRows.map(r => [status(r), ...cols.map(c => field(r, c))].map(q).join(';'))];
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `estoque_${String(selected?.code || 'consulta').replace(/[^A-Za-z0-9._-]/g, '_')}_filtrado.csv`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ------------------------------- eventos ------------------------------- */
$('loginForm').onsubmit = login;
$('username').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('password').focus(); } };
document.querySelectorAll('.logout-btn').forEach(b => { b.onclick = logout; });
$('codeForm').onsubmit = e => { e.preventDefault(); search(undefined, 'search'); };
$('codeInput').oninput = updateCodeInput;
$('headerSearch').onsubmit = e => { e.preventDefault(); search(undefined, 'results'); };
$('term').oninput = () => { const v = cleanCode($('term').value); if ($('term').value !== v) $('term').value = v; };
$('newSearchBtn').onclick = goSearch;
$('openHistory').onclick = openHistory;
$('closeHistory').onclick = closeHistory; $('historyClose2').onclick = closeHistory;
$('historyFilter').oninput = renderHistory;
$('clearHistory').onclick = () => { if (!getHistory().length || !confirm('Apagar todo o histórico de pesquisas deste computador?')) return; saveHistory([]); renderHistory(); renderRecent(); };
$('historyModal').addEventListener('mousedown', e => { if (e.target === $('historyModal')) closeHistory(); });
$('addressFilter').onchange = applyFilters;
$('punhoBtn').onclick = togglePunhoMode;
$('foldersBtn').onclick = openFolders; $('foldersBtn2').onclick = () => { const f = activeFolder(); f ? openFolder(f.id) : openFolders(); };
$('activeFolderOpen').onclick = () => { const f = activeFolder(); if (f) openFolder(f.id); };
$('activeFolderEnd').onclick = () => { const d = readFolders(); d.active = null; writeFolders(d); updateFolderUi(); message('Pasta encerrada. As OPs salvas continuam em 📁 Pastas.', 'info'); };
$('saveGroupBtn').onclick = onSaveGroup;
$('newFolderForm').onsubmit = e => { e.preventDefault(); createFolder($('newFolderName').value); };
$('closeFolders').onclick = $('closeFolders2').onclick = $('foldersClose2').onclick = closeFolders;
$('folderBack').onclick = openFolders;
$('folderSearch').onclick = () => { closeFolders(); goSearch(); };
$('folderExport').onclick = exportFolder;
$('folderUse').onclick = () => { const d = readFolders(); d.active = folderOpenId; writeFolders(d); updateFolderUi(); renderFolder(); message('Pasta ativa: as próximas OPs salvas vão para ela.', 'success'); };
$('folderDelete').onclick = deleteFolderAction;
document.querySelectorAll('#folderView .seg button').forEach(b => { b.onclick = () => { folderShow = b.dataset.show; renderFolder(); }; });
$('foldersImport').onclick = () => $('foldersFile').click();
$('foldersFile').onchange = async () => { const f = $('foldersFile').files[0]; $('foldersFile').value = ''; if (!f) return; try { const r = await importFolders(await f.text()); renderFoldersList(); updateFolderUi(); message(`Planilha importada: ${r.nRolls} rolo(s)${r.nFolders ? `, ${r.nFolders} pasta(s) nova(s)` : ''}.`, 'success'); } catch (e) { message(e.message, 'error'); } };
$('foldersModal').addEventListener('mousedown', e => { if (e.target === $('foldersModal')) closeFolders(); });
$('phoneBtn').classList.toggle('hidden', !IS_THIS_PC);
$('phoneBtn').onclick = openPhone; $('closePhone').onclick = () => $('phoneModal').classList.add('hidden');
$('phoneModal').addEventListener('mousedown', e => { if (e.target === $('phoneModal')) $('phoneModal').classList.add('hidden'); });
$('filterToggle').onclick = () => { const open = !$('stockSection').classList.contains('filters-open'); $('stockSection').classList.toggle('filters-open', open); $('filterToggle').setAttribute('aria-expanded', String(open)); $('filterToggle').textContent = open ? '⚲ Menos filtros' : '⚲ Mais filtros'; };
$('defectBtn').onclick = () => { const g = currentGroups[groupIndex]; if (g) openDefect(g); };
$('defectSave').onclick = saveDefect; $('defectRemove').onclick = removeDefect;
$('defectCancel').onclick = closeDefect; $('closeDefect').onclick = closeDefect;
$('defectOpenFile').onclick = async () => { try { const d = await api('/api/defects/open', { method: 'POST', body: '{}' }); message(NOVA_STATIC ? 'Planilha de defeitos baixada (MALHAS_RUINS.csv).' : `Planilha aberta: ${d.filePath}. Feche no Excel antes de salvar um novo defeito.`, 'info'); } catch (e) { defectError(e.message); } };
if (NOVA_STATIC) {
  $('defectOpenFile').textContent = 'Baixar planilha';
  $('defectImport').classList.remove('hidden');
  $('defectImport').onclick = () => $('defectFile').click();
  $('defectFile').onchange = async () => {
    const f = $('defectFile').files[0]; $('defectFile').value = ''; if (!f) return;
    try { const r = await window.NovaLocal.importDefects(await f.text()); setDefects(r.rows); closeDefect(); refreshAfterDefect(); message(`${r.imported} defeito(s) importado(s) da planilha.`, 'success'); }
    catch (e) { defectError(e.message); }
  };
  $('openPriorityFile').textContent = '↓ Baixar planilha (CSV)';
  $('reloadPriority').classList.add('hidden');
  document.querySelector('.priority-help').textContent = 'Nesta versão as regras ficam guardadas neste aparelho. A gramatura ideal do Protheus (SBM · BM_GRAMTIN) continua valendo automaticamente.';
}
$('defectModal').addEventListener('mousedown', e => { if (e.target === $('defectModal')) closeDefect(); });
$('punhoGo').onclick = searchPunho;
$('punhoCancel').onclick = () => { punhoSelecting = false; punhoSelected.clear(); renderStock(visibleRows); };
$('punhoBack').onclick = backToMalha;
$('selAll').onchange = () => { if ($('selAll').checked) currentGroups.forEach(g => punhoSelected.add(g.key)); else punhoSelected.clear(); renderStock(visibleRows); };
$('closeGroup').onclick = closeGroup; $('groupClose2').onclick = closeGroup;
$('groupPrev').onclick = () => openGroup(groupIndex - 1); $('groupNext').onclick = () => openGroup(groupIndex + 1);
$('groupModal').addEventListener('mousedown', e => { if (e.target === $('groupModal')) closeGroup(); });
$('themeToggle').onclick = $('themeToggle2').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('printBtn').onclick = () => openReport();
$('dismissMessage').onclick = clearMessage;
$('closeResults').onclick = goSearch;
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('foldersModal').classList.contains('hidden')) closeFolders();
  else if (!$('phoneModal').classList.contains('hidden')) $('phoneModal').classList.add('hidden');
  else if (!$('defectModal').classList.contains('hidden')) closeDefect();
  else if (!$('groupModal').classList.contains('hidden')) closeGroup();
  else if (!$('historyModal').classList.contains('hidden')) closeHistory();
  else if (!$('reportModal').classList.contains('hidden')) closeReport();
  else if (!$('priorityModal').classList.contains('hidden')) closePriorityEditor();
  else if (document.body.dataset.view === 'results') goSearch();
});
$('filterType').onchange = () => { updateFilterHint(); $('filterValue').value = ''; applyFilters(); };
$('filterValue').oninput = applyFilters;
$('clearFilters').onclick = () => { $('filterValue').value = ''; $('addressFilter').value = ''; applyFilters(); $('filterValue').focus(); };
$('prioritySettingsBtn').onclick = openPriorityEditor;
$('closePriorityModal').onclick = () => closePriorityEditor();
$('cancelPriority').onclick = () => closePriorityEditor();
$('addPriorityRow').onclick = () => { draftRules.push({ group: '', description: '', gramatura: '', tolerance: DEFAULT_TOLERANCE, active: true }); renderPriorityEditor(true); };
$('savePriority').onclick = savePriority;
$('reloadPriority').onclick = reloadPriorityFromDisk;
$('importSbm').onclick = importFromProtheus;
$('openPriorityFile').onclick = async () => {
  try { const d = await api('/api/priority/open', { method: 'POST', body: '{}' }); showPriorityPath(d.filePath); if (NOVA_STATIC) return message('Planilha de regras baixada (CONFIG_PRIORIDADE.csv).', 'info'); message('Planilha aberta no programa padrão do Windows. Para gravar pelo NOVA, feche o arquivo no Excel; depois de editar no Excel, salve, feche e use “Recarregar planilha”.', 'info'); }
  catch (e) { message(e.message, 'error'); }
};
$('priorityModal').addEventListener('mousedown', e => { if (e.target === $('priorityModal')) closePriorityEditor(); });
$('togglePassword').onclick = () => { const p = $('password'), show = p.type === 'password'; p.type = show ? 'text' : 'password'; $('togglePassword').textContent = show ? '◎' : '◉'; $('togglePassword').setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha'); };

updateFilterHint();
updateFolderUi();
syncFolders(true).then(ok => { if (ok) updateFolderUi(); });
setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
(async () => {
  try { await loadPriority(); } catch (e) { console.warn(e); }
  try {
    const st = await api('/api/status');
    if (st.api) $('apiHost').textContent = `Protheus: ${st.api}`;
    if (st.needApiUrl && $('apiUrlWrap')) $('apiUrlWrap').classList.remove('hidden');
    if (st.connected) { setConnection(true, st.username); $('username').value = st.username || ''; goSearch(); }
    else goLogin('');
  } catch (e) { goLogin(e.message); }
})();
