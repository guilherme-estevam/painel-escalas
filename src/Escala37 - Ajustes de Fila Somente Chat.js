/* Ajustes de fila na Twilio (19/11/2026)
 * Pessoas que atuam somente no chat ficam fora dos ajustes de fila na Twilio.
 * A escala delas continua como chat e 0800; nada vai para o Histórico e ninguém é avisado. */
var AF_SOMENTE_CHAT = ['agente01@exemplo.com', 'agente02@exemplo.com', 'agente03@exemplo.com'];
var AF_LISTA_COMPLETA_ = (typeof ajustesFilaDoDia_ === 'function') ? ajustesFilaDoDia_ : null;
if (AF_LISTA_COMPLETA_) {
  ajustesFilaDoDia_ = function (data) {
    return (AF_LISTA_COMPLETA_.apply(this, arguments) || []).filter(function (it) { return AF_SOMENTE_CHAT.indexOf(String((it && it.email) || '').toLowerCase()) < 0; });
  };
}
/** Conferência (só leitura): quantos ajustes existem hoje e se as pessoas de somente chat ficaram de fora. */
function afSomenteChatConferir() {
  const d = hojeIso_(), out = ['regra ativa: ' + !!AF_LISTA_COMPLETA_];
  if (AF_LISTA_COMPLETA_) {
    const antes = AF_LISTA_COMPLETA_(d), depois = ajustesFilaDoDia_(d), delas = function (l) { return l.filter(function (x) { return AF_SOMENTE_CHAT.indexOf(String(x.email || '').toLowerCase()) >= 0; }).length; };
    out.push(d + ': ' + antes.length + ' ajustes antes, ' + depois.length + ' depois · das 3 pessoas antes: ' + delas(antes) + ' · depois: ' + delas(depois));
  }
  Logger.log('AF|' + out.join(' #### '));
}

/* Visão Operacional (19/11/2026): as mesmas pessoas contam só como chat; o 0800 do dia aparece como chat.
 * Vale só para a Visão Operacional (sessão de quem está vendo). O cartão de presença do agente ("interno") e a escala não mudam. */
var AF_VISAO_ORIGINAL_ = (typeof apiVisaoDia === 'function') ? apiVisaoDia : null;
function afSoChatBlocos_(bl) {
  const out = [];
  (bl || []).forEach(function (b) {
    const t = b[0] === '0800' ? 'chat' : b[0], u = out[out.length - 1];
    if (u && u[0] === 'chat' && t === 'chat' && u[2] === b[1]) u[2] = b[2]; else out.push([t, b[1], b[2]].concat(b.slice(3)));
  });
  return out;
}
if (AF_VISAO_ORIGINAL_) {
  apiVisaoDia = function (token, data, rascunho) {
    const r = AF_VISAO_ORIGINAL_.apply(this, arguments);
    if (token === 'interno' || !r || !r.itens) return r;
    r.itens.forEach(function (o) { if (AF_SOMENTE_CHAT.indexOf(String(o.email || '').toLowerCase()) >= 0 && Array.isArray(o.blocos)) o.blocos = afSoChatBlocos_(o.blocos); });
    return r;
  };
}
