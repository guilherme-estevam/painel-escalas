/**
 * Escalas.gs — planejamento mensal, publicação, feriados, afastamentos,
 * horários, coordenação, notificações e histórico.
 * Toda regra é validada aqui no servidor; o navegador usa a mesma função
 * validarEscala_ (injetada no Index) só para mostrar a prévia.
 */

const ESC_CAB = ['escala_id', 'mes', 'email', 'dias', 'dias_publicados', 'status', 'versao', 'publicada_em', 'publicada_por', 'atualizado_em', 'atualizado_por'];

/** Ajusta a aba Escalas para o formato mensal (roda uma vez; só mexe se estiver vazia). */
function migrarV2() {
  const ss = db_();
  const sh = ss.getSheetByName('Escalas');
  if (sh.getLastRow() <= 1) {
    sh.clear();
    sh.getRange(1, 1, 1, ESC_CAB.length).setValues([ESC_CAB]).setFontWeight('bold').setBackground('#262626').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange('A:Z').setNumberFormat('@');
  }
  const em = ss.getSheetByName('EscalaMeses');
  if (em && em.getLastRow() <= 1) ss.deleteSheet(em);
  return testesRegras();
}

/* ---------------------------------------------------------------------
 * REGRAS — função pura, também enviada ao navegador
 * e = { mes:'2026-11', dias:'TTF..', ant:'', prox:'', afast:[{inicio,fim,tipo}], segSex:bool }
 * dias: um caractere por dia do mês — T = trabalho, F = folga, . = não definido
 * --------------------------------------------------------------------- */
function validarEscala_(e) {
  var EXCECOES_SEMANA = ['2026-11-01']; // semana de 01 a 07/11/2026: exceção combinada (folgas de 2 ou 3 dias por causa do feriado de 02/11)
  function pad(n) { return ('0' + n).slice(-2); }
  function info(a, m) { var d = new Date(Date.UTC(a, m - 1, 1)); return { a: d.getUTCFullYear(), m: d.getUTCMonth() + 1, n: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() }; }
  var p = e.mes.split('-'); var I = info(+p[0], +p[1]); var P = info(I.a, I.m - 1); var N = info(I.a, I.m + 1);
  function iso(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function br(s) { var q = s.split('-'); return q[2] + '/' + q[1]; }
  function estado(d) {
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate();
    var s = (y === I.a && m === I.m) ? e.dias : (y === P.a && m === P.m) ? e.ant : (y === N.a && m === N.m) ? e.prox : '';
    var c = s ? s.charAt(dd - 1) : '';
    return c === 'T' || c === 'F' ? c : '.';
  }
  function afastado(s) { var l = e.afast || []; for (var i = 0; i < l.length; i++) if (s >= l[i].inicio && s <= l[i].fim) return l[i].tipo; return ''; }
  var FO = e.ferOff || (typeof feriadosOffLista_ === 'function' ? feriadosOffLista_() : []);
  function ferOff(s) { return FO.indexOf(s) >= 0; }
  var r = { erros: [], avisos: [], pendencias: [], semanas: [], resumo: { trabalho: 0, folga: 0, domingos: 0, domingosFolga: 0, domingosTrab: 0, afastado: 0, vazios: 0, feriado: 0 } };
  for (var d = 1; d <= I.n; d++) {
    var dt = new Date(Date.UTC(I.a, I.m - 1, d)), id = iso(dt), wd = dt.getUTCDay(), s = estado(dt);
    if (afastado(id)) { r.resumo.afastado++; continue; }
    if (ferOff(id)) { r.resumo.feriado++; if (wd === 0) { r.resumo.domingos++; r.resumo.domingosFolga++; } if (s === 'T') r.erros.push({ regra: 'FERIADO', msg: br(id) + ': feriado não trabalhado. Este dia não pode ter trabalho.', datas: [id] }); continue; }
    if (s === 'T') r.resumo.trabalho++; else if (s === 'F') r.resumo.folga++; else r.resumo.vazios++;
    if (wd === 0) { r.resumo.domingos++; if (s === 'F') r.resumo.domingosFolga++; if (s === 'T') r.resumo.domingosTrab++; }
    if (e.segSex && (wd === 0 || wd === 6) && s === 'T') r.erros.push({ regra: 'C', msg: br(id) + ': trabalho em ' + (wd === 0 ? 'domingo' : 'sábado') + '. Esta pessoa trabalha só de segunda a sexta.', datas: [id] });
  }
  if (r.resumo.vazios > 0) r.erros.push({ regra: 'INCOMPLETA', msg: r.resumo.vazios + ' dia(s) do mês sem trabalho ou folga definidos.', datas: [] });
  var w = new Date(Date.UTC(I.a, I.m - 1, 1)); w.setUTCDate(1 - w.getUTCDay());
  var fimMes = Date.UTC(I.a, I.m - 1, I.n);
  for (; w.getTime() <= fimMes; w.setUTCDate(w.getUTCDate() + 7)) {
    var t = 0, f = 0, v = 0, a = 0, h = 0, fora = 0, datas = [];
    for (var k = 0; k < 7; k++) {
      var x = new Date(w.getTime()); x.setUTCDate(x.getUTCDate() + k); var ix = iso(x); datas.push(ix);
      if (afastado(ix)) { a++; continue; }
      if (ferOff(ix)) { h++; continue; }
      var sx = estado(x);
      if (sx === 'T') t++; else if (sx === 'F') f++; else { v++; if (ix.slice(0, 7) !== e.mes) fora++; }
    }
    var rot = 'Semana de ' + br(datas[0]) + ' a ' + br(datas[6]);
    var sem = { inicio: datas[0], fim: datas[6], trabalho: t, folga: f, afastado: a, vazio: v, situacao: 'OK' };
    if (a === 7) sem.situacao = 'AFASTADO';
    else if (EXCECOES_SEMANA.indexOf(datas[0]) >= 0) { sem.excecao = true; }
    else if (v > 0) {
      sem.situacao = 'PENDENTE';
      if (fora > 0 && fora === v) r.pendencias.push({ regra: 'A', msg: rot + ': aguarda o planejamento do mês vizinho para fechar a semana.', datas: [datas[0], datas[6]] });
    } else if (a > 0) {
      sem.situacao = 'REVISAR';
      r.avisos.push({ regra: 'A', msg: rot + ': semana parcial com afastamento (' + t + ' trabalho, ' + f + ' folga). Confira.', datas: [datas[0], datas[6]] });
    } else if (t !== 5 || f !== 2 - h) {
      sem.situacao = 'ERRO';
      r.erros.push({ regra: 'A', msg: rot + ': ' + t + ' dia(s) de trabalho e ' + f + ' de folga' + (h ? ' (com feriado não trabalhado)' : '') + '. O certo é 5 de trabalho e ' + (2 - h) + ' de folga' + (h ? ' (o feriado conta como folga)' : '') + '.', datas: [datas[0], datas[6]] });
    }
    r.semanas.push(sem);
  }
  if (!e.segSex && r.resumo.vazios === 0 && r.resumo.domingos > 0 && r.resumo.domingosFolga === 0) r.erros.push({ regra: 'B', msg: 'Nenhum domingo de folga no mês. É preciso pelo menos um.', datas: [] });
  if (r.resumo.domingosTrab > 2) r.erros.push({ regra: 'D', msg: r.resumo.domingosTrab + ' domingos de trabalho no mês. O máximo é 2.', datas: [] });
  r.ok = r.erros.length === 0;
  return r;
}

/* ---------------------------------------------------------------------
 * HELPERS
 * --------------------------------------------------------------------- */
function exigirGestao_(ctx) { if (ctx.perfil !== 'GESTAO') throw new Error('SEM_PERMISSAO'); }
function mesValido_(mes) {
  if (!/^\d{4}-\d{2}$/.test(String(mes))) throw new Error('Mês inválido.');
  const ini = config_('mes_inicial');
  if (mes < ini) throw new Error('O painel começa em ' + ini.split('-')[1] + '/' + ini.split('-')[0] + '.');
  return mes;
}
function diasNoMes_(mes) { const p = mes.split('-'); return new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate(); }
function mesDelta_(mes, d) { const p = mes.split('-'); const x = new Date(Date.UTC(+p[0], +p[1] - 1 + d, 1)); return x.getUTCFullYear() + '-' + ('0' + (x.getUTCMonth() + 1)).slice(-2); }
function faixaMes_(mes) { // de domingo antes do dia 1 até sábado depois do último dia
  const p = mes.split('-'); const a = +p[0], m = +p[1];
  const ini = new Date(Date.UTC(a, m - 1, 1)); ini.setUTCDate(1 - ini.getUTCDay());
  const fim = new Date(Date.UTC(a, m, 0)); fim.setUTCDate(fim.getUTCDate() + (6 - fim.getUTCDay()));
  const f = function (d) { return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd'); };
  return { ini: f(ini), fim: f(fim) };
}
function hhmm_(s) { const m = String(s || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/); return m ? s : ''; }
function minutos_(s) { const p = s.split(':'); return (+p[0]) * 60 + (+p[1]); }
function deMinutos_(n) { return ('0' + Math.floor(n / 60)).slice(-2) + ':' + ('0' + (n % 60)).slice(-2); }
function dataIso_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : ''; }

function pessoasEscala_() {
  if (MEMO_.__pes) return MEMO_.__pes;
  let ck = ''; try { ck = chaveCachePessoas_(); const g = CacheService.getScriptCache().get(ck); if (g) return (MEMO_.__pes = JSON.parse(g)); } catch (e) { ck = ''; }
  const r = pessoasEscalaLer_();
  try { if (ck) CacheService.getScriptCache().put(ck, JSON.stringify(r), 300); } catch (e) { /* grande demais: sem cache */ }
  return (MEMO_.__pes = r);
}
/** Lê o cadastro direto das abas (usado quando não há cache). */
function pessoasEscalaLer_() {
  const us = {}; tabela_('Usuarios').linhas.forEach(function (u) { us[u.email] = u; });
  const mapa = coordenacoes_();
  return tabela_('Pessoas').linhas.filter(function (p) {
    const u = us[p.email]; return p.ativo === 'SIM' && u && (u.perfil === 'AGENTE' || u.perfil === 'GESTAO');
  }).map(function (p) {
    const c = coordDe_(p, mapa); const u = us[p.email];
    return {
      email: p.email, nome: nomeCurto_(p.nome), cargo: p.cargo_headcount, squad: p.squad, coordId: c.id, coord: c.nome,
      coordManual: !!p.coord_id_manual, entrada: p.entrada_planejada, saida: p.saida_planejada,
      entradaHc: p.entrada_headcount, saidaHc: p.saida_headcount, segSex: p.regra_seg_sex === 'SIM', perfil: u.perfil
    };
  }).sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
}

function afastamentosEntre_(ini, fim) {
  return tabela_('Afastamentos').linhas.filter(function (a) { return a.ativo === 'SIM' && a.inicio <= fim && a.fim >= ini; })
    .map(function (a) { return { id: a.afast_id, email: a.email, tipo: a.tipo, inicio: a.inicio, fim: a.fim, obs: a.observacao }; });
}
function feriadosEntre_(ini, fim, soAtivos) {
  return tabela_('Feriados').linhas.filter(function (f) { return f.data >= ini && f.data <= fim && (!soAtivos || f.ativo === 'SIM'); })
    .map(function (f) { return { id: f.feriado_id, data: f.data, nome: f.nome, categoria: f.categoria, ativo: f.ativo === 'SIM', trabalhado: f.trabalhado !== 'NAO' }; })
    .sort(function (a, b) { return a.data < b.data ? -1 : 1; });
}

function logLote_(itens) {
  if (!itens.length) return;
  appendLinhas_('Logs', itens.map(function (i) {
    return {
      log_id: novoId_('log'), data_hora: agoraIso_(), ator: i.ator, acao: i.acao, tipo_registro: i.tipo, registro: i.registro || '',
      afetado: i.afetado || '', antes: i.antes ? JSON.stringify(i.antes) : '', depois: i.depois ? JSON.stringify(i.depois) : '',
      motivo: i.motivo || '', operacao_id: i.op || '', resultado: i.resultado || 'OK'
    };
  }));
}
function notificar_(lista) { // [{dest, tipo, titulo, msg, ref}]
  if (!lista.length) return;
  lista = expandirAprovacao_(lista); // aviso de aprovação só para quem pode aprovar
  appendLinhas_('Notificacoes', lista.map(function (n) {
    return { notif_id: novoId_('nt'), destinatario: n.dest, tipo: n.tipo, titulo: n.titulo, mensagem: n.msg, referencia: n.ref || '', criada_em: agoraIso_() };
  }));
  novaVersaoNotif_();
  try { filaSlack_(lista); } catch (e) { /* o Slack nunca atrapalha a troca */ }
}
function mesBr_(mes) { const n = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']; const p = mes.split('-'); return n[+p[1] - 1] + '/' + p[0]; }

/* ---------------------------------------------------------------------
 * API — LEITURA DO MÊS
 * alvo: e-mail (gestão consulta uma pessoa); agentes sempre veem só a própria escala publicada
 * --------------------------------------------------------------------- */
function apiMes(token, mes, alvo) {
  const ctx = sessao_(token);
  if (!alvo && ctx.perfil === 'GESTAO') exigirPlanejamento_(ctx); // a grade inteira é do Planejamento
  mesValido_(mes);
  const gestao = ctx.perfil === 'GESTAO';
  let pessoas = pessoasEscala_();
  if (!gestao) pessoas = pessoas.filter(function (p) { return p.email === ctx.email; });
  else if (alvo) pessoas = pessoas.filter(function (p) { return p.email === normalizar_(alvo); });
  const emails = {}; pessoas.forEach(function (p) { emails[p.email] = true; });
  const ant = mesDelta_(mes, -1), prox = mesDelta_(mes, 1);
  const linhas = tabela_('Escalas').linhas.filter(function (l) { return emails[l.email] && (l.mes === mes || l.mes === ant || l.mes === prox); });
  const esc = {};
  pessoas.forEach(function (p) { esc[p.email] = { dias: '', diasPub: '', status: 'SEM_ESCALA', versao: '0', ant: '', prox: '', publicadaEm: '', publicadaPor: '' }; });
  linhas.forEach(function (l) {
    const e = esc[l.email];
    const usar = gestao ? l.dias : l.dias_publicados; // agente só enxerga o que foi publicado
    if (l.mes === mes) {
      e.dias = usar; e.diasPub = l.dias_publicados; e.status = l.status; e.versao = l.versao;
      e.publicadaEm = l.publicada_em; e.publicadaPor = l.publicada_por; e.atualizadoEm = l.atualizado_em; e.atualizadoPor = l.atualizado_por;
      if (!gestao && !l.dias_publicados) { e.status = 'NAO_PUBLICADA'; e.dias = ''; }
    } else if (l.mes === ant) e.ant = usar; else e.prox = usar;
  });
  const fx = faixaMes_(mes);
  const afast = {}; afastamentosEntre_(fx.ini, fx.fim).forEach(function (a) { if (emails[a.email]) (afast[a.email] = afast[a.email] || []).push(a); });
  const out = { mes: mes, dias: diasNoMes_(mes), pessoas: pessoas, escalas: esc, afast: afast, feriados: feriadosEntre_(fx.ini, fx.fim, true), gestao: gestao };
  if (gestao && !alvo) {
    out.coordenacoes = tabela_('Coordenacoes').linhas.filter(function (c) { return c.ativo === 'SIM'; }).map(function (c) { return { id: c.coord_id, nome: c.nome_exibicao }; });
  }
  return out;
}

/** Lista leve de pessoas para o seletor da gestão. */
function apiPessoas(token) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  return { pessoas: pessoasEscala_(), coordenacoes: tabela_('Coordenacoes').linhas.filter(function (c) { return c.ativo === 'SIM'; }).map(function (c) { return { id: c.coord_id, nome: c.nome_exibicao }; }) };
}

/* ---------------------------------------------------------------------
 * API — SALVAR RASCUNHO (lote)
 * mudancas: [{email, dias, versao}]
 * --------------------------------------------------------------------- */
function apiSalvarEscalas(token, mes, mudancas, motivo) {
  const ctx = sessao_(token); exigirGestao_(ctx); exigirPlanejamento_(ctx); mesValido_(mes);
  if (!Array.isArray(mudancas) || !mudancas.length) return { ok: false, msg: 'Nada para salvar.' };
  const n = diasNoMes_(mes);
  const pessoas = {}; pessoasEscala_().forEach(function (p) { pessoas[p.email] = p; });
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    const t = tabela_('Escalas');
    const porChave = {}; t.linhas.forEach(function (l) { porChave[l.mes + '|' + l.email] = l; });
    const op = novoId_('op'); const agora = agoraIso_();
    const salvos = [], conflitos = [], bloqueados = [], novos = [], logs = [], notifs = [];
    mudancas.forEach(function (m) {
      const email = normalizar_(m.email); const p = pessoas[email];
      const dias = String(m.dias || '');
      if (!p) { bloqueados.push({ email: email, msg: 'Pessoa sem acesso ao painel.' }); return; }
      if (dias.length !== n || /[^TF.]/.test(dias)) { bloqueados.push({ email: email, msg: 'Formato de escala inválido.' }); return; }
      if (p.segSex) {
        const fds = [];
        for (let d = 1; d <= n; d++) { const wd = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5) - 1, d)).getUTCDay(); if ((wd === 0 || wd === 6) && dias.charAt(d - 1) === 'T') fds.push(d); }
        if (fds.length) {
          bloqueados.push({ email: email, msg: p.nome + ' trabalha só de segunda a sexta. Trabalho no fim de semana não é permitido (dias ' + fds.join(', ') + ').' });
          logs.push({ ator: ctx.email, acao: 'ESCALA_BLOQUEADA', tipo: 'Escala', registro: mes + '|' + email, afetado: email, depois: { dias: dias }, motivo: 'Regra C: trabalho no fim de semana', op: op, resultado: 'BLOQUEADO' });
          notifs.push({ dest: 'GESTAO', tipo: 'ALERTA_REGRA', titulo: 'Tentativa bloqueada', msg: ctx.email + ' tentou escalar ' + p.nome + ' no fim de semana em ' + mesBr_(mes) + '.', ref: mes + '|' + email });
          return;
        }
      }
      const l = porChave[mes + '|' + email];
      if (l) {
        if (String(m.versao) !== String(l.versao)) { conflitos.push({ email: email, msg: 'A escala de ' + p.nome + ' foi alterada por ' + l.atualizado_por + ' em ' + l.atualizado_em.replace('T', ' ') + '. Recarregue antes de salvar.' }); return; }
        if (l.dias === dias) return;
        let status = l.status;
        if (l.dias_publicados) status = (dias === l.dias_publicados && (l.atuacao || '') === (l.atuacao_publicada || '')) ? 'PUBLICADA' : 'ALTERADA';
        const antes = { dias: l.dias, status: l.status };
        l.dias = dias; l.status = status; l.versao = String(Number(l.versao) + 1); l.atualizado_em = agora; l.atualizado_por = ctx.email;
        salvos.push({ email: email, versao: l.versao, status: status });
        logs.push({ ator: ctx.email, acao: 'ESCALA_ALTERADA', tipo: 'Escala', registro: l.escala_id, afetado: email, antes: antes, depois: { dias: dias, status: status }, motivo: motivo, op: op });
      } else {
        const nova = { escala_id: novoId_('esc'), mes: mes, email: email, dias: dias, dias_publicados: '', status: 'RASCUNHO', versao: '1', publicada_em: '', publicada_por: '', atualizado_em: agora, atualizado_por: ctx.email };
        novos.push(nova);
        salvos.push({ email: email, versao: '1', status: 'RASCUNHO' });
        logs.push({ ator: ctx.email, acao: 'ESCALA_CRIADA', tipo: 'Escala', registro: nova.escala_id, afetado: email, depois: { dias: dias, status: 'RASCUNHO' }, motivo: motivo, op: op });
      }
    });
    // grava as linhas existentes de uma vez e depois as novas
    if (t.linhas.length) {
      const vals = t.linhas.map(function (l) { return t.cab.map(function (c) { return l[c] === undefined ? '' : String(l[c]); }); });
      t.sh.getRange(2, 1, vals.length, t.cab.length).setValues(celTexto_(vals));
    }
    appendLinhas_('Escalas', novos);
    logLote_(logs); notificar_(notifs);
    return { ok: true, salvos: salvos, conflitos: conflitos, bloqueados: bloqueados, op: op };
  } finally { lock.releaseLock(); }
}

/* ---------------------------------------------------------------------
 * API — PUBLICAR (explícito; só publica quem está sem erro obrigatório)
 * --------------------------------------------------------------------- */
function apiPublicar(token, mes, emails) {
  const ctx = sessao_(token); exigirGestao_(ctx); exigirPlanejamento_(ctx); mesValido_(mes);
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    const pessoas = {}; pessoasEscala_().forEach(function (p) { pessoas[p.email] = p; });
    const alvo = {}; (emails || []).forEach(function (e) { alvo[normalizar_(e)] = true; });
    const t = tabela_('Escalas');
    const ant = mesDelta_(mes, -1), prox = mesDelta_(mes, 1);
    const viz = {}; t.linhas.forEach(function (l) { if (l.mes === ant || l.mes === prox) viz[l.mes + '|' + l.email] = l.dias; });
    const fx = faixaMes_(mes);
    const afast = {}; afastamentosEntre_(fx.ini, fx.fim).forEach(function (a) { (afast[a.email] = afast[a.email] || []).push(a); });
    const op = novoId_('op'); const agora = agoraIso_();
    const publicados = [], bloqueados = [], logs = [], notifs = [];
    t.linhas.forEach(function (l) {
      if (l.mes !== mes || !alvo[l.email]) return;
      const p = pessoas[l.email]; if (!p) return;
      if (l.status === 'PUBLICADA' && l.dias === l.dias_publicados && (l.atuacao || '') === (l.atuacao_publicada || '')) return;
      const v = validarEscala_({ mes: mes, dias: l.dias, ant: viz[ant + '|' + l.email] || '', prox: viz[prox + '|' + l.email] || '', afast: afast[l.email] || [], segSex: p.segSex });
      if (!v.ok) { bloqueados.push({ email: l.email, nome: p.nome, erros: v.erros.map(function (x) { return x.msg; }) }); return; }
      const antes = { dias_publicados: l.dias_publicados, status: l.status };
      const republicacao = !!l.dias_publicados;
      l.dias_publicados = l.dias; l.atuacao_publicada = l.atuacao || ''; l.status = 'PUBLICADA'; l.publicada_em = agora; l.publicada_por = ctx.email;
      l.versao = String(Number(l.versao) + 1); l.atualizado_em = agora; l.atualizado_por = ctx.email;
      publicados.push({ email: l.email, versao: l.versao });
      logs.push({ ator: ctx.email, acao: republicacao ? 'ESCALA_REPUBLICADA' : 'ESCALA_PUBLICADA', tipo: 'Escala', registro: l.escala_id, afetado: l.email, antes: antes, depois: { dias_publicados: l.dias, status: 'PUBLICADA' }, op: op });
      notifs.push({ dest: l.email, tipo: republicacao ? 'ESCALA_ALTERADA' : 'ESCALA_PUBLICADA', titulo: republicacao ? 'Sua escala mudou' : 'Sua escala foi publicada', msg: republicacao ? nomeCurto_(ctx.pessoa.nome) + ' publicou uma nova versão da sua escala de ' + mesBr_(mes) + '. Confira os dias alterados.' : 'Sua escala de ' + mesBr_(mes) + ' foi publicada por ' + nomeCurto_(ctx.pessoa.nome) + '.', ref: mes });
    });
    if (publicados.length) {
      const vals = t.linhas.map(function (l) { return t.cab.map(function (c) { return l[c] === undefined ? '' : String(l[c]); }); });
      t.sh.getRange(2, 1, vals.length, t.cab.length).setValues(celTexto_(vals));
    }
    logLote_(logs); notificar_(notifs);
    return { ok: true, publicados: publicados, bloqueados: bloqueados, op: op };
  } finally { lock.releaseLock(); }
}

/* ---------------------------------------------------------------------
 * API — HORÁRIOS E COORDENAÇÃO
 * modo: 'DEFINIR' (entrada/saída), 'ESTENDER' (soma horas na saída), 'HEADCOUNT' (volta ao horário do headcount)
 * --------------------------------------------------------------------- */
function apiAlterarHorariosBase_(token, emails, modo, entrada, saida, horas, motivo) {
  const ctx = sessao_(token); exigirGestao_(ctx); exigirPlanejamento_(ctx);
  if (!Array.isArray(emails) || !emails.length) return { ok: false, msg: 'Selecione pelo menos uma pessoa.' };
  if (modo === 'DEFINIR') {
    entrada = hhmm_(entrada); saida = hhmm_(saida);
    if (!entrada || !saida) return { ok: false, msg: 'Informe entrada e saída no formato 24 horas (ex.: 08:00).' };
    if (minutos_(saida) <= minutos_(entrada)) return { ok: false, msg: 'A saída precisa ser depois da entrada.' };
  } else if (modo === 'ESTENDER') {
    horas = Number(horas);
    if (!(horas >= -4 && horas <= 4) || horas === 0) return { ok: false, msg: 'Informe de -4 a 4 horas (diferente de zero).' };
  } else if (modo !== 'HEADCOUNT') return { ok: false, msg: 'Opção inválida.' };
  const alvo = {}; emails.forEach(function (e) { alvo[normalizar_(e)] = true; });
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    const t = tabela_('Pessoas'); const op = novoId_('op'); const logs = []; const recusados = []; let n = 0;
    t.linhas.forEach(function (p) {
      if (!alvo[p.email] || p.ativo !== 'SIM') return;
      let ne = p.entrada_planejada, ns = p.saida_planejada;
      if (modo === 'DEFINIR') { ne = entrada; ns = saida; }
      else if (modo === 'HEADCOUNT') { ne = p.entrada_headcount; ns = p.saida_headcount; }
      else {
        const m = minutos_(p.saida_planejada) + Math.round(horas * 60);
        if (m <= minutos_(p.entrada_planejada) || m > 23 * 60 + 59) { recusados.push(nomeCurto_(p.nome)); return; }
        ns = deMinutos_(m);
      }
      if (ne === p.entrada_planejada && ns === p.saida_planejada) return;
      logs.push({ ator: ctx.email, acao: 'HORARIO_ALTERADO', tipo: 'Pessoa', registro: p.email, afetado: p.email, antes: { entrada: p.entrada_planejada, saida: p.saida_planejada }, depois: { entrada: ne, saida: ns }, motivo: motivo, op: op });
      p.entrada_planejada = ne; p.saida_planejada = ns; p.atualizado_em = agoraIso_(); n++;
    });
    if (n) { const vals = t.linhas.map(function (l) { return t.cab.map(function (c) { return l[c] === undefined ? '' : String(l[c]); }); }); t.sh.getRange(2, 1, vals.length, t.cab.length).setValues(celTexto_(vals)); }
    logLote_(logs);
    return { ok: true, alterados: n, recusados: recusados };
  } finally { lock.releaseLock(); }
}

function apiAlterarCoordenacao(token, email, coordId, motivo) {
  const ctx = sessao_(token); exigirGestao_(ctx); exigirPlanejamento_(ctx);
  email = normalizar_(email);
  const mapa = coordenacoes_();
  if (coordId && !mapa[coordId]) return { ok: false, msg: 'Coordenação inválida.' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tabela_('Pessoas'); const p = t.linhas.filter(function (x) { return x.email === email && x.ativo === 'SIM'; })[0];
    if (!p) return { ok: false, msg: 'Pessoa não encontrada.' };
    const antes = { coordenacao: coordDe_(p, mapa).nome, manual: p.coord_id_manual };
    atualizarLinha_(t, p, { coord_id_manual: coordId || '', atualizado_em: agoraIso_() });
    const depois = { coordenacao: coordDe_(p, mapa).nome, manual: coordId || '' };
    log_(ctx.email, 'COORDENACAO_ALTERADA', 'Pessoa', email, email, antes, depois, motivo);
    return { ok: true, coordenacao: depois.coordenacao };
  } finally { lock.releaseLock(); }
}

/* ---------------------------------------------------------------------
 * API — FERIADOS
 * --------------------------------------------------------------------- */
function apiFeriados(token, ano) {
  sessao_(token);
  ano = String(ano || '').match(/^\d{4}$/) ? ano : String(new Date().getFullYear());
  return { ano: ano, feriados: feriadosEntre_(ano + '-01-01', ano + '-12-31', false) };
}
function apiSalvarFeriado(token, f) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  const data = dataIso_(f && f.data), nome = String((f && f.nome) || '').trim().slice(0, 80);
  const cats = ['Nacional', 'Estadual', 'Municipal', 'Ponto facultativo'];
  const categoria = cats.indexOf(f && f.categoria) >= 0 ? f.categoria : '';
  if (!data) return { ok: false, msg: 'Informe a data.' };
  if (!nome) return { ok: false, msg: 'Informe o nome do feriado.' };
  if (!categoria) return { ok: false, msg: 'Escolha a categoria.' };
  const trab = f && f.trabalhado === false ? 'NAO' : 'SIM';
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tabela_('Feriados');
    if (t.linhas.some(function (x) { return x.data === data && x.ativo === 'SIM' && x.feriado_id !== f.id; })) return { ok: false, msg: 'Já existe um feriado ativo nessa data.' };
    if (f.id) {
      const l = t.linhas.filter(function (x) { return x.feriado_id === f.id; })[0];
      if (!l) return { ok: false, msg: 'Feriado não encontrado.' };
      const antes = { data: l.data, nome: l.nome, categoria: l.categoria, ativo: l.ativo, trabalhado: l.trabalhado };
      const ativo = f.ativo === false ? 'NAO' : 'SIM';
      atualizarLinha_(t, l, { data: data, nome: nome, categoria: categoria, ativo: ativo, trabalhado: trab, alterado_em: agoraIso_(), alterado_por: ctx.email });
      log_(ctx.email, 'FERIADO_ALTERADO', 'Feriado', f.id, '', antes, { data: data, nome: nome, categoria: categoria, ativo: ativo, trabalhado: trab });
    } else {
      const id = novoId_('fer');
      appendLinhas_('Feriados', [{ feriado_id: id, data: data, nome: nome, categoria: categoria, ativo: 'SIM', trabalhado: trab, criado_em: agoraIso_(), criado_por: ctx.email }]);
      log_(ctx.email, 'FERIADO_CRIADO', 'Feriado', id, '', null, { data: data, nome: nome, categoria: categoria, trabalhado: trab });
    }
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ---------------------------------------------------------------------
 * API — FÉRIAS E LICENÇAS (cadastro manual da gestão)
 * --------------------------------------------------------------------- */
function apiAfastamentos(token, mes) {
  const ctx = sessao_(token); exigirGestao_(ctx); mesValido_(mes);
  const nomes = {}; pessoasEscala_().forEach(function (p) { nomes[p.email] = p.nome; });
  const ini = mes + '-01', fim = mes + '-' + ('0' + diasNoMes_(mes)).slice(-2);
  return { mes: mes, itens: afastamentosEntre_(ini, fim).map(function (a) { a.nome = nomes[a.email] || a.email; return a; }).sort(function (a, b) { return a.inicio < b.inicio ? -1 : 1; }) };
}
function apiSalvarAfastamento(token, a) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  const email = normalizar_(a && a.email), inicio = dataIso_(a && a.inicio), fim = dataIso_(a && a.fim);
  const tipo = (a && (a.tipo === 'FERIAS' || a.tipo === 'LICENCA')) ? a.tipo : '';
  const pessoas = {}; pessoasEscala_().forEach(function (p) { pessoas[p.email] = p; });
  if (!pessoas[email]) return { ok: false, msg: 'Escolha a pessoa.' };
  if (!tipo) return { ok: false, msg: 'Escolha férias ou licença.' };
  if (!inicio || !fim) return { ok: false, msg: 'Informe início e fim.' };
  if (fim < inicio) return { ok: false, msg: 'O fim precisa ser igual ou depois do início.' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const conflito = afastamentosEntre_(inicio, fim).filter(function (x) { return x.email === email && x.id !== a.id; })[0];
    if (conflito) return { ok: false, msg: 'Já existe ' + (conflito.tipo === 'FERIAS' ? 'férias' : 'licença') + ' cadastrada de ' + conflito.inicio.split('-').reverse().join('/') + ' a ' + conflito.fim.split('-').reverse().join('/') + ' para essa pessoa.' };
    const obs = String(a.obs || '').trim().slice(0, 200);
    const id = novoId_('af');
    appendLinhas_('Afastamentos', [{ afast_id: id, email: email, tipo: tipo, inicio: inicio, fim: fim, observacao: obs, ativo: 'SIM', criado_em: agoraIso_(), criado_por: ctx.email }]);
    log_(ctx.email, 'AFASTAMENTO_CRIADO', 'Afastamento', id, email, null, { tipo: tipo, inicio: inicio, fim: fim, observacao: obs });
    if (tipo === 'FERIAS') notificar_([{ dest: email, tipo: 'FERIAS', titulo: 'Férias cadastradas', msg: 'Suas férias de ' + dBr_(inicio) + ' a ' + dBr_(fim) + ' foram cadastradas por ' + nomeCurto_(ctx.pessoa.nome) + '.', ref: id }]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function apiRemoverAfastamento(token, id, motivo) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tabela_('Afastamentos'); const l = t.linhas.filter(function (x) { return x.afast_id === id; })[0];
    if (!l || l.ativo !== 'SIM') return { ok: false, msg: 'Registro não encontrado.' };
    atualizarLinha_(t, l, { ativo: 'NAO', alterado_em: agoraIso_(), alterado_por: ctx.email });
    log_(ctx.email, 'AFASTAMENTO_REMOVIDO', 'Afastamento', id, l.email, { tipo: l.tipo, inicio: l.inicio, fim: l.fim, ativo: 'SIM' }, { ativo: 'NAO' }, motivo);
    if (l.tipo === 'FERIAS') notificar_([{ dest: l.email, tipo: 'FERIAS', titulo: 'Férias removidas', msg: 'Suas férias de ' + dBr_(l.inicio) + ' a ' + dBr_(l.fim) + ' foram removidas por ' + nomeCurto_(ctx.pessoa.nome) + '.', ref: id }]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ---------------------------------------------------------------------
 * API — NOTIFICAÇÕES
 * --------------------------------------------------------------------- */
function apiNotificacoes(token) {
  const ctx = sessao_(token);
  const cache = CacheService.getScriptCache(), chave = 'nt_' + ctx.email + '_' + (cache.get('notif_ver') || '0');
  const guardado = cache.get(chave); if (guardado) { try { return JSON.parse(guardado); } catch (e) { /* recalcula */ } }
  const r = notificacoesDe_(ctx);
  try { const s = JSON.stringify(r); if (s.length < 95000) cache.put(chave, s, 900); } catch (e) { /* sem cache */ }
  return r;
}
function notificacoesDe_(ctx) {
  const meu = function (n) { return n.destinatario === ctx.email || (ctx.perfil === 'GESTAO' && n.destinatario === 'GESTAO'); };
  const itens = tabela_('Notificacoes').linhas.filter(meu).reverse().slice(0, 60)
    .map(function (n) { return { id: n.notif_id, tipo: n.tipo, titulo: n.titulo, msg: n.mensagem, ref: n.referencia, em: n.criada_em, lida: !!n.lida_em, setor: n.destinatario === 'GESTAO' }; });
  return { itens: itens, naoLidas: itens.filter(function (i) { return !i.lida; }).length };
}
function apiMarcarLidas(token, ids) {
  const ctx = sessao_(token);
  const alvo = {}; (ids || []).forEach(function (i) { alvo[i] = true; });
  const t = tabela_('Notificacoes'); let n = 0;
  t.linhas.forEach(function (l) {
    const minha = l.destinatario === ctx.email || (ctx.perfil === 'GESTAO' && l.destinatario === 'GESTAO');
    if (minha && alvo[l.notif_id] && !l.lida_em) { l.lida_em = agoraIso_() + ' ' + ctx.email; l._marcar = true; n++; }
  });
  // grava só a coluna lida_em das linhas marcadas (nunca a aba inteira: duas pessoas marcando ao mesmo tempo não apagam uma à outra)
  if (n) { const col = t.cab.indexOf('lida_em') + 1, letra = colunaLetra_(col), porValor = {};
    t.linhas.forEach(function (l) { if (l._marcar) { (porValor[l.lida_em] = porValor[l.lida_em] || []).push(letra + l._row); } });
    Object.keys(porValor).forEach(function (v) { t.sh.getRangeList(porValor[v]).setValue("'" + v); });
    novaVersaoNotif_(); }
  return { ok: true, marcadas: n };
}

/* ---------------------------------------------------------------------
 * API — HISTÓRICO (logs) — somente gestão, somente leitura
 * --------------------------------------------------------------------- */
function apiLogs(token, filtro) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  filtro = filtro || {};
  const de = dataIso_(filtro.de), ate = dataIso_(filtro.ate);
  const q = normalizar_(filtro.texto || ''); const acao = String(filtro.acao || ''), quem = String(filtro.quem || '');
  const us = {}; tabela_('Usuarios').linhas.forEach(function (u) { us[u.email] = u.perfil; });
  const nomes = {}; tabela_('Pessoas').linhas.forEach(function (p) { nomes[p.email] = normalizar_(p.nome); });
  const perfilDe = function (e) { return !e || e === 'sistema' ? 'SISTEMA' : us[e] === 'GESTAO' ? 'GESTAO' : 'AGENTE'; }, cont = { AGENTE: 0, GESTAO: 0, SISTEMA: 0 };
  const linhas = tabela_('Logs').linhas.filter(function (l) {
    if (typeof ACOES_SEGURANCA !== 'undefined' && ACOES_SEGURANCA.indexOf(l.acao) >= 0) return false;
    const dia = l.data_hora.slice(0, 10);
    if (de && dia < de) return false; if (ate && dia > ate) return false;
    if (acao && l.acao !== acao) return false;
    if (q && (normalizar_(l.ator) + ' ' + normalizar_(l.afetado) + ' ' + normalizar_(l.registro) + ' ' + (nomes[l.ator] || '') + ' ' + (nomes[l.afetado] || '')).indexOf(q) < 0) return false;
    const pf = perfilDe(l.ator); cont[pf]++; if (quem && pf !== quem) return false;
    return true;
  }).reverse();
  const acoes = {}; tabela_('Logs').linhas.forEach(function (l) { if (typeof ACOES_SEGURANCA === 'undefined' || ACOES_SEGURANCA.indexOf(l.acao) < 0) acoes[l.acao] = true; });
  return {
    total: linhas.length, acoes: Object.keys(acoes).sort(), contagem: cont,
    itens: linhas.slice(Math.max(0, +filtro.ini || 0), Math.max(0, +filtro.ini || 0) + Math.min(Math.max(1, +filtro.lim || 300), 300)).map(function (l) { return { id: l.log_id, rev: (typeof ACOES_REVERSIVEIS !== 'undefined' && ACOES_REVERSIVEIS.indexOf(l.acao) >= 0 && l.resultado === 'OK'), em: l.data_hora, ator: l.ator, acao: l.acao, tipo: l.tipo_registro, afetado: l.afetado, antes: l.antes, depois: l.depois, motivo: l.motivo, resultado: l.resultado, op: l.operacao_id, reg: l.registro, atorPerfil: perfilDe(l.ator) }; })
  };
}

/* ---------------------------------------------------------------------
 * TESTES DAS REGRAS (rodar pelo editor)
 * --------------------------------------------------------------------- */
function testesRegras() {
  const r = []; const ok = function (n, c, d) { r.push((c ? 'OK   ' : 'FALHA') + ' | ' + n + (d ? ' | ' + d : '')); };
  // novembro/2026 começa num domingo; padrão Dom+Qui de folga
  const padrao = function (mes, folgas) { let s = ''; const n = diasNoMes_(mes); for (let d = 1; d <= n; d++) { const wd = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5) - 1, d)).getUTCDay(); s += (folgas.indexOf(wd) >= 0 || (mes === '2026-11' && d === 2)) ? 'F' : 'T'; } return s; }; // 02/11/2026 é feriado não trabalhado
  const nov = padrao('2026-11', [0, 4]);
  let v = validarEscala_({ mes: '2026-11', dias: nov, ant: '', prox: '', afast: [], segSex: false });
  ok('Semana dom-sáb: 5x2 válido sem erros', v.ok, JSON.stringify(v.erros));
  ok('Última semana (29/11 a 05/12) fica pendente sem dezembro', v.pendencias.length === 1 && v.semanas[v.semanas.length - 1].situacao === 'PENDENTE');
  ok('Conta domingos de folga', v.resumo.domingosFolga === 5, String(v.resumo.domingosFolga));
  v = validarEscala_({ mes: '2026-11', dias: nov, ant: '', prox: padrao('2026-12', [0, 4]), afast: [], segSex: false });
  ok('Com dezembro planejado, última semana fecha', v.ok && v.pendencias.length === 0);
  v = validarEscala_({ mes: '2026-11', dias: padrao('2026-11', [1, 2]), ant: '', prox: '', afast: [], segSex: false });
  ok('Regra B: sem domingo de folga gera erro', v.erros.some(function (e) { return e.regra === 'B'; }));
  const seisDias = nov.slice(0, 7) + 'T' + nov.slice(8); // 6 dias na semana de 08 a 14/11 (a semana de 01 a 07/11 é exceção)
  v = validarEscala_({ mes: '2026-11', dias: seisDias, ant: '', prox: '', afast: [], segSex: false });
  ok('Regra A: 6 dias de trabalho na semana gera erro', v.erros.some(function (e) { return e.regra === 'A'; }));
  const segsex = padrao('2026-11', [0, 6]);
  v = validarEscala_({ mes: '2026-11', dias: segsex, ant: '', prox: '', afast: [], segSex: true });
  ok('Regra C: seg a sex válido, sem alerta de domingo', v.ok, JSON.stringify(v.erros));
  v = validarEscala_({ mes: '2026-11', dias: nov, ant: '', prox: '', afast: [], segSex: true });
  ok('Regra C: trabalho no sábado gera erro', v.erros.some(function (e) { return e.regra === 'C'; }));
  v = validarEscala_({ mes: '2026-11', dias: padrao('2026-11', [1, 2]), ant: '', prox: '', afast: [{ inicio: '2026-11-01', fim: '2026-11-30', tipo: 'FERIAS' }], segSex: false });
  ok('Férias no mês todo: sem erro de 5x2 nem de domingo', v.ok && v.resumo.afastado === 30, JSON.stringify(v.erros));
  v = validarEscala_({ mes: '2026-11', dias: '.'.repeat(30), ant: '', prox: '', afast: [], segSex: false });
  ok('Mês vazio: escala incompleta', v.erros.some(function (e) { return e.regra === 'INCOMPLETA'; }));
  ok('Faixa de nov/2026: 01/11 a 05/12', JSON.stringify(faixaMes_('2026-11')) === JSON.stringify({ ini: '2026-11-01', fim: '2026-12-05' }));
  ok('Faixa de dez/2026: 29/11 a 02/01', JSON.stringify(faixaMes_('2026-12')) === JSON.stringify({ ini: '2026-11-29', fim: '2027-01-02' }));
  let erro = ''; try { mesValido_('2026-10'); } catch (e) { erro = e.message; }
  ok('Outubro/2026 é recusado', /começa/.test(erro));
  Logger.log(r.join('\n'));
  return r;
}
