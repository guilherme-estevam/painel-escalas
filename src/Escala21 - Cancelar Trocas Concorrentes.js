/**
 * Escala21.gs — várias trocas pendentes no mesmo dia.
 * A pessoa pode pedir outra troca para um dia que já tem troca pendente. Quando uma delas é aprovada,
 * as outras pendentes que envolvem as mesmas pessoas nos mesmos dias são canceladas automaticamente,
 * e todos os envolvidos são avisados (painel, e-mail e Slack).
 */
function cancelarConcorrentes_(aprov, ctx) {
  const t = tabela_('Trocas'), env = [aprov.solicitante, aprov.colega].filter(Boolean), ds = [aprov.data_solicitante, aprov.data_colega];
  const agora = agoraIso_(), avisos = [], logs = [];
  t.linhas.forEach(function (l) {
    if (l.troca_id === aprov.troca_id || TROCA_PENDENTES.indexOf(l.status) < 0) return;
    const envolve = env.indexOf(l.solicitante) >= 0 || (l.colega && env.indexOf(l.colega) >= 0);
    if (!envolve || (ds.indexOf(l.data_solicitante) < 0 && ds.indexOf(l.data_colega) < 0)) return;
    const antes = l.status;
    atualizarLinha_(t, l, { status: 'CANCELADA', resultado_validacao: 'Cancelada automaticamente: outra troca para o mesmo dia foi aprovada (' + aprov.troca_id + ')', atualizado_em: agora });
    [l.solicitante, l.colega].filter(Boolean).forEach(function (d) {
      avisos.push({ dest: d, tipo: 'TROCA_CANCELADA_AUTO', titulo: 'Troca cancelada automaticamente', msg: 'A troca de ' + datasTroca_(l) + ' foi cancelada porque outra troca para o mesmo dia já foi aprovada. Sua escala segue a troca aprovada.', ref: l.troca_id });
    });
    logs.push({ ator: ctx.email, acao: 'TROCA_CANCELADA_AUTO', tipo: 'Troca', registro: l.troca_id, afetado: l.solicitante, antes: { status: antes }, depois: { status: 'CANCELADA', motivo: 'troca ' + aprov.troca_id + ' aprovada para o mesmo dia' } });
  });
  if (logs.length) logLote_(logs);
  if (avisos.length) notificar_(avisos);
  return avisos.length;
}
