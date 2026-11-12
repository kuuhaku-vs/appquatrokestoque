'use strict';
// NOVA — leitura da etiqueta do rolo (QR code) e baixa do peso a partir dela.
// Usa funções do renderer.js ($, api, message, field, rgOf, fmtNum, formatDate, readFolders, folderOp, remote, openBaixa...).
//
// O QR (e o código de barras) da etiqueta traz só números, nesta ordem (etiqueta de exemplo FPF9164):
//   01 | 70 80 70 | 9164 | 1 | 000148 | 1 77 77 010900010 | 223071 | 00857589
//   prefixo | série do RG (letras em código ASCII: 70=F, 80=P) | número do RG | dígito | peso líquido em centésimos (1,48 kg)
//   | código do produto (letras em ASCII: 77=M → 1MM010900010) | OP | partida
// Descrição, armazém, endereço, peso atual, gramatura etc. não estão no QR: vêm do Protheus (SZ5) pelo RG.

const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';   // leitor de QR para navegadores sem leitor próprio (iPhone)
const asciiLetter = p => { const n = Number(p); return n >= 65 && n <= 90 ? String.fromCharCode(n) : ''; };

// Código do produto: 12 caracteres; cada letra ocupa 2 dígitos. Devolve as leituras possíveis, a mais provável primeiro.
function decodeProduto(enc) {
  const out = [];
  const walk = (i, acc) => {
    if (out.length > 40 || acc.length > CODE_LEN) return;
    if (i === enc.length) { if (acc.length === CODE_LEN) out.push(acc); return; }
    const l = asciiLetter(enc.slice(i, i + 2));
    if (l && i + 2 <= enc.length) walk(i + 2, acc + l);
    walk(i + 1, acc + enc[i]);
  };
  if (/^\d{12,24}$/.test(enc)) walk(0, '');
  const score = c => /^\d{1,2}[A-Z]{1,2}\d{9}$/.test(c) ? 0 : /^[0-9A-Z]{3}\d{9}$/.test(c) ? 1 : 2;   // ex.: 1MM010900010, 50M140200610
  return [...new Set(out)].sort((a, b) => score(a) - score(b));
}
// Interpreta o texto lido (QR/código de barras da etiqueta) ou um RG digitado (ex.: FPF9164).
function parseEtiqueta(text) {
  const raw = String(text || '').trim();
  const plain = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z]{1,4}\d{3,9}$/.test(plain)) return { kind: 'rg', raw, rg: plain, serie: plain.replace(/\d+$/, ''), numero: plain.replace(/^[A-Z]+/, ''), produtos: [], pesoLiq: null, op: '', partida: '' };
  if (!/^\d{42,60}$/.test(raw)) return null;
  const serie = [raw.slice(2, 4), raw.slice(4, 6), raw.slice(6, 8)].map(asciiLetter).join('');
  if (serie.length !== 3) return null;
  const numero = raw.slice(8, 12), peso = Number(raw.slice(13, 19)) / 100;
  const produtos = decodeProduto(raw.slice(19, -14));
  if (!produtos.length) return null;
  return { kind: 'qr', raw, prefixo: raw.slice(0, 2), digito: raw.slice(12, 13), rg: serie + numero, serie, numero,
    pesoLiq: Number.isFinite(peso) ? peso : null, produtos, produto: produtos[0], op: raw.slice(-14, -8), partida: raw.slice(-8) };
}

/* ------------------------------ câmera / leitura ------------------------------ */
let scanStream = null, scanTimer = null, scanOn = false, scanDecoder = null, scanLastBad = '', jsqrLoading = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!jsqrLoading) jsqrLoading = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = JSQR_URL; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => window.jsQR ? res(window.jsQR) : rej(new Error('leitor não carregou'));
    s.onerror = () => { jsqrLoading = null; s.remove(); rej(new Error('Não foi possível baixar o leitor de QR. Confira a internet.')); };
    document.head.append(s);
  });
  return jsqrLoading;
}
// leitor do próprio navegador (Chrome/Android, Safari novo) ou, se não houver, o jsQR
async function getDecoder() {
  if (scanDecoder) return scanDecoder;
  if ('BarcodeDetector' in window) {
    try {
      const fm = await window.BarcodeDetector.getSupportedFormats();
      if (fm.includes('qr_code')) {
        const det = new window.BarcodeDetector({ formats: ['qr_code', 'code_128'].filter(f => fm.includes(f)) });
        return (scanDecoder = { name: 'navegador', read: async src => (await det.detect(src)).map(b => b.rawValue).filter(Boolean) });
      }
    } catch { /* usa o jsQR */ }
  }
  const jsQR = await loadJsQR();
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
  return (scanDecoder = { name: 'jsQR', read: async src => {
    const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
    if (!sw || !sh) return [];
    const found = [];
    for (const max of (src.videoWidth ? [900] : [1000, 1600, 640])) {   // foto: tenta mais de um tamanho
      const k = Math.min(1, max / Math.max(sw, sh)); cv.width = Math.round(sw * k); cv.height = Math.round(sh * k);
      cx.drawImage(src, 0, 0, cv.width, cv.height);
      const d = cx.getImageData(0, 0, cv.width, cv.height), r = jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
      if (r && r.data) { found.push(r.data); break; }
    }
    return found;
  } });
}
function scanStatus(t, kind = '') { const el = $('scanStatus'); el.textContent = t; el.className = 'scan-status ' + kind; }
function stopCamera() {
  scanOn = false; clearTimeout(scanTimer);
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  const v = $('scanVideo'); try { v.pause(); } catch { /* já parado */ } v.srcObject = null;
}
function closeScan() { stopCamera(); $('scanModal').classList.add('hidden'); }
// texto lido: se for etiqueta de rolo, mostra as informações; senão avisa e continua lendo
function onScanText(texts) {
  for (const t of texts) {
    const p = parseEtiqueta(t);
    if (p) { try { navigator.vibrate && navigator.vibrate(70); } catch { /* sem vibração */ } closeScan(); showEtiqueta(p); return true; }
  }
  const t = String(texts[0] || '');
  if (t && t !== scanLastBad) { scanLastBad = t; scanStatus(`Li um código, mas não é etiqueta de rolo: “${t.slice(0, 40)}${t.length > 40 ? '…' : ''}”. Aponte para o QR da etiqueta.`, 'err'); }
  return false;
}
async function scanLoop() {
  if (!scanOn) return;
  const v = $('scanVideo');
  try { if (v.readyState >= 2 && v.videoWidth) { const r = await scanDecoder.read(v); if (!scanOn) return; if (r.length && onScanText(r)) return; } }
  catch { /* quadro ruim: tenta o próximo */ }
  scanTimer = setTimeout(scanLoop, 160);
}
async function openScan() {
  if (!connected) return goLogin('Entre no Protheus antes de ler a etiqueta.');
  clearMessage(); scanLastBad = '';
  $('scanRg').value = ''; $('scanModal').classList.remove('hidden');
  $('scanBox').classList.remove('off');
  scanStatus('Abrindo a câmera…');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('scanBox').classList.add('off');
    return scanStatus(window.isSecureContext ? 'Este navegador não dá acesso à câmera. Use “Tirar foto da etiqueta” ou digite o RG.' : 'A câmera ao vivo só funciona em endereço seguro (https). Use “Tirar foto da etiqueta” ou digite o RG.', 'err');
  }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (e) {
    $('scanBox').classList.add('off');
    return scanStatus(e && e.name === 'NotAllowedError' ? 'A câmera foi bloqueada. Libere a câmera para este site nas permissões do navegador, ou use “Tirar foto da etiqueta” / digite o RG.' : 'Não foi possível abrir a câmera deste aparelho. Use “Tirar foto da etiqueta” ou digite o RG.', 'err');
  }
  if ($('scanModal').classList.contains('hidden')) return stopCamera();   // fechou enquanto a câmera abria
  const v = $('scanVideo'); v.srcObject = scanStream;
  try { await v.play(); } catch { /* o navegador toca sozinho com autoplay */ }
  try { await getDecoder(); } catch (e) { return scanStatus(`${e.message} Enquanto isso, digite o RG abaixo.`, 'err'); }
  scanStatus('Aponte a câmera para o QR code da etiqueta.');
  scanOn = true; scanLoop();
}
async function scanPhoto(file) {
  if (!file) return;
  scanStatus('Lendo a foto…');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const dec = await getDecoder(); const r = await dec.read(img);
    if (!r.length) return scanStatus('Não encontrei o QR code na foto. Tire outra, mais perto e sem reflexo, ou digite o RG.', 'err');
    onScanText(r);
  } catch (e) { scanStatus(`Não foi possível ler a foto. ${e.message || ''}`, 'err'); }
  finally { URL.revokeObjectURL(url); }
}
function scanManual(e) {
  e.preventDefault();
  const p = parseEtiqueta($('scanRg').value);
  if (!p) return scanStatus('Digite o RG como está na etiqueta (ex.: FPF9164) ou os números do código de barras.', 'err');
  closeScan(); showEtiqueta(p);
}

/* ------------------------------ informações do RG lido ------------------------------ */
let etqCtx = null, etqSeq = 0;
const etqLine = (k, v, cls = '') => { const d = document.createElement('div'); if (cls) d.className = cls; const a = document.createElement('small'); a.textContent = k; const b = document.createElement('strong'); b.textContent = v; d.append(a, b); return d; };
const kg = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? '—' : fmtNum(Number(v), 2) + ' kg';
const sameRg = (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
function closeEtiqueta() { etqSeq++; $('etqModal').classList.add('hidden'); etqCtx = null; }
function fillEtiquetaLabel(p) {
  const box = $('etqLabel'); box.replaceChildren();
  box.append(etqLine('RG', p.rg));
  if (p.kind !== 'qr') { box.append(etqLine('Origem', 'RG digitado (sem os dados do QR)')); return; }
  box.append(etqLine('Código do produto', p.produto), etqLine('Peso líquido', kg(p.pesoLiq)), etqLine('OP', p.op), etqLine('Partida', p.partida));
  const raw = document.createElement('p'); raw.className = 'etq-raw'; raw.textContent = `Código lido: ${p.raw}`; box.append(raw);
}
async function showEtiqueta(p) {
  const my = ++etqSeq;
  etqCtx = { p, rows: [], row: null, info: null };
  $('etqTitle').textContent = `RG ${p.rg}`;
  $('etqSub').textContent = p.kind === 'qr' ? 'Etiqueta lida pelo QR code' : 'RG digitado';
  $('etqDesc').textContent = 'Consultando o Protheus…'; $('etqCode').textContent = p.produto || '';
  fillEtiquetaLabel(p);
  const st = $('etqStock'); st.replaceChildren();
  const wait = document.createElement('p'); wait.className = 'etq-wait'; wait.innerHTML = '<span class="spinner"></span> Procurando o RG no estoque…'; st.append(wait);
  $('etqWarn').classList.add('hidden'); $('etqBaixa').disabled = true; $('etqStockBtn').disabled = !p.produto;
  $('etqPeso').value = ''; $('etqMc').value = ''; $('etqPeso').disabled = $('etqMc').disabled = true; etqError(''); $('etqUseLabel').classList.add('hidden'); $('etqBaixa').textContent = '✓ Salvar baixa';
  $('etqModal').classList.remove('hidden');
  let d = null, err = '';
  try {
    const q = new URLSearchParams({ rg: p.rg, serie: p.serie, numero: p.numero, prods: (p.produtos || []).slice(0, 3).join(','), op: p.op || '', partida: p.partida || '' });
    d = await api(`/api/rg?${q}`, {}, 60000);
  } catch (e) {
    if (my !== etqSeq) return;
    if (e.status === 401 || e.status === 403) { closeEtiqueta(); return requireLogin(); }
    err = e.status === 404 ? 'Esta versão do NOVA não consulta RG no Protheus.' : (e.message || 'Falha na consulta.');
  }
  if (my !== etqSeq) return;
  const rows = d && Array.isArray(d.rows) ? d.rows : [], row = rows[0] || null;
  const produto = String((row && field(row, 'Z5_PROD')) || (d && d.product && d.product.code) || p.produto || '').trim().toUpperCase();
  const descricao = String((d && d.product && d.product.description) || '').trim();
  const info = {
    rg: row ? rgOf(row) || p.rg : p.rg, produto, descricao,
    op: String((row && field(row, 'Z5_OP')) || p.op || '').trim(), partida: String((row && field(row, 'Z5_PARTIDA')) || p.partida || '').trim(),
    endereco: row ? addrOf(row) : '', armazem: row ? String(field(row, 'Z5_ALMOXA') ?? '').trim() : '',
    peso: row ? numericValue(field(row, 'Z5_PESOATU')) : null, gramatura: row ? gramaturaValue(row) : null, cmc: row ? numericValue(field(row, 'Z5_CMC')) : null,
    pesoLiq: p.pesoLiq, found: !!row
  };
  etqCtx = { p, rows, row, info };
  $('etqDesc').textContent = descricao || (produto ? 'Descrição não informada' : 'Produto não identificado');
  $('etqCode').textContent = [produto, d && d.lookup && d.lookup.group ? `grupo ${d.lookup.group}${d.lookup.groupDesc ? ' — ' + d.lookup.groupDesc : ''}` : ''].filter(Boolean).join(' · ');
  $('etqStockBtn').disabled = !CODE_RE.test(produto);
  st.replaceChildren();
  const warns = [];
  if (row) {
    st.append(etqLine('Armazém', info.armazem || '—'), etqLine('Endereço', info.endereco || '—'), etqLine('Peso atual', kg(info.peso)),
      etqLine('Gramatura', info.gramatura === null ? '—' : fmtNum(info.gramatura, 0, 2)), etqLine('CMC', info.cmc === null ? '—' : fmtNum(info.cmc, 2)),
      etqLine('OP · Partida', `${info.op || '—'} · ${info.partida || '—'}`), etqLine('Data de entrada', formatDate(field(row, 'Z5_DTENT')) || '—'));
    const ton = String(field(row, 'Z5_TONALID') ?? '').trim(); if (ton) st.append(etqLine('Tonalidade', ton));
    const ult = formatDate(field(row, 'Z5_ULTATU')); if (ult && ult !== '—') st.append(etqLine('Última atualização', ult));
    if (rows.length > 1) st.append(etqLine('Outros registros deste RG', rows.slice(1).map(r => `${addrOf(r) || 'sem endereço'} (arm. ${String(field(r, 'Z5_ALMOXA') ?? '').trim() || '—'}, ${kg(numericValue(field(r, 'Z5_PESOATU')))})`).join(' · ')));
    if (!(info.peso > 0)) warns.push('Este RG está com peso atual zerado no Protheus (pode já ter sido baixado).');
    if (p.kind === 'qr' && p.pesoLiq !== null && info.peso > 0 && Math.abs(info.peso - p.pesoLiq) > 0.005) warns.push(`O peso da etiqueta (${kg(p.pesoLiq)}) é diferente do peso atual no Protheus (${kg(info.peso)}).`);
    if (p.kind === 'qr' && p.produto && produto && p.produto !== produto && !(p.produtos || []).includes(produto)) warns.push(`O código do produto lido na etiqueta (${p.produto}) é diferente do que está no Protheus (${produto}).`);
  } else {
    const n = document.createElement('p'); n.className = 'etq-wait';
    n.textContent = err ? `Não foi possível consultar o Protheus agora. ${err}` : 'RG não encontrado na SZ5 do Protheus.';
    st.append(n);
    if (p.kind === 'qr') warns.push('Sem os dados do Protheus, a baixa fica só com o que está na etiqueta (sem armazém e endereço).');
  }
  // a OP já está em alguma pasta com outros RGs? ao dar baixa neste, os outros saem (mesma regra de "RG coletado")
  const fid = scanFolderId(), f = fid && folderById(readFolders(), fid);
  const it = f && f.items.find(x => x.rolos.some(r => sameRg(r.rg, info.rg)) || x.key === itemKey(info.produto, info.op, info.partida));
  if (it) { const others = it.rolos.filter(r => !sameRg(r.rg, info.rg)).length; if (others) warns.push(`A OP ${it.op} está na pasta "${f.name}" com outros ${others} RG(s); ao dar baixa neste, eles saem da pasta.`); }
  const w = $('etqWarn'); w.replaceChildren(); warns.forEach(t => { const li = document.createElement('p'); li.textContent = '⚠ ' + t; w.append(li); }); w.classList.toggle('hidden', !warns.length);
  const can = !!(p.kind === 'qr' ? info.produto : info.found);   // RG digitado e não encontrado: não há o que baixar
  // RG que já tem baixa nesta pasta: mostra os valores para corrigir
  const prev = it && it.rolos.find(r => sameRg(r.rg, info.rg)), has = !!(prev && prev.picked && hasVal(prev.pesoBaixa));
  if (has) { $('etqPeso').value = fmtNum(Number(prev.pesoBaixa), 2); $('etqMc').value = hasVal(prev.mc) && parseNumber(prev.mc) !== null ? fmtNum(prev.mc, 2, 2) : ''; }
  $('etqBaixa').disabled = !can; $('etqPeso').disabled = $('etqMc').disabled = !can;
  $('etqBaixa').textContent = `✓ ${has ? 'Atualizar' : 'Salvar'} baixa${f ? ` em "${f.name}"` : ''}`;
  const u = $('etqUseLabel');
  if (can && !has && p.pesoLiq > 0) { u.textContent = `Usar o peso da etiqueta (${fmtNum(p.pesoLiq, 2)} kg)`; u.classList.remove('hidden'); }
  if (can && window.matchMedia('(hover: hover) and (pointer: fine)').matches) setTimeout(() => $('etqPeso').focus(), 60);   // no celular não abre o teclado sozinho
}
function etqError(t) { $('etqError').textContent = t || ''; $('etqError').classList.toggle('hidden', !t); }

/* ------------------------------ baixa a partir da etiqueta ------------------------------ */
// pasta que recebe a baixa: a que está aberta na tela; senão, a pasta ativa
function scanFolderId() {
  const d = readFolders();
  if (!$('foldersModal').classList.contains('hidden') && !$('folderView').classList.contains('hidden') && folderOpenId && folderById(d, folderOpenId)) return folderOpenId;
  return folderById(d, d.active) ? d.active : null;
}
// Salvar baixa (na própria janela da etiqueta): valida o peso e o MC e grava na pasta
async function baixaEtiqueta(e) {
  if (e) e.preventDefault();
  if (!etqCtx || !etqCtx.info || $('etqBaixa').disabled) return;
  etqError('');
  $('etqPeso').value = maskPeso($('etqPeso').value); $('etqMc').value = maskPeso($('etqMc').value);
  const pesoRaw = $('etqPeso').value.trim(), peso = pesoRaw ? parseNumber(pesoRaw) : null, mcRaw = $('etqMc').value.trim();
  if (peso === null || !(peso > 0)) { etqError('Informe o peso para baixa (ex.: digite 148 para 1,48 kg).'); return $('etqPeso').focus(); }
  if (peso > 9999) { etqError('Peso muito alto. Confira o valor.'); return $('etqPeso').focus(); }
  const mcNum = mcRaw ? parseNumber(mcRaw) : null;
  if (mcRaw && (mcNum === null || mcNum < 0)) { etqError('O MC precisa ser um número (ex.: digite 125 para 1,25, ou 0 para zerar).'); return $('etqMc').focus(); }
  const baixa = { pesoBaixa: Math.round(peso * 1000) / 1000, mc: mcRaw ? fmtNum(mcNum, 2, 2) : '' };
  const info = etqCtx.info, fid = scanFolderId();
  closeEtiqueta();
  if (fid) return baixaEtiquetaIn(fid, info, baixa);
  // sem pasta ativa: escolhe (ou cria) a pasta que vai receber a baixa
  folderPickPending = id => baixaEtiquetaIn(id, info, baixa);
  openFolders();
}
// Coloca o RG lido na pasta como "pego" (só ele fica na OP) e grava o peso e o MC da baixa.
async function baixaEtiquetaIn(folderId, info, baixa) {
  const f0 = folderById(readFolders(), folderId);
  if (!f0) return message('A pasta não existe mais. Abra 📁 Pastas e escolha outra.', 'error');
  const key = itemKey(info.produto, info.op, info.partida);
  const old = f0.items.find(x => x.rolos.some(r => sameRg(r.rg, info.rg))) || f0.items.find(x => x.key === key);
  const prev = old && old.rolos.find(r => sameRg(r.rg, info.rg));
  const roll = prev ? { ...prev, picked: true, pickedAt: prev.pickedAt || Date.now(), pickedBy: prev.pickedBy || currentUser || '', armazem: prev.armazem || info.armazem, endereco: prev.endereco || info.endereco }
    : { rg: info.rg, endereco: info.endereco || '', armazem: info.armazem || '', peso: info.peso ?? info.pesoLiq ?? null, gramatura: info.gramatura, cmc: info.cmc, picked: true, pickedAt: Date.now(), pickedBy: currentUser || '' };
  const item = old ? { ...old, rolos: [roll], enderecos: roll.endereco || old.enderecos }
    : { key, produto: info.produto, descricao: info.descricao, op: info.op, partida: info.partida, enderecos: roll.endereco, savedAt: Date.now(), status: 'LIDO PELO QR', rolos: [roll] };
  const ok = await folderOp(
    async () => { await remote('saveItem', { folderId, item }); setActive(folderId); },
    () => { const d = readFolders(), f = folderById(d, folderId); if (!f) return false;
      const i = f.items.findIndex(x => x.key === item.key); if (i >= 0) f.items[i] = item; else f.items.push(item);
      d.active = f.id; f.updatedAt = Date.now(); return writeFolders(d); });
  if (!ok) return;
  const f = folderById(readFolders(), folderId), it = f && f.items.find(x => x.key === item.key), r = it && it.rolos.find(x => sameRg(x.rg, info.rg));
  if (!r) return message('O RG foi salvo na pasta, mas não consegui abrir a baixa. Abra a pasta e toque na OP em Pegas.', 'error');
  if (baixa) {   // peso e MC já informados na janela da etiqueta
    await togglePicked(folderId, it.key, r, true, baixa);
    return message(`RG ${r.rg}: baixa de ${fmtNum(baixa.pesoBaixa, 2)} kg${baixa.mc ? ` (MC ${baixa.mc})` : ''} salva em "${f.name}". Está na aba Baixas.`, 'success');
  }
  openBaixa(folderId, it, r);
  // atalho: usar o peso líquido impresso na etiqueta
  const b = $('baixaUseLabel');
  if (info.pesoLiq > 0 && !hasVal(r.pesoBaixa)) { b.textContent = `Usar o peso da etiqueta (${fmtNum(info.pesoLiq, 2)} kg)`; b.onclick = () => { $('baixaPeso').value = fmtNum(info.pesoLiq, 2); $('baixaPeso').focus(); }; b.classList.remove('hidden'); }
}

/* ------------------------------ eventos ------------------------------ */
$('scanBtn').onclick = openScan; $('folderScan').onclick = openScan;
$('closeScan').onclick = $('scanCancel').onclick = closeScan;
$('scanForm').onsubmit = scanManual;
$('scanPhotoBtn').onclick = () => $('scanFile').click();
$('scanFile').onchange = e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; scanPhoto(f); };
$('scanModal').addEventListener('mousedown', e => { if (e.target === $('scanModal')) closeScan(); });
$('closeEtq').onclick = $('etqClose2').onclick = closeEtiqueta;
$('etqModal').addEventListener('mousedown', e => { if (e.target === $('etqModal')) closeEtiqueta(); });
$('etqForm').onsubmit = baixaEtiqueta;
['input', 'keyup', 'change', 'blur', 'compositionend'].forEach(ev => { $('etqPeso').addEventListener(ev, onPesoInput); $('etqMc').addEventListener(ev, onPesoInput); });
$('etqUseLabel').onclick = () => { const p = etqCtx && etqCtx.p; if (p && p.pesoLiq > 0) { $('etqPeso').value = fmtNum(p.pesoLiq, 2); etqError(''); $('etqMc').focus(); } };
$('etqAgain').onclick = () => { closeEtiqueta(); openScan(); };
$('etqStockBtn').onclick = () => { const c = etqCtx && etqCtx.info ? etqCtx.info.produto : (etqCtx && etqCtx.p.produto); if (!c) return; closeEtiqueta(); closeFolders(); search(c, document.body.dataset.view === 'results' ? 'results' : 'search'); };
document.addEventListener('visibilitychange', () => { if (document.hidden && scanOn) closeScan(); });   // saiu do app: desliga a câmera
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('scanModal').classList.contains('hidden')) { e.stopImmediatePropagation(); closeScan(); }
  else if (!$('etqModal').classList.contains('hidden') && $('baixaModal').classList.contains('hidden') && !($('askModal') && !$('askModal').classList.contains('hidden'))) { e.stopImmediatePropagation(); closeEtiqueta(); }
}, true);
