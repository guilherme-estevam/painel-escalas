/* =====================================================================
 * Controle de Logados · Escala e Presença no Mês (12/11/2026)
 * Uma pessoa, um mês: a escala publicada de cada dia (horário, almoço e
 * atuações), férias, licenças e feriados, e a situação de presença até hoje.
 * Só lê. A presença usa a mesma regra do Controle de Logados (presSituacao_),
 * para os números baterem com a tela do mês.
 * ===================================================================== */
function apiEscalaPresencaMes(token, mes, email) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  return escalaPresencaMes_(mes, email);
}

function escalaPresencaMes_(mes, email) {
  email = normalizar_(email);
  const hoje = hojeIso_();
  mes = /^\d{4}-\d{2}$/.test(String(mes || '')) ? String(mes) : hoje.slice(0, 7);
  const nDias = new Date(+mes.slice(0, 4), +mes.slice(5, 7), 0).getDate(), dias = [];
  for (let d = 1; d <= nDias; d++) dias.push(mes + '-' + ('0' + d).slice(-2));
  const p = pessoasEscala_().filter(function (x) { return x.email === email; })[0];
  const meses = []; for (let m = '2026-01'; m <= hoje.slice(0, 7); ) { meses.push(m); const y = +m.slice(0, 4), mm = +m.slice(5, 7); m = mm === 12 ? (y + 1) + '-01' : y + '-' + ('0' + (mm + 1)).slice(-2); }
  const out = {
    mes: mes, hoje: hoje, rotulos: PRES_ROT, meses: meses, hist: false, publicadaEm: '', publicadaPor: '', dias: [],
    pessoa: p ? { email: email, nome: p.nome, coord: p.coord || '', cargo: p.cargo || p.cargo_headcount || '', perfil: p.perfil || '' } : { email: email, nome: email.split('@')[0], coord: '', cargo: '', perfil: '' }
  };
  if (mes < PRES_HIST_ATE.slice(0, 7)) {
    // meses importados da planilha antiga: só a situação de cada dia, sem escala no painel
    out.hist = true; const st = {};
    if (db_().getSheetByName('PresencasHistorico')) tabela_('PresencasHistorico').linhas.forEach(function (l) {
      if (String(l.data).slice(0, 7) === mes && String(l.email).toLowerCase() === email && l.data <= hoje) st[l.data] = l.status === 'MEDIDA' ? 'FALTA' : l.status;
    });
    dias.forEach(function (data) { out.dias.push({ data: data, sit: '', st: data <= hoje ? (st[data] || '') : '' }); });
    return out;
  }
  const l = tabela_('Escalas').linhas.filter(function (x) { return x.mes === mes && x.email === email; })[0];
  const pub = l ? String(l.dias_publicados || '') : '', atu = l ? atuacaoDe_({ atuacao: l.atuacao_publicada || '' }) : null;
  if (l) { out.publicadaEm = l.publicada_em || ''; out.publicadaPor = l.publicada_por || ''; }
  const af = afastamentosEntre_(dias[0], dias[nDias - 1]).filter(function (a) { return a.email === email; });
  const fer = {}; feriadosEntre_(dias[0], dias[nDias - 1], true).forEach(function (f) { fer[f.data] = f; });
  const reg = {}; abaPres_(); delete MEMO_[ABA_PRES];
  tabela_(ABA_PRES).linhas.forEach(function (r) { if (String(r.data).slice(0, 7) === mes && String(r.email).toLowerCase() === email) reg[r.data] = r; });
  const ag = agoraMinFort_(), ini = presInicio_();
  dias.forEach(function (data) {
    const dia = +data.slice(8), c = pub.charAt(dia - 1) || '', x = atu && atu.d ? atu.d[String(dia)] : null;
    const a = af.filter(function (z) { return z.inicio <= data && z.fim >= data; })[0];
    const o = { sit: a ? a.tipo : (c === 'T' ? 'T' : c === 'F' ? 'F' : 'SEM'), i: x ? x[0] : (p ? p.entrada : '') };
    const d = { data: data, sit: o.sit };
    if (o.sit === 'T' && x) { d.i = x[0]; d.a = x[1] || ''; d.f = x[2]; let bl = []; try { bl = x[3] || blocosPadrao_(x, atu.m) || []; } catch (e) { bl = []; } d.b = bl; }
    if (fer[data]) { d.feriado = fer[data].nome || 'Feriado'; d.feriadoTrab = String(fer[data].trabalhado) === 'true' || fer[data].trabalhado === true; }
    if (data <= hoje) {
      const s = presSituacao_(o, reg[data], data, hoje, ag, ini);
      d.st = s.st; d.auto = !!s.auto; d.em = s.em || ''; d.por = s.por || ''; d.origem = s.origem || '';
    }
    out.dias.push(d);
  });
  return out;
}
