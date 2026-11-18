/**
 * Escala22.gs — regras de troca (versão 47)
 *  - pedir e aceitar: até 72 horas antes do primeiro turno da troca (TROCA_PRAZO_H, em Escala11)
 *  - coordenação: aprovar até 24 horas antes do primeiro turno; passou disso, a troca expira
 *  - aprovam os coordenadores das duas pessoas (os dois, quando são de coordenações diferentes)
 *  - o gerente (GERENTE_TROCAS) pode aprovar qualquer troca sozinho; só é avisado quando um coordenador
 *    está de férias ou licença hoje, ou quando alguém da troca não tem coordenador com acesso ao painel
 *  - só troca quem tem o mesmo horário de entrada e saída (cadastro); a troca de horário foi desativada
 *  - máximo de 2 domingos trabalhados no mês (regra D, em validarEscala_)
 */
const TROCA_PRAZO_GESTAO_H = 24;
const GERENTE_TROCAS = 'gerente.dois@exemplo.com';
const SUBSTITUTA_TROCAS = 'coord.beta@exemplo.com'; // coordenadora substituta: aprova no lugar de coordenador de férias ou licença
const MSG_SEM_TROCA_HORARIO = 'A troca de horário foi desativada. Agora as trocas são de dia, entre pessoas com o mesmo horário.';

function ehGerenteTrocas_(e) { return String(e || '').trim().toLowerCase() === GERENTE_TROCAS; }
function ehSubstitutaTrocas_(e) { return String(e || '').trim().toLowerCase() === SUBSTITUTA_TROCAS; }
/** Aprovação que vale sozinha: gerente ou WFM (acesso total). */
function aprovaSozinho_(e) { return ehGerenteTrocas_(e) || ehSuperadmin_(e); }
/** Horário da pessoa no mês: o par entrada–saída que ela mais trabalha na escala publicada (sem escala, vale o cadastro). */
var HOR_BASE_ = {};
function horarioBase_(p, mes) {
  if (!p) return null; const k = (mes || '') + '|' + p.email; if (HOR_BASE_[k] !== undefined) return HOR_BASE_[k];
  let r = null;
  if (mes) {
    const l = tabela_('Escalas').linhas.filter(function (x) { return x.mes === mes && x.email === p.email; })[0];
    const atu = l ? atuacaoDe_({ atuacao: l.atuacao_publicada || l.atuacao }) : null, cont = {};
    if (atu && atu.d) Object.keys(atu.d).forEach(function (d) { const x = atu.d[d]; if (x && x[0] && x[2]) { const c = x[0] + '|' + x[2]; cont[c] = (cont[c] || 0) + 1; } });
    const melhor = Object.keys(cont).sort(function (a, b) { return cont[b] - cont[a]; })[0];
    if (melhor) r = { i: melhor.split('|')[0], f: melhor.split('|')[1] };
  }
  if (!r && p.entrada) r = { i: String(p.entrada), f: String(p.saida) };
  return (HOR_BASE_[k] = r);
}
function mesmoHorarioCadastro_(A, B, mes) { const a = horarioBase_(A, mes), b = horarioBase_(B, mes); return !!a && !!b && a.i === b.i && a.f === b.f; }
function txtHorarioCad_(p, mes) { const h = horarioBase_(p, mes); return h ? h.i + ' às ' + h.f : ''; }

/* ---------- prazos ---------- */
/** Início do primeiro turno da troca (ms). Num pedido em aberto, quem cobre tem o mesmo horário de quem pede. */
function primeiroTurnoMs_(l) {
  const dS = l.data_solicitante, dC = l.data_colega;
  const hA = horarioDia_(l.solicitante, dS), hB = l.colega ? horarioDia_(l.colega, dC) : hA;
  return Math.min(inicioMs_(dS, hA ? hA.i : '00:00'), inicioMs_(dC, hB ? hB.i : '00:00'));
}
function prazoAceiteMs_(l) { return primeiroTurnoMs_(l) - TROCA_PRAZO_H * 3600000; }
function prazoGestaoMs_(l) { return primeiroTurnoMs_(l) - TROCA_PRAZO_GESTAO_H * 3600000; }

/* ---------- quem aprova ---------- */
var AFAST_HOJE_ = null, RT_EXEC_ = null;
function rtExec_() { return RT_EXEC_ || (RT_EXEC_ = responsaveisTime_()); }
function emAfastHoje_(email) {
  if (!AFAST_HOJE_) { const h = hojeIso_(); AFAST_HOJE_ = {}; afastamentosEntre_(h, h).forEach(function (a) { AFAST_HOJE_[a.email] = 1; }); }
  return !!AFAST_HOJE_[email];
}
function aprovacoesDe_(l) { try { return JSON.parse(l.aprovacoes || '{}') || {}; } catch (e) { return {}; } }
function garantirColunaAprovacoes_() {
  const t = tabela_('Trocas'); if (t.cab.indexOf('aprovacoes') >= 0) return;
  garantirEspacoColunas_(t.sh, t.cab.length + 1); t.sh.getRange(1, t.cab.length + 1).setValue('aprovacoes'); delete MEMO_['Trocas'];
}
/**
 * Situação da aprovação de uma troca.
 * nec: coordenadores que precisam aprovar (um por coordenação envolvida, sem contar quem participa da troca)
 * semCoord: pessoas da troca sem coordenador com acesso (o gerente cobre)
 * ausentes: coordenadores de férias ou licença hoje (o gerente é avisado)
 */
function aprovacaoTroca_(l, rt) {
  rt = rt || rtExec_();
  const nec = [], semCoord = [];
  [l.solicitante, l.colega].filter(Boolean).forEach(function (e) {
    const x = rt[e], r = x && x.resp && x.resp !== l.solicitante && x.resp !== l.colega ? x.resp : '';
    if (!r) semCoord.push(e); else if (nec.indexOf(r) < 0) nec.push(r);
  });
  const ap = aprovacoesDe_(l), ausentes = nec.filter(function (c) { return emAfastHoje_(c); }), sub = !!ap[SUBSTITUTA_TROCAS];
  const cobertos = sub ? ausentes.filter(function (c) { return !ap[c]; }) : []; // ausentes que a substituta já aprovou no lugar
  return { nec: nec, ap: ap, faltam: nec.filter(function (c) { return !ap[c] && cobertos.indexOf(c) < 0; }), semCoord: semCoord, ausentes: ausentes, cobertos: cobertos,
    precisaGerente: semCoord.length > 0 || ausentes.length > 0, gerenteAprovou: !!ap[GERENTE_TROCAS], substAprovou: sub,
    aprovadoSozinho: Object.keys(ap).some(aprovaSozinho_) };
}
/** Papel de quem decidiu a troca, para os avisos: gerente, WFM, coordenação substituta ou coordenação. */
function papelDecisorTroca_(e) { return ehGerenteTrocas_(e) ? ', gerente' : ehSuperadmin_(e) ? ', do WFM' : ehSubstitutaTrocas_(e) ? ', da coordenação substituta' : ', da coordenação'; }
/** Quando outra pessoa decide a troca (por exemplo o gerente ou o WFM), avisa quem ainda tinha o pedido de aprovação: o pedido foi encerrado. */
function avisarAprovacaoEncerrada_(l, ctx, aprovada, obs) {
  try {
    const ap = aprovada ? aprovacoesDe_(l) : {};
    const dests = tabela_('Notificacoes').linhas.filter(function (n) { return n.tipo === 'TROCA_APROVACAO' && n.referencia === l.troca_id; }).map(function (n) { return n.destinatario; })
      .filter(function (e, i, arr) { return e && arr.indexOf(e) === i && e !== ctx.email && e !== l.solicitante && e !== l.colega && !ap[e]; });
    if (!dests.length) return;
    const nomes = {}; pessoasEscala_().forEach(function (p) { nomes[p.email] = p.nome; });
    const nm = function (e) { return nomeCurto_(nomes[e] || e); };
    const quem = nm(ctx.email), tipo = ehTrocaHorario_(l) ? 'horário' : 'dia';
    const msg = 'A troca de ' + tipo + ' entre ' + nm(l.solicitante) + ' e ' + nm(l.colega) + ' (' + datasTroca_(l) + '), que aguardava sua aprovação, foi ' + (aprovada ? 'aprovada' : 'recusada') + ' por ' + quem + papelDecisorTroca_(ctx.email)
      + (!aprovada && obs ? '. Motivo: ' + String(obs).slice(0, 200) : '') + '. O pedido foi encerrado e não precisa mais da sua aprovação. ' + (aprovada ? 'A troca já está na escala publicada.' : 'A escala não mudou.');
    notificar_(dests.map(function (d) { return { dest: d, tipo: 'TROCA_APROVACAO_ENCERRADA', titulo: 'Troca ' + (aprovada ? 'aprovada' : 'recusada') + ' por ' + quem, msg: msg, ref: l.troca_id }; }));
  } catch (e) { /* o aviso nunca impede a decisão */ }
}
/** Registra a aprovação de quem decidiu. Devolve { pendente: true, faltamNomes } se ainda falta alguém. */
function registrarAprovacao_(t, l, ctx) {
  const rt = responsaveisTime_(), ap = aprovacaoTroca_(l, rt).ap;
  ap[ctx.email] = agoraIso_(); l.aprovacoes = JSON.stringify(ap);
  if (aprovaSozinho_(ctx.email)) return { pendente: false }; // gerente ou WFM: vale sozinha
  const a = aprovacaoTroca_(l, rt), faltam = a.faltam, precisaGer = a.semCoord.length > 0;
  if (!faltam.length && !precisaGer) return { pendente: false };
  atualizarLinha_(t, l, { aprovacoes: l.aprovacoes, atualizado_em: agoraIso_() });
  const nomes = {}; pessoasEscala_().forEach(function (p) { nomes[p.email] = p.nome; });
  const pn = function (e) { return nomeCurto_(nomes[e] || e).split(' ')[0]; };
  const faltamNomes = faltam.map(pn).concat(precisaGer ? [pn(GERENTE_TROCAS)] : []);
  const quem = pn(ctx.email) + (ehSubstitutaTrocas_(ctx.email) && a.cobertos.length ? ' (no lugar de ' + a.cobertos.map(pn).join(' e ') + ')' : '');
  log_(ctx.email, 'TROCA_APROVACAO_PARCIAL', 'Troca', l.troca_id, l.solicitante + ',' + l.colega, null, { aprovou: ctx.email, faltam: faltam }, '', l.troca_id);
  notificar_([l.solicitante, l.colega].filter(Boolean).map(function (d) {
    return { dest: d, tipo: 'TROCA_APROVACAO_PARCIAL', titulo: pn(ctx.email) + ' aprovou a troca', msg: quem + ' aprovou a troca de ' + datasTroca_(l) + '. Falta a aprovação de ' + faltamNomes.join(' e ') + '.', ref: l.troca_id };
  }));
  return { pendente: true, faltamNomes: faltamNomes };
}

/* ---------- acompanhamento (o que os agentes veem em "Minhas trocas") ---------- */
function acompTroca_(l, nomes) {
  if (['ABERTA', 'AGUARDANDO_COLEGA', 'AGUARDANDO_GESTAO'].indexOf(l.status) < 0) return null;
  try {
    const rt = RT_LEITURA_ || rtExec_(), a = aprovacaoTroca_(l, rt), pn = function (e) { return nomeCurto_(nomes[e] || e).split(' ')[0]; };
    const de = function (c) { return [l.solicitante, l.colega].filter(function (p) { return p && rt[p] && rt[p].resp === c; }).map(pn).join(' e '); };
    return { coords: a.nec.map(function (c) { const cob = a.cobertos.indexOf(c) >= 0; return { nome: pn(c), de: de(c), ok: !!a.ap[c] || cob, porSubst: cob ? pn(SUBSTITUTA_TROCAS) : '', em: a.ap[c] || '', ausente: a.ausentes.indexOf(c) >= 0 }; }),
      gerente: { nome: pn(GERENTE_TROCAS), ok: a.gerenteAprovou, precisa: a.precisaGerente, semCoord: a.semCoord.map(pn) },
      subst: { nome: pn(SUBSTITUTA_TROCAS), precisa: a.ausentes.length > 0 },
      aberta: !l.colega, prazoAceite: quandoTxt_(prazoAceiteMs_(l)), prazoAprov: quandoTxt_(prazoGestaoMs_(l)) };
  } catch (e) { return null; }
}

/* ---------- expiração por prazo ---------- */
function expirarTrocasDeVezEmQuando_() {
  const c = CacheService.getScriptCache(); if (c.get('exp_trocas')) return;
  c.put('exp_trocas', '1', 180); try { expirarTrocas_(); } catch (e) { /* tenta de novo na próxima */ }
}

/* ---------- regras da troca para mostrar na tela (prévia do pedido) ---------- */
function infoRegrasTroca_(email, colega, dFolga, dTrab, pv) {
  const pes = {}; pessoasEscala_().forEach(function (p) { pes[p.email] = p; });
  const eu = pes[email], col = colega ? pes[normalizar_(colega)] : null, rt = rtExec_();
  const l = { solicitante: email, colega: col ? col.email : '', data_solicitante: dFolga, data_colega: dTrab, aprovacoes: '' };
  const pn = function (e) { return pes[e] ? nomeCurto_(pes[e].nome).split(' ')[0] : e; };
  const a = aprovacaoTroca_(l, rt);
  const aprov = a.nec.map(function (c) { const quem = [l.solicitante, l.colega].filter(function (p) { return p && rt[p] && rt[p].resp === c; }); const sua = quem.indexOf(email) >= 0, outros = quem.filter(function (p) { return p !== email; }).map(pn); return pn(c) + ' (' + (sua ? 'sua coordenação' + (outros.length ? ' e de ' + outros.join(' e ') : '') : 'coordenação de ' + outros.join(' e ')) + ')'; });
  let txtAprov = aprov.length ? aprov.join(' e ') : 'a gerência (' + pn(GERENTE_TROCAS) + ')';
  if (!col) txtAprov += (aprov.length ? ' e ' : '') + 'o coordenador de quem aceitar, se for de outra coordenação';
  let prazoPedido = '', prazoAprov = '';
  try { prazoPedido = quandoTxt_(prazoAceiteMs_(l)); prazoAprov = quandoTxt_(prazoGestaoMs_(l)); } catch (e) { /* sem horário */ }
  const mesH = dFolga.slice(0, 7);
  return { horario: txtHorarioCad_(eu, mesH), colegaHorario: col ? txtHorarioCad_(col, mesH) : '', mesmoHorario: col ? mesmoHorarioCadastro_(eu, col, mesH) : true,
    prazoPedido: prazoPedido, prazoAprov: prazoAprov, aprovadores: txtAprov, dois: a.nec.length > 1,
    domingos: (pv.pessoas || []).map(function (p) { return { nome: nomeCurto_(p.nome).split(' ')[0], antes: p.domTrabAntes, depois: p.domTrabDepois }; }) };
}
function apiTrocaPreviaNova(token, dFolga, dTrab, colega) {
  const ctx = sessao_(token), pv = apiTrocaPreviaNovaBase_(token, dFolga, dTrab, colega);
  try { if (dataIso_(dFolga) && dataIso_(dTrab)) pv.info = infoRegrasTroca_(ctx.email, colega, dataIso_(dFolga), dataIso_(dTrab), pv); } catch (e) { /* sem resumo das regras */ }
  return pv;
}

/** Quem mais falta aprovar além de quem está decidindo (vazio = a aprovação dele efetiva a troca). */
function faltamOutros_(email, l, rt, nomes) {
  if (aprovaSozinho_(email)) return [];
  const a = aprovacaoTroca_(l, rt), pn = function (e) { return nomeCurto_(nomes[e] || e).split(' ')[0]; };
  return a.faltam.filter(function (c) { return c !== email && !(ehSubstitutaTrocas_(email) && a.ausentes.indexOf(c) >= 0); }).map(pn).concat(a.semCoord.length ? [pn(GERENTE_TROCAS)] : []);
}
