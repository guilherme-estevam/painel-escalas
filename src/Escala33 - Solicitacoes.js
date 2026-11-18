/* =====================================================================
 * Escala33 — Solicitações de ajuste na escala (16/11/2026)
 * A gestão pede; só o WFM aprova ou recusa. Ao aprovar, a escala
 * das pessoas envolvidas muda na hora. Tudo fica registrado no Histórico.
 * Avisos só por e-mail e no painel (nunca pelo Slack).
 *
 * Tipos: TROCA_CASADA, TROCA_FOLGA, HORARIO, ALMOCO, JANELA_0800, ATUACAO, INCLUSAO.
 * O núcleo (sol*) é JavaScript puro, sem Apps Script, para poder ser testado fora.
 * ===================================================================== */
var SOL_TIPOS = {
  TROCA_CASADA: 'Troca Casada', TROCA_FOLGA: 'Troca de Folga', HORARIO: 'Mudança de Horário', ALMOCO: 'Mudança de Almoço',
  JANELA_0800: 'Mudança da Janela do 0800', ATUACAO: 'Mudança de Atuação', INCLUSAO: 'Inclusão na Escala'
};
var SOL_PRIOR = { URGENTE: 'Urgente', ALTA: 'Alta', MEDIA: 'Média', BAIXA: 'Baixa' };
var SOL_ATU = { 'Híbrido': [200, 280, 0], 'Assíncrono': [0, 0, 480] };

/* ---------------- núcleo: horas e montagem do dia ---------------- */
function solMi_(h) { var p = String(h || '').split(':'); if (p.length < 2 || isNaN(+p[0]) || isNaN(+p[1])) throw new Error('Horário inválido: ' + h); return (+p[0]) * 60 + (+p[1]); }
function solHm_(n) { return ('0' + Math.floor(n / 60)).slice(-2) + ':' + ('0' + (n % 60)).slice(-2); }
function solDiaBr_(mes, d) { return ('0' + d).slice(-2) + '/' + mes.slice(5, 7); }
function sol0800_(dia) { var b = (dia && dia[3]) || []; for (var i = 0; i < b.length; i++) if (b[i][0] === '0800') return b[i][1]; return ''; }
/** Monta o dia [entrada, almoço, saída, blocos] com almoço de 1h e, se a atuação tiver 0800, uma janela que começa em j. */
function solMontarDia_(g, m, ent, alm, sai, j) {
  var e = solMi_(ent), a = solMi_(alm), s = solMi_(sai);
  if (!(e < a && a + 60 <= s)) throw new Error('O almoço (' + alm + ' às ' + solHm_(a + 60) + ') precisa ficar dentro do horário de ' + ent + ' às ' + sai + '.');
  if (s - e > 11 * 60) throw new Error('O dia passaria de 10 horas de trabalho (' + ent + ' às ' + sai + ').');
  m = m || [0, 0, 0];
  var outro = m[1] > 0 ? 'chat' : (m[2] > 0 ? 'ass' : null);
  if (!outro && !(m[0] > 0)) return [ent, alm, sai];
  var segs = [[e, a], [a + 60, s]], blocos = [];
  var w = null;
  if (m[0] > 0) {
    if (!j) throw new Error('Informe o horário de início da janela do 0800.');
    var ji = solMi_(j), jf = ji + m[0];
    var cabe = segs.some(function (x) { return ji >= x[0] && jf <= x[1]; });
    if (!cabe) throw new Error('A janela do 0800 (' + j + ' às ' + solHm_(jf) + ') precisa caber inteira antes ou depois do almoço, dentro do horário.');
    w = [ji, jf];
  }
  segs.forEach(function (x) {
    if (w && w[0] >= x[0] && w[1] <= x[1]) {
      if (w[0] > x[0] && outro) blocos.push([outro, solHm_(x[0]), solHm_(w[0])]);
      blocos.push(['0800', solHm_(w[0]), solHm_(w[1])]);
      if (w[1] < x[1] && outro) blocos.push([outro, solHm_(w[1]), solHm_(x[1])]);
    } else if (outro && x[1] > x[0]) blocos.push([outro, solHm_(x[0]), solHm_(x[1])]);
  });
  return [ent, alm, sai, blocos];
}
/** Primeiro horário em que o 0800 cabe: no início do turno, logo depois do almoço ou no fim do turno. */
function solJanelaAuto_(g, m, ent, alm, sai) {
  var c = [solMi_(ent), solMi_(alm) + 60, solMi_(sai) - (m[0] || 0)];
  for (var i = 0; i < c.length; i++) { try { solMontarDia_(g, m, ent, alm, sai, solHm_(c[i])); return solHm_(c[i]); } catch (e) { } }
  return '';
}
/** Primeiro dia (número) da semana de domingo a sábado que contém o dia d (pode ser <= 0 no começo do mês). */
function solSemana_(mes, d) { var dt = new Date(+mes.slice(0, 4), +mes.slice(5, 7) - 1, d); return d - dt.getDay(); }
function solDomingo_(mes, d) { return new Date(+mes.slice(0, 4), +mes.slice(5, 7) - 1, d).getDay() === 0; }
/** Regras da escala: 5 dias de trabalho e 2 de folga em cada semana inteira (domingo a sábado) e no máximo 2 domingos de trabalho no mês. */
function solRegras_(mes, nd, nome, antes, depois, erros) {
  var vistos = {};
  for (var d = 1; d <= nd; d++) {
    if (antes.charAt(d - 1) === depois.charAt(d - 1)) continue;
    var ini = solSemana_(mes, d); if (vistos[ini]) continue; vistos[ini] = 1;
    if (ini < 1 || ini + 6 > nd) continue;
    var ca = 0, cd = 0; for (var k = ini; k < ini + 7; k++) { if (antes.charAt(k - 1) === 'T') ca++; if (depois.charAt(k - 1) === 'T') cd++; }
    if (cd !== 5 && cd !== ca) erros.push(nome + ' ficaria com ' + cd + ' dia(s) de trabalho na semana de ' + solDiaBr_(mes, ini) + ' a ' + solDiaBr_(mes, ini + 6) + ' (a regra é 5 dias de trabalho e 2 de folga).');
  }
  var da = 0, dd = 0; for (var k2 = 1; k2 <= nd; k2++) if (solDomingo_(mes, k2)) { if (antes.charAt(k2 - 1) === 'T') da++; if (depois.charAt(k2 - 1) === 'T') dd++; }
  if (dd > 2 && dd > da) erros.push(nome + ' ficaria com ' + dd + ' domingos de trabalho no mês (o máximo é 2).');
}
/** Horário mais comum da pessoa a partir do dia d (o "horário padrão" usado na troca de horário sem data fim). */
function solPadrao_(x, desde) {
  var c = {}, best = '', n = 0;
  for (var d = desde; d <= x.dias.length; d++) { if (x.dias.charAt(d - 1) !== 'T') continue; var e = (x.atu.d || {})[d]; if (!e) continue; var k = JSON.stringify(e); c[k] = (c[k] || 0) + 1; if (c[k] > n) { n = c[k]; best = k; } }
  return best ? JSON.parse(best) : null;
}
/** Texto curto de um dia para a prévia. */
function solTextoDia_(st, dia) {
  if (st !== 'T') return 'Folga';
  if (!dia) return 'Trabalho';
  var t = dia[0] + ' às ' + dia[2] + (dia[1] ? ' · almoço ' + dia[1] + ' às ' + solHm_(solMi_(dia[1]) + 60) : '');
  var b = dia[3] || [], v = b.filter(function (x) { return x[0] === '0800'; })[0], tem = { chat: 0, ass: 0 };
  b.forEach(function (x) { if (tem[x[0]] !== undefined) tem[x[0]] += solMi_(x[2]) - solMi_(x[1]); });
  if (v) t += ' · 0800 ' + v[1] + ' às ' + v[2];
  if (tem.chat) t += ' · chat'; if (tem.ass) t += ' · assíncrono';
  return t;
}

/**
 * Aplica uma solicitação sobre as escalas (publicadas) e devolve o que muda, sem gravar.
 * ctx = { mes, hoje, esc: {email: {dias, atu}}, afast: {email: [[ini, fim, tipo]]}, nomes: {email: nome} }
 * Retorno: { erros:[], set: {email: {dias: {d: 'T'|'F'}, d: {d: dia|null}, g?, m?, nova?}}, previa:[...], resumo }
 */
function solCalcular_(tipo, D, ctx) {
  var erros = [], set = {}, mes = ctx.mes, nd = ctx.nd || 30;
  var nome = function (e) { return (ctx.nomes && ctx.nomes[e]) || String(e || '').split('@')[0]; };
  var curto = function (e) { var p = nome(e).split(' '); return p[0] + (p.length > 1 ? ' ' + p[p.length - 1] : ''); };
  var diaDe = function (iso, rot) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) { erros.push('Informe ' + rot + '.'); return 0; }
    if (iso.slice(0, 7) !== mes) { erros.push(rot.charAt(0).toUpperCase() + rot.slice(1) + ' precisa ser em ' + mes.slice(5) + '/' + mes.slice(0, 4) + ' (mesmo mês da solicitação).'); return 0; }
    if (ctx.hoje && iso < ctx.hoje) { erros.push('Não dá para mudar um dia que já passou (' + solDiaBr_(mes, +iso.slice(8)) + ').'); return 0; }
    return +iso.slice(8);
  };
  var esc = function (e) { var x = ctx.esc[e]; if (!x) erros.push(nome(e) + ' não tem escala em ' + mes.slice(5) + '/' + mes.slice(0, 4) + '.'); return x; };
  var afastado = function (e, d) { var iso = mes + '-' + ('0' + d).slice(-2), l = (ctx.afast && ctx.afast[e]) || []; for (var i = 0; i < l.length; i++) if (l[i][0] <= iso && iso <= l[i][1]) return l[i][2]; return ''; };
  var s = function (e) { return set[e] || (set[e] = { dias: {}, d: {} }); };
  var marca = function (e, d, st, dia) { var af = afastado(e, d); if (af) erros.push(nome(e) + ' está em ' + af.toLowerCase().replace('ferias', 'férias').replace('licenca', 'licença') + ' em ' + solDiaBr_(mes, d) + '.'); s(e).dias[d] = st; s(e).d[d] = st === 'T' ? dia : null; };
  var copia = function (x) { return x ? JSON.parse(JSON.stringify(x)) : x; };
  var periodo = function (e, x) {
    var de = diaDe(D.de, 'a data de início'), ate = (D.ate && !D.semFim) ? diaDe(D.ate, 'a data final') : nd; if (!de || !ate) return [];
    if (ate < de) { erros.push('A data final vem antes da data de início.'); return []; }
    var r = []; for (var d = de; d <= ate; d++) if (x.dias.charAt(d - 1) === 'T' && !afastado(e, d)) r.push(d);
    if (!r.length) erros.push(nome(e) + ' não tem dia de trabalho entre ' + solDiaBr_(mes, de) + ' e ' + solDiaBr_(mes, ate) + '.');
    return r;
  };
  var tenta = function (fn) { try { return fn(); } catch (err) { erros.push(err.message); return null; } };
  var resumo = '';
  if (tipo === 'TROCA_CASADA') {
    var A = D.a, B = D.b; if (!A || !B) erros.push('Escolha as duas pessoas da troca.'); else if (A === B) erros.push('Escolha duas pessoas diferentes.');
    var modo = D.modo || (D.dA && D.dA === D.dB ? 'HORARIO' : 'DIAS');
    var xa = A && esc(A), xb = B && esc(B), dA = diaDe(D.dA, modo === 'HORARIO' ? 'o dia da troca de horário' : 'o dia em que ' + curto(A) + ' folga'), dB = modo === 'HORARIO' ? dA : diaDe(D.dB, 'o dia em que ' + curto(A) + ' trabalha no lugar de ' + curto(B));
    if (xa && xb && dA && dB && !erros.length) {
      var ta = xa.atu.d || {}, tb = xb.atu.d || {};
      if (modo === 'HORARIO' && !D.semFim) {
        if (xa.dias.charAt(dA - 1) !== 'T' || xb.dias.charAt(dA - 1) !== 'T') erros.push('Para trocar o horário em ' + solDiaBr_(mes, dA) + ', as duas pessoas precisam trabalhar nesse dia.');
        else { marca(A, dA, 'T', copia(tb[dA])); marca(B, dA, 'T', copia(ta[dA])); resumo = curto(A) + ' ↔ ' + curto(B) + ' · trocam o horário em ' + solDiaBr_(mes, dA); }
      } else if (modo === 'HORARIO') {
        var pa = solPadrao_(xa, dA), pb = solPadrao_(xb, dA);
        if (!pa || !pb) erros.push('As duas pessoas precisam ter dias de trabalho a partir de ' + solDiaBr_(mes, dA) + '.');
        else if (JSON.stringify(pa) === JSON.stringify(pb) && xa.atu.g === xb.atu.g) erros.push(curto(A) + ' e ' + curto(B) + ' já têm o mesmo horário.');
        else {
          for (var d0 = dA; d0 <= nd; d0++) { if (xa.dias.charAt(d0 - 1) === 'T' && !afastado(A, d0)) marca(A, d0, 'T', copia(pb)); if (xb.dias.charAt(d0 - 1) === 'T' && !afastado(B, d0)) marca(B, d0, 'T', copia(pa)); }
          if (xa.atu.g !== xb.atu.g) { s(A).g = xb.atu.g; s(A).m = xb.atu.m; s(B).g = xa.atu.g; s(B).m = xa.atu.m; }
          resumo = curto(A) + ' ↔ ' + curto(B) + ' · trocam o horário' + (xa.atu.g !== xb.atu.g ? ' e a atuação' : '') + ' a partir de ' + solDiaBr_(mes, dA) + ', sem data fim';
        }
      } else {
        if (solSemana_(mes, dA) !== solSemana_(mes, dB)) erros.push('A troca precisa ser dentro da mesma semana (domingo a sábado).');
        if (xa.dias.charAt(dA - 1) !== 'T') erros.push(curto(A) + ' já folga em ' + solDiaBr_(mes, dA) + ': escolha um dia em que ' + curto(A) + ' trabalha.');
        if (xa.dias.charAt(dB - 1) !== 'F') erros.push(curto(A) + ' já trabalha em ' + solDiaBr_(mes, dB) + '.');
        if (xb.dias.charAt(dB - 1) !== 'T') erros.push(curto(B) + ' já folga em ' + solDiaBr_(mes, dB) + ': escolha um dia em que ' + curto(B) + ' trabalha.');
        if (xb.dias.charAt(dA - 1) !== 'F') erros.push(curto(B) + ' já trabalha em ' + solDiaBr_(mes, dA) + '.');
        if (!erros.length) {
          /* Troca Casada: quem trabalha no dia da outra pessoa sempre assume o horário e a atuação dela nesse dia (não existe manter o próprio horário) */
          marca(A, dA, 'F'); marca(A, dB, 'T', copia(tb[dB]));
          marca(B, dB, 'F'); marca(B, dA, 'T', copia(ta[dA]));
          resumo = curto(A) + ' ↔ ' + curto(B) + ' · ' + solDiaBr_(mes, dA) + ' e ' + solDiaBr_(mes, dB) + ' · cada pessoa assume o horário e a atuação da outra';
        }
      }
    }
  } else if (tipo === 'TROCA_FOLGA') {
    var P = D.a, x = P && esc(P), dt = diaDe(D.dTrab, 'o dia de trabalho que vira folga'), df = diaDe(D.dFolga, 'a folga que vira dia de trabalho');
    if (!P) erros.push('Escolha a pessoa.');
    if (x && dt && df && !erros.length) {
      if (x.dias.charAt(dt - 1) !== 'T') erros.push(curto(P) + ' não trabalha em ' + solDiaBr_(mes, dt) + '.');
      if (x.dias.charAt(df - 1) !== 'F') erros.push(curto(P) + ' já trabalha em ' + solDiaBr_(mes, df) + '.');
      if (solSemana_(mes, dt) !== solSemana_(mes, df)) erros.push('A troca de folga precisa ser dentro da mesma semana (domingo a sábado).');
      if (!erros.length) { marca(P, dt, 'F'); marca(P, df, 'T', copia((x.atu.d || {})[dt])); resumo = curto(P) + ' · folga em ' + solDiaBr_(mes, dt) + ' e trabalho em ' + solDiaBr_(mes, df); }
    }
  } else if (tipo === 'HORARIO' || tipo === 'ALMOCO' || tipo === 'JANELA_0800' || tipo === 'ATUACAO') {
    var Q = D.a, y = Q && esc(Q); if (!Q) erros.push('Escolha a pessoa.');
    if (y) {
      var g = y.atu.g, m = y.atu.m || [0, 0, 0];
      if (tipo === 'ATUACAO') { if (!SOL_ATU[D.g]) erros.push('Escolha a nova atuação.'); else if (D.g === g) erros.push(curto(Q) + ' já está em ' + D.g + '.'); else { g = D.g; m = SOL_ATU[D.g]; } }
      if (tipo === 'JANELA_0800' && !(m[0] > 0)) erros.push(curto(Q) + ' não tem 0800 na atuação.');
      if (tipo === 'HORARIO' && !/^(08|09|10|11):00$/.test(String(D.entrada || ''))) erros.push('Escolha a nova entrada: 08:00, 09:00, 10:00 ou 11:00.');
      if (tipo === 'ALMOCO' && !/^\d{2}:\d{2}$/.test(String(D.almoco || ''))) erros.push('Escolha o novo horário de almoço.');
      if (tipo === 'JANELA_0800' && !/^\d{2}:\d{2}$/.test(String(D.janela || ''))) erros.push('Escolha o novo horário do 0800.');
      if (g === 'Gestão') erros.push(curto(Q) + ' é da gestão e não tem atuação na escala.');
      var dias = erros.length ? [] : periodo(Q, y), td = y.atu.d || {};
      dias.forEach(function (d) {
        var o = td[d] || [], ent = o[0], alm = o[1], sai = o[2], j0 = sol0800_(o), j;
        if (tipo === 'HORARIO') { var dl = solMi_(D.entrada) - solMi_(o[0]); ent = D.entrada; sai = solHm_(solMi_(ent) + 540); alm = D.almocoPH || (o[1] ? solHm_(solMi_(o[1]) + dl) : solHm_(solMi_(ent) + 240)); j = D.janelaPH || (j0 ? solHm_(solMi_(j0) + dl) : ''); }
        else if (tipo === 'ALMOCO') { alm = D.almoco; j = j0; }
        else if (tipo === 'JANELA_0800') j = D.janela;
        else j = D.janelaPH || j0 || (m[0] > 0 ? solJanelaAuto_(g, m, ent, alm, sai) : '');
        if (m[0] > 0 && j && (tipo === 'ALMOCO' || (tipo === 'HORARIO' && !D.janelaPH))) {
          var ok = tenta(function () { return solMontarDia_(g, m, ent, alm, sai, j); });
          if (!ok) { erros.pop(); erros.push(tipo === 'ALMOCO' ? 'Em ' + solDiaBr_(mes, d) + ' o 0800 de ' + curto(Q) + ' (' + j + ' às ' + solHm_(solMi_(j) + m[0]) + ') cairia no horário do novo almoço.' : 'Em ' + solDiaBr_(mes, d) + ' o 0800 não coube no novo horário: o WFM ajusta na aprovação.'); return; }
          marca(Q, d, 'T', ok); return;
        }
        var nv = tenta(function () { return solMontarDia_(g, m, ent, alm, sai, j); }); if (nv) marca(Q, d, 'T', nv);
      });
      if (!erros.length && dias.length) {
        var fimMes = D.semFim || !D.ate || +String(D.ate).slice(8) === nd;
        if (tipo === 'ATUACAO' && fimMes) { s(Q).g = g; s(Q).m = m; }
        var per = D.semFim ? 'a partir de ' + solDiaBr_(mes, dias[0]) + ', sem data fim' : solDiaBr_(mes, dias[0]) + (dias.length > 1 ? ' a ' + solDiaBr_(mes, dias[dias.length - 1]) : '');
        resumo = curto(Q) + ' · ' + (tipo === 'HORARIO' ? 'entrada às ' + D.entrada + ' (' + D.entrada + ' às ' + solHm_(solMi_(D.entrada) + 540) + ')' : tipo === 'ALMOCO' ? 'almoço ' + D.almoco + ' às ' + solHm_(solMi_(D.almoco) + 60) : tipo === 'JANELA_0800' ? '0800 a partir das ' + D.janela : D.g) + ' · ' + per + (D.semFim ? '' : ' (' + dias.length + ' dia' + (dias.length > 1 ? 's' : '') + ')');
      }
    }
  } else if (tipo === 'INCLUSAO') {
    var N = D.a, base = D.copiarDe; if (!N) erros.push('Escolha a pessoa que entra na escala.'); if (!base) erros.push('Escolha de quem copiar os dias de trabalho e folga.');
    if (N && ctx.esc[N]) erros.push(nome(N) + ' já tem escala em ' + mes.slice(5) + '/' + mes.slice(0, 4) + '. Use os outros tipos para ajustar.');
    var xb2 = base && esc(base), de2 = diaDe(D.de, 'a data de entrada'), g2 = D.g, m2 = SOL_ATU[g2]; if (!m2) erros.push('Escolha a atuação.');
    if (N && xb2 && de2 && m2 && !erros.length) {
      var dd = ''; s(N).nova = true; s(N).g = g2; s(N).m = m2;
      for (var k = 1; k <= xb2.dias.length; k++) {
        var trab = k >= de2 && xb2.dias.charAt(k - 1) === 'T'; dd += trab ? 'T' : 'F';
        if (trab) { var nv2 = tenta(function () { return solMontarDia_(g2, m2, D.entrada, D.almoco, D.saida, D.janela); }); if (!nv2) break; marca(N, k, 'T', nv2); } else s(N).dias[k] = 'F';
      }
      s(N).diasTodos = dd;
      if (!erros.length) resumo = curto(N) + ' entra em ' + solDiaBr_(mes, de2) + ' · ' + g2 + ', ' + D.entrada + ' às ' + D.saida + ' · dias como os de ' + curto(base);
    }
  } else erros.push('Tipo de solicitação desconhecido.');
  /* regras da escala para quem tem dia de trabalho ou folga mudando */
  if (!erros.length) Object.keys(set).forEach(function (e) { var x = ctx.esc[e], t = set[e]; if (!x || t.nova) return; var dep = x.dias.split(''), mud = false; Object.keys(t.dias).forEach(function (d) { if (dep[d - 1] !== t.dias[d]) { dep[d - 1] = t.dias[d]; mud = true; } }); if (mud) solRegras_(mes, nd, nome(e), x.dias, dep.join(''), erros); });
  /* prévia: antes × depois de cada dia que muda */
  var previa = [];
  if (!erros.length) Object.keys(set).forEach(function (e) {
    var x = ctx.esc[e], dd2 = [], t = set[e];
    Object.keys(t.dias).map(Number).sort(function (a, b) { return a - b; }).forEach(function (d) {
      var antes = x ? solTextoDia_(x.dias.charAt(d - 1), (x.atu.d || {})[d]) : 'Sem escala', depois = solTextoDia_(t.dias[d], t.d[d]);
      if (t.nova && t.dias[d] === 'F' && d < +String(D.de).slice(8)) return;
      if (antes !== depois) dd2.push({ d: d, data: solDiaBr_(mes, d), antes: antes, depois: depois });
    });
    previa.push({ email: e, nome: nome(e), dias: dd2, atuacao: t.g ? (x ? x.atu.g + ' → ' + t.g : t.g) : '' });
  });
  if (!erros.length && !previa.some(function (p) { return p.dias.length; })) erros.push('Nada muda na escala com esses dados.');
  return { erros: erros, set: set, previa: previa, resumo: resumo };
}
/** Aplica o resultado de solCalcular_ numa versão da escala (publicada ou rascunho). */
function solAplicarVersao_(dias, atu, t) {
  var a = dias.split('');
  Object.keys(t.dias).forEach(function (d) { a[d - 1] = t.dias[d]; });
  atu = JSON.parse(JSON.stringify(atu || {})); atu.d = atu.d || {};
  Object.keys(t.d).forEach(function (d) { if (t.d[d]) atu.d[d] = t.d[d]; else delete atu.d[d]; });
  if (t.g) { atu.g = t.g; atu.m = t.m; }
  return { dias: a.join(''), atu: atu };
}

/* ---------------- servidor (Apps Script) ---------------- */
/* Andamento: AGUARDANDO_GESTAO (os gerentes da operação aprovam) → PENDENTE (Aguardando Análise) → EM_ANALISE → AGUARDANDO_INFO ⇄ EM_ANALISE → APROVADA | RECUSADA | CANCELADA.
 * EXPIRADA é calculada na leitura: solicitação aberta cujo primeiro dia já passou.
 * Histórico: só abertura, aprovação, recusa e cancelamento (análise e conversa não entram). */
var SOL_ABA = 'Solicitacoes';
var SOL_CAB = ['sol_id', 'mes', 'tipo', 'status', 'prioridade', 'agentes', 'dados', 'resumo', 'comentario', 'criada_em', 'criada_por', 'decisao_por', 'decisao_em', 'decisao_obs', 'previa', 'aplicada_em', 'analise_por', 'analise_em', 'conversa', 'gestao_por', 'gestao_em', 'eventos'];
var SOL_ABERTOS = ['AGUARDANDO_GESTAO', 'PENDENTE', 'EM_ANALISE', 'AGUARDANDO_INFO'];
/** Primeira aprovação: um dos dois aprova e só então o pedido vai para o WFM. */
var SOL_GESTAO = ['gerente.dois@exemplo.com', 'coord.beta@exemplo.com'];
function solPodeAprovarGestao_(email, l) { return SOL_GESTAO.indexOf(email) >= 0 && (!l || l.criada_por !== email); }
function solAprovadores_() { return SUPERADMINS.filter(function (e) { return e !== 'wfm.tres@exemplo.com'; }); }
function solPodeDecidir_(email) { return solAprovadores_().indexOf(email) >= 0; }
function solPodeCriar_(ctx) { return ctx.perfil === 'GESTAO' && ctx.email !== 'wfm.tres@exemplo.com'; }
function solSemAvisos_() { return typeof SOL_SEM_AVISOS !== 'undefined' && SOL_SEM_AVISOS === true; }
function solAba_() {
  const ss = db_(); let sh = ss.getSheetByName(SOL_ABA);
  if (!sh) { sh = ss.insertSheet(SOL_ABA); sh.getRange('A:Z').setNumberFormat('@'); sh.getRange(1, 1, 1, SOL_CAB.length).setValues([SOL_CAB]).setFontWeight('bold'); sh.setFrozenRows(1); MEMO_ = {}; return sh; }
  const cab = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String), falta = SOL_CAB.filter(function (c) { return cab.indexOf(c) < 0; });
  if (falta.length) { sh.getRange(1, cab.length + 1, 1, falta.length).setValues([falta]).setFontWeight('bold'); MEMO_ = {}; }
  return sh;
}
function solLinhas_() { solAba_(); return tabela_(SOL_ABA); }
function solCtx_(mes) {
  const esc = {}, nomes = {}, afast = {};
  tabela_('Escalas').linhas.forEach(function (l) { if (l.mes !== mes || !l.dias_publicados) return; let a = {}; try { a = JSON.parse(l.atuacao_publicada || l.atuacao || '{}'); } catch (e) { } esc[l.email] = { dias: String(l.dias_publicados), atu: a }; });
  pessoasEscala_().forEach(function (p) { nomes[p.email] = p.nome; });
  const nd = diasNoMes_(mes), ini = mes + '-01', fim = mes + '-' + ('0' + nd).slice(-2);
  afastamentosEntre_(ini, fim).forEach(function (a) { (afast[a.email] = afast[a.email] || []).push([a.inicio, a.fim, a.tipo]); });
  return { mes: mes, hoje: hojeIso_(), esc: esc, afast: afast, nomes: nomes, nd: nd };
}
function solMesDe_(tipo, D) { const d = D.dA || D.dTrab || D.de || ''; return String(d).slice(0, 7); }
/** Calcula no mês da solicitação e, com "Sem Data Fim", também nos meses seguintes que já têm escala publicada. */
function solCalcularTudo_(tipo, D) {
  const mes = solMesDe_(tipo, D || {}); if (!/^\d{4}-\d{2}$/.test(mes)) return { erros: ['Escolha os dias da solicitação.'], porMes: {}, previa: [], resumo: '' };
  const r0 = solCalcular_(tipo, D, solCtx_(mes)), out = { erros: r0.erros, porMes: {}, previa: r0.previa, resumo: r0.resumo, mes: mes };
  if (r0.erros.length) return out; out.porMes[mes] = r0.set;
  if (D.semFim && (/^(HORARIO|ALMOCO|JANELA_0800|ATUACAO)$/.test(tipo) || (tipo === 'TROCA_CASADA' && D.modo === 'HORARIO'))) {
    const seguintes = {}; tabela_('Escalas').linhas.forEach(function (l) { if (l.mes > mes && (l.email === D.a || l.email === D.b) && l.dias_publicados) seguintes[l.mes] = 1; });
    Object.keys(seguintes).sort().forEach(function (m) {
      const r = solCalcular_(tipo, Object.assign({}, D, { de: m + '-01', dA: m + '-01', ate: '' }), Object.assign(solCtx_(m), { hoje: '' }));
      if (r.erros.length) return; out.porMes[m] = r.set;
      r.previa.forEach(function (p) { const q = out.previa.filter(function (x) { return x.email === p.email; })[0]; if (q) q.dias = q.dias.concat(p.dias); else out.previa.push(p); });
    });
  }
  return out;
}
/** Linha do tempo do pedido: cada ação com data, hora e quem fez. Pedidos antigos (sem a lista) têm a linha montada pelas datas guardadas. */
function solEventos_(l) {
  let ev = []; try { ev = JSON.parse(l.eventos || '[]'); } catch (e) { ev = []; }
  if (ev.length) return ev;
  let conv = []; try { conv = JSON.parse(l.conversa || '[]'); } catch (e) { conv = []; }
  const recGestao = l.status === 'RECUSADA' && l.gestao_por && l.decisao_por === l.gestao_por;
  ev.push({ em: l.criada_em, por: l.criada_por, acao: 'CRIADA' });
  if (l.gestao_por && !recGestao) ev.push({ em: l.gestao_em, por: l.gestao_por, acao: 'GESTAO_APROVADA' });
  if (l.analise_por) ev.push({ em: l.analise_em, por: l.analise_por, acao: 'ANALISE' });
  conv.forEach(function (m) { ev.push({ em: m.em, por: m.por, acao: m.tipo === 'PERGUNTA' ? 'PERGUNTA' : 'RESPOSTA', txt: m.texto }); });
  if (l.decisao_em) ev.push({ em: l.decisao_em, por: l.decisao_por, acao: l.status === 'APROVADA' ? 'APROVADA' : l.status === 'CANCELADA' ? 'CANCELADA' : recGestao ? 'GESTAO_RECUSADA' : 'RECUSADA', txt: l.decisao_obs || '' });
  return ev.filter(function (x) { return x.em; }).sort(function (a, b) { return a.em < b.em ? -1 : a.em > b.em ? 1 : 0; });
}
function solEv_(l, por, acao, txt) { const ev = solEventos_(l); ev.push({ em: agoraIso_(), por: por, acao: acao, txt: txt || '' }); return JSON.stringify(ev); }
function solObj_(l) {
  const js = function (x, d) { try { return JSON.parse(x || ''); } catch (e) { return d; } };
  const previa = js(l.previa, []), dados = js(l.dados, {}), hoje = hojeIso_();
  let primeiro = ''; previa.forEach(function (p) { (p.dias || []).forEach(function (d) { const iso = l.mes + '-' + ('0' + d.d).slice(-2); if (!primeiro || iso < primeiro) primeiro = iso; }); });
  const status = SOL_ABERTOS.indexOf(l.status) >= 0 && primeiro && primeiro < hoje ? 'EXPIRADA' : l.status;
  return { id: l.sol_id, mes: l.mes, tipo: l.tipo, tipoNome: SOL_TIPOS[l.tipo] || l.tipo, status: status, statusGravado: l.status, prioridade: l.prioridade, agentes: String(l.agentes || '').split(',').filter(String),
    dados: dados, resumo: l.resumo, comentario: l.comentario, criadaEm: l.criada_em, criadaPor: l.criada_por, decisaoPor: l.decisao_por, decisaoEm: l.decisao_em, decisaoObs: l.decisao_obs,
    previa: previa, aplicadaEm: l.aplicada_em, analisePor: l.analise_por, analiseEm: l.analise_em, conversa: js(l.conversa, []), primeiroDia: primeiro, gestaoPor: l.gestao_por || '', gestaoEm: l.gestao_em || '', eventos: solEventos_(l) };
}
function solAvisos_(lista) {
  if (!lista.length || solSemAvisos_()) return; const agora = agoraIso_();
  appendLinhas_('Notificacoes', lista.map(function (n) { return { notif_id: novoId_('nt'), destinatario: n.dest, tipo: n.tipo || 'SOLICITACAO', titulo: n.titulo, mensagem: n.msg, referencia: n.ref || '', criada_em: agora }; }));
  try { novaVersaoNotif_(); } catch (e) { }
}
function solEmail_(para, assunto, html) { if (solSemAvisos_()) return; try { enviarEmail_(para, assunto, html); } catch (e) { } }
function solLimparCaches_(mes) {
  MEMO_ = {}; if (typeof HOR_BASE_ !== 'undefined') HOR_BASE_ = {};
  try { const nd = diasNoMes_(mes); for (let d = 1; d <= nd; d++) lgDiaLimpar_(mes + '-' + ('0' + d).slice(-2)); } catch (e) { }
  try { presPendLimpar_(); } catch (e) { }
}
function solNome_(email) { const p = pessoasEscala_().filter(function (x) { return x.email === email; })[0]; return p ? p.nome : email; }
function solAchar_(t, id) { const l = t.linhas.filter(function (x) { return x.sol_id === id; })[0]; if (!l) throw new Error('Solicitação não encontrada.'); return l; }

/** Lista, resumo e dados para o formulário. */
function apiSolicitacoes(token) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  const lista = solLinhas_().linhas.map(solObj_).sort(function (a, b) { return a.criadaEm < b.criadaEm ? 1 : -1; });
  const hoje = hojeIso_(), mesAtual = hoje.slice(0, 7), abertas = lista.filter(function (s) { return SOL_ABERTOS.indexOf(s.status) >= 0; });
  const decid = lista.filter(function (s) { return s.decisaoEm && (s.status === 'APROVADA' || s.status === 'RECUSADA'); });
  const tempos = decid.map(function (s) { return (new Date(s.decisaoEm) - new Date(s.criadaEm)) / 60000; }).filter(function (x) { return x >= 0; });
  const meses = {}; tabela_('Escalas').linhas.forEach(function (l) { if (l.mes >= mesAtual && l.dias_publicados) (meses[l.mes] = meses[l.mes] || {})[l.email] = l; });
  const pessoas = pessoasEscala_().map(function (p) {
    const em = {}; Object.keys(meses).forEach(function (m) { const l = meses[m][p.email]; if (l) { let a = {}; try { a = JSON.parse(l.atuacao_publicada || '{}'); } catch (e) { } em[m] = { dias: l.dias_publicados, g: a.g || '', d: a.d || {} }; } });
    return { email: p.email, nome: p.nome, coord: p.coord, cargo: p.cargo, perfil: p.perfil, esc: em };
  });
  const conta = function (st) { return abertas.filter(function (s) { return s.status === st; }).length; };
  return {
    eu: ctx.email, podeCriar: solPodeCriar_(ctx), podeDecidir: solPodeDecidir_(ctx.email), aprovadores: solAprovadores_(), gestao: SOL_GESTAO, podeAprovarGestao: SOL_GESTAO.indexOf(ctx.email) >= 0, hoje: hoje, meses: Object.keys(meses).sort(), semAvisos: solSemAvisos_(),
    lista: lista.slice(0, 400), pessoas: pessoas, tipos: SOL_TIPOS, prioridades: SOL_PRIOR, cr: (typeof coordResp_ === 'function' ? coordResp_() : {}),
    minhas: solMinhas_(ctx.email, lista),
    resumo: { aguardandoGestao: conta('AGUARDANDO_GESTAO'), aguardando: conta('PENDENTE'), emAnalise: conta('EM_ANALISE'), aguardandoInfo: conta('AGUARDANDO_INFO'), abertas: abertas.length,
      urgentes: abertas.filter(function (s) { return s.prioridade === 'URGENTE'; }).length,
      aprovadasMes: decid.filter(function (s) { return s.status === 'APROVADA' && String(s.decisaoEm).slice(0, 7) === mesAtual; }).length,
      recusadasMes: decid.filter(function (s) { return s.status === 'RECUSADA' && String(s.decisaoEm).slice(0, 7) === mesAtual; }).length,
      tempoMedioMin: tempos.length ? Math.round(tempos.reduce(function (a, b) { return a + b; }, 0) / tempos.length) : null }
  };
}
/** Quantidade de solicitações abertas (selo na aba). */
/** O que está esperando a ação desta pessoa: os gerentes da operação (aprovação da gestão, menos os próprios pedidos), WFM
 *  (Aguardando Análise para todos; Em Análise só para quem colocou em análise) e quem pediu (quando falta responder uma pergunta). */
function solMinhas_(email, lista) {
  const g = { gestao: 0, ph: 0, info: 0 }, ph = solPodeDecidir_(email), ges = SOL_GESTAO.indexOf(email) >= 0;
  lista.forEach(function (s) {
    if (s.status === 'AGUARDANDO_GESTAO' && ges && s.criadaPor !== email) g.gestao++;
    else if (s.status === 'PENDENTE' && ph) g.ph++;
    else if (s.status === 'EM_ANALISE' && ph && s.analisePor === email) g.ph++;
    else if (s.status === 'AGUARDANDO_INFO' && s.criadaPor === email) g.info++;
  });
  g.n = g.gestao + g.ph + g.info; return g;
}
function apiSolicitacoesPendentes(token) { const ctx = sessao_(token); if (ctx.perfil !== 'GESTAO') return { n: 0 }; try { return solMinhas_(ctx.email, solLinhas_().linhas.map(solObj_)); } catch (e) { return { n: 0 }; } }
/** Como a escala vai ficar, sem gravar nada. */
function apiSolicitacaoPrevia(token, sol) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  const r = solCalcularTudo_(sol.tipo, sol.dados || {});
  return { ok: !r.erros.length, erros: r.erros, previa: r.previa, resumo: r.resumo, mes: r.mes };
}
function apiSolicitacaoCriar(token, sol) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  if (!solPodeCriar_(ctx)) throw new Error('Seu acesso é só de acompanhamento: não dá para abrir solicitações.');
  if (sol.tipo === 'INCLUSAO') return { ok: false, erros: ['A inclusão na escala é feita pelo WFM no Planejamento.'] };
  if (sol.dados) { delete sol.dados.almocoPH; delete sol.dados.janelaPH; }
  const com = String(sol.comentario || '').trim(); if (com.length < 10) return { ok: false, erros: ['Escreva um comentário explicando a solicitação (pelo menos 10 caracteres).'] };
  if (!SOL_PRIOR[sol.prioridade]) return { ok: false, erros: ['Escolha a prioridade.'] };
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const r = solCalcularTudo_(sol.tipo, sol.dados || {}); if (r.erros.length) return { ok: false, erros: r.erros };
    const id = novoId_('sol'), agora = agoraIso_(), agentes = [], direto = SOL_GESTAO.indexOf(ctx.email) >= 0; /* os gerentes da operação pedindo: a aprovação da gestão já é de quem pediu */ Object.keys(r.porMes).forEach(function (m) { Object.keys(r.porMes[m]).forEach(function (e) { if (agentes.indexOf(e) < 0) agentes.push(e); }); });
    appendLinhas_(SOL_ABA, [{ sol_id: id, mes: r.mes, tipo: sol.tipo, status: direto ? 'PENDENTE' : 'AGUARDANDO_GESTAO', prioridade: sol.prioridade, agentes: agentes.join(','), dados: JSON.stringify(sol.dados || {}), resumo: r.resumo, comentario: com, criada_em: agora, criada_por: ctx.email, gestao_por: direto ? ctx.email : '', gestao_em: direto ? agora : '', eventos: JSON.stringify([{ em: agora, por: ctx.email, acao: 'CRIADA', txt: '' }].concat(direto ? [{ em: agora, por: ctx.email, acao: 'GESTAO_APROVADA', txt: '' }] : [])), previa: JSON.stringify(r.previa), conversa: '[]' }]);
    log_(ctx.email, 'SOLICITACAO_CRIADA', 'Solicitacao', id, agentes.join(','), null, { tipo: SOL_TIPOS[sol.tipo], prioridade: SOL_PRIOR[sol.prioridade], resumo: r.resumo }, '', '');
    const nomeEu = solNome_(ctx.email);
    if (direto) {
      solAvisos_(solAprovadores_().filter(function (e) { return e !== ctx.email; }).map(function (e) { return { dest: e, tipo: 'SOLICITACAO_NOVA', titulo: 'Nova solicitação · ' + SOL_PRIOR[sol.prioridade], msg: nomeEu + ' pediu e já aprovou na gestão: ' + SOL_TIPOS[sol.tipo] + ' — ' + r.resumo + '. Abra Gestão de Escalas › Solicitações.', ref: id }; }));
      if (sol.prioridade === 'URGENTE') solAprovadores_().filter(function (e) { return e !== ctx.email; }).forEach(function (e) { solEmail_(e, 'Solicitação urgente de ajuste na escala', escHtml_(nomeEu) + ' abriu e já aprovou na gestão uma solicitação <b>urgente</b>: ' + escHtml_(SOL_TIPOS[sol.tipo]) + ' — ' + escHtml_(r.resumo) + '.<br><br><i>' + escHtml_(com) + '</i>'); });
      return { ok: true, id: id, direto: true };
    }
    solAvisos_(SOL_GESTAO.filter(function (e) { return e !== ctx.email; }).map(function (e) { return { dest: e, tipo: 'SOLICITACAO_NOVA', titulo: 'Nova solicitação para aprovar · ' + SOL_PRIOR[sol.prioridade], msg: nomeEu + ' pediu: ' + SOL_TIPOS[sol.tipo] + ' — ' + r.resumo + '. Aprove ou recuse em Gestão de Escalas › Solicitações.', ref: id }; }));
    if (sol.prioridade === 'URGENTE') SOL_GESTAO.filter(function (e) { return e !== ctx.email; }).forEach(function (e) { solEmail_(e, 'Solicitação urgente de ajuste na escala', escHtml_(nomeEu) + ' abriu uma solicitação <b>urgente</b>: ' + escHtml_(SOL_TIPOS[sol.tipo]) + ' — ' + escHtml_(r.resumo) + '.<br><br><i>' + escHtml_(com) + '</i>'); });
    return { ok: true, id: id };
  } finally { lock.releaseLock(); }
}
/** os gerentes da operação: aprovar (o pedido segue para o WFM) ou recusar (com motivo). Quem abriu não aprova o próprio pedido. */
function apiSolicitacaoGestao(token, id, aprovar, obs) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  obs = String(obs || '').trim();
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const t = solLinhas_(), l = solAchar_(t, id), s = solObj_(l);
    if (!solPodeAprovarGestao_(ctx.email, l)) throw new Error(SOL_GESTAO.indexOf(ctx.email) >= 0 ? 'Quem abriu a solicitação não aprova o próprio pedido.' : 'Só os gerentes da operação aprovam esta etapa.');
    if (s.status !== 'AGUARDANDO_GESTAO') return { ok: false, erros: ['Essa solicitação não está esperando a aprovação da gestão.'] };
    const agora = agoraIso_(), nomeEu = solNome_(ctx.email);
    if (!aprovar) {
      if (obs.length < 5) return { ok: false, erros: ['Para recusar, escreva o motivo (pelo menos 5 caracteres).'] };
      atualizarLinha_(t, l, { status: 'RECUSADA', decisao_por: ctx.email, decisao_em: agora, decisao_obs: obs, gestao_por: ctx.email, gestao_em: agora, eventos: solEv_(l, ctx.email, 'GESTAO_RECUSADA', obs) });
      log_(ctx.email, 'SOLICITACAO_RECUSADA', 'Solicitacao', id, l.agentes, null, { tipo: SOL_TIPOS[l.tipo], resumo: l.resumo }, '', '');
      solAvisos_([{ dest: l.criada_por, tipo: 'SOLICITACAO_RECUSADA', titulo: 'Solicitação recusada', msg: nomeEu + ' recusou: ' + SOL_TIPOS[l.tipo] + ' — ' + l.resumo + '. Motivo: ' + obs, ref: id }]);
      solEmail_(l.criada_por, 'Sua solicitação foi recusada', escHtml_(nomeEu) + ' recusou a solicitação <b>' + escHtml_(SOL_TIPOS[l.tipo]) + '</b> — ' + escHtml_(l.resumo) + '.<br><br>Motivo: ' + escHtml_(obs));
      return { sol: solObj_(l), ok: true, status: 'RECUSADA' };
    }
    atualizarLinha_(t, l, { status: 'PENDENTE', gestao_por: ctx.email, gestao_em: agora, eventos: solEv_(l, ctx.email, 'GESTAO_APROVADA') });
    solAvisos_(solAprovadores_().map(function (e) { return { dest: e, tipo: 'SOLICITACAO_NOVA', titulo: 'Nova solicitação · ' + SOL_PRIOR[l.prioridade], msg: nomeEu + ' aprovou e enviou ao WFM: ' + SOL_TIPOS[l.tipo] + ' — ' + l.resumo + '. Abra Gestão de Escalas › Solicitações.', ref: id }; }));
    if (l.prioridade === 'URGENTE') solAprovadores_().forEach(function (e) { solEmail_(e, 'Solicitação urgente de ajuste na escala', escHtml_(nomeEu) + ' aprovou e enviou ao WFM uma solicitação <b>urgente</b>: ' + escHtml_(SOL_TIPOS[l.tipo]) + ' — ' + escHtml_(l.resumo) + '.'); });
    return { sol: solObj_(l), ok: true, status: 'PENDENTE' };
  } finally { lock.releaseLock(); }
}
/** WFM: colocar em análise, pedir mais informações ou devolver para "Aguardando Análise". Não vai para o Histórico. */
function apiSolicitacaoAnalisar(token, id, acao, texto) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  if (!solPodeDecidir_(ctx.email)) throw new Error('Só o WFM analisa as solicitações.');
  texto = String(texto || '').trim();
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const t = solLinhas_(), l = solAchar_(t, id), s = solObj_(l);
    if (SOL_ABERTOS.indexOf(s.status) < 0) return { ok: false, erros: ['Essa solicitação não está mais aberta (' + s.status.toLowerCase() + ').'] };
    if (s.status === 'AGUARDANDO_GESTAO') return { ok: false, erros: ['Essa solicitação ainda espera a aprovação dos gerentes da operação.'] };
    const agora = agoraIso_(), conv = s.conversa || [];
    if (acao === 'ANALISAR') atualizarLinha_(t, l, { status: 'EM_ANALISE', analise_por: ctx.email, analise_em: agora, eventos: solEv_(l, ctx.email, 'ANALISE') });
    else if (acao === 'VOLTAR') atualizarLinha_(t, l, { status: 'PENDENTE', analise_por: '', analise_em: '', eventos: solEv_(l, ctx.email, 'DEVOLVIDA') });
    else if (acao === 'PEDIR_INFO') {
      if (s.status === 'PENDENTE') return { ok: false, erros: ['Coloque a solicitação em análise antes de pedir mais informações.'] };
      if (texto.length < 5) return { ok: false, erros: ['Escreva o que falta saber (pelo menos 5 caracteres).'] };
      conv.push({ por: ctx.email, em: agora, tipo: 'PERGUNTA', texto: texto });
      atualizarLinha_(t, l, { status: 'AGUARDANDO_INFO', analise_por: l.analise_por || ctx.email, analise_em: l.analise_em || agora, eventos: solEv_(l, ctx.email, 'PERGUNTA', texto), conversa: JSON.stringify(conv) });
      solAvisos_([{ dest: l.criada_por, tipo: 'SOLICITACAO_INFO', titulo: 'O WFM pediu mais informações', msg: solNome_(ctx.email) + ' pergunta sobre ' + SOL_TIPOS[l.tipo] + ' — ' + l.resumo + ': ' + texto, ref: id }]);
      solEmail_(l.criada_por, 'Sua solicitação precisa de mais informações', escHtml_(solNome_(ctx.email)) + ' pergunta sobre <b>' + escHtml_(SOL_TIPOS[l.tipo]) + '</b> — ' + escHtml_(l.resumo) + ':<br><br><i>' + escHtml_(texto) + '</i><br><br>Responda em Gestão de Escalas › Solicitações.');
    } else throw new Error('Ação desconhecida.');
    return { sol: solObj_(l), ok: true };
  } finally { lock.releaseLock(); }
}
/** Quem pediu responde ao pedido de informações; a solicitação volta para análise. Não vai para o Histórico. */
function apiSolicitacaoResponder(token, id, texto) {
  const ctx = sessao_(token); exigirGestao_(ctx); texto = String(texto || '').trim();
  if (texto.length < 5) return { ok: false, erros: ['Escreva a resposta (pelo menos 5 caracteres).'] };
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const t = solLinhas_(), l = solAchar_(t, id), s = solObj_(l);
    if (s.status !== 'AGUARDANDO_INFO') return { ok: false, erros: ['Essa solicitação não está esperando resposta.'] };
    if (l.criada_por !== ctx.email && !solPodeDecidir_(ctx.email)) throw new Error('Só quem abriu a solicitação pode responder.');
    const conv = s.conversa || []; conv.push({ por: ctx.email, em: agoraIso_(), tipo: 'RESPOSTA', texto: texto });
    atualizarLinha_(t, l, { status: l.analise_por ? 'EM_ANALISE' : 'PENDENTE', eventos: solEv_(l, ctx.email, 'RESPOSTA', texto), conversa: JSON.stringify(conv) });
    if (l.analise_por) solAvisos_([{ dest: l.analise_por, tipo: 'SOLICITACAO_RESPOSTA', titulo: 'Resposta numa solicitação', msg: solNome_(ctx.email) + ' respondeu sobre ' + SOL_TIPOS[l.tipo] + ' — ' + l.resumo + ': ' + texto, ref: id }]);
    return { sol: solObj_(l), ok: true };
  } finally { lock.releaseLock(); }
}
function apiSolicitacaoCancelar(token, id) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const t = solLinhas_(), l = solAchar_(t, id), s = solObj_(l);
    if (SOL_ABERTOS.indexOf(s.status) < 0) throw new Error('Essa solicitação não está mais aberta.');
    if (l.criada_por !== ctx.email && !solPodeDecidir_(ctx.email)) throw new Error('Só quem abriu a solicitação pode cancelar.');
    atualizarLinha_(t, l, { status: 'CANCELADA', decisao_por: ctx.email, decisao_em: agoraIso_(), eventos: solEv_(l, ctx.email, 'CANCELADA') });
    log_(ctx.email, 'SOLICITACAO_CANCELADA', 'Solicitacao', id, l.agentes, null, { tipo: SOL_TIPOS[l.tipo], resumo: l.resumo }, '', '');
    return { sol: solObj_(l), ok: true };
  } finally { lock.releaseLock(); }
}
/** Aprova (muda a escala na hora) ou recusa. Só o WFM. */
function apiSolicitacaoDecidir(token, id, aprovar, obs, ajustes) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  if (!solPodeDecidir_(ctx.email)) throw new Error('Só o WFM aprova ou recusa solicitações.');
  obs = String(obs || '').trim(); if (!aprovar && obs.length < 5) return { ok: false, erros: ['Para recusar, escreva o motivo (pelo menos 5 caracteres).'] };
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const t = solLinhas_(), l = solAchar_(t, id), s0 = solObj_(l);
    if (SOL_ABERTOS.indexOf(s0.status) < 0) return { ok: false, erros: ['Essa solicitação não está mais aberta (' + s0.status.toLowerCase() + ').'] };
    if (s0.status === 'AGUARDANDO_GESTAO') return { ok: false, erros: ['Essa solicitação ainda espera a aprovação dos gerentes da operação.'] };
    if (s0.status === 'PENDENTE') return { ok: false, erros: ['Coloque a solicitação em análise antes de aprovar ou recusar.'] };
    const agora = agoraIso_(), nomeEu = solNome_(ctx.email); let dados = {}; try { dados = JSON.parse(l.dados || '{}'); } catch (e) { }
    if (!aprovar) {
      atualizarLinha_(t, l, { status: 'RECUSADA', decisao_por: ctx.email, decisao_em: agora, decisao_obs: obs, eventos: solEv_(l, ctx.email, 'RECUSADA', obs) });
      log_(ctx.email, 'SOLICITACAO_RECUSADA', 'Solicitacao', id, l.agentes, null, { tipo: SOL_TIPOS[l.tipo], resumo: l.resumo }, '', '');
      solAvisos_([{ dest: l.criada_por, tipo: 'SOLICITACAO_RECUSADA', titulo: 'Solicitação recusada', msg: nomeEu + ' recusou: ' + SOL_TIPOS[l.tipo] + ' — ' + l.resumo + '. Motivo: ' + obs, ref: id }]);
      solEmail_(l.criada_por, 'Sua solicitação foi recusada', escHtml_(nomeEu) + ' recusou a solicitação <b>' + escHtml_(SOL_TIPOS[l.tipo]) + '</b> — ' + escHtml_(l.resumo) + '.<br><br>Motivo: ' + escHtml_(obs));
      return { sol: solObj_(l), ok: true, status: 'RECUSADA' };
    }
    if (ajustes && /^(HORARIO|ATUACAO)$/.test(l.tipo)) { ['almocoPH', 'janelaPH'].forEach(function (k) { if (ajustes[k] && /^\d{2}:\d{2}$/.test(ajustes[k])) dados[k] = ajustes[k]; else delete dados[k]; }); atualizarLinha_(t, l, { dados: JSON.stringify(dados) }); }
    /* recalcula sobre a escala de agora: se algo mudou desde o pedido, avisa em vez de gravar errado */
    const r = solCalcularTudo_(l.tipo, dados);
    if (r.erros.length) return { ok: false, erros: ['A escala mudou desde o pedido e a solicitação não pode ser aplicada como está:'].concat(r.erros) };
    const te = tabela_('Escalas'), logs = [], op = novoId_('op');
    Object.keys(r.porMes).forEach(function (mes) {
      const set = r.porMes[mes];
      Object.keys(set).forEach(function (email) {
        const sx = set[email], e = te.linhas.filter(function (x) { return x.mes === mes && x.email === email; })[0]; if (!e || sx.nova) return;
        let pub = {}, ras = {}; try { pub = JSON.parse(e.atuacao_publicada || '{}'); } catch (x) { } try { ras = JSON.parse(e.atuacao || '{}'); } catch (x) { }
        const np = solAplicarVersao_(String(e.dias_publicados), pub, sx), nr = solAplicarVersao_(String(e.dias || e.dias_publicados), ras, sx);
        atualizarLinha_(te, e, { dias_publicados: np.dias, atuacao_publicada: JSON.stringify(np.atu), dias: nr.dias, atuacao: JSON.stringify(nr.atu), versao: String(Number(e.versao || 0) + 1), atualizado_em: agora, atualizado_por: ctx.email });
        const pv = r.previa.filter(function (p) { return p.email === email; })[0];
        logs.push({ ator: ctx.email, acao: 'ESCALA_ALTERADA', tipo: 'Escala', registro: e.escala_id, afetado: email, antes: { dias: (pv ? pv.dias : []).map(function (x) { return x.data + ': ' + x.antes; }) }, depois: { solicitacao: id, dias: (pv ? pv.dias : []).map(function (x) { return x.data + ': ' + x.depois; }) }, motivo: '', op: op });
      });
    });
    if (dados.semFim && l.tipo === 'HORARIO' && dados.a) { const tp = tabela_('Pessoas'), p = tp.linhas.filter(function (x) { return x.email === dados.a; })[0]; if (p) atualizarLinha_(tp, p, { entrada_planejada: dados.entrada, saida_planejada: dados.saida, atualizado_em: agora }); }
    atualizarLinha_(t, l, { status: 'APROVADA', decisao_por: ctx.email, decisao_em: agora, decisao_obs: obs, previa: JSON.stringify(r.previa), aplicada_em: agora, eventos: solEv_(l, ctx.email, 'APROVADA', [dados.almocoPH ? 'almoço às ' + dados.almocoPH : '', dados.janelaPH ? '0800 a partir das ' + dados.janelaPH : ''].filter(String).join(' e ') ? 'Ajustes do WFM: ' + [dados.almocoPH ? 'almoço às ' + dados.almocoPH : '', dados.janelaPH ? '0800 a partir das ' + dados.janelaPH : ''].filter(String).join(' e ') : '') });
    logs.push({ ator: ctx.email, acao: 'SOLICITACAO_APROVADA', tipo: 'Solicitacao', registro: id, afetado: l.agentes, antes: null, depois: { tipo: SOL_TIPOS[l.tipo], resumo: r.resumo }, motivo: '', op: op });
    logLote_(logs); Object.keys(r.porMes).forEach(solLimparCaches_);
    /* avisos: quem pediu e as pessoas da escala (painel + e-mail; sem Slack) */
    const av = [{ dest: l.criada_por, tipo: 'SOLICITACAO_APROVADA', titulo: 'Solicitação aprovada', msg: nomeEu + ' aprovou: ' + SOL_TIPOS[l.tipo] + ' — ' + r.resumo + '. A escala já foi atualizada.', ref: id }];
    r.previa.forEach(function (p) {
      if (!p.dias.length) return; const linhas = p.dias.map(function (x) { return x.data + ': ' + x.depois; });
      av.push({ dest: p.email, tipo: 'ESCALA_ALTERADA', titulo: 'Sua escala mudou', msg: 'Sua escala mudou. ' + linhas.join(' · ') + '. Nos outros dias, nada muda. Confira em Minha Escala.', ref: l.mes });
      solEmail_(p.email, 'Sua escala mudou', 'Sua escala mudou:<br>' + p.dias.map(function (x) { return '• <b>' + x.data + ':</b> ' + escHtml_(x.depois); }).join('<br>') + '<br><br>Nos outros dias, nada muda.');
    });
    solAvisos_(av);
    solEmail_(l.criada_por, 'Sua solicitação foi aprovada', escHtml_(nomeEu) + ' aprovou a solicitação <b>' + escHtml_(SOL_TIPOS[l.tipo]) + '</b> — ' + escHtml_(r.resumo) + '. A escala já foi atualizada.');
    return { sol: solObj_(l), ok: true, status: 'APROVADA', previa: r.previa };
  } finally { lock.releaseLock(); }
}
