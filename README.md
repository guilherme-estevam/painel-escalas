# Painel de Escalas — Central de Atendimento

Aplicação web para **planejar, publicar e acompanhar as escalas de trabalho** de uma central de atendimento com equipes de 0800, chat e atendimento assíncrono. Foi construída inteiramente em **Google Apps Script**, usando uma planilha do Google Sheets como banco de dados e o HtmlService como front-end de página única.

O painel substituiu um processo manual feito em planilhas e mensagens. Hoje ele concentra o planejamento mensal, as trocas de turno entre agentes com aprovação da coordenação, a visão operacional do dia e o controle de presença.

> **Sobre esta versão:** este repositório é uma versão de portfólio. Todos os dados são fictícios (`@exemplo.com`, "Coordenação Alfa/Beta/Gama"), os identificadores de planilhas e implantações foram trocados por marcadores (`ID_DA_...`), e os módulos que lidam com informações sensíveis de pessoas (RH, atestados, desligamentos) e os scripts de manutenção de uso único foram retirados.

---

## Funcionalidades

### Para o agente
- **Minha escala:** calendário do mês com dias de trabalho, folgas, feriados, férias e licenças, além do cartão do turno do dia (entrada, almoço, saída e frentes de atendimento por horário).
- **Trocas de escala:** pedir a troca de um dia com um colega, aceitar, recusar ou cancelar e acompanhar o andamento até a aprovação.
- **Troca de horário no mesmo dia:** duas pessoas escaladas no mesmo dia trocam horário, almoço e frentes.
- **Notificações:** sino no painel, e-mail e mensagem direta no Slack a cada etapa da troca.
- **Registro de presença** no próprio dia.

### Para a gestão (coordenação e WFM)
- **Planejamento mensal:** grade por semana com validação das regras de jornada em tempo real, rascunho, publicação e versionamento da escala.
- **Aprovação de trocas** pelos coordenadores das duas pessoas, com prazos e expiração automática.
- **Visão do dia por canal:** quem está em cada fila (0800, chat, assíncrono) a cada meia hora, cobertura e ajustes de fila do dia.
- **Controle de logados e aderência:** comparação entre a escala publicada e o que de fato aconteceu (entradas, atrasos, ausências), com dashboard semanal e ranking.
- **Mapa de férias e licenças**, cadastro de feriados (trabalhados ou não) e afastamentos.
- **Exportação em CSV** da escala e do controle de logados.
- **Histórico (auditoria):** toda alteração é registrada com autor, antes e depois e motivo.
- **Gestão de acessos:** perfis `AGENTE`, `GESTAO`, `PENDENTE` e `BLOQUEADO`, além de superadministradores do WFM.

### Interface
- Aplicação de página única, com navegação entre abas sem recarregar.
- Modo escuro, animações e atualização dos dados sem "piscar" a tela.
- Janelas de confirmação, campo de data próprio e layout responsivo.

---

## Regras de negócio implementadas

Todas as regras são validadas **no servidor**. O navegador usa a mesma lógica só para dar retorno imediato.

| Regra | Descrição |
|---|---|
| **A — 5x2** | No máximo 5 dias de trabalho por semana (domingo a sábado). |
| **B — Domingo** | Folgas obrigatórias em domingos ao longo do mês. |
| **C — Seg. a sex.** | Quem tem esse regime não pode ser escalado no fim de semana. |
| **D — Domingos trabalhados** | No máximo 2 domingos trabalhados no mês. |
| **Prazo da troca** | Pedir e aceitar até 72 h antes do primeiro turno envolvido. |
| **Prazo da coordenação** | Aprovar até 24 h antes. Depois disso, a troca expira. |
| **Mesma atuação** | Só trocam entre si agentes com o mesmo horário e a mesma atuação. |
| **Trocas concorrentes** | Quando uma troca é aprovada, as outras pendentes que envolvem as mesmas pessoas e dias são canceladas automaticamente. |

---

## Arquitetura

```
┌──────────────────────────────┐        google.script.run         ┌───────────────────────────────┐
│  Front-end (HtmlService)     │ ───────────────────────────────▶ │  Back-end (Apps Script V8)    │
│  Index.html + UI*.html       │ ◀─────────────────────────────── │  Código.js, Escalas, Trocas…  │
│  SPA em JavaScript puro      │            JSON                  │  API "api*" com sessão        │
└──────────────────────────────┘                                  └───────────────┬───────────────┘
                                                                                  │
                     ┌────────────────────────────────────────────────────────────┼─────────────────────┐
                     ▼                                    ▼                       ▼                     ▼
          Google Sheets (banco)              CacheService / Properties        MailApp           Aba "FilaSlack"
   Pessoas, Usuarios, Escalas, Trocas,      sessões, memória entre             e-mails          lida pelo n8n →
   Afastamentos, Feriados, Logs…            chamadas, versões                   transacionais    DM no Slack
```

- **Banco de dados:** cada aba da planilha é uma tabela com cabeçalho fixo (`SCHEMA` em [`Código.js`](src/Código.js)). Os helpers `tabela_`, `appendLinhas_` e `atualizarLinha_` fazem o papel de uma camada de acesso a dados e só gravam as células que mudaram.
- **Concorrência:** as operações de escrita usam `LockService`, então duas pessoas aprovando ou trocando ao mesmo tempo não sobrescrevem uma à outra.
- **Desempenho:** cache em memória por execução e `CacheService` entre chamadas (sessões, elegibilidade, tabelas leves), com invalidação por versão quando uma aba muda.
- **Integração com o Slack:** o painel não chama o Slack diretamente. Ele grava a mensagem (texto e *blocks*) numa fila e um fluxo do **n8n** faz o envio. Assim nenhuma troca fica esperando uma API externa.
- **Composição do front-end:** o `Index.html` inclui cada módulo `UI*.html` em ordem. Cada módulo acrescenta ou estende telas, o que permitiu evoluir o painel em entregas pequenas.

### Segurança
- Senhas com **HMAC-SHA256 iterado**, salt por usuário e *pepper* guardado nas Script Properties. Nenhuma senha em texto puro.
- Tokens de sessão e de redefinição de senha são guardados **só como hash**, com expiração e opção "lembrar".
- Limite de tentativas de login com bloqueio temporário e limite de envio de links de senha por hora.
- Toda chamada de API valida a sessão e o perfil no servidor.
- Registro de segurança à parte (logins, falhas e trocas de senha).
- Nenhum segredo no código: IDs e chaves ficam em `PropertiesService`.

---

## Estrutura do projeto

```
src/
├── appsscript.json                      # manifesto (V8, Web App)
├── Código.js                            # configuração, esquema do banco, login, sessões, doGet
├── Escalas - Núcleo das Escalas.js      # planejamento, validação das regras, publicação, histórico
├── Trocas - Servidor das Trocas.js      # trocas entre agentes, reversão, feriados
├── Atuação - Importação e Minha Escala.js
├── Extras - Acessos e Planejamento.js
├── Escala05 … Escala27 *.js             # evoluções por tema (aprovação, presença, fila, exportação…)
├── Index.html                           # casca da SPA, tela de entrada, estilos-base
├── TrocasUI.html
└── UI02 … UI53 *.html                   # módulos de interface, incluídos em ordem pelo Index
```

A numeração dos arquivos (`Escala05`, `UI26`…) reflete a ordem em que as entregas foram feitas.

---

## Como executar

Pré-requisitos: uma conta Google e o [clasp](https://github.com/google/clasp).

```bash
npm install -g @google/clasp
clasp login
clasp create --type webapp --title "Painel de Escalas" --rootDir src
clasp push
```

1. No editor do Apps Script, execute `setup()`. A função cria a planilha-banco com todas as abas e grava `DB_ID` e `PEPPER` nas Script Properties.
2. Ajuste as listas de exemplo `ACESSO_INICIAL` e `COORDENACOES_INICIAIS` em `Código.js`.
3. Publique como **Web App** (Implantar → Nova implantação).
4. Opcional: configure a aba `Config` (`slack_ativo`, `email_trocas` etc.) e um fluxo n8n que leia a aba `FilaSlack`.

O arquivo [`.clasp.json.example`](.clasp.json.example) mostra o formato esperado do `.clasp.json`, que não é versionado.

---

## Tecnologias

Google Apps Script (V8) · Google Sheets · HtmlService · CacheService · LockService · PropertiesService · MailApp · JavaScript (ES5/ES6) · HTML5 · CSS3 · n8n · Slack Block Kit · clasp
