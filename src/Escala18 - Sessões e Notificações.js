/**
 * Escala18.gs — desempenho com muitas pessoas ao mesmo tempo.
 * elegivelSessao_: a checagem de acesso de cada chamada fica 2 minutos em memória (não lê Pessoas e Usuários toda vez).
 * novaVersaoNotif_: avisa que há notificação nova, para o sino de cada pessoa ser recalculado só quando precisa.
 * medirCarga(): só leitura. Mede o tamanho das abas e o tempo das operações mais usadas.
 */
function elegivelSessao_(email) {
  const c = CacheService.getScriptCache(), k = 'el_' + email, g = c.get(k);
  if (g) { try { return JSON.parse(g); } catch (e) { /* lê de novo */ } }
  const el = elegivel_(email);
  if (el) { try { c.put(k, JSON.stringify(el), 120); } catch (e) { /* sem cache */ } }
  return el;
}
function novaVersaoNotif_() { try { CacheService.getScriptCache().put('notif_ver', String(Date.now()), 21600); } catch (e) { /* ok */ } }
function colunaLetra_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

function medirCarga() {
  const out = [], ms = function (f) { const t = Date.now(); f(); return Date.now() - t; };
  ['Pessoas', 'Usuarios', 'Escalas', 'Trocas', 'Notificacoes', 'Logs', 'Sessoes', 'Afastamentos', 'Credenciais'].forEach(function (n) {
    delete MEMO_[n]; let linhas = 0, cols = 0;
    const t = ms(function () { const x = tabela_(n); linhas = x.linhas.length; cols = x.cab.length; });
    delete MEMO_[n]; out.push(n + ': ' + linhas + ' linhas × ' + cols + ' colunas, leitura ' + t + ' ms');
  });
  out.push('Senha (1 login): ' + ms(function () { hashSenha_('teste1234', 'salt', CFG.HASH_ITER); }) + ' ms');
  const email = 'admin@exemplo.com';
  out.push('Checagem de acesso sem memória: ' + ms(function () { MEMO_ = {}; elegivel_(email); }) + ' ms');
  out.push('Checagem de acesso com memória: ' + ms(function () { elegivelSessao_(email); elegivelSessao_(email); }) / 2 + ' ms');
  out.push('Sino (calcular notificações): ' + ms(function () { MEMO_ = {}; notificacoesDe_({ email: email, perfil: 'GESTAO' }); }) + ' ms');
  out.push('Minha escala de novembro: ' + ms(function () { MEMO_ = {}; apiMes_interno_(email); }) + ' ms');
  const ss = db_(); let cel = 0; ss.getSheets().forEach(function (s) { cel += s.getMaxRows() * s.getMaxColumns(); });
  out.push('Células usadas na planilha (limite do Google: 10.000.000): ' + cel);
  Logger.log(out.join('\n')); return out;
}
function apiMes_interno_(email) { try { const s = tabela_('Escalas').linhas.filter(function (l) { return l.mes === '2026-11' && l.email === email; }); return s.length; } catch (e) { return 0; } }
