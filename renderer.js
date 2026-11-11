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
  $('navThemeIcon').textContent = dark ? '☀' : '☾';
  $('navThemeLabel').textContent = dark ? 'Claro' : 'Escuro';
}

/* ------------------------- janela de confirmação ------------------------- */
// Substitui o confirm() do navegador, que alguns celulares e o modo app bloqueiam ou mostram sem formatação.
// askConfirm({ title, text, card, note, okText, cancelText, altText, tone }) -> 'ok' | 'alt' | false
let askResolve = null;
function askConfirm(o = {}) {
  let m = $('askModal');
  if (!m) {
    m = document.createElement('section'); m.id = 'askModal'; m.className = 'modal-backdrop hidden'; m.setAttribute('role', 'alertdialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'askTitle');
    m.innerHTML = '<div class="ask-modal"><div class="ask-icon" aria-hidden="true"></div><span class="section-kicker ask-kicker"></span><h2 id="askTitle"></h2><p class="ask-text"></p><div class="ask-card"><span></span><b></b><div class="ask-lines"></div></div><p class="ask-note"></p><div class="ask-actions"><button type="button" class="secondary ask-cancel"></button><button type="button" class="secondary ask-alt"></button><button type="button" class="primary ask-ok"></button></div></div>';
    document.body.append(m);
    m.addEventListener('mousedown', e => { if (e.target === m) closeAsk(false); });
    m.querySelector('.ask-cancel').onclick = () => closeAsk(false);
    m.querySelector('.ask-alt').onclick = () => closeAsk('alt');
    m.querySelector('.ask-ok').onclick = () => closeAsk('ok');
  }
  if (askResolve) askResolve(false);
  const q = sel => m.querySelector(sel), tone = o.tone || 'accent';
  q('.ask-modal').className = 'ask-modal tone-' + tone;
  q('.ask-icon').textContent = o.icon || { ok: '✓', danger: '!', warn: '!', accent: '?' }[tone] || '?';
  q('.ask-kicker').textContent = o.kicker || 'CONFIRMAR';
  q('#askTitle').textContent = o.title || 'Confirmar?';
  q('.ask-text').textContent = o.text || ''; q('.ask-text').classList.toggle('hidden', !o.text);
  const card = q('.ask-card'); card.classList.toggle('hidden', !o.card);
  if (o.card) {
    card.querySelector('span').textContent = o.card.label || '';
    card.querySelector('b').textContent = o.card.title || '';
    const ls = card.querySelector('.ask-lines'); ls.replaceChildren();
    (o.card.lines || []).filter(Boolean).forEach(([k, v]) => { const d = document.createElement('div'); const a = document.createElement('small'); a.textContent = k; const b = document.createElement('strong'); b.textContent = v; d.append(a, b); ls.append(d); });
  }
  q('.ask-note').textContent = o.note || ''; q('.ask-note').classList.toggle('hidden', !o.note);
  q('.ask-ok').textContent = o.okText || 'Confirmar';
  q('.ask-ok').classList.toggle('danger-btn', tone === 'danger');
  q('.ask-cancel').textContent = o.cancelText || 'Cancelar';
  q('.ask-alt').textContent = o.altText || ''; q('.ask-alt').classList.toggle('hidden', !o.altText);
  m.classList.remove('hidden');
  setTimeout(() => q('.ask-ok').focus(), 50);
  return new Promise(res => { askResolve = res; });
}
function closeAsk(v) { const m = $('askModal'); if (m) m.classList.add('hidden'); const r = askResolve; askResolve = null; if (r) r(v); }
const askOk = async o => (await askConfirm(o)) === 'ok';

/* ------------------------------ celular ------------------------------ */
const IS_THIS_PC = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
// aberto pelo NOVA.exe: avisa que a janela continua aberta; fechando todas, o NOVA.exe se encerra sozinho
if (location.protocol === 'http:' && location.port === '47820') {
  const novaPing = () => fetch('/__nova/ping', { cache: 'no-store' }).catch(() => {});
  novaPing(); setInterval(novaPing, 20000);
}
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
// Efeito "nova" entre login e pesquisa: o conteúdo se desfaz, as duas peças de canto deslizam até o
// centro e formam a estrela (com um pulso); depois se abrem de novo mostrando a outra tela.
const REDUCED_MOTION = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
const wait = ms => new Promise(r => setTimeout(r, ms));
let novaFxRunning = false;
function fxVars(card) {
  const r = card.getBoundingClientRect(), c = 46;
  card.style.setProperty('--fx-x', `${(r.width - c) / 2}px`);
  card.style.setProperty('--fx-y', `${(r.height - c) / 2}px`);
}
const fxOn = card => !REDUCED_MOTION && card && card.offsetParent;
// fecha o cartão na estrela; loading = a estrela fica pulsando (consulta em andamento)
async function novaClose(card, { loading = false } = {}) {
  if (!fxOn(card)) return;
  fxVars(card);
  card.classList.add('fx-close');
  await wait(520);
  card.classList.add('fx-core');
  if (loading) card.classList.add('fx-loading');
  await wait(380);
}
// abre o cartão a partir da estrela (se não estiver fechado, começa fechado sem animar)
async function novaOpen(card, { fromWidth } = {}) {
  if (!fxOn(card)) { if (card) card.classList.remove('fx-close', 'fx-core', 'fx-loading', 'fx-open'); return; }
  if (!card.classList.contains('fx-close')) { card.classList.add('fx-instant', 'fx-close', 'fx-core'); }
  card.classList.remove('fx-loading');
  const target = card.getBoundingClientRect().width;
  if (fromWidth) card.style.width = fromWidth + 'px';
  fxVars(card);
  void card.offsetWidth;
  card.classList.remove('fx-instant');
  if (fromWidth) requestAnimationFrame(() => { card.style.width = target + 'px'; });
  await wait(fromWidth ? 260 : 160);
  card.classList.remove('fx-core');
  fxVars(card);
  card.classList.add('fx-open');
  card.classList.remove('fx-close');
  await wait(620);
  card.classList.remove('fx-open');
  card.style.width = '';
}
function novaReset(card) { if (card) { card.classList.remove('fx-close', 'fx-core', 'fx-loading', 'fx-open', 'fx-instant'); card.style.width = ''; } }
async function novaTransition(fromCard, toCard, swap) {
  if (novaFxRunning || !fxOn(fromCard)) { swap(); return; }
  novaFxRunning = true;
  try {
    const fromW = fromCard.getBoundingClientRect().width;
    await novaClose(fromCard);
    swap();
    novaReset(fromCard);
    await novaOpen(toCard, { fromWidth: fromW });
  } finally { novaReset(toCard); novaFxRunning = false; }
}
// estrela pulsando no centro enquanto a pesquisa da barra do topo roda (resultados desfocados)
function resultsBusy(on) {
  let l = $('novaLoader');
  if (!l) {
    l = document.createElement('div'); l.id = 'novaLoader'; l.className = 'nova-loader hidden'; l.setAttribute('aria-hidden', 'true');
    l.innerHTML = '<span class="nova-ring"></span><span class="nova-core"><svg viewBox="0 0 24 24"><path d="M12 1.5l2.2 7.2 7.3 2.3-7.3 2.3L12 22.5l-2.2-9.2L2.5 11l7.3-2.3z"/></svg></span>';
    document.body.append(l);
  }
  l.classList.toggle('hidden', !on);
  $('stockSection').classList.toggle('fx-busy', on);
}
function popIn(el) { if (REDUCED_MOTION || !el) return; el.classList.remove('fx-pop'); void el.offsetWidth; el.classList.add('fx-pop'); setTimeout(() => el.classList.remove('fx-pop'), 700); }
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
/* ------------------------- Face ID / biometria ------------------------- */
// Chave de acesso (passkey/WebAuthn) do próprio aparelho. Usuário e senha ficam guardados neste aparelho
// CRIPTOGRAFADOS (AES-GCM) com uma chave que o sistema só entrega depois do Face ID (extensão PRF).
// Sem PRF (iOS antigo), a opção não é oferecida: nada de senha guardada sem proteção.
const BIO_KEY = 'nova_bio_v1', BIO_SKIP = 'nova_bio_skip_v1';
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const BIO_LABEL = IS_IOS ? 'Face ID' : 'biometria';
const BIO_T = IS_IOS ? 'Face ID' : 'Biometria', BIO_O = IS_IOS ? 'o' : 'a', BIO_A = IS_IOS ? 'ado' : 'ada'; // concordância (o Face ID / a biometria)
const PRF_SALT = new TextEncoder().encode('NOVA-Consulta-de-Estoque-PRF-v1!'); // 32 bytes fixos
let bioAvailable = false, lastCreds = null, pendingBioId = null;
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = str => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)), c => c.charCodeAt(0));
const bioData = () => lsGet(BIO_KEY, null);
async function bioCheck() {
  try { bioAvailable = !!(window.PublicKeyCredential && window.isSecureContext && window.crypto && crypto.subtle && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
  catch { bioAvailable = false; }
  updateBioUi();
}
function updateBioUi() {
  const d = bioData(), on = bioAvailable && !!d;
  // sem botão: o Face ID abre ao tocar no campo de senha
  $('faceLogin').classList.add('hidden');
  $('faceRemove').classList.toggle('hidden', !on);
  if (on) { $('faceRemove').textContent = `Remover ${BIO_LABEL} deste aparelho`; if (d.user && !$('username').value) $('username').value = d.user; }
  const offer = bioAvailable && !d && !!lastCreds && !lsGet(BIO_SKIP, false);
  $('faceOffer').classList.toggle('hidden', !offer);
  if (offer && !pendingBioId) { $('faceOfferText').textContent = `Entrar com ${BIO_LABEL} nas próximas vezes?`; $('faceEnable').textContent = 'Ativar'; }
}
async function bioSeal(credId, prf, creds) {
  const key = await crypto.subtle.importKey('raw', prf, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(creds)));
  if (!lsSet(BIO_KEY, { id: credId, iv: b64u(iv), ct: b64u(ct), user: creds.u, at: Date.now() })) throw new Error('Não foi possível guardar neste aparelho.');
}
async function bioAssert(id) {
  const a = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id: unb64u(id) }], userVerification: 'required', timeout: 60000, extensions: { prf: { eval: { first: PRF_SALT } } } } });
  const r = a.getClientExtensionResults().prf;
  if (!r || !r.results || !r.results.first) throw Object.assign(new Error('prf'), { name: 'NoPrf' });
  return r.results.first;
}
const bioNoSupport = () => message(`Este aparelho não permite guardar o acesso com ${BIO_LABEL} com segurança (no iPhone é preciso iOS 18 ou mais novo, no Safari). Continue entrando com usuário e senha.`, 'info');
async function bioEnable() {
  if (!lastCreds) return;
  const btn = $('faceEnable'); btn.disabled = true;
  try {
    if (pendingBioId) { // segunda etapa (alguns aparelhos só entregam a chave numa confirmação)
      const prf = await bioAssert(pendingBioId); await bioSeal(pendingBioId, prf, lastCreds); pendingBioId = null; return bioDone();
    }
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'NOVA - Consulta de Estoque' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: lastCreds.u, displayName: 'NOVA · ' + lastCreds.u },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000, attestation: 'none', extensions: { prf: { eval: { first: PRF_SALT } } } } });
    const ext = cred.getClientExtensionResults().prf || {}, id = b64u(cred.rawId);
    if (ext.results && ext.results.first) { await bioSeal(id, ext.results.first, lastCreds); return bioDone(); }
    if (ext.enabled === false) return bioNoSupport();
    pendingBioId = id;
    $('faceOfferText').textContent = `Quase lá: toque em Confirmar e olhe para o celular mais uma vez.`; $('faceEnable').textContent = 'Confirmar';
  } catch (e) {
    if (e.name === 'NoPrf') { pendingBioId = null; bioNoSupport(); lsSet(BIO_SKIP, true); updateBioUi(); }
    else if (e.name === 'NotAllowedError' || e.name === 'AbortError') message(`${BIO_T} cancel${BIO_A}.`, 'info');
    else message(`Não foi possível ativar ${BIO_O} ${BIO_LABEL}: ${e.message}`, 'error');
  } finally { btn.disabled = false; }
}
function bioDone() { lastCreds = null; updateBioUi(); message(`${BIO_T} ativ${BIO_A} neste aparelho. Na próxima vez, é só tocar no campo de senha.`, 'success'); }
let bioSkipField = false; // depois de cancelar, o próximo toque na senha deixa digitar
async function bioLogin() {
  const d = bioData(); if (!d) return;
  const btn = $('faceBtn'); if (btn.disabled) return;
  btn.disabled = true; loginError('');
  try {
    const prf = await bioAssert(d.id);
    const key = await crypto.subtle.importKey('raw', prf, 'AES-GCM', false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(d.iv) }, key, unb64u(d.ct));
    const creds = JSON.parse(new TextDecoder().decode(pt));
    $('username').value = creds.u;
    await login(null, creds);
  } catch (e) {
    bioSkipField = true;
    if (e.name === 'NotAllowedError' || e.name === 'AbortError') loginError(`${BIO_T} cancel${BIO_A}. Digite a senha para entrar.`);
    else loginError(`Não foi possível entrar com ${BIO_LABEL}. Entre com usuário e senha.`);
  } finally { btn.disabled = false; }
}
// tocar no campo de senha com o Face ID ativado: abre o Face ID em vez do teclado
function bioFromPassword(e) {
  if (!bioAvailable || !bioData() || bioSkipField || $('password').value) return;
  e.preventDefault(); $('password').blur(); bioLogin();
}
async function bioRemove() {
  if (!(await askOk({ tone: 'warn', kicker: BIO_LABEL.toUpperCase(), title: `Remover ${BIO_O} ${BIO_LABEL} deste aparelho?`, text: 'Você volta a entrar com usuário e senha.', okText: 'Remover' }))) return;
  lsDel(BIO_KEY); lsDel(BIO_SKIP); updateBioUi();
  message(IS_IOS ? 'Face ID removido do NOVA. Se quiser, apague também a chave "NOVA" em Ajustes › Senhas.' : 'Biometria removida do NOVA neste aparelho.', 'info');
}

async function login(e, bioCreds) {
  if (e) e.preventDefault();
  if ($('connectBtn').disabled) return;
  const username = bioCreds ? bioCreds.u : $('username').value.trim(), password = bioCreds ? bioCreds.p : $('password').value;
  if (!username || !password) { loginError('Informe usuário e senha do Protheus.'); (username ? $('password') : $('username')).focus(); return; }
  $('connectBtn').disabled = true; $('connectBtn').innerHTML = '<span class="spinner"></span> Validando acesso…'; loginError('');
  try {
    const d = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password, remember: $('remember').checked, apiUrl: $('apiUrl') ? $('apiUrl').value.trim() : '' }) }, 45000);
    $('password').value = '';
    setConnection(true, d.username);
    if (!bioCreds) lastCreds = { u: username, p: password }; // fica só na memória, para ativar o Face ID
    updateBioUi();
    await novaTransition($('loginForm'), $('codeForm'), goSearch);
    $('codeInput').focus();
    if (d.remembered && d.savedOnDisk === false) message('Conectado por 30 dias. Se o computador do NOVA for reiniciado ou a janela do servidor for fechada, será preciso entrar de novo.', 'info');
  } catch (err) {
    loginError(err.message || 'Não foi possível validar o acesso.');
    if (err.status === 401 && bioCreds) { lsDel(BIO_KEY); updateBioUi(); loginError(`A senha do Protheus mudou. Entre com usuário e senha; depois ative ${BIO_O} ${BIO_LABEL} de novo.`); }
    if (err.status === 401) { $('password').value = ''; $('password').focus(); }
  } finally { $('connectBtn').disabled = false; $('connectBtn').textContent = 'Entrar'; }
}
async function logout() {
  lastCreds = null; pendingBioId = null; bioSkipField = false;
  try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch { /* sessão local já descartada */ }
  currentRows = []; visibleRows = [];
  if (document.body.dataset.view === 'search') await novaTransition($('codeForm'), $('loginForm'), () => goLogin(''));
  else goLogin('');
  message('Sessão encerrada.', 'info');
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
function pinSlot() { const t = document.createElement('span'); t.className = 'loc-tag empty'; t.setAttribute('aria-hidden', 'true'); return t; }
function locationTag(r) {
  if (!locationScore(r)) return null;
  const parts = [];
  if (String(field(r, 'Z5_ALMOXA') ?? '').trim() === PRIORITY_WAREHOUSE) parts.push('Arm. 93');
  const ad = normalizeFilter(field(r, 'Z5_ENDEREC')), pre = PRIORITY_ADDR_PREFIXES.find(p => ad.startsWith(p));
  if (pre) parts.push(pre);
  const t = document.createElement('span'); t.className = 'loc-tag'; t.textContent = '📍';
  t.title = `Local prioritário: ${parts.join(' · ')} (armazém 93 / endereços AM01 e AM02)`; t.setAttribute('aria-label', t.title); return t;
}

/* --------------------------- malhas com defeito --------------------------- */
// Planilha dados/MALHAS_RUINS.csv: uma linha por produto + OP.
const DEFECT_OPTIONS = [['BARRAMENTO', 'Barramento'], ['QUEBRADURA', 'Quebradura'], ['MANCHAS', 'Manchas'], ['SUJA', 'Suja'], ['OUTROS', 'Outros']];
let defects = new Map(), defectTarget = null;
const defectKey = (prod, op) => `${String(prod || '').trim().toUpperCase()}|${String(op || '').trim()}`;
function setDefects(rows) { defects = new Map((rows || []).map(d => [defectKey(d.produto, d.op), d])); }
// Com a planilha da equipe conectada (Pastas), os defeitos ficam na aba "Defeitos" e todos veem os mesmos.
// Sem ela: computador = dados/MALHAS_RUINS.csv; celular/GitHub = neste aparelho.
const DCACHE_KEY = 'nova_defects_cache_v1';
let defectsRemoteOff = false;   // planilha com script antigo (sem a aba Defeitos)
const sharedDefects = () => isShared() && !defectsRemoteOff;
async function remoteDefects(action, data) {
  try { return await remote(action, data); }
  catch (e) {
    if (/Ação desconhecida/i.test(e.message)) {
      defectsRemoteOff = true;
      message('A planilha da equipe está com o script antigo: os defeitos continuam só neste aparelho. Cole a versão nova do script (PLANILHA_PASTAS_Code.gs) e publique uma nova versão para compartilhar os defeitos.', 'error');
      return null;
    }
    throw e;
  }
}
async function loadDefects() {
  if (!connected) return;
  if (sharedDefects()) {
    try { const j = await remoteDefects('listDefects'); if (j) { setDefects(j.defects); lsSet(DCACHE_KEY, j.defects); return j; } }
    catch (e) { const c = lsGet(DCACHE_KEY, null); if (Array.isArray(c)) { setDefects(c); return; } throw e; }
  }
  const d = await api('/api/defects'); setDefects(d.rows); return d;
}
// defeitos que estão só neste aparelho/computador e ainda não estão na planilha
async function localOnlyDefects() {
  if (!sharedDefects()) return [];
  try { const d = await api('/api/defects'); return (d.rows || []).filter(x => !defects.has(defectKey(x.produto, x.op))); } catch { return []; }
}
async function migrateDefects() {
  const list = await localOnlyDefects(); if (!list.length) return;
  const btn = $('defectMigrate'); btn.disabled = true; let n = 0;
  try { for (const d of list) { const j = await remoteDefects('saveDefect', { defect: d }); if (!j) break; setDefects(j.defects); n++; } lsSet(DCACHE_KEY, [...defects.values()]); message(`${n} defeito(s) enviados para a planilha da equipe.`, 'success'); }
  catch (e) { message(`${e.message} (${n} enviados até aqui — pode tentar de novo, não duplica).`, 'error'); }
  finally { btn.disabled = false; btn.classList.add('hidden'); refreshAfterDefect(); }
}
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
  $('defectWhere').textContent = sharedDefects() ? 'Fica na planilha da equipe: todos veem.' : '';
  $('defectMigrate').classList.add('hidden');
  localOnlyDefects().then(l => { if (l.length) { $('defectMigrate').textContent = `⇪ Enviar ${l.length} defeito(s) deste aparelho para a planilha`; $('defectMigrate').classList.remove('hidden'); } });
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
    const payload = { ...defectTarget, defeitos, outros: $('defectOther').value, observacao: $('defectObs').value };
    let row, where;
    const j = sharedDefects() ? await remoteDefects('saveDefect', { defect: payload }) : null;
    if (j) { setDefects(j.defects); lsSet(DCACHE_KEY, j.defects); row = j.defect; where = 'Gravado na planilha da equipe.'; }
    else { const d = await api('/api/defects', { method: 'POST', body: JSON.stringify(payload) }); setDefects(d.rows); row = d.row; where = NOVA_STATIC ? 'Guardado neste aparelho.' : 'Gravado na planilha MALHAS_RUINS.csv.'; }
    const op = defectTarget.op; closeDefect(); refreshAfterDefect();
    message(`Defeito registrado para a OP ${op}: ${defectText(row)}. ${where}`, 'success');
  } catch (e) { defectError(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Salvar na planilha'; }
}
async function removeDefect() {
  if (!defectTarget || !(await askOk({ tone: 'danger', kicker: 'DEFEITO', title: `Remover a marcação de defeito da OP ${defectTarget.op}?`, okText: 'Remover marcação' }))) return;
  try {
    const j = sharedDefects() ? await remoteDefects('removeDefect', { produto: defectTarget.produto, op: defectTarget.op }) : null;
    if (j) { setDefects(j.defects); lsSet(DCACHE_KEY, j.defects); }
    // também tira do aparelho/computador, para não voltar ao enviar os defeitos locais
    try { const d = await api(`/api/defects?produto=${encodeURIComponent(defectTarget.produto)}&op=${encodeURIComponent(defectTarget.op)}`, { method: 'DELETE' }); if (!j) setDefects(d.rows); } catch (e) { if (!j) throw e; }
    const op = defectTarget.op; closeDefect(); refreshAfterDefect();
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
  $('navFoldersLabel').textContent = f ? f.name : 'Pastas';
  $('navFolderDot').classList.toggle('hidden', !f);
  const h = document.querySelector('#codeForm h1');
  if (h) h.textContent = f ? 'Qual código deseja procurar?' : 'Consultar Material';
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
// tira um RG da pasta; se a OP ficar sem RG, a OP inteira sai
async function removeRollFrom(folderId, key, r) {
  const same = x => x.rg === r.rg && x.endereco === r.endereco;
  const cur = folderById(readFolders(), folderId), it = cur && cur.items.find(x => x.key === key);
  if (!it) return true;
  const rest = it.rolos.filter(x => !same(x));
  return folderOp(
    () => rest.length ? remote('saveItem', { folderId, item: { ...it, rolos: rest } }) : remote('removeItem', { folderId, itemKey: key }),
    () => { const d = readFolders(), f = folderById(d, folderId); if (!f) return false;
      const x = f.items.find(y => y.key === key); if (!x) return true;
      x.rolos = x.rolos.filter(y => !same(y)); if (!x.rolos.length) f.items = f.items.filter(y => y.key !== key);
      f.updatedAt = Date.now(); return writeFolders(d); });
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
    const ans = await askConfirm({ tone: 'warn', kicker: 'OP JÁ SALVA', title: `A OP ${g.op} já está na pasta "${f.name}"`, text: 'Você pode atualizar os rolos (mantém o que já foi pego) ou tirar a OP da pasta.', okText: '↻ Atualizar rolos', altText: 'Tirar da pasta', cancelText: 'Cancelar' });
    if (!ans) return;
    if (ans === 'alt') {
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
    const pill = document.createElement('button'); pill.type = 'button'; pill.className = 'conn-pill';
    pill.innerHTML = '<i></i>Conectado'; pill.title = `Pastas compartilhadas com a equipe (Planilha Google)${folderSyncAt ? ' · atualizado ' + new Date(folderSyncAt).toLocaleTimeString('pt-BR') : ''}`;
    const menu = document.createElement('div'); menu.className = 'conn-menu hidden';
    const info = document.createElement('small'); info.textContent = `Planilha Google${folderSyncAt ? ' · ' + new Date(folderSyncAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}`;
    const up = document.createElement('button'); up.type = 'button'; up.className = 'link-btn'; up.textContent = '↻ Atualizar';
    up.onclick = async () => { if (await syncFolders(false)) { rerenderFolders(); updateFolderUi(); } };
    const off = document.createElement('button'); off.type = 'button'; off.className = 'link-btn danger-link'; off.textContent = 'Desconectar';
    off.onclick = async () => { if (!(await askOk({ tone: 'warn', kicker: 'PASTAS DA EQUIPE', title: 'Desconectar este aparelho das pastas compartilhadas?', text: 'Nada é apagado da planilha.', okText: 'Desconectar' }))) return; lsDel(PKEY_KEY); if (!fixedUrl) lsDel(PURL_KEY); lsDel(FCACHE_KEY); stopFolderPoll(); renderFoldersList(); updateFolderUi(); };
    menu.append(info, up, off);
    pill.onclick = () => menu.classList.toggle('hidden');
    box.append(pill, menu);
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
      loadDefects().then(() => { if (document.body.dataset.view === 'results') applyFilters(); }).catch(() => {});
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
    const os = opStats(f); const m = document.createElement('span'); m.textContent = `${os.done} de ${os.ops} OP(s) pegas${f.createdBy ? ' · ' + f.createdBy : ''} · ${fmtDay(f.createdAt)}`;
    const bar = document.createElement('i'); bar.className = 'mini-bar'; bar.style.setProperty('--p', os.ops ? (os.done / os.ops * 100).toFixed(0) + '%' : '0%');
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
  if (folderOpenId !== id) folderOpenOps.clear();
  folderOpenId = id;
  closeClearBox();
  $('foldersList').classList.add('hidden'); $('folderView').classList.remove('hidden');
  $('foldersModal').classList.remove('hidden');
  renderFolder();
  startFolderPoll();
  if (await syncFolders(false)) { rerenderFolders(); updateFolderUi(); }
}
async function deleteFolderAction() {
  const d = readFolders(), f = folderById(d, folderOpenId);
  if (!f || !(await askOk({ tone: 'danger', kicker: 'EXCLUIR PASTA', title: `Excluir a pasta "${f.name}"?`, text: `Todas as OPs salvas nela também saem.${isShared() ? ' Ela some para TODOS os usuários.' : ''}`, okText: 'Excluir pasta' }))) return;
  const ok = await folderOp(
    async () => { await remote('deleteFolder', { folderId: f.id }); if (lsGet(FACTIVE_KEY, null) === f.id) setActive(null); },
    () => { d.folders = d.folders.filter(x => x.id !== f.id); if (d.active === f.id) d.active = null; return writeFolders(d); });
  if (ok) { openFolders(); message(`Pasta "${f.name}" excluída.`, 'info'); }
}
// Limpar pasta: tira as OPs já pegas (separação concluída) ou esvazia a pasta toda, sem excluir a pasta.
function openClearBox() {
  const f = folderById(readFolders(), folderOpenId); if (!f) return;
  const box = $('folderClearBox');
  if (!box.classList.contains('hidden')) return closeClearBox();
  const s = opStats(f);
  if (!s.ops) return message('A pasta já está vazia.', 'info');
  $('folderClearInfo').textContent = `A pasta "${f.name}" tem ${s.ops} OP(s): ${s.done} já pega(s) e ${s.todo} a pegar. A pasta continua existindo, só as OPs saem dela${isShared() ? ' (para todos os usuários)' : ''}.`;
  $('folderClearDone').textContent = `✓ Tirar só as OPs já pegas (${s.done})`;
  $('folderClearDone').disabled = !s.done;
  $('folderClearAll').textContent = `🧹 Esvaziar a pasta inteira (${s.ops})`;
  box.classList.remove('hidden');
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function closeClearBox() { $('folderClearBox').classList.add('hidden'); }
async function clearFolderAction(onlyPicked) {
  const f = folderById(readFolders(), folderOpenId); if (!f) return;
  const keys = f.items.filter(it => !onlyPicked || opPicked(it).length).map(it => it.key);
  if (!keys.length) { closeClearBox(); return message(onlyPicked ? 'Nenhuma OP pega para tirar.' : 'A pasta já está vazia.', 'info'); }
  const what = onlyPicked ? `as ${keys.length} OP(s) já pegas` : `TODAS as ${keys.length} OP(s)`;
  if (!(await askOk({ tone: 'danger', kicker: 'LIMPAR PASTA', title: `Tirar ${what} da pasta "${f.name}"?`, text: `${isShared() ? 'A mudança vale para TODOS os usuários. ' : ''}Isso não pode ser desfeito (exporte a planilha antes, se quiser guardar).`, okText: 'Limpar' }))) return;
  closeClearBox();
  const btns = ['folderClear', 'folderClearDone', 'folderClearAll'].map($); btns.forEach(b => { b.disabled = true; });
  const ok = await folderOp(
    async () => {
      try { await remote('clearItems', { folderId: f.id, onlyPicked: !!onlyPicked, itemKeys: keys }); }
      catch (e) {
        if (!/desconhecida/i.test(e.message)) throw e;
        // script antigo na planilha (sem "clearItems"): tira uma OP por vez
        for (const k of keys) await remote('removeItem', { folderId: f.id, itemKey: k });
      }
    },
    () => { const d = readFolders(), ff = folderById(d, f.id); if (!ff) return false; const set = new Set(keys); ff.items = ff.items.filter(it => !set.has(it.key)); ff.updatedAt = Date.now(); return writeFolders(d); });
  btns.forEach(b => { b.disabled = false; });
  keys.forEach(k => folderOpenOps.delete(k));
  if (ok) { updateSaveBtn(); message(`${keys.length} OP(s) tirada(s) da pasta "${f.name}".`, 'success'); }
}
// Pasta: uma linha por OP (caixa + OP/partida + endereços). Tocar abre a seleção de RG logo abaixo.
// A OP conta como "pega" quando tem pelo menos 1 RG marcado (normalmente basta uma malha).
const folderOpenOps = new Set();
const opPicked = it => it.rolos.filter(r => r.picked);
function opStats(f) { const done = f.items.filter(it => opPicked(it).length).length; return { ops: f.items.length, done, todo: f.items.length - done }; }
// ordem alfabética: descrição do item, depois código, OP e partida; RGs em ordem numérica
const ptCmp = (a, b) => String(a || '').localeCompare(String(b || ''), 'pt-BR', { sensitivity: 'base', numeric: true });
const sortItems = items => [...items].sort((a, b) => ptCmp(a.descricao || a.produto, b.descricao || b.produto) || ptCmp(a.produto, b.produto) || ptCmp(a.op, b.op) || ptCmp(a.partida, b.partida));
const sortRolos = rolos => [...rolos].sort((a, b) => ptCmp(a.rg, b.rg) || ptCmp(a.endereco, b.endereco));
const pickedRolls = f => sortItems(f.items).flatMap(it => sortRolos(it.rolos).filter(r => r.picked).map(r => ({ it, r })));
const hasVal = v => v !== null && v !== undefined && v !== '';
const opHasBaixa = it => it.rolos.some(r => r.picked && hasVal(r.pesoBaixa));
function folderSubText(f) { const s = opStats(f); return `${s.done} de ${s.ops} OP(s) pegas${isShared() ? ' · compartilhada' : ' · só neste aparelho'}`; }
function renderFolder() {
  const d = readFolders(), f = folderById(d, folderOpenId);
  if (!f) { $('folderView').classList.add('hidden'); $('foldersList').classList.remove('hidden'); renderFoldersList(); return; }
  const s = opStats(f);
  $('folderName').textContent = '📁 ' + f.name;
  $('folderSub').textContent = folderSubText(f);
  $('folderBar').style.width = s.ops ? (s.done / s.ops * 100).toFixed(1) + '%' : '0%';
  $('folderUse').textContent = d.active === f.id ? '✓ Pasta ativa' : 'Usar para salvar';
  $('folderUse').disabled = d.active === f.id;
  document.querySelectorAll('#folderView .folder-tools .seg button').forEach(b => {
    b.classList.toggle('on', b.dataset.show === folderShow);
    const n = b.dataset.show === 'todo' ? s.todo : b.dataset.show === 'done' ? f.items.filter(it => opPicked(it).length && !opHasBaixa(it)).length : b.dataset.show === 'baixas' ? baixaRolls(f).length : s.ops;
    b.textContent = `${{ todo: 'A pegar', all: 'Todas', done: 'Pegas', baixas: 'Baixas' }[b.dataset.show]} ${n}`;
  });
  const body = $('folderBody'); body.replaceChildren();
  body.classList.toggle('baixas-mode', folderShow === 'baixas');
  if (!f.items.length) { const e = document.createElement('div'); e.className = 'history-empty'; e.textContent = 'Pasta vazia. Toque em "Pesquisar código", abra a OP e use 💾 Salvar.'; body.append(e); return; }
  if (folderShow === 'baixas') return renderBaixas(f, body);
  const byProd = new Map();
  sortItems(f.items).forEach(it => {
    const has = opPicked(it).length > 0, keep = folderOpenOps.has(it.key); // OP aberta continua na tela até fechar
    if (folderShow === 'todo' && has && !keep) return;
    if (folderShow === 'done' && (!has || opHasBaixa(it)) && !keep) return;
    if (!byProd.has(it.produto)) byProd.set(it.produto, []);
    byProd.get(it.produto).push(it);
  });
  if (!byProd.size) { const e = document.createElement('div'); e.className = 'history-empty'; e.textContent = folderShow === 'todo' ? '🎉 Todas as OPs desta pasta já foram pegas.' : 'Nenhuma OP pega aguardando peso. As que já têm peso para baixa estão na aba Baixas.'; body.append(e); return; }
  byProd.forEach((items, prod) => {
    const sec = document.createElement('section'); sec.className = 'fp';
    const h = document.createElement('div'); h.className = 'fp-head';
    const t = document.createElement('span');
    const ds = document.createElement('strong'); ds.textContent = items[0].descricao || 'Produto';
    const code = document.createElement('b'); code.textContent = prod;
    t.append(ds, code);
    const again = document.createElement('button'); again.type = 'button'; again.className = 'icon-btn'; again.textContent = '🔍'; again.title = 'Pesquisar este código de novo'; again.setAttribute('aria-label', `Pesquisar ${prod} de novo`);
    again.onclick = () => { closeFolders(); rerun(prod); };
    h.append(t, again); sec.append(h);
    const list = document.createElement('div'); list.className = 'fp-list';
    items.forEach(it => list.append(opRow(f, it)));
    sec.append(list); body.append(sec);
  });
}
// Aba "Baixas": só os RGs pegos que têm Peso Total para baixar, em ordem alfabética pela descrição.
// A caixa marca que a baixa já foi feita no Protheus (fica gravada no aparelho e na planilha da equipe).
const baixaRolls = f => pickedRolls(f).filter(x => hasVal(x.r.pesoBaixa));
function renderBaixas(f, body) {
  const list = baixaRolls(f);
  if (!list.length) { const e = document.createElement('div'); e.className = 'history-empty'; e.textContent = 'Nenhum RG com Peso Total para baixar. Ao marcar o RG em "A pegar", informe o Peso Total.'; body.append(e); return; }
  const done = list.filter(x => x.r.baixado).length;
  const acts = document.createElement('div'); acts.className = 'bx-actions';
  const info = document.createElement('span'); info.className = 'bx-count'; info.textContent = `${done} de ${list.length} baixa(s) efetuada(s)`;
  const pr = document.createElement('button'); pr.type = 'button'; pr.className = 'secondary'; pr.textContent = '🖨 Imprimir'; pr.onclick = () => togglePrintOpts(f, body);
  const cp = document.createElement('button'); cp.type = 'button'; cp.className = 'secondary'; cp.textContent = '📋 Copiar lista'; cp.onclick = () => copyBaixas(f);
  acts.append(info, pr, cp); body.append(acts);
  const tbl = document.createElement('div'); tbl.className = 'bx-table';
  const head = document.createElement('div'); head.className = 'bx-row bx-head';
  ['', 'RG · Produto', 'Peso (kg)', 'MC', ''].forEach((x, k) => { const c = document.createElement('span'); c.textContent = x; if (!k) c.setAttribute('aria-label', 'Baixa efetuada'); if (k === 4) c.setAttribute('aria-label', 'Copiar RG'); head.append(c); });
  tbl.append(head);
  list.forEach(({ it, r }) => {
    // linha inteira abre a correção do peso, menos a caixa de "baixa efetuada" e o botão de copiar
    const row = document.createElement('div'); row.className = 'bx-row bx-item' + (r.baixado ? ' done' : '');
    row.tabIndex = 0; row.setAttribute('role', 'button'); row.title = 'Toque para alterar o peso para baixa';
    row.setAttribute('aria-label', `RG ${r.rg}, ${it.descricao || 'Produto'}, ${fmtNum(Number(r.pesoBaixa), 2)} kg. Alterar o peso para baixa`);
    row.onclick = e => { if (e.target.closest('.bx-check, .bx-copyrg')) return; openBaixa(f.id, it, r); };
    row.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); openBaixa(f.id, it, r); } };
    const ck = document.createElement('label'); ck.className = 'bx-check'; ck.title = 'Baixa efetuada';
    const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!r.baixado; inp.setAttribute('aria-label', `Baixa efetuada do RG ${r.rg}`);
    inp.onchange = async () => {
      if (!inp.checked) return setBaixado(f.id, it.key, r, false);
      // baixa feita no Protheus: confirma e o RG sai da pasta
      const ok = await askOk({ tone: 'ok', kicker: 'BAIXA EFETUADA', title: 'A baixa já foi feita no Protheus?',
        card: { label: `RG ${r.rg}`, title: it.descricao || it.produto, lines: [['Código', it.produto], ['Peso para baixa', fmtNum(Number(r.pesoBaixa), 2) + ' kg'], hasVal(r.mc) ? ['MC', String(r.mc)] : null, ['OP', `${it.op || '—'} · ${it.partida || '—'}`]] },
        note: `Ao confirmar, o RG sai da pasta "${f.name}"${isShared() ? ' para todos os usuários' : ''}.`, okText: '✓ Sim, baixa feita', cancelText: 'Ainda não' });
      if (!ok) { inp.checked = false; return; }
      row.classList.add('leaving'); inp.disabled = true;
      const done = await removeRollFrom(f.id, it.key, r);
      if (done) message(`Baixa do RG ${r.rg} confirmada. O RG saiu da pasta "${f.name}".`, 'success');
      else { row.classList.remove('leaving'); inp.disabled = false; inp.checked = false; }
    };
    ck.append(inp);
    // RG em cima; descrição e código embaixo, no mesmo estilo
    const c1 = document.createElement('span'); c1.className = 'bx-main';
    const rg = document.createElement('b'); rg.className = 'bx-rg'; rg.textContent = r.rg || '—';
    const dn = document.createElement('small'); dn.className = 'bx-sub'; dn.textContent = it.descricao || 'Produto';
    const dc = document.createElement('small'); dc.className = 'bx-sub'; dc.textContent = it.produto + (r.baixado && r.baixadoBy ? ' · baixado por ' + r.baixadoBy : '');
    c1.append(rg, dn, dc);
    const c3 = document.createElement('strong'); c3.textContent = fmtNum(Number(r.pesoBaixa), 2);
    const c4 = document.createElement('strong'); c4.textContent = hasVal(r.mc) ? r.mc : '—';
    const cpy = document.createElement('button'); cpy.type = 'button'; cpy.className = 'bx-copyrg'; cpy.textContent = '⧉'; cpy.title = `Copiar o RG ${r.rg}`; cpy.setAttribute('aria-label', `Copiar o RG ${r.rg}`);
    cpy.onclick = e => { e.stopPropagation(); copyRg(r.rg, cpy); };
    row.append(ck, c1, c3, c4, cpy);
    tbl.append(row);
  });
  body.append(tbl);
  if (printOptsFor === f.id) buildPrintOpts(f, body);
}
// copia só o RG (para colar no Protheus na hora da baixa)
async function copyRg(rg, btn) {
  const ok = await copyText(String(rg || ''));
  if (ok) { btn.textContent = '✓'; btn.classList.add('ok'); setTimeout(() => { btn.textContent = '⧉'; btn.classList.remove('ok'); }, 1400); message(`RG ${rg} copiado.`, 'success'); }
  else message('Não foi possível copiar neste navegador.', 'error');
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch {
    // navegadores sem a API de área de transferência (ou sem permissão): copia por um campo escondido
    try { const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.append(ta); ta.select(); ta.setSelectionRange(0, t.length); const ok = document.execCommand('copy'); ta.remove(); return ok; }
    catch { return false; }
  }
}
async function copyBaixas(f) {
  const list = baixaRolls(f);
  const lines = [`Baixas da pasta ${f.name}`, ''];
  list.forEach(({ it, r }) => lines.push(`${r.baixado ? '[x]' : '[ ]'} RG ${r.rg} · ${it.descricao || it.produto} (${it.produto}) · Peso ${fmtNum(Number(r.pesoBaixa), 2)} kg · MC ${hasVal(r.mc) ? r.mc : '—'}`));
  try { await navigator.clipboard.writeText(lines.join('\n')); message('Lista de baixas copiada. Cole no WhatsApp, e-mail ou bloco de notas.', 'success'); }
  catch { message('Não foi possível copiar neste navegador. Use 🖨 Imprimir ou ↓ Exportar planilha.', 'error'); }
}
// impressão: folha só com a logo do grupo e a tabela de baixas (o resto da tela some no papel).
// Opções: retrato/paisagem e 1 ou 2 colunas; no automático, divide em 2 colunas e diminui a letra
// para caber tudo numa página (se ainda assim não couber, continua na página seguinte).
const PRINT_KEY = 'nova_print_baixas';
let printOptsFor = null;   // pasta com o painel de impressão aberto (continua aberto quando a lista se atualiza sozinha)
const printPrefs = () => Object.assign({ orient: 'portrait', cols: 'auto' }, lsGet(PRINT_KEY, {}) || {});
function printPlan(n, prefs) {
  const avail = prefs.orient === 'landscape' ? 145 : 232;   // mm livres para as linhas (A4, tirando margens, cabeçalho e rodapé)
  const ROW = 9, MIN = 4.4;                                   // altura normal e mínima da linha (mm)
  const cols = prefs.cols === '1' ? 1 : prefs.cols === '2' ? 2 : (n * ROW > avail ? 2 : 1);
  const perCol = Math.max(1, Math.ceil(n / cols));
  const rh = Math.max(MIN, Math.min(ROW, avail / perCol));
  const pages = Math.max(1, Math.ceil(perCol / Math.floor(avail / rh)));
  return { cols, perCol, rh, pages, fs: rh >= 8 ? 11.5 : rh >= 6.6 ? 10.5 : rh >= 5.6 ? 9.5 : 9, showCode: cols === 1 && rh >= 7 };
}
function togglePrintOpts(f, body) {
  const open = body.querySelector('.print-opts');
  if (open) { open.remove(); printOptsFor = null; return; }
  printOptsFor = f.id;
  buildPrintOpts(f, body);
}
function buildPrintOpts(f, body) {
  let box;
  const p = printPrefs(), n = baixaRolls(f).length;
  box = document.createElement('div'); box.className = 'print-opts';
  const title = document.createElement('b'); title.textContent = 'Imprimir baixas';
  const seg = (label, key, opts) => {
    const wrap = document.createElement('div'); wrap.className = 'po-line';
    const l = document.createElement('span'); l.textContent = label;
    const g = document.createElement('div'); g.className = 'seg'; g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
    opts.forEach(([v, t]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.classList.toggle('on', p[key] === v);
      b.onclick = () => { p[key] = v; lsSet(PRINT_KEY, p); g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); info(); }; g.append(b); });
    wrap.append(l, g); return wrap;
  };
  const hint = document.createElement('p'); hint.className = 'po-hint';
  const info = () => { const pl = printPlan(n, p); hint.textContent = `${n} RG(s) · ${pl.cols === 2 ? '2 colunas' : '1 coluna'} · ${pl.pages === 1 ? 'cabe em 1 página' : pl.pages + ' páginas'}${pl.fs < 11.5 ? ' (letra menor)' : ''}.`; };
  const go = document.createElement('button'); go.type = 'button'; go.className = 'primary'; go.textContent = '🖨 Imprimir';
  go.onclick = () => printBaixas(f, p);
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'link-btn'; cancel.textContent = 'Fechar';
  cancel.onclick = () => { box.remove(); printOptsFor = null; };
  const acts = document.createElement('div'); acts.className = 'po-acts'; acts.append(cancel, go);
  box.append(title, seg('Orientação', 'orient', [['portrait', 'Retrato'], ['landscape', 'Paisagem']]), seg('Colunas', 'cols', [['auto', 'Automático'], ['1', '1'], ['2', '2']]), hint, acts);
  info();
  body.querySelector('.bx-actions').after(box);
}
function printBaixas(f, prefs = printPrefs()) {
  const list = baixaRolls(f); if (!list.length) return;
  const plan = printPlan(list.length, prefs);
  const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const now = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const row = ({ it, r }) => `<tr><td class="ck">${r.baixado ? '☑' : '☐'}</td><td class="rg">${esc(r.rg)}</td><td class="ds">${esc(it.descricao || 'Produto')}${plan.showCode ? `<small>${esc(it.produto)}</small>` : ''}</td><td class="n">${esc(fmtNum(Number(r.pesoBaixa), 2))}</td><td class="n">${esc(hasVal(r.mc) ? r.mc : '—')}</td></tr>`;
  const table = rows => `<table><thead><tr><th class="ck">Baixa</th><th>RG</th><th>Produto (descrição)</th><th class="n">Peso (kg)</th><th class="n">MC</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table>`;
  // colunas em ordem de leitura: a 1ª coluna termina e a 2ª continua de onde parou
  const parts = []; for (let k = 0; k < plan.cols; k++) parts.push(list.slice(k * plan.perCol, (k + 1) * plan.perCol));
  let box = $('printBaixas');
  if (!box) { box = document.createElement('div'); box.id = 'printBaixas'; box.className = 'print-baixas'; document.body.append(box); }
  box.className = `print-baixas cols-${plan.cols}${plan.rh < 7 ? ' tight' : ''}`;
  box.style.setProperty('--rh', plan.rh.toFixed(2) + 'mm');
  box.style.setProperty('--fs', plan.fs + 'px');
  box.innerHTML = `<header><img src="logo-grupo4k.png" alt="Grupo Quatro K"><div><h1>Baixas de estoque</h1><p>Pasta <b>${esc(f.name)}</b> · ${esc(now)}${currentUser ? ' · ' + esc(currentUser) : ''}</p></div></header>
    <div class="pb-cols">${parts.filter(x => x.length).map(table).join('')}</div>
    <footer><span>${list.length} RG(s) · ${list.filter(x => x.r.baixado).length} baixa(s) efetuada(s)</span><span>Conferido por: ______________________</span></footer>`;
  // orientação da folha (Chrome/Edge/Android usam; no iPhone escolha na tela de impressão)
  let pg = $('printPageStyle');
  if (!pg) { pg = document.createElement('style'); pg.id = 'printPageStyle'; document.head.append(pg); }
  pg.textContent = `@media print{@page{size:A4 ${prefs.orient === 'landscape' ? 'landscape' : 'portrait'};margin:12mm}}`;
  document.body.classList.add('printing-baixas');
  const done = () => { document.body.classList.remove('printing-baixas'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  const img = box.querySelector('img');
  const go = () => setTimeout(() => window.print(), 50);
  if (img.complete) go(); else { img.onload = go; img.onerror = go; }
}
// marca/desmarca "baixa efetuada" (muda na hora e grava; se falhar, volta)
async function setBaixado(folderId, key, r, baixado) {
  const apply = d => { const f = folderById(d, folderId), it = f && f.items.find(x => x.key === key), rr = it && it.rolos.find(x => x.rg === r.rg && x.endereco === r.endereco);
    if (rr) { rr.baixado = baixado; rr.baixadoBy = baixado ? (currentUser || '') : ''; rr.baixadoAt = baixado ? Date.now() : null; } return f; };
  if (isShared()) {
    const c = lsGet(FCACHE_KEY, { folders: [] }); apply(c); lsSet(FCACHE_KEY, c); renderFolder();
    folderBusy = true;
    try { await remote('setBaixado', { folderId, itemKey: key, rg: r.rg, endereco: r.endereco, baixado }); }
    catch (e) {
      message(/desconhecida/i.test(e.message) ? 'A planilha da equipe está com o script antigo e não guardou a "baixa efetuada". Atualize o PLANILHA_PASTAS_Code.gs no Apps Script.' : `${e.message} A marcação não foi gravada.`, 'error');
      await syncFolders(true);
    }
    finally { folderBusy = false; rerenderFolders(); }
  } else {
    const d = readFolders(), f = apply(d); if (f) f.updatedAt = Date.now(); writeFolders(d); renderFolder();
  }
}
function opRow(f, it) {
  const picked = opPicked(it), open = folderOpenOps.has(it.key), bad = /^DEFEITO/.test(it.status || '');
  const wrap = document.createElement('div'); wrap.className = 'fo' + (picked.length ? ' done' : '') + (open ? ' open' : '') + (bad ? ' bad' : '');
  const row = document.createElement('button'); row.type = 'button'; row.className = 'fo-row'; row.setAttribute('aria-expanded', String(open));
  row.title = open ? 'Fechar a seleção de RG' : 'Escolher o RG que pegou';
  const box = document.createElement('span'); box.className = 'fo-box'; box.textContent = picked.length ? '✓' : '';
  const main = document.createElement('span'); main.className = 'fo-main';
  const op = document.createElement('b'); op.textContent = `OP ${it.op || '—'} · ${it.partida || '—'}`;
  const ad = document.createElement('small'); ad.textContent = (bad ? '✕ ' + it.status.replace(/^DEFEITO:\s*/, '') + ' · ' : '') + (it.enderecos ? it.enderecos.split(' - ').join(' · ') : 'sem endereço');
  main.append(op, ad);
  const side = document.createElement('span'); side.className = 'fo-side';
  const baixaKg = picked.reduce((t, r) => t + (Number(r.pesoBaixa) || 0), 0);
  side.textContent = picked.length ? picked.map(r => r.rg).join(', ') + (baixaKg ? ` · ${fmtNum(baixaKg, 2)} kg` : '') : `${it.rolos.length} rolo${it.rolos.length === 1 ? '' : 's'}`;
  const chev = document.createElement('span'); chev.className = 'fo-chev'; chev.textContent = '›';
  row.append(box, main, side, chev);
  row.onclick = () => { open ? folderOpenOps.delete(it.key) : folderOpenOps.add(it.key); renderFolder(); };
  wrap.append(row);
  if (open) {
    const panel = document.createElement('div'); panel.className = 'fo-panel';
    const hint = document.createElement('p'); hint.className = 'fo-hint'; hint.textContent = 'Toque no RG que você pegou e informe o Peso Total e o MC da baixa:';
    const grid = document.createElement('div'); grid.className = 'rg-grid';
    const shown = picked.length ? sortRolos(picked) : sortRolos(it.rolos);   // depois de identificar o RG, fica só ele
    if (picked.length) hint.textContent = picked.some(r => hasVal(r.pesoBaixa)) ? 'RG coletado (toque para corrigir a baixa):' : 'RG coletado. Toque nele para informar o peso da baixa:';
    shown.forEach(r => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'rg-chip' + (r.picked ? ' on' : '');
      b.setAttribute('aria-pressed', String(!!r.picked));
      const a = document.createElement('b'); a.textContent = (r.picked ? '✓ ' : '') + (r.rg || '—');
      const m = document.createElement('small'); m.textContent = [r.endereco, r.peso !== null && r.peso !== undefined ? fmtNum(r.peso, 2) + ' kg' : ''].filter(Boolean).join(' · ') + (r.picked && r.pickedBy ? ' · ' + r.pickedBy : '');
      b.append(a, m);
      if (r.picked) {
        const bx = document.createElement('span'); bx.className = 'rg-baixa';
        const hasPeso = r.pesoBaixa !== null && r.pesoBaixa !== undefined && r.pesoBaixa !== '';
        const parts = [hasPeso ? `${fmtNum(Number(r.pesoBaixa), 2)} kg` : '', r.mc ? `MC ${r.mc}` : ''].filter(Boolean);
        bx.textContent = parts.length ? `Baixa: ${parts.join(' · ')}` : 'Baixa: não informada';
        bx.classList.toggle('missing', !parts.length);
        b.append(bx);
      }
      b.onclick = () => openBaixa(f.id, it, r);
      grid.append(b);
    });
    const foot = document.createElement('div'); foot.className = 'fo-foot';
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'link-btn danger-link'; rm.textContent = 'Tirar da pasta';
    rm.onclick = async () => { if (!(await askOk({ tone: 'danger', kicker: 'TIRAR DA PASTA', title: `Tirar a OP ${it.op} da pasta "${f.name}"?`, card: { label: 'PRODUTO', title: it.descricao || it.produto, lines: [['Código', it.produto], ['RGs', String(it.rolos.length)]] }, okText: 'Tirar da pasta' }))) return; folderOpenOps.delete(it.key); await removeItemFrom(f.id, it.key); updateSaveBtn(); };
    const close = document.createElement('button'); close.type = 'button'; close.className = 'link-btn'; close.textContent = 'Fechar';
    close.onclick = () => { folderOpenOps.delete(it.key); renderFolder(); };
    foot.append(rm, close);
    panel.append(hint, grid, foot); wrap.append(panel);
  }
  return wrap;
}
// Baixa do RG coletado: ao tocar no RG, informa o Peso Total e o MC que devem ser baixados dele.
let baixaCtx = null;
function openBaixa(folderId, it, r) {
  baixaCtx = { folderId, key: it.key, r, it };
  $('baixaTitle').textContent = `RG ${r.rg || '—'}`;
  $('baixaSub').textContent = `OP ${it.op || '—'} · Partida ${it.partida || '—'} · ${r.endereco || 'sem endereço'}`;
  $('baixaProdDesc').textContent = it.descricao || 'Produto';
  $('baixaProdInfo').textContent = [it.produto, r.peso !== null && r.peso !== undefined ? `rolo com ${fmtNum(r.peso, 2)} kg no estoque` : ''].filter(Boolean).join(' · ');
  const others = it.rolos.filter(x => x !== r && !(x.rg === r.rg && x.endereco === r.endereco));
  // RG ainda não confirmado e a OP tem outros RGs: primeiro confirma (os outros saem da pasta)
  if (!r.picked && others.length) return baixaStep(1, others.length);
  baixaStep(2);
}
function baixaStep(n, othersCount = 0) {
  const { r } = baixaCtx;
  baixaError('');
  $('baixaStep1').classList.toggle('hidden', n !== 1);
  $('baixaStep2').classList.toggle('hidden', n !== 2);
  if (n === 1) {
    $('baixaKicker').textContent = 'CONFIRMAR RG COLETADO';
    $('baixaConfirmText').textContent = `Você coletou o RG ${r.rg}? Ao confirmar, os outros ${othersCount} RG(s) desta OP serão apagados da pasta e fica só este.`;
  } else {
    $('baixaKicker').textContent = 'PESO PARA BAIXA';
    const has = r.picked && hasVal(r.pesoBaixa);
    $('baixaPeso').value = has ? fmtNum(Number(r.pesoBaixa), 2) : '';   // vem vazio: digita só o que vai baixar
    $('baixaMc').value = r.picked ? (r.mc || '') : '';
    $('baixaHint').textContent = 'Confira o produto e digite só os números do peso: 80 = 0,80 kg · 180 = 1,80 kg · 1875 = 18,75 kg. Com o peso, o RG vai para a aba Baixas.' + (r.picked && r.pickedBy ? ` Pego por ${r.pickedBy}.` : '');
    $('baixaUnpick').classList.toggle('hidden', !r.picked);
    $('baixaSave').textContent = has ? '✓ Atualizar baixa' : '✓ Salvar baixa';
  }
  $('baixaModal').classList.remove('hidden');
  setTimeout(() => (n === 1 ? $('baixaConfirm') : $('baixaPeso')).focus(), 60);
}
// etapa 1 confirmada: o RG fica pego e os outros RGs da OP saem da pasta (na planilha e no aparelho)
async function confirmPickedRg() {
  if (!baixaCtx) return;
  const { folderId, key, r, it } = baixaCtx;
  const btn = $('baixaConfirm'); btn.disabled = true;
  const keepOnly = d => { const f = folderById(d, folderId), x = f && f.items.find(y => y.key === key); if (!x) return null;
    const rr = x.rolos.find(y => y.rg === r.rg && y.endereco === r.endereco); if (!rr) return null;
    rr.picked = true; rr.pickedAt = rr.pickedAt || Date.now(); rr.pickedBy = rr.pickedBy || currentUser || ''; x.rolos = [rr]; f.updatedAt = Date.now(); return rr; };
  try {
    if (isShared()) {
      const c = lsGet(FCACHE_KEY, { folders: [] }); const rr = keepOnly(c); lsSet(FCACHE_KEY, c);
      folderBusy = true;
      try { await remote('saveItem', { folderId, item: { ...it, rolos: [{ ...r, picked: true }] } }); }
      catch (e) { message(`${e.message} O RG não foi confirmado.`, 'error'); await syncFolders(true); closeBaixa(); return; }
      finally { folderBusy = false; }
      if (rr) baixaCtx.r = rr;
    } else {
      const d = readFolders(); const rr = keepOnly(d); writeFolders(d); if (rr) baixaCtx.r = rr;
    }
    rerenderFolders(); updateSaveBtn();
    const f = folderById(readFolders(), folderId), x = f && f.items.find(y => y.key === key);
    const rr = x && x.rolos.find(y => y.rg === r.rg && y.endereco === r.endereco);
    if (rr) baixaCtx.r = rr;
    baixaStep(2);
  } finally { btn.disabled = false; }
}
// Peso para baixa: digita só números e eles entram como centésimos — 80 vira 0,80; 180 vira 1,80; 1875 vira 18,75
function maskPeso(v) {
  const dg = String(v || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 6);
  if (!dg) return '';
  return (Number(dg) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function onPesoInput(e) {
  if (e.isComposing) return;   // teclado ainda montando o texto: formata no fim
  const el = e.target, out = maskPeso(el.value);
  if (el.value === out) return;
  el.value = out;
  try { el.setSelectionRange(out.length, out.length); } catch { /* alguns teclados não deixam mover o cursor */ }
}
function closeBaixa() { $('baixaModal').classList.add('hidden'); baixaCtx = null; }
function baixaError(t) { $('baixaError').textContent = t || ''; $('baixaError').classList.toggle('hidden', !t); }
async function saveBaixa(e) {
  if (e) e.preventDefault();
  if (!baixaCtx) return;
  // o peso é sempre lido pelos números digitados, em centésimos (8 = 0,08 · 80 = 0,80 · 180 = 1,80), qualquer que seja o teclado
  $('baixaPeso').value = maskPeso($('baixaPeso').value);
  const pesoRaw = $('baixaPeso').value.trim(), peso = pesoRaw ? parseNumber(pesoRaw) : null, mcRaw = $('baixaMc').value.trim();
  if (pesoRaw && (peso === null || peso <= 0)) { baixaError('O Peso Total precisa ser um número maior que zero (ex.: 18,75).'); return $('baixaPeso').focus(); }
  if (peso !== null && peso > 9999) { baixaError('Peso Total muito alto. Confira o valor.'); return $('baixaPeso').focus(); }
  const mcNum = mcRaw ? parseNumber(mcRaw) : null;
  if (mcRaw && mcNum === null) { baixaError('O MC precisa ser um número (ex.: 1,25).'); return $('baixaMc').focus(); }
  const { folderId, key, r } = baixaCtx; closeBaixa();
  if (peso !== null) folderOpenOps.delete(key);   // com peso: sai da aba Pegas e aparece em Baixas
  await togglePicked(folderId, key, r, true, { pesoBaixa: peso === null ? null : Math.round(peso * 1000) / 1000, mc: mcRaw ? fmtNum(mcNum, 0, 3) : '' });
  if (peso !== null) message(`RG ${r.rg}: baixa de ${fmtNum(peso, 2)} kg salva. Está na aba Baixas.`, 'success');
}
async function unpickBaixa() {
  if (!baixaCtx) return;
  const { folderId, key, r } = baixaCtx; closeBaixa();
  await togglePicked(folderId, key, r, false);
}
// marca/desmarca o RG: muda na hora na tela e grava (planilha ou aparelho); se falhar, volta
async function togglePicked(folderId, key, r, picked, baixa = {}) {
  const pesoBaixa = picked && baixa.pesoBaixa !== undefined ? baixa.pesoBaixa : null, mc = picked ? String(baixa.mc || '') : '';
  const apply = d => { const f = folderById(d, folderId), it = f && f.items.find(x => x.key === key), rr = it && it.rolos.find(x => x.rg === r.rg && x.endereco === r.endereco);
    if (rr) { const was = !!rr.picked; rr.picked = picked; rr.pickedAt = picked ? (was ? rr.pickedAt : Date.now()) : null; rr.pickedBy = picked ? (was && rr.pickedBy ? rr.pickedBy : (currentUser || '')) : ''; rr.pesoBaixa = pesoBaixa; rr.mc = mc; if (!picked) { rr.baixado = false; rr.baixadoBy = ''; rr.baixadoAt = null; } }
    return f; };
  if (isShared()) {
    const c = lsGet(FCACHE_KEY, { folders: [] }); apply(c); lsSet(FCACHE_KEY, c); renderFolder();
    folderBusy = true;
    try {
      const j = await remote('setPicked', { folderId, itemKey: key, rg: r.rg, endereco: r.endereco, picked, pesoBaixa, mc });
      // script antigo na planilha: marca o "pego", mas não guarda Peso Total / MC
      const back = picked && (j.folders || []).flatMap(f => f.items).flatMap(i => i.rolos).find(x => x.rg === r.rg && x.endereco === r.endereco);
      if (back && !('pesoBaixa' in back)) message('O RG foi marcado como pego, mas a planilha da equipe está com o script antigo e não guardou o Peso Total / MC. Atualize o PLANILHA_PASTAS_Code.gs no Apps Script (veja o README).', 'error');
    }
    catch (e) { message(`${e.message} A marcação não foi gravada.`, 'error'); await syncFolders(true); }
    finally { folderBusy = false; rerenderFolders(); }
  } else {
    const d = readFolders(), f = apply(d); if (f) f.updatedAt = Date.now(); writeFolders(d); renderFolder();
  }
}
// planilha: pasta;produto;descricao;op;partida;enderecos;rg;endereco;armazem;peso;gramatura;cmc;pego;status
function exportFolder() {
  const f = folderById(readFolders(), folderOpenId); if (!f) return;
  const q = v => { const t = String(v ?? '').replace(/[\r\n]+/g, ' '); return /[;"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const num = v => (v === null || v === undefined || v === '') ? '' : String(v).replace('.', ',');
  const lines = ['pasta;produto;descricao;op;partida;enderecos;rg;endereco;armazem;peso;gramatura;cmc;pego;pego_por;status;peso_baixa;mc;baixado'];
  f.items.forEach(it => it.rolos.forEach(r => lines.push([f.name, it.produto, it.descricao, it.op, it.partida, it.enderecos, r.rg, r.endereco, r.armazem, num(r.peso), num(r.gramatura), num(r.cmc), r.picked ? 'sim' : 'nao', r.pickedBy || '', it.status, r.picked ? num(r.pesoBaixa) : '', r.picked ? (r.mc || '') : '', r.picked && r.baixado ? 'sim' : ''].map(q).join(';'))));
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
    it.rolos.push({ rg: g('rg'), endereco: g('endereco'), armazem: g('armazem'), peso: pn(g('peso')), gramatura: pn(g('gramatura')), cmc: pn(g('cmc')), picked: /^(sim|s|1|true)$/i.test(g('pego')), pickedBy: g('pego_por'), pesoBaixa: pn(g('peso_baixa')), mc: g('mc'), baixado: /^(sim|s|1|true)$/i.test(g('baixado')) });
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
  // na tela de pesquisa: o cartão fecha na estrela, que pulsa enquanto o Protheus responde
  const card = $('codeForm'), useFx = from === 'search' && fxOn(card);
  const useBusy = from === 'results' && !REDUCED_MOTION;
  if (useBusy) resultsBusy(true);
  const closing = useFx ? novaClose(card, { loading: true }) : useBusy ? wait(700) : Promise.resolve();
  let found = false;
  try {
    const [d] = await Promise.all([
      api(`/api/stock?code=${encodeURIComponent(code)}`, {}, SEARCH_TIMEOUT_MS),
      loadPriority().catch(() => {}), // recarrega a planilha: pega edições feitas no Excel
      loadDefects().catch(() => {})
    ]);
    const rows = Array.isArray(d.rows) ? d.rows : [];
    await closing;
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
    found = true;
    showView('results'); $('term').value = code;
    stock({ code, description: desc }, rows);
    if (useFx) { novaReset(card); popIn($('stockSection')); }
    if (useBusy) { resultsBusy(false); popIn($('stockSection')); }
    addHistory(code, desc, rows.length, rows.filter(priorityMatch).length);
    if (d.mode === 'prefixo') message(`Nenhum código exatamente igual a ${code}; exibindo códigos que começam com ele.`, 'info');
    if (d.notice) message(d.notice, 'error');
    if (d.truncated) message('Atenção: a consulta atingiu o limite de páginas/tempo e pode estar incompleta. Tente novamente.', 'error');
  } catch (e) {
    await closing;
    if (e.status === 401 || e.status === 403) { novaReset(card); requireLogin(); return; }
    message(e.message || 'Falha ao consultar o estoque no Protheus.', 'error');
  } finally {
    if (useBusy) resultsBusy(false);
    if (useFx && !found && document.body.dataset.view === 'search') await novaOpen(card); // sem resultado: o cartão abre de novo
    else if (useFx && !found) novaReset(card);
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
    Z5_ENDEREC: ['Endereço', 'Digite o endereço...'], RG: ['RG', 'Digite o número do RG...'], Z5_OP: ['OP', 'Digite o número da OP...'],
    Z5_PARTIDA: ['Partida', 'Digite o número da partida...'], Z5_ALMOXA: ['Armazém', 'Digite o número do armazém...'], Z6_GRUPO: ['Grupo de produto', 'Digite o código do grupo…'], Z5_TONALID: ['Tonalidade', 'Digite a tonalidade…']
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
  const val = (k, v) => {
    if (v === undefined || v === null || String(v).trim() === '') return '—';
    if (/DT|DATA|DTEND/i.test(k) && dateParts(v)) return formatDate(v);
    if (k === 'Z5_PESOATU') return `${fmtNum(v, 2)} kg`;
    if (k === 'Z5_CMC') return fmtNum(v, 2);
    if (k === 'Z5_GRAMATU') return `${fmtNum(v, 0, 2)} g/m²`;
    return fmt(v);
  };
  // Produto · RG · OP · Partida · Endereço / Peso atual · Armazém · Gramatura · CMC / Data de entrada · Data de endereçamento
  [[['Produto', 'Z5_PROD'], ['RG', null], ['OP', 'Z5_OP'], ['Partida', 'Z5_PARTIDA'], ['Endereço', 'Z5_ENDEREC']],
   [['Peso atual', 'Z5_PESOATU'], ['Armazém', 'Z5_ALMOXA'], ['Gramatura', 'Z5_GRAMATU'], ['CMC', 'Z5_CMC']],
   [['Data de entrada', 'Z5_DTENT'], ['Data de endereçamento', 'Z5_4KDTEND']]].forEach(line => {
    const row = document.createElement('div'); row.className = 'detail-line';
    line.forEach(([label, k]) => {
      const item = document.createElement('div');
      const a = document.createElement('span'); a.textContent = label; if (k) a.title = k;
      const b = document.createElement('b'); b.textContent = k ? val(k, field(r, k)) : (rgOf(r) || '—');
      item.append(a, b); row.append(item);
    });
    grid.append(row);
  });
  const rule = priorityRuleFor(r);
  if (rule) {
    const ideal = Number(rule.gramatura), tol = Number(rule.tolerance ?? DEFAULT_TOLERANCE), ok = gramaturaOk(r);
    const lo = ideal * (1 - tol / 100), hi = ideal * (1 + tol / 100);
    const it = document.createElement('div'); it.className = 'detail-rule' + (ok ? ' ok' : ' bad'); it.title = 'Origem: ' + ruleSourceLabel(rule);
    const a = document.createElement('span'); a.textContent = 'Padrão de gramatura';
    const b = document.createElement('b'); b.textContent = `${fmtNum(ideal, 0, 2)} g/m² ±${fmtNum(tol, 0, 2)}% (${fmtNum(lo, 0, 1)} a ${fmtNum(hi, 0, 1)}) - ${ok ? 'Aprovado.' : 'Fora do padrão.'}`;
    it.append(a, b); grid.append(it);
  }
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
const GROUP_LABELS = ['Prioridade', 'OP', 'Partida', 'Descrição', 'Rolos', 'Data de entrada', 'Peso total', 'Gramatura', 'CMC', 'Endereços', ''];
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
    status.append(locationTag(r) || pinSlot());
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
  const nAddr = new Set(g.rows.map(addrOf).filter(Boolean)).size;
  $('groupStats').textContent = `${n} rolo${n === 1 ? '' : 's'} · ${fmtNum(weight, 2)} kg · ${nAddr} endereço${nAddr === 1 ? '' : 's'}`;
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
    const best = g.rows.find(r => locationScore(r)); status.append((best && locationTag(best)) || pinSlot());
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
async function closePriorityEditor(force = false) {
  if (!force && isDirty() && !(await askOk({ tone: 'warn', kicker: 'PRIORIDADES', title: 'Descartar as alterações?', text: 'Há alterações que ainda não foram salvas na planilha.', okText: 'Descartar' }))) return false;
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
  if (isDirty() && !(await askOk({ tone: 'warn', kicker: 'PRIORIDADES', title: 'Recarregar da planilha?', text: 'As alterações ainda não salvas serão descartadas.', okText: 'Recarregar' }))) return;
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
$('clearHistory').onclick = async () => { if (!getHistory().length || !(await askOk({ tone: 'danger', kicker: 'HISTÓRICO', title: 'Apagar todo o histórico de pesquisas?', text: 'Só deste aparelho.', okText: 'Apagar' }))) return; saveHistory([]); renderHistory(); renderRecent(); };
$('historyModal').addEventListener('mousedown', e => { if (e.target === $('historyModal')) closeHistory(); });
$('addressFilter').onchange = applyFilters;
$('punhoBtn').onclick = togglePunhoMode;
$('faceBtn').onclick = bioLogin;
$('password').addEventListener('click', bioFromPassword); $('faceEnable').onclick = bioEnable; $('faceRemove').onclick = bioRemove;
$('faceLater').onclick = () => { lsSet(BIO_SKIP, true); lastCreds = null; pendingBioId = null; updateBioUi(); };
$('foldersBtn').onclick = openFolders; $('foldersBtn2').onclick = () => { const f = activeFolder(); f ? openFolder(f.id) : openFolders(); };
$('activeFolderOpen').onclick = () => { const f = activeFolder(); if (f) openFolder(f.id); };
$('activeFolderEnd').onclick = () => { const d = readFolders(); d.active = null; writeFolders(d); updateFolderUi(); message('Pasta encerrada. As OPs salvas continuam em 📁 Pastas.', 'info'); };
$('saveGroupBtn').onclick = onSaveGroup;
$('newFolderForm').onsubmit = e => { e.preventDefault(); createFolder($('newFolderName').value); };
$('closeFolders').onclick = $('closeFolders2').onclick = $('foldersClose2').onclick = closeFolders;
$('folderBack').onclick = openFolders;
$('folderSearch').onclick = () => { closeFolders(); goSearch(); };
$('folderClear').onclick = openClearBox;
$('baixaForm').onsubmit = saveBaixa;
['input', 'keyup', 'change', 'blur', 'compositionend'].forEach(ev => $('baixaPeso').addEventListener(ev, onPesoInput));
$('closeBaixa').onclick = $('baixaCancel').onclick = $('baixaCancel1').onclick = closeBaixa;
$('baixaConfirm').onclick = confirmPickedRg;
$('baixaUnpick').onclick = unpickBaixa;
$('baixaModal').addEventListener('mousedown', e => { if (e.target === $('baixaModal')) closeBaixa(); });
// barra de navegação do celular
$('navSearch').onclick = () => {
  if (document.body.dataset.view === 'results') { goSearch(); }
  const i = $('codeInput'); if (i) setTimeout(() => i.focus(), 50);
};
$('navFolders').onclick = () => openFolders();
$('navHistory').onclick = () => openHistory();
$('navTheme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('folderClearCancel').onclick = closeClearBox;
$('folderClearDone').onclick = () => clearFolderAction(true);
$('folderClearAll').onclick = () => clearFolderAction(false);
$('folderExport').onclick = exportFolder;
$('folderUse').onclick = () => { const d = readFolders(); d.active = folderOpenId; writeFolders(d); updateFolderUi(); renderFolder(); message('Pasta ativa: as próximas OPs salvas vão para ela.', 'success'); };
$('folderDelete').onclick = deleteFolderAction;
document.querySelectorAll('#folderView .folder-tools .seg button').forEach(b => { b.onclick = () => { folderShow = b.dataset.show; printOptsFor = null; renderFolder(); }; });
$('foldersImport').onclick = () => $('foldersFile').click();
$('foldersFile').onchange = async () => { const f = $('foldersFile').files[0]; $('foldersFile').value = ''; if (!f) return; try { const r = await importFolders(await f.text()); renderFoldersList(); updateFolderUi(); message(`Planilha importada: ${r.nRolls} rolo(s)${r.nFolders ? `, ${r.nFolders} pasta(s) nova(s)` : ''}.`, 'success'); } catch (e) { message(e.message, 'error'); } };
$('foldersModal').addEventListener('mousedown', e => { if (e.target === $('foldersModal')) closeFolders(); });
$('phoneBtn').classList.toggle('hidden', !IS_THIS_PC);
$('phoneBtn').onclick = openPhone;
// prévia: janela estreita (tamanho de celular) com o mesmo NOVA, para ver o layout do celular no computador
$('phonePreview').onclick = () => {
  const w = window.open(location.origin + location.pathname, 'novaCelular', 'popup=yes,width=414,height=880,left=80,top=40');
  if (!w) message('O navegador bloqueou a janela. Permita pop-ups para o NOVA e tente de novo.', 'error');
}; $('closePhone').onclick = () => $('phoneModal').classList.add('hidden');
$('phoneModal').addEventListener('mousedown', e => { if (e.target === $('phoneModal')) $('phoneModal').classList.add('hidden'); });
$('filterToggle').onclick = () => { const open = !$('stockSection').classList.contains('filters-open'); $('stockSection').classList.toggle('filters-open', open); $('filterToggle').setAttribute('aria-expanded', String(open)); $('filterToggle').textContent = open ? '⚲ Menos filtros' : '⚲ Mais filtros'; };
$('defectBtn').onclick = () => { const g = currentGroups[groupIndex]; if (g) openDefect(g); };
$('defectSave').onclick = saveDefect; $('defectRemove').onclick = removeDefect;
$('defectMigrate').onclick = migrateDefects;
$('defectCancel').onclick = closeDefect; $('closeDefect').onclick = closeDefect;
$('defectOpenFile').onclick = async () => { try { const d = await api('/api/defects/open', { method: 'POST', body: '{}' }); message(NOVA_STATIC ? 'Planilha de defeitos baixada (MALHAS_RUINS.csv).' : `Planilha aberta: ${d.filePath}. Feche no Excel antes de salvar um novo defeito.`, 'info'); } catch (e) { defectError(e.message); } };
if (NOVA_STATIC) {
  $('defectOpenFile').textContent = 'Baixar planilha';
  $('defectImport').classList.remove('hidden');
  $('defectImport').onclick = () => $('defectFile').click();
  $('defectFile').onchange = async () => {
    const f = $('defectFile').files[0]; $('defectFile').value = ''; if (!f) return;
    try { const r = await window.NovaLocal.importDefects(await f.text()); if (sharedDefects()) { closeDefect(); await migrateDefects(); return; } setDefects(r.rows); closeDefect(); refreshAfterDefect(); message(`${r.imported} defeito(s) importado(s) da planilha.`, 'success'); }
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
  if ($('askModal') && !$('askModal').classList.contains('hidden')) closeAsk(false);
  else if (!$('baixaModal').classList.contains('hidden')) closeBaixa();
  else if (!$('foldersModal').classList.contains('hidden')) closeFolders();
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
bioCheck();
syncFolders(true).then(ok => { if (ok) updateFolderUi(); });
setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
(async () => {
  try { await loadPriority(); } catch (e) { console.warn(e); }
  try {
    const st = await api('/api/status');
    if (st.needApiUrl && $('apiUrlWrap')) $('apiUrlWrap').classList.remove('hidden');
    if (st.connected) { setConnection(true, st.username); $('username').value = st.username || ''; goSearch(); novaOpen($('codeForm')); }
    else { goLogin(''); novaOpen($('loginForm')); }
  } catch (e) { goLogin(e.message); }
})();
