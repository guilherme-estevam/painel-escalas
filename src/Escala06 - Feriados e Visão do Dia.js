/**
 * Escala6.gs — feriado trabalhado ou não, visão do dia e nomes para o histórico.
 */


/** Datas de feriados ativos que NÃO são trabalhados (usado pela validação das regras). */
function feriadosOffLista_() {
  return tabela_('Feriados').linhas.filter(function (f) { return f.ativo === 'SIM' && f.trabalhado === 'NAO'; }).map(function (f) { return f.data; });
}
function apiFeriadosOff(token) { sessao_(token); return feriadosOffLista_(); }

/** Nome de cada e-mail (inclusive quem saiu), para o histórico. */
function apiNomes(token) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  const out = {}; tabela_('Pessoas').linhas.forEach(function (p) { out[p.email] = nomeCurto_(p.nome); });
  return out;
}

/* ---------------------------------------------------------------------
 * VISÃO DO DIA — quem atua, em qual frente e em qual horário
 * --------------------------------------------------------------------- */
function apiVisaoDia(token, data, rascunho) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  data = dataIso_(data); if (!data) throw new Error('Data inválida.');
  const mes = data.slice(0, 7), dia = +data.slice(8);
  const linhas = {}; tabela_('Escalas').linhas.forEach(function (l) { if (l.mes === mes) linhas[l.email] = l; });
  const af = {}; afastamentosEntre_(data, data).forEach(function (a) { af[a.email] = a.tipo; });
  const fer = feriadosEntre_(data, data, true)[0] || null;
  const itens = pessoasEscala_().map(function (p) {
    const l = linhas[p.email];
    const dias = l ? (rascunho ? l.dias : l.dias_publicados) : '';
    const c = dias ? (dias.charAt(dia - 1) || '.') : '';
    const atu = l ? atuacaoDe_({ atuacao: rascunho ? l.atuacao : (l.atuacao_publicada || '') }) : null;
    const x = atu && atu.d ? atu.d[String(dia)] : null;
    const o = { email: p.email, nome: p.nome, coord: p.coord, cargo: p.cargo, perfil: p.perfil, sit: af[p.email] || (c === 'T' ? 'T' : c === 'F' ? 'F' : c === '.' ? 'V' : 'SEM'), i: x ? x[0] : p.entrada, a: x ? (x[1] || '') : '', f: x ? x[2] : p.saida, porDia: !!x, blocos: null, padrao: false };
    if (o.sit === 'T') {
      if (p.perfil === 'GESTAO') o.blocos = blocosPadrao_([o.i, o.a, o.f], [0, 0, 0]);
      else if (x) { o.blocos = blocosPadrao_(x, atu.m); o.padrao = !(x[3] && x[3].length); }
    }
    return o;
  });
  const rt = responsaveisTime_(), coordResp = {}; itens.forEach(function (o) { if (o.perfil === 'AGENTE' && rt[o.email] && rt[o.email].resp && !coordResp[o.coord]) coordResp[o.coord] = rt[o.email].resp; });
  return { data: data, rascunho: !!rascunho, feriado: fer, itens: itens, coordResp: coordResp };
}
