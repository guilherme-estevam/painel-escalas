/* =====================================================================
 * Usuários (24/11/2026)
 * Gestão de Escalas > Ajustes > Usuários, só para o WFM.
 *  · cadastrar um usuário novo: e-mail, nome completo e acesso (Agente ou Gestão com a tag escolhida);
 *  · atualizar o cadastro (nome, acesso, tag e coordenação);
 *  · a movimentação e o desligamento usam as mesmas regras do Planejamento (Escala30 e Escala36).
 * A tag de gestão fica em Usuarios.papel_gestao (o mesmo campo que o painel já usa para os selos).
 * WFM e People dão TODOS os acessos do WFM (Planejamento, Feriados, Usuários,
 * aprovação das Solicitações e o que mais usar ehSuperadmin_): além da lista fixa SUPERADMINS, vale quem
 * foi cadastrado aqui com essas tags (coluna acesso_ph = SIM, criada na primeira gravação). Quem está
 * na lista fixa não tem o acesso alterado por esta tela, e ninguém altera o próprio acesso.
 * Tudo vai para o Histórico (Usuário Cadastrado e Cadastro Atualizado).
 * ===================================================================== */
var USR_PAPEIS = [
  { id: 'WFM', rot: 'WFM', cls: 'ph', ph: true, desc: 'Acesso completo, com Planejamento, Feriados e Usuários' },
  { id: 'People', rot: 'People', cls: 'people', ph: true, desc: 'Mesmo acesso do WFM, com a tag de People' },
  { id: 'Diretoria', rot: 'Diretoria', cls: 'diretoria', desc: 'Visões da gestão, com a tag de Diretoria' },
  { id: 'Gerente Executiva', rot: 'Gerente Executiva', cls: 'gerente', desc: 'Visões da gestão, com a tag de Gerente Executiva' },
  { id: 'Gerente Executivo', rot: 'Gerente Executivo', cls: 'gerente', desc: 'Visões da gestão, com a tag de Gerente Executivo' },
  { id: 'Gerente', rot: 'Gerente', cls: 'gerente', desc: 'Visões da gestão, com a tag de Gerente' },
  { id: 'Coordenação', rot: 'Coordenação', cls: 'coord', desc: 'Visões da gestão e aprovação de trocas do time' },
  { id: 'Analista', rot: 'Analista', cls: 'analista', desc: 'Visões da gestão, com a tag de Analista' },
  { id: 'Gestão', rot: 'Gestão', cls: 'gestao', desc: 'Visões da gestão, sem cargo específico' }
];
var USR_EMAIL_RE = /^[a-z0-9._-]+@exemplo\.com$/;

/* ---------- acesso do WFM para quem foi cadastrado com essa tag ---------- */
function usrPhDinamicos_() {
  if (MEMO_.__phDin) return MEMO_.__phDin;
  const m = {};
  tabela_('Usuarios').linhas.forEach(function (u) { if (u.perfil === 'GESTAO' && u.acesso_ph === 'SIM') m[String(u.email).toLowerCase()] = 1; });
  return (MEMO_.__phDin = m);
}
(function () {
  const _eh = ehSuperadmin_;
  ehSuperadmin_ = function (email) {
    if (_eh.apply(this, arguments)) return true;
    try { return !!usrPhDinamicos_()[String(email || '').toLowerCase()]; } catch (e) { return false; }
  };
  // Solicitações: quem tem a tag do WFM também aprova e recebe os avisos (a lista fixa continua com a regra dela)
  if (typeof solAprovadores_ === 'function') {
    const _sa = solAprovadores_;
    solAprovadores_ = function () {
      const l = _sa.apply(this, arguments).slice(), hoje = hojeIso_();
      try { Object.keys(usrPhDinamicos_()).forEach(function (e) { const d = typeof desligDe_ === 'function' ? desligDe_(e) : ''; if (l.indexOf(e) < 0 && (!d || hoje <= d)) l.push(e); }); } catch (e) { }
      return l;
    };
  }
  const _pp = papelPainel_;
  papelPainel_ = function (email, u, p) {
    if (u && u.perfil === 'GESTAO' && u.acesso_ph === 'SIM' && u.papel_gestao === 'People') return { rot: 'People', cls: 'people' };
    return _pp.apply(this, arguments);
  };
})();

function usrColuna_() {
  const sh = db_().getSheetByName('Usuarios'), cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(String);
  if (cab.indexOf('acesso_ph') >= 0) return;
  garantirEspacoColunas_(sh, cab.length + 1);
  sh.getRange(1, cab.length + 1).setValue('acesso_ph'); sh.getRange(1, cab.length + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  delete MEMO_['Usuarios']; delete MEMO_.__phDin; try { abaMudou_('Usuarios'); } catch (e) { }
}
function usrPapel_(id) { return USR_PAPEIS.filter(function (x) { return x.id === id; })[0] || null; }
function usrFixo_(email) { return SUPERADMINS.indexOf(String(email || '').toLowerCase()) >= 0; }
function usrAcessoTxt_(perfil, papel) { return perfil === 'GESTAO' ? 'Gestão · ' + (papel || 'Gestão') : perfil === 'AGENTE' ? 'Agente' : (perfil || 'Sem acesso'); }

/** Lista de usuários para a tela (WFM). */
function apiUsuarios(token) {
  const ctx = sessao_(token); exigirPlanejamento_(ctx);
  const us = {}; tabela_('Usuarios').linhas.forEach(function (u) { us[String(u.email).toLowerCase()] = u; });
  const cred = {}; tabela_('Credenciais').linhas.forEach(function (c) { cred[String(c.email).toLowerCase()] = 1; });
  const mapa = coordenacoes_(), hoje = hojeIso_();
  const lista = tabela_('Pessoas').linhas.filter(function (p) { return us[String(p.email).toLowerCase()] && !/^vaga/i.test(String(p.status_headcount || '')); }).map(function (p) {
    const email = String(p.email).toLowerCase(), u = us[email], c = coordDe_(p, mapa), tag = papelPainel_(email, u, p);
    const desl = String(p.desligado_em || '').slice(0, 10), mov = String(p.movimentado_em || '').slice(0, 10);
    const comAcesso = p.ativo === 'SIM' && (u.perfil === 'AGENTE' || u.perfil === 'GESTAO');
    let sit = comAcesso ? 'ATIVO' : 'SEM_ACESSO';
    if (mov && hoje >= mov) sit = 'MOVIMENTADO'; else if (desl && hoje > desl) sit = 'DESLIGADO';
    return {
      email: email, nome: nomeCurto_(p.nome), nomeCompleto: String(p.nome || '').trim(), perfil: u.perfil, papel: u.papel_gestao || '', ph: u.acesso_ph === 'SIM',
      tag: comAcesso ? tag : { rot: 'Sem acesso', cls: 'agente' }, coordId: c.id, coord: c.nome, coordManual: p.coord_id_manual || '', cargo: p.cargo_headcount || '',
      sit: sit, desligadoEm: desl, movimentadoEm: mov, senha: !!cred[email], fixo: usrFixo_(email), eu: email === ctx.email,
      painel: p.status_headcount === 'Cadastrado pelo painel'
    };
  }).sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
  const coords = tabela_('Coordenacoes').linhas.filter(function (c) { return c.ativo === 'SIM'; }).map(function (c) { return { id: c.coord_id, nome: c.nome_exibicao }; })
    .sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
  return { usuarios: lista, papeis: USR_PAPEIS, coordenacoes: coords, hoje: hoje };
}

/** Cadastra (d.novo) ou atualiza um usuário. d = {novo, email, nome, perfil, papel, coordId, convite} */
function apiUsuarioSalvar(token, d) {
  const ctx = sessao_(token); exigirPlanejamento_(ctx);
  d = d || {};
  const email = normalizar_(d.email), novo = !!d.novo;
  if (!USR_EMAIL_RE.test(email)) throw new Error('Use um e-mail @exemplo.com válido (letras, números, ponto, hífen ou sublinhado).');
  const nome = String(d.nome || '').replace(/\s+/g, ' ').trim();
  if (nome.length > 120) throw new Error('O nome pode ter no máximo 120 caracteres.');
  if (nome.split(' ').length < 2 || nome.length < 5) throw new Error('Informe o nome completo (nome e sobrenome).');
  if (/[<>]/.test(nome)) throw new Error('O nome não pode ter os caracteres < ou >.');
  let perfil = d.perfil === 'GESTAO' || d.perfil === 'AGENTE' ? d.perfil : '';
  const coordId = String(d.coordId || '');
  let res, convidar = false;
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    MEMO_ = {}; usrColuna_();
    if (coordId && !coordenacoes_()[coordId]) throw new Error('Coordenação não encontrada.');
    const tp = tabela_('Pessoas'), tu = tabela_('Usuarios'), agora = agoraIso_();
    const p = tp.linhas.filter(function (x) { return String(x.email).toLowerCase() === email; })[0];
    const u = tu.linhas.filter(function (x) { return String(x.email).toLowerCase() === email; })[0];
    const desl = p ? String(p.desligado_em || '').slice(0, 10) : '', mov = p ? String(p.movimentado_em || '').slice(0, 10) : '';
    // travado: lista fixa ou a própria pessoa. manter: a tela avisa que o acesso não foi mexido (papéis antigos, como "COO", ficam como estão)
    const travado = !novo && (usrFixo_(email) || email === ctx.email) || (!novo && !!d.manterAcesso && !!u && u.perfil === perfil);
    if (travado) { perfil = u ? u.perfil : perfil; }
    if (!perfil) throw new Error('Escolha o acesso: Agente ou Gestão.');
    let pap = null;
    if (!travado && perfil === 'GESTAO') { pap = usrPapel_(d.papel); if (!pap) throw new Error('Escolha a tag de gestão.'); }
    const papel = travado ? (u ? u.papel_gestao : '') : (pap ? pap.id : '');
    const ph = travado ? (u ? u.acesso_ph || '' : '') : (pap && pap.ph ? 'SIM' : '');
    if (novo) {
      if (desl || mov) throw new Error('Este e-mail tem ' + (mov ? 'movimentação' : 'desligamento') + ' registrado (' + desligBr_(mov || desl) + '). O retorno de quem saiu não é feito por esta tela.');
      if (p && u && p.ativo === 'SIM' && (u.perfil === 'AGENTE' || u.perfil === 'GESTAO')) throw new Error('Este e-mail já está cadastrado (' + nomeCurto_(p.nome) + '). Use Editar para atualizar o cadastro.');
    } else if (!p || !u) throw new Error('Cadastro não encontrado. Recarregue a lista.');
    const NOME = nome.toUpperCase();
    const cargo = perfil === 'GESTAO' ? (pap ? pap.rot : papel) : 'Agente';
    const antes = p && u ? { nome: nomeCurto_(p.nome), acesso: usrAcessoTxt_(u.perfil, u.papel_gestao), coordenacao: coordDe_(p, coordenacoes_()).nome, ativo: p.ativo } : null;
    // Pessoas
    if (!p) {
      appendLinhas_('Pessoas', [{ email: email, nome: NOME, cargo_headcount: cargo, squad: '', rotulo_coord_headcount: '', coord_id_manual: coordId, entrada_headcount: '', saida_headcount: '', entrada_planejada: '', saida_planejada: '', admissao: '', status_headcount: 'Cadastrado pelo painel', ativo: 'SIM', regra_seg_sex: 'NAO', atualizado_em: agora }]);
    } else {
      const m = {};
      if (String(p.nome).trim() !== NOME) m.nome = NOME;
      if (String(p.coord_id_manual || '') !== coordId) m.coord_id_manual = coordId;
      if (p.ativo !== 'SIM') m.ativo = 'SIM';
      if (!String(p.cargo_headcount || '').trim() || (p.status_headcount === 'Cadastrado pelo painel' && p.cargo_headcount !== cargo)) m.cargo_headcount = cargo;
      if (Object.keys(m).length) { m.atualizado_em = agora; atualizarLinha_(tp, p, m); }
    }
    // Usuarios
    const mudouAcesso = !u || u.perfil !== perfil || String(u.papel_gestao || '') !== papel || String(u.acesso_ph || '') !== ph;
    if (!u) appendLinhas_('Usuarios', [{ email: email, perfil: perfil, papel_gestao: papel, acesso_ph: ph, observacao: 'Cadastrado pelo painel', alterado_em: agora, alterado_por: ctx.email }]);
    else if (mudouAcesso) atualizarLinha_(tabela_('Usuarios'), tabela_('Usuarios').linhas.filter(function (x) { return String(x.email).toLowerCase() === email; })[0], { perfil: perfil, papel_gestao: papel, acesso_ph: ph, alterado_em: agora, alterado_por: ctx.email });
    MEMO_ = {};
    const pn = tabela_('Pessoas').linhas.filter(function (x) { return String(x.email).toLowerCase() === email; })[0];
    const depois = { nome: nomeCurto_(NOME), acesso: usrAcessoTxt_(perfil, papel), coordenacao: coordDe_(pn, coordenacoes_()).nome, ativo: 'SIM' };
    const dif = function (o) { const r = {}; Object.keys(depois).forEach(function (k) { if (!antes || antes[k] !== depois[k]) r[k] = o[k]; }); return r; };
    const mudou = Object.keys(dif(depois)).length > 0;
    // acesso mudou: a checagem em memória é apagada e as sessões abertas são encerradas (a pessoa entra de novo com o acesso novo)
    try { CacheService.getScriptCache().remove('el_' + email); } catch (e) { }
    if (u && mudouAcesso) { try { revogarSessoes_(email); } catch (e) { } }
    if (novo || (antes && antes.ativo !== 'SIM')) log_(ctx.email, 'USUARIO_CADASTRADO', 'Usuario', email, email, antes ? dif(antes) : null, { nome: depois.nome, acesso: depois.acesso, coordenacao: depois.coordenacao }, '');
    else if (mudou) log_(ctx.email, 'USUARIO_ATUALIZADO', 'Usuario', email, email, dif(antes), dif(depois), '');
    convidar = !!(novo && d.convite);
    res = { ok: true, novo: novo, nada: !novo && !mudou, email: email, nome: depois.nome, acesso: depois.acesso, sessoesEncerradas: !!(u && mudouAcesso) };
  } finally { lock.releaseLock(); }
  // convite para criar a senha (o mesmo e-mail do "criar senha" da tela de entrada), fora da trava
  if (convidar) { try { apiSolicitarLink(email); res.convite = true; } catch (e) { res.convite = false; } }
  return res;
}
