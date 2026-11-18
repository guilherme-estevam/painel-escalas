/* =====================================================================
 * Headcount no painel (15/11/2026)
 * A planilha "Headcount - Customer" continua sendo a base. O painel lê as três
 * abas dos times (Customer_Service, Customer_Experience e Engajamento), as
 * mesmas que alimentam a aba "Customer Geral", e guarda uma cópia interna na
 * aba HeadcountBase do banco, para a tela abrir na hora.
 * Atualização, sem pesar a ferramenta:
 *  · confere no máximo a cada 10 minutos, e só com o painel em uso;
 *  · se a planilha mudou, NÃO aplica na hora: espera ela ficar igual em duas
 *    conferências seguidas (a pessoa pode estar mexendo em várias linhas);
 *  · o WFM pode forçar pelo botão "Atualizar Agora".
 * ===================================================================== */
const HC_PLANILHA_ID = 'ID_DA_PLANILHA_DE_HEADCOUNT';
const HC_ABAS = [['Customer_Service', 'Customer Service'], ['Customer_Experience', 'Experiência'], ['Engajamento', 'Engajamento']];
const HC_CAMPOS = ['id', 'nome', 'status', 'email', 'funcao', 'squad', 'lider', 'convenio', 'turno', 'fila', 'segmento', 'entrada', 'saida', 'ferramenta', 'time', 'admissao', 'tempo', 'coord'];
const ABA_HC_BASE = 'HeadcountBase', HC_ESPERA_MS = 9 * 60 * 1000;

/** Lê a planilha do Headcount (só leitura). */
function hcLerPlanilha_() {
  const ss = SpreadsheetApp.openById(HC_PLANILHA_ID), pessoas = [];
  HC_ABAS.forEach(function (a) {
    const sh = ss.getSheetByName(a[0]); if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, HC_CAMPOS.length).getDisplayValues().forEach(function (r) {
      const email = String(r[3] || '').trim().toLowerCase(); if (!String(r[1] || '').trim() || email.indexOf('@') < 0) return;
      const p = { area: a[1] }; HC_CAMPOS.forEach(function (c, i) { p[c] = String(r[i] == null ? '' : r[i]).trim(); });
      p.email = email; p.entrada = p.entrada.slice(0, 5); p.saida = p.saida.slice(0, 5); pessoas.push(p);
    });
  });
  let empresa = 0; try { empresa = Number(String(ss.getSheetByName('Customer Geral').getRange('F1').getDisplayValue()).replace(/\D/g, '')) || 0; } catch (e) { empresa = 0; }
  return { pessoas: pessoas, empresa: empresa };
}
function hcHash_(d) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(d), Utilities.Charset.UTF_8)); }
function hcAba_() {
  const ss = db_(); let sh = ss.getSheetByName(ABA_HC_BASE);
  if (!sh) { sh = ss.insertSheet(ABA_HC_BASE); sh.getRange(1, 1, sh.getMaxRows(), 2).setNumberFormat('@'); sh.getRange(1, 1, 1, 2).setValues([['email', 'dados']]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
function hcGuardar_(d, hash) {
  const sh = hcAba_(), v = d.pessoas.map(function (p) { return [p.email, JSON.stringify(p)]; });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent();
  if (v.length) { if (sh.getMaxRows() < v.length + 1) sh.insertRowsAfter(sh.getMaxRows(), v.length + 1 - sh.getMaxRows()); sh.getRange(2, 1, v.length, 2).setNumberFormat('@').setValues(v); }
  const pr = PropertiesService.getScriptProperties();
  pr.setProperties({ hc_hash: hash, hc_empresa: String(d.empresa || 0), hc_atualizado_em: agoraIso_() }); pr.deleteProperty('hc_pend_hash'); pr.deleteProperty('hc_pend_desde');
}
function hcBase_() {
  const sh = hcAba_(), pr = PropertiesService.getScriptProperties(), pessoas = [];
  if (sh.getLastRow() > 1) sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { if (r[0]) { try { pessoas.push(JSON.parse(r[0])); } catch (e) { } } });
  return { pessoas: pessoas, empresa: Number(pr.getProperty('hc_empresa') || 0), atualizadoEm: pr.getProperty('hc_atualizado_em') || '', pendente: !!pr.getProperty('hc_pend_hash') };
}
/** Confere a planilha. Devolve 'aplicado', 'igual', 'aguardando' ou 'ignorado'. */
function hcConferir_(forcar) {
  const d = hcLerPlanilha_(), h = hcHash_(d), pr = PropertiesService.getScriptProperties(), aplicado = pr.getProperty('hc_hash');
  if (!aplicado || forcar) { hcGuardar_(d, h); return 'aplicado'; }
  if (h === aplicado) { pr.deleteProperty('hc_pend_hash'); pr.deleteProperty('hc_pend_desde'); return 'igual'; }
  // proteção: uma leitura com muito menos gente (aba sendo refeita, filtro, erro) não substitui a base sozinha
  const atual = hcBase_().pessoas.length; if (atual && d.pessoas.length < atual * 0.6) return 'ignorado';
  const pend = pr.getProperty('hc_pend_hash'), desde = Number(pr.getProperty('hc_pend_desde') || 0), agora = Date.now();
  if (pend === h && agora - desde >= HC_ESPERA_MS) { hcGuardar_(d, h); return 'aplicado'; }
  if (pend !== h) pr.setProperties({ hc_pend_hash: h, hc_pend_desde: String(agora) });
  return 'aguardando';
}
/** Chamado pelo movimento do painel: no máximo uma conferência a cada 10 minutos. */
function hcTalvez_() {
  const cache = CacheService.getScriptCache(); if (cache.get('hc_chk')) return;
  const lock = LockService.getScriptLock(); if (!lock.tryLock(100)) return;
  try { if (cache.get('hc_chk')) return; cache.put('hc_chk', '1', 600); hcConferir_(false); }
  finally { lock.releaseLock(); }
}
/** Gestão: dados do Headcount (da cópia interna). */
function apiHeadcount(token) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  let b = hcBase_(); if (!b.pessoas.length) { hcConferir_(true); b = hcBase_(); }
  b.ph = ehSuperadmin_(ctx.email); return b;
}
/** WFM: lê a planilha agora e aplica. */
function apiHeadcountAtualizar(token) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  if (!ehSuperadmin_(ctx.email)) throw new Error('Só o WFM pode forçar a atualização do Headcount.');
  hcConferir_(true); const b = hcBase_(); b.ph = true; return b;
}
/** Uso manual no editor: confere a leitura (só lê a planilha e grava a cópia interna). */
function hcTestar() {
  const d = hcLerPlanilha_(), c = {}; d.pessoas.forEach(function (p) { c[p.area] = (c[p.area] || 0) + 1; });
  Logger.log('HC|pessoas ' + d.pessoas.length + ' · ' + JSON.stringify(c) + ' · empresa ' + d.empresa + ' · ' + hcConferir_(true));
}
