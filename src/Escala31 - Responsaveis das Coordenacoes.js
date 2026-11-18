/* =====================================================================
 * Responsáveis das coordenações (16/11/2026)
 * Liga cada nome de coordenação (do painel e dos rótulos do Headcount) ao
 * e-mail do responsável, cadastrado na aba Coordenacoes. Serve para:
 *  · mostrar a foto do coordenador nos cartões da Tempos Médios e no Headcount;
 *  · navegar de uma gerência para as coordenações e de uma coordenação para o time.
 * Só leitura: não grava nada.
 * ===================================================================== */
const COORD_RESP_PADRAO = { 'Diretoria': 'diretoria@exemplo.com', 'IA & Automação': 'gerente.um@exemplo.com', 'Engajamento': 'gerente.executiva@exemplo.com' };
function coordResp_() {
  const out = Object.assign({}, COORD_RESP_PADRAO);
  tabela_('Coordenacoes').linhas.forEach(function (c) {
    if (String(c.ativo).toUpperCase() !== 'SIM') return; const e = normalizar_(c.email_responsavel || ''); if (!e || e.indexOf('@') < 0) return;
    [c.nome_exibicao].concat(String(c.rotulos_headcount || '').split('|')).forEach(function (r) { r = String(r || '').trim(); if (r) out[r] = e; });
  });
  return out;
}
(function () {
  const g = globalThis, junta = function (n) { const f = g[n]; if (typeof f !== 'function') return; g[n] = function () { const r = f.apply(this, arguments); try { if (r && typeof r === 'object') r.cr = coordResp_(); } catch (e) { } return r; }; };
  ['apiAderencia', 'apiHeadcount', 'apiHeadcountAtualizar'].forEach(junta);
})();
