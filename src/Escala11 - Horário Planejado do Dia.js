/**
 * Escala11.gs — trocas: prazo mínimo de 72 horas para pedir e aceitar (a coordenação tem até 24 horas antes, Escala22).
 */
const TROCA_PRAZO_H = 72;

/** Horário planejado do dia (escala publicada; sem horário próprio, usa o do cadastro). */
function horarioDia_(email, data) {
  const l = ESC_IDX_ ? ESC_IDX_[data.slice(0, 7) + '|' + email] : tabela_('Escalas').linhas.filter(function (x) { return x.mes === data.slice(0, 7) && x.email === email; })[0];
  const atu = l ? atuacaoDe_({ atuacao: l.atuacao_publicada || l.atuacao }) : null;
  const x = atu && atu.d ? atu.d[String(+data.slice(8))] : null;
  if (x) return { i: x[0], a: x[1] || '', f: x[2], blocos: blocosPadrao_(x, atu.m), cadastro: false };
  const p = pessoasEscala_().filter(function (q) { return q.email === email; })[0];
  return p ? { i: p.entrada, a: '', f: p.saida, blocos: null, cadastro: true } : null;
}
function inicioMs_(data, hora) { return Utilities.parseDate(data + ' ' + (hora || '00:00'), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm').getTime(); }

/** Turno da troca que começa antes do prazo mínimo (ou null se os dois estiverem fora das 48 horas). */
function prazoCedo_(solicitante, colega, dFolga, dTrab) {
  const lim = Date.now() + TROCA_PRAZO_H * 3600 * 1000;
  const hA = horarioDia_(solicitante, dFolga), hB = colega ? horarioDia_(normalizar_(colega), dTrab) : null;
  // num pedido em aberto, o turno de quem vai cobrir é conferido colega por colega (colegasAptos_)
  const itens = [{ data: dFolga, ms: inicioMs_(dFolga, hA ? hA.i : '00:00'), hora: hA ? hA.i : '' }].concat(colega ? [{ data: dTrab, ms: inicioMs_(dTrab, hB ? hB.i : '00:00'), hora: hB ? hB.i : '' }] : []);
  const cedo = itens.filter(function (x) { return x.ms < lim; }).sort(function (x, y) { return x.ms - y.ms; })[0];
  if (!cedo) return null;
  cedo.falta = Math.max(0, Math.floor((cedo.ms - Date.now()) / 3600000));
  cedo.txt = 'O turno de ' + dBr_(cedo.data) + (cedo.hora ? ' começa às ' + cedo.hora : ' começa nesse dia') + ' (faltam ' + cedo.falta + ' h)';
  return cedo;
}
/** Bloqueio ao pedir a troca. */
function prazo48h_(solicitante, colega, dFolga, dTrab) {
  const c = prazoCedo_(solicitante, colega, dFolga, dTrab);
  return c ? 'Só dá para pedir troca com pelo menos ' + TROCA_PRAZO_H + ' horas de antecedência do início do turno. ' + c.txt + '. Escolha dias mais à frente.' : '';
}
/** Bloqueio ao aceitar a troca (a coordenação tem até 24 horas antes do primeiro turno: Escala22). */
function prazoAceite_(solicitante, colega, dFolga, dTrab) {
  const c = prazoCedo_(solicitante, colega, dFolga, dTrab);
  return c ? 'Não dá mais para aceitar esta troca: ela precisa ser aceita até ' + TROCA_PRAZO_H + ' horas antes do início do turno. ' + c.txt + '.' : '';
}

/** Como ficam os horários: em cada dia, quem entra assume o horário planejado de quem sai. */
function horariosTroca_(a, b, dFolga, dTrab) {
  const nome = {}; pessoasEscala_().forEach(function (p) { nome[p.email] = p.nome; });
  const pa = { email: a, nome: nome[a] || a }, pb = b ? { email: b, nome: nome[b] || b } : null;
  return { dias: [{ data: dFolga, sai: pa, entra: pb, h: horarioDia_(a, dFolga) }, { data: dTrab, sai: pb, entra: pa, h: b ? horarioDia_(b, dTrab) : null }] };
}
function apiTrocaHorarios(token, dFolga, dTrab, colega) {
  const ctx = sessao_(token);
  return horariosTroca_(ctx.email, colega ? normalizar_(colega) : '', dataIso_(dFolga), dataIso_(dTrab));
}
function apiTrocaHorariosPorId(token, id) {
  const ctx = sessao_(token);
  const l = tabela_('Trocas').linhas.filter(function (x) { return x.troca_id === id; })[0];
  if (!l) throw new Error('Troca não encontrada.');
  const b = l.colega || (l.status === 'ABERTA' && l.solicitante !== ctx.email ? ctx.email : '');
  if (ctx.perfil !== 'GESTAO' && ctx.email !== l.solicitante && ctx.email !== b) throw new Error('SEM_PERMISSAO');
  return horariosTroca_(l.solicitante, b, l.data_solicitante, l.data_colega);
}
function horarioTxt_(email, data) { const h = horarioDia_(email, data); return h ? h.i + ' às ' + h.f + (h.a ? ' (almoço ' + h.a + ')' : '') : 'o horário planejado'; }

/** Horário e frentes do dia em texto, para as notificações: "09:00 às 18:00 (chat 09:00–13:30, 0800 14:40–18:00)". */
function horarioFrentesTxt_(email, data) {
  const h = horarioDia_(email, data); if (!h) return 'no horário planejado';
  const nomes = { '0800': '0800', chat: 'chat', ass: 'assíncrono', ges: 'trabalho' };
  const fr = (h.blocos || []).map(function (b) { return (nomes[b[0]] || 'trabalho') + ' ' + b[1] + '–' + b[2]; });
  return 'das ' + h.i + ' às ' + h.f + (fr.length ? ' (' + fr.join(', ') + (h.a ? ', almoço ' + h.a : '') + ')' : (h.a ? ' (almoço ' + h.a + ')' : ''));
}
