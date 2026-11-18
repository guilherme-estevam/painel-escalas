/**
 * Escala8.gs — troca só entre agentes com a mesma atuação, pendências da gestão e título da aba com notificações.
 */

/** Atuação do colaborador no mês (grupo da escala publicada): 'Híbrido' (0800 e chat), 'Assíncrono', 'Gestão' ou ''. */
var GRUPO_MEMO_ = {};
function grupoAtuacao_(email, mes) {
  if (!GRUPO_MEMO_[mes]) {
    const m = {};
    tabela_('Escalas').linhas.forEach(function (l) { if (l.mes !== mes) return; const a = atuacaoDe_({ atuacao: l.atuacao_publicada || l.atuacao }); m[l.email] = a && a.g ? a.g : ''; });
    GRUPO_MEMO_[mes] = m;
  }
  return GRUPO_MEMO_[mes][email] || '';
}
function mesmaAtuacao_(a, b, mes) { return grupoAtuacao_(a, mes) === grupoAtuacao_(b, mes); }
function nomeAtuacao_(g) { return g === 'Híbrido' ? '0800 e chat' : g === 'Assíncrono' ? 'assíncrono' : g ? g : 'atuação ainda não definida'; }

/** Pendências que pedem ação da gestão (trocas aguardando aprovação, sem contar as que a própria pessoa participa). */
function apiPendencias(token) {
  const ctx = sessao_(token); expirarTrocasDeVezEmQuando_(); const tr = tabela_('Trocas').linhas;
  const responder = tr.filter(function (l) { return l.status === 'AGUARDANDO_COLEGA' && l.colega === ctx.email; }).length; // pedidos que esperam a resposta desta pessoa
  if (ctx.perfil !== 'GESTAO') return { trocas: 0, responder: responder };
  const rt = rtCache_();
  const n = tr.filter(function (l) { return l.status === 'AGUARDANDO_GESTAO' && podeDecidirTroca_(ctx.email, l, rt); }).length;
  let historico = 0; try { historico = contarHistoricoNovo_(ctx.email); } catch (e) { historico = 0; } // novidades no Histórico (só o número na aba; sem e-mail, Slack ou sino)
  return { trocas: n, responder: responder, historico: historico };
}

/** Título da aba ao abrir o painel: mostra quantas notificações e aprovações estão pendentes. */
function tituloDaAba_() {
  try {
    const email = normalizar_(Session.getActiveUser().getEmail() || '');
    if (!email) return CFG.APP_NOME;
    const u = tabela_('Usuarios').linhas.filter(function (x) { return x.email === email; })[0];
    if (!u || (u.perfil !== 'AGENTE' && u.perfil !== 'GESTAO')) return CFG.APP_NOME;
    const gestao = u.perfil === 'GESTAO';
    let n = tabela_('Notificacoes').linhas.filter(function (x) { return !x.lida_em && (x.destinatario === email || (gestao && x.destinatario === 'GESTAO')); }).length;
    if (gestao) n += tabela_('Trocas').linhas.filter(function (l) { return l.status === 'AGUARDANDO_GESTAO' && l.solicitante !== email && l.colega !== email; }).length;
    return n ? '(' + (n > 99 ? '99+' : n) + ') ' + CFG.APP_NOME : CFG.APP_NOME;
  } catch (e) { return CFG.APP_NOME; }
}
