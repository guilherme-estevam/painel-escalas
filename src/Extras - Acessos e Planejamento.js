/**
 * Extras.gs — Minha jornada, trocas em aberto, edição de afastamentos
 * e histórico de acessos (restrito).
 */

/** Quem vê e usa as abas Planejamento e Histórico de acessos (o restante da gestão usa as outras abas). */
const SUPERADMINS = ['gerente.um@exemplo.com', 'wfm.um@exemplo.com', 'wfm.dois@exemplo.com', 'admin@exemplo.com', 'wfm.tres@exemplo.com', 'conta.teste2@exemplo.com', 'conta.teste1@exemplo.com'];
function exigirPlanejamento_(ctx) { if (!ehSuperadmin_(ctx.email)) throw new Error('Você não tem acesso ao Planejamento. Ele é usado só pelo WFM (equipe de WFM).'); }
const ACOES_SEGURANCA = ['LOGIN', 'LOGOUT', 'LOGIN_FALHOU', 'LINK_SENHA_ENVIADO', 'LINK_SENHA_NEGADO', 'SENHA_DEFINIDA_POR_LINK', 'SENHA_ALTERADA', 'TROCA_SENHA_FALHOU'];
function ehSuperadmin_(email) { return SUPERADMINS.indexOf(email) >= 0; }
function apiMeuAcesso(token) { const ctx = sessao_(token); return { superadmin: ehSuperadmin_(ctx.email), perfil: ctx.perfil }; }

/* ---------------------------------------------------------------------
 * MINHA JORNADA — sempre a escala oficial (publicada) da própria pessoa
 * --------------------------------------------------------------------- */
function apiMinhaJornada(token, mes) {
  const ctx = sessao_(token); mesValido_(mes);
  const r = apiMes(token, mes, ctx.perfil === 'GESTAO' ? ctx.email : null);
  const e = r.escalas[ctx.email];
  if (ctx.perfil === 'GESTAO' && e) {
    const pub = {}; tabela_('Escalas').linhas.forEach(function (l) { if (l.email === ctx.email) pub[l.mes] = l.dias_publicados; });
    e.dias = e.diasPub || ''; e.ant = pub[mesDelta_(mes, -1)] || ''; e.prox = pub[mesDelta_(mes, 1)] || '';
    e.status = e.dias ? 'PUBLICADA' : 'NAO_PUBLICADA';
  }
  if (e && e.status === 'SEM_ESCALA') e.status = 'NAO_PUBLICADA';
  const pend = [];
  tabela_('Trocas').linhas.forEach(function (l) {
    if (TROCA_PENDENTES.indexOf(l.status) < 0) return;
    if (l.solicitante !== ctx.email && l.colega !== ctx.email) return;
    [l.data_solicitante, l.data_colega].forEach(function (d) { if (d.slice(0, 7) === mes) pend.push(d); });
  });
  r.gestao = false; r.souAgente = ctx.perfil === 'AGENTE'; r.hoje = hojeIso_(); r.trocasPendentes = pend;
  delete r.coordenacoes;
  return r;
}

/* ---------------------------------------------------------------------
 * TROCAS — modelo "quero folgar no dia X e trabalhar no dia Y"
 * data_solicitante = dia em que quem pede passa a FOLGAR
 * data_colega      = dia em que quem pede passa a TRABALHAR
 * Quem cobre faz o contrário. Status ABERTA = sem colega definido ainda.
 * --------------------------------------------------------------------- */
function semanaDe_(d) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - x.getUTCDay()); return Utilities.formatDate(x, 'UTC', 'yyyy-MM-dd'); }
function ctxTrocas_(mes) {
  const pessoas = {}; pessoasEscala_().forEach(function (p) { pessoas[p.email] = p; });
  const pub = {}; tabela_('Escalas').linhas.forEach(function (l) { pub[l.mes + '|' + l.email] = l.dias_publicados; });
  const fx = faixaMes_(mes); const af = {};
  afastamentosEntre_(fx.ini, fx.fim).forEach(function (a) { (af[a.email] = af[a.email] || []).push(a); });
  return { mes: mes, pessoas: pessoas, pub: pub, af: af, fo: feriadosOffLista_(), trocas: tabela_('Trocas').linhas, hoje: hojeIso_() };
}
function emAfast_(c, email, d) { return (c.af[email] || []).some(function (a) { return d >= a.inicio && d <= a.fim; }); }
function conflito_(c, email, datas, ignorarId) {
  return c.trocas.some(function (l) {
    if (TROCA_PENDENTES.indexOf(l.status) < 0 || l.troca_id === ignorarId) return false;
    if (l.solicitante !== email && l.colega !== email) return false;
    return datas.indexOf(l.data_solicitante) >= 0 || datas.indexOf(l.data_colega) >= 0;
  });
}
/** Valida a escala de quem passa a FOLGAR em dFolga e a TRABALHAR em dTrab. */
function ladoValido_(c, email, dFolga, dTrab) {
  const p = c.pessoas[email], s = c.pub[c.mes + '|' + email], motivos = [];
  if (!p) return { ok: false, motivos: ['Pessoa sem acesso ao painel.'] };
  if (!s) return { ok: false, motivos: [p.nome + ' ainda não tem a escala de ' + mesBr_(c.mes) + ' publicada.'] };
  const i = +dFolga.slice(8) - 1, j = +dTrab.slice(8) - 1;
  if (s.charAt(i) !== 'T') motivos.push(p.nome + ' não trabalha em ' + dBr_(dFolga) + '.');
  if (s.charAt(j) !== 'F') motivos.push(p.nome + ' não está de folga em ' + dBr_(dTrab) + '.');
  if (emAfast_(c, email, dFolga) || emAfast_(c, email, dTrab)) motivos.push(p.nome + ' está de férias ou licença numa das datas.');
  const novo = s.slice(0, i) + 'F' + s.slice(i + 1); const novo2 = novo.slice(0, j) + 'T' + novo.slice(j + 1);
  const viz = function (d) { return c.pub[mesDelta_(c.mes, d) + '|' + email] || ''; };
  const v = validarEscala_({ mes: c.mes, dias: novo2, ant: viz(-1), prox: viz(1), afast: c.af[email] || [], segSex: p.segSex, ferOff: c.fo });
  const vAntes = validarEscala_({ mes: c.mes, dias: s, ant: viz(-1), prox: viz(1), afast: c.af[email] || [], segSex: p.segSex, ferOff: c.fo });
  if (!motivos.length) v.erros.forEach(function (e) { motivos.push(p.nome + ': ' + e.msg); });
  return { ok: motivos.length === 0, motivos: motivos, antes: s, depois: novo2, v: v, vAntes: vAntes, p: p };
}
function semanaPrevia_(c, email, antes, depois, datas) {
  const sem = semanaDe_(datas[0]); const x = new Date(sem + 'T00:00:00Z'); const dias = [];
  for (let k = 0; k < 7; k++) {
    const y = new Date(x.getTime()); y.setUTCDate(y.getUTCDate() + k); const iy = Utilities.formatDate(y, 'UTC', 'yyyy-MM-dd');
    const dentro = iy.slice(0, 7) === c.mes;
    const fora = (c.pub[iy.slice(0, 7) + '|' + email] || '').charAt(+iy.slice(8) - 1) || '.';
    dias.push({ data: iy, antes: dentro ? antes.charAt(+iy.slice(8) - 1) : fora, depois: dentro ? depois.charAt(+iy.slice(8) - 1) : fora, afast: emAfast_(c, email, iy), troca: datas.indexOf(iy) >= 0 });
  }
  return [{ inicio: sem, dias: dias }];
}
function checarDatas_(dFolga, dTrab, hoje) {
  dFolga = dataIso_(dFolga); dTrab = dataIso_(dTrab);
  if (!dFolga || !dTrab) return 'Escolha os dois dias.';
  if (dFolga === dTrab) return 'Escolha dois dias diferentes.';
  if (dFolga.slice(0, 7) !== dTrab.slice(0, 7)) return 'Os dois dias precisam ser do mesmo mês.';
  if (semanaDe_(dFolga) !== semanaDe_(dTrab)) return 'Os dois dias precisam estar na mesma semana (domingo a sábado), para manter 5 dias de trabalho e 2 de folga.';
  if (dFolga < hoje || dTrab < hoje) return 'Só é possível trocar dias de hoje em diante.';
  return '';
}
function expirarTrocasBase_() {
  // expira: datas que já passaram; pedido sem aceite até 72 h antes do primeiro turno; aprovação que não veio até 24 h antes
  const trava = LockService.getScriptLock(); if (!trava.tryLock(5000)) return;
  try {
    const t = tabela_('Trocas'), hoje = hojeIso_(), agora = Date.now(), logs = [], avisos = [];
    t.linhas.forEach(function (l) {
      if (TROCA_PENDENTES.indexOf(l.status) < 0) return;
      let motivo = '';
      if (l.data_solicitante < hoje || l.data_colega < hoje) motivo = 'as datas da troca já passaram';
      else {
        let lim = Infinity; try { lim = l.status === 'AGUARDANDO_GESTAO' ? prazoGestaoMs_(l) : prazoAceiteMs_(l); } catch (e) { lim = Infinity; }
        if (agora > lim) motivo = l.status === 'AGUARDANDO_GESTAO' ? 'a coordenação não aprovou até ' + TROCA_PRAZO_GESTAO_H + ' horas antes do primeiro turno' : (l.colega ? 'o colega não aceitou' : 'ninguém aceitou') + ' até ' + TROCA_PRAZO_H + ' horas antes do primeiro turno';
      }
      if (!motivo) return;
      const antes = l.status; atualizarLinha_(t, l, { status: 'EXPIRADA', resultado_validacao: 'Expirou: ' + motivo, atualizado_em: agoraIso_() });
      logs.push({ ator: 'sistema', acao: 'TROCA_EXPIRADA', tipo: 'Troca', registro: l.troca_id, afetado: l.solicitante, antes: { status: antes }, depois: { status: 'EXPIRADA', motivo: motivo } });
      [l.solicitante, l.colega].filter(Boolean).forEach(function (d) { avisos.push({ dest: d, tipo: 'TROCA_EXPIRADA', titulo: 'Troca expirada', msg: 'A troca de ' + datasTroca_(l) + ' expirou porque ' + motivo + '. Sua escala continua como estava.', ref: l.troca_id }); });
    });
    if (logs.length) logLote_(logs);
    if (avisos.length) notificar_(avisos);
  } finally { trava.releaseLock(); }
}

/** Colegas que podem cobrir: folgam no dia em que quem pede quer folgar e trabalham no dia em que quem pede vai trabalhar. */
function apiTrocaCompativeis(token, dFolga, dTrab) {
  const ctx = sessao_(token);
  const erro = checarDatas_(dFolga, dTrab, hojeIso_()); if (erro) return { ok: false, msg: erro, colegas: [] };
  const pes = {}; pessoasEscala_().forEach(function (p) { pes[p.email] = p; });
  const lista = colegasAptos_(ctx.email, ctx.perfil, dataIso_(dFolga), dataIso_(dTrab))
    .map(function (e) { return { email: e, nome: pes[e].nome, coord: pes[e].coord }; })
    .sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
  return { ok: true, colegas: lista };
}
function apiTrocaPreviaNovaBase_(token, dFolga, dTrab, colega) { // a versão com o resumo das regras está em Escala22
  const ctx = sessao_(token);
  const erro = checarDatas_(dFolga, dTrab, hojeIso_()); if (erro) return { ok: false, motivos: [erro] };
  const prazo = prazo48h_(ctx.email, colega, dFolga, dTrab); if (prazo) return { ok: false, motivos: [prazo] };
  if (colega) return limparPrevia_(previaTroca_(ctx.email, normalizar_(colega), dFolga, dTrab, null));
  const c = ctxTrocas_(dFolga.slice(0, 7)); const a = ladoValido_(c, ctx.email, dFolga, dTrab);
  const motivos = a.motivos.slice(); const bqE = bloqueioEnvio_(c, ctx.email, [dFolga, dTrab]); if (bqE) motivos.push(bqE);
  return { ok: motivos.length === 0, motivos: motivos, mes: c.mes, aberta: true,
    pessoas: [{ email: ctx.email, nome: a.p ? a.p.nome : '', domAntes: a.vAntes ? a.vAntes.resumo.domingosFolga : 0, domDepois: a.v ? a.v.resumo.domingosFolga : 0, domTrabAntes: a.vAntes ? a.vAntes.resumo.domingosTrab : 0, domTrabDepois: a.v ? a.v.resumo.domingosTrab : 0, trabAntes: a.vAntes ? a.vAntes.resumo.trabalho : 0, trabDepois: a.v ? a.v.resumo.trabalho : 0, erros: [], avisos: [], semanas: a.antes ? semanaPrevia_(c, ctx.email, a.antes, a.depois, [dFolga, dTrab]) : [] }] };
}
function apiTrocaCriar(token, dFolga, dTrab, colega, motivo) {
  const ctx = sessao_(token);
  const erro = checarDatas_(dFolga, dTrab, hojeIso_()); if (erro) return { ok: false, motivos: [erro] };
  const prazo = prazo48h_(ctx.email, colega, dFolga, dTrab); if (prazo) return { ok: false, motivos: [prazo] };
  colega = colega ? normalizar_(colega) : '';
  if (colega) return apiTrocaSolicitar(token, colega, dFolga, dTrab, motivo);
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    const c = ctxTrocas_(dFolga.slice(0, 7)); const a = ladoValido_(c, ctx.email, dFolga, dTrab);
    const motivos = a.motivos.slice(); const bqE = bloqueioEnvio_(c, ctx.email, [dFolga, dTrab]); if (bqE) motivos.push(bqE);
    if (motivos.length) return { ok: false, motivos: motivos };
    const compat = colegasAptos_(ctx.email, ctx.perfil, dFolga, dTrab);
    if (!compat.length) return { ok: false, motivos: ['Nenhum colega pode cobrir essa troca agora, pelas regras da escala. Escolha outros dias.'] };
    const id = novoId_('tr'); const agora = agoraIso_(); const nome = nomeCurto_(ctx.pessoa.nome);
    appendLinhas_('Trocas', [{ troca_id: id, mes: c.mes, solicitante: ctx.email, colega: '', data_solicitante: dFolga, data_colega: dTrab, status: 'ABERTA', motivo: String(motivo || '').slice(0, 200), criada_em: agora, resultado_validacao: 'OK na abertura', atualizado_em: agora }]);
    log_(ctx.email, 'TROCA_ABERTA', 'Troca', id, '', null, { folga: dFolga, trabalha: dTrab }, motivo, id);

    notificar_(compat.map(function (e) { return { dest: e, tipo: 'TROCA_ABERTA', titulo: 'Pedido de troca aberto: você pode cobrir', msg: nome + ' quer folgar em ' + dBr_(dFolga) + '. Se você aceitar, trabalha em ' + dBr_(dFolga) + ' ' + horarioFrentesTxt_(ctx.email, dFolga) + ' e folga em ' + dBr_(dTrab) + '. O pedido foi para ' + compat.length + ' pessoa' + (compat.length > 1 ? 's' : '') + ' com a mesma atuação: a primeira que aceitar fica com a troca, que depois passa pela coordenação. Para aceitar, abra Minha escala.', ref: id }; }));
    return { ok: true, id: id, compativeis: compat.length };
  } finally { lock.releaseLock(); }
}

function apiTrocaOfertasBase_(token) {
  const ctx = sessao_(token);
  const hoje = hojeIso_(); const nomes = {}; pessoasEscala_().forEach(function (p) { nomes[p.email] = p.nome; });
  const perfis = {}; pessoasEscala_().forEach(function (p) { perfis[p.email] = p.perfil; });
  const abertas = tabela_('Trocas').linhas.filter(function (l) { return l.status === 'ABERTA' && l.solicitante !== ctx.email && perfis[l.solicitante] === ctx.perfil && (ctx.perfil !== 'AGENTE' || mesmaAtuacao_(l.solicitante, ctx.email, l.data_solicitante.slice(0, 7))) && l.data_solicitante >= hoje && l.data_colega >= hoje; });
  const porMes = {}; const itens = [];
  abertas.forEach(function (l) {
    if (ehTrocaHorario_(l)) { if (horarioAlvoOk_(l, ctx.email) && ofertaAceitavel_(l, ctx.email)) itens.push(trocaObj_(l, nomes)); return; } // troca de horário em aberto
    const mes = l.data_solicitante.slice(0, 7); const c = porMes[mes] || (porMes[mes] = ctxTrocas_(mes));
    if (!ladoValido_(c, ctx.email, l.data_colega, l.data_solicitante).ok) return;
    if (compromisso_(c, ctx.email, [l.data_solicitante, l.data_colega], l.troca_id) || recusasDe_(l).indexOf(ctx.email) >= 0) return; // pedidos sem resposta não escondem a oferta; recusada some
    if (!ofertaAceitavel_(l, ctx.email)) return;
    itens.push(trocaObj_(l, nomes));
  });
  return { itens: itens };
}
function apiTrocaPreviaOferta(token, id) {
  const ctx = sessao_(token);
  const l = tabela_('Trocas').linhas.filter(function (x) { return x.troca_id === id; })[0];
  if (!l || l.status !== 'ABERTA') return { ok: false, motivos: ['Esta troca não está mais disponível.'] };
  return limparPrevia_(previaTroca_(l.solicitante, ctx.email, l.data_solicitante, l.data_colega, l.troca_id));
}
function apiTrocaAceitarOferta(token, id) {
  const ctx = sessao_(token);
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    const t = tabela_('Trocas'); const l = t.linhas.filter(function (x) { return x.troca_id === id; })[0];
    if (!l || l.status !== 'ABERTA') return { ok: false, msg: 'Outra pessoa aceitou primeiro ou o pedido foi cancelado.' };
    if (l.solicitante === ctx.email) return { ok: false, msg: 'Você não pode aceitar o próprio pedido.' };
    if (ehTrocaHorario_(l) && !horarioAlvoOk_(l, ctx.email)) return { ok: false, msg: 'Este pedido é para quem trabalha das ' + String(l.horario_alvo).replace('-', ' às ') + ' nesse dia. O seu horário é outro.' };
    const prazoA = prazoAceite_(l.solicitante, ctx.email, l.data_solicitante, l.data_colega); if (prazoA) return { ok: false, msg: prazoA };
    const bqA = bloqueioAceite_(ctx.email, l); if (bqA) return { ok: false, msg: bqA };
    const pv = previaTroca_(l.solicitante, ctx.email, l.data_solicitante, l.data_colega, l.troca_id);
    if (!pv.ok) return { ok: false, msg: pv.motivos.join(' ') };
    const agora = agoraIso_(); const nome = nomeCurto_(ctx.pessoa.nome); const datas = datasTroca_(l);
    atualizarLinha_(t, l, { colega: ctx.email, status: 'AGUARDANDO_GESTAO', aceite_em: agora, resultado_validacao: 'OK no aceite', atualizado_em: agora });
    log_(ctx.email, 'TROCA_ACEITA', 'Troca', id, l.solicitante, { status: 'ABERTA', colega: '' }, { status: 'AGUARDANDO_GESTAO', colega: ctx.email }, '', id);
    notificar_([{ dest: l.solicitante, tipo: 'TROCA_ACEITA', titulo: 'Alguém aceitou sua troca', msg: nome + ' aceitou cobrir sua troca (' + datas + '). Em ' + dBr_(l.data_colega) + ' você cobre o turno de ' + nome + ', no mesmo horário que o seu: ' + horarioTxt_(ctx.email, l.data_colega) + '. Agora falta a aprovação da coordenação.', ref: id },
      { dest: 'GESTAO', tipo: 'TROCA_APROVACAO', titulo: 'Troca aguardando aprovação', msg: nomeCurto_(pv.pessoas[0].nome) + ' e ' + nome + ' (' + datas + ').', ref: id }]);
    enviarEmail_(l.solicitante, 'Sua troca de escala foi aceita', nome + ' aceitou sua troca de escala (' + datas + '). Agora falta a aprovação da coordenação.');
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function apiTrocaCancelarV2(token, id) {
  const ctx = sessao_(token);
  const t = tabela_('Trocas'); const l = t.linhas.filter(function (x) { return x.troca_id === id; })[0];
  if (!l || l.solicitante !== ctx.email) throw new Error('SEM_PERMISSAO');
  if (l.status !== 'ABERTA') return apiTrocaCancelar(token, id);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    atualizarLinha_(t, l, { status: 'CANCELADA', atualizado_em: agoraIso_() });
    log_(ctx.email, 'TROCA_CANCELADA', 'Troca', id, '', { status: 'ABERTA' }, { status: 'CANCELADA' }, '', id);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ---------------------------------------------------------------------
 * FÉRIAS E LICENÇAS — edição
 * --------------------------------------------------------------------- */
function apiEditarAfastamento(token, a) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  const inicio = dataIso_(a && a.inicio), fim = dataIso_(a && a.fim);
  const tipo = (a && (a.tipo === 'FERIAS' || a.tipo === 'LICENCA')) ? a.tipo : '';
  if (!a || !a.id) return { ok: false, msg: 'Registro não informado.' };
  if (!tipo) return { ok: false, msg: 'Escolha férias ou licença.' };
  if (!inicio || !fim) return { ok: false, msg: 'Informe início e fim.' };
  if (fim < inicio) return { ok: false, msg: 'O fim precisa ser igual ou depois do início.' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tabela_('Afastamentos'); const l = t.linhas.filter(function (x) { return x.afast_id === a.id && x.ativo === 'SIM'; })[0];
    if (!l) return { ok: false, msg: 'Registro não encontrado.' };
    const email = normalizar_(a.email || l.email);
    if (!pessoasEscala_().some(function (p) { return p.email === email; })) return { ok: false, msg: 'Escolha a pessoa.' };
    const conflito = afastamentosEntre_(inicio, fim).filter(function (x) { return x.email === email && x.id !== a.id; })[0];
    if (conflito) return { ok: false, msg: 'Já existe ' + (conflito.tipo === 'FERIAS' ? 'férias' : 'licença') + ' de ' + dBr_(conflito.inicio) + ' a ' + dBr_(conflito.fim) + ' para essa pessoa.' };
    const obs = String(a.obs || '').trim().slice(0, 200);
    const antes = { email: l.email, tipo: l.tipo, inicio: l.inicio, fim: l.fim, observacao: l.observacao };
    atualizarLinha_(t, l, { email: email, tipo: tipo, inicio: inicio, fim: fim, observacao: obs, alterado_em: agoraIso_(), alterado_por: ctx.email });
    log_(ctx.email, 'AFASTAMENTO_ALTERADO', 'Afastamento', a.id, email, antes, { email: email, tipo: tipo, inicio: inicio, fim: fim, observacao: obs }, '');
    if (antes.tipo !== tipo || antes.inicio !== inicio || antes.fim !== fim || antes.email !== email) { // aviso só para férias, sem e-mail
      const quem = nomeCurto_(ctx.pessoa.nome), avisos = [];
      if (antes.tipo === 'FERIAS' && (tipo !== 'FERIAS' || antes.email !== email)) avisos.push({ dest: antes.email, tipo: 'FERIAS', titulo: 'Férias removidas', msg: 'Suas férias de ' + dBr_(antes.inicio) + ' a ' + dBr_(antes.fim) + ' foram removidas por ' + quem + '.', ref: a.id });
      if (tipo === 'FERIAS') avisos.push(antes.tipo === 'FERIAS' && antes.email === email
        ? { dest: email, tipo: 'FERIAS', titulo: 'Férias alteradas', msg: 'Suas férias foram alteradas por ' + quem + ': agora de ' + dBr_(inicio) + ' a ' + dBr_(fim) + '.', ref: a.id }
        : { dest: email, tipo: 'FERIAS', titulo: 'Férias cadastradas', msg: 'Suas férias de ' + dBr_(inicio) + ' a ' + dBr_(fim) + ' foram cadastradas por ' + quem + '.', ref: a.id });
      notificar_(avisos);
    }
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ---------------------------------------------------------------------
 * HISTÓRICO DE ACESSOS — somente SUPERADMINS
 * --------------------------------------------------------------------- */
function apiAcessos(token, filtro) {
  const ctx = sessao_(token);
  exigirGestao_(ctx); // histórico de acessos: toda a gestão
  filtro = filtro || {};
  const hoje = hojeIso_();
  const d7 = Utilities.formatDate(new Date(Date.now() - 6 * 864e5), 'America/Fortaleza', 'yyyy-MM-dd');
  const d30 = Utilities.formatDate(new Date(Date.now() - 29 * 864e5), 'America/Fortaleza', 'yyyy-MM-dd');
  const nomes = {}; const mapa = coordenacoes_();
  const us = {}; tabela_('Usuarios').linhas.forEach(function (u) { us[u.email] = u; });
  const cred = {}; tabela_('Credenciais').linhas.forEach(function (c) { cred[c.email] = c.definida_em; });
  const pessoas = tabela_('Pessoas').linhas.filter(function (p) { return p.ativo === 'SIM' && us[p.email] && (us[p.email].perfil === 'AGENTE' || us[p.email].perfil === 'GESTAO'); });
  pessoas.forEach(function (p) { nomes[p.email] = nomeCurto_(p.nome); });
  const logs = tabela_('Logs').linhas.filter(function (l) { return ACOES_SEGURANCA.indexOf(l.acao) >= 0; });
  const porPessoa = {};
  const hojeSet = {}, set7 = {}; let acessosHoje = 0, falhasHoje = 0;
  logs.forEach(function (l) {
    const dia = l.data_hora.slice(0, 10), em = l.afetado || l.ator;
    if (l.acao === 'LOGIN') {
      const pp = porPessoa[em] || (porPessoa[em] = { ultimo: '', n30: 0 });
      if (l.data_hora > pp.ultimo) pp.ultimo = l.data_hora;
      if (dia >= d30) pp.n30++;
      if (dia === hoje) { acessosHoje++; hojeSet[em] = 1; }
      if (dia >= d7) set7[em] = 1;
    }
    if (l.acao === 'LOGIN_FALHOU' && dia === hoje) falhasHoje++;
  });
  // quem entrou hoje já conectada (sem login) também conta, pelo registro do acesso do dia
  const ac = (typeof acHoje_ === 'function') ? acHoje_() : {};
  Object.keys(ac).forEach(function (em) { const iso = acIso_(ac[em].u); const pp = porPessoa[em] || (porPessoa[em] = { ultimo: '', n30: 0 }); if (iso > pp.ultimo) pp.ultimo = iso; hojeSet[em] = 1; set7[em] = 1; });
  // o sinal recente do painel (mesma fonte do cartão "Entraram hoje") também conta
  try { const prc = CacheService.getScriptCache().getAll(pessoas.map(function (p) { return 'pr_' + p.email; })), dh = acDia_(Date.now());
    pessoas.forEach(function (p) { let x = null; try { x = JSON.parse(prc['pr_' + p.email] || 'null'); } catch (e) { x = null; } if (!x || !x.ult || acDia_(x.ult) !== dh) return;
      const iso = acIso_(x.ult), pp = porPessoa[p.email] || (porPessoa[p.email] = { ultimo: '', n30: 0 }); if (iso > pp.ultimo) pp.ultimo = iso; hojeSet[p.email] = 1; set7[p.email] = 1; }); } catch (e) { /* sem sinal */ }
  // dias com acesso nos últimos 30 dias: dias com login + histórico diário de uso do painel (com ou sem login) + hoje
  const d30c = d30.split('-').join(''), diasAc = {}, marca = function (em, d) { (diasAc[em] || (diasAc[em] = {}))[d] = 1; };
  logs.forEach(function (l) { if (l.acao === 'LOGIN' && l.data_hora.slice(0, 10) >= d30) marca(l.afetado || l.ator, l.data_hora.slice(0, 10).split('-').join('')); });
  try { const todas = PropertiesService.getScriptProperties().getProperties();
    Object.keys(todas).forEach(function (k) { if (k.indexOf('ah_') !== 0) return; const em = k.slice(3); let h = null; try { h = JSON.parse(todas[k]); } catch (e) { return; }
      (h.d || []).forEach(function (d) { if (d >= d30c) marca(em, d); });
      if (h.u) { const iso = acIso_(h.u), pp = porPessoa[em] || (porPessoa[em] = { ultimo: '', n30: 0 }); if (iso > pp.ultimo) pp.ultimo = iso; } }); } catch (e) { /* sem histórico */ }
  Object.keys(hojeSet).forEach(function (em) { marca(em, hoje.split('-').join('')); });
  const lista = pessoas.map(function (p) {
    const pp = porPessoa[p.email] || {};
    return { email: p.email, nome: nomes[p.email], coord: coordDe_(p, mapa).nome, perfil: us[p.email].perfil, senhaEm: cred[p.email] || '', ultimo: pp.ultimo || '', n30: Object.keys(diasAc[p.email] || {}).length };
  }).sort(function (a, b) { return (b.ultimo || '').localeCompare(a.ultimo || '') || a.nome.localeCompare(b.nome, 'pt-BR'); });
  const de = dataIso_(filtro.de), ate = dataIso_(filtro.ate), q = normalizar_(filtro.texto || ''), tipo = String(filtro.tipo || '');
  const eventos = logs.filter(function (l) {
    const dia = l.data_hora.slice(0, 10), em = l.afetado || l.ator;
    if (de && dia < de) return false; if (ate && dia > ate) return false; if (tipo && l.acao !== tipo) return false;
    if (q && (em + ' ' + normalizar_(nomes[em] || '')).indexOf(q) < 0) return false;
    return true;
  }).reverse();
  return {
    resumo: { acessosHoje: acessosHoje, pessoasHoje: Object.keys(hojeSet).length, pessoas7: Object.keys(set7).length, falhasHoje: falhasHoje,
      comSenha: lista.filter(function (x) { return x.senhaEm; }).length, semSenha: lista.filter(function (x) { return !x.senhaEm; }).length, total: lista.length },
    pessoas: lista, totalEventos: eventos.length,
    eventos: eventos.slice(0, 300).map(function (l) { const em = l.afetado || l.ator; return { em: l.data_hora, email: em, nome: nomes[em] || '', acao: l.acao, resultado: l.resultado }; })
  };
}

/* ---------------------------------------------------------------------
 * CAPACIDADE DO BANCO (versão de teste: aparece na aba Acessos só com ?teste=banco)
 * --------------------------------------------------------------------- */
function apiCapacidadeBanco(token, forcar) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  const c = CacheService.getScriptCache(), k = 'cap_banco'; if (!forcar) { try { const x = c.get(k); if (x) return JSON.parse(x); } catch (e) { /* recalcula */ } }
  const ss = db_(), abas = []; let aloc = 0, dados = 0;
  ss.getSheets().forEach(function (sh) { const a = sh.getMaxRows() * sh.getMaxColumns(), d = sh.getLastRow() * sh.getLastColumn(); aloc += a; dados += d; abas.push({ nome: sh.getName(), celulas: a, linhas: Math.max(0, sh.getLastRow() - 1) }); });
  abas.sort(function (x, y) { return y.celulas - x.celulas; });
  let bytes = 0; const todas = PropertiesService.getScriptProperties().getProperties(); Object.keys(todas).forEach(function (n) { bytes += n.length + String(todas[n]).length; });
  const r = { celulas: aloc, comDados: dados, limite: 10000000, abas: abas.slice(0, 5), nAbas: abas.length, propsBytes: bytes, propsLimite: 512000,
    limpeza: PropertiesService.getScriptProperties().getProperty('LIMPEZA_MES') || '', em: agoraIso_() };
  try { c.put(k, JSON.stringify(r), 300); } catch (e) { /* sem cache */ }
  return r;
}

/* ---------------------------------------------------------------------
 * TESTES (editor)
 * --------------------------------------------------------------------- */
function testesExtras() {
  const r = []; const ok = function (n, c, d) { r.push((c ? 'OK   ' : 'FALHA') + ' | ' + n + (d ? ' | ' + d : '')); };
  ok('WFM: os superadmins da equipe de WFM', ['gerente.um@exemplo.com', 'wfm.um@exemplo.com', 'wfm.dois@exemplo.com', 'admin@exemplo.com'].every(ehSuperadmin_) && !ehSuperadmin_('gerente.dois@exemplo.com'));
  ok('Datas em semanas diferentes são recusadas', /mesma semana/.test(checarDatas_('2026-11-05', '2026-11-10', '2026-11-01')));
  ok('Mesma semana aceita', checarDatas_('2026-11-05', '2026-11-04', '2026-11-01') === '');
  ok('Datas passadas recusadas', /hoje/.test(checarDatas_('2026-11-05', '2026-11-04', '2026-11-06')));
  ok('Semana de 05/11/2026 começa em 01/11', semanaDe_('2026-11-05') === '2026-11-01');
  let erro = ''; try { apiAcessos('0'.repeat(64), {}); } catch (e) { erro = e.message; }
  ok('Acessos sem sessão é recusado', /SESSAO_INVALIDA/.test(erro));
  Logger.log(r.join('\n')); return r;
}
