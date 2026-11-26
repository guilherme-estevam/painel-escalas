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
/* 26/11/2026: inclui a aba Conta_Digital (área própria no painel, ao lado de Engajamento) */
const HC_ABAS = [['Customer_Service', 'Customer Service'], ['Customer_Experience', 'Experiência'], ['Engajamento', 'Engajamento'], ['Conta_Digital', 'Conta Digital']];
const HC_CAMPOS = ['id', 'nome', 'status', 'email', 'funcao', 'squad', 'lider', 'convenio', 'turno', 'fila', 'segmento', 'entrada', 'saida', 'ferramenta', 'time', 'admissao', 'tempo', 'coord'];
const ABA_HC_BASE = 'HeadcountBase', HC_ESPERA_MS = 9 * 60 * 1000;
/* 19/11/2026: o painel ficava preso em "aguardando a edição terminar" quando algum valor da planilha mudava
 * entre duas leituras sem ninguém editar (fórmula que recalcula sozinha). Agora:
 *  · a comparação ignora o que a planilha recalcula sozinha (tempo de casa e total da empresa), que é
 *    atualizado junto com o resto e, sozinho, no máximo a cada 6 h;
 *  · com diferença há HC_ESPERA_MAX_MS, aplica mesmo sem duas leituras iguais (nunca fica preso);
 *  · leitura ignorada (bem menos gente) e erro de leitura aparecem na tela com mensagem própria;
 *  · cada conferência registra quais campos mudaram (hc_diag), para achar a causa sem rodar nada à mão. */
const HC_VOLATEIS = ['tempo'], HC_ESPERA_MAX_MS = 30 * 60 * 1000, HC_RECALC_MS = 6 * 3600 * 1000;

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
/** Hash do que alguém edita na planilha (sem os campos que ela recalcula sozinha e sem o total da empresa). */
function hcHashCmp_(d) { return hcHash_(d.pessoas.map(function (p) { const o = {}; Object.keys(p).forEach(function (k) { if (HC_VOLATEIS.indexOf(k) < 0) o[k] = p[k]; }); return o; })); }
/** Um hash curto por campo, para saber o que mudou entre leituras. */
function hcCamposHash_(d) {
  const o = { empresa: String(d.empresa || 0), pessoas: String(d.pessoas.length) };
  HC_CAMPOS.concat(['area']).forEach(function (c) { if (c !== 'email') o[c] = hcHash_(d.pessoas.map(function (p) { return p.email + '=' + p[c]; })).slice(0, 10); });
  o.email = hcHash_(d.pessoas.map(function (p) { return p.email; })).slice(0, 10);
  return o;
}
function hcDifCampos_(a, b) { if (!a || !b) return []; return Object.keys(b).filter(function (k) { return a[k] !== b[k]; }); }
function hcJson_(s) { try { return JSON.parse(s || 'null'); } catch (e) { return null; } }
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
  pr.setProperties({ hc_hash: hash, hc_hash_full: hcHash_(d), hc_campos_aplicados: JSON.stringify(hcCamposHash_(d)), hc_empresa: String(d.empresa || 0), hc_atualizado_em: agoraIso_(), hc_aplicado_ms: String(Date.now()) });
  ['hc_pend_hash', 'hc_pend_desde', 'hc_dif_desde', 'hc_aviso'].forEach(function (k) { pr.deleteProperty(k); });
}
function hcBase_() {
  const sh = hcAba_(), pr = PropertiesService.getScriptProperties(), pessoas = [];
  if (sh.getLastRow() > 1) sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { if (r[0]) { try { pessoas.push(JSON.parse(r[0])); } catch (e) { } } });
  const p = pr.getProperties();
  return { pessoas: pessoas, empresa: Number(p.hc_empresa || 0), atualizadoEm: p.hc_atualizado_em || '', pendente: !!p.hc_pend_hash,
    conferidoEm: p.hc_conferido_em || '', aviso: p.hc_aviso || '', erro: p.hc_erro || '', diag: hcJson_(p.hc_diag) };
}
/** Confere a planilha. Devolve 'aplicado', 'igual', 'aguardando' ou 'ignorado'. */
function hcConferir_(forcar) {
  const pr = PropertiesService.getScriptProperties(), agora = Date.now();
  const d = hcLerPlanilha_(), h = hcHashCmp_(d), campos = hcCamposHash_(d), aplicado = pr.getProperty('hc_hash');
  const ult = hcJson_(pr.getProperty('hc_ult_campos')), apl = hcJson_(pr.getProperty('hc_campos_aplicados'));
  const reg = function (res, extra) {
    pr.setProperties(Object.assign({ hc_conferido_em: agoraIso_(), hc_ult_campos: JSON.stringify(campos),
      hc_diag: JSON.stringify({ em: agoraIso_(), resultado: res, pessoas: d.pessoas.length, mudouDesdeAUltimaLeitura: hcDifCampos_(ult, campos), diferenteDaCopia: hcDifCampos_(apl, campos) }) }, extra || {}));
    pr.deleteProperty('hc_erro'); return res;
  };
  if (!aplicado || forcar) { hcGuardar_(d, h); return reg('aplicado'); }
  if (h === aplicado) {
    ['hc_pend_hash', 'hc_pend_desde', 'hc_dif_desde', 'hc_aviso'].forEach(function (k) { pr.deleteProperty(k); });
    // só mudou o que a planilha recalcula sozinha: renova a cópia sem esperar, no máximo a cada 6 h
    if (hcHash_(d) !== pr.getProperty('hc_hash_full') && agora - Number(pr.getProperty('hc_aplicado_ms') || 0) >= HC_RECALC_MS) { hcGuardar_(d, h); return reg('aplicado'); }
    if (d.empresa && String(d.empresa) !== pr.getProperty('hc_empresa')) pr.setProperty('hc_empresa', String(d.empresa));
    return reg('igual');
  }
  // proteção: uma leitura com muito menos gente (aba sendo refeita, filtro, erro) não substitui a base sozinha
  const atual = hcBase_().pessoas.length;
  if (atual && d.pessoas.length < atual * 0.6) return reg('ignorado', { hc_aviso: 'A última leitura da planilha veio com ' + d.pessoas.length + ' pessoas e a cópia do painel tem ' + atual + '. Para não perder dados, ela não foi aplicada. Se a planilha mudou de verdade, use Atualizar Agora.' });
  const pend = pr.getProperty('hc_pend_hash'), desde = Number(pr.getProperty('hc_pend_desde') || 0), difDesde = Number(pr.getProperty('hc_dif_desde') || 0) || agora;
  // aplica quando a planilha ficou igual por uma conferência inteira, ou quando a diferença já dura HC_ESPERA_MAX_MS
  if ((pend === h && agora - desde >= HC_ESPERA_MS) || agora - difDesde >= HC_ESPERA_MAX_MS) { hcGuardar_(d, h); return reg('aplicado'); }
  const extra = { hc_dif_desde: String(difDesde) }; if (pend !== h) { extra.hc_pend_hash = h; extra.hc_pend_desde = String(agora); }
  pr.deleteProperty('hc_aviso');
  return reg('aguardando', extra);
}
/** Chamado pelo movimento do painel: no máximo uma conferência a cada 10 minutos. Erro de leitura fica registrado para a tela. */
function hcTalvez_() {
  const cache = CacheService.getScriptCache(); if (cache.get('hc_chk')) return;
  const lock = LockService.getScriptLock(); if (!lock.tryLock(100)) return;
  try {
    if (cache.get('hc_chk')) return; cache.put('hc_chk', '1', 600);
    try { hcConferir_(false); } catch (e) { PropertiesService.getScriptProperties().setProperties({ hc_erro: String((e && e.message) || e).slice(0, 300), hc_conferido_em: agoraIso_() }); }
  } finally { lock.releaseLock(); }
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
