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
 * As abas "Pastas" e "Rolos" são criadas sozinhas. Pode olhar e filtrar à vontade;
 * evite apagar colunas ou mudar a linha 1 (cabeçalho).
 * Se alterar este código depois: Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova versão → Implantar.
 */
const CHAVE = 'TROQUE-ESTA-CHAVE';

const SH_P = 'Pastas', SH_R = 'Rolos';
const HP = ['id', 'nome', 'criada_em', 'criada_por'];
const HR = ['pasta_id', 'pasta', 'item_key', 'produto', 'descricao', 'op', 'partida', 'enderecos', 'status',
            'rg', 'endereco', 'armazem', 'peso', 'gramatura', 'cmc', 'pego', 'pego_por', 'pego_em', 'salvo_por', 'salvo_em'];
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
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const user = String(b.user || '').slice(0, 40);
      let extra = {};
      if (a === 'createFolder') extra.folder = createFolder_(b.name, user);
      else if (a === 'deleteFolder') deleteFolder_(b.folderId);
      else if (a === 'saveItem') saveItem_(b.folderId, b.item, user);
      else if (a === 'removeItem') removeItem_(b.folderId, b.itemKey);
      else if (a === 'setPicked') setPicked_(b.folderId, b.itemKey, b.rg, b.endereco, !!b.picked, user);
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
      picked: x[C.pego] === 'sim', pickedBy: x[C.pego_por], pickedAt: Date.parse(x[C.pego_em]) || null });
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
    keep.push(row);
  });
  rewrite_(sr, HR.length, keep);
}
function removeItem_(folderId, key) {
  const sr = sheet_(SH_R, HR);
  rewrite_(sr, HR.length, rows_(sr, HR.length).filter(x => !(x[C.pasta_id] === folderId && x[C.item_key] === key)));
}
function setPicked_(folderId, key, rg, endereco, picked, user) {
  const sr = sheet_(SH_R, HR), all = rows_(sr, HR.length);
  const i = all.findIndex(x => x[C.pasta_id] === folderId && x[C.item_key] === key && x[C.rg] === s_(rg) && x[C.endereco] === s_(endereco));
  if (i < 0) throw new Error('Rolo não encontrado na pasta (a OP pode ter sido atualizada por outro usuário). Toque em Atualizar.');
  sr.getRange(i + 2, C.pego + 1, 1, 3).setNumberFormat('@').setValues([[picked ? 'sim' : 'nao', picked ? user : '', picked ? now_() : '']]);
}
