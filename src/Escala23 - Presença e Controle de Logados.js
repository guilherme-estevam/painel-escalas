/**
 * Escala23.gs — Planejamento (WFM):
 *  (1) trocar a escala inteira entre 2 agentes no mês: dias de trabalho e folga, horário e atuação;
 */
function dadosTrocaAgentes_(mes, a, b) {
  const te = tabela_('Escalas'), tp = tabela_('Pessoas');
  const ach = function (t, e, m) { return t.linhas.filter(function (x) { return x.email === e && (!m || x.mes === m); })[0]; };
  return { te: te, tp: tp, la: ach(te, a, mes), lb: ach(te, b, mes), pa: ach(tp, a), pb: ach(tp, b) };
}
function resumoEscalaAg_(l, p, mes) {
  const atu = atuacaoDe_({ atuacao: l.atuacao_publicada || l.atuacao }), h = horarioBase_({ email: l.email, entrada: p ? p.entrada_planejada : '', saida: p ? p.saida_planejada : '' }, mes);
  const dias = l.dias_publicados || l.dias || '';
  return { email: l.email, nome: nomeCurto_(p ? p.nome : l.email), dias: dias, g: atu && atu.g ? atu.g : '', horario: h ? h.i + ' às ' + h.f : '', trab: (dias.match(/T/g) || []).length };
}
function checarTrocaAgentes_(mes, D) {
  const motivos = [], a = D.la.email, b = D.lb.email;
  const pend = tabela_('Trocas').linhas.filter(function (l) { return TROCA_PENDENTES.indexOf(l.status) >= 0 && String(l.data_solicitante).slice(0, 7) === mes && [l.solicitante, l.colega].some(function (e) { return e === a || e === b; }); });
  if (pend.length) motivos.push('Há ' + pend.length + ' pedido(s) de troca pendente(s) dessas pessoas em ' + mesBr_(mes) + '. Resolva os pedidos antes de trocar as escalas.');
  const fx = faixaMes_(mes), af = {}; afastamentosEntre_(fx.ini, fx.fim).forEach(function (x) { (af[x.email] = af[x.email] || []).push(x); });
  const pub = {}; tabela_('Escalas').linhas.forEach(function (l) { pub[l.mes + '|' + l.email] = l.dias_publicados || l.dias; });
  const pes = {}, fo = feriadosOffLista_(); pessoasEscala_().forEach(function (p) { pes[p.email] = p; });
  [[D.la, D.lb], [D.lb, D.la]].forEach(function (x) {
    const quem = x[0].email, p = pes[quem] || {}, v = validarEscala_({ mes: mes, dias: x[1].dias_publicados || x[1].dias, ant: pub[mesDelta_(mes, -1) + '|' + quem] || '', prox: pub[mesDelta_(mes, 1) + '|' + quem] || '', afast: af[quem] || [], segSex: p.segSex, ferOff: fo });
    v.erros.forEach(function (e) { motivos.push((p.nome || quem) + ', com a escala nova: ' + e.msg); });
  });
  return motivos;
}
function apiTrocaAgentesPrevia(token, mes, a, b) {
  const ctx = sessao_(token); exigirGestao_(ctx); exigirPlanejamento_(ctx); mesValido_(mes);
  a = normalizar_(a); b = normalizar_(b);
  if (!a || !b || a === b) return { ok: false, motivos: ['Escolha duas pessoas diferentes.'] };
  const D = dadosTrocaAgentes_(mes, a, b);
  if (!D.la || !D.lb) return { ok: false, motivos: ['As duas pessoas precisam ter escala de ' + mesBr_(mes) + '.'] };
  const motivos = checarTrocaAgentes_(mes, D);
  return { ok: !motivos.length, motivos: motivos, a: resumoEscalaAg_(D.la, D.pa, mes), b: resumoEscalaAg_(D.lb, D.pb, mes) };
}
function apiTrocaAgentes(token, mes, a, b, motivo) {
  const ctx = sessao_(token); exigirGestao_(ctx); exigirPlanejamento_(ctx); mesValido_(mes);
  a = normalizar_(a); b = normalizar_(b);
  if (!a || !b || a === b) return { ok: false, msg: 'Escolha duas pessoas diferentes.' };
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    const D = dadosTrocaAgentes_(mes, a, b);
    if (!D.la || !D.lb) return { ok: false, msg: 'As duas pessoas precisam ter escala de ' + mesBr_(mes) + '.' };
    const motivos = checarTrocaAgentes_(mes, D); if (motivos.length) return { ok: false, msg: motivos.join(' ') };
    const agora = agoraIso_(), ra = resumoEscalaAg_(D.la, D.pa, mes), rb = resumoEscalaAg_(D.lb, D.pb, mes), campos = ['dias', 'dias_publicados', 'atuacao', 'atuacao_publicada'];
    const va = {}, vb = {}; campos.forEach(function (c) { va[c] = D.lb[c] || ''; vb[c] = D.la[c] || ''; });
    va.versao = String(Number(D.la.versao || 0) + 1); vb.versao = String(Number(D.lb.versao || 0) + 1);
    va.atualizado_em = vb.atualizado_em = agora; va.atualizado_por = vb.atualizado_por = ctx.email;
    atualizarLinha_(D.te, D.la, va); atualizarLinha_(D.te, D.lb, vb);
    if (D.pa && D.pb) {
      const ea = D.pa.entrada_planejada, sa = D.pa.saida_planejada;
      atualizarLinha_(D.tp, D.pa, { entrada_planejada: D.pb.entrada_planejada, saida_planejada: D.pb.saida_planejada, atualizado_em: agora });
      atualizarLinha_(D.tp, D.pb, { entrada_planejada: ea, saida_planejada: sa, atualizado_em: agora });
    }
    MEMO_ = {}; HOR_BASE_ = {};
    logLote_([{ ator: ctx.email, acao: 'ESCALA_TROCADA_GESTAO', tipo: 'Escala', registro: mes, afetado: a, antes: { horario: ra.horario, atuacao: ra.g, dias: ra.dias }, depois: { horario: rb.horario, atuacao: rb.g, dias: rb.dias }, motivo: 'Trocou com ' + b + (motivo ? ' · ' + motivo : '') },
      { ator: ctx.email, acao: 'ESCALA_TROCADA_GESTAO', tipo: 'Escala', registro: mes, afetado: b, antes: { horario: rb.horario, atuacao: rb.g, dias: rb.dias }, depois: { horario: ra.horario, atuacao: ra.g, dias: ra.dias }, motivo: 'Trocou com ' + a + (motivo ? ' · ' + motivo : '') }]);
    const aviso = function (dest, eu, outro) { return { dest: dest, tipo: 'ESCALA_ALTERADA', titulo: 'Sua escala de ' + mesBr_(mes) + ' mudou', msg: 'A gestão trocou a sua escala de ' + mesBr_(mes) + ' com a de ' + outro.nome + '. Seu horário agora é ' + (outro.horario || 'o da nova escala') + (outro.g ? ', em ' + nomeAtuacao_(outro.g) : '') + '. Confira os dias em Minha escala.', ref: mes }; };
    notificar_([aviso(a, ra, rb), aviso(b, rb, ra)]);
    [[a, rb], [b, ra]].forEach(function (x) { try { enviarEmail_(x[0], 'Sua escala de ' + mesBr_(mes) + ' mudou', 'A gestão trocou a sua escala de ' + mesBr_(mes) + ' com a de ' + x[1].nome + '. Seu horário agora é ' + (x[1].horario || 'o da nova escala') + '. Confira os dias de trabalho e folga em Minha escala.'); } catch (e) { /* aviso no painel já foi */ } });
    return { ok: true, a: { nome: ra.nome, horario: rb.horario, g: rb.g }, b: { nome: rb.nome, horario: ra.horario, g: ra.g } };
  } finally { lock.releaseLock(); }
}


/**
 * Escala24.gs — dias com pedidos pendentes (v60) e detalhe de troca para o Histórico.
 *  Receber: pedidos ainda sem resposta NÃO prendem o dia; só uma troca já aceita (aguardando a coordenação) prende.
 *  Enviar:  para pedir troca de um dia, a pessoa precisa antes recusar as ofertas recebidas para esse dia.
 *  Aceitar: não aceita se já aceitou outra troca do dia ou se tem um pedido próprio aberto para ele.
 */
function trocaTocaDias_(l, datas) { return datas.indexOf(l.data_solicitante) >= 0 || datas.indexOf(l.data_colega) >= 0; }
function recusasDe_(l) { try { const v = JSON.parse(l.recusas || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
/** Quem recebeu o aviso de cada pedido em aberto (notificações TROCA_ABERTA). Guardado só durante a execução. */
function destinatariosAberta_(id) {
  if (!MEMO_.__destAb) { const d = {}; tabela_('Notificacoes').linhas.forEach(function (n) { if (n.tipo === 'TROCA_ABERTA' && n.referencia) (d[n.referencia] = d[n.referencia] || []).push(n.destinatario); }); MEMO_.__destAb = d; }
  return (MEMO_.__destAb[id] || []).filter(function (e, i, a) { return a.indexOf(e) === i; });
}
function trocasDe_(c) { return c && c.trocas ? c.trocas : tabela_('Trocas').linhas; }
/** Troca já aceita (aguardando a coordenação) com a pessoa nesses dias. */
function compromisso_(c, email, datas, ignorarId) {
  return trocasDe_(c).filter(function (l) { return l.status === 'AGUARDANDO_GESTAO' && l.troca_id !== ignorarId && (l.solicitante === email || l.colega === email) && trocaTocaDias_(l, datas); })[0] || null;
}
/** Pedidos que a pessoa enviou e ainda esperam resposta nesses dias. */
function meusPedidos_(c, email, datas, ignorarId) {
  return trocasDe_(c).filter(function (l) { return (l.status === 'AGUARDANDO_COLEGA' || l.status === 'ABERTA') && l.solicitante === email && l.troca_id !== ignorarId && trocaTocaDias_(l, datas); });
}
/** Ofertas recebidas sem resposta nesses dias: diretas para a pessoa e pedidos em aberto que ela recebeu e não recusou. */
function ofertasRecebidas_(c, email, datas) {
  return trocasDe_(c).filter(function (l) {
    if (l.solicitante === email || !trocaTocaDias_(l, datas)) return false;
    if (l.status === 'AGUARDANDO_COLEGA') return l.colega === email;
    if (l.status === 'ABERTA') return recusasDe_(l).indexOf(email) < 0 && destinatariosAberta_(l.troca_id).indexOf(email) >= 0;
    return false;
  });
}
function nomeDe_(email) { const p = pessoasEscala_().filter(function (x) { return x.email === email; })[0]; return p ? nomeCurto_(p.nome) : String(email || '').split('@')[0]; }
function dmTroca_(d) { return String(d).slice(8, 10) + '/' + String(d).slice(5, 7); }
/** Motivo para não deixar a pessoa ENVIAR um pedido com esses dias ('' = pode). */
function bloqueioEnvio_(c, email, datas) {
  const k = compromisso_(c, email, datas, null);
  if (k) return 'Você já aceitou uma troca envolvendo um desses dias e ela está aguardando a coordenação.';
  const m = meusPedidos_(c, email, datas, null);
  if (m.length) return 'Você já tem um pedido de troca seu em aberto com esses dias. Cancele esse pedido antes de fazer outro.';
  const o = ofertasRecebidas_(c, email, datas);
  if (o.length) return 'Você recebeu ' + (o.length === 1 ? 'um pedido de troca' : o.length + ' pedidos de troca') + ' para esses dias (' + o.map(function (l) { return nomeDe_(l.solicitante) + ', ' + dmTroca_(l.data_solicitante) + ' por ' + dmTroca_(l.data_colega); }).join('; ') + '). Para fazer um pedido seu, recuse ' + (o.length === 1 ? 'esse pedido' : 'esses pedidos') + ' antes em "Trocas de escala".';
  return '';
}
/** Motivo para não deixar a pessoa ACEITAR a troca l ('' = pode). */
function bloqueioAceite_(email, l) {
  const datas = [l.data_solicitante, l.data_colega];
  if (compromisso_(null, email, datas, l.troca_id)) return 'Você já aceitou outra troca para esse dia e ela está aguardando a coordenação.';
  if (meusPedidos_(null, email, datas, l.troca_id).length) return 'Você tem um pedido de troca seu em aberto para esse dia. Cancele esse pedido antes de aceitar outro.';
  return '';
}
/** Recusar um pedido em aberto: some das ofertas da pessoa e fica registrado no pedido. */
function apiTrocaRecusarOferta(token, id) {
  const ctx = sessao_(token);
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    let t = tabela_('Trocas'); if (t.cab.indexOf('recusas') < 0) { garantirEspacoColunas_(t.sh, t.cab.length + 1); t.sh.getRange(1, t.cab.length + 1).setValue('recusas'); delete MEMO_['Trocas']; t = tabela_('Trocas'); }
    const l = t.linhas.filter(function (x) { return x.troca_id === id; })[0];
    if (!l || l.status !== 'ABERTA') return { ok: false, msg: 'Este pedido não está mais aberto.' };
    if (l.solicitante === ctx.email) return { ok: false, msg: 'Este pedido é seu. Para desistir, cancele o pedido.' };
    const r = recusasDe_(l); if (r.indexOf(ctx.email) < 0) r.push(ctx.email);
    atualizarLinha_(t, l, { recusas: JSON.stringify(r), atualizado_em: agoraIso_() });
    log_(ctx.email, 'TROCA_OFERTA_RECUSADA', 'Troca', id, l.solicitante, null, { recusou: ctx.email }, '', id);
    const encerrada = encerrarSeTodosRecusaram_(t, l, r);
    return { ok: true, encerrada: encerrada };
  } finally { lock.releaseLock(); }
}
/** Lê de uma vez só algumas colunas de uma aba (sem trazer colunas pesadas). Sem acesso à planilha: lê a aba inteira. */
function colunasAba_(aba, cols) {
  try {
    const sh = db_().getSheetByName(aba), n = sh ? sh.getLastRow() : 0; if (n < 2) return [];
    const cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String), idx = cols.map(function (c) { return cab.indexOf(c); });
    const grupos = []; idx.slice().filter(function (x) { return x >= 0; }).sort(function (a, b) { return a - b; }).forEach(function (x) { const g = grupos[grupos.length - 1]; if (g && x <= g[1] + 1) g[1] = x; else grupos.push([x, x]); });
    const dados = grupos.map(function (g) { return { ini: g[0], v: sh.getRange(2, g[0] + 1, n - 1, g[1] - g[0] + 1).getValues() }; });
    const linhas = []; for (let r = 0; r < n - 1; r++) { const o = {}; cols.forEach(function (c, k) { const x = idx[k]; if (x < 0) { o[c] = ''; return; } const d = dados.filter(function (q) { return x >= q.ini && x < q.ini + q.v[0].length; })[0]; o[c] = String(d.v[r][x - d.ini]); }); linhas.push(o); }
    return linhas;
  } catch (e) { return tabela_(aba).linhas; }
}
/** Detalhe de uma troca para o Histórico (gestão), em partes que o painel pede ao mesmo tempo:
 *  'base' = resumo e pessoas (foto, coordenação, resposta) · 'tl' = linha do tempo · 'apr' = aprovação e horário. Cada parte fica guardada 30 s. */
function apiTrocaDetalheBase_(token, id, parte) {
  const ctx = sessao_(token); parte = parte || 'tudo';
  if (ctx.perfil !== 'GESTAO') { // agente: só acompanha as trocas de que participa (quem pediu ou o colega)
    const lp = tabela_('Trocas').linhas.filter(function (x) { return x.troca_id === id; })[0];
    if (!lp || (lp.solicitante !== ctx.email && lp.colega !== ctx.email)) throw new Error('SEM_PERMISSAO');
  }
  let cache = null; const ck = 'det2_' + parte + '_' + id; try { cache = CacheService.getScriptCache(); const g = cache.get(ck); if (g) return JSON.parse(g); } catch (e) { cache = null; }
  const l = tabela_('Trocas').linhas.filter(function (x) { return x.troca_id === id; })[0];
  if (!l) return { ok: false, msg: 'Troca não encontrada.' };
  const quer = function (p) { return parte === 'tudo' || parte === p; };
  const pes = {}, nomes = {}; tabela_('Pessoas').linhas.forEach(function (p) { pes[p.email] = p; nomes[p.email] = p.nome; });
  const nm = function (e) { return nomeCurto_(nomes[e] || String(e || '').split('@')[0]); };
  const r = { ok: true, id: id, parte: parte, status: l.status, rotulo: (l.status === 'RECUSADA_COLEGA' && !l.colega) ? 'Recusada por todos' : (TROCA_ROTULO[l.status] || l.status), aberto: l.status === 'ABERTA',
    fechado: ['RECUSADA_COLEGA', 'CANCELADA', 'EXPIRADA', 'REJEITADA', 'BLOQUEADA', 'INVALIDADA', 'CANCELADA_AUTO'].indexOf(l.status) >= 0 };
  if (quer('base')) {
    const rt = RT_LEITURA_ || responsaveisTime_(), rec = recusasDe_(l);
    const pc = function (e) { return { email: e, nome: nm(e), coord: rt[e] && rt[e].coord ? rt[e].coord : 'Sem coordenação' }; };
    const dest = colunasAba_('Notificacoes', ['destinatario', 'tipo', 'referencia']).filter(function (n) { return n.referencia === id && n.tipo === 'TROCA_ABERTA'; }).map(function (n) { return n.destinatario; }).filter(function (e, i, a) { return a.indexOf(e) === i; });
    let pessoas = [];
    if (dest.length || (!l.colega && r.aberto)) {
      pessoas = dest.map(function (e) { const o = pc(e); o.estado = e === l.colega ? 'ACEITOU' : rec.indexOf(e) >= 0 ? 'RECUSOU' : r.aberto ? 'AGUARDANDO' : 'SEM_RESPOSTA'; return o; });
      if (l.colega && dest.indexOf(l.colega) < 0) { const o = pc(l.colega); o.estado = 'ACEITOU'; pessoas.unshift(o); }
    } else if (l.colega) {
      const o = pc(l.colega); o.estado = l.status === 'AGUARDANDO_COLEGA' ? 'AGUARDANDO' : l.status === 'RECUSADA_COLEGA' ? 'RECUSOU' : l.aceite_em ? 'ACEITOU' : 'SEM_RESPOSTA'; pessoas = [o];
    }
    const ordem = { ACEITOU: 0, AGUARDANDO: 1, RECUSOU: 2, SEM_RESPOSTA: 3 };
    pessoas.sort(function (a, b) { return ordem[a.estado] - ordem[b.estado] || a.nome.localeCompare(b.nome, 'pt-BR'); });
    const sol = pc(l.solicitante), ps = pes[l.solicitante] || {};
    r.tipo = dest.length || r.aberto ? 'ABERTA' : 'DIRETA'; r.solicitante = sol.nome; r.solEmail = l.solicitante; r.solCoord = sol.coord; r.solCargo = ps.cargo_headcount || ps.cargo || '';
    r.dFolga = l.data_solicitante; r.dTrab = l.data_colega; r.motivo = l.motivo || ''; r.colega = l.colega ? nm(l.colega) : ''; r.criadaEm = l.criada_em; r.pessoas = pessoas; r.obs = l.resultado_validacao || '';
  }
  if (quer('tl')) r.linha = colunasOnde_('Logs', ['data_hora', 'ator', 'acao', 'registro', 'operacao_id'], id, ['registro', 'operacao_id']).filter(function (g) { return g.registro === id || g.operacao_id === id; })
    .map(function (g) { return { em: g.data_hora, quem: g.ator === 'sistema' ? 'Sistema' : nm(g.ator), email: g.ator, acao: g.acao }; }).sort(function (a, b) { return a.em < b.em ? -1 : 1; });
  if (quer('apr')) { const hs = horarioDia_(l.solicitante, l.data_solicitante); r.horario = hs ? hs.i + ' às ' + hs.f : ''; r.colega = l.colega ? nm(l.colega) : ''; try { r.acomp = acompTroca_(l, nomes); } catch (e) { r.acomp = null; } }
  try { if (cache) cache.put(ck, JSON.stringify(r), 30); } catch (e) { /* grande demais: sem cache */ }
  return r;
}

/** Visão operacional (mês e semana): situação de cada agente em cada dia do mês, pela escala publicada.
 *  s = um caractere por dia: T trabalha, F folga, R feriado sem trabalho, V férias, L licença · h = horário do dia (só quando trabalha). Guardado 2 minutos. */
function apiVisaoMes(token, mes) {
  const ctx = sessao_(token); exigirGestao_(ctx); mesValido_(mes);
  let cache = null; const ck = 'vmes_' + mes; try { cache = CacheService.getScriptCache(); const g = cache.get(ck); if (g) return JSON.parse(g); } catch (e) { cache = null; }
  const p = mes.split('-'), nd = new Date(+p[0], +p[1], 0).getDate(), ini = mes + '-01', fim = mes + '-' + ('0' + nd).slice(-2);
  const linhas = {}; tabela_('Escalas').linhas.forEach(function (l) { if (l.mes === mes) linhas[l.email] = l; });
  const af = {}; afastamentosEntre_(ini, fim).forEach(function (a) { (af[a.email] = af[a.email] || []).push(a); });
  const fer = {}; feriadosEntre_(ini, fim, true).forEach(function (f) { fer[f.data] = { nome: f.nome, off: f.trabalhado === 'NAO' }; });
  const teste = contasTeste_(), pessoas = [], coords = {};
  pessoasEscala_().forEach(function (pe) {
    if (pe.perfil !== 'AGENTE' || teste.indexOf(pe.email) >= 0) return;
    const l = linhas[pe.email], dias = l ? (l.dias_publicados || '') : ''; if (!dias) return;
    const a = atuacaoDe_({ atuacao: l.atuacao_publicada }) || {}; let s = ''; const h = [];
    for (let d = 1; d <= nd; d++) {
      const data = mes + '-' + ('0' + d).slice(-2), afa = (af[pe.email] || []).filter(function (x) { return x.inicio <= data && x.fim >= data; })[0];
      if (afa) { s += /FERIAS/i.test(afa.tipo) ? 'V' : 'L'; h.push(''); continue; }
      if (dias.charAt(d - 1) === 'T') { const dd = a.d && a.d[String(d)]; s += 'T'; h.push(dd && dd[0] ? dd[0] + '-' + dd[2] : (pe.entrada && pe.saida ? pe.entrada + '-' + pe.saida : '')); }
      else { s += fer[data] && fer[data].off ? 'R' : 'F'; h.push(''); }
    }
    const co = pe.coord || 'Sem coordenação'; coords[co] = 1;
    pessoas.push({ email: pe.email, nome: pe.nome, coord: co, g: a.g || '', s: s, h: h });
  });
  const dias = []; for (let d = 1; d <= nd; d++) { const data = mes + '-' + ('0' + d).slice(-2); dias.push({ data: data, feriado: fer[data] ? fer[data].nome : '' }); }
  const r = { mes: mes, nd: nd, dias: dias, pessoas: pessoas, coords: Object.keys(coords).sort(function (x, y) { return x.localeCompare(y, 'pt-BR'); }) };
  try { if (cache) cache.put(ck, JSON.stringify(r), 120); } catch (e) { /* grande demais: sem cache */ }
  return r;
}

/* ===================== Desempenho: cadastro em cache · Planilha: limpeza mensal e abas enxutas ===================== */
const ABAS_CADASTRO_ = ['Pessoas', 'Usuarios', 'Coordenacoes'];
/** Chamado depois de qualquer gravação: se a aba faz parte do cadastro, o cache do cadastro é renovado. */
function abaMudou_(nome) {
  if (ABAS_CADASTRO_.indexOf(nome) < 0 && (typeof TB_CACHE_ === 'undefined' || TB_CACHE_.indexOf(nome) < 0)) return;
  delete MEMO_.__pes; try { CacheService.getScriptCache().put('ver_' + nome, String(Date.now()), 21600); } catch (e) { /* sem cache */ }
}
function chaveCachePessoas_() { const v = CacheService.getScriptCache().getAll(ABAS_CADASTRO_.map(function (n) { return 'ver_' + n; })); return 'pes_' + ABAS_CADASTRO_.map(function (n) { return v['ver_' + n] || '0'; }).join('_'); }

const LIMPEZA_DIAS_HIST_ = 90, LIMPEZA_DIAS_FILA_ = 30, FOLGA_COLS_ = 3, FOLGA_LINHAS_ = 100;
/** Deixa a aba só com as linhas e colunas usadas, mais uma folga (as linhas voltam a crescer sozinhas quando o painel grava). Devolve as células liberadas. */
function enxugarAba_(sh) {
  let liberadas = 0; const lr = Math.max(1, sh.getLastRow()), lc = Math.max(1, sh.getLastColumn());
  const colAlvo = lc + FOLGA_COLS_, mc = sh.getMaxColumns(); if (mc > colAlvo) { liberadas += (mc - colAlvo) * sh.getMaxRows(); sh.deleteColumns(colAlvo + 1, mc - colAlvo); }
  const linAlvo = lr + FOLGA_LINHAS_, mr = sh.getMaxRows(); if (mr > linAlvo) { liberadas += (mr - linAlvo) * sh.getMaxColumns(); sh.deleteRows(linAlvo + 1, mr - linAlvo); }
  return liberadas;
}
function planilhaArquivo_() {
  const pr = PropertiesService.getScriptProperties(); let id = pr.getProperty('ARQUIVO_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* recria */ } }
  const ss = SpreadsheetApp.create('Escalas Customer · Arquivo do painel'); pr.setProperty('ARQUIVO_ID', ss.getId()); return ss;
}
/** Mantém na aba só as linhas que passam no teste; as outras vão para o arquivo (se indicado) ou são apagadas. */
function filtrarAba_(sh, manter, arquivar) {
  const v = sh.getDataRange().getValues(); if (v.length < 2) return 0;
  const cab = v[0].map(String), fica = [], sai = [];
  v.slice(1).forEach(function (r) { if (r.join('') === '') return; const o = {}; cab.forEach(function (c, j) { o[c] = String(r[j]); }); (manter(o) ? fica : sai).push(r.map(String)); });
  if (!sai.length) return 0;
  if (arquivar) {
    const arq = planilhaArquivo_(); let a = arq.getSheetByName(arquivar);
    if (!a) { a = arq.insertSheet(arquivar); a.getRange(1, 1, 1, cab.length).setValues([cab]); a.setFrozenRows(1); const s1 = arq.getSheetByName('Sheet1') || arq.getSheetByName('Página1'); if (s1 && arq.getSheets().length > 1) arq.deleteSheet(s1); }
    const ini = a.getLastRow() + 1, falta = ini + sai.length - 1 - a.getMaxRows(); if (falta > 0) a.insertRowsAfter(a.getMaxRows(), falta);
    a.getRange(ini, 1, sai.length, cab.length).setValues(celTexto_(sai));
  }
  // grava primeiro o que fica e depois apaga só o que sobrou até a última linha lida: uma linha gravada durante a limpeza (um login, por exemplo) nunca é sobrescrita
  const lidas = v.length;
  if (fica.length) sh.getRange(2, 1, fica.length, cab.length).setValues(celTexto_(fica));
  if (lidas > fica.length + 1) sh.getRange(fica.length + 2, 1, lidas - fica.length - 1, cab.length).clearContent();
  return sai.length;
}
/** Limpeza mensal: sessões e tokens vencidos, histórico e notificações com mais de 90 dias (para o arquivo, guardando o último login de cada pessoa), fila do Slack enviada há mais de 30 dias e abas enxutas. */
function executarLimpeza_() {
  const lock = LockService.getScriptLock(); if (!lock.tryLock(30000)) return { ok: false, msg: 'Painel ocupado; tenta de novo depois.' };
  const out = {};
  try {
    const ss = db_(), agora = agoraIso_(), iso = function (dias) { return Utilities.formatDate(new Date(Date.now() - dias * 864e5), 'America/Fortaleza', "yyyy-MM-dd'T'HH:mm:ss"); };
    const corteHist = iso(LIMPEZA_DIAS_HIST_), corteFila = iso(LIMPEZA_DIAS_FILA_);
    out.sessoes = filtrarAba_(ss.getSheetByName('Sessoes'), function (o) { return !o.revogada_em && String(o.expira_em) > agora; });
    out.tokens = filtrarAba_(ss.getSheetByName('TokensSenha'), function (o) { return !o.usado_em && String(o.expira_em) > agora; });
    const ultLogin = {}; tabela_('Logs').linhas.forEach(function (l) { if (l.acao === 'LOGIN') { const e = l.afetado || l.ator; if (!ultLogin[e] || l.data_hora > ultLogin[e]) ultLogin[e] = l.data_hora; } });
    out.historico = filtrarAba_(ss.getSheetByName('Logs'), function (o) { return String(o.data_hora) >= corteHist || (o.acao === 'LOGIN' && ultLogin[o.afetado || o.ator] === o.data_hora); }, 'Logs');
    out.notificacoes = filtrarAba_(ss.getSheetByName('Notificacoes'), function (o) { return String(o.criada_em) >= corteHist; }, 'Notificacoes');
    try { out.filaSlack = filtrarAba_(abaFilaSlack_(), function (o) { return o.status === 'PENDENTE' || String(o.criada_em) >= corteFila; }); } catch (e) { out.filaSlack = 'sem fila'; }
    let cel = 0; ss.getSheets().forEach(function (sh) { cel += enxugarAba_(sh); }); try { cel += enxugarAba_(abaFilaSlack_()); } catch (e) { /* sem fila */ }
    out.celulasLiberadas = cel; MEMO_ = {};
    PropertiesService.getScriptProperties().setProperty('LIMPEZA_MES', agora.slice(0, 7));
    log_('sistema', 'LIMPEZA_MENSAL', 'Sistema', 'planilha', '', null, out, 'Limpeza mensal automática da planilha');
    out.ok = true; return out;
  } finally { lock.releaseLock(); }
}
/** Roda a limpeza uma vez por mês, no primeiro sinal de presença do mês (ninguém espera por ela). */
function limpezaSePreciso_() {
  try {
    const m = hojeIso_().slice(0, 7); if (PropertiesService.getScriptProperties().getProperty('LIMPEZA_MES') === m) return;
    const hora = +Utilities.formatDate(new Date(), 'America/Fortaleza', 'H'), dia = +hojeIso_().slice(8, 10);
    if (hora >= 8 && dia < 3) return; // de madrugada, ou a partir do dia 3: não segura a trava no meio do expediente dos primeiros dias
    const c = CacheService.getScriptCache(); if (c.get('limpeza_tentativa')) return; c.put('limpeza_tentativa', '1', 3600);
    executarLimpeza_();
  } catch (e) { /* tenta de novo na próxima hora */ }
}

/** Abre colunas na aba, se faltar espaço, antes de gravar um cabeçalho novo (as abas ficam enxutas depois da limpeza). */
function garantirEspacoColunas_(sh, n) { try { const mc = sh.getMaxColumns(); if (mc < n) sh.insertColumnsAfter(mc, n - mc); } catch (e) { /* aba sem esse recurso */ } }

/* ===================== Histórico: número de novidades na aba (só para a gestão; sem e-mail, Slack ou sino) ===================== */
/** Registros novos no Histórico desde a última visita da pessoa: ações de outras pessoas ou do sistema; logins e senhas (aba Acessos) ficam de fora. */
function contarHistoricoNovo_(email) {
  const pr = PropertiesService.getScriptProperties(), k = 'histv_' + email, visto = pr.getProperty(k);
  if (!visto) { pr.setProperty(k, agoraIso_()); return 0; } // primeira vez: começa do zero, não com o histórico antigo
  const c = CacheService.getScriptCache(), ck = 'histn_' + email + '_' + visto, g = c.get(ck); if (g !== null) return +g;
  let n = 0; colunasAba_('Logs', ['data_hora', 'ator', 'acao']).forEach(function (l) { if (String(l.data_hora) > visto && l.ator !== email && ACOES_SEGURANCA.indexOf(l.acao) < 0) n++; });
  try { c.put(ck, String(n), 60); } catch (e) { /* sem cache */ }
  return n;
}
/** Abriu o Histórico: zera o número da aba. */
function apiHistoricoVisto(token) { const ctx = sessao_(token); exigirGestao_(ctx); PropertiesService.getScriptProperties().setProperty('histv_' + ctx.email, agoraIso_()); return { ok: true }; }

/* ===================== Papel de cada pessoa da gestão (cargo exibido no painel, com cor própria) ===================== */
/** WFM (People quando o squad é People), Gerente, Gerente executiva, Coordenação ou Analista; quem não é da gestão é Agente. */
function papelPainel_(email, u, p) {
  if (ehSuperadmin_(email)) return /people/i.test((p && p.squad) || '') ? { rot: 'People', cls: 'people' } : { rot: 'WFM', cls: 'ph' };
  if (!u || u.perfil !== 'GESTAO') return { rot: 'Agente', cls: 'agente' };
  const pg = String(u.papel_gestao || '');
  if (/^(coo|ceo|cfo|cto)\b|diretor/i.test(pg)) return { rot: 'Diretoria', cls: 'diretoria' };
  if (/execut/i.test(pg)) return { rot: /executivo/i.test(pg) ? 'Gerente Executivo' : 'Gerente Executiva', cls: 'gerente' };
  if (/gerent/i.test(pg)) return { rot: 'Gerente', cls: 'gerente' };
  if (/coord/i.test(pg)) return { rot: 'Coordenação', cls: 'coord' };
  if (/analist/i.test(pg)) return { rot: 'Analista', cls: 'analista' };
  return { rot: 'Gestão', cls: 'gestao' };
}
/** Papéis de todas as pessoas da gestão (para os selos do Histórico, de Acessos e do topo). */
function apiPapeis(token) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  const pes = {}; tabela_('Pessoas').linhas.forEach(function (p) { pes[p.email] = p; });
  const r = {}; tabela_('Usuarios').linhas.forEach(function (u) { if (u.perfil === 'GESTAO') r[u.email] = papelPainel_(u.email, u, pes[u.email]); });
  return r;
}

/* ===================== Ajustes de fila no Twilio (Visão operacional > Dia) ===================== */
/** Avisos do dia para quem precisa mudar de fila: troca de frente no turno, início de turno em fila diferente do último dia e primeiro dia/volta de afastamento.
 *  A pessoa entra em pausa 10 min antes do horário da troca. Guardado 5 min. */
function ajustesFilaDoDia_(data) {
  const ck = 'afila8_' + data; try { const g = CacheService.getScriptCache().get(ck); if (g) return JSON.parse(g); } catch (e) { /* sem cache */ }
  const mais = function (d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const inicioPainel = String(config_('mes_inicial') || '2026-11') + '-01';
  const porMes = {}, linhasDe = function (mes) { if (!porMes[mes]) { porMes[mes] = {}; tabela_('Escalas').linhas.forEach(function (l) { if (l.mes === mes) porMes[mes][l.email] = l; }); } return porMes[mes]; };
  const af = {}; afastamentosEntre_(mais(data, -10), data).forEach(function (a) { (af[a.email] = af[a.email] || []).push(a); });
  const FILAS = ['0800', 'chat']; // só as filas da Twilio: o assíncrono não tem ajuste de fila
  /* seg a sex: muda de fila quem está na Pós-pagamento, Ativo RA, Ativo Retenção ou Ativo Preventiva (só o Ticket RA fica na mesma fila); sáb e dom: todo chat + 0800 muda entre Pós-pagamento e 0800, menos quem está no Ticket RA, que fica em 0800 + Ticket RA */
  const dow = new Date(data + 'T12:00:00Z').getUTCDay(), fds = dow === 0 || dow === 6, FPOS = 'Pós-pagamento', listaF = filasChatLista_(), filasCh = filasChatNoDia_(data);
  const frentes = function (email, d) {
    if ((af[email] || []).some(function (a) { return a.inicio <= d && a.fim >= d; })) return null;
    const l = linhasDe(d.slice(0, 7))[email]; if (!l) return null;
    const dia = +d.slice(8); if ((l.dias_publicados || '').charAt(dia - 1) !== 'T') return null;
    const atu = atuacaoDe_({ atuacao: l.atuacao_publicada || '' }), x = atu && atu.d ? atu.d[String(dia)] : null; if (!x) return null;
    const bl = blocosPadrao_(x, atu.m).filter(function (b) { return FILAS.indexOf(b[0]) >= 0; }).sort(function (a, b) { return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; });
    bl.alm = x[1] || ''; return bl;
  };
  const mi = function (h) { const p = String(h || '').split(':'); return (+p[0]) * 60 + (+p[1] || 0); };
  const menos10 = function (h) { const p = h.split(':'), n = (+p[0]) * 60 + (+p[1]) - 10; return ('0' + Math.floor(n / 60)).slice(-2) + ':' + ('0' + (n % 60)).slice(-2); };
  const ev = [];
  pessoasEscala_().forEach(function (p) {
    if (p.perfil !== 'AGENTE') return;
    const bl = frentes(p.email, data); if (!bl || !bl.length) return;
    let fch = filasCh[p.email] || ''; if (fch && listaF.indexOf(fch) < 0) fch = ''; const temChat = bl.some(function (b) { return b[0] === 'chat'; });
    if (temChat && fch === 'Ticket RA') return;
    const add = function (tipo, hora, de, para, extra) { const o = { chave: p.email + '|' + hora + '|' + para, tipo: tipo, filaChat: temChat ? (fds ? FPOS : fch) : '', semFila: !fds && temChat && !fch, hora: hora, pausa: tipo === 'muda' && !(extra && extra.almoco) ? menos10(hora) : '', email: p.email, nome: p.nome, coord: p.coord || '', de: de, para: para }; if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; }); ev.push(o); };
    // fila anterior: a última frente do último dia trabalhado (até 10 dias, dentro do painel); sem esse dia, a pessoa é tratada como sem fila
    let ant = null;
    for (let k = 1; k <= 10; k++) { const d = mais(data, -k); if (d < inicioPainel) break; const b2 = frentes(p.email, d); if (b2 && b2.length) { ant = b2[b2.length - 1][0]; break; } }
    if (!ant) add('confere', bl[0][1], '', bl[0][0]);
    else if (ant && ant !== bl[0][0]) add('entrada', bl[0][1], ant, bl[0][0]);
    for (let i = 1; i < bl.length; i++) if (bl[i][0] !== bl[i - 1][0]) {
      // volta do almoço já em outra fila: a troca é feita no começo do almoço (sem pausa antes, a pessoa já está saindo)
      const la = bl.alm ? mi(bl.alm) : -1, noAlmoco = la >= 0 && mi(bl[i][1]) === la + 60 && mi(bl[i - 1][2]) <= la;
      if (noAlmoco) add('muda', bl.alm, bl[i - 1][0], bl[i][0], { almoco: true, volta: bl[i][1], chaveAnt: p.email + '|' + bl[i][1] + '|' + bl[i][0] });
      else add('muda', bl[i][1], bl[i - 1][0], bl[i][0]);
    }
  });
  ev.sort(function (a, b) { return a.hora < b.hora ? -1 : a.hora > b.hora ? 1 : a.nome.localeCompare(b.nome, 'pt-BR'); });
  try { CacheService.getScriptCache().put(ck, JSON.stringify(ev), 300); } catch (e) { /* grande demais */ }
  return ev;
}
function apiAjustesFila(token, data) {
  const ctx = sessao_(token); exigirGestao_(ctx); data = dataIso_(data) || hojeIso_();
  let feitos = {}; try { feitos = JSON.parse(PropertiesService.getScriptProperties().getProperty('filaok_' + data) || '{}'); } catch (e) { feitos = {}; }
  const itens = afFiltrarPresenca_(data, ajustesFilaDoDia_(data));
  itens.forEach(function (it) { if (it.chaveAnt && feitos[it.chaveAnt] && !feitos[it.chave]) feitos[it.chave] = feitos[it.chaveAnt]; }); // marcado como feito antes da mudança de horário
  return { data: data, itens: itens, feitos: feitos };
}
/** Marca (ou desmarca) um ajuste de fila como feito, visível para toda a gestão. */
function apiAjusteFilaFeito(token, data, chave, feito) {
  const ctx = sessao_(token); exigirGestao_(ctx); data = dataIso_(data); if (!data || !chave) throw new Error('Ajuste inválido.');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const pr = PropertiesService.getScriptProperties(), k = 'filaok_' + data; let m = {}; try { m = JSON.parse(pr.getProperty(k) || '{}'); } catch (e) { m = {}; }
    const quando = agoraIso_(), quem = { por: ctx.email, nome: nomeCurto_((ctx.pessoa && ctx.pessoa.nome) || ctx.email), em: quando.slice(11, 16), quando: quando };
    [].concat(chave).slice(0, 300).forEach(function (k) { k = String(k); if (feito) { if (!m[k]) m[k] = quem; } else delete m[k]; }); // um ou vários ("marcar todos")
    pr.setProperty(k, JSON.stringify(m)); return { ok: true, feitos: m };
  } finally { lock.releaseLock(); }
}

/* ===================== Áreas resolvedoras do assíncrono (Visão do dia) ===================== */
/** Cada linha = "a partir do dia `desde`, a pessoa `email` está na área `area`". A área de um dia é a última definição até ele.
 *  Alterar um dia nunca muda os anteriores; dias que já passaram não podem ser alterados. */
const AREAS_ASS_PADRAO = 'N1,N2,N3,Customer Atendimento,Reclame Aqui,Port_out';
const ABA_AREAS_ASS = 'AreasAssincrono';
const CAB_AREAS_ASS = ['email', 'area', 'desde', 'definido_por', 'definido_em'];
function areasAssLista_() { return String(config_('areas_assincrono') || AREAS_ASS_PADRAO).split(',').map(function (s) { return s.trim(); }).filter(String); }
function abaAreasAss_() {
  const ss = db_(); let sh = ss.getSheetByName(ABA_AREAS_ASS);
  if (!sh) { sh = ss.insertSheet(ABA_AREAS_ASS); sh.getRange(1, 1, 1, CAB_AREAS_ASS.length).setValues([CAB_AREAS_ASS]); sh.setFrozenRows(1); }
  return sh;
}
function areasAssNoDia_(data) {
  abaAreasAss_(); const area = {}, desde = {};
  tabela_(ABA_AREAS_ASS).linhas.forEach(function (l) { if (l.desde && l.desde <= data && (!desde[l.email] || l.desde >= desde[l.email])) { desde[l.email] = l.desde; area[l.email] = l.area; } });
  return area;
}
function apiAreasAssinc(token, data) {
  const ctx = sessao_(token); exigirGestao_(ctx); data = dataIso_(data) || hojeIso_();
  return { data: data, areas: areasAssLista_(), atual: areasAssNoDia_(data), podeEditar: data >= hojeIso_() };
}
/** Define a área de uma ou várias pessoas a partir de `data` (hoje ou futuro). area '' = sem área. */
function apiAreaAssincDefinir(token, data, emails, area) {
  const ctx = sessao_(token); exigirGestao_(ctx); data = dataIso_(data);
  if (!data) throw new Error('Data inválida.');
  if (data < hojeIso_()) throw new Error('Este dia já passou: as áreas de dias anteriores não podem ser alteradas.');
  area = String(area || '').trim();
  if (area && areasAssLista_().indexOf(area) < 0) throw new Error('Área resolvedora inválida.');
  emails = [].concat(emails || []).map(function (e) { return String(e).trim().toLowerCase(); }).filter(function (e) { return /@/.test(e); }).slice(0, 300);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    abaAreasAss_(); delete MEMO_[ABA_AREAS_ASS];
    const t = tabela_(ABA_AREAS_ASS), antes = areasAssNoDia_(data), quem = ctx.email, em = agoraIso_(), novos = [];
    emails.forEach(function (e) {
      const l = t.linhas.filter(function (x) { return x.email === e && x.desde === data; })[0];
      if (l) { if (l.area !== area) atualizarLinha_(t, l, { area: area, definido_por: quem, definido_em: em }); }
      else if ((antes[e] || '') !== area) novos.push({ email: e, area: area, desde: data, definido_por: quem, definido_em: em });
    });
    appendLinhas_(ABA_AREAS_ASS, novos); delete MEMO_[ABA_AREAS_ASS];
    return { ok: true, data: data, atual: areasAssNoDia_(data) };
  } finally { lock.releaseLock(); }
}

/* ===================== Filas do chat (Visão do dia · Twilio por canal) ===================== */
/** Mesma regra das áreas do assíncrono: "a partir do dia `desde`, a pessoa `email` atende a fila `area` no chat". */
const FILAS_CHAT_PADRAO = 'Pós-pagamento,Reclame Aqui,Retenção,Preventiva';
const ABA_FILAS_CHAT = 'FilasChat';
function filasChatLista_() { return String(config_('filas_chat') || FILAS_CHAT_PADRAO).split(',').map(function (s) { return s.trim(); }).filter(String); }
function abaFilasChat_() {
  const ss = db_(); let sh = ss.getSheetByName(ABA_FILAS_CHAT);
  if (!sh) { sh = ss.insertSheet(ABA_FILAS_CHAT); sh.getRange(1, 1, 1, CAB_AREAS_ASS.length).setValues([CAB_AREAS_ASS]); sh.setFrozenRows(1); }
  return sh;
}
function filasChatNoDia_(data) {
  abaFilasChat_(); const fila = {}, desde = {};
  tabela_(ABA_FILAS_CHAT).linhas.forEach(function (l) { if (l.desde && l.desde <= data && (!desde[l.email] || l.desde >= desde[l.email])) { desde[l.email] = l.desde; fila[l.email] = l.area; } });
  return fila;
}
function apiFilasChat(token, data) {
  const ctx = sessao_(token); exigirGestao_(ctx); data = dataIso_(data) || hojeIso_();
  return { data: data, areas: filasChatLista_(), atual: filasChatNoDia_(data), podeEditar: data >= hojeIso_() };
}
/** Define a fila do chat de uma ou várias pessoas a partir de `data` (hoje ou futuro). fila '' = sem fila. */
function apiFilaChatDefinir(token, data, emails, fila) {
  const ctx = sessao_(token); exigirGestao_(ctx); data = dataIso_(data);
  if (!data) throw new Error('Data inválida.');
  if (data < hojeIso_()) throw new Error('Este dia já passou: as filas de dias anteriores não podem ser alteradas.');
  fila = String(fila || '').trim();
  if (fila && filasChatLista_().indexOf(fila) < 0) throw new Error('Fila do chat inválida.');
  emails = [].concat(emails || []).map(function (e) { return String(e).trim().toLowerCase(); }).filter(function (e) { return /@/.test(e); }).slice(0, 300);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    abaFilasChat_(); delete MEMO_[ABA_FILAS_CHAT];
    const t = tabela_(ABA_FILAS_CHAT), antes = filasChatNoDia_(data), quem = ctx.email, em = agoraIso_(), novos = [];
    emails.forEach(function (e) {
      const l = t.linhas.filter(function (x) { return x.email === e && x.desde === data; })[0];
      if (l) { if (l.area !== fila) atualizarLinha_(t, l, { area: fila, definido_por: quem, definido_em: em }); }
      else if ((antes[e] || '') !== fila) novos.push({ email: e, area: fila, desde: data, definido_por: quem, definido_em: em });
    });
    appendLinhas_(ABA_FILAS_CHAT, novos); delete MEMO_[ABA_FILAS_CHAT];
    return { ok: true, data: data, atual: filasChatNoDia_(data) };
  } finally { lock.releaseLock(); }
}

/* ===================== Controle de logados (presença dos agentes) ===================== */
/** Um registro por pessoa e dia. Sem registro, a situação é calculada na hora:
 *  folga/férias/licença pela escala; escalado sem registro = aguardando até 1 h depois da entrada e falta injustificada depois.
 *  Nada daqui vai para o Histórico. */
const ABA_PRES = 'Presencas', CAB_PRES = ['data', 'email', 'status', 'origem', 'registrado_em', 'registrado_por'];
const PRES_PRAZO_MIN = 60, PRES_ANTES_MIN = 60;
const PRES_ROT = { PRESENTE: 'Presente', AGUARDANDO: 'Aguardando', FALTA: 'Falta Injustificada', ATESTADO: 'Atestado', COMPENSA: 'Compensa / Day Off', DESLIGADO: 'Desligado', MOVIMENTACAO: 'Movimentação', FOLGA: 'Folga', FERIAS: 'Férias', LICENCA: 'Licença', SEM_REGISTRO: 'Sem Registro', SEM_ESCALA: 'Sem Escala', MEDIDA: 'Medida Disciplinar' };
/** Situações que a gestão escolhe no dia a dia (Desligado, Movimentação e Medida Disciplinar ficam só no histórico). */
const PRES_MANUAIS = ['PRESENTE', 'FALTA', 'ATESTADO', 'COMPENSA', 'FOLGA', 'FERIAS', 'LICENCA'];
/** Antes desta data a presença vem do histórico importado das planilhas (aba PresencasHistorico). */
const PRES_HIST_ATE = '2026-11-01';
const PRES_TRABALHO = ['PRESENTE', 'FALTA', 'ATESTADO', 'COMPENSA', 'MEDIDA', 'MOVIMENTACAO'];
function presInicio_() { return String(config_('presenca_inicio') || '2026-11-04'); }
function abaPres_() {
  const ss = db_(); let sh = ss.getSheetByName(ABA_PRES);
  if (!sh) { sh = ss.insertSheet(ABA_PRES); sh.getRange(1, 1, 1, CAB_PRES.length).setValues([CAB_PRES]); sh.setFrozenRows(1); }
  return sh;
}
function presRegistros_(data) {
  if (data < PRES_HIST_ATE) { const m = {}; if (!db_().getSheetByName('PresencasHistorico')) return m; tabela_('PresencasHistorico').linhas.forEach(function (l) { if (l.data === data) m[String(l.email).toLowerCase()] = l; }); return m; }
  abaPres_(); const m = {}; tabela_(ABA_PRES).linhas.forEach(function (l) { if (l.data === data) m[String(l.email).toLowerCase()] = l; }); return m; }
function agoraMinFort_() { const s = Utilities.formatDate(new Date(), 'America/Fortaleza', 'HH:mm'); return (+s.slice(0, 2)) * 60 + (+s.slice(3, 5)); }
function minDe_(h) { const p = String(h || '').split(':'); return p.length < 2 || p[0] === '' ? null : (+p[0]) * 60 + (+p[1]); }
function hmS_(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
/** Quem trabalha em cada dia, com horário e almoço: exatamente o mesmo cálculo da Visão do dia. */
function diaInterno_(data) { const sO = sessao_; try { sessao_ = function () { return { email: 'sistema', perfil: 'GESTAO' }; }; return apiVisaoDia('interno', data); } finally { sessao_ = sO; } }
function presSituacao_(o, reg, data, hoje, agoraMin, inicio) {
  if (reg && reg.status) return { st: reg.status, auto: false, origem: reg.origem || '', em: reg.registrado_em || '', por: reg.registrado_por || '' };
  if (o.sit === 'FERIAS') return { st: 'FERIAS', auto: true };
  if (o.sit === 'LICENCA') return { st: 'LICENCA', auto: true };
  if (o.sit === 'F') return { st: 'FOLGA', auto: true };
  if (o.sit !== 'T') return { st: 'SEM_ESCALA', auto: true };
  if (data < inicio) return { st: 'SEM_REGISTRO', auto: true };
  const ent = minDe_(o.i), lim = ent === null ? null : ent + PRES_PRAZO_MIN;
  if (data < hoje || (data === hoje && lim !== null && agoraMin >= lim)) return { st: 'FALTA', auto: true, prazo: lim };
  return { st: 'AGUARDANDO', auto: true, prazo: lim };
}
/** Grava (ou volta para o automático, com status '') a presença de uma ou várias pessoas num dia. */
function presGravar_(data, emails, status, origem, por, em) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    abaPres_(); delete MEMO_[ABA_PRES];
    const t = tabela_(ABA_PRES), novos = [];
    emails.forEach(function (e) {
      const l = t.linhas.filter(function (x) { return x.data === data && String(x.email).toLowerCase() === e; })[0];
      const o = { status: status, origem: status ? origem : '', registrado_em: status ? em : '', registrado_por: status ? por : '' };
      if (l) atualizarLinha_(t, l, o); else if (status) novos.push(Object.assign({ data: data, email: e }, o));
    });
    appendLinhas_(ABA_PRES, novos); delete MEMO_[ABA_PRES];
  } finally { lock.releaseLock(); }
  presPendLimpar_(); lgDiaLimpar_(data);
}
/** Agente: deve ver a tela de presença agora? */
function apiPresencaHoje(token) {
  const ctx = sessao_(token), hoje = hojeIso_(), out = { mostrar: false, data: hoje };
  if (ctx.perfil !== 'AGENTE' || hoje < presInicio_() || contasTeste_().indexOf(ctx.email) >= 0) return out;
  const o = diaInterno_(hoje).itens.filter(function (x) { return x.email === ctx.email; })[0];
  if (!o || o.sit !== 'T') return out;
  const reg = presRegistros_(hoje)[ctx.email], ag = agoraMinFort_(), s = presSituacao_(o, reg, hoje, hoje, ag, presInicio_()), ent = minDe_(o.i);
  out.i = o.i; out.a = o.a || ''; out.f = o.f; out.status = s.st; out.prazo = s.prazo != null ? hmS_(s.prazo) : (ent !== null ? hmS_(ent + PRES_PRAZO_MIN) : '');
  if (s.st === 'PRESENTE') { out.presente = true; out.registradoEm = String(s.em || '').slice(11, 16); return out; }
  if (reg && reg.status && reg.status !== 'FALTA') return out;
  if (ent !== null && ag < ent - PRES_ANTES_MIN) { out.cedo = true; out.abreAs = hmS_(ent - PRES_ANTES_MIN); return out; }
  out.mostrar = true; out.atrasado = s.st === 'FALTA'; return out;
}
/** Agente: registra a própria presença (só no próprio dia). */
function apiMarcarPresenca(token) {
  const ctx = sessao_(token); if (ctx.perfil !== 'AGENTE') throw new Error('Só agentes registram a própria presença.');
  const r = apiPresencaHoje(token);
  if (r.presente) return { ok: true, ja: true, em: r.registradoEm };
  if (!r.mostrar) throw new Error('Não há presença para registrar agora.');
  const em = agoraIso_(); presGravar_(r.data, [ctx.email], 'PRESENTE', 'AGENTE', ctx.email, em);
  return { ok: true, em: String(em).slice(11, 16) };
}
/** Gestão: controle de logados de um dia. */
function apiControleLogadosCalc_(token, data) {
  const ctx = sessao_(token); exigirGestao_(ctx); data = dataIso_(data) || hojeIso_();
  const hoje = hojeIso_(), ag = agoraMinFort_(), ini = presInicio_(), v = diaInterno_(data), reg = presRegistros_(data), teste = contasTeste_();
  const pes = {}; pessoasEscala_().forEach(function (p) { pes[p.email] = p; });
  const nomeDe = function (e) { const p = pes[e]; return p ? nomeCurto_(p.nome) : String(e || '').split('@')[0]; };
  let base = (v.itens || []).filter(function (o) { return o.perfil === 'AGENTE' && teste.indexOf(o.email) < 0; });
  if (data < PRES_HIST_ATE) {
    /* meses importados: não há escala no painel; quem tem situação de trabalho no dia conta como escalado, e quem já saiu também aparece */
    const sitDe = function (st) { return PRES_TRABALHO.indexOf(st) >= 0 ? 'T' : st === 'FOLGA' ? 'F' : st === 'FERIAS' ? 'FERIAS' : st === 'LICENCA' ? 'LICENCA' : 'SEM'; };
    base = base.map(function (o) { const r = reg[o.email]; return Object.assign({}, o, { sit: r && r.status ? sitDe(r.status) : 'SEM', i: '', a: '', f: '' }); });
    const hp = histPessoas_(data.slice(0, 7));
    base = base.map(function (o) { const h = hp[o.email]; return h ? Object.assign(o, { nome: h.nome || o.nome, coord: h.coord || o.coord, cargo: h.cargo || o.cargo }) : o; });
    const ja = {}; base.forEach(function (o) { ja[o.email] = 1; });
    const todos = {}, mapa = coordenacoes_(); tabela_('Pessoas').linhas.forEach(function (p) { todos[String(p.email).toLowerCase()] = p; });
    Object.keys(reg).forEach(function (e) { if (ja[e] || teste.indexOf(e) >= 0) return; const p = todos[e], st = reg[e].status;
      const h = hp[e];
      base.push({ email: e, nome: h && h.nome ? h.nome : (p ? nomeCurto_(p.nome) : e.split('@')[0]), coord: h && h.coord ? h.coord : (p ? coordDe_(p, mapa).nome : 'Sem coordenação'), cargo: h && h.cargo ? h.cargo : (p ? p.cargo_headcount : ''), perfil: 'AGENTE', sit: sitDe(st), i: '', a: '', f: '' });
      pes[e] = pes[e] || { squad: (h && h.squad) || (p && p.squad) || '' }; });
  }
  const itens = base.map(function (o) {
    const s = presSituacao_(o, reg[o.email], data, hoje, ag, ini), trab = o.sit === 'T' && !!o.i;
    return { email: o.email, nome: o.nome, coord: o.coord || 'Sem coordenação', squad: (pes[o.email] || {}).squad || '', cargo: o.cargo || '', sit: o.sit,
      i: trab ? o.i : '', a: trab ? (o.a || '') : '', f: trab ? o.f : '', hist: data < PRES_HIST_ATE, st: s.st, auto: s.auto, origem: s.origem || '',
      em: s.em ? String(s.em).slice(11, 16) : '', emData: s.em ? String(s.em).slice(0, 10) : '', por: s.por ? nomeDe(s.por) : '', prazo: s.prazo != null ? hmS_(s.prazo) : '' };
  });
  try { presPeriodosAplicar_(itens, data); } catch (e) { /* o período é só informação */ }
  return { data: data, hoje: hoje, agora: hmS_(ag), inicio: ini, prazoMin: PRES_PRAZO_MIN, rotulos: PRES_ROT, manuais: PRES_MANUAIS, feriado: v.feriado, coordResp: coordResp_(), eu: nomeCurto_((ctx.pessoa && ctx.pessoa.nome) || ctx.email), itens: itens };
}
/** Gestão: define a presença (status '' = volta para o automático). Pode ser qualquer dia. */
function apiDefinirPresenca(token, data, emails, status) {
  const ctx = sessao_(token); exigirGestao_(ctx); data = dataIso_(data); if (!data) throw new Error('Data inválida.');
  status = String(status || '').toUpperCase(); if (status && PRES_MANUAIS.indexOf(status) < 0) throw new Error('Situação inválida.');
  emails = [].concat(emails || []).map(function (e) { return String(e).trim().toLowerCase(); }).filter(function (e) { return /@/.test(e); }).slice(0, 300);
  const em = agoraIso_(); presGravar_(data, emails, status, 'GESTAO', ctx.email, em);
  return { ok: true, em: String(em).slice(11, 16), por: nomeCurto_((ctx.pessoa && ctx.pessoa.nome) || ctx.email) };
}

/** Gestão: dashboard do mês. Mesmas regras do controle do dia; dias futuros não contam. */
function apiControleLogadosMes(token, mes) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  const hoje = hojeIso_(); mes = /^\d{4}-\d{2}$/.test(String(mes || '')) ? String(mes) : hoje.slice(0, 7);
  const ag = agoraMinFort_(), ini = presInicio_(), teste = contasTeste_();
  const nDias = new Date(+mes.slice(0, 4), +mes.slice(5, 7), 0).getDate(), dias = [];
  for (let d = 1; d <= nDias; d++) dias.push(mes + '-' + ('0' + d).slice(-2));
  const ate = dias.filter(function (d) { return d <= hoje; });
  const pessoas = {}, porDia = {}; dias.forEach(function (d) { porDia[d] = { esc: 0, c: {} }; });
  const mapa = coordenacoes_(), todos = {}; tabela_('Pessoas').linhas.forEach(function (p) { todos[String(p.email).toLowerCase()] = p; });
  const add = function (e, info, data, st, escalado) {
    const p = pessoas[e] || (pessoas[e] = { email: e, nome: info.nome, coord: info.coord, squad: info.squad || '', cargo: info.cargo || '', esc: 0, c: {} });
    p.c[st] = (p.c[st] || 0) + 1; (p.d || (p.d = {}))[data] = st; if (escalado) { p.esc++; porDia[data].esc++; } porDia[data].c[st] = (porDia[data].c[st] || 0) + 1;
  };
  if (mes < PRES_HIST_ATE.slice(0, 7)) {
    const hp = histPessoas_(mes);
    if (db_().getSheetByName('PresencasHistorico')) tabela_('PresencasHistorico').linhas.forEach(function (l) {
      if (String(l.data).slice(0, 7) !== mes || !porDia[l.data] || l.data > hoje) return; const e = String(l.email).toLowerCase(); if (teste.indexOf(e) >= 0) return;
      const p = todos[e], h = hp[e], st = l.status === 'MEDIDA' ? 'FALTA' : l.status;
      add(e, { nome: h && h.nome ? h.nome : (p ? nomeCurto_(p.nome) : e.split('@')[0]), coord: h && h.coord ? h.coord : (p ? coordDe_(p, mapa).nome : 'Sem coordenação'), squad: h && h.squad ? h.squad : (p ? p.squad : ''), cargo: h && h.cargo ? h.cargo : (p ? p.cargo_headcount : '') }, l.data, st, PRES_TRABALHO.indexOf(st) >= 0);
    });
  } else {
    const pes = pessoasEscala_().filter(function (p) { return p.perfil === 'AGENTE' && teste.indexOf(p.email) < 0; });
    const esc = {}; tabela_('Escalas').linhas.forEach(function (l) { if (l.mes === mes) esc[l.email] = l; });
    const af = afastamentosEntre_(dias[0], dias[nDias - 1]), reg = {};
    abaPres_(); delete MEMO_[ABA_PRES]; tabela_(ABA_PRES).linhas.forEach(function (l) { if (String(l.data).slice(0, 7) === mes) reg[l.data + '|' + String(l.email).toLowerCase()] = l; });
    pes.forEach(function (p) {
      const l = esc[p.email], pub = l ? String(l.dias_publicados || '') : '', atu = l ? atuacaoDe_({ atuacao: l.atuacao_publicada || '' }) : null;
      ate.forEach(function (data) {
        const dia = +data.slice(8), c = pub.charAt(dia - 1) || '', x = atu && atu.d ? atu.d[String(dia)] : null;
        const a = af.filter(function (z) { return z.email === p.email && z.inicio <= data && z.fim >= data; })[0];
        const o = { sit: a ? a.tipo : (c === 'T' ? 'T' : c === 'F' ? 'F' : 'SEM'), i: x ? x[0] : p.entrada };
        const s = presSituacao_(o, reg[data + '|' + p.email], data, hoje, ag, ini);
        add(p.email, p, data, s.st, o.sit === 'T');
      });
    });
  }
  const meses = []; for (let m = '2026-01'; m <= hoje.slice(0, 7); ) { meses.push(m); const y = +m.slice(0, 4), mm = +m.slice(5, 7); m = mm === 12 ? (y + 1) + '-01' : y + '-' + ('0' + (mm + 1)).slice(-2); }
  return { mes: mes, hoje: hoje, ate: ate.length ? ate[ate.length - 1] : '', diasNoMes: nDias, rotulos: PRES_ROT, meses: meses, coordResp: coordResp_(),
    pessoas: Object.keys(pessoas).map(function (k) { return pessoas[k]; }), dias: dias.map(function (d) { return { data: d, futuro: d > hoje, esc: porDia[d].esc, c: porDia[d].c }; }) };
}

/* ===================== Controle de Logados · v106 ===================== */
/** Pessoas de cada mês importado (nome, coordenação, squad e cargo que tinham NAQUELE mês, pela planilha). */
const ABA_HIST_PES = 'PresencasHistoricoPessoas';
function histPessoas_(mes) { const m = {}; if (!db_().getSheetByName(ABA_HIST_PES)) return m; tabela_(ABA_HIST_PES).linhas.forEach(function (l) { if (l.mes === mes) m[String(l.email).toLowerCase()] = l; }); return m; }
/** Coordenação → e-mail do responsável (para a foto). */
function coordResp_() { const rt = responsaveisTime_(), out = {}; pessoasEscala_().forEach(function (p) { if (p.perfil === 'AGENTE' && rt[p.email] && rt[p.email].resp && !out[p.coord]) out[p.coord] = rt[p.email].resp; }); return out; }
/** Situação de cada agente em cada dia de um mês, até hoje (mesma regra do controle do dia). */
function presMesAtual_(mes, hoje, ag, ini) {
  const teste = contasTeste_(), pes = pessoasEscala_().filter(function (p) { return p.perfil === 'AGENTE' && teste.indexOf(p.email) < 0; });
  const nDias = new Date(+mes.slice(0, 4), +mes.slice(5, 7), 0).getDate(), dias = [];
  for (let d = 1; d <= nDias; d++) { const x = mes + '-' + ('0' + d).slice(-2); if (x <= hoje) dias.push(x); }
  if (!dias.length) return [];
  const esc = {}; tabela_('Escalas').linhas.forEach(function (l) { if (l.mes === mes) esc[l.email] = l; });
  const af = afastamentosEntre_(dias[0], dias[dias.length - 1]), reg = {};
  abaPres_(); delete MEMO_[ABA_PRES]; tabela_(ABA_PRES).linhas.forEach(function (l) { if (String(l.data).slice(0, 7) === mes) reg[l.data + '|' + String(l.email).toLowerCase()] = l; });
  const out = [];
  pes.forEach(function (p) {
    const l = esc[p.email], pub = l ? String(l.dias_publicados || '') : '', atu = l ? atuacaoDe_({ atuacao: l.atuacao_publicada || '' }) : null;
    dias.forEach(function (data) {
      const dia = +data.slice(8), c = pub.charAt(dia - 1) || '', x = atu && atu.d ? atu.d[String(dia)] : null;
      const a = af.filter(function (z) { return z.email === p.email && z.inicio <= data && z.fim >= data; })[0];
      const o = { sit: a ? a.tipo : (c === 'T' ? 'T' : c === 'F' ? 'F' : 'SEM'), i: x ? x[0] : p.entrada };
      const s = presSituacao_(o, reg[data + '|' + p.email], data, hoje, ag, ini);
      out.push({ data: data, email: p.email, nome: p.nome, coord: p.coord, st: s.st, auto: s.auto, prazo: s.prazo != null ? hmS_(s.prazo) : '' });
    });
  });
  return out;
}
/** Faltas automáticas ainda sem justificativa (ninguém registrou nada) e a situação de hoje. Guardado 1 minuto. */
function presPendentes_() {
  const c = CacheService.getScriptCache(), hoje = hojeIso_(), k = 'presPend2_' + hoje;
  try { const g = c.get(k); if (g) return JSON.parse(g); } catch (e) { /* recalcula */ }
  const ag = agoraMinFort_(), ini = presInicio_(); let lista = [];
  if (hoje >= ini) {
    const meses = [hoje.slice(0, 7)];
    if (+hoje.slice(8) <= 7) { const y = +hoje.slice(0, 4), m = +hoje.slice(5, 7); meses.unshift(m === 1 ? (y - 1) + '-12' : y + '-' + ('0' + (m - 1)).slice(-2)); }
    meses.forEach(function (m) { if (m + '-31' >= ini) lista = lista.concat(presMesAtual_(m, hoje, ag, ini)); });
  }
  const pend = lista.filter(function (x) { return x.auto && x.st === 'FALTA' && x.data === hoje; }) /* só o dia de hoje pede justificativa; dias passados ficam como Falta Injustificada */.map(function (x) { return { data: x.data, email: x.email, nome: x.nome, coord: x.coord, prazo: x.prazo }; });
  const hojeSt = {}; lista.forEach(function (x) { if (x.data === hoje) hojeSt[x.email] = x.st; });
  const r = { pend: pend, hojeSt: hojeSt, em: hmS_(ag) };
  try { c.put(k, JSON.stringify(r), 60); } catch (e) { /* grande demais: sem cache */ }
  return r;
}
function presPendLimpar_() { try { CacheService.getScriptCache().remove('presPend2_' + hojeIso_()); } catch (e) { /* nada */ } }
/** Gestão: número de faltas automáticas a justificar (o número vermelho na aba). */
function apiLogadosPendentes(token) {
  const ctx = sessao_(token); exigirGestao_(ctx); const r = presPendentes_(), hoje = hojeIso_(), porDia = {};
  r.pend.forEach(function (x) { porDia[x.data] = (porDia[x.data] || 0) + 1; });
  return { total: r.pend.length, hoje: porDia[hoje] || 0, porDia: porDia, em: r.em };
}
/** Ajustes de fila de hoje: só de quem está presente ou ainda dentro do prazo de registrar. */
function afFiltrarPresenca_(data, itens) {
  /* fica só quem está presente, aguardando ou sem registro: sai, em qualquer dia, quem já tem ausência lançada (atestado, compensa / day off, falta etc.) */
  const fica = ['PRESENTE', 'AGUARDANDO', 'SEM_REGISTRO'], hoje = hojeIso_(); let reg = {}; try { reg = presRegistros_(data) || {}; } catch (e) { reg = {}; }
  const lista = (itens || []).filter(function (x) { const r = reg[String(x.email || '').toLowerCase()], s = r && r.status; return !s || fica.indexOf(s) >= 0; });
  if (data !== hoje || hoje < presInicio_()) return lista;
  let st = {}; try { st = presPendentes_().hojeSt || {}; } catch (e) { return lista; }
  return lista.filter(function (x) { const s = st[String(x.email || '').toLowerCase()]; return !s || fica.indexOf(s) >= 0; });
}

/** Gestão: situação de presença de cada agente num dia (leve; hoje usa o cálculo guardado por 1 minuto). */
function apiPresencaMapa(token, data) {
  const ctx = sessao_(token); exigirGestao_(ctx); data = dataIso_(data) || hojeIso_(); const hoje = hojeIso_(), ini = presInicio_();
  if (data === hoje && hoje >= ini) { const r = presPendentes_(); return { data: data, hoje: hoje, inicio: ini, rotulos: PRES_ROT, m: r.hojeSt || {}, em: r.em }; }
  const c = apiControleLogados(token, data), m = {}; (c.itens || []).forEach(function (x) { m[x.email] = x.st; });
  return { data: data, hoje: hoje, inicio: ini, rotulos: PRES_ROT, m: m, em: c.agora };
}

/* ===================== Controle de Logados mais rápido ===================== */
/** Mesmo resultado do Controle de Logados, guardado para toda a gestão (hoje: dentro do mesmo minuto do relógio; outros dias: 1 minuto) e limpo a cada registro. */
function apiControleLogados(token, data) {
  const ctx = sessao_(token); exigirGestao_(ctx); data = dataIso_(data) || hojeIso_();
  const c = CacheService.getScriptCache(), k = 'lgDia2_' + data + (data === hojeIso_() ? '_' + agoraMinFort_() : ''); let r = null;
  try { const g = c.get(k); if (g) r = JSON.parse(g); } catch (e) { r = null; }
  if (!r) { r = apiControleLogadosCalc_(token, data); try { const s = JSON.stringify(r); if (s.length < 95000) c.put(k, s, 60); } catch (e) { /* sem cache */ } }
  r.eu = nomeCurto_((ctx.pessoa && ctx.pessoa.nome) || ctx.email);
  return r;
}
function lgDiaLimpar_(data) { try { const c = CacheService.getScriptCache(), m = agoraMinFort_(); c.removeAll(['lgDia2_' + data, 'lgDia2_' + data + '_' + m, 'lgDia2_' + data + '_' + (m - 1)]); } catch (e) { /* nada */ } }

/* ===================== Trocas mais rápidas ===================== */
/** Durante as funções que só leem (lista, detalhe e ofertas de trocas; expirar trocas vencidas), a aba Escalas
 *  é lida uma vez e indexada por mês e pessoa. Fora delas, nada muda: a leitura continua direto da planilha. */
var ESC_IDX_ = null, RT_LEITURA_ = null;
function comLeituraRapida_(fn) {
  const dono = !ESC_IDX_;
  if (dono) { ESC_IDX_ = {}; tabela_('Escalas').linhas.forEach(function (x) { const k = x.mes + '|' + x.email; if (!(k in ESC_IDX_)) ESC_IDX_[k] = x; }); RT_LEITURA_ = rtCache_(); }
  try { return fn(); } finally { if (dono) { ESC_IDX_ = null; RT_LEITURA_ = null; } }
}
/** Responsáveis de cada time, guardados 5 minutos — só para exibir (contagens e "quem aprova"); aprovar ou rejeitar sempre confere na hora. */
function rtCache_() {
  const c = CacheService.getScriptCache();
  try { const g = c.get('rt5_v1'); if (g) return JSON.parse(g); } catch (e) { /* recalcula */ }
  const rt = responsaveisTime_(); try { c.put('rt5_v1', JSON.stringify(rt), 300); } catch (e) { /* sem cache */ }
  return rt;
}
function expirarTrocas_() { return comLeituraRapida_(function () { return expirarTrocasBase_(); }); }

/* ===================== Desempenho: tabelas leves guardadas entre chamadas ===================== */
/** Pessoas, Usuarios, Coordenacoes e Feriados quase nunca mudam e são lidas em quase toda chamada.
 *  Ficam guardadas por 1 hora, amarradas à versão de cada aba: qualquer gravação troca a versão (abaMudou_),
 *  então a cópia antiga nunca é usada de novo. Credenciais (senhas e sessões) ficam de fora. */
var TB_CACHE_ = ['Pessoas', 'Usuarios', 'Coordenacoes', 'Feriados'];
function tbLerCache_(nome, sh) {
  if (TB_CACHE_.indexOf(nome) < 0) return sh.getDataRange().getValues();
  let c = null, base = '';
  try {
    c = CacheService.getScriptCache(); let ver = c.get('ver_' + nome);
    if (!ver) { ver = String(Date.now()); c.put('ver_' + nome, ver, 21600); }
    base = 'tb3_' + nome + '_' + ver; const n = +(c.get(base + '_n') || 0);
    if (n > 0) { const ks = []; for (let i = 0; i < n; i++) ks.push(base + '_' + i); const g = c.getAll(ks);
      if (ks.every(function (k) { return g[k] != null; })) return JSON.parse(ks.map(function (k) { return g[k]; }).join('')); }
  } catch (e) { c = null; }
  const v = sh.getDataRange().getValues().map(function (r) { return r.map(function (x) { return x === null ? '' : String(x); }); });
  if (c && base) { try { const s = JSON.stringify(v), T = 40000, o = {}; let n = 0; for (let i = 0; i < s.length; i += T) o[base + '_' + (n++)] = s.slice(i, i + T); if (n <= 25) { o[base + '_n'] = String(n); c.putAll(o, 3600); } } catch (e) { /* grande demais: sem cache */ } }
  return v;
}
/** Editor: se alguém editar Pessoas, Usuarios, Coordenacoes ou Feriados direto na planilha, rode isto para o painel ver na hora. */
function limparCacheTabelas() { TB_CACHE_.concat(ABAS_CADASTRO_).forEach(function (n) { abaMudou_(n); }); delete MEMO_.__pes; Logger.log('Tabelas leves renovadas.'); }
/* gravações diretas em Pessoas: trocam a versão (corrige também a lista de pessoas guardada por 5 min) */
function apiAlterarHorarios(token, emails, modo, entrada, saida, horas, motivo) { try { return apiAlterarHorariosBase_(token, emails, modo, entrada, saida, horas, motivo); } finally { abaMudou_('Pessoas'); } }
function aplicarImportacao_(prep, ator, publicar, motivo) { try { return aplicarImportacaoBase_(prep, ator, publicar, motivo); } finally { abaMudou_('Pessoas'); } }

/* ===================== Desempenho: detalhe da troca sem ler o histórico inteiro ===================== */
/** Mesmo resultado de colunasAba_(aba, cols) restrito às linhas em que alguma das colunas "colsBusca" é exatamente igual a "valor".
 *  Usa a busca de texto da própria planilha só nessas colunas e lê só os blocos de linhas encontrados (o histórico pode crescer sem pesar). */
function colunasOnde_(aba, cols, valor, colsBusca) {
  try {
    const sh = db_().getSheetByName(aba), lr = sh ? sh.getLastRow() : 0; if (!sh || !valor || lr < 2) return [];
    const lc = sh.getLastColumn(), cab = sh.getRange(1, 1, 1, lc).getValues()[0].map(String), idx = cols.map(function (c) { return cab.indexOf(c); }), rows = {};
    (colsBusca || cols).forEach(function (c) { const j = cab.indexOf(c); if (j < 0) return; sh.getRange(2, j + 1, lr - 1, 1).createTextFinder(String(valor)).matchEntireCell(true).findAll().forEach(function (r) { rows[r.getRow()] = 1; }); });
    const lista = Object.keys(rows).map(Number).sort(function (a, b) { return a - b; }); if (!lista.length) return [];
    const blocos = []; lista.forEach(function (r) { const b = blocos[blocos.length - 1]; if (b && r - b[1] <= 40) b[1] = r; else blocos.push([r, r]); });
    const out = [];
    blocos.forEach(function (b) { const v = sh.getRange(b[0], 1, b[1] - b[0] + 1, lc).getValues();
      lista.forEach(function (r) { if (r < b[0] || r > b[1]) return; const lin = v[r - b[0]], o = {}; cols.forEach(function (c, k) { o[c] = idx[k] < 0 ? '' : String(lin[idx[k]]); }); out.push(o); }); });
    return out;
  } catch (e) { return colunasAba_(aba, cols); }
}

/* ===================== Desempenho: funções de só leitura leem cada aba uma vez ===================== */
var MEMO_TODAS_ = false;
function comLeituraTotal_(fn) {
  if (MEMO_TODAS_) return fn();
  const antes = {}; Object.keys(MEMO_).forEach(function (k) { antes[k] = 1; }); MEMO_TODAS_ = true;
  try { return comLeituraRapida_(fn); }
  finally { MEMO_TODAS_ = false; Object.keys(MEMO_).forEach(function (k) { if (!antes[k] && MEMO_ABAS_.indexOf(k) < 0 && k.indexOf('__') !== 0) delete MEMO_[k]; }); }
}
function apiTrocas(token, filtro) { return comLeituraTotal_(function () { return apiTrocasBase_(token, filtro); }); }
function apiTrocaDetalhe(token, id, parte) { return comLeituraTotal_(function () { return apiTrocaDetalheBase_(token, id, parte); }); }
function apiTrocaOfertas(token) { return comLeituraTotal_(function () { return apiTrocaOfertasBase_(token); }); }
/* abrir a aba Trocas não espera mais a rotina de expirar: ela continua rodando nas pendências (ao entrar no painel e a cada poucos minutos) */
function apiTrocasV2(token, filtro) { return apiTrocas(token, filtro); }

/* ===================== Controle de Logados: atestado de vários dias ===================== */
/** Dias de trabalho do agente no período (escala publicada, sem férias/licença); os outros dias são informados e não mudam. */
function presPeriodoDias_(email, ini, fim) {
  const dias = []; let d = new Date(ini + 'T12:00:00Z'); const f = new Date(fim + 'T12:00:00Z');
  while (d <= f && dias.length < 40) { dias.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  const esc = {}; tabela_('Escalas').linhas.forEach(function (l) { if (String(l.email).toLowerCase() === email && !esc[l.mes]) esc[l.mes] = l; });
  const af = afastamentosEntre_(ini, fim).filter(function (a) { return a.email === email; });
  const trab = [], pulados = [];
  dias.forEach(function (x) { const l = esc[x.slice(0, 7)], c = l ? String(l.dias_publicados || '').charAt(+x.slice(8) - 1) : '', a = af.filter(function (z) { return z.inicio <= x && z.fim >= x; })[0];
    if (c === 'T' && !a) trab.push(x); else pulados.push({ data: x, motivo: a ? (a.tipo === 'FERIAS' ? 'férias' : 'licença') : c === 'F' ? 'folga' : 'sem escala' }); });
  return { dias: dias.length, trab: trab, pulados: pulados };
}
function presPeriodoValidar_(ini, fim, email, status) {
  ini = dataIso_(ini); fim = dataIso_(fim); if (!ini || !fim || fim < ini) throw new Error('Período inválido: o último dia precisa ser igual ou depois do primeiro.');
  const n = Math.round((new Date(fim + 'T12:00:00Z') - new Date(ini + 'T12:00:00Z')) / 86400000) + 1; if (n > 31) throw new Error('O período pode ter no máximo 31 dias.');
  status = String(status || '').toUpperCase(); if (PRES_MANUAIS.indexOf(status) < 0) throw new Error('Situação inválida.');
  email = String(email || '').trim().toLowerCase(); if (!/@/.test(email)) throw new Error('Agente inválido.');
  return { ini: ini, fim: fim, status: status, email: email };
}
/** Gestão: prévia (não grava nada). */
function apiPresencaPeriodoPrevia(token, ini, fim, email, status) {
  const ctx = sessao_(token); exigirGestao_(ctx); const v = presPeriodoValidar_(ini, fim, email, status || 'ATESTADO');
  return presPeriodoDias_(v.email, v.ini, v.fim);
}
/** Gestão: lança a situação em todos os dias de trabalho do período, de uma vez. */
function apiDefinirPresencaPeriodo(token, ini, fim, email, status) {
  const ctx = sessao_(token); exigirGestao_(ctx); const v = presPeriodoValidar_(ini, fim, email, status);
  const p = presPeriodoDias_(v.email, v.ini, v.fim), em = agoraIso_();
  p.trab.forEach(function (d) { presGravar_(d, [v.email], v.status, 'GESTAO', ctx.email, em); });
  return { ok: true, trab: p.trab, pulados: p.pulados, em: String(em).slice(11, 16), por: nomeCurto_((ctx.pessoa && ctx.pessoa.nome) || ctx.email) };
}

/* ===================== Trocas: pedido em aberto que todos recusaram é encerrado na hora ===================== */
/** Se todas as pessoas que podem aceitar o pedido em aberto já recusaram, encerra (Recusada por todos) e avisa quem pediu. */
function encerrarSeTodosRecusaram_(t, l, rec) {
  if (!l || l.status !== 'ABERTA') return false;
  rec = rec || recusasDe_(l);
  let aptos = [];
  try { if (!ehTrocaHorario_(l)) { const sp = pessoasEscala_().filter(function (p) { return p.email === l.solicitante; })[0]; aptos = colegasAptos_(l.solicitante, sp ? sp.perfil : 'AGENTE', l.data_solicitante, l.data_colega); } } catch (e) { aptos = []; }
  const todos = destinatariosAberta_(l.troca_id).concat(aptos).filter(function (e, i, a) { return e && e !== l.solicitante && a.indexOf(e) === i; });
  if (!todos.length || todos.some(function (e) { return rec.indexOf(e) < 0; })) return false;
  const agora = agoraIso_(), datas = datasTroca_(l);
  atualizarLinha_(t, l, { status: 'RECUSADA_COLEGA', obs_resposta: 'Todos que podiam aceitar recusaram.', atualizado_em: agora });
  logLote_([{ ator: 'sistema', acao: 'TROCA_ENCERRADA_RECUSAS', tipo: 'Troca', registro: l.troca_id, afetado: l.solicitante, antes: { status: 'ABERTA' }, depois: { status: 'RECUSADA_COLEGA', recusaram: rec.length } }]);
  notificar_([{ dest: l.solicitante, tipo: 'TROCA_RECUSADA', titulo: 'Ninguém aceitou seu pedido de troca', msg: 'Todas as pessoas que podiam cobrir seu pedido (' + datas + ') recusaram. O pedido foi encerrado e sua escala continua como estava. Se quiser, faça um novo pedido com outros dias.', ref: l.troca_id }]);
  enviarEmail_(l.solicitante, 'Ninguém aceitou seu pedido de troca', 'Todas as pessoas que podiam cobrir seu pedido de troca de escala (' + datas + ') recusaram. O pedido foi encerrado e sua escala continua como estava. Se quiser, faça um novo pedido com outros dias.');
  return true;
}

/* ===================== Aderência (aba de gestão · versão de teste) ===================== */
/** Eventos da Twilio: o n8n grava todo dia, às 06:00, os dias que faltam (a partir de 01/11/2026), em abas TwilioTempos_AAAA-MM. */
const ADER_INICIO = '2026-11-01', ADER_CTRL = 'TwilioDias';
function aderMais_(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function aderCacheLer_(k) { try { const c = CacheService.getScriptCache(), n = +(c.get(k + '_n') || 0); if (!n) return null; const ps = c.getAll(Array.from({ length: n }, function (_, i) { return k + '_' + i; })); let s = ''; for (let i = 0; i < n; i++) { const p = ps[k + '_' + i]; if (p === undefined || p === null) return null; s += p; } return JSON.parse(s); } catch (e) { return null; } }
function aderCacheGravar_(k, o, seg) { try { const s = JSON.stringify(o), c = CacheService.getScriptCache(), T = 90000, m = {}; let n = 0; for (let i = 0; i < s.length; i += T) m[k + '_' + (n++)] = s.slice(i, i + T); if (n > 60) return; m[k + '_n'] = String(n); c.putAll(m, seg); } catch (e) { /* sem cache */ } }
/** Dados de um período para a aba Aderência (só gestão). */
function apiAderencia(token, ini, fim) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  ini = dataIso_(ini); fim = dataIso_(fim); if (!ini || !fim) throw new Error('Período inválido.');
  const ontem = aderMais_(hojeIso_(), -1);
  if (ini < ADER_INICIO) ini = ADER_INICIO; if (fim > ontem) fim = ontem; if (fim < ini) fim = ini;
  if (aderMais_(ini, 62) < fim) throw new Error('Escolha um período de até 2 meses.');
  const ck = 'ader2_' + ini + '_' + fim, g = aderCacheLer_(ck); if (g) return g;
  const ss = db_(), datas = []; for (let d = ini; d <= fim; d = aderMais_(d, 1)) datas.push(d);
  const meses = datas.map(function (d) { return d.slice(0, 7); }).filter(function (m, i, a) { return a.indexOf(m) === i; });
  // 1) dias já carregados e eventos da Twilio (vale a gravação mais recente de cada pessoa e dia)
  const carregados = [], tw = {}, nomesTw = {};
  const shc = ss.getSheetByName(ADER_CTRL);
  if (shc) shc.getDataRange().getDisplayValues().slice(1).forEach(function (r) { if (r[0] >= ADER_INICIO) carregados.push(r[0]); });
  meses.forEach(function (m) {
    const sh = ss.getSheetByName('TwilioTempos_' + m); if (!sh) return;
    const v = sh.getDataRange().getDisplayValues(), cab = v[0], id = cab.indexOf('data'), ie = cab.indexOf('email'), iv = cab.indexOf('eventos'), ic = cab.indexOf('carregado_em'), inn = cab.indexOf('nome');
    const quando = {};
    v.slice(1).forEach(function (r) { const d = r[id], e = String(r[ie] || '').toLowerCase(); if (!e || d < ini || d > fim) return; const k = e + '|' + d; if (quando[k] && quando[k] > r[ic]) return; quando[k] = r[ic]; (tw[e] = tw[e] || {})[d] = r[iv]; if (inn >= 0) nomesTw[e] = r[inn]; });
  });
  // 2) pessoas (agentes ativos), escala, presença, férias/licenças e feriados
  const teste = contasTeste_(), pes = pessoasEscala_().filter(function (p) { return p.perfil === 'AGENTE' && teste.indexOf(p.email) < 0 && !ehVaga_(p.email); });
  const esc = {}; tabela_('Escalas').linhas.forEach(function (l) { if (meses.indexOf(l.mes) >= 0) esc[l.mes + '|' + l.email] = l; });
  const pres = {}; try { abaPres_(); tabela_(ABA_PRES).linhas.forEach(function (l) { if (l.data >= ini && l.data <= fim && l.status) (pres[String(l.email).toLowerCase()] = pres[String(l.email).toLowerCase()] || {})[l.data] = l.status; }); } catch (e) { /* sem presença */ }
  const af = {}; afastamentosEntre_(ini, fim).forEach(function (a) { (af[a.email] = af[a.email] || []).push(a); });
  const AREA = { '0800': '0800', chat: 'Chat', ass: 'Assíncrono', pad: 'Atuação a Definir', ges: 'Gestão' };
  const dias = {};
  pes.forEach(function (p) {
    const o = {}; let tem = false;
    datas.forEach(function (d) {
      const l = esc[d.slice(0, 7) + '|' + p.email], dia = +d.slice(8), pr = (pres[p.email] || {})[d] || '';
      const a = (af[p.email] || []).filter(function (x) { return x.inicio <= d && x.fim >= d; })[0];
      if (a) { o[d] = { s: a.tipo === 'FERIAS' ? 'FER' : 'LIC', p: pr }; tem = true; return; }
      if (pr === 'FERIAS' || pr === 'LICENCA') { o[d] = { s: pr === 'FERIAS' ? 'FER' : 'LIC', p: pr }; tem = true; return; }
      if (!l || !l.dias_publicados) { o[d] = { s: 'SEM', p: pr }; return; }
      const ch = String(l.dias_publicados).charAt(dia - 1);
      if (ch !== 'T') { o[d] = { s: ch === 'F' ? 'F' : 'SEM', p: pr }; tem = tem || ch === 'F'; return; }
      let atu = null; try { atu = JSON.parse(l.atuacao_publicada || l.atuacao || '{}'); } catch (e) { atu = null; }
      const x = atu && atu.d ? atu.d[String(dia)] : null;
      if (!x) { o[d] = { s: 'SEM', p: pr }; return; }
      let bl = []; try { bl = blocosPadrao_(x, atu.m).map(function (b) { return [AREA[b[0]] || b[0], b[1], b[2]]; }); } catch (e) { bl = []; }
      o[d] = { s: 'T', i: x[0], a: x[1] || '', f: x[2], b: bl, p: pr }; tem = true;
    });
    if (tem || tw[p.email]) dias[p.email] = o;
  });
  const out = { ini: ini, fim: fim, ultimo: carregados.filter(function (d) { return d <= ontem; }).sort().pop() || '', carregados: carregados,
    pessoas: pes.filter(function (p) { return dias[p.email]; }).map(function (p) { return { e: p.email, n: p.nome, c: p.coord || 'Sem Coordenação', cg: p.cargo || '' }; }),
    dias: dias, tw: tw, fer: feriadosEntre_(ini, fim, true).map(function (f) { return { d: f.data, n: f.nome }; }) };
  aderCacheGravar_(ck, out, 600);
  return out;
}
