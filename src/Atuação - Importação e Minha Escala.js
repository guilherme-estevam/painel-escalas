/**
 * Atuacao.gs — importação da planilha de escala (dias + horários por dia),
 * calendário de atuação e Minha escala.
 */


function migrarV4() { garantirColunas_('Escalas', ['atuacao']); return 'ok'; }

const GRUPOS_ESCALA = { 'hibrido': { nome: 'Híbrido', m: [200, 280, 0] }, 'assincrono': { nome: 'Assíncrono', m: [0, 0, 480] } };
function grupoDe_(g) { return GRUPOS_ESCALA[normalizar_(g)] || { nome: String(g || ''), m: [0, 0, 0] }; }

/** Lê o CSV da planilha (separador ; ou ,): data;dia;pessoa;grupo;status;inicio;almoco;fim;min_0800;min_digital;min_assincrono */
function lerCsvEscala_(texto) {
  texto = String(texto || '').replace(/^\uFEFF/, '');
  const sep = texto.split('\n')[0].indexOf(';') >= 0 ? ';' : ',';
  const linhas = Utilities.parseCsv(texto, sep);
  const cab = linhas[0].map(normalizar_);
  const col = function (n) { return cab.indexOf(n); };
  const C = { data: col('data'), pessoa: col('pessoa'), grupo: col('grupo'), inicio: col('inicio'), almoco: col('almoco'), fim: col('fim'), m0800: col('min_0800'), dig: col('min_digital'), ass: col('min_assincrono') };
  const faltam = Object.keys(C).filter(function (k) { return C[k] < 0; });
  if (faltam.length) throw new Error('Colunas não encontradas na planilha: ' + faltam.join(', ') + '.');
  const por = {}; let mes = '';
  for (let i = 1; i < linhas.length; i++) {
    const r = linhas[i]; const nome = String(r[C.pessoa] || '').trim(); if (!nome) continue;
    const dm = String(r[C.data] || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (!dm) continue;
    const m = dm[3] + '-' + ('0' + dm[2]).slice(-2);
    if (!mes) mes = m; else if (m !== mes) throw new Error('A planilha tem mais de um mês (' + mes + ' e ' + m + '). Envie um mês por vez.');
    const reg = por[nome] || (por[nome] = { nome: nome, grupo: String(r[C.grupo] || '').trim(), dias: {} });
    const ini = String(r[C.inicio] || '').trim();
    reg.dias[+dm[1]] = normalizar_(ini) === 'folga' ? 'F' : [hora_(ini), hora_(r[C.almoco]), hora_(r[C.fim])];
  }
  if (!mes) throw new Error('Nenhuma linha válida encontrada.');
  return { mes: mes, registros: Object.keys(por).map(function (k) { return por[k]; }) };
}
/** Formato compacto: email|H ou A|tokens separados por vírgula (F ou HHMMHHMMHHMM, com *n para repetir). */
function lerCompacto_(texto, mes, diaIni) {
  const regs = [];
  String(texto).split('\n').forEach(function (ln) {
    ln = ln.trim(); if (!ln) return;
    const p = ln.split('|'); const dias = {}; let d = diaIni;
    p[2].split(',').forEach(function (tk) {
      const m = tk.split('*'); const n = m[1] ? +m[1] : 1;
      for (let k = 0; k < n; k++, d++) dias[d] = m[0] === 'F' ? 'F' : [m[0].slice(0, 2) + ':' + m[0].slice(2, 4), m[0].slice(4, 6) + ':' + m[0].slice(6, 8), m[0].slice(8, 10) + ':' + m[0].slice(10, 12)];
    });
    regs.push({ email: p[0] + '@exemplo.com', grupo: p[1] === 'A' ? 'Assíncrono' : 'Híbrido', dias: dias });
  });
  return { mes: mes, registros: regs };
}

/** Completa dias ausentes só quando existe uma única forma de fechar a semana em 5x2 (domingo ausente = folga). */
function completarSemanas_(arr, mes) {
  const p = mes.split('-'); const a = +p[0], m = +p[1], n = arr.length; const completados = [];
  const w = new Date(Date.UTC(a, m - 1, 1)); w.setUTCDate(1 - w.getUTCDay());
  for (; w.getTime() <= Date.UTC(a, m - 1, n); w.setUTCDate(w.getUTCDate() + 7)) {
    const idx = [];
    for (let k = 0; k < 7; k++) { const x = new Date(w.getTime()); x.setUTCDate(x.getUTCDate() + k); idx.push(x.getUTCMonth() + 1 === m ? x.getUTCDate() - 1 : -1); }
    if (idx.indexOf(-1) >= 0) continue;
    let falt = idx.filter(function (i) { return arr[i] === '.'; }); if (!falt.length) continue;
    const t = idx.filter(function (i) { return arr[i] === 'T'; }).length; let precisa = 5 - t;
    const marca = function (i, v) { arr[i] = v; completados.push({ dia: i + 1, valor: v }); };
    if (precisa !== 0 && precisa !== falt.length && falt.indexOf(idx[0]) >= 0) { marca(idx[0], 'F'); falt = falt.filter(function (i) { return i !== idx[0]; }); }
    if (precisa === 0) falt.forEach(function (i) { marca(i, 'F'); });
    else if (precisa === falt.length) falt.forEach(function (i) { marca(i, 'T'); });
  }
  return completados;
}

function prepararImportacao_(dados) {
  const mes = mesValido_(dados.mes); const n = diasNoMes_(mes);
  const pessoas = {}, porNome = {}; pessoasEscala_().forEach(function (p) { pessoas[p.email] = p; porNome[normalizar_(p.nome)] = p; });
  const fx = faixaMes_(mes); const af = {}; afastamentosEntre_(fx.ini, fx.fim).forEach(function (x) { (af[x.email] = af[x.email] || []).push(x); });
  const viz = {}; tabela_('Escalas').linhas.forEach(function (l) { viz[l.mes + '|' + l.email] = l; });
  const itens = [], semCadastro = [];
  dados.registros.forEach(function (reg) {
    const p = reg.email ? pessoas[reg.email] : porNome[normalizar_(reg.nome)];
    if (!p) { semCadastro.push(reg.nome || reg.email); return; }
    const arr = []; for (let i = 0; i < n; i++) arr.push('.');
    const g = grupoDe_(reg.grupo); const atu = { g: g.nome, m: g.m, d: {} };
    Object.keys(reg.dias).forEach(function (k) { const v = reg.dias[k], i = +k - 1; if (i < 0 || i >= n) return; if (v === 'F') arr[i] = 'F'; else { arr[i] = 'T'; atu.d[k] = v; } });
    const completados = completarSemanas_(arr, mes);
    const dias = arr.join('');
    const ant = viz[mesDelta_(mes, -1) + '|' + p.email], prox = viz[mesDelta_(mes, 1) + '|' + p.email];
    const v = validarEscala_({ mes: mes, dias: dias, ant: ant ? ant.dias : '', prox: prox ? prox.dias : '', afast: af[p.email] || [], segSex: p.segSex });
    itens.push({ email: p.email, nome: p.nome, coord: p.coord, dias: dias, atuacao: atu, completados: completados, ok: v.ok, erros: v.erros.map(function (x) { return x.msg; }), existe: !!viz[mes + '|' + p.email] });
  });
  return { mes: mes, itens: itens, semCadastro: semCadastro };
}
function resumoImportacao_(prep) {
  return { mes: prep.mes, encontradas: prep.itens.length, validas: prep.itens.filter(function (i) { return i.ok; }).length,
    comProblema: prep.itens.filter(function (i) { return !i.ok; }).map(function (i) { return { nome: i.nome, erros: i.erros }; }),
    semCadastro: prep.semCadastro, completadas: prep.itens.filter(function (i) { return i.completados.length; }).length,
    jaExistem: prep.itens.filter(function (i) { return i.existe; }).length };
}
function aplicarImportacaoBase_(prep, ator, publicar, motivo) {
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    const t = tabela_('Escalas'); const porChave = {}; t.linhas.forEach(function (l) { porChave[l.mes + '|' + l.email] = l; });
    const agora = agoraIso_(); const op = novoId_('op'); const nomeAtor = nomeCurto_((tabela_('Pessoas').linhas.filter(function (x) { return x.email === ator; })[0] || { nome: ator }).nome);
    const novos = [], logs = [], notifs = []; let publicadas = 0, rascunhos = 0;
    prep.itens.forEach(function (it) {
      const pub = publicar && it.ok; const l = porChave[prep.mes + '|' + it.email];
      const mot = motivo + (it.completados.length ? ' · dias completados pela regra 5x2: ' + it.completados.map(function (c) { return ('0' + c.dia).slice(-2) + (c.valor === 'T' ? ' trabalho' : ' folga'); }).join(', ') : '');
      if (l) {
        const antes = { dias: l.dias, dias_publicados: l.dias_publicados, status: l.status };
        l.dias = it.dias; l.atuacao = JSON.stringify(it.atuacao); l.versao = String(Number(l.versao) + 1); l.atualizado_em = agora; l.atualizado_por = ator;
        if (pub) { l.dias_publicados = it.dias; l.atuacao_publicada = l.atuacao; l.status = 'PUBLICADA'; l.publicada_em = agora; l.publicada_por = ator; }
        else l.status = l.dias_publicados ? (l.dias === l.dias_publicados ? 'PUBLICADA' : 'ALTERADA') : 'RASCUNHO';
        logs.push({ ator: ator, acao: 'ESCALA_IMPORTADA', tipo: 'Escala', registro: l.escala_id, afetado: it.email, antes: antes, depois: { dias: l.dias, status: l.status }, motivo: mot, op: op });
      } else {
        const nova = { escala_id: novoId_('esc'), mes: prep.mes, email: it.email, dias: it.dias, dias_publicados: pub ? it.dias : '', status: pub ? 'PUBLICADA' : 'RASCUNHO', versao: '1', publicada_em: pub ? agora : '', publicada_por: pub ? ator : '', atualizado_em: agora, atualizado_por: ator, atuacao: JSON.stringify(it.atuacao), atuacao_publicada: pub ? JSON.stringify(it.atuacao) : '' };
        novos.push(nova);
        logs.push({ ator: ator, acao: 'ESCALA_IMPORTADA', tipo: 'Escala', registro: nova.escala_id, afetado: it.email, depois: { dias: it.dias, status: nova.status }, motivo: mot, op: op });
      }
      if (pub) { publicadas++; notifs.push({ dest: it.email, tipo: 'ESCALA_PUBLICADA', titulo: 'Sua escala foi publicada', msg: 'Sua escala de ' + mesBr_(prep.mes) + ' foi publicada por ' + nomeAtor + ', com os horários de cada dia.', ref: prep.mes }); }
      else rascunhos++;
    });
    if (t.linhas.length) { const vals = t.linhas.map(function (l) { return t.cab.map(function (c) { return l[c] === undefined ? '' : String(l[c]); }); }); t.sh.getRange(2, 1, vals.length, t.cab.length).setValues(celTexto_(vals)); }
    appendLinhas_('Escalas', novos); logLote_(logs); notificar_(notifs);
    const r = resumoImportacao_(prep); r.publicadas = publicadas; r.rascunhos = rascunhos; r.op = op;
    return r;
  } finally { lock.releaseLock(); }
}

/* ---------------------------------------------------------------------
 * API — importação pelo painel (gestão)
 * --------------------------------------------------------------------- */
function apiImportarEscalaPrevia(token, csv) {
  const ctx = sessao_(token); exigirGestao_(ctx); exigirPlanejamento_(ctx);
  try { return { ok: true, resumo: resumoImportacao_(prepararImportacao_(lerCsvEscala_(csv))) }; } catch (e) { return { ok: false, msg: e.message }; }
}
function apiImportarEscalaAplicar(token, csv, publicar) {
  const ctx = sessao_(token); exigirGestao_(ctx); exigirPlanejamento_(ctx);
  try { migrarV4(); return { ok: true, resumo: aplicarImportacao_(prepararImportacao_(lerCsvEscala_(csv)), ctx.email, !!publicar, 'Importação de planilha pelo painel') }; } catch (e) { return { ok: false, msg: e.message }; }
}

/* ---------------------------------------------------------------------
 * API — Minha escala e atuação
 * --------------------------------------------------------------------- */
function atuacaoDe_(l) { try { return l && l.atuacao ? JSON.parse(l.atuacao) : null; } catch (e) { return null; } }
function apiMinhaEscala(token, mes) {
  const ctx = sessao_(token);
  const r = apiMinhaJornada(token, mes);
  const l = tabela_('Escalas').linhas.filter(function (x) { return x.mes === mes && x.email === ctx.email; })[0];
  r.atuacao = l && l.dias_publicados ? atuacaoDe_({ atuacao: l.atuacao_publicada || l.atuacao }) : null;
  r.podeTrocar = true;
  return r;
}
function apiAtuacaoDe(token, mes, email) {
  const ctx = sessao_(token); exigirGestao_(ctx);
  const l = tabela_('Escalas').linhas.filter(function (x) { return x.mes === mes && x.email === normalizar_(email); })[0];
  return { atuacao: atuacaoDe_(l) };
}

/* ---------------------------------------------------------------------
 * TESTES (editor)
 * --------------------------------------------------------------------- */
function testesAtuacao() {
  const r = []; const ok = function (n, c, d) { r.push((c ? 'OK   ' : 'FALHA') + ' | ' + n + (d ? ' | ' + d : '')); };
  let a = '..TTTTTF'.split('').concat(Array(22).fill('.')); let c = completarSemanas_(a, '2026-11');
  ok('Semana com 5 trabalhos: 01 e 02 viram folga', a[0] === 'F' && a[1] === 'F', JSON.stringify(c));
  a = '..TTTFTF'.split('').concat(Array(22).fill('.')); c = completarSemanas_(a, '2026-11');
  ok('Semana com 4 trabalhos: domingo folga, segunda trabalho', a[0] === 'F' && a[1] === 'T', JSON.stringify(c));
  const d = lerCompacto_('fulano|H|102013201920*2,F', '2026-11', 3);
  ok('Leitura compacta', d.registros[0].dias[3][0] === '10:20' && d.registros[0].dias[4][2] === '19:20' && d.registros[0].dias[5] === 'F');
  const csv = lerCsvEscala_('\uFEFFcenario;data;dia;pessoa;grupo;status;inicio;almoco;fim;min_0800;min_digital;min_assincrono;min_total\nX;3/11/2026;Ter;Fulano;Híbrido;Ativo;10:20;13:20;19:20;200;280;0;480\nX;4/11/2026;Qua;Fulano;Híbrido;Ativo;folga;;;0;0;0;0');
  ok('Leitura do CSV com ;', csv.mes === '2026-11' && csv.registros[0].dias[4] === 'F' && csv.registros[0].dias[3][1] === '13:20');
  ok('Grupo Híbrido = 0800 200 + digital 280', JSON.stringify(grupoDe_('Híbrido').m) === '[200,280,0]');
  Logger.log(r.join('\n')); return r;
}
