/** Exportação da escala em CSV (aba Planejamento).
 *  Base: escala PUBLICADA do mês, que já tem as trocas efetivadas; férias e licenças vêm dos afastamentos e os feriados não trabalhados do cadastro de feriados
 *  (mesma regra da Visão do Mês). Pedidos de troca ainda não aprovados não entram. */
function apiExportarEscala(token, mes, formato) {
  const ctx = sessao_(token); exigirGestao_(ctx); exigirPlanejamento_(ctx); mesValido_(mes);
  return exportarEscala_(mes, formato === 'dias' ? 'dias' : 'grade');
}
function exportarEscala_(mes, formato) {
  const p = mes.split('-'), nd = new Date(+p[0], +p[1], 0).getDate(), ini = mes + '-01', fim = mes + '-' + ('0' + nd).slice(-2);
  const esc = {}; tabela_('Escalas').linhas.forEach(function (l) { if (l.mes === mes) esc[l.email] = l; });
  const af = {}; afastamentosEntre_(ini, fim).forEach(function (a) { (af[a.email] = af[a.email] || []).push(a); });
  const fer = {}; feriadosEntre_(ini, fim, true).forEach(function (f) { fer[f.data] = { nome: f.nome }; });
  const teste = contasTeste_(), SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'], FR = { '0800': '0800', chat: 'Chat', ass: 'Assíncrono' };
  const mi = function (h) { const q = String(h).split(':'); return (+q[0]) * 60 + (+q[1] || 0); }, hm = function (n) { return ('0' + Math.floor(n / 60)).slice(-2) + ':' + ('0' + (n % 60)).slice(-2); };
  const atuGeral = function (e) { try { const g = grupoAtuacao_(e, mes); return g === 'Híbrido' ? '0800 e Chat' : g === 'Assíncrono' ? 'Assíncrono' : (g || 'Atuação a Definir'); } catch (x) { return ''; } };
  const pessoas = pessoasEscala_().filter(function (pe) { return teste.indexOf(pe.email) < 0; }).sort(function (a, b) { return (a.coord || '').localeCompare(b.coord || '', 'pt-BR') || (a.nome || '').localeCompare(b.nome || '', 'pt-BR'); });
  const dias = []; for (let d = 1; d <= nd; d++) { const data = mes + '-' + ('0' + d).slice(-2); dias.push({ d: d, data: data, br: data.slice(8) + '/' + data.slice(5, 7), sem: SEM[new Date(data + 'T12:00:00Z').getUTCDay()] }); }
  /* situação de cada pessoa em cada dia */
  const linhasP = pessoas.map(function (pe) {
    const l = esc[pe.email], pub = l ? String(l.dias_publicados || '') : '', a = l ? (atuacaoDe_({ atuacao: l.atuacao_publicada }) || {}) : {};
    const ds = dias.map(function (dd) {
      const afa = (af[pe.email] || []).filter(function (x) { return x.inicio <= dd.data && x.fim >= dd.data; })[0];
      if (afa) return { sit: /FERIAS/i.test(afa.tipo) ? 'Férias' : 'Licença' };
      if (!pub) return { sit: 'Sem Escala' };
      if (pub.charAt(dd.d - 1) === 'T') { const x = a.d && a.d[String(dd.d)]; const ent = x && x[0] ? x[0] : (pe.entrada || ''), sai = x && x[2] ? x[2] : (pe.saida || ''), alm = x && x[1] ? x[1] : '';
        const bl = (x && x[3] || []).slice().sort(function (u, v) { return mi(u[1]) - mi(v[1]); }).map(function (b) { return (FR[b[0]] || b[0]) + ' ' + b[1] + '–' + b[2]; }).join(' | ');
        return { sit: 'Trabalha', ent: ent, sai: sai, alm: alm ? alm + '–' + hm(mi(alm) + 60) : '', bl: bl }; }
      return { sit: fer[dd.data] ? 'Feriado' : 'Folga' };
    });
    return { pe: pe, ds: ds, atu: atuGeral(pe.email) };
  });
  const perfil = function (pe) { return pe.perfil === 'GESTAO' ? 'Gestão' : 'Agente'; };
  let cab, linhas;
  if (formato === 'dias') {
    cab = ['Data', 'Dia', 'Nome', 'E-mail', 'Coordenação', 'Perfil', 'Atuação', 'Situação', 'Entrada', 'Almoço', 'Saída', 'Atuações do Dia', 'Feriado'];
    linhas = []; linhasP.forEach(function (r) { r.ds.forEach(function (x, i) { const dd = dias[i];
      linhas.push([dd.br + '/' + mes.slice(0, 4), dd.sem, r.pe.nome, r.pe.email, r.pe.coord || '', perfil(r.pe), r.atu, x.sit, x.ent || '', x.alm || '', x.sai || '', x.bl || '', fer[dd.data] ? fer[dd.data].nome : '']); }); });
  } else {
    cab = ['Nome', 'E-mail', 'Coordenação', 'Perfil', 'Atuação'].concat(dias.map(function (dd) { return dd.br + ' ' + dd.sem; })).concat(['Dias de Trabalho', 'Folgas', 'Férias ou Licença']);
    linhas = linhasP.map(function (r) { let t = 0, f = 0, v = 0;
      const cel = r.ds.map(function (x) { if (x.sit === 'Trabalha') { t++; return (x.ent && x.sai ? x.ent + '–' + x.sai : 'Trabalha') + (x.alm ? ' · almoço ' + x.alm.split('–')[0] : ''); } if (x.sit === 'Folga' || x.sit === 'Feriado') f++; if (x.sit === 'Férias' || x.sit === 'Licença') v++; return x.sit; });
      return [r.pe.nome, r.pe.email, r.pe.coord || '', perfil(r.pe), r.atu].concat(cel).concat([t, f, v]); });
  }
  return { nome: 'escala_' + mes + (formato === 'dias' ? '_dia_a_dia' : '_grade') + '.csv', cab: cab, linhas: linhas, pessoas: linhasP.length };
}
