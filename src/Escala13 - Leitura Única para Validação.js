/**
 * Escala13.gs — lista de colegas aptos para troca usando exatamente as mesmas regras do pedido, do aceite e da aprovação.
 */
function ehVaga_(email) { return /@vagas\./.test(String(email || '')); }

/** Roda fn com Escalas, Trocas e Afastamentos lidas uma única vez (a validação completa é feita para cada candidato). */
function comLeituraUnica_(fn) {
  const abas = ['Escalas', 'Trocas', 'Afastamentos'], tinha = {};
  abas.forEach(function (a) { tinha[a] = !!MEMO_[a]; MEMO_[a] = tabela_(a); });
  try { return fn(); } finally { abas.forEach(function (a) { if (!tinha[a]) delete MEMO_[a]; }); }
}

/**
 * Colegas que podem cobrir quem quer folgar em dFolga e trabalhar em dTrab.
 * Só entra quem passaria em TODAS as checagens feitas depois: mesmo perfil e mesma atuação, escala publicada,
 * sem férias ou licença, regras da escala das duas pessoas, sem outra troca pendente nesses dias e prazo de 48 horas.
 * Vagas sem pessoa definida nunca entram (ninguém consegue entrar no painel com elas para aceitar).
 */
function colegasAptos_(email, perfil, dFolga, dTrab, ignorarTrocaId) {
  return comLeituraUnica_(function () {
    const c = ctxTrocas_(dFolga.slice(0, 7));
    return Object.keys(c.pessoas).filter(function (e) {
      if (e === email || ehVaga_(e) || c.pessoas[e].perfil !== perfil) return false;
      if (perfil === 'AGENTE' && !mesmaAtuacao_(e, email, c.mes)) return false;
      if (!ladoValido_(c, e, dTrab, dFolga).ok || compromisso_(c, e, [dFolga, dTrab], ignorarTrocaId || null)) return false;
      if (prazoCedo_(email, e, dFolga, dTrab)) return false;
      return previaTroca_(email, e, dFolga, dTrab, ignorarTrocaId || null).ok;
    });
  });
}

/** Pedidos em aberto que esta pessoa consegue aceitar agora (mesmas regras do aceite). */
function ofertaAceitavel_(l, email) {
  if (ehVaga_(email)) return false;
  if (prazoCedo_(l.solicitante, email, l.data_solicitante, l.data_colega)) return false;
  return previaTroca_(l.solicitante, email, l.data_solicitante, l.data_colega, l.troca_id).ok;
}
