/* ===================== Controle de Logados: período do atestado/licença e Dashboard da Semana ===================== */
function lgSomaDia_(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function lgDifDias_(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000); }
/** Junta a cada pessoa de atestado, licença ou férias o período inteiro (início, fim e quantos dias).
 *  Atestado: os dias com atestado lançado que se emendam (intervalo de até 3 dias, para atravessar folgas). Licença e férias: o cadastro em Férias e Licenças. */
function presPeriodosAplicar_(itens, data) {
  const alvo = itens.filter(function (x) { return x.st === 'ATESTADO' || x.st === 'LICENCA' || x.st === 'FERIAS'; }); if (!alvo.length || data < PRES_HIST_ATE) return;
  const ini = lgSomaDia_(data, -45), fim = lgSomaDia_(data, 45), quer = {}; alvo.forEach(function (x) { quer[x.email] = 1; });
  const at = {}; if (alvo.some(function (x) { return x.st === 'ATESTADO'; })) { abaPres_(); tabela_(ABA_PRES).linhas.forEach(function (l) { const e = String(l.email).toLowerCase(), d = String(l.data); if (quer[e] && l.status === 'ATESTADO' && d >= ini && d <= fim) (at[e] = at[e] || {})[d] = 1; }); }
  const af = alvo.some(function (x) { return x.st !== 'ATESTADO'; }) ? afastamentosEntre_(data, data) : [];
  let perSalvos = []; try { if (alvo.some(function (x) { return x.st === 'ATESTADO'; })) perSalvos = atPerLer_(); } catch (e) { }
  alvo.forEach(function (x) {
    if (x.st === 'ATESTADO') { const g = perSalvos.filter(function (p) { return p.email === x.email && p.ini <= data && p.fim >= data; }).pop();
      if (g) { x.per = { ini: g.ini, fim: g.fim, n: lgDifDias_(g.ini, g.fim) + 1, tipo: 'ATESTADO' }; return; }
      const m = at[x.email] || {}; m[data] = 1; const ds = Object.keys(m).sort(); let a = ds.indexOf(data), b = a;
      while (a > 0 && lgDifDias_(ds[a - 1], ds[a]) <= 3) a--; while (b < ds.length - 1 && lgDifDias_(ds[b], ds[b + 1]) <= 3) b++;
      x.per = { ini: ds[a], fim: ds[b], n: lgDifDias_(ds[a], ds[b]) + 1, tipo: 'ATESTADO' }; }
    else { const z = af.filter(function (y) { return y.email === x.email; })[0]; if (z) x.per = { ini: z.inicio, fim: z.fim, n: lgDifDias_(z.inicio, z.fim) + 1, tipo: z.tipo }; }
  });
}
/** Situação de cada agente em cada um dos dias pedidos (mesma regra do Controle de Logados do dia e do mês). */
function lgSemanaCalc_(dias, hoje) {
  const ag = agoraMinFort_(), pi = presInicio_(), teste = contasTeste_(), ate = dias.filter(function (d) { return d <= hoje; });
  const pessoas = {}, porDia = {}; dias.forEach(function (d) { porDia[d] = { esc: 0, c: {} }; });
  const add = function (e, info, data, st, escalado) {
    const p = pessoas[e] || (pessoas[e] = { email: e, nome: info.nome, coord: info.coord, squad: info.squad || '', cargo: info.cargo || '', esc: 0, c: {}, d: {} });
    p.c[st] = (p.c[st] || 0) + 1; p.d[data] = st; if (escalado) { p.esc++; porDia[data].esc++; } porDia[data].c[st] = (porDia[data].c[st] || 0) + 1; };
  const hist = ate.filter(function (d) { return d < PRES_HIST_ATE; }), atual = ate.filter(function (d) { return d >= PRES_HIST_ATE; });
  if (hist.length && db_().getSheetByName('PresencasHistorico')) {
    const mapa = coordenacoes_(), todos = {}, hps = {}; tabela_('Pessoas').linhas.forEach(function (p) { todos[String(p.email).toLowerCase()] = p; });
    tabela_('PresencasHistorico').linhas.forEach(function (l) { if (hist.indexOf(l.data) < 0) return; const e = String(l.email).toLowerCase(); if (teste.indexOf(e) >= 0) return;
      const mes = String(l.data).slice(0, 7), hp = hps[mes] || (hps[mes] = histPessoas_(mes)), p = todos[e], h = hp[e], st = l.status === 'MEDIDA' ? 'FALTA' : l.status;
      add(e, { nome: h && h.nome ? h.nome : (p ? nomeCurto_(p.nome) : e.split('@')[0]), coord: h && h.coord ? h.coord : (p ? coordDe_(p, mapa).nome : 'Sem coordenação'), squad: h && h.squad ? h.squad : (p ? p.squad : ''), cargo: h && h.cargo ? h.cargo : (p ? p.cargo_headcount : '') }, l.data, st, PRES_TRABALHO.indexOf(st) >= 0); });
  }
  if (atual.length) {
    const pes = pessoasEscala_().filter(function (p) { return p.perfil === 'AGENTE' && teste.indexOf(p.email) < 0; }), meses = {}; atual.forEach(function (d) { meses[d.slice(0, 7)] = 1; });
    const esc = {}; tabela_('Escalas').linhas.forEach(function (l) { if (meses[l.mes]) esc[l.mes + '|' + l.email] = l; });
    const af = afastamentosEntre_(atual[0], atual[atual.length - 1]), reg = {}, quer = {}; atual.forEach(function (d) { quer[d] = 1; });
    abaPres_(); delete MEMO_[ABA_PRES]; tabela_(ABA_PRES).linhas.forEach(function (l) { if (quer[l.data]) reg[l.data + '|' + String(l.email).toLowerCase()] = l; });
    pes.forEach(function (p) { atual.forEach(function (data) {
      const l = esc[data.slice(0, 7) + '|' + p.email], pub = l ? String(l.dias_publicados || '') : '', atu = l ? atuacaoDe_({ atuacao: l.atuacao_publicada || '' }) : null, dia = +data.slice(8), c = pub.charAt(dia - 1) || '', x = atu && atu.d ? atu.d[String(dia)] : null;
      const a = af.filter(function (z) { return z.email === p.email && z.inicio <= data && z.fim >= data; })[0];
      const o = { sit: a ? a.tipo : (c === 'T' ? 'T' : c === 'F' ? 'F' : 'SEM'), i: x ? x[0] : p.entrada };
      add(p.email, p, data, presSituacao_(o, reg[data + '|' + p.email], data, hoje, ag, pi).st, o.sit === 'T'); }); });
  }
  return { pessoas: pessoas, porDia: porDia, ate: ate };
}
/** Gestão: Dashboard da Semana (domingo a sábado da data pedida), com a semana anterior para comparar. */
function apiControleLogadosSemana(token, data) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  const hoje = hojeIso_(), d = dataIso_(data) || hoje, dw = new Date(d + 'T12:00:00Z').getUTCDay(), ini = lgSomaDia_(d, -dw);
  const dias = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return lgSomaDia_(ini, i); }), ant = dias.map(function (x) { return lgSomaDia_(x, -7); });
  const s = lgSemanaCalc_(dias, hoje), a = lgSemanaCalc_(ant, hoje), tot = { esc: 0, c: {} };
  Object.keys(a.pessoas).forEach(function (k) { const p = a.pessoas[k]; tot.esc += p.esc; Object.keys(p.c).forEach(function (st) { tot.c[st] = (tot.c[st] || 0) + p.c[st]; }); });
  return { ini: dias[0], fim: dias[6], hoje: hoje, ate: s.ate.length ? s.ate[s.ate.length - 1] : '', rotulos: PRES_ROT, coordResp: coordResp_(),
    pessoas: Object.keys(s.pessoas).map(function (k) { return s.pessoas[k]; }), dias: dias.map(function (x) { return { data: x, futuro: x > hoje, esc: s.porDia[x].esc, c: s.porDia[x].c }; }),
    anterior: { ini: ant[0], fim: ant[6], esc: tot.esc, c: tot.c } };
}
/** Gestão (Controle de Logados): registra a licença com início e fim. Cadastra em Férias e Licenças (com histórico) e,
 *  nos dias até hoje que já tinham outra situação registrada, troca para Licença — assim o período vale para todas as datas escolhidas. */
function apiRegistrarLicenca(token, a) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  const r = apiSalvarAfastamento(token, { email: a && a.email, tipo: 'LICENCA', inicio: a && a.inicio, fim: a && a.fim, obs: a && a.obs }); if (!r || r.ok === false) return r;
  const email = normalizar_(a.email), ini = dataIso_(a.inicio), fim = dataIso_(a.fim), hoje = hojeIso_(), ate = fim < hoje ? fim : hoje, em = agoraIso_(), trocados = [];
  for (let d = ini; d <= ate; d = lgSomaDia_(d, 1)) { const g = presRegistros_(d)[email]; if (g && g.status && g.status !== 'LICENCA') { presGravar_(d, [email], 'LICENCA', 'GESTAO', ctx.email, em); trocados.push(d); } lgDiaLimpar_(d); }
  return { ok: true, trocados: trocados };
}
/* ===================== Atestado: guarda o período lançado (início e fim de verdade, em dias corridos) ===================== */
const ABA_AT_PER = 'AtestadosPeriodos';
function atPerSalvar_(email, ini, fim, por) { const ss = db_(); let sh = ss.getSheetByName(ABA_AT_PER);
  if (!sh) { sh = ss.insertSheet(ABA_AT_PER); sh.getRange('A:E').setNumberFormat('@'); sh.getRange(1, 1, 1, 5).setValues([['email', 'inicio', 'fim', 'por', 'em']]); sh.setFrozenRows(1); }
  sh.appendRow([String(email).toLowerCase(), ini, fim, por || '', agoraIso_()]); }
function atPerLer_() { const sh = db_().getSheetByName(ABA_AT_PER); if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues().map(function (r) { return { email: String(r[0]).toLowerCase(), ini: String(r[1]).slice(0, 10), fim: String(r[2]).slice(0, 10) }; }); }
/** Gestão: lança o atestado por período (mesma regra de antes) e guarda o período escolhido, para mostrar início, fim e dias corridos. */
function apiAtestadoPeriodo(token, ini, fim, email, status) {
  const r = apiDefinirPresencaPeriodo(token, ini, fim, email, status);
  try { if (status === 'ATESTADO' && r && r.ok !== false && r.trab && r.trab.length) { atPerSalvar_(email, dataIso_(ini), dataIso_(fim), sessao_(token).email); r.trab.forEach(function (d) { lgDiaLimpar_(d); }); } } catch (e) { }
  return r;
}
/* ===================== Batida única: as atualizações de fundo numa chamada só ===================== */
/** Notificações, pendências de trocas, faltas a justificar (gestão) e o aviso de "online", tudo numa execução. */
function apiBatida(token, vis, quer) {
  quer = quer || {}; const out = {};
  out.apiPresenca = apiPresenca(token, vis); /* se a sessão venceu, o erro sobe, como nas chamadas separadas */
  try { out.apiNotificacoes = apiNotificacoes(token); } catch (e) { }
  try { out.apiPendencias = apiPendencias(token); } catch (e) { }
  if (quer.logados) { try { out.apiLogadosPendentes = apiLogadosPendentes(token); } catch (e) { } }
  try { repEntTalvez_(); } catch (e) { } /* report de atrasos: gera o dia anterior uma vez por dia */
  /* (módulo de RH não incluído nesta versão) máximo a cada 10 minutos */
  return out;
}
