/**
 * Painel de Controle de Escalas — Central de Atendimento
 * Back-end (Apps Script). Banco: Google Sheets (ID em Script Properties: DB_ID).
 */

const CFG = {
  APP_NOME: 'Escalas Customer · WFM',
  PASTA_ID: 'ID_DA_PASTA_NO_DRIVE',
  CSV_INICIAL_ID: 'ID_DO_CSV_INICIAL',
  SESSAO_HORAS: 12,
  SESSAO_LEMBRAR_DIAS: 30,
  LINK_MINUTOS: 30,
  HASH_ITER: 1500,
  LOGIN_MAX_FALHAS: 5,
  LOGIN_BLOQUEIO_MIN: 15,
  LINK_MAX_POR_HORA: 3,
  MES_INICIAL: '2026-11',
  STATUS_ATIVOS: ['ativo', 'ferias', 'licenca']
};

/* ---------- Configuração inicial de acessos (aplicada só na carga inicial) ---------- */
const ACESSO_INICIAL = {
  gestao: {
    'Gerente executiva': ['gerente.executiva'],
    'Gerente': ['gerente.um', 'gerente.dois'],
    'Coordenador': ['coord.alfa', 'coord.beta', 'coord.gama'],
    'Analista': ['analista.um', 'analista.dois']
  },
  agenteTemporario: ['conta.teste1', 'conta.teste2'],
  excluidos: [],
  pendentes: [],
  seg_a_sex: ['gerente.um', 'gerente.dois']
};

const COORDENACOES_INICIAIS = [
  ['c_alfa', 'Alfa', 'coord.alfa@exemplo.com', 'Alfa'],
  ['c_beta', 'Beta', 'coord.beta@exemplo.com', 'Beta'],
  ['c_gama', 'Gama', 'coord.gama@exemplo.com', 'Gama'],
  ['c_wfm', 'WFM', 'gerente.um@exemplo.com', 'WFM|IA & Automação']
];

/* ---------- Esquema do banco ---------- */
const SCHEMA = {
  Config: ['chave', 'valor', 'descricao'],
  Pessoas: ['email', 'nome', 'cargo_headcount', 'squad', 'rotulo_coord_headcount', 'coord_id_manual', 'entrada_headcount', 'saida_headcount', 'entrada_planejada', 'saida_planejada', 'admissao', 'status_headcount', 'ativo', 'regra_seg_sex', 'atualizado_em'],
  Coordenacoes: ['coord_id', 'nome_exibicao', 'email_responsavel', 'rotulos_headcount', 'ativo'],
  Usuarios: ['email', 'perfil', 'papel_gestao', 'observacao', 'alterado_em', 'alterado_por'],
  Credenciais: ['email', 'hash', 'salt', 'iter', 'definida_em'],
  Sessoes: ['sessao_id', 'token_hash', 'email', 'criada_em', 'expira_em', 'lembrar', 'revogada_em', 'ultimo_uso'],
  TokensSenha: ['token_id', 'token_hash', 'email', 'criado_em', 'expira_em', 'usado_em'],
  Escalas: ['escala_id', 'mes', 'email', 'dias', 'dias_publicados', 'status', 'versao', 'publicada_em', 'publicada_por', 'atualizado_em', 'atualizado_por'],
  Afastamentos: ['afast_id', 'email', 'tipo', 'inicio', 'fim', 'observacao', 'ativo', 'criado_em', 'criado_por', 'alterado_em', 'alterado_por'],
  Feriados: ['feriado_id', 'data', 'nome', 'categoria', 'ativo', 'criado_em', 'criado_por', 'alterado_em', 'alterado_por'],
  Trocas: ['troca_id', 'solicitante', 'colega', 'data_solicitante', 'data_colega', 'status', 'motivo', 'criada_em', 'aceite_em', 'decisao_por', 'decisao_em', 'resultado_validacao', 'efetivada_em'],
  Notificacoes: ['notif_id', 'destinatario', 'tipo', 'titulo', 'mensagem', 'referencia', 'criada_em', 'lida_em'],
  Logs: ['log_id', 'data_hora', 'ator', 'acao', 'tipo_registro', 'registro', 'afetado', 'antes', 'depois', 'motivo', 'operacao_id', 'resultado']
};

/* =====================================================================
 *  INSTALAÇÃO
 * ===================================================================== */
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PEPPER')) props.setProperty('PEPPER', Utilities.getUuid() + Utilities.getUuid());
  let ss;
  if (props.getProperty('DB_ID')) {
    ss = SpreadsheetApp.openById(props.getProperty('DB_ID'));
  } else {
    ss = SpreadsheetApp.create('Escalas Customer — Banco de dados');
    props.setProperty('DB_ID', ss.getId());
  }
  Object.keys(SCHEMA).forEach(function (nome) {
    let sh = ss.getSheetByName(nome);
    if (!sh) sh = ss.insertSheet(nome);
    const cab = SCHEMA[nome];
    const atual = sh.getRange(1, 1, 1, cab.length).getValues()[0];
    if (atual.join('') === '') {
      sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      sh.getRange('A:Z').setNumberFormat('@');
    }
  });
  const padrao = ss.getSheetByName('Sheet1') || ss.getSheetByName('Página1');
  if (padrao && ss.getSheets().length > 1) ss.deleteSheet(padrao);

  if (tabela_('Coordenacoes').linhas.length === 0) {
    appendLinhas_('Coordenacoes', COORDENACOES_INICIAIS.map(function (c) { return { coord_id: c[0], nome_exibicao: c[1], email_responsavel: c[2], rotulos_headcount: c[3], ativo: 'SIM' }; }));
  }
  if (tabela_('Config').linhas.length === 0) {
    appendLinhas_('Config', [
      { chave: 'mes_inicial', valor: CFG.MES_INICIAL, descricao: 'Primeiro mês operacional das escalas' },
      { chave: 'seg_a_sex', valor: ACESSO_INICIAL.seg_a_sex.map(function (e) { return e + '@exemplo.com'; }).join(','), descricao: 'Regra C: trabalham só de segunda a sexta' }
    ]);
  }
  return 'Banco pronto: ' + ss.getUrl();
}


/* =====================================================================
 *  BANCO (helpers)
 * ===================================================================== */
var DB_ABERTO_ = null, MEMO_ = {};
const MEMO_ABAS_ = ['Pessoas', 'Usuarios', 'Coordenacoes', 'Config', 'Feriados', 'Credenciais'];
function db_() {
  if (DB_ABERTO_) return DB_ABERTO_;
  const id = PropertiesService.getScriptProperties().getProperty('DB_ID');
  if (!id) throw new Error('Banco não configurado. Rode setup().');
  DB_ABERTO_ = SpreadsheetApp.openById(id);
  return DB_ABERTO_;
}
function tabela_(nome) {
  if (MEMO_[nome]) return MEMO_[nome];
  const sh = db_().getSheetByName(nome);
  const v = (typeof tbLerCache_ === 'function') ? tbLerCache_(nome, sh) : sh.getDataRange().getValues();
  const cab = v[0];
  const linhas = [];
  for (let i = 1; i < v.length; i++) {
    if (v[i].join('') === '') continue;
    const o = { _row: i + 1 };
    cab.forEach(function (c, j) { o[c] = v[i][j] === null ? '' : String(v[i][j]); });
    linhas.push(o);
  }
  const t = { sh: sh, cab: cab, linhas: linhas };
  if (MEMO_ABAS_.indexOf(nome) >= 0 || (typeof MEMO_TODAS_ !== 'undefined' && MEMO_TODAS_)) MEMO_[nome] = t;
  return t;
}
function appendLinhas_(nome, objs) {
  if (!objs.length) return;
  // lê só o cabeçalho (não a aba inteira)
  const memo = MEMO_[nome], sh = memo ? memo.sh : db_().getSheetByName(nome);
  const cab = memo ? memo.cab : sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const vals = objs.map(function (o) { return cab.map(function (c) { return o[c] === undefined ? '' : String(o[c]); }); });
  // appendRow é atômico (duas pessoas nunca gravam na mesma linha) e o apóstrofo na frente força TEXTO:
  // o Google não converte datas, horários nem números (testado na planilha real: 2026-11-07, 09:00 e 0123 ficam como texto)
  vals.forEach(function (v) { sh.appendRow(v.map(function (x) { return x === '' ? '' : "'" + x; })); });
  delete MEMO_[nome];
  if (typeof abaMudou_ === 'function') abaMudou_(nome);
}
/** Toda gravação de dados passa por aqui: o apóstrofo força TEXTO e o Google não converte datas, horários nem números. */
function celTexto_(vals) { return vals.map(function (r) { return r.map(function (x) { const s = x === undefined || x === null ? '' : String(x); return s === '' ? '' : "'" + s; }); }); }
function atualizarLinha_(t, linha, mudancas) {
  Object.keys(mudancas).forEach(function (k) { linha[k] = String(mudancas[k]); });
  const vals = t.cab.map(function (c) { return linha[c] === undefined ? '' : linha[c]; });
  t.sh.getRange(linha._row, 1, 1, t.cab.length).setValues(celTexto_([vals]));
  if (typeof abaMudou_ === 'function') abaMudou_(t.sh.getName());
}
function agoraIso_() { return Utilities.formatDate(new Date(), 'America/Fortaleza', "yyyy-MM-dd'T'HH:mm:ss"); }
function novoId_(p) { return p + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16); }

function log_(ator, acao, tipo, registro, afetado, antes, depois, motivo, opId, resultado) {
  appendLinhas_('Logs', [{
    log_id: novoId_('log'), data_hora: agoraIso_(), ator: ator || 'sistema', acao: acao, tipo_registro: tipo,
    registro: registro || '', afetado: afetado || '',
    antes: antes ? JSON.stringify(antes) : '', depois: depois ? JSON.stringify(depois) : '',
    motivo: motivo || '', operacao_id: opId || '', resultado: resultado || 'OK'
  }]);
}

/* =====================================================================
 *  HEADCOUNT
 * ===================================================================== */
function normalizar_(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function dataBr_(s) { // aceita DD/MM/AAAA ou AAAA-MM-DD -> AAAA-MM-DD
  s = String(s || '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}
function hora_(s) { const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})/); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : ''; }

function importarHeadcountCsv_(csvTexto, ator, inicial) {
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    const linhas = Utilities.parseCsv(csvTexto);
    const cab = linhas[0].map(normalizar_);
    const col = function (nomes) { for (const n of nomes) { const i = cab.indexOf(n); if (i >= 0) return i; } return -1; };
    const C = {
      email: col(['email', 'e-mail']), nome: col(['colaborador', 'nome']), status: col(['status']),
      cargo: col(['funcao']), squad: col(['squad']), entrada: col(['entrada']), saida: col(['saida']),
      admissao: col(['admissao']), coord: col(['coordenacao/gerencia', 'coordenacao'])
    };
    Object.keys(C).forEach(function (k) { if (C[k] < 0) throw new Error('Coluna não encontrada no CSV: ' + k); });

    const vistos = {}; const ignorados = []; const dup = [];
    for (let i = 1; i < linhas.length; i++) {
      const r = linhas[i];
      const email = normalizar_(r[C.email]);
      if (!email) continue;
      if (CFG.STATUS_ATIVOS.indexOf(normalizar_(r[C.status])) < 0) { ignorados.push(email); continue; }
      if (vistos[email]) { dup.push(email); continue; }
      vistos[email] = {
        email: email, nome: String(r[C.nome]).trim(), cargo_headcount: String(r[C.cargo]).trim(), squad: String(r[C.squad]).trim(),
        rotulo_coord_headcount: String(r[C.coord]).trim(), entrada_headcount: hora_(r[C.entrada]), saida_headcount: hora_(r[C.saida]),
        admissao: dataBr_(r[C.admissao]), status_headcount: String(r[C.status]).trim()
      };
    }

    const segSex = config_('seg_a_sex').split(',');
    const tp = tabela_('Pessoas');
    const existentes = {}; tp.linhas.forEach(function (l) { existentes[l.email] = l; });
    const novos = []; let atualizados = 0; const saidas = [];
    Object.keys(vistos).forEach(function (e) {
      const d = vistos[e];
      if (existentes[e]) {
        const l = existentes[e];
        const antes = { cargo: l.cargo_headcount, coord: l.rotulo_coord_headcount, ativo: l.ativo, entrada: l.entrada_headcount, saida: l.saida_headcount };
        d.ativo = 'SIM'; d.atualizado_em = agoraIso_();
        atualizarLinha_(tp, l, d); atualizados++;
        const depois = { cargo: d.cargo_headcount, coord: d.rotulo_coord_headcount, ativo: 'SIM', entrada: d.entrada_headcount, saida: d.saida_headcount };
        if (JSON.stringify(antes) !== JSON.stringify(depois)) log_(ator, 'HEADCOUNT_ATUALIZADO', 'Pessoa', e, e, antes, depois);
      } else {
        d.ativo = 'SIM'; d.regra_seg_sex = segSex.indexOf(e) >= 0 ? 'SIM' : 'NAO';
        d.entrada_planejada = d.entrada_headcount; d.saida_planejada = d.saida_headcount;
        d.coord_id_manual = ''; d.atualizado_em = agoraIso_();
        novos.push(d);
      }
    });
    tp.linhas.forEach(function (l) {
      if (!vistos[l.email] && l.ativo === 'SIM') { atualizarLinha_(tp, l, { ativo: 'NAO', atualizado_em: agoraIso_() }); saidas.push(l.email); log_(ator, 'HEADCOUNT_SAIU', 'Pessoa', l.email, l.email, { ativo: 'SIM' }, { ativo: 'NAO' }); }
    });
    appendLinhas_('Pessoas', novos);

    // Usuários: quem é novo entra conforme a configuração inicial; depois da carga inicial, novos ficam PENDENTE.
    const tu = tabela_('Usuarios');
    const temUsuario = {}; tu.linhas.forEach(function (u) { temUsuario[u.email] = true; });
    const papel = {}; Object.keys(ACESSO_INICIAL.gestao).forEach(function (p) { ACESSO_INICIAL.gestao[p].forEach(function (x) { papel[x + '@exemplo.com'] = p; }); });
    const lista = function (arr) { return arr.map(function (x) { return x + '@exemplo.com'; }); };
    const temp = lista(ACESSO_INICIAL.agenteTemporario), exc = lista(ACESSO_INICIAL.excluidos), pend = lista(ACESSO_INICIAL.pendentes);
    const novosUsuarios = [];
    novos.forEach(function (d) {
      if (temUsuario[d.email]) return;
      let perfil, obs = '';
      if (!inicial) { perfil = 'PENDENTE'; obs = 'Entrou no headcount em ' + agoraIso_().slice(0, 10) + '; aguarda liberação da gestão'; }
      else if (exc.indexOf(d.email) >= 0) { perfil = 'BLOQUEADO'; obs = 'Excluído explicitamente do acesso'; }
      else if (temp.indexOf(d.email) >= 0) { perfil = 'AGENTE'; obs = 'Temporário para testes; perfil previsto: GESTAO (' + papel[d.email] + ')'; }
      else if (papel[d.email]) { perfil = 'GESTAO'; }
      else if (pend.indexOf(d.email) >= 0) { perfil = 'PENDENTE'; obs = 'Não está na lista de gestão; aguarda decisão'; }
      else { perfil = 'AGENTE'; }
      novosUsuarios.push({ email: d.email, perfil: perfil, papel_gestao: papel[d.email] || '', observacao: obs, alterado_em: agoraIso_(), alterado_por: ator });
    });
    appendLinhas_('Usuarios', novosUsuarios);

    const res = { lidos: linhas.length - 1, ativosNoArquivo: Object.keys(vistos).length, novos: novos.length, atualizados: atualizados, sairamDoHeadcount: saidas.length, ignoradosPorStatus: ignorados.length, duplicados: dup };
    log_(ator, 'HEADCOUNT_IMPORTADO', 'Headcount', 'CSV', '', null, res);
    return res;
  } finally { lock.releaseLock(); }
}

function config_(chave) {
  const l = tabela_('Config').linhas.filter(function (x) { return x.chave === chave; })[0];
  return l ? l.valor : '';
}

/* =====================================================================
 *  SEGURANÇA
 * ===================================================================== */
function pepper_() { return PropertiesService.getScriptProperties().getProperty('PEPPER'); }
function bytes_(s) { return Utilities.newBlob(s).getBytes(); }
function hex_(b) { return b.map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join(''); }
function hashSenha_(senha, salt, iter) {
  const chave = bytes_(salt + pepper_());
  let h = Utilities.computeHmacSha256Signature(bytes_(senha), chave);
  for (let i = 1; i < iter; i++) h = Utilities.computeHmacSha256Signature(h, chave);
  return hex_(h);
}
function hashToken_(t) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, t + pepper_(), Utilities.Charset.UTF_8)); }
function tokenAleatorio_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }
function iguais_(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

function senhaValida_(s) {
  if (!s || s.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'Use letras e números na senha.';
  if (s.length > 100) return 'A senha pode ter no máximo 100 caracteres.';
  return '';
}

/** Retorna {pessoa, usuario} se o e-mail pode entrar, senão null. */
function elegivel_(email) {
  email = normalizar_(email);
  if (!/^[a-z0-9._-]+@exemplo\.com$/.test(email)) return null;
  const p = tabela_('Pessoas').linhas.filter(function (x) { return x.email === email; })[0];
  if (!p || p.ativo !== 'SIM') return null;
  const u = tabela_('Usuarios').linhas.filter(function (x) { return x.email === email; })[0];
  if (!u || (u.perfil !== 'AGENTE' && u.perfil !== 'GESTAO')) return null;
  return { pessoa: p, usuario: u };
}

const MSG_LINK = 'Se o e-mail estiver autorizado, enviaremos em instantes um link para você criar sua senha. Confira sua caixa de entrada.';

/* =====================================================================
 *  API — AUTENTICAÇÃO (chamadas via google.script.run)
 * ===================================================================== */
function apiSolicitarLink(email) {
  email = normalizar_(email);
  const cache = CacheService.getScriptCache();
  const k = 'link_' + hashToken_(email).slice(0, 24);
  const n = Number(cache.get(k) || 0);
  if (n >= CFG.LINK_MAX_POR_HORA) { return { ok: true, msg: MSG_LINK }; }
  cache.put(k, String(n + 1), 3600);
  const el = elegivel_(email);
  if (!el) { log_(email || 'desconhecido', 'LINK_SENHA_NEGADO', 'Seguranca', '', email, null, null, '', '', 'NAO_ELEGIVEL'); return { ok: true, msg: MSG_LINK }; }
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const tt = tabela_('TokensSenha');
    tt.linhas.forEach(function (l) { if (l.email === email && !l.usado_em) atualizarLinha_(tt, l, { usado_em: 'SUBSTITUIDO ' + agoraIso_() }); });
    const token = tokenAleatorio_();
    const exp = new Date(Date.now() + CFG.LINK_MINUTOS * 60000);
    const tokenId = novoId_('tk');
    appendLinhas_('TokensSenha', [{ token_id: tokenId, token_hash: hashToken_(token), email: email, criado_em: agoraIso_(), expira_em: exp.toISOString() }]);
    const url = urlApp_() + '?senha=' + token;
    const primeiroNome = el.pessoa.nome.split(' ')[0];
    const nome = primeiroNome.charAt(0) + primeiroNome.slice(1).toLowerCase();
    MailApp.sendEmail({
      to: email, name: CFG.APP_NOME, subject: 'Crie sua senha do painel de escalas',
      htmlBody: emailLayout_('<h1 style="font-size:21px;line-height:1.3;margin:0 0 14px;color:#1E1A24">Crie sua senha</h1><p style="margin:0 0 10px">Olá, ' + nome + '!</p><p style="margin:0">Use o botão abaixo para criar sua senha do painel de escalas do Customer. Lá você vê sua escala do mês, pede trocas com colegas e acompanha as aprovações.</p>' +
        emailBotao_('Criar minha senha', url) +
        '<div style="margin:8px 0 6px;padding:12px 14px;border-radius:12px;background:#F7F4FA;border:1px solid #EEE8F3;font-size:13px;color:#4A4352">🔒 O link vale por <b>' + CFG.LINK_MINUTOS + ' minutos</b> e só pode ser usado uma vez.</div>',
        'Se você não pediu este e-mail, ignore: sua senha atual continua valendo. Dúvidas? Fale com o WFM.')
    });
    log_(email, 'LINK_SENHA_ENVIADO', 'Seguranca', tokenId, email);
  } finally { lock.releaseLock(); }
  return { ok: true, msg: MSG_LINK };
}

function tokenSenha_(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tt = tabela_('TokensSenha');
  const h = hashToken_(token);
  const l = tt.linhas.filter(function (x) { return x.token_hash === h; })[0];
  if (!l || l.usado_em || new Date(l.expira_em) < new Date()) return null;
  return { tt: tt, linha: l };
}

function apiValidarLink(token) {
  const t = tokenSenha_(token);
  if (!t || !elegivel_(t.linha.email)) return { ok: false, msg: 'Este link expirou ou já foi usado. Peça um novo link na tela de entrada.' };
  return { ok: true, email: t.linha.email };
}

function apiDefinirSenha(token, senha, confirmacao) {
  const erro = senhaValida_(senha); if (erro) return { ok: false, msg: erro };
  if (senha !== confirmacao) return { ok: false, msg: 'As duas senhas não são iguais.' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tokenSenha_(token);
    if (!t || !elegivel_(t.linha.email)) return { ok: false, msg: 'Este link expirou ou já foi usado. Peça um novo link na tela de entrada.' };
    const email = t.linha.email;
    gravarSenha_(email, senha);
    atualizarLinha_(t.tt, t.linha, { usado_em: agoraIso_() });
    revogarSessoes_(email, null);
    log_(email, 'SENHA_DEFINIDA_POR_LINK', 'Seguranca', t.linha.token_id, email);
    return { ok: true, msg: 'Senha criada. Entre com seu e-mail e a nova senha.' };
  } finally { lock.releaseLock(); }
}

function gravarSenha_(email, senha) {
  const salt = tokenAleatorio_().slice(0, 32);
  const reg = { email: email, hash: hashSenha_(senha, salt, CFG.HASH_ITER), salt: salt, iter: CFG.HASH_ITER, definida_em: agoraIso_() };
  const tc = tabela_('Credenciais');
  const l = tc.linhas.filter(function (x) { return x.email === email; })[0];
  if (l) atualizarLinha_(tc, l, reg); else appendLinhas_('Credenciais', [reg]);
}

function apiLogin(email, senha, lembrar) {
  email = normalizar_(email);
  const generico = { ok: false, msg: 'E-mail ou senha incorretos. Se ainda não criou sua senha, use "Primeiro acesso".' };
  const cache = CacheService.getScriptCache();
  const k = 'falha_' + hashToken_(email).slice(0, 24);
  const falhas = Number(cache.get(k) || 0);
  if (falhas >= CFG.LOGIN_MAX_FALHAS) return { ok: false, msg: 'Muitas tentativas. Aguarde ' + CFG.LOGIN_BLOQUEIO_MIN + ' minutos ou use "Esqueci minha senha".' };
  const el = elegivel_(email);
  const cred = el ? tabela_('Credenciais').linhas.filter(function (x) { return x.email === email; })[0] : null;
  const ok = cred && iguais_(hashSenha_(String(senha || ''), cred.salt, Number(cred.iter)), cred.hash);
  if (!ok) {
    cache.put(k, String(falhas + 1), CFG.LOGIN_BLOQUEIO_MIN * 60);
    log_(email || 'desconhecido', 'LOGIN_FALHOU', 'Seguranca', '', email, null, null, '', '', falhas + 1 >= CFG.LOGIN_MAX_FALHAS ? 'BLOQUEADO_TEMPORARIAMENTE' : 'FALHA');
    return generico;
  }
  cache.remove(k);
  const token = tokenAleatorio_();
  const dur = lembrar ? CFG.SESSAO_LEMBRAR_DIAS * 86400000 : CFG.SESSAO_HORAS * 3600000;
  const sid = novoId_('ses');
  appendLinhas_('Sessoes', [{ sessao_id: sid, token_hash: hashToken_(token), email: email, criada_em: agoraIso_(), expira_em: new Date(Date.now() + dur).toISOString(), lembrar: lembrar ? 'SIM' : 'NAO', ultimo_uso: agoraIso_() }]);
  log_(email, 'LOGIN', 'Seguranca', sid, email, null, { lembrar: !!lembrar });
  return { ok: true, token: token, lembrar: !!lembrar };
}

/** Valida a sessão e devolve o contexto do usuário. Lança erro se inválida. */
function sessao_(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('SESSAO_INVALIDA');
  const h = hashToken_(token);
  const cache = CacheService.getScriptCache();
  let email = cache.get('s_' + h);
  if (!email) {
    const s = tabela_('Sessoes').linhas.filter(function (x) { return x.token_hash === h; })[0];
    if (!s || s.revogada_em || new Date(s.expira_em) < new Date()) throw new Error('SESSAO_INVALIDA');
    email = s.email;
    cache.put('s_' + h, email, 300);
  }
  const el = elegivelSessao_(email);
  if (!el) throw new Error('SESSAO_INVALIDA');
  try { marcarPresenca_(email); } catch (e) { /* presença é só informativa */ }
  return { email: email, perfil: el.usuario.perfil, pessoa: el.pessoa, usuario: el.usuario, tokenHash: h };
}

function revogarSessoes_(email, excetoHash) {
  const ts = tabela_('Sessoes'); const cache = CacheService.getScriptCache();
  ts.linhas.forEach(function (s) {
    if (s.email === email && !s.revogada_em && s.token_hash !== excetoHash) { atualizarLinha_(ts, s, { revogada_em: agoraIso_() }); cache.remove('s_' + s.token_hash); }
  });
}

function apiLogout(token) {
  try {
    const ctx = sessao_(token);
    const ts = tabela_('Sessoes');
    const s = ts.linhas.filter(function (x) { return x.token_hash === ctx.tokenHash; })[0];
    if (s) atualizarLinha_(ts, s, { revogada_em: agoraIso_() });
    CacheService.getScriptCache().remove('s_' + ctx.tokenHash);
    try { marcarPresenca_(ctx.email, true); } catch (e) { /* presença é só informativa */ }
    log_(ctx.email, 'LOGOUT', 'Seguranca', s ? s.sessao_id : '', ctx.email);
  } catch (e) { /* sessão já inválida */ }
  return { ok: true };
}

function apiTrocarSenha(token, atual, nova, confirmacao) {
  const ctx = sessao_(token);
  const cred = tabela_('Credenciais').linhas.filter(function (x) { return x.email === ctx.email; })[0];
  if (!cred || !iguais_(hashSenha_(String(atual || ''), cred.salt, Number(cred.iter)), cred.hash)) {
    log_(ctx.email, 'TROCA_SENHA_FALHOU', 'Seguranca', '', ctx.email, null, null, '', '', 'SENHA_ATUAL_INCORRETA');
    return { ok: false, msg: 'A senha atual está incorreta.' };
  }
  const erro = senhaValida_(nova); if (erro) return { ok: false, msg: erro };
  if (nova !== confirmacao) return { ok: false, msg: 'As duas senhas novas não são iguais.' };
  if (nova === atual) return { ok: false, msg: 'A nova senha precisa ser diferente da atual.' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    gravarSenha_(ctx.email, nova);
    revogarSessoes_(ctx.email, ctx.tokenHash);
    log_(ctx.email, 'SENHA_ALTERADA', 'Seguranca', '', ctx.email, null, { outras_sessoes_encerradas: true });
  } finally { lock.releaseLock(); }
  return { ok: true, msg: 'Senha alterada. Os outros dispositivos foram desconectados.' };
}

/* =====================================================================
 *  API — DADOS INICIAIS DO PAINEL
 * ===================================================================== */
function coordenacoes_() {
  const mapa = {};
  tabela_('Coordenacoes').linhas.forEach(function (c) {
    mapa[c.coord_id] = c;
    c.rotulos_headcount.split('|').forEach(function (r) { mapa['rot:' + normalizar_(r)] = c; });
  });
  return mapa;
}
function coordDe_(p, mapa) {
  const c = (p.coord_id_manual && mapa[p.coord_id_manual]) || mapa['rot:' + normalizar_(p.rotulo_coord_headcount)];
  return c ? { id: c.coord_id, nome: c.nome_exibicao } : { id: '', nome: p.rotulo_coord_headcount || '—' };
}
function nomeCurto_(n) { return String(n).toLowerCase().replace(/(^|\s)\S/g, function (m) { return m.toUpperCase(); }).replace(/\s(De|Da|Do|Dos|Das|E)\s/g, function (m) { return m.toLowerCase(); }); }

function apiInicio(token) {
  const ctx = sessao_(token);
  const mapa = coordenacoes_();
  const eu = {
    email: ctx.email, nome: nomeCurto_(ctx.pessoa.nome), cargo: ctx.pessoa.cargo_headcount, squad: ctx.pessoa.squad,
    coordenacao: coordDe_(ctx.pessoa, mapa).nome, entrada: ctx.pessoa.entrada_planejada, saida: ctx.pessoa.saida_planejada,
    perfil: ctx.perfil, segASex: ctx.pessoa.regra_seg_sex === 'SIM'
  };
  const out = { eu: eu, mesInicial: config_('mes_inicial') };
  if (ctx.perfil === 'GESTAO') {
    const usuarios = {}; tabela_('Usuarios').linhas.forEach(function (u) { usuarios[u.email] = u; });
    const pessoas = tabela_('Pessoas').linhas.filter(function (p) { return p.ativo === 'SIM'; });
    const cont = { GESTAO: 0, AGENTE: 0, BLOQUEADO: 0, PENDENTE: 0 };
    const porCoord = {};
    const agentes = [];
    pessoas.forEach(function (p) {
      const u = usuarios[p.email]; const perfil = u ? u.perfil : 'PENDENTE';
      cont[perfil] = (cont[perfil] || 0) + 1;
      if (perfil === 'AGENTE') {
        const c = coordDe_(p, mapa);
        porCoord[c.nome] = (porCoord[c.nome] || 0) + 1;
        agentes.push({ nome: nomeCurto_(p.nome), email: p.email, cargo: p.cargo_headcount, squad: p.squad, coordenacao: c.nome, entrada: p.entrada_planejada, saida: p.saida_planejada, status: p.status_headcount, obs: u.observacao });
      }
    });
    agentes.sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
    out.gestao = { contagem: cont, porCoordenacao: porCoord, agentes: agentes };
  }
  return out;
}

/* =====================================================================
 *  WEB APP
 * ===================================================================== */
function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.linkSenha = (e && e.parameter && e.parameter.senha) ? String(e.parameter.senha).replace(/[^a-f0-9]/g, '').slice(0, 64) : '';
  t.modoTeste = (e && e.parameter && e.parameter.teste) ? String(e.parameter.teste).replace(/[^a-z]/g, '').slice(0, 20) : '';
  return t.evaluate().setTitle(typeof tituloDaAba_ === 'function' ? tituloDaAba_() : CFG.APP_NOME).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* =====================================================================
 *  TESTES (rodar pelo editor)
 * ===================================================================== */

/* =====================================================================
 *  ADMINISTRAÇÃO DE ACESSOS (rodar pelo editor; tudo vai para os Logs)
 * ===================================================================== */
/** Ex.: alterarPerfil('conta.teste1@exemplo.com', 'GESTAO', 'Analista', 'Fim do período de teste') */
function alterarPerfil(email, perfil, papel, motivo) {
  email = normalizar_(email);
  if (['AGENTE', 'GESTAO', 'BLOQUEADO', 'PENDENTE'].indexOf(perfil) < 0) throw new Error('Perfil inválido: ' + perfil);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const tu = tabela_('Usuarios');
    const u = tu.linhas.filter(function (x) { return x.email === email; })[0];
    if (!u) throw new Error('E-mail não está na aba Usuarios: ' + email);
    const antes = { perfil: u.perfil, papel_gestao: u.papel_gestao, observacao: u.observacao };
    const ator = Session.getActiveUser().getEmail() || 'editor';
    const depois = { perfil: perfil, papel_gestao: perfil === 'GESTAO' ? (papel || u.papel_gestao) : (papel || ''), observacao: motivo || '' };
    atualizarLinha_(tu, u, { perfil: depois.perfil, papel_gestao: depois.papel_gestao, observacao: depois.observacao, alterado_em: agoraIso_(), alterado_por: ator });
    if (perfil !== 'AGENTE' && perfil !== 'GESTAO') revogarSessoes_(email, null);
    log_(ator, 'PERMISSAO_ALTERADA', 'Usuario', email, email, antes, depois, motivo);
    return depois;
  } finally { lock.releaseLock(); }
}



function renomearCoordenacao(coordId, nomeExibicao) {
  const tc = tabela_('Coordenacoes');
  const c = tc.linhas.filter(function (x) { return x.coord_id === coordId; })[0];
  if (!c) throw new Error('Coordenação não encontrada: ' + coordId);
  const antes = { nome_exibicao: c.nome_exibicao };
  atualizarLinha_(tc, c, { nome_exibicao: nomeExibicao });
  log_(Session.getActiveUser().getEmail() || 'editor', 'COORDENACAO_RENOMEADA', 'Coordenacao', coordId, '', antes, { nome_exibicao: nomeExibicao });
}

