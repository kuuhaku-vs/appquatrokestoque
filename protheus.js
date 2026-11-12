// NOVA — versão GitHub/celular: o navegador consulta o Protheus direto (CORS liberado no REST).
// Atende as mesmas rotas /api/... que o server.js do computador, para a tela funcionar igual.
// Este arquivo é gerado por build_github.py — edite github/protheus.head.js / protheus.tail.js.
(function () {
'use strict';
const CFG = window.NOVA_CONFIG || {};
const store = kind => ({
  get(k, d) { try { const v = window[kind].getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { window[kind].setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { window[kind].removeItem(k); } catch { /* sem armazenamento */ } }
});
const LS = store('localStorage'), SS = store('sessionStorage');
const API_TIMEOUT_MS = 90 * 1000, SEARCH_DEADLINE_MS = 170 * 1000, MAX_PAGES = 100, PAGE_SIZE = 100, DEFAULT_TOLERANCE = 7;
const TENANT = CFG.tenantId || '01,14';
const apiBase = () => String(CFG.apiUrl || LS.get('nova_api_url', '') || '').trim().replace(/\/+$/, '');
const API_PATH = '/api/framework/v1/genericQuery';
const queryUrl = () => { const b = apiBase(); return /genericQuery$/i.test(b) ? b : b + API_PATH; };
const apiHost = () => { try { return new URL(apiBase()).host; } catch { return apiBase(); } };
function httpError(message, status) { return Object.assign(new Error(message), { status }); }
const console = { log() { /* silencioso no celular */ }, warn: window.console.warn.bind(window.console) };

/* ------------------------------ sessão ------------------------------ */
const AUTH_KEY = 'nova_auth_v1', REMEMBER_MS = 30 * 24 * 60 * 60 * 1000, SESSION_MS = 8 * 60 * 60 * 1000;
function loadAuth() {
  const a = LS.get(AUTH_KEY, null) || SS.get(AUTH_KEY, null);
  if (!a || !a.authorization) return null;
  if (a.expiresAt && a.expiresAt < Date.now()) { clearAuth(); return null; }
  return a;
}
function saveAuth(a, remember) { clearAuth(); (remember ? LS : SS).set(AUTH_KEY, a); }
function clearAuth() { LS.del(AUTH_KEY); SS.del(AUTH_KEY); }

/* ------------------------- utilidades (do server.js) ------------------------- */
function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  let s = String(value ?? '').trim().replace(/\s/g, '');
  if (!s) return NaN;
  const m = s.match(/-?[0-9][0-9.,]*/);
  if (!m) return NaN;
  s = m[0].replace(/[.,]+$/, '');
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function normGroup(v) { return String(v ?? '').replace(/\s+/g, '').toUpperCase(); }


function splitCsvLine(line, delimiter) {
  const out = []; let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === delimiter && !quoted) { out.push(value.trim()); value = ''; }
    else value += c;
  }
  out.push(value.trim());
  return out;
}

function rowsFrom(data, depth = 0) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object' || depth > 6) return [];
  for (const key of ['items', 'Items', 'rows', 'Rows', 'records', 'Records', 'results', 'Results']) if (Array.isArray(data[key])) return data[key];
  for (const key of ['data', 'Data', 'result', 'Result', 'response', 'Response', 'content', 'Content', 'payload', 'Payload']) {
    if (data[key] && typeof data[key] === 'object') {
      const found = rowsFrom(data[key], depth + 1);
      if (found.length || Array.isArray(data[key])) return found;
    }
  }
  return [];
}
function responseMeta(data) {
  const candidates = [data, data?.data, data?.result, data?.Result, data?.response];
  return candidates.find(x => x && typeof x === 'object' && !Array.isArray(x)) || {};
}
function field(obj, name) {
  if (!obj || typeof obj !== 'object') return '';
  const norm = x => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = Object.keys(obj).find(k => norm(k) === norm(name));
  return key === undefined ? '' : obj[key];
}
function safeCode(v) { return String(v || '').trim().toUpperCase().replace(/[\u0000-\u001f]/g, '').replace(/'/g, "''"); }


const STOCK_WAREHOUSES = ['01', '93', '98'];   // armazéns que entram na consulta de estoque
const SZ5_FIELDS = 'Z5_PROD,Z5_ALMOXA,Z5_SERIE,Z5_NUMERO,Z5_ENDEREC,Z5_PESOATU,Z5_CMC,Z5_GRAMATU,Z5_TONALID,Z5_OP,Z5_PARTIDA,Z5_DTENT,Z5_4KDTEND,Z5_DOCCQ,Z5_ROMAN,Z5_ULTATU';
const KEY_FIELDS = ['Z5_PROD', 'Z5_ALMOXA', 'Z5_SERIE', 'Z5_NUMERO', 'Z5_ENDEREC', 'Z5_PARTIDA'];
const rowKey = r => KEY_FIELDS.map(k => String(field(r, k) ?? '').trim()).join('|');

// Lê todas as páginas de uma consulta genericQuery.
// adaptive: tenta pedir uma página grande (1000); se a API limitar a 100, volta ao tamanho normal.
// As páginas seguintes são pedidas em ondas paralelas (WAVE) para acelerar consultas grandes.
const BIG_PAGE = 1000, WAVE = 4;
async function fetchAll(params, { maxPages = MAX_PAGES, deadlineMs = SEARCH_DEADLINE_MS, timeoutMs = API_TIMEOUT_MS, pageSize = PAGE_SIZE, adaptive = false } = {}) {
  const started = Date.now();
  const rows = [], seen = new Set();
  let last = {}, reportedTotal = 0, truncated = false, pages = 1, size = pageSize;
  const get = (sz, page) => query({ ...params, pagesize: String(sz), page: String(page) }, timeoutMs);
  const absorb = data => {
    const batch = rowsFrom(data), meta = responseMeta(data);
    reportedTotal = Number(meta.total ?? meta.totalRecords ?? meta.recordsTotal ?? meta.recordCount ?? meta.totalItems ?? 0) || reportedTotal;
    let added = 0;
    for (const row of batch) { const key = JSON.stringify(row); if (!seen.has(key)) { seen.add(key); rows.push(row); added++; } }
    const hasNext = meta.hasNext ?? meta.hasnext ?? meta.has_next ?? meta.nextPage ?? meta.nextpage;
    const flag = hasNext === true || (typeof hasNext === 'string' && /^(true|1|yes)$/i.test(hasNext));
    const totalPages = Number(meta.totalPages ?? meta.totalpages ?? meta.pages ?? 0);
    return { len: batch.length, added, flag, totalPages };
  };
  let first = null;
  if (adaptive) {
    try {
      const data = await get(BIG_PAGE, 1);
      const n = rowsFrom(data).length;
      if (n !== PAGE_SIZE) { first = data; size = BIG_PAGE; }   // 100 exatos = possível limite da API: refaz com 100
    } catch (e) { if (e.status === 401 || e.status === 403 || e.slow) throw e; }
  }
  if (!first) { size = pageSize; first = await get(size, 1); }
  last = first;
  const st = absorb(first);
  const more1 = st.flag || st.totalPages > 1 || reportedTotal > rows.length || st.len >= size;
  if (!more1 || st.len === 0) return { rows, pages, total: reportedTotal, truncated, last };
  let page = 2;
  while (page <= maxPages) {
    if (Date.now() - started > deadlineMs) { truncated = true; break; }
    const need = reportedTotal > 0 ? Math.ceil(reportedTotal / size) : Infinity;
    const wave = [];
    for (let p = page; p <= Math.min(page + WAVE - 1, need, maxPages); p++) wave.push(p);
    if (!wave.length) break;
    const results = await Promise.all(wave.map(p => get(size, p)));
    let done = false;
    results.forEach(d => { last = d; const r = absorb(d); if (r.len < size || r.added === 0) done = true; });
    pages = wave[wave.length - 1];
    if (done) break;
    page += wave.length;
  }
  if (page > maxPages) truncated = true;
  return { rows, pages, total: reportedTotal, truncated, last };
}

// Cadastro de grupos (SBM) com a gramatura ideal BM_GRAMTIN. Fica em memória por 10 minutos.
const SBM_FIELDS = 'BM_GRUPO,BM_DESC,BM_GRAMTIN';
const SBM_CACHE_MS = 10 * 60 * 1000;
let sbmCache = null; // { at, groups: Map(grupo normalizado -> { group, description, gramatura }) }
function sbmGroup(row) {
  const group = String(field(row, 'BM_GRUPO') ?? '').trim();
  const n = parseNumber(field(row, 'BM_GRAMTIN'));
  return { group, description: String(field(row, 'BM_DESC') ?? '').trim(), gramatura: Number.isFinite(n) && n > 0 ? n : null };
}
function cachedGroup(group) {
  if (!sbmCache || Date.now() - sbmCache.at > SBM_CACHE_MS) return null;
  return sbmCache.groups.get(normGroup(group)) || null;
}
async function loadSbm(force = false) {
  if (!force && sbmCache && Date.now() - sbmCache.at < SBM_CACHE_MS) return { ...sbmCache, cached: true };
  const t = Date.now();
  const r = await fetchAll({ tables: 'SBM', fields: SBM_FIELDS }, { pageSize: 200, timeoutMs: Math.min(API_TIMEOUT_MS, 60000), deadlineMs: 120000 });
  const groups = new Map();
  for (const row of r.rows) { const g = sbmGroup(row); if (g.group && !groups.has(normGroup(g.group))) groups.set(normGroup(g.group), g); }
  sbmCache = { at: Date.now(), groups, truncated: r.truncated };
  console.log(`[SBM] ${groups.size} grupo(s) lidos em ${Date.now() - t} ms (${r.pages} página(s))`);
  return { ...sbmCache, cached: false };
}

// Grupo / descrição pelo cadastro de produto (SB1) e de grupos (SBM): consultas pequenas e rápidas.
let lookupPausedUntil = 0;
async function lookupGroup(code, log) {
  const T = Math.min(15000, API_TIMEOUT_MS);
  const res = { group: '', groupDesc: '', productDesc: '', gramIdeal: null, notes: [], slow: false };
  const q = async (label, params) => {
    const t = Date.now();
    try { const r = await fetchAll(params, { maxPages: 1, pageSize: 5, timeoutMs: T }); log(label, `${r.rows.length} linha(s)`, Date.now() - t); return r.rows; }
    catch (e) { if (e.status === 401 || e.status === 403) throw e; if (e.slow) res.slow = true; res.notes.push(`${label}: ${String(e.message).slice(0, 140)}`); log(label, 'ERRO ' + String(e.message).slice(0, 120), Date.now() - t); return null; }
  };
  const sb1 = await q('SB1 produto', { tables: 'SB1', fields: 'B1_COD,B1_DESC,B1_GRUPO', where: `B1_COD = '${code}'` });
  const p = sb1 && sb1[0];
  if (p) { res.group = String(field(p, 'B1_GRUPO') ?? '').trim(); res.productDesc = String(field(p, 'B1_DESC') ?? '').trim(); }
  else if (sb1) res.notes.push('SB1: produto não encontrado no cadastro.');
  if (!res.group) { // alternativa: grupo gravado na SZ6
    const z6 = await q('SZ6 grupo', { tables: 'SZ6', fields: 'Z6_GRUPO', where: `Z6_PROD = '${code}'` });
    const g = z6 && z6[0] ? String(field(z6[0], 'Z6_GRUPO') ?? '').trim() : '';
    if (g) res.group = g;
  }
  if (res.group) {
    const g = cachedGroup(res.group);
    if (g) { res.groupDesc = g.description; res.gramIdeal = g.gramatura; log('SBM grupo (cache)', '1 linha(s)', 0); return res; }
    const where = `BM_GRUPO = '${res.group.replace(/'/g, "''")}'`;
    let bm = await q('SBM grupo', { tables: 'SBM', fields: SBM_FIELDS, where });
    // BM_GRAMTIN é campo customizado: se a API recusar, busca só a descrição.
    if (bm === null && !res.slow) bm = await q('SBM grupo (sem BM_GRAMTIN)', { tables: 'SBM', fields: 'BM_GRUPO,BM_DESC', where });
    if (bm && bm[0]) {
      res.groupDesc = String(field(bm[0], 'BM_DESC') ?? '').trim();
      const n = parseNumber(field(bm[0], 'BM_GRAMTIN'));
      res.gramIdeal = Number.isFinite(n) && n > 0 ? n : null;
    }
  }
  return res;
}

// Rolo pelo RG (leitura do QR da etiqueta). RG = Z5_SERIE + Z5_NUMERO. Não filtra peso nem armazém,
// para mostrar onde o rolo está mesmo se já estiver zerado ou em outro armazém.
// 1) pela série e número; 2) se não achar, pelos rolos com peso do produto lido na etiqueta.
async function findRoll(q) {
  const clean = v => safeCode(v).replace(/[^A-Z0-9]/g, '');
  const serie = clean(q.serie).slice(0, 6), numero = clean(q.numero).slice(0, 12), rg = clean(q.rg) || serie + numero;
  const prods = String(q.prods || '').split(',').map(clean).filter(c => /^[A-Z0-9]{12}$/.test(c)).slice(0, 3);
  if (rg.length < 4) throw httpError('RG inválido.', 400);
  const attempts = [];
  const run = async (label, where, opts = {}) => {
    const t = Date.now();
    try { const r = await fetchAll({ tables: 'SZ5', fields: SZ5_FIELDS, where }, { timeoutMs: Math.min(API_TIMEOUT_MS, 45000), maxPages: 20, adaptive: true, ...opts }); attempts.push({ label, rows: r.rows.length, ms: Date.now() - t }); return r.rows; }
    catch (e) { if (e.status === 401 || e.status === 403) throw e; attempts.push({ label, error: String(e.message).slice(0, 200), ms: Date.now() - t }); return null; }
  };
  const noZeros = v => v.replace(/^0+(?=.)/, '');
  const same = r => {
    const s = clean(field(r, 'Z5_SERIE')), n = clean(field(r, 'Z5_NUMERO'));
    return s + n === rg || (serie && s === serie && noZeros(n) === noZeros(numero)) || noZeros(n) === rg;
  };
  let rows = [];
  if (serie && numero) rows = ((await run('SZ5 pelo RG', `Z5_SERIE = '${serie}' AND Z5_NUMERO LIKE '%${numero}%'`, { maxPages: 2 })) || []).filter(same);
  if (!rows.length) rows = ((await run('SZ5 pelo número do RG', `Z5_NUMERO LIKE '%${rg}%'`, { maxPages: 2 })) || []).filter(same);
  for (const p of prods) {
    if (rows.length) break;
    rows = ((await run(`SZ5 do produto ${p}`, `Z5_PESOATU > 0 AND Z5_PROD = '${p}'`)) || []).filter(same);
  }
  const peso = r => parseNumber(field(r, 'Z5_PESOATU')) || 0;
  rows.sort((a, b) => peso(b) - peso(a));   // primeiro o registro com peso
  const code = clean(rows[0] ? field(rows[0], 'Z5_PROD') : prods[0] || '');
  let lk = null;
  if (code) { try { lk = await lookupGroup(code, () => {}); } catch (e) { if (e.status === 401 || e.status === 403) throw e; } }
  return { rg, rows, product: { code, description: (lk && (lk.productDesc || lk.groupDesc)) || '' }, lookup: lk ? { group: lk.group, groupDesc: lk.groupDesc, gramIdeal: lk.gramIdeal } : null, attempts,
    failed: !rows.length && attempts.length > 0 && attempts.every(a => a.error) };
}

// Sugestões de produto enquanto o usuário digita: cadastro SB1 pelo começo do código e/ou por palavras do nome
// (cada palavra precisa aparecer na descrição, em qualquer ordem). Consultas pequenas, guardadas em memória.
const SUGGEST_LIMIT = 30, SUGGEST_TIMEOUT_MS = 20000, suggestCache = new Map();
function suggestText(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 .,\/+-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}
async function suggestProducts(text) {
  const q = suggestText(text), compact = q.replace(/[^A-Z0-9]/g, '');
  if (compact.length < 3) return { query: q, items: [], more: false };
  if (suggestCache.has(q)) return suggestCache.get(q);
  const words = q.split(' ').filter(Boolean).slice(0, 6);
  const errors = [];
  const run = async where => {
    try { const r = await fetchAll({ tables: 'SB1', fields: 'B1_COD,B1_DESC', where }, { maxPages: 1, pageSize: SUGGEST_LIMIT, timeoutMs: SUGGEST_TIMEOUT_MS }); return r.rows; }
    catch (e) { if (e.status === 401 || e.status === 403) throw e; errors.push(String(e.message || e).slice(0, 160)); return null; }
  };
  // texto sem espaço, só letras e números: pode ser o começo de um código
  const codeLike = words.length === 1 && /^[A-Z0-9]+$/.test(q) && q.length <= 15;
  const [byCode, byName] = await Promise.all([
    codeLike ? run(`B1_COD LIKE '${q}%'`) : Promise.resolve([]),
    run(words.map(w => `B1_DESC LIKE '%${w}%'`).join(' AND '))
  ]);
  const items = [], seen = new Set();
  const add = (rows, by) => (rows || []).forEach(r => {
    const code = String(field(r, 'B1_COD') ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{12}$/.test(code) || seen.has(code)) return;   // a consulta de estoque usa códigos de 12 caracteres
    seen.add(code); items.push({ code, description: String(field(r, 'B1_DESC') ?? '').trim(), by });
  });
  add(byCode, 'codigo'); add(byName, 'nome');
  const failed = byCode === null && byName === null || (!codeLike && byName === null);
  const out = { query: q, items, more: (byCode || []).length >= SUGGEST_LIMIT || (byName || []).length >= SUGGEST_LIMIT, error: failed ? (errors[0] || 'falha na consulta') : '' };
  if (!errors.length) { if (suggestCache.size > 200) suggestCache.clear(); suggestCache.set(q, out); }
  return out;
}

// Pesquisa em etapas. A base (só SZ5) é a fonte confiável; SZ6/SZL só enriquecem se baterem 1:1.
async function searchStock(code) {
  const plain = code.replace(/''/g, "'");
  const attempts = [];
  const log = a => console.log(`[consulta ${plain}] ${a.label}: ${a.error ? 'ERRO ' + a.error.slice(0, 200) : a.rows + ' linha(s)'} (${a.ms} ms)`);
  const attempt = async (label, params, opts) => {
    const t = Date.now();
    try { const r = await fetchAll(params, opts); const a = { label, rows: r.rows.length, ms: Date.now() - t }; attempts.push(a); log(a); return r; }
    catch (e) {
      if (e.status === 401 || e.status === 403) throw e;
      const a = { label, error: e.message, ms: Date.now() - t, slow: !!e.slow }; attempts.push(a); log(a); return null;
    }
  };
  // armazéns consultados: 01, 93 e 98 (lista em STOCK_WAREHOUSES)
  const stockWhere = cond => `Z5_PESOATU > 0 AND ${cond} AND (${STOCK_WAREHOUSES.map(w => `Z5_ALMOXA = '${w}'`).join(' OR ')})`;
  const exact = `Z5_PROD = '${code}'`, prefix = `Z5_PROD LIKE '${code}%'`;
  // grupo/descrição: consulta pequena, em paralelo com a busca de estoque
  const lookupLog = (label, msg, ms) => { const a = { label, ms, ...(String(msg).startsWith('ERRO') ? { error: String(msg) } : { rows: parseInt(msg, 10) || 0 }) }; attempts.push(a); log(a); };
  const lookupP = Date.now() < lookupPausedUntil ? Promise.resolve(null)
    : lookupGroup(code, lookupLog).catch(e => ({ fatal: e }));

  // 1) SZ5 pelo código exato. Três formatos de consulta, do mais completo ao mais simples:
  //    A) filtros completos no where; B) só o código no where (estoque/armazém filtrados aqui);
  //    C) todos os campos (só se a API recusou campos, não se apenas demorou).
  const inStock = r => (parseNumber(field(r, 'Z5_PESOATU')) || 0) > 0 && STOCK_WAREHOUSES.includes(String(field(r, 'Z5_ALMOXA')).trim());
  const BASE_TIMEOUT = Math.min(API_TIMEOUT_MS, 60000);
  let base = null, usedFields = SZ5_FIELDS, mode = 'exata', onlyProductWhere = false;
  const plan = [
    ['SZ5 exata', SZ5_FIELDS, stockWhere(exact), false],
    ['SZ5 exata (filtro simples)', SZ5_FIELDS, `Z5_PROD = '${code}'`, true],
    ['SZ5 exata (todos os campos)', '*', stockWhere(exact), false]
  ];
  let hadHardError = false;
  for (const [label, fields, where, simple] of plan) {
    if (label.includes('todos os campos') && !hadHardError) continue;
    const r = await attempt(label, { tables: 'SZ5', fields, where }, { timeoutMs: BASE_TIMEOUT, adaptive: true });
    if (!r) { const last = attempts[attempts.length - 1]; if (!last.slow) hadHardError = true; continue; }
    if (simple) { r.rows = r.rows.filter(inStock); }
    base = r; usedFields = fields; onlyProductWhere = simple; break;
  }
  if (!base) {
    const last = attempts[attempts.length - 1];
    const resumo = attempts.map(a => `${a.label} (${Math.round(a.ms / 1000)} s)`).join(' → ');
    throw httpError(`A consulta ao Protheus falhou em todas as tentativas [${resumo}]. Última resposta: ${last?.error || 'sem detalhe'} Confira a internet do celular e tente de novo; se continuar, o serviço REST do Protheus pode estar fora.`, last?.slow ? 504 : 502);
  }
  let cond = exact;
  // 2) sem resultado exato: tenta códigos que começam com o texto digitado
  if (!base.rows.length) {
    const r = await attempt('SZ5 por prefixo', { tables: 'SZ5', fields: usedFields, where: onlyProductWhere ? prefix : stockWhere(prefix) }, { timeoutMs: BASE_TIMEOUT, adaptive: true });
    if (r && onlyProductWhere) r.rows = r.rows.filter(inStock);
    if (r && r.rows.length) { base = r; mode = 'prefixo'; cond = prefix; }
  }
  // 3) ainda vazio: verifica se o produto existe sem os filtros de estoque/armazém
  let productExists = null;
  if (!base.rows.length) {
    const r = await attempt('SZ5 existência (sem filtros)', { tables: 'SZ5', fields: 'Z5_PROD,Z5_ALMOXA,Z5_PESOATU', where: `Z5_PROD LIKE '${code}%'` }, { maxPages: 1, pageSize: 5 });
    if (r) productExists = r.rows.length > 0 ? (r.total || r.rows.length) : 0;
  }

  let rows = base.rows, enriched = false, notice = '';
  const lk = await lookupP;
  if (lk && lk.fatal) throw lk.fatal;
  if (lk && lk.slow && !lk.group) lookupPausedUntil = Date.now() + 10 * 60 * 1000;
  if (rows.length) {
    if (lk && lk.group) {
      enriched = true;
      rows = rows.map(r => {
        const o = { ...r };
        if (!String(field(o, 'Z6_GRUPO') ?? '').trim()) o.Z6_GRUPO = lk.group;
        if (lk.groupDesc && !String(field(o, 'Z9_DESC') ?? '').trim()) o.Z9_DESC = lk.groupDesc;
        o.B1_GRUPO = lk.group; if (lk.productDesc) o.B1_DESC = lk.productDesc; if (lk.groupDesc) o.BM_DESC = lk.groupDesc;
        if (lk.gramIdeal) o.BM_GRAMTIN = lk.gramIdeal;
        return o;
      });
    } else {
      const why = !lk ? 'consulta pausada por 10 minutos após falha recente' : (lk.notes.join(' | ') || 'grupo não informado no cadastro');
      notice = `Grupo e descrição não foram carregados (${why.slice(0, 260)}). As regras de gramatura também funcionam cadastrando o CÓDIGO DO PRODUTO no lugar do grupo.`;
    }
  }
  const description = String((lk && (lk.productDesc || lk.groupDesc)) || field(rows[0] || {}, 'Z9_DESC') || '').trim();
  return { rows, product: { code: plain, description }, total: base.total || rows.length, pagesRead: base.pages, truncated: base.truncated, enriched, notice, mode, empty: rows.length === 0, lookup: lk && !lk.fatal ? { group: lk.group, groupDesc: lk.groupDesc, productDesc: lk.productDesc, gramIdeal: lk.gramIdeal } : null,
    diagnostic: { responseKeys: Object.keys(base.last || {}), returnedRows: rows.length, attempts, productExists } };
}


/* ------------------------- consulta HTTP ao Protheus ------------------------- */
// Só Authorization e tenantId (liberados no CORS do Protheus); sem Content-Type, que exigiria outra liberação.
function makeUrl(params) { const u = new URL(queryUrl()); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v)); return u.toString().replace(/\+/g, '%20'); }
async function rawQuery(authorization, params, timeoutMs = API_TIMEOUT_MS) {
  if (!apiBase()) throw httpError('Endereço da API do Protheus não configurado.', 400);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(makeUrl(params), { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', headers: { Authorization: authorization, tenantId: TENANT }, signal: controller.signal });
  } catch (e) {
    const timed = e && e.name === 'AbortError';
    throw Object.assign(httpError(timed
      ? `O Protheus não respondeu em ${Math.round(timeoutMs / 1000)} segundos. Confira a internet do celular (Wi-Fi ou dados móveis) e tente de novo.`
      : `Não foi possível falar com o Protheus (${apiHost()}). Confira a internet do celular. Se a internet estiver boa, o serviço REST do Protheus pode estar fora — ou o usuário/senha foram recusados.`, timed ? 504 : 502), { slow: true, network: true });
  } finally { clearTimeout(timer); }
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { if (response.ok) throw httpError(`O Protheus respondeu HTTP ${response.status}, mas o conteúdo não é JSON: ${raw.slice(0, 300)}`, 502); }
  if (response.status === 401 || response.status === 403) throw httpError(`Protheus recusou a consulta (HTTP ${response.status}). Confira usuário, senha e permissão de consulta.`, response.status);
  if (!response.ok) throw httpError(`API Protheus respondeu HTTP ${response.status}: ${(raw || JSON.stringify(data)).slice(0, 600)}`, 502);
  return data;
}
async function query(params, timeoutMs) {
  const a = loadAuth();
  if (!a) throw httpError('Credenciais não informadas. Entre novamente no Protheus.', 401);
  try { return await rawQuery(a.authorization, params, timeoutMs); }
  catch (e) { if (e.status === 401 || e.status === 403) clearAuth(); throw e; }
}
async function validateCredentials(authorization) {
  try { await rawQuery(authorization, { tables: 'SBM', fields: 'BM_GRUPO', pagesize: '1', page: '1' }, 30000); }
  catch (e) {
    if (e.status === 401) throw httpError('Usuário ou senha inválidos no Protheus.', 401);
    if (e.status === 403) throw httpError('O Protheus aceitou o usuário, mas ele não tem permissão de consulta (HTTP 403). Fale com o TI.', 403);
    if (e.network) throw httpError(`Não foi possível validar o acesso. Confira usuário e senha e a internet do celular. (${apiHost()})`, e.status || 502);
    // outros códigos (400/500): o servidor já autenticou o usuário
  }
}

/* ------------------------- CSV / download ------------------------- */
const csvEsc = v => { const t = String(v ?? '').replace(/[\r\n]+/g, ' '); return /[;"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
function download(name, text) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* ------------------- regras de gramatura (neste aparelho) ------------------- */
const RULES_KEY = 'nova_priority_rules_v1', MAX_PRIORITY_ROWS = 500;
function cleanPriorityRows(input) {
  if (!Array.isArray(input)) throw new Error('Formato de regras inválido.');
  if (input.length > MAX_PRIORITY_ROWS) throw new Error(`Limite de ${MAX_PRIORITY_ROWS} grupos excedido.`);
  const seen = new Set();
  return input.map((x, i) => {
    const group = String(x?.group ?? '').trim();
    if (!group) throw new Error(`Linha ${i + 1}: informe o código do grupo de produto.`);
    const gramatura = parseNumber(x.gramatura);
    if (!Number.isFinite(gramatura) || gramatura <= 0) throw new Error(`Informe uma gramatura válida (maior que zero) para o grupo ${group}.`);
    const empty = x.tolerance === undefined || x.tolerance === null || String(x.tolerance).trim() === '';
    const tolerance = empty ? DEFAULT_TOLERANCE : parseNumber(x.tolerance);
    if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100) throw new Error(`A tolerância do grupo ${group} deve estar entre 0 e 100%.`);
    const key = normGroup(group);
    if (seen.has(key)) throw new Error(`O grupo ${group} está cadastrado mais de uma vez.`);
    seen.add(key);
    return { group, description: String(x.description ?? '').trim().slice(0, 120), gramatura, tolerance, active: x.active !== false };
  });
}
const rulesPath = 'guardadas neste aparelho';

/* ------------------- malhas com defeito (neste aparelho) ------------------- */
const DEFECT_KEY = 'nova_defects_v1';
const DEFECT_OPTIONS = ['BARRAMENTO', 'QUEBRADURA', 'MANCHAS', 'SUJA', 'OUTROS'];
const DEFECT_HEADER = 'produto;op;partida;defeitos;outros;observacao;usuario;data';
const readDefects = () => LS.get(DEFECT_KEY, []).filter(d => d && d.produto && d.op);
function writeDefects(list) { if (!LS.set(DEFECT_KEY, list)) throw new Error('Não foi possível guardar neste aparelho (armazenamento bloqueado ou cheio).'); }
function cleanDefect(body, username) {
  const produto = String(body.produto || '').trim().toUpperCase().slice(0, 40);
  const op = String(body.op || '').trim().slice(0, 40);
  if (!produto || !op) throw new Error('Informe o produto e a OP da malha.');
  const defeitos = [...new Set((Array.isArray(body.defeitos) ? body.defeitos : []).map(x => String(x).trim().toUpperCase()))].filter(x => DEFECT_OPTIONS.includes(x));
  if (!defeitos.length) throw new Error('Selecione pelo menos um defeito.');
  const outros = String(body.outros || '').trim().slice(0, 80);
  if (defeitos.includes('OUTROS') && !outros) throw new Error('Descreva o defeito em "Outros".');
  const now = new Date(), pad = n => String(n).padStart(2, '0');
  return { produto, op, partida: String(body.partida || '').trim().slice(0, 40), defeitos, outros: defeitos.includes('OUTROS') ? outros : '',
    observacao: String(body.observacao || '').trim().slice(0, 300), usuario: username || '',
    data: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}` };
}
function defectsCsv(list) { return [DEFECT_HEADER, ...list.map(d => [d.produto, d.op, d.partida, d.defeitos.join(', '), d.outros, d.observacao, d.usuario, d.data].map(csvEsc).join(';'))].join('\r\n') + '\r\n'; }
// Importa um MALHAS_RUINS.csv (do NOVA do computador ou de outro celular); a linha importada substitui a mesma produto+OP.
function importDefects(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) throw new Error('A planilha está vazia.');
  const head = splitCsvLine(lines[0], ';').map(h => h.trim().toLowerCase());
  const ix = k => head.indexOf(k);
  if (ix('produto') < 0 || ix('op') < 0 || ix('defeitos') < 0) throw new Error('Planilha inválida: precisa das colunas produto;op;defeitos (formato MALHAS_RUINS.csv).');
  const incoming = lines.slice(1).map(l => {
    const c = splitCsvLine(l, ';'), g = k => (ix(k) >= 0 ? String(c[ix(k)] ?? '').trim() : '');
    return { produto: g('produto').toUpperCase(), op: g('op'), partida: g('partida'),
      defeitos: g('defeitos').split(/[,|/]+/).map(x => x.trim().toUpperCase()).filter(x => DEFECT_OPTIONS.includes(x)),
      outros: g('outros'), observacao: g('observacao'), usuario: g('usuario'), data: g('data') };
  }).filter(d => d.produto && d.op && d.defeitos.length);
  const key = d => d.produto + '|' + d.op;
  const map = new Map(readDefects().map(d => [key(d), d]));
  incoming.forEach(d => map.set(key(d), d));
  const rows = [...map.values()]; writeDefects(rows);
  return { imported: incoming.length, rows };
}

/* ------------------------------ rotas ------------------------------ */
async function handle(path, options = {}) {
  const url = new URL(path, location.href), p = url.pathname, m = (options.method || 'GET').toUpperCase();
  const body = () => { try { return JSON.parse(options.body || '{}'); } catch { return {}; } };
  const auth = loadAuth();
  const need = () => { if (!auth) throw httpError('Sessão não autenticada. Entre novamente no Protheus.', 401); };
  if (p.endsWith('/api/status')) return { connected: !!auth, username: auth?.username || null, remembered: !!auth?.remember, api: apiHost(), needApiUrl: !apiBase() };
  if (p.endsWith('/api/login')) {
    const b = body(), username = String(b.username || '').trim(), password = String(b.password || '');
    if (!CFG.apiUrl && b.apiUrl) { if (!/^https:\/\//i.test(b.apiUrl)) throw httpError('O endereço da API precisa começar com https://', 400); LS.set('nova_api_url', b.apiUrl.trim()); }
    if (!apiBase()) throw httpError('Informe o endereço da API do Protheus.', 400);
    if (!username || !password) throw httpError('Informe usuário e senha do Protheus.', 400);
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    const authorization = 'Basic ' + btoa(String.fromCharCode(...bytes));
    await validateCredentials(authorization);
    const remember = b.remember === true;
    saveAuth({ username, authorization, remember, expiresAt: Date.now() + (remember ? REMEMBER_MS : SESSION_MS) }, remember);
    return { ok: true, username, remembered: remember, savedOnDisk: true };
  }
  if (p.endsWith('/api/logout')) { clearAuth(); return { ok: true }; }
  if (p.endsWith('/api/network')) {
    // aberto pelo NOVA.exe: ele informa os endereços deste computador na rede (para o celular no mesmo Wi-Fi)
    if (location.protocol === 'http:' && location.port === '47820') {
      try { const r = await fetch('/__nova/network', { cache: 'no-store' }); if (r.ok) return await r.json(); } catch { /* NOVA.exe antigo */ }
    }
    return { lan: false, urls: [], interfaces: [] };
  }

  if (p.endsWith('/api/priority/open')) {
    const rows = LS.get(RULES_KEY, []);
    download('CONFIG_PRIORIDADE.csv', ['grupo;descricao;gramatura_ideal;tolerancia_percentual;ativo', ...rows.map(x => [x.group, x.description, String(x.gramatura).replace('.', ','), String(x.tolerance).replace('.', ','), x.active === false ? 'nao' : 'sim'].map(csvEsc).join(';'))].join('\r\n') + '\r\n');
    return { ok: true, filePath: rulesPath };
  }
  if (p.endsWith('/api/priority')) {
    if (m === 'PUT') { const rows = cleanPriorityRows(body().rows); if (!LS.set(RULES_KEY, rows)) throw httpError('Não foi possível guardar neste aparelho.', 500); return { ok: true, rows, warnings: [], fileName: 'neste aparelho', savedPath: rulesPath, filePath: rulesPath }; }
    return { rows: LS.get(RULES_KEY, []), warnings: [], fileName: 'neste aparelho', filePath: rulesPath };
  }
  if (p.endsWith('/api/defects/open')) { download('MALHAS_RUINS.csv', defectsCsv(readDefects())); return { ok: true, filePath: 'MALHAS_RUINS.csv' }; }
  if (p.endsWith('/api/defects')) {
    need();
    if (m === 'POST') { const d = cleanDefect(body(), auth.username); const list = readDefects().filter(x => !(x.produto === d.produto && x.op === d.op)); list.push(d); writeDefects(list); return { ok: true, row: d, rows: list, filePath: 'neste aparelho' }; }
    if (m === 'DELETE') { const produto = String(url.searchParams.get('produto') || '').trim().toUpperCase(), op = String(url.searchParams.get('op') || '').trim(); const keep = readDefects().filter(x => !(x.produto === produto && x.op === op)); writeDefects(keep); return { ok: true, rows: keep }; }
    return { rows: readDefects(), filePath: 'neste aparelho', options: DEFECT_OPTIONS };
  }
  if (p.endsWith('/api/sbm')) {
    need();
    const r = await loadSbm(url.searchParams.get('refresh') === '1');
    const groups = [...r.groups.values()].sort((a, b) => a.group.localeCompare(b.group));
    return { groups, withGramatura: groups.filter(g => g.gramatura).length, cached: r.cached, truncated: !!r.truncated, loadedAt: r.at };
  }
  if (p.endsWith('/api/rg')) { need(); const g = k => url.searchParams.get(k) || ''; return findRoll({ rg: g('rg'), serie: g('serie'), numero: g('numero'), prods: g('prods') }); }
  if (p.endsWith('/api/suggest')) { need(); return suggestProducts(url.searchParams.get('q')); }
  if (p.endsWith('/api/stock') || p.endsWith('/api/products')) {
    need();
    const code = safeCode(url.searchParams.get('code'));
    if (code.length < 2) throw httpError('Digite pelo menos 2 caracteres do código.', 400);
    if (code.length > 40) throw httpError('Código muito longo.', 400);
    return searchStock(code);
  }
  throw httpError('Rota não encontrada.', 404);
}

window.NovaLocal = { handle, importDefects };
})();
