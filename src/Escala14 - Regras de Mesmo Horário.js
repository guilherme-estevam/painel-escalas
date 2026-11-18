/**
 * Escala14.gs — troca de horário: duas pessoas que trabalham no mesmo dia trocam o horário, o almoço e as frentes.
 * Fica na aba Trocas como uma troca com o mesmo dia dos dois lados (data_solicitante = data_colega).
 * Segue o mesmo caminho das trocas de dia: pedido, aceite do colega (até 48 h antes) e aprovação da gestão.
 */
function ehTrocaHorario_(l) { return !!(l && l.data_solicitante && l.data_solicitante === l.data_colega); }
function datasTroca_(l) { return ehTrocaHorario_(l) ? 'horário de ' + dBr_(l.data_solicitante) : dBr_(l.data_solicitante) + ' e ' + dBr_(l.data_colega); }
/** Mesmo horário = mesma entrada e mesma saída (mesmo que o almoço ou as frentes sejam diferentes): não pode trocar. */
function mesmoHorario_(x, y) { return !!(x && y && x.i === y.i && x.f === y.f); }

/** Validação da troca de horário (a mesma no pedido, no aceite e na aprovação; o prazo de 48 h é conferido à parte). */
function previaHorario_(a, b, data, ignorarTrocaId) {
  data = dataIso_(data);
  if (!data) return { ok: false, motivos: ['Escolha o dia.'] };
  if (a === b) return { ok: false, motivos: ['Não é possível trocar consigo mesmo.'] };
  const mes = data.slice(0, 7), motivos = [], pes = {};
  pessoasEscala_().forEach(function (p) { pes[p.email] = p; });
  const A = pes[a], B = pes[b];
  if (!A || !B || ehVaga_(a) || ehVaga_(b)) return { ok: false, motivos: ['As duas pessoas precisam ter acesso ao painel.'] };
  if (A.perfil !== B.perfil) motivos.push('As trocas são entre pessoas do mesmo perfil: agentes com agentes, gestão com gestão.');
  else if (A.perfil === 'AGENTE' && !mesmaAtuacao_(a, b, mes)) motivos.push('As trocas são entre agentes com a mesma atuação. ' + A.nome + ' atua em ' + nomeAtuacao_(grupoAtuacao_(a, mes)) + ' e ' + B.nome + ' em ' + nomeAtuacao_(grupoAtuacao_(b, mes)) + '.');
  if (data < hojeIso_()) motivos.push('Só é possível trocar de hoje em diante.');
  const pub = {}; tabela_('Escalas').linhas.forEach(function (l) { if (l.mes === mes) pub[l.email] = l.dias_publicados; });
  [A, B].forEach(function (p) {
    const s = pub[p.email] || '';
    if (!s) motivos.push(p.nome + ' ainda não tem a escala de ' + mesBr_(mes) + ' publicada.');
    else if (s.charAt(+data.slice(8) - 1) !== 'T') motivos.push(p.nome + ' não trabalha em ' + dBr_(data) + '.');
  });
  const fx = faixaMes_(mes);
  afastamentosEntre_(fx.ini, fx.fim).forEach(function (x) { if ((x.email === a || x.email === b) && data >= x.inicio && data <= x.fim) motivos.push(pes[x.email].nome + ' está de férias ou licença em ' + dBr_(data) + '.'); });
  const jaPend = {};
  tabela_('Trocas').linhas.forEach(function (l) {
    if (TROCA_PENDENTES.indexOf(l.status) < 0 || l.troca_id === ignorarTrocaId) return;
    if ([l.data_solicitante, l.data_colega].indexOf(data) < 0) return;
    [a, b].forEach(function (e) { if ((l.solicitante === e || l.colega === e) && !jaPend[e]) { jaPend[e] = 1; motivos.push('Já existe uma troca pendente envolvendo ' + pes[e].nome + ' nesse dia.'); } });
  });
  const hA = horarioDia_(a, data), hB = horarioDia_(b, data);
  if (!motivos.length && mesmoHorario_(hA, hB)) motivos.push(A.nome + ' e ' + B.nome + ' têm o mesmo horário nesse dia (' + hA.i + ' às ' + hA.f + '). A troca de horário só pode ser feita entre horários diferentes.');
  return { ok: motivos.length === 0, motivos: motivos, mes: mes, horario: true, pessoas: [{ email: a, nome: A.nome, erros: [], avisos: [] }, { email: b, nome: B.nome, erros: [], avisos: [] }] };
}

/** Colegas que podem trocar de horário com esta pessoa no dia (mesmas regras do pedido e do aceite, com o prazo de 48 h). */
function aptosHorario_(email, perfil, data) {
  return comLeituraUnica_(function () {
    return pessoasEscala_().filter(function (p) {
      if (p.email === email || ehVaga_(p.email) || p.perfil !== perfil) return false;
      if (perfil === 'AGENTE' && !mesmaAtuacao_(p.email, email, data.slice(0, 7))) return false;
      if (prazoCedo_(email, p.email, data, data)) return false;
      return previaHorario_(email, p.email, data, null).ok;
    }).map(function (p) { return { email: p.email, nome: p.nome, coord: p.coord, h: horarioDia_(p.email, data) }; });
  });
}

/** Tela: o meu horário no dia e os colegas aptos, com o horário de cada um. */
function apiTrocaHorarioOpcoes(token, data) {
  const ctx = sessao_(token); data = dataIso_(data);
  if (!data) return { ok: false, motivos: ['Escolha o dia.'] };
  const prazo = prazo48h_(ctx.email, '', data, data); if (prazo) return { ok: false, motivos: [prazo] };
  const meu = horarioDia_(ctx.email, data);
  return { ok: true, data: data, meu: meu, colegas: aptosHorario_(ctx.email, ctx.perfil, data) };
}

/** Pedido de troca de horário (vai direto para o colega escolhido). */
function apiTrocaHorarioCriar(token, data, colega, motivo) {
  if (typeof MSG_SEM_TROCA_HORARIO !== 'undefined') return { ok: false, msg: MSG_SEM_TROCA_HORARIO, motivos: [MSG_SEM_TROCA_HORARIO] };
  const ctx = sessao_(token); data = dataIso_(data); colega = normalizar_(colega || '');
  if (!colega) return { ok: false, motivos: ['Escolha com quem você quer trocar.'] };
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    const pv = previaHorario_(ctx.email, colega, data, null);
    const prazo = prazo48h_(ctx.email, colega, data, data);
    const motivos = pv.motivos.concat(prazo ? [prazo] : []);
    if (motivos.length) return { ok: false, motivos: motivos };
    const id = novoId_('tr'), agora = agoraIso_(), nomeA = nomeCurto_(ctx.pessoa.nome);
    const linha = { troca_id: id, mes: data.slice(0, 7), solicitante: ctx.email, colega: colega, data_solicitante: data, data_colega: data, status: 'AGUARDANDO_COLEGA', motivo: String(motivo || '').slice(0, 200), criada_em: agora, resultado_validacao: 'OK na solicitação (troca de horário)', atualizado_em: agora };
    appendLinhas_('Trocas', [linha]);
    log_(ctx.email, 'TROCA_SOLICITADA', 'Troca', id, colega, null, { tipo: 'horário', solicitante: ctx.email, colega: colega, data: data }, linha.motivo, id);
    notificar_([{ dest: colega, tipo: 'TROCA_RECEBIDA', titulo: 'Pedido de troca de horário', msg: nomeA + ' quer trocar de horário com você em ' + dBr_(data) + '. Se aceitar, você trabalha ' + horarioFrentesTxt_(ctx.email, data) + ', e ' + nomeA + ' assume o seu horário' + (horarioDia_(colega, data) ? ', das ' + horarioDia_(colega, data).i + ' às ' + horarioDia_(colega, data).f : '') + '. Aceite ou recuse em Minha escala.', ref: id }]);
    enviarEmail_(colega, 'Pedido de troca de horário', nomeA + ' quer trocar de horário com você em ' + dBr_(data) + '. Abra o painel para ver os dois horários e aceitar ou recusar.');
    return { ok: true, id: id };
  } finally { lock.releaseLock(); }
}

/* ---------- troca de horário em aberto: pedir um horário e avisar todos que trabalham nele ---------- */
/** Garante a coluna horario_alvo na aba Trocas (guarda o horário pedido num pedido em aberto, ex.: "08:00-17:00"). */
function garantirColunaAlvo_() {
  const t = tabela_('Trocas');
  if (t.cab.indexOf('horario_alvo') >= 0) return;
  garantirEspacoColunas_(t.sh, t.cab.length + 1); t.sh.getRange(1, t.cab.length + 1).setValue('horario_alvo');
  delete MEMO_['Trocas'];
}
function chaveHorario_(h) { return h ? h.i + '-' + h.f : ''; }
/** Num pedido de horário em aberto, só pode aceitar quem trabalha no horário pedido nesse dia. */
function horarioAlvoOk_(l, email) { return !l.horario_alvo || chaveHorario_(horarioDia_(email, l.data_solicitante)) === l.horario_alvo; }

/** Pedido de troca de horário em aberto: avisa todas as pessoas aptas que trabalham no horário pedido; a primeira que aceitar fica com a troca. */
function apiTrocaHorarioAbrir(token, data, alvo, motivo) {
  if (typeof MSG_SEM_TROCA_HORARIO !== 'undefined') return { ok: false, msg: MSG_SEM_TROCA_HORARIO, motivos: [MSG_SEM_TROCA_HORARIO] };
  const ctx = sessao_(token); data = dataIso_(data); alvo = String(alvo || '');
  if (!data || !/^\d\d:\d\d-\d\d:\d\d$/.test(alvo)) return { ok: false, motivos: ['Escolha o dia e o horário que você quer.'] };
  const prazo = prazo48h_(ctx.email, '', data, data); if (prazo) return { ok: false, motivos: [prazo] };
  garantirColunaAlvo_();
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    const meu = horarioDia_(ctx.email, data);
    if (chaveHorario_(meu) === alvo) return { ok: false, motivos: ['Esse já é o seu horário nesse dia. Escolha um horário diferente.'] };
    const aptos = aptosHorario_(ctx.email, ctx.perfil, data).filter(function (c) { return chaveHorario_(c.h) === alvo; });
    if (!aptos.length) return { ok: false, motivos: ['Nenhum colega apto trabalha das ' + alvo.replace('-', ' às ') + ' nesse dia. Escolha outro horário.'] };
    const id = novoId_('tr'), agora = agoraIso_(), nome = nomeCurto_(ctx.pessoa.nome);
    appendLinhas_('Trocas', [{ troca_id: id, mes: data.slice(0, 7), solicitante: ctx.email, colega: '', data_solicitante: data, data_colega: data, status: 'ABERTA', motivo: String(motivo || '').slice(0, 200), criada_em: agora, resultado_validacao: 'OK na abertura (troca de horário em aberto)', atualizado_em: agora, horario_alvo: alvo }]);
    log_(ctx.email, 'TROCA_ABERTA', 'Troca', id, '', null, { tipo: 'horário', data: data, horario_pedido: alvo, avisados: aptos.length }, motivo, id);
    notificar_(aptos.map(function (c) { return { dest: c.email, tipo: 'TROCA_ABERTA', titulo: 'Pedido de troca de horário: você pode aceitar', msg: nome + ' quer trabalhar das ' + alvo.replace('-', ' às ') + ' em ' + dBr_(data) + ', que é o seu horário nesse dia. Se aceitar, você trabalha ' + horarioFrentesTxt_(ctx.email, data) + ', e ' + nome + ' assume o seu horário. O pedido foi para ' + aptos.length + ' pessoa' + (aptos.length > 1 ? 's' : '') + ' com esse horário: a primeira que aceitar fica com a troca. Veja em Minha escala.', ref: id }; }));
    return { ok: true, id: id, avisados: aptos.length };
  } finally { lock.releaseLock(); }
}
