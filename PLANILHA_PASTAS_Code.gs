/**
 * NOVA — Pastas compartilhadas (Google Planilhas + Apps Script)
 *
 * Como instalar (uma vez):
 *  1. Crie uma Planilha Google (ex.: "NOVA Pastas").
 *  2. Menu Extensões → Apps Script. Apague o que estiver no editor e cole TODO este arquivo.
 *  3. Troque o valor de CHAVE abaixo por um código só da equipe (ex.: 'quatrok-cd-2026').
 *  4. Salve (ícone de disquete). Clique em Implantar → Nova implantação → engrenagem → App da Web.
 *       Executar como: Eu   |   Quem pode acessar: Qualquer pessoa
 *     Clique em Implantar, autorize com sua conta Google e copie o "URL do app da Web".
 *  5. No NOVA: Pastas → cole o URL e o código da equipe → Conectar.
 *
 * As abas "Pastas", "Rolos" e "Defeitos" são criadas sozinhas. Pode olhar e filtrar à vontade;
 * evite apagar colunas ou mudar a linha 1 (cabeçalho).
 * Se alterar este código depois: Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova versão → Implantar.
 */
const CHAVE = 'TROQUE-ESTA-CHAVE';

const SH_P = 'Pastas', SH_R = 'Rolos', SH_D = 'Defeitos';
const HD = ['produto', 'op', 'partida', 'defeitos', 'outros', 'observacao', 'usuario', 'data'];
const DEFECT_OPTIONS = ['BARRAMENTO', 'QUEBRADURA', 'MANCHAS', 'SUJA', 'OUTROS'];
const HP = ['id', 'nome', 'criada_em', 'criada_por'];
const HR = ['pasta_id', 'pasta', 'item_key', 'produto', 'descricao', 'op', 'partida', 'enderecos', 'status',
            'rg', 'endereco', 'armazem', 'peso', 'gramatura', 'cmc', 'pego', 'pego_por', 'pego_em', 'salvo_por', 'salvo_em',
            'peso_baixa', 'mc'];   // peso_baixa/mc: baixa a fazer no RG coletado (Peso Total e MC)
const C = HR.reduce((o, h, i) => (o[h] = i, o), {});

function doGet(e) { return handle_((e && e.parameter) || {}); }
function doPost(e) {
  let b = {};
  try { b = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { /* corpo inválido */ }
  return handle_(b);
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function handle_(b) {
  try {
    if (CHAVE === 'TROQUE-ESTA-CHAVE') return out_({ ok: false, error: 'Configure a CHAVE no Apps Script antes de usar.' });
    if (String(b.key || '') !== CHAVE) return out_({ ok: false, error: 'Código da equipe inválido.' });
    const a = String(b.action || 'list');
    if (a === 'list') return out_({ ok: true, folders: list_() });
    if (a === 'listDefects') return out_({ ok: true, defects: listDefects_() });
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const user = String(b.user || '').slice(0, 40);
      let extra = {};
      if (a === 'saveDefect' || a === 'removeDefect') {
        if (a === 'saveDefect') extra.defect = saveDefect_(b.defect, user);
        else removeDefect_(b.produto, b.op);
        SpreadsheetApp.flush();
        extra.ok = true; extra.defects = listDefects_();
        return out_(extra);
      }
      if (a === 'createFolder') extra.folder = createFolder_(b.name, user);
      else if (a === 'deleteFolder') deleteFolder_(b.folderId);
      else if (a === 'saveItem') saveItem_(b.folderId, b.item, user);
      else if (a === 'removeItem') removeItem_(b.folderId, b.itemKey);
      else if (a === 'clearItems') clearItems_(b.folderId, !!b.onlyPicked);
      else if (a === 'setPicked') setPicked_(b.folderId, b.itemKey, b.rg, b.endereco, !!b.picked, user, b.pesoBaixa, b.mc);
      else return out_({ ok: false, error: 'Ação desconhecida: ' + a });
      SpreadsheetApp.flush();
      extra.ok = true; extra.folders = list_();
      return out_(extra);
    } finally { lock.releaseLock(); }
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  }
}

/* ---------------- abas ---------------- */
function sheet_(name, head) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (sh.getMaxColumns() < head.length || sh.getRange(1, head.length).getDisplayValue() !== head[head.length - 1]) {
    // aba criada por uma versão anterior: acrescenta as colunas novas no fim (os dados antigos ficam onde estão)
    if (sh.getMaxColumns() < head.length) sh.insertColumnsAfter(sh.getMaxColumns(), head.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  }
  // texto puro: mantém zeros à esquerda de OP, partida, endereço, RG
  sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat('@');
  return sh;
}
function rows_(sh, n) {
  const last = sh.getLastRow();
  return last < 2 ? [] : sh.getRange(2, 1, last - 1, n).getDisplayValues();
}
function rewrite_(sh, n, data) {
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, n).clearContent();
  if (data.length) {
    if (sh.getMaxRows() < data.length + 1) sh.insertRowsAfter(sh.getMaxRows(), data.length + 1 - sh.getMaxRows());
    sh.getRange(2, 1, data.length, n).setNumberFormat('@').setValues(data);
  }
}
const now_ = () => new Date().toISOString();
const s_ = v => (v === null || v === undefined) ? '' : String(v);

/* ---------------- leitura ---------------- */
function list_() {
  const p = rows_(sheet_(SH_P, HP), HP.length), r = rows_(sheet_(SH_R, HR), HR.length);
  const folders = p.filter(x => x[0]).map(x => ({ id: x[0], name: x[1], createdAt: Date.parse(x[2]) || 0, createdBy: x[3], items: [] }));
  const byId = {}; folders.forEach(f => byId[f.id] = f);
  const items = {};
  r.forEach(x => {
    const f = byId[x[C.pasta_id]]; if (!f) return;
    const k = x[C.pasta_id] + '#' + x[C.item_key];
    let it = items[k];
    if (!it) {
      it = items[k] = { key: x[C.item_key], produto: x[C.produto], descricao: x[C.descricao], op: x[C.op], partida: x[C.partida],
        enderecos: x[C.enderecos], status: x[C.status], savedBy: x[C.salvo_por], savedAt: Date.parse(x[C.salvo_em]) || 0, rolos: [] };
      f.items.push(it);
    }
    const num = v => (v === '' ? null : Number(String(v).replace(',', '.')));
    it.rolos.push({ rg: x[C.rg], endereco: x[C.endereco], armazem: x[C.armazem], peso: num(x[C.peso]), gramatura: num(x[C.gramatura]), cmc: num(x[C.cmc]),
      picked: x[C.pego] === 'sim', pickedBy: x[C.pego_por], pickedAt: Date.parse(x[C.pego_em]) || null,
      pesoBaixa: num(x[C.peso_baixa]), mc: x[C.mc] || '' });
  });
  folders.forEach(f => { f.updatedAt = Math.max(f.createdAt, ...f.items.map(i => i.savedAt), ...f.items.flatMap(i => i.rolos.map(r => r.pickedAt || 0))); });
  return folders;
}

/* ---------------- gravação ---------------- */
function createFolder_(name, user) {
  name = s_(name).trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) throw new Error('Dê um nome para a pasta.');
  const sh = sheet_(SH_P, HP), p = rows_(sh, HP.length);
  const ex = p.find(x => x[1].toLowerCase() === name.toLowerCase());
  if (ex) return { id: ex[0], name: ex[1], existed: true };
  const id = Utilities.getUuid().slice(0, 8);
  sh.appendRow([id, name, now_(), user]);
  return { id, name, existed: false };
}
function deleteFolder_(id) {
  const sp = sheet_(SH_P, HP); rewrite_(sp, HP.length, rows_(sp, HP.length).filter(x => x[0] !== id));
  const sr = sheet_(SH_R, HR); rewrite_(sr, HR.length, rows_(sr, HR.length).filter(x => x[C.pasta_id] !== id));
}
function folderName_(id) {
  const f = rows_(sheet_(SH_P, HP), HP.length).find(x => x[0] === id);
  if (!f) throw new Error('Pasta não encontrada (pode ter sido excluída por outro usuário).');
  return f[1];
}
// grava/atualiza a OP: mantém quem já foi pego (do que estava na planilha ou vindo marcado)
function saveItem_(folderId, item, user) {
  if (!item || !item.key || !Array.isArray(item.rolos)) throw new Error('OP inválida.');
  const name = folderName_(folderId);
  const sr = sheet_(SH_R, HR), all = rows_(sr, HR.length);
  const old = {}; all.forEach(x => { if (x[C.pasta_id] === folderId && x[C.item_key] === item.key) old[x[C.rg] + '|' + x[C.endereco]] = x; });
  const keep = all.filter(x => !(x[C.pasta_id] === folderId && x[C.item_key] === item.key));
  const t = now_();
  item.rolos.forEach(r => {
    const o = old[s_(r.rg) + '|' + s_(r.endereco)];
    const picked = (o && o[C.pego] === 'sim') || !!r.picked;
    const row = new Array(HR.length).fill('');
    row[C.pasta_id] = folderId; row[C.pasta] = name; row[C.item_key] = item.key;
    row[C.produto] = s_(item.produto); row[C.descricao] = s_(item.descricao); row[C.op] = s_(item.op); row[C.partida] = s_(item.partida);
    row[C.enderecos] = s_(item.enderecos); row[C.status] = s_(item.status);
    row[C.rg] = s_(r.rg); row[C.endereco] = s_(r.endereco); row[C.armazem] = s_(r.armazem);
    row[C.peso] = s_(r.peso); row[C.gramatura] = s_(r.gramatura); row[C.cmc] = s_(r.cmc);
    row[C.pego] = picked ? 'sim' : 'nao';
    row[C.pego_por] = picked ? (o && o[C.pego] === 'sim' ? o[C.pego_por] : user) : '';
    row[C.pego_em] = picked ? (o && o[C.pego] === 'sim' ? o[C.pego_em] : t) : '';
    row[C.salvo_por] = user; row[C.salvo_em] = t;
    row[C.peso_baixa] = picked ? (o && o[C.peso_baixa] ? o[C.peso_baixa] : s_(r.pesoBaixa)) : '';
    row[C.mc] = picked ? (o && o[C.mc] ? o[C.mc] : s_(r.mc)) : '';
    keep.push(row);
  });
  rewrite_(sr, HR.length, keep);
}
function removeItem_(folderId, key) {
  const sr = sheet_(SH_R, HR);
  rewrite_(sr, HR.length, rows_(sr, HR.length).filter(x => !(x[C.pasta_id] === folderId && x[C.item_key] === key)));
}
// limpar pasta: tira as OPs já pegas (alguma linha com pego = sim) ou todas as OPs; a pasta continua existindo
function clearItems_(folderId, onlyPicked) {
  folderName_(folderId);
  const sr = sheet_(SH_R, HR), all = rows_(sr, HR.length);
  const pegos = {};
  all.forEach(x => { if (x[C.pasta_id] === folderId && x[C.pego] === 'sim') pegos[x[C.item_key]] = true; });
  rewrite_(sr, HR.length, all.filter(x => !(x[C.pasta_id] === folderId && (!onlyPicked || pegos[x[C.item_key]]))));
}
function setPicked_(folderId, key, rg, endereco, picked, user, pesoBaixa, mc) {
  const sr = sheet_(SH_R, HR), all = rows_(sr, HR.length);
  const i = all.findIndex(x => x[C.pasta_id] === folderId && x[C.item_key] === key && x[C.rg] === s_(rg) && x[C.endereco] === s_(endereco));
  if (i < 0) throw new Error('Rolo não encontrado na pasta (a OP pode ter sido atualizada por outro usuário). Toque em Atualizar.');
  const old = all[i], already = old[C.pego] === 'sim';
  // quem pegou e quando ficam os da primeira marcação; a baixa (peso/MC) pode ser corrigida depois
  sr.getRange(i + 2, C.pego + 1, 1, 3).setNumberFormat('@').setValues([[picked ? 'sim' : 'nao', picked ? (already ? old[C.pego_por] : user) : '', picked ? (already ? old[C.pego_em] : now_()) : '']]);
  sr.getRange(i + 2, C.peso_baixa + 1, 1, 2).setNumberFormat('@').setValues([[picked ? s_(pesoBaixa).replace('.', ',') : '', picked ? s_(mc).slice(0, 30) : '']]);
}

/* ---------------- malhas com defeito (aba Defeitos) ---------------- */
// Uma linha por produto + OP. Todos os usuários do NOVA veem as mesmas malhas ruins.
function listDefects_() {
  return rows_(sheet_(SH_D, HD), HD.length).filter(x => x[0] && x[1]).map(x => ({
    produto: x[0], op: x[1], partida: x[2],
    defeitos: String(x[3]).split(/[,|/]+/).map(t => t.trim().toUpperCase()).filter(t => DEFECT_OPTIONS.indexOf(t) >= 0),
    outros: x[4], observacao: x[5], usuario: x[6], data: x[7]
  })).filter(d => d.defeitos.length);
}
function saveDefect_(d, user) {
  d = d || {};
  const produto = s_(d.produto).trim().toUpperCase().slice(0, 40), op = s_(d.op).trim().slice(0, 40);
  if (!produto || !op) throw new Error('Informe o produto e a OP da malha.');
  const defeitos = (Array.isArray(d.defeitos) ? d.defeitos : []).map(t => s_(t).trim().toUpperCase())
    .filter((t, i, arr) => DEFECT_OPTIONS.indexOf(t) >= 0 && arr.indexOf(t) === i);
  if (!defeitos.length) throw new Error('Selecione pelo menos um defeito.');
  const outros = defeitos.indexOf('OUTROS') >= 0 ? s_(d.outros).trim().slice(0, 80) : '';
  if (defeitos.indexOf('OUTROS') >= 0 && !outros) throw new Error('Descreva o defeito em "Outros".');
  const row = [produto, op, s_(d.partida).trim().slice(0, 40), defeitos.join(', '), outros, s_(d.observacao).trim().slice(0, 300),
    s_(d.usuario || user).slice(0, 40), s_(d.data) || Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm')];
  const sh = sheet_(SH_D, HD);
  const keep = rows_(sh, HD.length).filter(x => !(x[0] === produto && x[1] === op));
  keep.push(row);
  rewrite_(sh, HD.length, keep);
  return { produto: row[0], op: row[1], partida: row[2], defeitos, outros: row[4], observacao: row[5], usuario: row[6], data: row[7] };
}
function removeDefect_(produto, op) {
  produto = s_(produto).trim().toUpperCase(); op = s_(op).trim();
  const sh = sheet_(SH_D, HD);
  rewrite_(sh, HD.length, rows_(sh, HD.length).filter(x => !(x[0] === produto && x[1] === op)));
}
