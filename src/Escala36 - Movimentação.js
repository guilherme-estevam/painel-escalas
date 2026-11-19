/* =====================================================================
 * Movimentação de colaborador (19/11/2026)
 * Registrada pelo WFM no Planejamento (editor da pessoa), com
 * confirmação, do mesmo jeito que o desligamento (Escala30). A data informada
 * é a da MOVIMENTAÇÃO: o primeiro dia da pessoa fora do painel. O último dia
 * no painel é a véspera. Até lá nada muda; a partir da data:
 *  · a escala é excluída (dias seguintes sem trabalho; meses seguintes apagados);
 *  · trocas pendentes com ela são canceladas e ninguém consegue pedir troca;
 *  · o login fica bloqueado e as sessões abertas são encerradas;
 *  · não aparece mais na Visão Operacional nem no Controle de Logados;
 *  · os dias aparecem como "Movimentação" na Escala e Presença do Mês e na planilha do RH;
 *  · o registro "Movimentação Registrada" entra no Histórico, com o destino (opcional).
 * A pessoa continua no cadastro (ativo), para o histórico seguir nas telas.
 * As regras de exibição são as do Escala30 (desligMapa_ reconhece movimentado_em).
 * ===================================================================== */
function movColunas_() {
  const sh = db_().getSheetByName('Pessoas'), cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(String);
  const falta = ['movimentado_em', 'movimentacao_destino'].filter(function (c) { return cab.indexOf(c) < 0; });
  if (!falta.length) return;
  falta.forEach(function (c, i) { const col = cab.length + 1 + i; sh.getRange(1, col).setValue(c); sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat('@'); });
  delete MEMO_['Pessoas']; try { abaMudou_('Pessoas'); } catch (e) { }
}
function movCalc_(email, data, destino) {
  data = dataIso_(data);
  if (!data) throw new Error('Informe a data da movimentação.');
  if (data < '2026-11-02') throw new Error('A data da movimentação precisa ser a partir de 02/11/2026.');
  const c = desligCalc_(email, diaAnteriorIso_(data));
  c.dataMov = data; c.dataMovBr = desligBr_(data); c.ultimoBr = c.dataBr;
  c.destino = String(destino || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  c.loginBloqueadoJa = hojeIso_() >= data;
  return c;
}
/** WFM: prévia (não grava). */
function apiMovimentacaoPrevia(token, email, data, destino) { const ctx = sessao_(token); exigirPlanejamento_(ctx); return movCalc_(email, data, destino); }
/** WFM: registra a movimentação. */
function apiMovimentar(token, email, data, destino) {
  const ctx = sessao_(token); exigirPlanejamento_(ctx);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    MEMO_ = {}; const c = movCalc_(email, data, destino); email = c.email;
    if (c.jaDesligadoEm) throw new Error('O desligamento desta pessoa já foi registrado (último dia ' + desligBr_(c.jaDesligadoEm) + ').');
    if (c.jaMovimentadoEm) throw new Error('A movimentação desta pessoa já foi registrada (a partir de ' + desligBr_(c.jaMovimentadoEm) + ').');
    movColunas_();
    const tp = tabela_('Pessoas'), p = tp.linhas.filter(function (x) { return String(x.email).toLowerCase() === email; })[0];
    atualizarLinha_(tp, p, { movimentado_em: c.dataMov, movimentacao_destino: c.destino });
    saidaEfeitos_(ctx, c, 'Cancelada automaticamente: movimentação registrada (a partir de ' + c.dataMovBr + ').');
    log_(ctx.email, 'MOVIMENTACAO', 'Pessoa', email, email, { movimentado_em: '' },
      { data_da_movimentacao: c.dataMovBr, destino: c.destino || '—', ultimo_dia_no_painel: c.ultimoBr, dias_de_trabalho_removidos: c.diasRemovidos, meses_apagados: c.mesesApagados.join(', '), trocas_canceladas: c.trocas.length }, '');
    saidaLimparCaches_(c.data);
    return Object.assign({ ok: true }, c);
  } finally { lock.releaseLock(); }
}
