# Interface do dashboard

`/` é o dashboard autenticado. O shell mantém marca Pulse, relógio de Fortaleza, modo TV, tela cheia e saída da sessão. A navegação contém apenas rotas implementadas. Não há sidebar, seletor de cenários simulados ou dados fictícios no aplicativo.

## Composição e dados

O browser usa o cliente axios autenticado para ler `GET /api/settings/presentation` e `GET /api/dashboard/overview?screenId=<uuid>`. Cada atualização da tela visível usa uma única leitura agregada de telemetria. Não consulta histórico, outros slides nem recursos individualmente. Contratos completos em [BFF](bff.md).

O documento `pulse_settings.dashboardPresentation` fornece ordem, telas habilitadas, blocos, larguras, layouts e defaults. O renderer atende `summary`, `highlighted_resources`, `problems`, `asgard_summary` e `resource_card`. Respeita a ordem dos arrays; `standard`, `wide` e `full` ocupam respectivamente 4, 6 e 12 colunas de uma grade de 12 em overview e wall: três blocos padrão ou dois amplos por linha. Breakpoints menores reorganizam a grade até uma coluna sem remover conteúdo.

- Indicadores: hosts conhecidos/alcançáveis, VMs, containers em execução/parados e problemas/recursos críticos afetados.
- Recursos destacados e cards individuais: preferências de status, health, CPU, memória, disco, rede e uptime. O BFF determina resolução, ordem e criticidade. Campos opcionais ausentes mostram o motivo em vez de zero.
- Problemas: severidade original decrescente e, dentro dela, mais recentes primeiro; texto do estado, host e horário. Lista com rolagem interna.
- Asgard: estado do hipervisor, CPU/RAM, armazenamento e tabela compacta de VMs. Métricas ficam no topo, VMs abaixo em área limitada com rolagem interna e contador/legenda no rodapé. A ação “Ver ASGARD” abre `/asgard?hostKey=<chave>` com capacidades dos storages, horários, vínculo ao Agent, uptime e a tabela completa reaproveitada. O resumo omite colunas secundárias; elas continuam acessíveis no detalhe, inclusive no celular.

Templates com nome técnico iniciado por `tpl` ficam fora da tabela/contagem de VMs e dos problemas vinculados a esses templates. Métricas e storages gerais do ASGARD continuam integrais. O painel de problemas usa a descrição humanizada fornecida pelo BFF, quando comprovada pela identidade, e conserva o original em title; formatos desconhecidos permanecem originais. O total de problemas acompanha as entradas exibidas. Consulta separada de templates, labels, papéis Worker/Manager e limites das capacidades estão em [Templates](templates.md). Seu editor visual pertence às configurações da fase 08.

`usePoll` usa `refreshAfterMs` do overview e agenda o próximo ciclo após a resposta. Cliques repetidos não criam requests sobrepostas. Troca de tela/revisão e desmontagem abortam o pedido antigo; respostas tardias não pintam outra tela. Erro conserva o último payload da mesma tela, mostra aviso persistente e um toast por sequência de falhas. Sem primeira resposta, mostra erro com retry, sem KPIs inventados. A configuração é relida a cada 60s e ao voltar à aba, também sem sobreposição. Seus erros conservam a última revisão válida, sem gravar defaults para encobri-los.

## Distribuição compacta

A composição inicial coloca indicadores em uma faixa inteira, serviços destacados em outra faixa inteira acima e ASGARD/problemas lado a lado. ASGARD não ocupa sozinho uma linha desktop. Ordem e larguras continuam vindo do documento salvo, sem reordenação forçada no renderer. Composições personalizadas são preservadas. Cards de destaque usam espaçamentos menores, sem remover métricas habilitadas. Ausência de destaque tem mensagem curta e não reserva uma faixa alta vazia.

A página usa a largura disponível, com margens de 14–42px. A composição inicial controla alturas em desktops a partir de 1201×740: listas rolam internamente, mantendo os painéis principais visíveis. O resumo ASGARD usa tabela de altura base 160px, ajustada ao espaço do painel; novas VMs não aumentam sua altura. Conteúdo não é descartado. Altura reduzida, zoom e composições diferentes podem exigir rolagem da página. Tablet usa duas colunas quando legível; até 850px, empilha. Não se aplica scale/zoom para encolher a interface.

Nos destaques, “Evidência” expande os horários e a qualidade de cada métrica por clique, teclado ou toque; o acionador tem pelo menos 44px de altura em dispositivos de toque. Valores e estados desconhecidos/desatualizados continuam identificados no resumo. A faixa permite rolagem interna quando a quantidade de recursos ou de métricas excede o espaço disponível. Em notebooks, a moldura e textos decorativos são reduzidos para manter nome, estado e primeiras métricas imediatamente visíveis.

`/asgard` usa o mesmo shell autenticado e lê o inventário pelo BFF existente, com poll cancelável, retry, retenção identificada da última leitura e atualização da qualidade. O link passa a chave do host; sem parâmetro, usa o primeiro hipervisor do escopo. Não há histórico por linha. A implementação anterior tinha medidores atuais, não um gráfico histórico já concluído; estes foram reaproveitados. Histórico real sob demanda será acrescentado na fase 06.

O contador informa VMs em execução com evidência atual, total operacional e quantidade sem estado atual. Templates não entram. Storages não são somados sem comprovação de independência; disco da VM só aparece se o contrato trouxer a métrica, identificado como perspectiva do hipervisor. Não equivale ao filesystem do Agent. Séries ilustrativas do protótipo não são reproduzidas.

## Apresentação

| Controle | Comportamento |
|---|---|
| 1 · Visão geral | Formato overview na tela atual; interrompe alternância |
| 2 · Tela completa | Formato wall na tela atual; interrompe alternância |
| 3 · Alternância / Alternar telas | Reproduz a sequência habilitada, usando o layout salvo de cada tela |
| Parar alternância | Interrompe na tela atual |
| Seletor, anterior e próxima | Escolhem uma tela e pausam a leitura automática |
| Continuar alternância | Retoma com intervalo completo |
| Modo TV / Sair do modo TV | Aumenta textos do conteúdo e reduz decoração; preserva controles e informações |
| Tela cheia / Sair da tela cheia | Fullscreen API no documentElement por gesto; evento fullscreenchange sincroniza a saída pelo navegador |

Overview/wall, TV e fullscreen são independentes e combináveis. Uma tela apta permanece estática; a alternância fica desabilitada com explicação. Duas ou três usam ordem e duração salvas, voltam à primeira e repetem. Falha ou ausência de telemetria não pula slide. Sem composição utilizável, apresenta erro de configuração com ação de recarga.

Atalhos: **T** para TV, **F** para fullscreen, **R** para alternar/parar. Campos de edição, seletores, contenteditable, diálogos, teclas modificadoras e repetição automática não acionam esses atalhos. Fullscreen recusado ou indisponível gera aviso; TV, conteúdo e player continuam utilizáveis.

Toque, rolagem ou foco no conteúdo pausam até Continuar. Aba oculta e diálogo aberto suspendem a contagem; ao voltarem, retomam com intervalo completo, salvo pausa de leitura/parada manual. A mudança de slide preserva o shell e fullscreen. Ao sair da rota, requests, temporizador e listeners são encerrados; TV e fullscreen são desfeitos.

Defaults de TV/autoStart valem na abertura. Depois disso, preferências locais não escrevem no PostgreSQL. Nova revisão é aplicada no limite do slide ou na retomada da leitura; aviso informa revisão pendente. Fora da reprodução, uma seleção manual pausada oferece “Aplicar configuração atualizada”. Tela removida/desabilitada é substituída imediatamente pela primeira apta, com aviso. Uma alteração remota nunca reinicia uma reprodução parada localmente.

## Qualidade e linguagem visual

Fundo `#0c1116`, superfície `#121a21`, elevado `#18232c`, borda `#29343d`. Texto `#eef3f5`, secundários `#9daeb9`/`#82949f`. Estados usam verde `#64d6b0`, âmbar `#f2c275`, vermelho `#ff8585` e azul `#80bdf2`, sempre acompanhados de texto. Painéis/KPIs têm raio 14px, cards 9px, controles 7px e pílulas 5px. Botões usam a base shadcn/ui ajustada aos tokens Pulse.

Interface: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Números/horários: `ui-monospace, SFMono-Regular, Consolas, monospace`, tabulares. Sem fonte externa. Logo usa o asset oficial existente; a marca não é um ícone Lucide.

Status Docker e health são independentes. Em execução não significa saudável. Ausência de HEALTHCHECK comprovada é “Sem healthcheck”; ausência de evidência é “Desconhecido”, acompanhada do motivo quando informado. Ciclo falho/stale e `validUntil` vencido impedem pílula saudável. Valores antigos podem permanecer legíveis, identificados como desatualizados. O horário de coleta não substitui o da amostra.

Zero observado continua zero; null/missing/unsupported exibem ausência. Bytes usam unidades binárias, bits/s decimais, tempo ativo dias/horas/minutos. CPU acima de 100% preserva o valor numérico; somente a barra é limitada à largura disponível. Medidores SVG representam percentuais atuais válidos. Verde da série CPU, azul de RAM e âmbar de disco identificam a métrica, não um limiar de severidade. Não há sparkline sem série real, uPlot ou timeline sintética nesta tela.

## Responsividade e verificação

Grade, toolbar e botões quebram linha. Tabelas largas rolam internamente e recebem foco; o documento não exige rolagem horizontal. Alvos de toque têm pelo menos 44px. Foco permanece visível; seleção usa aria-pressed e navegação aria-current. Não há transição animada de slides; a preferência de movimento reduzido é respeitada pelos estilos globais. Legenda, atualização, pausa, seleção e saídas TV/fullscreen continuam alcançáveis no celular.

Testes de dashboard cobrem 320×568, 360×800, 390×844, 768×1024, 1024×768, 1366×768, 1920×1080, 2560×1440, 3440×1440 e 844×390; overview, wall e TV, toque, rolagem interna, zoom CSS de 200%, movimento reduzido e fullscreen em Chromium. Falhas, atrasos, revisões, leitura pausada, aba oculta, diálogo e logout também são exercitados. Duas/três apresentações são gravadas pelo BFF em PostgreSQL temporário, sem alterar a configuração do ambiente de desenvolvimento. O teste de fullscreen usa a saída pela API para verificar fullscreenchange; não substitui homologação de Escape físico em todos os navegadores/aparelhos.

Arquivos principais: `components/dashboard/dashboard.tsx`, `blocks.tsx`, `asgard-panel.tsx`, `asgard-details.tsx`, `resource-card.tsx`, `metrics.tsx`, `player-toolbar.tsx`, `display-controls.tsx`, `use-poll.ts` e `dashboard.css`; estado puro em `lib/dashboard/player.ts`, formatação em `lib/dashboard/format.ts`. Testes em `tests/dashboard.test.mjs` e `tests/e2e/dashboard.spec.ts`. Execução e isolamento em [Ambiente](environment.md).

O editor das configurações permanece previsto para a fase 08. O contrato atual ainda é schemaVersion 1, sem options por bloco. A evolução de filtros, ordenação, limites de linhas e quantidade por tela será entregue junto do editor; não confundir a especificação futura com opções já disponíveis. Inventários ampliados e histórico ficam nas fases 06/07; a rota ASGARD atual já reutiliza os detalhes existentes. WhatsApp/Meta, Signal, n8n, Hub/Shop e simulações ficam após o MVP. Não criar links sem destino implementado nem inferir dados dessas fontes.
