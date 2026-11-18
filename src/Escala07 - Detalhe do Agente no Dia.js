/**
 * Escala7.gs — horário do dia 02/11 a partir da semana da planilha e detalhes do agente no dia.
 */


/** Detalhes de um colaborador num dia (escala publicada): o dia, a semana e o resumo do mês. */
function apiAgenteDia(token, email, data) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  email = normalizar_(email); data = dataIso_(data); if (!data) throw new Error('Data inválida.');
  const p = pessoasEscala_().filter(function (x) { return x.email === email; })[0]; if (!p) throw new Error('Colaborador não encontrado.');
  const linhas = {}; tabela_('Escalas').linhas.forEach(function (l) { if (l.email === email) linhas[l.mes] = l; });
  const fx0 = semanaDe_(data); const fimSem = Utilities.formatDate(new Date(new Date(fx0 + 'T12:00:00Z').getTime() + 6 * 864e5), 'UTC', 'yyyy-MM-dd');
  const mes = data.slice(0, 7), fx = faixaMes_(mes);
  const ini = fx0 < fx.ini ? fx0 : fx.ini, fim = fimSem > fx.fim ? fimSem : fx.fim;
  const af = afastamentosEntre_(ini, fim).filter(function (a) { return a.email === email; });
  const fo = feriadosOffLista_();
  function dia(d) {
    const l = linhas[d.slice(0, 7)]; const s = l && l.dias_publicados ? l.dias_publicados.charAt(+d.slice(8) - 1) : '';
    const a = af.filter(function (x) { return d >= x.inicio && d <= x.fim; })[0];
    const atu = l ? atuacaoDe_({ atuacao: l.atuacao_publicada || '' }) : null; const x = atu && atu.d ? atu.d[String(+d.slice(8))] : null;
    const o = { data: d, sit: a ? a.tipo : (fo.indexOf(d) >= 0 && s !== 'T') ? 'FERIADO' : (s === 'T' ? 'T' : s === 'F' ? 'F' : 'SEM'), i: x ? x[0] : p.entrada, a: x ? (x[1] || '') : '', f: x ? x[2] : p.saida, blocos: null, porDia: !!x };
    if (o.sit === 'T') o.blocos = p.perfil === 'GESTAO' ? blocosPadrao_([o.i, o.a, o.f], [0, 0, 0]) : (x ? blocosPadrao_(x, atu.m) : null);
    return o;
  }
  const semana = []; for (let k = 0; k < 7; k++) semana.push(dia(Utilities.formatDate(new Date(new Date(fx0 + 'T12:00:00Z').getTime() + k * 864e5), 'UTC', 'yyyy-MM-dd')));
  const res = { trabalho: 0, folga: 0, domingosFolga: 0, afastado: 0, min: { '0800': 0, chat: 0, ass: 0, ges: 0 } };
  const n = diasNoMes_(mes);
  for (let k = 1; k <= n; k++) {
    const o = dia(mes + '-' + ('0' + k).slice(-2));
    if (o.sit === 'T') { res.trabalho++; (o.blocos || []).forEach(function (b) { const m = function (h) { const q = h.split(':'); return +q[0] * 60 + +q[1]; }; res.min[b[0]] = (res.min[b[0]] || 0) + m(b[2]) - m(b[1]); }); }
    else if (o.sit === 'F') { res.folga++; if (new Date(o.data + 'T12:00:00Z').getUTCDay() === 0) res.domingosFolga++; }
    else if (o.sit === 'FERIAS' || o.sit === 'LICENCA') res.afastado++;
  }
  const l = linhas[mes];
  return { pessoa: p, dia: dia(data), semana: semana, resumo: res, publicadaEm: l ? l.publicada_em : '', publicadaPor: l ? l.publicada_por : '' };
}
