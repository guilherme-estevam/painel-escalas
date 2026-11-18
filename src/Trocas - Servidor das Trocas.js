/**
 * Trocas.gs — trocas de escala entre agentes, reversão administrativa,
 * atualização do headcount pelo painel e feriados nacionais.
 */

/** Instalação do passo 5 (rodar uma vez): colunas novas e feriados nacionais de nov e dez/2026. */
function instalarPasso5() {
  migrarV3();
  const f = feriadosNacionais2026();
  Logger.log('Colunas ok; ' + f);
  return f;
}

const TROCA_PENDENTES = ['ABERTA', 'AGUARDANDO_COLEGA', 'AGUARDANDO_GESTAO'];
const TROCA_ROTULO = { ABERTA: 'Em aberto', EXPIRADA: 'Expirada', AGUARDANDO_COLEGA: 'Aguardando o colega', AGUARDANDO_GESTAO: 'Aguardando a coordenação', APROVADA: 'Aprovada', RECUSADA_COLEGA: 'Recusada pelo colega', REJEITADA: 'Recusada pela coordenação', CANCELADA_AUTO: 'Cancelada: outra troca do dia foi aprovada', CANCELADA: 'Cancelada', BLOQUEADA: 'Bloqueada por regra', INVALIDADA: 'Invalidada na aprovação' };

/** Garante colunas extras nas abas (roda uma vez; não apaga nada). */
function migrarV3() {
  garantirColunas_('Trocas', ['mes', 'obs_resposta', 'obs_decisao', 'atualizado_em']);
  return 'ok';
}
function garantirColunas_(aba, cols) {
  const sh = db_().getSheetByName(aba);
  const cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const faltam = cols.filter(function (c) { return cab.indexOf(c) < 0; });
  if (faltam.length) garantirEspacoColunas_(sh, cab.length + faltam.length);
  if (faltam.length) sh.getRange(1, cab.length + 1, 1, faltam.length).setValues([faltam]).setFontWeight('bold').setBackground('#262626').setFontColor('#ffffff');
}

/** Cadastra os feriados nacionais de nov e dez/2026 (rodar uma vez pelo editor). */
function feriadosNacionais2026() {
  const lista = [['2026-11-02', 'Finados'], ['2026-11-15', 'Proclamação da República'], ['2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'], ['2026-12-25', 'Natal']];
  const t = tabela_('Feriados'); const ator = Session.getActiveUser().getEmail() || 'editor'; const novos = [];
  lista.forEach(function (f) {
    if (t.linhas.some(function (x) { return x.data === f[0] && x.ativo === 'SIM'; })) return;
    const id = novoId_('fer');
    novos.push({ feriado_id: id, data: f[0], nome: f[1], categoria: 'Nacional', ativo: 'SIM', criado_em: agoraIso_(), criado_por: ator });
  });
  appendLinhas_('Feriados', novos);
  logLote_(novos.map(function (n) { return { ator: ator, acao: 'FERIADO_CRIADO', tipo: 'Feriado', registro: n.feriado_id, depois: { data: n.data, nome: n.nome, categoria: 'Nacional' } }; }));
  return novos.length + ' feriado(s) cadastrado(s)';
}

/* ---------------------------------------------------------------------
 * HELPERS
 * --------------------------------------------------------------------- */
function hojeIso_() { return Utilities.formatDate(new Date(), 'America/Fortaleza', 'yyyy-MM-dd'); }
/* Link do botão dos e-mails: sempre o /exec do painel. Rodando no editor, o Google devolve o link /dev (só abre para quem edita o código). */
var URLS_PAINEL_ = {
  'ID_DO_SCRIPT': 'https://script.google.com/macros/s/ID_DA_IMPLANTACAO/exec'
};
function urlApp_() {
  let u = ''; try { u = ScriptApp.getService().getUrl() || ''; } catch (e) { u = ''; }
  if (u && !/\/dev(\?|$)/.test(u)) return u;
  let id = ''; try { id = ScriptApp.getScriptId(); } catch (e) { }
  return URLS_PAINEL_[id] || u;
}
function enviarEmail_(para, assunto, texto) {
  if (typeof EMAIL_FEITO_ !== 'undefined' && EMAIL_FEITO_[para]) return true; // já recebeu o e-mail detalhado desta troca
  try {
    MailApp.sendEmail({ to: para, name: CFG.APP_NOME, subject: assunto,
      htmlBody: emailLayout_('<h1 style="font-size:20px;line-height:1.3;margin:0 0 12px;color:#1E1A24">' + escHtml_(assunto) + '</h1><p style="margin:0">' + texto + '</p>' + (urlApp_() ? emailBotao_('Abrir o painel de escalas', urlApp_()) : '')) });
    return true;
  } catch (e) { return false; }
}
function dBr_(s) { const p = s.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
function trocaObj_(l, nomes) {
  return { id: l.troca_id, mes: l.mes || l.data_solicitante.slice(0, 7), solicitante: l.solicitante, colega: l.colega,
    nomeSolicitante: nomes[l.solicitante] || l.solicitante, nomeColega: nomes[l.colega] || l.colega,
    dataSolicitante: l.data_solicitante, dataColega: l.data_colega, status: l.status, rotulo: (l.status === 'RECUSADA_COLEGA' && !l.colega) ? 'Recusada por todos' : (TROCA_ROTULO[l.status] || l.status),
    motivo: l.motivo, criadaEm: l.criada_em, aceiteEm: l.aceite_em, decisaoPor: l.decisao_por, decisaoEm: l.decisao_em,
    obsResposta: l.obs_resposta, obsDecisao: l.obs_decisao, validacao: l.resultado_validacao, efetivadaEm: l.efetivada_em, horario: l.data_solicitante === l.data_colega, horarioAlvo: l.horario_alvo || '', acomp: acompTroca_(l, nomes) };
}
function trocarPos_(a, b, i) { return [a.slice(0, i) + b.charAt(i) + a.slice(i + 1), b.slice(0, i) + a.charAt(i) + b.slice(i + 1)]; }

/**
 * Calcula a prévia da troca sobre a escala PUBLICADA.
 * Troca = os dois trocam a situação (trabalho/folga) nas duas datas escolhidas.
 */
function previaTroca_(emailA, emailB, dA, dB, ignorarTrocaId) {
  const motivos = [];
  dA = dataIso_(dA); dB = dataIso_(dB);
  if (!dA || !dB) return { ok: false, motivos: ['Escolha as duas datas.'] };
  if (dA === dB) return { ok: false, motivos: [MSG_SEM_TROCA_HORARIO] }; // troca de horário desativada (Escala22)
  const mes = dA.slice(0, 7);
  if (dB.slice(0, 7) !== mes) return { ok: false, motivos: ['As duas datas precisam ser do mesmo mês.'] };
  if (emailA === emailB) return { ok: false, motivos: ['Não é possível trocar consigo mesmo.'] };
  const pessoas = {}; pessoasEscala_().forEach(function (p) { pessoas[p.email] = p; });
  const A = pessoas[emailA], B = pessoas[emailB];
  if (!A || !B) return { ok: false, motivos: ['As duas pessoas precisam ter acesso ao painel.'] };
  if (A.perfil !== B.perfil) return { ok: false, motivos: ['As trocas são entre pessoas do mesmo perfil: agentes com agentes, gestão com gestão.'] };
  if (A.perfil === 'AGENTE' && !mesmaAtuacao_(emailA, emailB, mes)) return { ok: false, motivos: ['As trocas são entre agentes com a mesma atuação. ' + A.nome + ' atua em ' + nomeAtuacao_(grupoAtuacao_(emailA, mes)) + ' e ' + B.nome + ' em ' + nomeAtuacao_(grupoAtuacao_(emailB, mes)) + '.'] };
  if (!mesmoHorarioCadastro_(A, B, mes)) return { ok: false, motivos: ['As trocas são entre pessoas com o mesmo horário. ' + A.nome + ' trabalha das ' + txtHorarioCad_(A, mes) + ' e ' + B.nome + ' das ' + txtHorarioCad_(B, mes) + '.'] };
  const hdA = horarioDia_(emailA, dA), hdB = horarioDia_(emailB, dB), dm = function (d) { return d.slice(8) + '/' + d.slice(5, 7); };
  if (hdA && hdB && (hdA.i !== hdB.i || hdA.f !== hdB.f)) return { ok: false, motivos: ['As trocas são entre dias do mesmo horário. Em ' + dm(dA) + ' ' + A.nome + ' trabalha das ' + hdA.i + ' às ' + hdA.f + ' e em ' + dm(dB) + ' ' + B.nome + ' trabalha das ' + hdB.i + ' às ' + hdB.f + '.'] }; // cada um assume o turno do outro: precisa ser o mesmo horário
  const hoje = hojeIso_();
  if (dA < hoje || dB < hoje) motivos.push('Só é possível trocar datas de hoje em diante.');
  const t = tabela_('Escalas'); const ant = mesDelta_(mes, -1), prox = mesDelta_(mes, 1);
  const pub = {}; t.linhas.forEach(function (l) { pub[l.mes + '|' + l.email] = l.dias_publicados; });
  const eA = pub[mes + '|' + emailA], eB = pub[mes + '|' + emailB];
  if (!eA || !eB) return { ok: false, motivos: ['As duas pessoas precisam ter a escala de ' + mesBr_(mes) + ' publicada.'] };
  const fx = faixaMes_(mes); const fo = feriadosOffLista_();
  const af = {}; afastamentosEntre_(fx.ini, fx.fim).forEach(function (a) { (af[a.email] = af[a.email] || []).push(a); });
  const emAfast = function (email, d) { return (af[email] || []).some(function (a) { return d >= a.inicio && d <= a.fim; }); };
  [[A, dA], [A, dB], [B, dA], [B, dB]].forEach(function (x) { if (emAfast(x[0].email, x[1])) motivos.push(x[0].nome + ' está de férias ou licença em ' + dBr_(x[1]) + '.'); });
  const iA = +dA.slice(8) - 1, iB = +dB.slice(8) - 1;
  if (iA !== iB && (eA.charAt(iA) !== 'T' || eB.charAt(iA) !== 'F' || eA.charAt(iB) !== 'F' || eB.charAt(iB) !== 'T')) // troca é um dia por outro: cada um assume o dia do outro
    return { ok: false, motivos: ['Para trocar, em ' + dBr_(dA).slice(0, 5) + ' ' + A.nome + ' trabalha e ' + B.nome + ' está de folga, e em ' + dBr_(dB).slice(0, 5) + ' é o contrário. Nessas datas isso não acontece.'] };
  let nA = eA, nB = eB, r;
  r = trocarPos_(nA, nB, iA); nA = r[0]; nB = r[1];
  if (iB !== iA) { r = trocarPos_(nA, nB, iB); nA = r[0]; nB = r[1]; }
  if (nA === eA) motivos.push('Nessas datas os dois já estão na mesma situação. A troca não mudaria nada.');
  // conflito com outras trocas pendentes
  tabela_('Trocas').linhas.forEach(function (l) {
    if (l.status !== 'AGUARDANDO_GESTAO' || l.troca_id === ignorarTrocaId) return; // só troca já aceita prende o dia; pedidos sem resposta não bloqueiam (v60)
    const env = [l.solicitante, l.colega], ds = [l.data_solicitante, l.data_colega];
    if ((env.indexOf(emailA) >= 0 || env.indexOf(emailB) >= 0) && (ds.indexOf(dA) >= 0 || ds.indexOf(dB) >= 0))
      motivos.push('Já existe uma troca aceita, aguardando a coordenação, envolvendo ' + (env.indexOf(emailA) >= 0 ? A.nome : B.nome) + ' nessas datas.');
  });
  const montar = function (p, antes, depois) {
    const vAntes = validarEscala_({ mes: mes, dias: antes, ant: pub[ant + '|' + p.email] || '', prox: pub[prox + '|' + p.email] || '', afast: af[p.email] || [], segSex: p.segSex, ferOff: fo });
    const vDep = validarEscala_({ mes: mes, dias: depois, ant: pub[ant + '|' + p.email] || '', prox: pub[prox + '|' + p.email] || '', afast: af[p.email] || [], segSex: p.segSex, ferOff: fo });
    // semanas afetadas (dom-sáb) com as datas da troca
    const semanas = [];
    [dA, dB].forEach(function (d) {
      const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - x.getUTCDay());
      const ini = Utilities.formatDate(x, 'UTC', 'yyyy-MM-dd');
      if (semanas.some(function (s) { return s.inicio === ini; })) return;
      const dias = [];
      for (let k = 0; k < 7; k++) {
        const y = new Date(x.getTime()); y.setUTCDate(y.getUTCDate() + k); const iy = Utilities.formatDate(y, 'UTC', 'yyyy-MM-dd');
        const dentro = iy.slice(0, 7) === mes; const idx = +iy.slice(8) - 1;
        const src = function (s, m) { return m === mes ? s.charAt(idx) : ((m === ant ? pub[ant + '|' + p.email] : pub[prox + '|' + p.email]) || '').charAt(+iy.slice(8) - 1) || '.'; };
        dias.push({ data: iy, antes: dentro ? antes.charAt(idx) : src('', iy.slice(0, 7)), depois: dentro ? depois.charAt(idx) : src('', iy.slice(0, 7)), afast: emAfast(p.email, iy), troca: iy === dA || iy === dB });
      }
      semanas.push({ inicio: ini, dias: dias });
    });
    return { email: p.email, nome: p.nome, segSex: p.segSex, domAntes: vAntes.resumo.domingosFolga, domDepois: vDep.resumo.domingosFolga, domTrabAntes: vAntes.resumo.domingosTrab, domTrabDepois: vDep.resumo.domingosTrab,
      trabAntes: vAntes.resumo.trabalho, trabDepois: vDep.resumo.trabalho, erros: vDep.erros.map(function (e) { return e.msg; }), avisos: vDep.avisos.concat(vDep.pendencias).map(function (e) { return e.msg; }), semanas: semanas, novo: depois };
  };
  const pA = montar(A, eA, nA), pB = montar(B, eB, nB);
  pA.erros.forEach(function (m) { motivos.push(A.nome + ': ' + m); });
  pB.erros.forEach(function (m) { motivos.push(B.nome + ': ' + m); });
  return { ok: motivos.length === 0, motivos: motivos, mes: mes, dataA: dA, dataB: dB, pessoas: [pA, pB] };
}
function limparPrevia_(p) { (p.pessoas || []).forEach(function (x) { delete x.novo; }); return p; }

/* ---------------------------------------------------------------------
 * API — TROCAS
 * --------------------------------------------------------------------- */
/** Colegas disponíveis para troca e dias publicados do próprio agente. */
function apiTrocaOpcoes(token, mes) {
  const ctx = sessao_(token); mesValido_(mes);
  if (ctx.perfil !== 'AGENTE') return { colegas: [] };
  const pub = {}; tabela_('Escalas').linhas.forEach(function (l) { if (l.mes === mes && l.dias_publicados) pub[l.email] = true; });
  const colegas = pessoasEscala_().filter(function (p) { return p.perfil === 'AGENTE' && p.email !== ctx.email && pub[p.email]; })
    .map(function (p) { return { email: p.email, nome: p.nome, coord: p.coord }; });
  return { colegas: colegas, publicada: !!pub[ctx.email], hoje: hojeIso_() };
}
function apiTrocaPrevia(token, colega, dataMinha, dataColega) {
  const ctx = sessao_(token);
  return limparPrevia_(previaTroca_(ctx.email, normalizar_(colega), dataMinha, dataColega, null));
}
function apiTrocaSolicitar(token, colega, dataMinha, dataColega, motivo) {
  const ctx = sessao_(token);
  colega = normalizar_(colega);
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    const bq = bloqueioEnvio_(null, ctx.email, [dataIso_(dataMinha), dataIso_(dataColega)]); if (bq) return { ok: false, motivos: [bq] };
    const pv = previaTroca_(ctx.email, colega, dataMinha, dataColega, null);
    const id = novoId_('tr'); const agora = agoraIso_();
    const linha = { troca_id: id, mes: (pv.mes || String(dataMinha).slice(0, 7)), solicitante: ctx.email, colega: colega, data_solicitante: dataIso_(dataMinha), data_colega: dataIso_(dataColega), motivo: String(motivo || '').slice(0, 200), criada_em: agora, atualizado_em: agora };
    if (!pv.ok) {
      if (pv.pessoas) { // pedido bem formado, mas viola regra: registra a tentativa e avisa a gestão
        linha.status = 'BLOQUEADA'; linha.resultado_validacao = pv.motivos.join(' | ');
        appendLinhas_('Trocas', [linha]);
        log_(ctx.email, 'TROCA_BLOQUEADA', 'Troca', id, colega, null, { datas: [linha.data_solicitante, linha.data_colega] }, '', '', 'BLOQUEADO');
        notificar_([{ dest: 'GESTAO', tipo: 'ALERTA_REGRA', titulo: 'Troca bloqueada por regra', msg: nomeCurto_(ctx.pessoa.nome) + ' tentou uma troca inválida: ' + pv.motivos[0], ref: id }]);
      }
      return { ok: false, motivos: pv.motivos };
    }
    linha.status = 'AGUARDANDO_COLEGA'; linha.resultado_validacao = 'OK na solicitação';
    appendLinhas_('Trocas', [linha]);
    const nomeA = nomeCurto_(ctx.pessoa.nome);
    log_(ctx.email, 'TROCA_SOLICITADA', 'Troca', id, colega, null, { solicitante: ctx.email, colega: colega, datas: [linha.data_solicitante, linha.data_colega] }, linha.motivo, id);
    notificar_([{ dest: colega, tipo: 'TROCA_RECEBIDA', titulo: 'Pedido de troca', msg: nomeA + ' propôs uma troca de escala (' + dBr_(linha.data_solicitante) + ' e ' + dBr_(linha.data_colega) + '). Se aceitar, você trabalha em ' + dBr_(linha.data_solicitante) + ' ' + horarioFrentesTxt_(linha.solicitante, linha.data_solicitante) + ' e folga em ' + dBr_(linha.data_colega) + '. Aceite ou recuse em Minha escala.', ref: id }]);
    enviarEmail_(colega, 'Pedido de troca de escala', nomeA + ' propôs uma troca de escala envolvendo os dias ' + dBr_(linha.data_solicitante) + ' e ' + dBr_(linha.data_colega) + '. Abra o painel para ver a prévia e aceitar ou recusar.');
    return { ok: true, id: id };
  } finally { lock.releaseLock(); }
}
function apiTrocasBase_(token, filtro) {
  const ctx = sessao_(token);
  const nomes = {}; pessoasEscala_().forEach(function (p) { nomes[p.email] = p.nome; });
  let linhas = tabela_('Trocas').linhas;
  if (ctx.perfil !== 'GESTAO' || !filtro) linhas = linhas.filter(function (l) { return l.solicitante === ctx.email || l.colega === ctx.email; });
  else if (filtro && filtro.status) linhas = linhas.filter(function (l) { return filtro.status === 'PENDENTES' ? TROCA_PENDENTES.indexOf(l.status) >= 0 : l.status === filtro.status; });
  // gestão: todos veem todas as trocas; aprovar ou rejeitar é só com o coordenador de uma das duas pessoas ou com o WFM
  const lista = ctx.perfil === 'GESTAO' && !!filtro, rt = lista ? (RT_LEITURA_ || responsaveisTime_()) : null, todas = ehSuperadmin_(ctx.email) || ehGerenteTrocas_(ctx.email);
  const coordena = lista && !todas && Object.keys(rt).some(function (e) { return rt[e].resp === ctx.email; });
  const cont = {}; if (ctx.perfil === 'GESTAO') tabela_('Trocas').linhas.forEach(function (l) { cont[l.status] = (cont[l.status] || 0) + 1; });
  return { eu: ctx.email, contagem: cont, escopo: lista ? (todas ? 'todas' : coordena ? 'time' : 'ver') : '', itens: linhas.slice().reverse().slice(0, 200).map(function (l) {
    const o = trocaObj_(l, nomes);
    if (lista) { o.podeDecidir = podeDecidirTroca_(ctx.email, l, rt); o.aprovadores = txtAprovadores_(l, rt, nomes); o.faltamOutros = o.podeDecidir ? faltamOutros_(ctx.email, l, rt, nomes) : []; }
    return o; }) };
}
/** Prévia de uma troca já registrada (colega antes de aceitar; gestão antes de decidir). */
function apiTrocaPreviaPorId(token, id) {
  const ctx = sessao_(token);
  const l = tabela_('Trocas').linhas.filter(function (x) { return x.troca_id === id; })[0];
  if (!l) return { ok: false, motivos: ['Troca não encontrada.'] };
  if (ctx.perfil !== 'GESTAO' && l.colega !== ctx.email && l.solicitante !== ctx.email) throw new Error('SEM_PERMISSAO');
  return limparPrevia_(previaTroca_(l.solicitante, l.colega, l.data_solicitante, l.data_colega, l.troca_id));
}
function apiTrocaResponder(token, id, aceitar, obs) {
  const ctx = sessao_(token);
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    const t = tabela_('Trocas'); const l = t.linhas.filter(function (x) { return x.troca_id === id; })[0];
    if (!l || l.colega !== ctx.email) throw new Error('SEM_PERMISSAO');
    if (l.status !== 'AGUARDANDO_COLEGA') return { ok: false, msg: 'Esta troca já foi respondida (' + (TROCA_ROTULO[l.status] || l.status) + ').' };
    if (aceitar) { const prazo = prazoAceite_(l.solicitante, l.colega, l.data_solicitante, l.data_colega); if (prazo) return { ok: false, msg: prazo }; const bqA = bloqueioAceite_(ctx.email, l); if (bqA) return { ok: false, msg: bqA }; }
    const agora = agoraIso_(); const nomeB = nomeCurto_(ctx.pessoa.nome);
    if (!aceitar) {
      atualizarLinha_(t, l, { status: 'RECUSADA_COLEGA', aceite_em: agora, obs_resposta: String(obs || '').slice(0, 200), atualizado_em: agora });
      log_(ctx.email, 'TROCA_RECUSADA', 'Troca', id, l.solicitante, { status: 'AGUARDANDO_COLEGA' }, { status: 'RECUSADA_COLEGA' }, obs, id);
      notificar_([{ dest: l.solicitante, tipo: 'TROCA_RECUSADA', titulo: 'Troca recusada', msg: nomeB + ' recusou a troca de ' + datasTroca_(l) + '.', ref: id }]);
      enviarEmail_(l.solicitante, 'Troca de escala recusada', nomeB + ' recusou a troca de escala de ' + datasTroca_(l) + '.');
      return { ok: true, status: 'RECUSADA_COLEGA' };
    }
    const pv = previaTroca_(l.solicitante, l.colega, l.data_solicitante, l.data_colega, l.troca_id);
    if (!pv.ok) {
      atualizarLinha_(t, l, { status: 'INVALIDADA', aceite_em: agora, resultado_validacao: pv.motivos.join(' | '), atualizado_em: agora });
      log_(ctx.email, 'TROCA_INVALIDADA', 'Troca', id, l.solicitante, null, { motivos: pv.motivos }, '', id, 'BLOQUEADO');
      notificar_([{ dest: l.solicitante, tipo: 'TROCA_INVALIDADA', titulo: 'Troca não pôde seguir', msg: 'A escala mudou e a troca deixou de ser válida: ' + pv.motivos[0], ref: id }, { dest: 'GESTAO', tipo: 'ALERTA_REGRA', titulo: 'Troca invalidada no aceite', msg: pv.motivos[0], ref: id }]);
      return { ok: false, msg: 'A troca deixou de ser válida: ' + pv.motivos.join(' ') };
    }
    atualizarLinha_(t, l, { status: 'AGUARDANDO_GESTAO', aceite_em: agora, obs_resposta: String(obs || '').slice(0, 200), resultado_validacao: 'OK no aceite', atualizado_em: agora });
    log_(ctx.email, 'TROCA_ACEITA', 'Troca', id, l.solicitante, { status: 'AGUARDANDO_COLEGA' }, { status: 'AGUARDANDO_GESTAO' }, obs, id);
    notificar_([{ dest: l.solicitante, tipo: 'TROCA_ACEITA', titulo: 'Troca aceita pelo colega', msg: nomeB + ' aceitou. Agora falta a aprovação da coordenação.', ref: id },
      { dest: 'GESTAO', tipo: 'TROCA_APROVACAO', titulo: 'Troca aguardando aprovação', msg: nomeCurto_(pv.pessoas[0].nome) + ' e ' + nomeB + ' (' + datasTroca_(l) + ').', ref: id }]);
    return { ok: true, status: 'AGUARDANDO_GESTAO' };
  } finally { lock.releaseLock(); }
}
function apiTrocaCancelar(token, id) {
  const ctx = sessao_(token);
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    const t = tabela_('Trocas'); const l = t.linhas.filter(function (x) { return x.troca_id === id; })[0];
    if (!l || l.solicitante !== ctx.email) throw new Error('SEM_PERMISSAO');
    if (TROCA_PENDENTES.indexOf(l.status) < 0) return { ok: false, msg: 'Só é possível cancelar trocas pendentes.' };
    const antes = l.status; atualizarLinha_(t, l, { status: 'CANCELADA', atualizado_em: agoraIso_() });
    log_(ctx.email, 'TROCA_CANCELADA', 'Troca', id, l.colega, { status: antes }, { status: 'CANCELADA' }, '', id);
    notificar_([{ dest: l.colega, tipo: 'TROCA_CANCELADA', titulo: 'Troca cancelada', msg: 'O pedido de troca de ' + datasTroca_(l) + ' foi cancelado por quem pediu.', ref: id }]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function apiTrocaDecidir(token, id, aprovar, obs) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    garantirColunaAprovacoes_();
    const t = tabela_('Trocas'); const l = t.linhas.filter(function (x) { return x.troca_id === id; })[0];
    if (!l) return { ok: false, msg: 'Troca não encontrada.' };
    if (l.status !== 'AGUARDANDO_GESTAO') return { ok: false, msg: 'Esta troca não está aguardando aprovação (situação: ' + (TROCA_ROTULO[l.status] || l.status) + '). Nenhuma alteração foi feita.' };
    if (l.solicitante === ctx.email || l.colega === ctx.email) return { ok: false, msg: 'Você participa desta troca. Outra pessoa da coordenação, da gerência ou do WFM precisa aprovar ou recusar.' };
    if (!podeDecidirTroca_(ctx.email, l)) return { ok: false, msg: (aprovacoesDe_(l)[ctx.email] ? 'Você já aprovou esta troca. ' : 'Você não aprova esta troca. ') + txtAprovadores_(l) };
    const agora = agoraIso_(); const datas = datasTroca_(l); const nomeG = nomeCurto_(ctx.pessoa.nome);
    if (!aprovar) {
      atualizarLinha_(t, l, { status: 'REJEITADA', decisao_por: ctx.email, decisao_em: agora, obs_decisao: String(obs || '').slice(0, 200), atualizado_em: agora });
      log_(ctx.email, 'TROCA_REJEITADA', 'Troca', id, l.solicitante + ',' + l.colega, { status: 'AGUARDANDO_GESTAO' }, { status: 'REJEITADA' }, obs, id);
      notificar_([l.solicitante, l.colega].map(function (d) { return { dest: d, tipo: 'TROCA_REJEITADA', titulo: 'Troca recusada pela coordenação', msg: nomeG + ' rejeitou a troca de ' + datas + (obs ? ': ' + obs : '.'), ref: id }; }));
      [l.solicitante, l.colega].forEach(function (d) { enviarEmail_(d, 'Troca de escala recusada pela coordenação', nomeG + ' rejeitou a troca de escala de ' + datas + (obs ? '. Motivo: ' + obs : '.')); });
      avisarAprovacaoEncerrada_(l, ctx, false, obs);
      return { ok: true, status: 'REJEITADA' };
    }
    if (Date.now() > prazoGestaoMs_(l)) return { ok: false, msg: 'O prazo para aprovar terminou. A coordenação precisa decidir até ' + TROCA_PRAZO_GESTAO_H + ' horas antes do primeiro turno da troca (' + quandoTxt_(prazoGestaoMs_(l)) + ').' };
    const fase = registrarAprovacao_(t, l, ctx);
    if (fase.pendente) return { ok: true, status: 'AGUARDANDO_GESTAO', parcial: true, faltam: fase.faltamNomes, msg: 'Sua aprovação foi registrada. Falta a aprovação de ' + fase.faltamNomes.join(' e ') + '.' };
    const pv = previaTroca_(l.solicitante, l.colega, l.data_solicitante, l.data_colega, l.troca_id);
    if (!pv.ok) {
      atualizarLinha_(t, l, { status: 'INVALIDADA', decisao_por: ctx.email, decisao_em: agora, resultado_validacao: pv.motivos.join(' | '), atualizado_em: agora });
      log_(ctx.email, 'TROCA_INVALIDADA', 'Troca', id, l.solicitante + ',' + l.colega, null, { motivos: pv.motivos }, '', id, 'BLOQUEADO');
      notificar_([l.solicitante, l.colega].map(function (d) { return { dest: d, tipo: 'TROCA_INVALIDADA', titulo: 'Troca não efetivada', msg: 'A escala mudou e a troca de ' + datas + ' deixou de ser válida.', ref: id }; }));
      return { ok: false, msg: 'A troca não foi efetivada porque deixou de ser válida: ' + pv.motivos.join(' ') };
    }
    // efetiva nas duas escalas (rascunho e publicada), na mesma gravação
    const te = tabela_('Escalas'); const mes = pv.mes; const logs = [];
    const iA = +l.data_solicitante.slice(8) - 1, iB = +l.data_colega.slice(8) - 1;
    const rA = te.linhas.filter(function (x) { return x.mes === mes && x.email === l.solicitante; })[0];
    const rB = te.linhas.filter(function (x) { return x.mes === mes && x.email === l.colega; })[0];
    ['dias', 'dias_publicados'].forEach(function (campo) {
      let a = rA[campo], b = rB[campo], r;
      if (!a || !b) return;
      r = trocarPos_(a, b, iA); a = r[0]; b = r[1];
      if (iB !== iA) { r = trocarPos_(a, b, iB); a = r[0]; b = r[1]; }
      if (campo === 'dias') { logs.push({ ator: ctx.email, acao: 'TROCA_EFETIVADA', tipo: 'Escala', registro: rA.escala_id, afetado: rA.email, antes: { dias: rA.dias, dias_publicados: rA.dias_publicados }, motivo: 'Troca ' + id, op: id }); logs.push({ ator: ctx.email, acao: 'TROCA_EFETIVADA', tipo: 'Escala', registro: rB.escala_id, afetado: rB.email, antes: { dias: rB.dias, dias_publicados: rB.dias_publicados }, motivo: 'Troca ' + id, op: id }); }
      rA[campo] = a; rB[campo] = b;
    });
    [rA, rB].forEach(function (r) { r.versao = String(Number(r.versao) + 1); r.atualizado_em = agora; r.atualizado_por = ctx.email; r.status = r.dias === r.dias_publicados ? 'PUBLICADA' : 'ALTERADA'; });
    logs[0].depois = { dias: rA.dias, dias_publicados: rA.dias_publicados }; logs[1].depois = { dias: rB.dias, dias_publicados: rB.dias_publicados };
    try { // os horários acompanham a troca: quem assume o dia fica com o horário planejado de quem saiu (do dia ou, se não houver, do cadastro)
      const base = {}; pessoasEscala_().forEach(function (p) { base[p.email] = p; });
      const kA = String(+l.data_solicitante.slice(8)), kB = String(+l.data_colega.slice(8));
      ['atuacao', 'atuacao_publicada'].forEach(function (campo) {
        let ja = rA[campo] ? JSON.parse(rA[campo]) : null, jb = rB[campo] ? JSON.parse(rB[campo]) : null;
        const pa = base[l.solicitante], pb = base[l.colega];
        if (!ja && !jb && (!pa || !pb || (pa.entrada === pb.entrada && pa.saida === pb.saida))) return;
        if (!ja) ja = { g: jb ? jb.g : '', m: jb ? jb.m : [0, 0, 0], d: {} }; if (!jb) jb = { g: ja.g, m: ja.m, d: {} };
        ja.d = ja.d || {}; jb.d = jb.d || {};
        const hA = ja.d[kA] || (pa ? [pa.entrada, '', pa.saida] : null), hB = jb.d[kB] || (pb ? [pb.entrada, '', pb.saida] : null);
        if (kA === kB) { delete ja.d[kA]; delete jb.d[kA]; if (hB) ja.d[kA] = hB; if (hA) jb.d[kA] = hA; } // troca de horário no mesmo dia
        else { delete ja.d[kA]; if (hA) jb.d[kA] = hA; delete jb.d[kB]; if (hB) ja.d[kB] = hB; }
        rA[campo] = JSON.stringify(ja); rB[campo] = JSON.stringify(jb);
      });
    } catch (e) { /* sem horários detalhados */ }
    const vals = te.linhas.map(function (x) { return te.cab.map(function (c) { return x[c] === undefined ? '' : String(x[c]); }); });
    te.sh.getRange(2, 1, vals.length, te.cab.length).setValues(celTexto_(vals));
    atualizarLinha_(t, l, { status: 'APROVADA', decisao_por: ctx.email, decisao_em: agora, efetivada_em: agora, obs_decisao: String(obs || '').slice(0, 200), resultado_validacao: 'OK na aprovação', atualizado_em: agora });
    logs.push({ ator: ctx.email, acao: 'TROCA_APROVADA', tipo: 'Troca', registro: id, afetado: l.solicitante + ',' + l.colega, antes: { status: 'AGUARDANDO_GESTAO' }, depois: { status: 'APROVADA', aprovador: ctx.email, aprovada_em: agora }, motivo: obs, op: id });
    logLote_(logs);
    notificar_([l.solicitante, l.colega].map(function (d) { return { dest: d, tipo: 'TROCA_APROVADA', titulo: 'Troca aprovada', msg: 'A troca de ' + datas + ' foi aprovada por ' + nomeG + ' e já está na sua escala.', ref: id }; }));
    [l.solicitante, l.colega].forEach(function (d) { enviarEmail_(d, 'Troca de escala aprovada', 'A troca de escala de ' + datas + ' foi aprovada por ' + nomeG + ' e já está na sua escala publicada.'); });
    avisarAprovacaoEncerrada_(l, ctx, true, obs);
    try { cancelarConcorrentes_(l, ctx); } catch (e) { /* não impede a aprovação */ }
    return { ok: true, status: 'APROVADA' };
  } finally { lock.releaseLock(); }
}

/* ---------------------------------------------------------------------
 * API — REVERSÃO ADMINISTRATIVA (restaura o estado anterior como rascunho)
 * --------------------------------------------------------------------- */
/* 09/11/2026: o botão Reverter do Histórico foi desligado de vez. Nenhum registro pode ser revertido. */
const ACOES_REVERSIVEIS = [];
function alvoReversao_(logId) {
  const lg = tabela_('Logs').linhas.filter(function (l) { return l.log_id === logId; })[0];
  if (!lg || ACOES_REVERSIVEIS.indexOf(lg.acao) < 0 || lg.resultado !== 'OK') return { erro: 'Este registro não pode ser revertido.' };
  const esc = tabela_('Escalas').linhas.filter(function (e) { return e.escala_id === lg.registro; })[0];
  if (!esc) return { erro: 'A escala desse registro não foi encontrada.' };
  const antes = lg.antes ? JSON.parse(lg.antes) : null; const depois = lg.depois ? JSON.parse(lg.depois) : {};
  const restaurar = antes && antes.dias ? antes.dias : '.'.repeat(diasNoMes_(esc.mes));
  return { log: lg, esc: esc, restaurar: restaurar, depoisDaOperacao: depois.dias || '' };
}
function apiReversaoPrevia(token, logId) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  const a = alvoReversao_(logId); if (a.erro) return { ok: false, msg: a.erro };
  const p = pessoasEscala_().filter(function (x) { return x.email === a.esc.email; })[0];
  const fx = faixaMes_(a.esc.mes); const ant = mesDelta_(a.esc.mes, -1), prox = mesDelta_(a.esc.mes, 1);
  const viz = {}; tabela_('Escalas').linhas.forEach(function (l) { if (l.email === a.esc.email) viz[l.mes] = l.dias; });
  const v = validarEscala_({ mes: a.esc.mes, dias: a.restaurar, ant: viz[ant] || '', prox: viz[prox] || '', afast: afastamentosEntre_(fx.ini, fx.fim).filter(function (x) { return x.email === a.esc.email; }), segSex: p ? p.segSex : false });
  const dif = []; for (let i = 0; i < a.restaurar.length; i++) if (a.restaurar.charAt(i) !== a.esc.dias.charAt(i)) dif.push({ dia: i + 1, atual: a.esc.dias.charAt(i), restaurado: a.restaurar.charAt(i) });
  return { ok: v.ok && dif.length > 0, mes: a.esc.mes, email: a.esc.email, nome: p ? p.nome : a.esc.email, operacao: a.log.acao, operacaoEm: a.log.data_hora, operacaoPor: a.log.ator,
    mudouDepois: a.depoisDaOperacao && a.depoisDaOperacao !== a.esc.dias, atual: a.esc.dias, restaurar: a.restaurar, diferencas: dif, erros: v.erros.map(function (e) { return e.msg; }), status: a.esc.status };
}
function apiReverter(token, logId, motivo) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  if (!String(motivo || '').trim()) return { ok: false, msg: 'Informe o motivo da reversão.' };
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    const pv = apiReversaoPrevia(token, logId);
    if (!pv.ok) return { ok: false, msg: pv.msg || (pv.diferencas && !pv.diferencas.length ? 'A escala já está igual ao estado anterior.' : 'A reversão deixaria a escala com regra violada: ' + pv.erros.join(' ')) };
    const t = tabela_('Escalas'); const l = t.linhas.filter(function (e) { return e.mes === pv.mes && e.email === pv.email; })[0];
    const antes = { dias: l.dias, status: l.status };
    const status = l.dias_publicados ? (pv.restaurar === l.dias_publicados ? 'PUBLICADA' : 'ALTERADA') : 'RASCUNHO';
    atualizarLinha_(t, l, { dias: pv.restaurar, status: status, versao: String(Number(l.versao) + 1), atualizado_em: agoraIso_(), atualizado_por: ctx.email });
    log_(ctx.email, 'REVERSAO', 'Escala', l.escala_id, pv.email, antes, { dias: pv.restaurar, status: status, revertendo: logId }, motivo, logId);
    return { ok: true, status: status };
  } finally { lock.releaseLock(); }
}

/* ---------------------------------------------------------------------
 * API — ATUALIZAÇÃO DO HEADCOUNT PELO PAINEL (prévia + aplicação)
 * --------------------------------------------------------------------- */
function diffHeadcount_(csvTexto) {
  const linhas = Utilities.parseCsv(csvTexto);
  if (linhas.length < 2) throw new Error('O arquivo está vazio.');
  const cab = linhas[0].map(normalizar_);
  const col = function (nomes) { for (const n of nomes) { const i = cab.indexOf(n); if (i >= 0) return i; } return -1; };
  const C = { email: col(['email', 'e-mail']), nome: col(['colaborador', 'nome']), status: col(['status']), cargo: col(['funcao']), coord: col(['coordenacao/gerencia', 'coordenacao']), entrada: col(['entrada']), saida: col(['saida']) };
  const faltam = Object.keys(C).filter(function (k) { return C[k] < 0; });
  if (faltam.length) throw new Error('Colunas não encontradas no arquivo: ' + faltam.join(', ') + '. Use o CSV do Headcount Consolidado.');
  const vistos = {};
  for (let i = 1; i < linhas.length; i++) { const r = linhas[i]; const e = normalizar_(r[C.email]); if (!e || CFG.STATUS_ATIVOS.indexOf(normalizar_(r[C.status])) < 0) continue; vistos[e] = { nome: String(r[C.nome]).trim(), cargo: String(r[C.cargo]).trim(), coord: String(r[C.coord]).trim(), entrada: hora_(r[C.entrada]), saida: hora_(r[C.saida]) }; }
  const atuais = {}; tabela_('Pessoas').linhas.forEach(function (p) { atuais[p.email] = p; });
  const novos = [], saem = [], mudam = [];
  Object.keys(vistos).forEach(function (e) {
    const v = vistos[e], p = atuais[e];
    if (!p || p.ativo !== 'SIM') { novos.push({ email: e, nome: nomeCurto_(v.nome), cargo: v.cargo, coord: v.coord, voltando: !!p }); return; }
    const m = [];
    if (p.cargo_headcount !== v.cargo) m.push('cargo: ' + p.cargo_headcount + ' → ' + v.cargo);
    if (p.rotulo_coord_headcount !== v.coord) m.push('coordenação: ' + p.rotulo_coord_headcount + ' → ' + v.coord);
    if (p.entrada_headcount !== v.entrada || p.saida_headcount !== v.saida) m.push('horário do headcount: ' + p.entrada_headcount + '–' + p.saida_headcount + ' → ' + v.entrada + '–' + v.saida);
    if (m.length) mudam.push({ email: e, nome: nomeCurto_(p.nome), mudancas: m });
  });
  Object.keys(atuais).forEach(function (e) { if (atuais[e].ativo === 'SIM' && !vistos[e]) saem.push({ email: e, nome: nomeCurto_(atuais[e].nome) }); });
  return { ativosNoArquivo: Object.keys(vistos).length, novos: novos, saem: saem, mudam: mudam };
}
function apiHeadcountPrevia(token, csvTexto) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  return { ok: false, msg: MSG_SEM_HEADCOUNT };
  if (String(csvTexto || '').length > 2000000) return { ok: false, msg: 'Arquivo grande demais.' };
  try { const d = diffHeadcount_(String(csvTexto)); d.ok = true; return d; } catch (e) { return { ok: false, msg: e.message }; }
}
const MSG_SEM_HEADCOUNT = 'A atualização pelo Headcount foi desativada. O cadastro é mantido pelo WFM.';
function apiHeadcountAplicar(token, csvTexto) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  return { ok: false, msg: MSG_SEM_HEADCOUNT }; // desativada: evita desativar quem não está na planilha do Headcount
  try {
    const d = diffHeadcount_(String(csvTexto));
    if (d.ativosNoArquivo < 50) return { ok: false, msg: 'O arquivo tem só ' + d.ativosNoArquivo + ' pessoas ativas. Confira se é o headcount completo.' };
    const res = importarHeadcountCsv_(String(csvTexto), ctx.email, false);
    if (d.novos.length) notificar_([{ dest: 'GESTAO', tipo: 'HEADCOUNT', titulo: 'Novas pessoas no headcount', msg: d.novos.length + ' pessoa(s) entraram e aguardam liberação de acesso: ' + d.novos.map(function (n) { return n.nome; }).join(', '), ref: '' }]);
    return { ok: true, resultado: res, novos: d.novos };
  } catch (e) { return { ok: false, msg: e.message }; }
}
