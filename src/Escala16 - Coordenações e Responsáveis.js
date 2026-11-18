/**
 * Escala16.gs — (1) aprovação de trocas pelo coordenador do time ou pelo WFM;
 *               (2) presença no painel: quem está online agora e quem entrou hoje.
 */

/* ---------- (1) quem aprova cada troca ---------- */
/** Para cada pessoa: nome da coordenação e e-mail do coordenador responsável (só se ele tem acesso ao painel). */
function responsaveisTime_() {
  const mapa = coordenacoes_(), comAcesso = {}, out = {};
  tabela_('Usuarios').linhas.forEach(function (u) { if (u.perfil === 'GESTAO') comAcesso[u.email] = 1; });
  tabela_('Pessoas').linhas.forEach(function (p) {
    const c = coordDe_(p, mapa), reg = c.id ? mapa[c.id] : null, resp = reg ? normalizar_(reg.email_responsavel || '') : '';
    out[p.email] = { coord: c.nome, resp: resp && comAcesso[resp] ? resp : '' };
  });
  return out;
}
/** Coordenadores que podem aprovar a troca (de qualquer uma das duas pessoas, sem contar quem participa dela). */
function coordenadoresTroca_(l, rt) {
  rt = rt || responsaveisTime_();
  const lista = [];
  [l.solicitante, l.colega].forEach(function (e) { const x = e ? rt[e] : null; if (x && x.resp && lista.indexOf(x.resp) < 0 && x.resp !== l.solicitante && x.resp !== l.colega) lista.push(x.resp); });
  return lista;
}
/** Pode aprovar: o coordenador de uma das duas pessoas que ainda não aprovou, ou o gerente (aprova qualquer troca sozinho). WFM só acompanha. */
function podeDecidirTroca_(email, l, rt) {
  if (email === l.solicitante || email === l.colega) return false;
  if (aprovaSozinho_(email)) return true; // gerente e WFM decidem qualquer troca
  const a = aprovacaoTroca_(l, rt);
  if (a.nec.indexOf(email) >= 0 && !a.ap[email]) return true;
  return ehSubstitutaTrocas_(email) && !a.ap[email] && a.ausentes.some(function (c) { return !a.ap[c]; }); // substituta: só no lugar de coordenador de férias ou licença
}
/** Texto de quem aprova: "Alfa (coordenação de Ana) ✓ já aprovou e Beta (coordenação de Bruno) — falta aprovar. O gerente também pode aprovar sozinho." */
function txtAprovadores_(l, rt, nomes) {
  rt = rt || responsaveisTime_();
  if (!nomes) { nomes = {}; pessoasEscala_().forEach(function (x) { nomes[x.email] = x.nome; }); }
  const a = aprovacaoTroca_(l, rt), pn = function (e) { return nomeCurto_(nomes[e] || e).split(' ')[0]; };
  const partes = a.nec.map(function (c) {
    const quem = [l.solicitante, l.colega].filter(function (p) { return p && rt[p] && rt[p].resp === c; }).map(pn);
    return pn(c) + ' (coordenação de ' + quem.join(' e ') + ')' + (a.ap[c] ? ' ✓ já aprovou' : a.cobertos.indexOf(c) >= 0 ? ' ✓ ' + pn(SUBSTITUTA_TROCAS) + ' aprovou no lugar' : a.ausentes.indexOf(c) >= 0 ? ' — de férias ou licença (' + pn(SUBSTITUTA_TROCAS) + ' pode aprovar no lugar)' : ' — falta aprovar');
  });
  return (partes.length ? (partes.length > 1 ? 'Os dois coordenadores: ' : '') + partes.join(' e ') + '. ' : '') + 'A gerência (' + pn(GERENTE_TROCAS) + ') e o WFM também podem aprovar.';
}
/** Os avisos "Troca aguardando aprovação" vão só para os coordenadores que ainda não aprovaram; o gerente, só quando um deles está de férias/licença ou alguém não tem coordenador. */
function expandirAprovacao_(lista) {
  if (!lista.some(function (n) { return n.dest === 'GESTAO' && n.tipo === 'TROCA_APROVACAO'; })) return lista;
  const trocas = {}; tabela_('Trocas').linhas.forEach(function (l) { trocas[l.troca_id] = l; });
  const rt = responsaveisTime_(), out = [];
  lista.forEach(function (n) {
    const l = n.dest === 'GESTAO' && n.tipo === 'TROCA_APROVACAO' ? trocas[n.ref] : null;
    if (!l) { out.push(n); return; }
    const a = aprovacaoTroca_(l, rt);
    const dests = a.faltam.concat(a.precisaGerente ? [GERENTE_TROCAS] : []).concat(a.ausentes.length ? [SUBSTITUTA_TROCAS] : []).filter(function (e, i, arr) { return arr.indexOf(e) === i && e !== l.solicitante && e !== l.colega; });
    dests.forEach(function (e) { out.push({ dest: e, tipo: n.tipo, titulo: n.titulo, msg: n.msg, ref: n.ref }); });
  });
  return out;
}

/* ---------- (2) presença no painel ---------- */
const PRES_ONLINE_MIN = 5; // online = deu sinal nos últimos 5 minutos e não saiu
/** Marca o último sinal da pessoa (grava no máximo uma vez por minuto).
 *  vis: true = painel visível na tela · false = painel aberto em segundo plano · sem valor = chamada comum ao servidor.
 *  Online = painel visível nos últimos 5 minutos; a contagem recomeça a cada dia. */
function marcarPresenca_(email, saiu, vis) {
  const c = CacheService.getScriptCache(), k = 'pr_' + email, agora = Date.now(), lim = PRES_ONLINE_MIN * 60000;
  let p = null; try { p = JSON.parse(c.get(k) || 'null'); } catch (e) { p = null; }
  if (saiu) { p = p || { ini: agora }; p.ult = agora; p.saiu = agora; c.put(k, JSON.stringify(p), 21600); return; }
  try { acRegistrar_(email, agora); } catch (e) { /* informativo */ }
  const oc = p && !p.saiu && p.oculto ? p.oculto : 0;
  const nova = !p || p.saiu || agora - p.ult > lim || acDia_(p.ini) !== acDia_(agora);
  if (nova) { p = { ini: agora }; if (oc && vis !== true) p.oculto = oc; }
  if (vis === false) { if (!p.oculto) p.oculto = agora; }
  else if (vis === true && p.oculto) { if (agora - p.oculto > lim) p = { ini: agora }; else delete p.oculto; }
  else if (!nova && agora - p.ult < 60000) return;
  p.ult = agora; c.put(k, JSON.stringify(p), 21600);
}
/** Sinal enviado pela tela a cada 2 minutos e quando o painel fica visível ou vai para segundo plano. */
function apiPresenca(token, vis) { const ctx = sessao_(token); if (vis === true || vis === false) { try { marcarPresenca_(ctx.email, false, vis); } catch (e) { /* informativo */ } } limpezaSePreciso_(); return { ok: true }; }

/** Histórico de acessos: quem está online agora e quem entrou hoje (só WFM). */
function apiPresencaPainel(token) {
  const ctx = sessao_(token); exigirGestao_(ctx); // quem está online: toda a gestão
  const agora = Date.now(), hoje = hojeIso_(), rt = responsaveisTime_(), us = {};
  tabela_('Usuarios').linhas.forEach(function (u) { us[u.email] = u; });
  const pes = tabela_('Pessoas').linhas.filter(function (p) { return p.ativo === 'SIM' && us[p.email] && (us[p.email].perfil === 'AGENTE' || us[p.email].perfil === 'GESTAO') && !ehVaga_(p.email); });
  const pr = pes.length ? CacheService.getScriptCache().getAll(pes.map(function (p) { return 'pr_' + p.email; })) : {};
  const lg = {};
  tabela_('Logs').linhas.forEach(function (l) {
    if (String(l.data_hora).slice(0, 10) !== hoje || (l.acao !== 'LOGIN' && l.acao !== 'LOGOUT')) return;
    const em = l.afetado || l.ator, x = lg[em] || (lg[em] = { n: 0, primeiro: '', ultimo: '', saiu: '' });
    if (l.acao === 'LOGIN') { x.n++; if (!x.primeiro || l.data_hora < x.primeiro) x.primeiro = l.data_hora; if (l.data_hora > x.ultimo) x.ultimo = l.data_hora; }
    else if (l.data_hora > x.saiu) x.saiu = l.data_hora;
  });
  const ac = acHoje_(), diaHoje = acDia_(agora), msIso = function (s) { return s ? new Date(String(s).replace(' ', 'T') + (String(s).length <= 19 ? '-03:00' : '')).getTime() : 0; };
  const pessoas = pes.map(function (p) {
    let x = null; try { x = JSON.parse(pr['pr_' + p.email] || 'null'); } catch (e) { x = null; }
    const online = !!(x && !x.saiu && agora - x.ult < PRES_ONLINE_MIN * 60000), h = lg[p.email];
    const oculto = null; // regra anterior: online = painel aberto (sinal nos últimos 5 minutos), mesmo em segundo plano
    const a = ac[p.email], xi = x && acDia_(x.ini) === diaHoje ? x.ini : 0, xu = x && acDia_(x.ult) === diaHoje ? x.ult : 0;
    const ini = [a ? a.i : 0, xi, h && h.primeiro ? msIso(h.primeiro) : 0].filter(Boolean), fim = [a ? a.u : 0, xu, h && h.ultimo ? msIso(h.ultimo) : 0].filter(Boolean);
    const entrouHoje = online || !!oculto || ini.length > 0;
    if (!entrouHoje) return null;
    return { email: p.email, nome: nomeCurto_(p.nome), perfil: us[p.email].perfil, coord: (rt[p.email] || {}).coord || '', online: online, oculto: oculto,
      desde: online ? x.ini : null, ult: x ? x.ult : null, saiu: x && x.saiu ? x.saiu : null,
      primeiroLogin: h ? h.primeiro : '', ultimoLogin: h ? h.ultimo : '', logins: h ? h.n : 0, saiuLog: h ? h.saiu : '',
      entrouHoje: entrouHoje, primeiroHoje: ini.length ? acIso_(Math.min.apply(null, ini)) : '', ultimoHoje: fim.length ? acIso_(Math.max.apply(null, fim)) : '' };
  }).filter(Boolean);
  return { agora: agora, limiteMin: PRES_ONLINE_MIN, pessoas: pessoas };
}

/* ---------- (3) acesso do dia: primeiro e último sinal de cada pessoa no dia (com login ou entrando já conectada) ---------- */
function acDia_(ms) { return Utilities.formatDate(new Date(ms), 'America/Fortaleza', 'yyyyMMdd'); }
function acIso_(ms) { return ms ? Utilities.formatDate(new Date(ms), 'America/Fortaleza', "yyyy-MM-dd'T'HH:mm:ss") : ''; }
/** Grava no máximo a cada 10 minutos por pessoa; limpa os registros de dias anteriores uma vez por dia. */
function acRegistrar_(email, agora) {
  const c = CacheService.getScriptCache(), kc = 'acw_' + email, ult = +(c.get(kc) || 0);
  if (ult && agora - ult < 600000 && acDia_(ult) === acDia_(agora)) return;
  const pr = PropertiesService.getScriptProperties(), dia = acDia_(agora), k = 'ac_' + dia + '|' + email;
  let v = null; try { v = JSON.parse(pr.getProperty(k) || 'null'); } catch (e) { v = null; }
  v = v ? { i: v.i, u: agora } : { i: agora, u: agora };
  pr.setProperty(k, JSON.stringify(v)); c.put(kc, String(agora), 21600);
  // histórico curto de dias com acesso (últimos 31 dias), para "dias com acesso nos últimos 30 dias"
  const kh = 'ah_' + email; let h = null; try { h = JSON.parse(pr.getProperty(kh) || 'null'); } catch (e) { h = null; }
  h = h || { d: [] }; if (h.d[h.d.length - 1] !== dia) { h.d.push(dia); if (h.d.length > 31) h.d = h.d.slice(-31); } h.u = agora; pr.setProperty(kh, JSON.stringify(h));
  if (!c.get('acl_' + dia)) { c.put('acl_' + dia, '1', 21600); try { Object.keys(pr.getProperties()).forEach(function (x) { if (x.indexOf('ac_') === 0 && x.indexOf('ac_' + dia + '|') !== 0) pr.deleteProperty(x); }); } catch (e) { /* limpeza na próxima */ } }
}
/** Acessos de hoje: { email: { i: ms, u: ms } } */
function acHoje_() { const dia = acDia_(Date.now()), pre = 'ac_' + dia + '|', out = {};
  try { const all = PropertiesService.getScriptProperties().getProperties(); Object.keys(all).forEach(function (k) { if (k.indexOf(pre) === 0) { try { out[k.slice(pre.length)] = JSON.parse(all[k]); } catch (e) { /* ignora */ } } }); } catch (e) { /* sem registro */ }
  return out; }
