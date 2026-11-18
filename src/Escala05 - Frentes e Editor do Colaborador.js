/**
 * Escala5.gs — frentes por horário (0800, chat, assíncrono), editor do colaborador,
 * ajuste de horário em lote e fotos (mesma base do planilha de fotos, vindas do Slack).
 */


/* ---------------------------------------------------------------------
 * DIVISÃO PADRÃO DO DIA EM FRENTES — função pura, também enviada ao navegador
 * x = [entrada, almoço, saída, blocos?]; m = minutos por frente [0800, chat, assíncrono]
 * Retorna blocos [[frente, início, fim], ...] fora do almoço.
 * --------------------------------------------------------------------- */
function blocosPadrao_(x, m) {
  function mi(h) { var p = String(h || '').split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function hm(n) { return ('0' + Math.floor(n / 60)).slice(-2) + ':' + ('0' + (n % 60)).slice(-2); }
  if (x && x[3] && x[3].length) return x[3];
  var I = mi(x[0]), F = mi(x[2]), A = x[1] ? mi(x[1]) : 0;
  var segs = A && A > I && A + 60 <= F ? [[I, A], [A + 60, F]] : [[I, F]];
  m = m || [0, 0, 0];
  if (!m[0] && !m[1] && !m[2]) return segs.map(function (s) { return ['ges', hm(s[0]), hm(s[1])]; });
  if (m[2] && !m[0] && !m[1]) return segs.map(function (s) { return ['ass', hm(s[0]), hm(s[1])]; });
  var q = m[0] || 0, out = [];
  var idx = (segs[0][1] - segs[0][0] >= q) ? 0 : (segs[1] && segs[1][1] - segs[1][0] >= q ? 1 : 0);
  segs.forEach(function (s, k) {
    if (k === idx && q > 0) {
      var fim0800 = Math.min(s[0] + q, s[1]);
      out.push(['0800', hm(s[0]), hm(fim0800)]);
      if (fim0800 < s[1]) out.push(['chat', hm(fim0800), hm(s[1])]);
    } else out.push(['chat', hm(s[0]), hm(s[1])]);
  });
  return out;
}

/* ---------------------------------------------------------------------
 * VALIDAÇÃO DOS HORÁRIOS DO COLABORADOR
 * --------------------------------------------------------------------- */
const FRENTES_VALIDAS = ['0800', 'chat', 'ass', 'ges'];
function statusDe_(l) { return l.dias_publicados ? ((l.dias === l.dias_publicados && (l.atuacao || '') === (l.atuacao_publicada || '')) ? 'PUBLICADA' : 'ALTERADA') : 'RASCUNHO'; }
function validarAtuacao_(atu, dias) {
  if (!atu || !atu.d) return { ok: true, atu: null };
  const mi = function (h) { const p = String(h).split(':'); return (+p[0]) * 60 + (+p[1]); };
  const ok = function (h) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || '')); };
  const out = { g: String(atu.g || ''), m: Array.isArray(atu.m) ? atu.m.map(Number) : [0, 0, 0], d: {} }; const erros = [];
  Object.keys(atu.d).forEach(function (k) {
    const dia = +k; if (!(dia >= 1 && dia <= dias.length) || dias.charAt(dia - 1) !== 'T') return; // só dias de trabalho
    const x = atu.d[k]; const rot = ('0' + dia).slice(-2);
    if (!ok(x[0]) || !ok(x[2]) || (x[1] && !ok(x[1]))) { erros.push('Dia ' + rot + ': use horários no formato 24 h.'); return; }
    const I = mi(x[0]), F = mi(x[2]), A = x[1] ? mi(x[1]) : 0;
    if (F <= I) { erros.push('Dia ' + rot + ': a saída precisa ser depois da entrada.'); return; }
    if (x[1] && (A <= I || A + 60 > F)) { erros.push('Dia ' + rot + ': o almoço precisa ficar dentro do horário de trabalho.'); return; }
    const ent = [x[0], x[1] || '', x[2]];
    if (x[3] && x[3].length) {
      const bl = x[3].map(function (b) { return [String(b[0]), String(b[1]), String(b[2])]; }).sort(function (a, b) { return mi(a[1]) - mi(b[1]); });
      let fimAnt = -1;
      for (let i = 0; i < bl.length; i++) {
        const b = bl[i];
        if (FRENTES_VALIDAS.indexOf(b[0]) < 0 || !ok(b[1]) || !ok(b[2]) || mi(b[2]) <= mi(b[1])) { erros.push('Dia ' + rot + ': confira o bloco ' + (i + 1) + '.'); return; }
        if (mi(b[1]) < I || mi(b[2]) > F) { erros.push('Dia ' + rot + ': o bloco ' + b[1] + '–' + b[2] + ' está fora do horário de trabalho.'); return; }
        if (A && mi(b[1]) < A + 60 && mi(b[2]) > A) { erros.push('Dia ' + rot + ': o bloco ' + b[1] + '–' + b[2] + ' cruza o almoço.'); return; }
        if (mi(b[1]) < fimAnt) { erros.push('Dia ' + rot + ': há blocos sobrepostos.'); return; }
        fimAnt = mi(b[2]);
      }
      ent.push(bl);
    }
    out.d[String(dia)] = ent;
  });
  if (erros.length) return { ok: false, msg: erros.slice(0, 3).join(' ') };
  return { ok: true, atu: Object.keys(out.d).length ? out : null };
}

/* ---------------------------------------------------------------------
 * API — EDITOR DO COLABORADOR
 * --------------------------------------------------------------------- */
function apiColaborador(token, mes, email) {
  const ctx = sessao_(token); exigirGestao_(ctx); exigirPlanejamento_(ctx); mesValido_(mes); email = normalizar_(email);
  const r = apiMes(token, mes, email);
  const l = tabela_('Escalas').linhas.filter(function (x) { return x.mes === mes && x.email === email; })[0];
  r.atuacao = l ? atuacaoDe_(l) : null;
  r.temPublicada = !!(l && l.dias_publicados);
  r.coordenacoes = tabela_('Coordenacoes').linhas.filter(function (c) { return c.ativo === 'SIM'; }).map(function (c) { return { id: c.coord_id, nome: c.nome_exibicao }; });
  return r;
}
function apiSalvarColaborador(token, mes, email, dias, atu, versao, motivo, publicar) {
  const ctx = sessao_(token); exigirGestao_(ctx); exigirPlanejamento_(ctx); mesValido_(mes); email = normalizar_(email);
  const p = pessoasEscala_().filter(function (x) { return x.email === email; })[0];
  if (!p) return { ok: false, msg: 'Colaborador não encontrado.' };
  const n = diasNoMes_(mes); dias = String(dias || '');
  if (dias.length !== n || /[^TF.]/.test(dias)) return { ok: false, msg: 'Formato de escala inválido.' };
  if (p.segSex) for (let d = 1; d <= n; d++) { const wd = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5) - 1, d)).getUTCDay(); if ((wd === 0 || wd === 6) && dias.charAt(d - 1) === 'T') return { ok: false, msg: p.nome + ' trabalha só de segunda a sexta. Fim de semana não pode ter trabalho.' }; }
  const va = validarAtuacao_(atu, dias); if (!va.ok) return { ok: false, msg: va.msg };
  const novoAtu = va.atu ? JSON.stringify(va.atu) : '';
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  let id;
  try {
    const t = tabela_('Escalas'); const l = t.linhas.filter(function (x) { return x.mes === mes && x.email === email; })[0]; const agora = agoraIso_();
    if (l) {
      if (String(versao) !== String(l.versao)) return { ok: false, msg: 'A escala de ' + p.nome + ' foi alterada por ' + l.atualizado_por + ' em ' + String(l.atualizado_em).replace('T', ' ') + '. Feche e abra de novo.' };
      if (l.dias !== dias || (l.atuacao || '') !== novoAtu) {
        const antes = { dias: l.dias, horarios: l.atuacao ? Object.keys((atuacaoDe_(l) || {}).d || {}).length + ' dia(s) com horário' : 'horário padrão' };
        l.dias = dias; l.atuacao = novoAtu; l.status = statusDe_(l); l.versao = String(Number(l.versao) + 1); l.atualizado_em = agora; l.atualizado_por = ctx.email;
        atualizarLinha_(t, l, {});
        log_(ctx.email, 'ESCALA_ALTERADA', 'Escala', l.escala_id, email, antes, { dias: dias, horarios: va.atu ? Object.keys(va.atu.d).length + ' dia(s) com horário' : 'horário padrão', status: l.status }, motivo || 'Editor do colaborador');
      }
      id = l.escala_id;
    } else {
      id = novoId_('esc');
      appendLinhas_('Escalas', [{ escala_id: id, mes: mes, email: email, dias: dias, dias_publicados: '', status: 'RASCUNHO', versao: '1', atualizado_em: agora, atualizado_por: ctx.email, atuacao: novoAtu, atuacao_publicada: '' }]);
      log_(ctx.email, 'ESCALA_CRIADA', 'Escala', id, email, null, { dias: dias, status: 'RASCUNHO' }, motivo || 'Editor do colaborador');
    }
  } finally { lock.releaseLock(); }
  let pub = null; if (publicar) pub = apiPublicar(token, mes, [email]);
  const fim = tabela_('Escalas').linhas.filter(function (x) { return x.escala_id === id; })[0];
  return { ok: true, versao: fim.versao, status: fim.status, dias: fim.dias, publicacao: pub };
}
/** Quem tem horário por dia no mês (para a grade). */
function apiPlanoInfo(token, mes) {
  const ctx = sessao_(token); exigirGestao_(ctx); exigirPlanejamento_(ctx); mesValido_(mes);
  const out = {}; tabela_('Escalas').linhas.forEach(function (l) { if (l.mes !== mes || !l.atuacao) return; const a = atuacaoDe_(l); if (a && a.d && Object.keys(a.d).length) out[l.email] = a.g || 'Por dia'; });
  return { mes: mes, comHorario: out };
}

/* ---------------------------------------------------------------------
 * API — AJUSTE DE HORÁRIO EM LOTE (planilha: dia a dia; demais: horário do headcount)
 * --------------------------------------------------------------------- */
function apiAjustarHorarios(token, mes, emails, modo, ent, alm, sai, horas, motivo) {
  const ctx = sessao_(token); exigirGestao_(ctx); exigirPlanejamento_(ctx); mesValido_(mes);
  if (!Array.isArray(emails) || !emails.length) return { ok: false, msg: 'Selecione pelo menos um colaborador.' };
  const ok = function (h) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || '')); };
  const mi = function (h) { const p = String(h).split(':'); return (+p[0]) * 60 + (+p[1]); };
  const hm = function (n) { return ('0' + Math.floor(n / 60)).slice(-2) + ':' + ('0' + (n % 60)).slice(-2); };
  if (modo === 'DEFINIR' && (!ok(ent) || !ok(sai) || mi(sai) <= mi(ent) || (alm && (!ok(alm) || mi(alm) <= mi(ent) || mi(alm) + 60 > mi(sai))))) return { ok: false, msg: 'Confira entrada, almoço e saída (formato 24 h, almoço dentro do horário).' };
  horas = Number(horas); if (modo === 'ESTENDER' && (!(horas >= -4 && horas <= 4) || !horas)) return { ok: false, msg: 'Informe de -4 a 4 horas.' };
  const alvo = {}; emails.forEach(function (e) { alvo[normalizar_(e)] = true; });
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  const semPlanilha = [], recusados = []; let comPlanilha = 0;
  try {
    const t = tabela_('Escalas'); const logs = []; const agora = agoraIso_(); const op = novoId_('op');
    const nomes = {}; pessoasEscala_().forEach(function (p) { nomes[p.email] = p.nome; });
    Object.keys(alvo).forEach(function (email) {
      const l = t.linhas.filter(function (x) { return x.mes === mes && x.email === email; })[0];
      const atu = l ? atuacaoDe_(l) : null;
      if (!atu || !atu.d || !Object.keys(atu.d).length) { semPlanilha.push(email); return; }
      if (modo === 'HEADCOUNT') { recusados.push((nomes[email] || email) + ' (segue os horários da planilha)'); return; }
      let falhou = false;
      Object.keys(atu.d).forEach(function (k) {
        const x = atu.d[k];
        if (modo === 'DEFINIR') { atu.d[k] = [ent, alm || '', sai]; return; }
        const nf = mi(x[2]) + Math.round(horas * 60);
        if (nf <= mi(x[0]) + 60 || nf > 23 * 60 + 59 || (x[1] && nf < mi(x[1]) + 60)) { falhou = true; return; }
        const velho = x[2]; x[2] = hm(nf);
        if (x[3] && x[3].length) {
          x[3] = x[3].filter(function (b) { return mi(b[1]) < nf; }).map(function (b) { return [b[0], b[1], mi(b[2]) > nf || b[2] === velho ? x[2] : b[2]]; });
        }
      });
      if (falhou) { recusados.push((nomes[email] || email) + ' (passaria do limite do dia)'); return; }
      const antes = l.atuacao; l.atuacao = JSON.stringify(atu); l.status = statusDe_(l); l.versao = String(Number(l.versao) + 1); l.atualizado_em = agora; l.atualizado_por = ctx.email; comPlanilha++;
      logs.push({ ator: ctx.email, acao: 'HORARIO_ALTERADO', tipo: 'Escala', registro: l.escala_id, afetado: email, antes: { horarios: 'por dia (anterior)' }, depois: { modo: modo, entrada: ent, almoco: alm, saida: sai, horas: horas }, motivo: motivo, op: op });
      void antes;
    });
    if (comPlanilha) { const vals = t.linhas.map(function (l) { return t.cab.map(function (c) { return l[c] === undefined ? '' : String(l[c]); }); }); t.sh.getRange(2, 1, vals.length, t.cab.length).setValues(celTexto_(vals)); }
    logLote_(logs);
  } finally { lock.releaseLock(); }
  let r2 = { alterados: 0, recusados: [] };
  if (semPlanilha.length) { r2 = apiAlterarHorarios(token, semPlanilha, modo, ent, sai, horas, motivo); if (!r2.ok) return r2; }
  return { ok: true, comPlanilha: comPlanilha, semPlanilha: r2.alterados, recusados: recusados.concat(r2.recusados || []) };
}

/* ---------------------------------------------------------------------
 * FOTOS — mesma base do planilha de fotos (fotos do Slack pelo e-mail)
 * --------------------------------------------------------------------- */
const PLANILHA_FOTOS_ID = 'ID_DA_PLANILHA_DE_FOTOS';
function fotosSlack_(forcar) {
  const cache = CacheService.getScriptCache();
  if (!forcar) { const c = cache.get('fotos_v1'); if (c) { try { return JSON.parse(c); } catch (e) { /* refaz */ } } }
  const out = {}; let fonte = '';
  /* 11/11/2026: primeiro a aba fotos_slack do próprio Portal (atualizada pelo n8n HUB - Controle de Escalas); o planilha de fotos fica só como reserva */
  try { const sh0 = db_().getSheetByName('fotos_slack'); if (sh0 && sh0.getLastRow() > 1) { sh0.getRange(2, 1, sh0.getLastRow() - 1, 2).getValues().forEach(function (r) { const e = normalizar_(r[0]), u = String(r[1] || '').trim(); if (e && /^https:\/\//.test(u)) out[e] = u; }); if (Object.keys(out).length) fonte = 'fotos_slack (Portal)'; } } catch (e) { /* segue para a planilha de fotos */ }
  try {
    const ss = SpreadsheetApp.openById(PLANILHA_FOTOS_ID);
    ss.getSheets().forEach(function (sh) {
      if (fonte) return;
      const lc = Math.min(sh.getLastColumn(), 40), lr = sh.getLastRow(); if (!lc || lr < 2) return;
      const cab = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (x) { return normalizar_(x); });
      const ie = cab.findIndex(function (c) { return c === 'email' || c === 'e-mail' || /^email/.test(c); });
      const iff = cab.findIndex(function (c) { return /foto|photo|avatar|imagem|image/.test(c); });
      if (ie < 0 || iff < 0) return;
      sh.getRange(2, 1, Math.min(lr - 1, 5000), lc).getValues().forEach(function (r) { const e = normalizar_(r[ie]), u = String(r[iff] || '').trim(); if (e && /^https:\/\//.test(u)) out[e] = u; });
      if (Object.keys(out).length) fonte = sh.getName();
    });
  } catch (e) { fonte = 'erro: ' + e.message; }
  try { cache.put('fotos_v1', JSON.stringify(out), 21600); } catch (e) { /* cache cheio */ }
  if (forcar) Logger.log('Fotos encontradas: ' + Object.keys(out).length + ' (aba: ' + (fonte || 'nenhuma') + ')');
  return out;
}
function apiFotos(token) { sessao_(token); return fotosSlack_(false); }
