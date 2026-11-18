/**
 * Escala20.gs — mensagens no Slack, enviadas pelo n8n.
 * O painel só monta a mensagem (texto + blocos do Slack) e grava uma linha na aba "FilaSlack".
 * O n8n lê as linhas PENDENTE, acha a pessoa no Slack pelo e-mail, manda a mensagem direta e marca ENVIADO ou ERRO.
 * Assim o painel não precisa de nenhuma permissão nova e a troca nunca fica esperando o Slack.
 * Liga e desliga na aba Config: slack_ativo = SIM. Tipos enviados (opcional): slack_tipos = TROCA_RECEBIDA,TROCA_ABERTA,...
 */
const FILA_SLACK = 'FilaSlack';
const FILA_SLACK_CAB = ['fila_id', 'criada_em', 'email', 'tipo', 'texto', 'blocos', 'ref', 'status', 'enviado_em', 'slack_ts', 'erro'];
const SLACK_TIPOS = ['TROCA_RECEBIDA', 'TROCA_ABERTA', 'TROCA_APROVACAO', 'TROCA_ACEITA', 'TROCA_RECUSADA', 'TROCA_APROVADA', 'TROCA_REJEITADA', 'TROCA_CANCELADA', 'TROCA_CANCELADA_AUTO', 'TROCA_APROVACAO_PARCIAL', 'TROCA_EXPIRADA', 'TROCA_APROVACAO_ENCERRADA'];

function slackAtivo_() { return String(config_('slack_ativo') || '').trim().toUpperCase() === 'SIM'; }
function slackTipos_() { const v = String(config_('slack_tipos') || '').trim(); return v ? v.split(',').map(function (s) { return s.trim(); }) : SLACK_TIPOS; }
/** A fila fica numa planilha separada (só ela é compartilhada com o n8n). O ID fica na Config: slack_planilha_id. */
function idFilaSlack_() { return String(config_('slack_planilha_id') || '').trim(); }
function abaFilaSlack_() {
  const id = idFilaSlack_(); if (!id) throw new Error('Planilha da fila do Slack não configurada');
  const ss = SpreadsheetApp.openById(id); let sh = ss.getSheetByName(FILA_SLACK);
  if (!sh) { sh = ss.insertSheet(FILA_SLACK); sh.getRange(1, 1, 1, FILA_SLACK_CAB.length).setValues([FILA_SLACK_CAB]); sh.setFrozenRows(1); }
  return sh;
}
/** Cria a planilha separada da fila do Slack (uma vez só) e grava o ID na Config. Não envia nada. */
function criarPlanilhaFilaSlack() {
  const atual = idFilaSlack_(); if (atual) { Logger.log('A planilha da fila já existe: ' + atual); return atual; }
  const ss = SpreadsheetApp.create('Escalas Customer · Fila de mensagens do Slack');
  const sh = ss.getSheets()[0]; sh.setName(FILA_SLACK);
  sh.getRange(1, 1, 1000, FILA_SLACK_CAB.length).setNumberFormat('@'); // tudo como texto: o Google não converte datas
  sh.getRange(1, 1, 1, FILA_SLACK_CAB.length).setValues([FILA_SLACK_CAB]).setFontWeight('bold'); sh.setFrozenRows(1);
  appendLinhas_('Config', [{ chave: 'slack_planilha_id', valor: ss.getId(), descricao: 'Planilha separada só com a fila de mensagens do Slack (lida pelo n8n). Não guarda dados do painel.' }]);
  Logger.log('Planilha da fila do Slack criada: ' + ss.getId()); return ss.getId();
}

/* ---------- textos ---------- */
function diaSem_(iso) { const d = new Date(iso + 'T12:00:00Z'); return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getUTCDay()] + ', ' + iso.slice(8, 10) + '/' + iso.slice(5, 7); }
function pNome_(nomes, e) { return nomeCurto_(nomes[e] || e || '').split(' ')[0]; }
function nNome_(nomes, e) { return nomeCurto_(nomes[e] || e || ''); }
function hTxt_(h) { return h ? h.i + ' às ' + h.f : 'no horário planejado'; }
function frentesSlack_(h) {
  if (!h) return '';
  const nomes = { '0800': '0800', chat: 'Chat', ass: 'Assíncrono', ges: 'Trabalho' };
  const fr = (h.blocos || []).map(function (b) { return (nomes[b[0]] || 'Trabalho') + ' ' + b[1] + '–' + b[2]; });
  if (h.a) fr.push('Almoço ' + h.a);
  return fr.join('  ·  ');
}
function quandoTxt_(ms) { const tz = Session.getScriptTimeZone(), d = new Date(ms); return diaSem_(Utilities.formatDate(d, tz, 'yyyy-MM-dd')) + ' às ' + Utilities.formatDate(d, tz, 'HH:mm'); }
function dataHoraTxt_(iso) { return iso ? diaSem_(String(iso).slice(0, 10)) + ' às ' + String(iso).slice(11, 16) : ''; }
/** Prazo para aceitar: TROCA_PRAZO_H (72) horas antes do turno que começa primeiro. */
function prazoSlack_(itens) {
  const ms = itens.filter(function (x) { return x.h; }).map(function (x) { return inicioMs_(x.data, x.h.i); });
  return ms.length ? quandoTxt_(Math.min.apply(null, ms) - TROCA_PRAZO_H * 3600000) : '';
}
const SB = {
  cab: function (t) { return { type: 'header', text: { type: 'plain_text', text: t, emoji: true } }; },
  txt: function (t) { return { type: 'section', text: { type: 'mrkdwn', text: t } }; },
  campos: function (a) { return { type: 'section', fields: a.map(function (t) { return { type: 'mrkdwn', text: t }; }) }; },
  nota: function (t) { return { type: 'context', elements: [{ type: 'mrkdwn', text: t }] }; },
  div: function () { return { type: 'divider' }; },
  botao: function (t, url) { return { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: t, emoji: true }, url: url }] }; } // o Slack só tem verde, vermelho ou neutro: neutro combina com a identidade
};
function lado_(titulo, linha1, linha2) { return '*' + titulo + '*\n' + linha1 + (linha2 ? '\n_' + linha2 + '_' : ''); }

/** Monta a mensagem do Slack para um aviso do painel (n) sobre a troca (l). Devolve { texto, blocos } ou null. */
function montarSlack_(n, l, nomes, qtdAvisados, rt) {
  const A = l.solicitante, B = l.colega, D = n.dest, ehH = l.data_solicitante === l.data_colega;
  const dF = l.data_solicitante, dT = l.data_colega, url = urlApp_(), pA = pNome_(nomes, A), nA = nNome_(nomes, A);
  const tipoTroca = ehH ? 'horário' : 'dia', datas = ehH ? diaSem_(dF) : diaSem_(dF) + ' ⇄ ' + diaSem_(dT);
  const motivo = l.motivo ? SB.txt('*Motivo de ' + pA + ':* “' + String(l.motivo).slice(0, 300) + '”') : null;
  const bl = [], fim = function (texto, rotBotao) { if (url) bl.push(SB.botao(rotBotao, url)); return { texto: texto, blocos: bl.filter(Boolean) }; };

  if (n.tipo === 'TROCA_APROVACAO_PARCIAL') {
    const ac = aprovacaoTroca_(l, rt), quem = Object.keys(ac.ap).map(function (e) { return pNome_(nomes, e); }).join(' e ');
    const faltam = ac.faltam.map(function (e) { return pNome_(nomes, e); }).concat(ac.semCoord.length ? [pNome_(nomes, GERENTE_TROCAS)] : []);
    bl.push(SB.cab('👍  Troca aprovada por ' + quem));
    bl.push(SB.txt('*' + quem + '* aprovou a troca de ' + tipoTroca + ' (' + datas + '). Falta a aprovação de *' + faltam.join(' e ') + '*.'));
    bl.push(SB.nota('A escala só muda quando todas as aprovações chegarem, até ' + quandoTxt_(prazoGestaoMs_(l)) + ' (24 horas antes do primeiro turno).'));
    return fim(quem + ' aprovou a troca de ' + tipoTroca + ' (' + datas + '). Falta a aprovação de ' + faltam.join(' e ') + '.', 'Acompanhar no painel');
  }
  if (n.tipo === 'TROCA_APROVACAO_ENCERRADA') {
    const nB = nNome_(nomes, B), aprovada = l.status === 'APROVADA', dec = l.decisao_por, nDec = nNome_(nomes, dec), papel = papelDecisorTroca_(dec);
    bl.push(SB.cab((aprovada ? '✅  Troca aprovada por ' : '🚫  Troca recusada por ') + nDec));
    bl.push(SB.txt('*' + nA + '* e *' + nB + '* combinaram uma troca de ' + tipoTroca + '. A troca que aguardava sua aprovação foi ' + (aprovada ? 'aprovada' : 'recusada') + ' por *' + nDec + '*' + papel + (l.decisao_em ? ', ' + dataHoraTxt_(l.decisao_em) : '') + '.'));
    if (!ehH) {
      const hA = horarioDia_(A, dF), hB = horarioDia_(B, dT);
      bl.push(SB.campos([lado_(nA, 'Folga em ' + diaSem_(dF) + '\nTrabalha em ' + diaSem_(dT) + '  ·  *' + hTxt_(hB) + '*', ''),
                         lado_(nB, 'Trabalha em ' + diaSem_(dF) + '  ·  *' + hTxt_(hA) + '*\nFolga em ' + diaSem_(dT), '')]));
    } else {
      const hA = horarioDia_(A, dF), hB = horarioDia_(B, dF);
      bl.push(SB.txt('*Dia:* ' + diaSem_(dF)));
      bl.push(SB.campos([lado_(nA, hTxt_(hA) + '  →  *' + hTxt_(hB) + '*', ''), lado_(nB, hTxt_(hB) + '  →  *' + hTxt_(hA) + '*', '')]));
    }
    if (!aprovada && l.obs_decisao) bl.push(SB.txt('*Motivo:* “' + String(l.obs_decisao).slice(0, 300) + '”'));
    bl.push(SB.div());
    bl.push(SB.nota('O pedido foi encerrado e não precisa mais da sua aprovação. ' + (aprovada ? 'A troca já está na escala publicada.' : 'A escala não mudou.') + ' Nenhuma ação é necessária.'));
    const r = fim('Troca ' + (aprovada ? 'aprovada' : 'recusada') + ' por ' + nDec + ': ' + nA + ' e ' + nB + ' (' + datas + '). O pedido que aguardava sua aprovação foi encerrado.', 'Ver no painel');
    r.assunto = 'Troca de escala já decidida: ' + (aprovada ? 'aprovada' : 'recusada') + ' por ' + nDec;
    return r;
  }
  if (n.tipo === 'TROCA_EXPIRADA') {
    bl.push(SB.cab('⌛  Troca expirada'));
    bl.push(SB.txt('A troca de ' + tipoTroca + ' (' + datas + ') expirou porque ' + String(l.resultado_validacao || '').replace(/^Expirou: /, '') + '.'));
    bl.push(SB.nota('Sua escala continua como estava. Se ainda quiser trocar, faça um novo pedido respeitando os prazos.'));
    return fim('Troca expirada: ' + tipoTroca + ' (' + datas + ').', 'Ver minha escala');
  }
  if (n.tipo === 'TROCA_CANCELADA_AUTO') {
    bl.push(SB.cab('⚠️  Troca cancelada automaticamente'));
    bl.push(SB.txt('A troca de ' + tipoTroca + ' ' + (D === A ? (B ? 'com *' + nNome_(nomes, B) + '*' : 'que você pediu em aberto') : 'pedida por *' + nA + '*') + ' (' + datas + ') foi cancelada porque *outra troca para o mesmo dia já foi aprovada*.'));
    bl.push(SB.nota('Sua escala segue a troca que foi aprovada. Confira seus dias e horários no painel.'));
    return fim('Troca cancelada automaticamente: outra troca para o mesmo dia (' + datas + ') foi aprovada.', 'Ver minha escala');
  }
  if (n.tipo === 'TROCA_RECEBIDA' || n.tipo === 'TROCA_ABERTA') {
    const aberta = n.tipo === 'TROCA_ABERTA';
    if (!ehH) {
      const hA = horarioDia_(A, dF), hD = horarioDia_(D, dT);
      bl.push(SB.cab('🔁  Pedido de troca de dia'));
      bl.push(SB.txt(aberta ? '*' + nA + '* pediu uma troca de dia e você pode cobrir.' : '*' + nA + '* quer trocar de dia com você.'));
      bl.push(SB.campos([lado_('Você passa a trabalhar', diaSem_(dF) + '  ·  *' + hTxt_(hA) + '*', frentesSlack_(hA)),
                         lado_('Você passa a folgar', diaSem_(dT), 'Seu turno das ' + hTxt_(hD) + ' fica com ' + pA)]));
      bl.push(SB.nota('Mesmo horário que o seu: você cobre o turno de ' + pA + ' nesse dia, com as atuações que já estavam planejadas para esse turno. A semana continua com 5 dias de trabalho e 2 de folga.'));
      const prazo = prazoSlack_([{ data: dF, h: hA }, { data: dT, h: hD }]);
      if (motivo) bl.push(motivo);
      bl.push(SB.div());
      if (aberta) bl.push(SB.txt('O pedido foi para *' + qtdAvisados + ' pessoa' + (qtdAvisados > 1 ? 's' : '') + '*. Quem aceitar primeiro fica com a troca.'));
      bl.push(SB.nota('⏰ Responda até *' + prazo + '* (' + TROCA_PRAZO_H + ' horas antes do primeiro turno da troca). Depois do seu aceite, a coordenação aprova até ' + TROCA_PRAZO_GESTAO_H + ' horas antes.'));
      return fim(nA + (aberta ? ' pediu uma troca de dia que você pode cobrir: ' : ' quer trocar de dia com você: ') + 'você trabalha em ' + diaSem_(dF) + ' (' + hTxt_(hA) + ') e folga em ' + diaSem_(dT) + '.', 'Ver e responder no painel');
    }
    const hA = horarioDia_(A, dF), hD = horarioDia_(D, dF);
    bl.push(SB.cab('🕒  Pedido de troca de horário'));
    bl.push(SB.txt(aberta ? '*' + nA + '* quer trabalhar no seu horário em *' + diaSem_(dF) + '*.' : '*' + nA + '* quer trocar de horário com você em *' + diaSem_(dF) + '*.'));
    bl.push(SB.campos([lado_('Seu horário planejado', hTxt_(hD), frentesSlack_(hD)), lado_('Seu novo horário', '*' + hTxt_(hA) + '*', frentesSlack_(hA))]));
    bl.push(SB.nota(pA + ' assume o seu horário e as suas atuações. Seus dias de trabalho e folga não mudam.'));
    if (motivo) bl.push(motivo);
    bl.push(SB.div());
    if (aberta) bl.push(SB.txt('O pedido foi para *' + qtdAvisados + ' pessoa' + (qtdAvisados > 1 ? 's' : '') + '* com o seu horário. Quem aceitar primeiro fica com a troca.'));
    bl.push(SB.nota('⏰ Responda até *' + prazoSlack_([{ data: dF, h: hA }, { data: dF, h: hD }]) + '* (' + TROCA_PRAZO_H + ' horas antes do primeiro turno). Depois do seu aceite, a coordenação aprova até ' + TROCA_PRAZO_GESTAO_H + ' horas antes.'));
    return fim(nA + (aberta ? ' quer trabalhar no seu horário em ' : ' quer trocar de horário com você em ') + diaSem_(dF) + ': você passaria a trabalhar das ' + hTxt_(hA) + '.', 'Ver e responder no painel');
  }

  if (n.tipo === 'TROCA_APROVACAO') {
    const pB = pNome_(nomes, B), nB = nNome_(nomes, B);
    const coords = coordenadoresTroca_(l, rt), times = [A, B].filter(function (p) { return rt[p] && rt[p].resp === D; }).map(function (p) { return pNome_(nomes, p); });
    bl.push(SB.cab('📋  Troca aguardando sua aprovação'));
    bl.push(SB.txt('*' + nA + '* e *' + nB + '* combinaram uma troca de ' + tipoTroca + '. Falta a sua aprovação.'));
    if (!ehH) {
      const hA = horarioDia_(A, dF), hB = horarioDia_(B, dT);
      bl.push(SB.campos([lado_(nA, 'Folga em ' + diaSem_(dF) + '\nTrabalha em ' + diaSem_(dT) + '  ·  *' + hTxt_(hB) + '*', frentesSlack_(hB)),
                         lado_(nB, 'Trabalha em ' + diaSem_(dF) + '  ·  *' + hTxt_(hA) + '*\nFolga em ' + diaSem_(dT), frentesSlack_(hA))]));
      bl.push(SB.nota('Os dois têm o mesmo horário: cada um cobre o turno do outro, com as atuações que estavam planejadas para esse dia.'));
    } else {
      const hA = horarioDia_(A, dF), hB = horarioDia_(B, dF);
      bl.push(SB.txt('*Dia:* ' + diaSem_(dF)));
      bl.push(SB.campos([lado_(nA, hTxt_(hA) + '  →  *' + hTxt_(hB) + '*', frentesSlack_(hB)), lado_(nB, hTxt_(hB) + '  →  *' + hTxt_(hA) + '*', frentesSlack_(hA))]));
      bl.push(SB.nota('Os dias de trabalho e as folgas dos dois não mudam. Só o horário e as atuações.'));
    }
    if (motivo) bl.push(motivo);
    bl.push(SB.div());
    bl.push(SB.nota('Pedido em ' + dataHoraTxt_(l.criada_em) + (l.aceite_em ? '  ·  aceito por ' + pB + ' em ' + dataHoraTxt_(l.aceite_em) : '') + '\n' + notaAprovacaoSlack_(l, rt, D, nomes, times)));
    return fim('Troca de ' + tipoTroca + ' aguardando sua aprovação: ' + nA + ' e ' + nB + ' (' + datas + ').', 'Analisar no painel');
  }

  const pB = pNome_(nomes, B), nB = nNome_(nomes, B), outro = D === A ? nB : nA;
  if (n.tipo === 'TROCA_ACEITA') {
    bl.push(SB.cab('🤝  Sua troca foi aceita'));
    bl.push(SB.txt('*' + nB + '* aceitou sua troca de ' + tipoTroca + ' (' + datas + '). Agora falta a aprovação da coordenação.'));
    if (!ehH) { const hB = horarioDia_(B, dT); bl.push(SB.campos([lado_('Você vai folgar', diaSem_(dF), ''), lado_('Você vai trabalhar', diaSem_(dT) + '  ·  *' + hTxt_(hB) + '*', frentesSlack_(hB))])); }
    else { const hB = horarioDia_(B, dF); bl.push(SB.campos([lado_('Seu novo horário em ' + diaSem_(dF), '*' + hTxt_(hB) + '*', frentesSlack_(hB))])); }
    bl.push(SB.nota('A escala só muda depois da aprovação. Você recebe outra mensagem quando a coordenação decidir.'));
    return fim(nB + ' aceitou sua troca de ' + tipoTroca + ' (' + datas + '). Falta a aprovação da coordenação.', 'Acompanhar no painel');
  }
  if (n.tipo === 'TROCA_RECUSADA') {
    bl.push(SB.cab('↩️  Troca recusada'));
    bl.push(SB.txt('*' + nB + '* recusou sua troca de ' + tipoTroca + ' (' + datas + ').' + (l.obs_resposta ? '\n*Motivo:* “' + String(l.obs_resposta).slice(0, 300) + '”' : '')));
    bl.push(SB.nota('Sua escala continua como estava. Se quiser, peça a troca para outra pessoa no painel.'));
    return fim(nB + ' recusou sua troca de ' + tipoTroca + ' (' + datas + ').', 'Abrir o painel');
  }
  if (n.tipo === 'TROCA_APROVADA' || n.tipo === 'TROCA_REJEITADA') {
    const ap = n.tipo === 'TROCA_APROVADA', quem = l.decisao_por ? nNome_(nomes, l.decisao_por) : 'A coordenação';
    bl.push(SB.cab(ap ? '✅  Troca aprovada' : '❌  Troca não aprovada'));
    bl.push(SB.txt((ap ? 'A troca de ' + tipoTroca + ' com *' + outro + '* (' + datas + ') foi aprovada por *' + quem + '* e já está na sua escala.'
                       : '*' + quem + '* não aprovou a troca de ' + tipoTroca + ' com *' + outro + '* (' + datas + ').') + (l.obs_decisao ? '\n*Observação:* “' + String(l.obs_decisao).slice(0, 300) + '”' : '')));
    if (ap) {
      if (!ehH) {
        const trab = D === A ? dT : dF, folga = D === A ? dF : dT, h = horarioDia_(D, trab);
        bl.push(SB.campos([lado_('Você trabalha', diaSem_(trab) + '  ·  *' + hTxt_(h) + '*', frentesSlack_(h)), lado_('Você folga', diaSem_(folga), '')]));
      } else { const h = horarioDia_(D, dF); bl.push(SB.campos([lado_('Seu horário em ' + diaSem_(dF), '*' + hTxt_(h) + '*', frentesSlack_(h))])); }
    } else bl.push(SB.nota('Sua escala continua como estava.'));
    return fim((ap ? 'Troca aprovada' : 'Troca não aprovada') + ': ' + tipoTroca + ' com ' + outro + ' (' + datas + ').', 'Ver minha escala');
  }
  if (n.tipo === 'TROCA_CANCELADA') {
    bl.push(SB.cab('🚫  Pedido de troca cancelado'));
    bl.push(SB.txt('*' + nA + '* cancelou o pedido de troca de ' + tipoTroca + ' (' + datas + ').'));
    bl.push(SB.nota('Nada muda na sua escala.'));
    return fim(nA + ' cancelou o pedido de troca de ' + tipoTroca + ' (' + datas + ').', 'Abrir o painel');
  }
  return null;
}

/* ---------- e-mail com o mesmo conteúdo da mensagem do Slack ---------- */
function escHtml_(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function mrkHtml_(t) { return escHtml_(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|[\s(])_([^_\n]+)_/g, '$1<i>$2</i>').replace(/\n/g, '<br>'); }
function assuntoDe_(m) { if (m && m.assunto) return m.assunto; const h = (m.blocos || []).filter(function (b) { return b.type === 'header'; })[0]; return h ? h.text.text.replace(/^[^A-Za-zÀ-ú]+/, '').trim() : 'Troca de escala'; }
/** Modelo único dos e-mails do painel: faixa Empresa, cartão branco, botão rosa e rodapé. Tabelas para ficar igual no Gmail e no Outlook. */
function emailLayout_(corpo, rodape, avisoTeste) {
  const teste = avisoTeste ? '<tr><td style="padding:16px 28px 0"><div style="padding:10px 14px;border-radius:10px;background:#FFF4D6;color:#6b4e00;font-size:13px"><b>Teste</b> · este e-mail iria para ' + escHtml_(avisoTeste) + '</div></td></tr>' : '';
  return '<div style="margin:0;padding:24px 12px;background:#F4F1F7">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#262626;border-collapse:separate">' +
    '<tr><td style="background:#4F3F91;background-image:linear-gradient(90deg,#4F3F91,#D80073);padding:18px 28px"><div style="font-size:19px;font-weight:bold;color:#ffffff;letter-spacing:.2px">Painel\1Escalas\3</div><div style="font-size:12px;color:#F1E7FF;margin-top:2px">Painel de Escalas do Customer</div></td></tr>' +
    teste + '<tr><td style="padding:24px 28px 10px;font-size:14.5px;line-height:1.55">' + corpo + '</td></tr>' +
    '<tr><td style="padding:14px 28px 22px;border-top:1px solid #F0EDF3;font-size:11.5px;color:#9A93A3;line-height:1.5">' + (rodape || 'Painel de Escalas · Central de Atendimento.') + '</td></tr></table></div>';
}
function emailBotao_(texto, url) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto 8px"><tr><td style="background:#D80073;border-radius:12px"><a href="' + escHtml_(url) + '" style="display:inline-block;padding:13px 30px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px">' + escHtml_(texto) + '</a></td></tr></table>';
}
function emailDeBlocos_(blocos, avisoTeste) {
  let h = '';
  (blocos || []).forEach(function (b) {
    if (b.type === 'header') h += '<h1 style="font-size:21px;line-height:1.3;margin:0 0 14px;color:#1E1A24">' + escHtml_(b.text.text) + '</h1>';
    else if (b.type === 'section' && b.text) h += '<p style="margin:0 0 14px">' + mrkHtml_(b.text.text) + '</p>';
    else if (b.type === 'section' && b.fields) h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border-collapse:separate;border-spacing:0"><tr>' + b.fields.map(function (f, i) { return '<td style="vertical-align:top;width:50%;padding:0' + (i ? ' 0 0 6px' : ' 6px 0 0') + '"><div style="background:#F7F4FA;border:1px solid #EEE8F3;border-radius:12px;padding:12px 14px;font-size:13.5px;line-height:1.5">' + mrkHtml_(f.text) + '</div></td>'; }).join('') + '</tr></table>';
    else if (b.type === 'context') { const t = b.elements[0].text; h += /^⏰/.test(t) ? '<div style="margin:0 0 14px;padding:12px 14px;border-radius:12px;background:#FFF7E0;border-left:4px solid #F2B705;font-size:13.5px;color:#5c4400">' + mrkHtml_(t) + '</div>' : '<p style="margin:0 0 14px;font-size:13px;color:#6D6676">' + mrkHtml_(t) + '</p>'; }
    else if (b.type === 'divider') h += '<div style="height:1px;background:#F0EDF3;margin:16px 0"></div>';
    else if (b.type === 'actions') { const e = b.elements[0]; h += emailBotao_(e.text.text, e.url); }
  });
  return emailLayout_(h, 'Você recebeu este e-mail porque participa desta troca de escala. Responda pelo painel; este endereço não recebe respostas.', avisoTeste);
}
function contasTeste_() { const v = String(config_('contas_teste') || ''); return v.split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean); }
var EMAIL_FEITO_ = {}; // quem já recebeu e-mail nesta execução (evita e-mail repetido)

/**
 * Chamado depois de cada aviso do painel. Para cada aviso de troca:
 *  - e-mail com o mesmo conteúdo detalhado (sempre, a não ser que email_trocas = NAO na Config);
 *  - linha na fila do Slack (se slack_ativo = SIM).
 * Trocas que envolvem as contas de teste (contas_teste) só avisam o testador, por e-mail e Slack.
 * Com slack_teste_para preenchido, todas as mensagens do Slack vão só para essa pessoa.
 */
function filaSlack_(lista) {
  const slackOn = slackAtivo_() && !!idFilaSlack_(), emailOn = String(config_('email_trocas') || 'SIM').trim().toUpperCase() !== 'NAO';
  if (!slackOn && !emailOn) return;
  const tipos = slackTipos_(), trocas = {}, nomes = {}, qtd = {}, linhas = [];
  tabela_('Trocas').linhas.forEach(function (l) { trocas[l.troca_id] = l; });
  tabela_('Pessoas').linhas.forEach(function (p) { nomes[p.email] = p.nome; });
  lista.forEach(function (n) { const k = n.tipo + '|' + n.ref; qtd[k] = (qtd[k] || 0) + 1; });
  const rt = responsaveisTime_(), testeSlack = String(config_('slack_teste_para') || '').trim().toLowerCase();
  const contas = contasTeste_(), testador = testeSlack || 'admin@exemplo.com';
  let cota = 0; if (emailOn) { try { cota = MailApp.getRemainingDailyQuota(); } catch (e) { cota = 0; } }
  lista.forEach(function (n) {
    if (!n.dest || n.dest === 'GESTAO' || tipos.indexOf(n.tipo) < 0 || ehVaga_(n.dest)) return;
    const l = trocas[n.ref]; if (!l) return;
    let m = null; try { m = montarSlack_(n, l, nomes, qtd[n.tipo + '|' + n.ref], rt); } catch (e) { m = null; }
    if (!m) return;
    const deTeste = contas.indexOf(String(l.solicitante).toLowerCase()) >= 0 || contas.indexOf(String(l.colega).toLowerCase()) >= 0;
    const quem = nNome_(nomes, n.dest) + ' (' + n.dest + ')';
    if (emailOn && !EMAIL_FEITO_[n.dest + '|' + n.ref]) {
      EMAIL_FEITO_[n.dest] = true; EMAIL_FEITO_[n.dest + '|' + n.ref] = true;
      if (cota > 10) {
        try { MailApp.sendEmail({ to: deTeste ? testador : n.dest, name: CFG.APP_NOME, subject: (deTeste ? '[TESTE] ' : '') + assuntoDe_(m), htmlBody: emailDeBlocos_(m.blocos, deTeste ? quem : ''), body: m.texto }); cota--; } catch (e) { /* sem e-mail, o aviso continua no painel */ }
      }
    }
    if (slackOn) {
      const para = (testeSlack || deTeste) ? testador : n.dest;
      const bl = para !== n.dest ? [SB.nota('🧪 *Teste* · esta mensagem iria para ' + quem)].concat(m.blocos) : m.blocos;
      linhas.push({ fila_id: novoId_('sk'), criada_em: agoraIso_(), email: para, tipo: n.tipo, texto: m.texto, blocos: JSON.stringify(bl), ref: n.ref, status: 'PENDENTE' });
    }
  });
  if (linhas.length) {
    const sh = abaFilaSlack_();
    linhas.forEach(function (o) { sh.appendRow(FILA_SLACK_CAB.map(function (c) { const x = o[c] === undefined ? '' : String(o[c]); return x === '' ? '' : "'" + x; })); }); // atômico e sempre como texto
  }
}

/** Liga o teste do Slack: mensagens vão só para o testador. Também deixa as contas de teste isoladas. */
function configurarTesteSlack() {
  const quer = { slack_ativo: ['SIM', 'Mensagens de troca no Slack (SIM liga, NAO desliga)'],
    slack_teste_para: ['admin@exemplo.com', 'Enquanto preenchido, todas as mensagens do Slack vão só para este e-mail (teste)'],
    contas_teste: ['', 'Trocas com estas contas avisam só o testador (e-mail e Slack)'] };
  const t = tabela_('Config');
  Object.keys(quer).forEach(function (k) {
    const l = t.linhas.filter(function (x) { return x.chave === k; })[0];
    if (l) atualizarLinha_(t, l, { valor: quer[k][0] }); else appendLinhas_('Config', [{ chave: k, valor: quer[k][0], descricao: quer[k][1] }]);
  });
  Logger.log('Teste do Slack ligado: mensagens só para ' + quer.slack_teste_para[0]); return 'ok';
}

/** Mostra o ID da planilha do painel (usado no workflow do n8n). Só leitura. */
function idPlanilhaPainel() { const id = db_().getId(); Logger.log('ID da planilha do painel: ' + id); return id; }

/** Rodapé do aviso de aprovação: por que a pessoa recebeu e quem precisa aprovar. */
function notaAprovacaoSlack_(l, rt, D, nomes, times) {
  const a = aprovacaoTroca_(l, rt), pn = function (e) { return pNome_(nomes, e); };
  let por;
  if (ehSubstitutaTrocas_(D) && a.nec.indexOf(D) < 0) return 'Você recebeu porque ' + a.ausentes.map(pn).join(' e ') + ' está de férias ou licença. Como você substitui a coordenação nesse período, pode aprovar ou recusar no lugar. Prazo: até ' + quandoTxt_(prazoGestaoMs_(l)) + ' (24 horas antes do primeiro turno).';
  if (ehGerenteTrocas_(D)) por = 'Você recebeu porque ' + (a.ausentes.length ? a.ausentes.map(pn).join(' e ') + ' está de férias ou licença' : a.semCoord.map(pn).join(' e ') + ' não tem coordenador com acesso ao painel') + '. Como gerente, a sua aprovação vale sozinha.';
  else por = 'Você recebeu porque coordena o time de ' + times.join(' e ') + '.';
  const precisa = a.nec.length > 1 ? 'Esta troca precisa da aprovação dos dois coordenadores: ' + a.nec.map(pn).join(' e ') + '.' : 'Basta a sua aprovação.';
  return por + ' ' + (ehGerenteTrocas_(D) ? '' : precisa) + ' Prazo: até ' + quandoTxt_(prazoGestaoMs_(l)) + ' (24 horas antes do primeiro turno).';
}
