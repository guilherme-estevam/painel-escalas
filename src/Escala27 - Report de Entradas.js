/* =====================================================================
 * Report de Atrasos na Entrada (13/11/2026)
 * Grava na aba ReportEntradas, uma vez por dia, a lista do dia anterior:
 * cada agente escalado com entrada às 08:00, 09:00, 10:00 ou 11:00 (0800, Chat
 * ou Assíncrono), com coordenação, atuação na entrada e situação no Controle
 * de Logados. O n8n lê essa aba às 9h15, cruza com a Twilio e manda no Slack.
 * Mesmas regras do painel: escala publicada (com trocas), férias e licenças,
 * e a situação do Controle de Logados (presMesAtual_).
 * ===================================================================== */
const ABA_REP_ENT = 'ReportEntradas';
const REP_HORAS = ['08:00', '09:00', '10:00', '11:00'];

function repEntAba_() {
  const ss = db_(); let sh = ss.getSheetByName(ABA_REP_ENT);
  if (!sh) {
    sh = ss.insertSheet(ABA_REP_ENT); sh.getRange('A:I').setNumberFormat('@');
    sh.getRange(1, 1, 1, 9).setValues([['data', 'email', 'nome', 'coordenacao', 'entrada', 'atuacao', 'situacao', 'cargo', 'gerado_em']]); sh.setFrozenRows(1);
  }
  return sh;
}

/** Lista de um dia (não grava). */
function repEntLista_(data) {
  const dia = +data.slice(8), mes = data.slice(0, 7), hoje = hojeIso_();
  const teste = contasTeste_(), pes = pessoasEscala_().filter(function (p) { return p.perfil === 'AGENTE' && teste.indexOf(p.email) < 0 && !ehVaga_(p.email); });
  const esc = {}; tabela_('Escalas').linhas.forEach(function (l) { if (l.mes === mes) esc[l.email] = l; });
  const sit = {}; presMesAtual_(mes, hoje, agoraMinFort_(), presInicio_()).forEach(function (x) { if (x.data === data) sit[x.email] = x.st; });
  const AREA = { '0800': '0800', chat: 'Chat', ass: 'Assíncrono' }, out = [];
  pes.forEach(function (p) {
    const l = esc[p.email]; if (!l || String(l.dias_publicados || '').charAt(dia - 1) !== 'T') return;
    let atu = null; try { atu = JSON.parse(l.atuacao_publicada || '{}'); } catch (e) { return; }
    const x = atu && atu.d ? atu.d[String(dia)] : null; if (!x || REP_HORAS.indexOf(x[0]) < 0) return;
    let bl = []; try { bl = x[3] || blocosPadrao_(x, atu.m) || []; } catch (e) { bl = []; }
    const b0 = bl.filter(function (b) { return b[1] <= x[0] && b[2] > x[0]; })[0], a = b0 ? AREA[b0[0]] : '';
    if (!a) return; // só 0800, Chat e Assíncrono
    out.push([data, p.email, p.nome, p.coord || 'Sem Coordenação', x[0], a, sit[p.email] || 'SEM_REGISTRO', p.cargo || '', agoraIso_()]);
  });
  return out;
}

/** Grava (ou regrava) um dia na aba ReportEntradas. */
function repEntGravar_(data) {
  const sh = repEntAba_(), linhas = repEntLista_(data);
  if (sh.getLastRow() > 1) {
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues();
    for (let i = v.length - 1; i >= 0; i--) if (String(v[i][0]).slice(0, 10) === data) sh.deleteRow(i + 2);
  }
  if (linhas.length) sh.getRange(sh.getLastRow() + 1, 1, linhas.length, linhas[0].length).setValues(linhas);
  return linhas.length;
}

/** Chamado pelo movimento do painel: depois das 08:30, gera o dia anterior uma única vez. */
function repEntTalvez_() {
  if (agoraMinFort_() < 8 * 60 + 30) return;
  const ontem = (function () { const d = new Date(hojeIso_() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
  const pr = PropertiesService.getScriptProperties(); if (pr.getProperty('rep_ent_feito') === ontem) return;
  const lock = LockService.getScriptLock(); if (!lock.tryLock(100)) return;
  try { if (pr.getProperty('rep_ent_feito') === ontem) return; repEntGravar_(ontem); pr.setProperty('rep_ent_feito', ontem); }
  finally { lock.releaseLock(); }
}

