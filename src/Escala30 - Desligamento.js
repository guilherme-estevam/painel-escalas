/* =====================================================================
 * Desligamento de colaborador (16/11/2026)
 * Registrado pelo WFM no Planejamento (editor da pessoa), com
 * confirmação. A data informada é o ÚLTIMO dia da pessoa.
 * Até essa data nada muda: escala, presença, aderência, tempos, trocas e
 * Histórico continuam aparecendo. Depois dela:
 *  · a escala é excluída (dias seguintes sem trabalho; meses seguintes apagados);
 *  · trocas pendentes com ela são canceladas e ninguém consegue pedir troca;
 *  · o login fica bloqueado e as sessões abertas são encerradas;
 *  · não aparece mais na Visão Operacional nem no Controle de Logados;
 *  · o registro "Desligamento Registrado" entra no Histórico.
 * A pessoa continua no cadastro (ativo), para o histórico seguir nas telas.
 * ===================================================================== */
const DESL_PEND = ['ABERTA', 'AGUARDANDO_COLEGA', 'AGUARDANDO_GESTAO'];
var DESL_REF_ = '';

/* Último dia no painel de quem saiu: desligamento (data informada) ou movimentação (véspera da data da
 * movimentação, ver Escala36). As regras de exibição abaixo valem para os dois; saidaTipo_ diz qual foi. */
function desligMapa_() {
  if (MEMO_.__desl) return MEMO_.__desl; const m = {}, tipo = {}, mov = {}, iso = /^\d{4}-\d{2}-\d{2}$/;
  tabela_('Pessoas').linhas.forEach(function (p) {
    const e = String(p.email).toLowerCase(), d = String(p.desligado_em || '').slice(0, 10), mv = String(p.movimentado_em || '').slice(0, 10);
    if (iso.test(d)) { m[e] = d; tipo[e] = 'DESL'; }
    else if (iso.test(mv)) { m[e] = diaAnteriorIso_(mv); tipo[e] = 'MOV'; mov[e] = mv; }
  });
  MEMO_.__saidaTipo = tipo; MEMO_.__movEm = mov;
  return (MEMO_.__desl = m);
}
function desligDe_(email) { return desligMapa_()[String(email || '').toLowerCase()] || ''; }
/** 'DESL', 'MOV' ou ''. */
function saidaTipo_(email) { desligMapa_(); return (MEMO_.__saidaTipo || {})[String(email || '').toLowerCase()] || ''; }
/** Data da movimentação (primeiro dia fora do painel), ou ''. */
function movDe_(email) { desligMapa_(); return (MEMO_.__movEm || {})[String(email || '').toLowerCase()] || ''; }
function diaAnteriorIso_(d) { const x = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); }
function desligBr_(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : ''; }
function desligColuna_() {
  const sh = db_().getSheetByName('Pessoas'), cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(String);
  if (cab.indexOf('desligado_em') >= 0) return;
  sh.getRange(1, cab.length + 1).setValue('desligado_em'); sh.getRange(1, cab.length + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  delete MEMO_['Pessoas']; try { abaMudou_('Pessoas'); } catch (e) { }
}

/* ---------- regras de exibição (valem para todas as telas) ---------- */
(function () {
  // login e sessões: bloqueados a partir do dia seguinte ao último dia
  const _el = elegivel_;
  elegivel_ = function (email) { const r = _el.apply(this, arguments); if (!r) return r; const d = desligDe_(email); return (d && hojeIso_() > d) ? null : r; };
  // lista de pessoas: quando uma tela pede um dia específico, quem saiu antes desse dia fica de fora
  const _pe = pessoasEscala_;
  pessoasEscala_ = function () { const l = _pe.apply(this, arguments); if (!DESL_REF_) return l; return l.filter(function (p) { const d = desligDe_(p.email); return !d || DESL_REF_ <= d; }); };
  const comRef = function (fn, ref) { const ant = DESL_REF_; DESL_REF_ = ref; try { return fn(); } finally { DESL_REF_ = ant; } };
  // Visão Operacional e Controle de Logados do dia (o Controle de Logados usa a Visão por dentro)
  const _vd = apiVisaoDia;
  apiVisaoDia = function (token, data) { const a = arguments, t = this; return comRef(function () { return _vd.apply(t, a); }, dataIso_(data) || hojeIso_()); };
  // Controle de Logados do mês: dias depois do desligamento não entram
  const _pm = presMesAtual_;
  presMesAtual_ = function () { return _pm.apply(this, arguments).filter(function (x) { const d = desligDe_(x.email); return !d || x.data <= d; }); };
  // report de atrasos: lista do dia
  if (typeof repEntLista_ === 'function') { const _re = repEntLista_; repEntLista_ = function (data) { const a = arguments, t = this; return comRef(function () { return _re.apply(t, a); }, data); }; }
  // janela Escala e Presença no Mês: depois do último dia aparece "Desligado"
  if (typeof escalaPresencaMes_ === 'function') {
    const _ep = escalaPresencaMes_;
    escalaPresencaMes_ = function (mes, email) { const r = _ep.apply(this, arguments), d = desligDe_(email); if (!d) return r;
      const mov = saidaTipo_(email) === 'MOV'; if (mov) r.movimentadoEm = movDe_(email); else r.desligadoEm = d;
      (r.dias || []).forEach(function (x) { if (x.data > d) { x.sit = 'SEM'; delete x.i; delete x.a; delete x.f; delete x.b; x.st = x.data <= r.hoje ? (mov ? 'MOVIMENTACAO' : 'DESLIGADO') : ''; } }); return r; };
  }
  // Planejamento: some dos meses seguintes à saída; no mês da saída aparece com a data (desligadoEm ou movimentadoEm)
  const selo = function (p) { const d = desligDe_(p.email); if (!d) return d; if (saidaTipo_(p.email) === 'MOV') p.movimentadoEm = movDe_(p.email); else p.desligadoEm = d; return d; };
  const marcar = function (r, mes) { if (!r || !r.pessoas) return r; const ini = String(mes || '').slice(0, 7) + '-01';
    r.pessoas = r.pessoas.filter(function (p) { const d = desligDe_(p.email); if (d && d < ini) { if (r.escalas) delete r.escalas[p.email]; return false; } selo(p); return true; }); return r; };
  const _am = apiMes; apiMes = function (token, mes) { return marcar(_am.apply(this, arguments), mes); };
  if (typeof apiColaborador === 'function') { const _ac = apiColaborador; apiColaborador = function (token, mes) { const r = _ac.apply(this, arguments); if (r && r.pessoas) r.pessoas.forEach(selo); return r; }; }
  // planilha do RH: depois do último dia, "Desligado" ou "Movimentação"
  if (typeof rhEstadoAtual_ === 'function') {
    const _ra = rhEstadoAtual_; rhEstadoAtual_ = function () { const a = _ra.apply(this, arguments); Object.keys(a).forEach(function (k) { const e = k.split('|')[1], mes = k.split('|')[0], d = desligDe_(e); if (!d) return; const cod = saidaTipo_(e) === 'MOV' ? 'M' : 'D'; Object.keys(a[k].d).forEach(function (dia) { if (mes + '-' + ('0' + dia).slice(-2) > d) a[k].d[dia] = cod; }); }); return a; };
    const _rd = rhDesc_; rhDesc_ = function (s) { return String(s) === 'D' ? 'Desligado' : String(s) === 'M' ? 'Movimentação' : _rd.apply(this, arguments); };
  }
  // trocas: ninguém consegue pedir, aceitar ou aprovar troca com quem foi desligado ou movimentado
  const bloqueio = function (e) { const d = desligDe_(e); if (!d) return; if (saidaTipo_(e) === 'MOV') throw new Error('Não é possível fazer troca com esta pessoa: a movimentação foi registrada (a partir de ' + desligBr_(movDe_(e)) + ').'); throw new Error('Não é possível fazer troca com esta pessoa: o desligamento foi registrado (último dia ' + desligBr_(d) + ').'); };
  [['apiTrocaSolicitar', 1], ['apiTrocaPrevia', 1], ['apiTrocaCriar', 3], ['apiTrocaPreviaNova', 3], ['apiTrocaHorarioCriar', 2], ['apiTrocaHorarioAbrir', 2]].forEach(function (x) {
    const g = globalThis; const f = g[x[0]]; if (typeof f !== 'function') return;
    g[x[0]] = function () { if (arguments[x[1]]) bloqueio(arguments[x[1]]); return f.apply(this, arguments); };
  });
  ['apiTrocaAceitarOferta', 'apiTrocaResponder', 'apiTrocaDecidir', 'apiTrocaPreviaOferta'].forEach(function (n) {
    const g = globalThis; const f = g[n]; if (typeof f !== 'function') return;
    g[n] = function (token, id) { const t = tabela_('Trocas').linhas.filter(function (l) { return l.troca_id === id; })[0]; if (t) { bloqueio(t.solicitante); if (t.colega) bloqueio(t.colega); } return f.apply(this, arguments); };
  });
})();

/* ---------- registro ---------- */
function desligCalc_(email, data) {
  email = normalizar_(email); data = dataIso_(data);
  if (!data) throw new Error('Informe a data do último dia.');
  if (data < '2026-11-01') throw new Error('A data precisa ser a partir de 01/11/2026.');
  const p = tabela_('Pessoas').linhas.filter(function (x) { return String(x.email).toLowerCase() === email; })[0];
  if (!p) throw new Error('Pessoa não encontrada no cadastro.');
  const ja = String(p.desligado_em || '').slice(0, 10), jaMov = String(p.movimentado_em || '').slice(0, 10);
  const mes = data.slice(0, 7), dia = +data.slice(8);
  const esc = tabela_('Escalas').linhas.filter(function (l) { return l.email === email && l.mes >= mes; });
  let diasTrab = 0; const apagar = [];
  esc.forEach(function (l) { if (l.mes > mes) { apagar.push(l.mes); return; } const s = String(l.dias_publicados || l.dias || ''); for (let i = dia; i < s.length; i++) if (s.charAt(i) === 'T') diasTrab++; });
  const trocas = tabela_('Trocas').linhas.filter(function (t) { return DESL_PEND.indexOf(t.status) >= 0 && (String(t.solicitante).toLowerCase() === email || String(t.colega || '').toLowerCase() === email); });
  return { email: email, nome: nomeCurto_(p.nome), data: data, dataBr: desligBr_(data), jaDesligadoEm: ja, jaMovimentadoEm: jaMov, diasRemovidos: diasTrab, mesesApagados: apagar, trocas: trocas.map(function (t) { return t.troca_id; }), loginBloqueadoJa: hojeIso_() > data };
}
/** Saída do painel depois de c.data (último dia): corta a escala, cancela trocas pendentes, encerra sessões e limpa caches.
 * Usado pelo desligamento e pela movimentação (Escala36). */
function saidaEfeitos_(ctx, c, motivoTroca) {
  const email = c.email, data = c.data, agora = agoraIso_();
  // escala: dias seguintes sem trabalho no mês da saída; meses seguintes apagados
  const mes = data.slice(0, 7), dia = +data.slice(8), te = tabela_('Escalas');
  te.linhas.filter(function (l) { return l.email === email && l.mes === mes; }).forEach(function (l) {
    const corta = function (s) { s = String(s || ''); return s ? s.slice(0, dia) + s.slice(dia).replace(/./g, 'F') : s; };
    const limpa = function (j) { let o = {}; try { o = JSON.parse(j || '{}') || {}; } catch (e) { return j; } if (o.d) Object.keys(o.d).forEach(function (k) { if (+k > dia) delete o.d[k]; }); return JSON.stringify(o); };
    atualizarLinha_(te, l, { dias: corta(l.dias), dias_publicados: corta(l.dias_publicados), atuacao: limpa(l.atuacao), atuacao_publicada: limpa(l.atuacao_publicada), versao: String(Number(l.versao || 0) + 1), atualizado_em: agora, atualizado_por: ctx.email });
  });
  if (c.mesesApagados.length) {
    const sh = db_().getSheetByName('Escalas'), v = sh.getDataRange().getValues(), cab = v[0].map(String), iE = cab.indexOf('email'), iM = cab.indexOf('mes');
    for (let i = v.length - 1; i >= 1; i--) if (String(v[i][iE]).toLowerCase() === email && String(v[i][iM]) > mes) sh.deleteRow(i + 1);
    delete MEMO_['Escalas']; try { abaMudou_('Escalas'); } catch (e) { }
  }
  // trocas pendentes canceladas
  const tt = tabela_('Trocas');
  tt.linhas.filter(function (t) { return c.trocas.indexOf(t.troca_id) >= 0; }).forEach(function (t) {
    atualizarLinha_(tt, t, { status: 'CANCELADA', decisao_por: ctx.email, decisao_em: agora, resultado_validacao: motivoTroca });
  });
  // acesso
  try { revogarSessoes_(email); } catch (e) { }
  try { CacheService.getScriptCache().remove('el_' + email); } catch (e) { }
}
function saidaLimparCaches_(data) {
  const mes = data.slice(0, 7), dia = +data.slice(8);
  MEMO_ = {}; try { CacheService.getScriptCache().remove('vmes_' + mes); } catch (e) { }
  for (let d = dia + 1; d <= 31; d++) { try { lgDiaLimpar_(mes + '-' + ('0' + d).slice(-2)); } catch (e) { } }
}
/** WFM: prévia (não grava). */
function apiDesligamentoPrevia(token, email, data) { const ctx = sessao_(token); exigirPlanejamento_(ctx); return desligCalc_(email, data); }
/** WFM: registra o desligamento. */
function apiDesligar(token, email, data) {
  const ctx = sessao_(token); exigirPlanejamento_(ctx);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const c = desligCalc_(email, data); email = c.email; data = c.data;
    if (c.jaDesligadoEm) throw new Error('O desligamento desta pessoa já foi registrado (último dia ' + desligBr_(c.jaDesligadoEm) + ').');
    if (c.jaMovimentadoEm) throw new Error('Esta pessoa já tem movimentação registrada (a partir de ' + desligBr_(c.jaMovimentadoEm) + ').');
    desligColuna_();
    const tp = tabela_('Pessoas'), p = tp.linhas.filter(function (x) { return String(x.email).toLowerCase() === email; })[0];
    atualizarLinha_(tp, p, { desligado_em: data });
    saidaEfeitos_(ctx, c, 'Cancelada automaticamente: desligamento registrado (último dia ' + c.dataBr + ').');
    log_(ctx.email, 'DESLIGAMENTO', 'Pessoa', email, email, { desligado_em: '' },
      { ultimo_dia: c.dataBr, dias_de_trabalho_removidos: c.diasRemovidos, meses_apagados: c.mesesApagados.join(', '), trocas_canceladas: c.trocas.length }, '');
    saidaLimparCaches_(data);
    return Object.assign({ ok: true }, c);
  } finally { lock.releaseLock(); }
}
