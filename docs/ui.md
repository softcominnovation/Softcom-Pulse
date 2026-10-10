# Interface do dashboard

`/` é o dashboard autenticado. O shell mantém marca Pulse, relógio de Fortaleza, modo TV, tela cheia e saída da sessão. A navegação contém apenas rotas implementadas. Não há sidebar, seletor de cenários simulados ou dados fictícios no aplicativo.

## Composição e dados

O browser usa o cliente axios autenticado para ler `GET /api/settings/presentation` e `GET /api/dashboard/overview?screenId=<uuid>`. Cada atualização da tela visível usa uma única leitura agregada de telemetria. Não consulta histórico, outros slides nem recursos individualmente. Contratos completos em [BFF](bff.md).

O documento `pulse_settings.dashboardPresentation` fornece ordem, telas habilitadas, blocos, larguras, layouts, `overviewGrid` e defaults. O renderer atende `summary`, `highlighted_resources`, `problems`, `asgard_summary`, `resource_card`, `host_inventory`, `container_inventory`, `uptime_list` e `signal_flow`. Respeita a ordem dos arrays; `standard`, `wide` e `full` ocupam respectivamente 4, 6 e 12 colunas de uma grade de 12 em overview e wall: três blocos padrão ou dois amplos por linha. Breakpoints menores reorganizam a grade até uma coluna sem remover conteúdo. Em overview, `overviewGrid: default` mantém o empilhamento atual; `split` reproduz a grade do protótipo: KPIs em cima e, abaixo, 2×2 com colunas `1.25fr | 1fr` — Disponibilidade | Problemas / ASGARD | Signal. Ao ativar o split, as fileiras de Disponibilidade passam a 2.

- Indicadores: até 4 cards do catálogo (`hosts`, `containers_running`, `containers_stopped`, `problems`, `jobs_waiting`), ordenáveis na apresentação. O padrão continua os quatro primeiros. **Jobs aguardando** soma outbox+inbox do primeiro Signal habilitado e mostra a idade do mais antigo; sem alvo, “—”.
- Recursos destacados: `visibleRows` 1 (padrão) ou 2 (até 8 cards). Preferências de status, health, CPU, memória, disco, rede e uptime. O BFF determina resolução, ordem e criticidade. Campos opcionais ausentes mostram o motivo em vez de zero. Cards Softcom Signal (`signalCards`) entram na mesma grade após Zabbix/aplicações/VPS, com faixa de `state` e sem reutilizar `reason` da sonda.
- Problemas: severidade original decrescente e, dentro dela, mais recentes primeiro; texto do estado, host e horário. Lista com rolagem interna.
- Asgard: estado do hipervisor, CPU/RAM, armazenamento e tabela compacta de VMs. Métricas ficam no topo, VMs abaixo em área limitada com rolagem interna e contador/legenda no rodapé. A ação “Ver ASGARD” abre `/asgard?hostKey=<chave>` com capacidades dos storages, horários, vínculo ao Agent, uptime e a tabela completa reaproveitada. O resumo omite colunas secundárias; elas continuam acessíveis no detalhe, inclusive no celular.
- Signal · fluxo: status, jobs do knowledge (em fila / rodando / pendentes), faixa de uptime no lugar do gráfico de volume do protótipo, linhas do pipeline (outbox/inbox/dead letter) e link **Ver métricas** para `/servicos#signal`. Sem inventar throughput de 30 min. Cadastro e métricas completas ficam em Serviços.

Templates com nome técnico iniciado por `tpl` ficam fora da tabela/contagem de VMs e dos problemas vinculados a esses templates. Métricas e storages gerais do ASGARD continuam integrais. O painel de problemas usa a descrição humanizada fornecida pelo BFF, quando comprovada pela identidade, e conserva o original em title; formatos desconhecidos permanecem originais. O total de problemas acompanha as entradas exibidas. Consulta separada de templates, labels, papéis Worker/Manager e limites das capacidades estão em [Templates](templates.md). Seu editor visual pertence às configurações da fase 08.

`usePoll` usa `refreshAfterMs` do overview e agenda o próximo ciclo após a resposta. Cliques repetidos não criam requests sobrepostas. Troca de tela/revisão e desmontagem abortam o pedido antigo; respostas tardias não pintam outra tela. Erro conserva o último payload da mesma tela, mostra aviso persistente e um toast por sequência de falhas. Sem primeira resposta, mostra erro com retry, sem KPIs inventados. A configuração é relida a cada 60s e ao voltar à aba, também sem sobreposição. Seus erros conservam a última revisão válida, sem gravar defaults para encobri-los.

## Distribuição compacta

A composição inicial coloca indicadores em uma faixa inteira, serviços destacados em outra faixa inteira acima e ASGARD/problemas lado a lado. ASGARD não ocupa sozinho uma linha desktop. Ordem e larguras continuam vindo do documento salvo, sem reordenação forçada no renderer. Composições personalizadas são preservadas. Cards de destaque usam espaçamentos menores, sem remover métricas habilitadas. Ausência de destaque tem mensagem curta e não reserva uma faixa alta vazia.

A página usa a largura disponível, com margens de 14–42px. A composição inicial controla alturas em desktops a partir de 1201×740: listas rolam internamente, mantendo os painéis principais visíveis. O contrato para um componente novo nessa rota está em [Encaixe da rota principal](overview-fit.md). O resumo ASGARD usa tabela de altura base 160px, ajustada ao espaço do painel; novas VMs não aumentam sua altura. Conteúdo não é descartado. Altura reduzida, zoom e composições diferentes podem exigir rolagem da página. Tablet usa duas colunas quando legível; até 850px, empilha. Não se aplica scale/zoom para encolher a interface.

Nos destaques, “Evidência” expande os horários e a qualidade de cada métrica por clique, teclado ou toque; o acionador tem pelo menos 44px de altura em dispositivos de toque. Valores e estados desconhecidos/desatualizados continuam identificados no resumo. A faixa permite rolagem interna quando a quantidade de recursos ou de métricas excede o espaço disponível. Em notebooks, a moldura e textos decorativos são reduzidos para manter nome, estado e primeiras métricas imediatamente visíveis.

`/asgard` usa o mesmo shell autenticado, com inventário e históricos reais sob demanda. O BFF identifica o hipervisor efetivo; sem resolução única, a UI pede escolha. Sem VM na URL, exibe os indicadores, storages e histórico do host. Nomes de VMs abrem o detalhe por pai/VM/janela: título, quatro cards superiores, gráfico e métricas passam a ser da VM, sem painéis do ASGARD misturados. CPU/vCPUs, memória, armazenamento e containers individualizados do Agent ocupam os cards; sem Agent, o card correspondente informa indisponibilidade. Seletor e períodos ficam no painel do gráfico, com métricas complementares sem repetir o topo; linha ativa acompanha a URL. As abas Infraestrutura e Asgard & VMs são separadas e não entram automaticamente no player. `/hosts/[hostKey]` mostra a perspectiva Agent. Regras de navegação, gráficos, cache, métricas e testes em [Infraestrutura](infrastructure.md). Não há histórico por linha da tabela.

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

## Entrada por inatividade

A configuração aplicada `idlePresentation` habilita um temporizador local somente no dashboard autenticado da raiz com tela utilizável. Padrão desligado, 5 minutos; faixa de 1–120 minutos. Eventos de ponteiro, toque, teclado, foco e rolagem reiniciam o período. Mudanças no DOM por relógio/telemetria/slides e polling da mesma configuração não contam como interação. Aba oculta e diálogos abertos suspendem; a retomada usa o período completo. Troca das opções efetivas reinicia a rotina; desativação, navegação e logout cancelam listeners, observação de diálogos, prazo e aviso.

Ao vencer, TV é ativado sem alterar a reprodução dos slides. Se `requestFullscreen=true`, tenta entrar uma vez; somente `document.fullscreenElement`/`fullscreenchange` comprovam fullscreen. Uma recusa apresenta um toast dispensável com ação explícita “Entrar em tela cheia”; não há retries a cada atualização nem entrada em um clique arbitrário. A Fullscreen API pode exigir ativação transitória por gesto, conforme [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen#security). A ativação automática aceita e a recusa são tratadas separadamente; um clique posterior usa a mesma API nativa dos controles.

Após a ativação, a rotina fica consumida até saída manual de TV/fullscreen ou mudança das opções. Interagir por si só mantém TV. Sair pelo botão, atalho ou Escape do fullscreen inicia um prazo novo e completo. Este cronômetro não é o da alternância de slides, não altera validade/coleta de evidências e não se aplica a prévias ou outras rotas.

A administração oferece **Como autorizar tela cheia automática** no painel Leitura no telão. O modal explica que a página interna do Chrome não adiciona sites comuns, mostra a origem atual e oferece um comando PowerShell para configurar a política no Windows. O comando inclui sempre `http://localhost:3000`, `https://dev-pulse.softcomtecnologia.com` e `https://pulse.softcomtecnologia.com`, preservando entradas existentes e sem duplicações. Origem exibida e verificação de permissão continuam referentes ao ambiente aberto; endereços adicionais não entram automaticamente no comando. Copiar não executa nem autoriza; o responsável aplica no usuário do telão com acesso administrativo, confere os três endereços em `chrome://policy` e verifica o estado no Pulse. Não usar link navegável para `chrome://settings`, prompt fictício ou clique simulado. Consulta sem suporte é distinta de permissão negada; falha de cópia seleciona o campo para cópia manual. A ajuda não grava preferências nem solicita fullscreen, acompanha mudanças/retorno à janela enquanto aberta e remove os listeners ao fechar. O temporizador da raiz permanece inalterado. Procedimento em [Administração](administration.md#ajuda-para-autorizar-no-chrome).

## Escala de leitura do telão

A marca no cabeçalho da raiz ganha destaque quando TV ou fullscreen está ativo: ícone de 37px para 57px, texto e espaçamento proporcionais; até 1200px de largura, ícone de 45px. No dashboard balanceado com largura >1200px e altura 740–900px, usa 43px e reduz o padding vertical do cabeçalho para preservar o espaço do rodapé. O crescimento máximo do ícone é 20px, sem padding adicional. Essa medida não é multiplicada pela escala de leitura nem pelos dois modos combinados. Ao sair de ambos, restaura o tamanho normal. Login, administração e detalhes mantêm a marca anterior. Não há preferência ou gravação nova.

`displayScalePercent` define 100%, 110%, 120% ou 125%, com default 110%, editável em `/admin/configuracoes`. A escala é aplicada apenas pelo shell da raiz quando `tvMode || isFullscreen`, sem multiplicação ao combinar os modos. Ao sair dos dois, retorna a 100%. Fullscreen acompanha `document.fullscreenElement`/`fullscreenchange`, inclusive saída pelo navegador; uma solicitação recusada não ativa a escala sozinha. F11/zoom externo do navegador não são tratados como fullscreen da aplicação.

A variável CSS `--dashboard-scale` coordena fontes, ícones, medidores, controles, espaçamentos e limites das listas. Não usa CSS `zoom`, `transform: scale`, alteração de fonte da raiz ou mudança do zoom do navegador. Fontes, paleta, raios e grade de 12 colunas são preservados: destaques em faixa inteira, dois blocos amplos ou três padrão por linha quando houver largura. O mínimo da grade ampliada impede que o rodapé se sobreponha aos painéis; quando faltar altura, admite rolagem da página e das listas, sem reduzir o percentual escolhido.

Outras rotas e diálogos não herdam a escala. A prévia administrativa tem escopo próprio, com seletor Normal/Telão, sem ampliar o formulário. A revisão aplicada pelo player atualiza a escala; revisão pendente, falha de leitura ou resposta cancelada não sobrescrevem a configuração em uso. Sair da rota desfaz TV/fullscreen e remove o escopo de tamanho.

## Qualidade e linguagem visual

Em `/admin/configuracoes`, a grade dos formulários alinha label/controle/ajuda entre colunas, com checkboxes avulsos na altura dos inputs e grupos de opções regulares. Ações de restauração ficam junto do campo e botões de salvamento no rodapé do painel; mobile reorganiza em coluna. “Salvar leitura do telão” grava somente escala e inatividade na apresentação compartilhada no banco, sem enviar rascunhos de telas/reprodução. A revisão confirmada é reutilizada no próximo salvamento; cancelar conserva o último telão salvo. O salvamento integral do rodapé continua disponível. Não há localStorage para essas preferências.

Fundo `#0c1116`, superfície `#121a21`, elevado `#18232c`, borda `#29343d`. Texto `#eef3f5`, secundários `#9daeb9`/`#82949f`. Estados usam verde `#64d6b0`, âmbar `#f2c275`, vermelho `#ff8585` e azul `#80bdf2`, sempre acompanhados de texto. Painéis/KPIs têm raio 14px, cards 9px, controles 7px e pílulas 5px. Botões usam a base shadcn/ui ajustada aos tokens Pulse.

Interface: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Números/horários: `ui-monospace, SFMono-Regular, Consolas, monospace`, tabulares. Sem fonte externa. Logo usa o asset oficial existente; a marca não é um ícone Lucide. O nome `softcom` foi preservado; somente `pulse` usa a cor institucional `#fba704`, conforme ajuste aprovado.

Status Docker e health são independentes. Em execução não significa saudável. Ausência de HEALTHCHECK comprovada é “Sem healthcheck”; ausência de evidência é “Desconhecido”, acompanhada do motivo quando informado. Ciclo falho/stale e `validUntil` vencido impedem pílula saudável. Valores antigos podem permanecer legíveis, identificados como desatualizados. O horário de coleta não substitui o da amostra.

Zero observado continua zero; null/missing/unsupported exibem ausência. Bytes usam unidades binárias, bits/s decimais, tempo ativo dias/horas/minutos. CPU acima de 100% preserva o valor numérico; somente a barra é limitada à largura disponível. Medidores SVG representam percentuais atuais válidos. Verde da série CPU, azul de RAM e âmbar de disco identificam a métrica, não um limiar de severidade. Não há sparkline sem série real, uPlot ou timeline sintética nesta tela.

## Responsividade e verificação

Grade, toolbar e botões quebram linha. Tabelas largas rolam internamente e recebem foco; o documento não exige rolagem horizontal. Alvos de toque têm pelo menos 44px. Foco permanece visível; seleção usa aria-pressed e navegação aria-current. Não há transição animada de slides; a preferência de movimento reduzido é respeitada pelos estilos globais. Legenda, atualização, pausa, seleção e saídas TV/fullscreen continuam alcançáveis no celular.

Testes de dashboard cobrem 320×568, 360×800, 390×844, 768×1024, 1024×768, 1366×768, 1920×1080, 2560×1440, 3440×1440 e 844×390; overview, wall e TV, toque, rolagem interna, zoom CSS de 200%, movimento reduzido e fullscreen em Chromium. Falhas, atrasos, revisões, leitura pausada, aba oculta, diálogo e logout também são exercitados. Duas/três apresentações são gravadas pelo BFF em PostgreSQL temporário, sem alterar a configuração do ambiente de desenvolvimento. O teste de fullscreen usa a saída pela API para verificar fullscreenchange; não substitui homologação de Escape físico em todos os navegadores/aparelhos.

Arquivos principais: `components/dashboard/dashboard.tsx`, `blocks.tsx`, `asgard-panel.tsx`, `asgard-details.tsx`, `resource-card.tsx`, `metrics.tsx`, `player-toolbar.tsx`, `display-controls.tsx`, `use-poll.ts` e `dashboard.css`; estado puro em `lib/dashboard/player.ts`, formatação em `lib/dashboard/format.ts`. Testes em `tests/dashboard.test.mjs` e `tests/e2e/dashboard.spec.ts`. Execução e isolamento em [Ambiente](environment.md).

Os editores `/admin/recursos` e `/admin/configuracoes` estão implementados, com opções v2 por bloco, prévia real, até três telas, revisão concorrente e templates. Regras, limites, acessibilidade e migração em [Administração](administration.md). Integrações funcionais WhatsApp/Meta, Signal, n8n, Hub/Shop e simulações continuam após o MVP.

## Serviços, containers e alertas

`/servicos` usa a composição de tabela e diálogo do protótipo, com scroll vertical normal. O inventário agregado agrupa por host e distingue recursos individualizados de contadores totais do Docker. Nome/imagem, estado, health, CPU, memória, reinícios e evidência aparecem na tabela; “Mais dados” expande capacidades, rede e uptime. Não faz consulta por linha nem cria linhas a partir de totais. Campos ausentes não viram zero. O detalhe Agent reutiliza essa lista em “Containers do Agent”.

O estado Docker cobre Em execução, Parado, Pausado, Reiniciando, Criado, Em remoção, Encerrado com falha e Sem estado atual. Health é independente: Saudável, Iniciando, Falha no healthcheck, Sem healthcheck ou Health desconhecido. Evidência vencida nunca mantém confirmação verde. Um container parado pode conservar health antigo saudável, sem alterar o estado Parado. Motivos unsupported/missing/stale ficam explícitos.

Cards de recursos configurados mantêm flags de presentation e abrem detalhes com fonte, identidade, evidência e métricas habilitadas. Configuração desabilitada é identificada; alvo ausente ou ambíguo conserva o nome e explica a resolução. Criticidade afetada realça o card sem habilitar métrica oculta. Não há CRUD ou ação operacional nesta vista.

Histórico carrega ao abrir um detalhe resolvido e ao trocar 1h/24h/7d, sem polling periódico. CPU/RAM/rede e outras métricas habilitadas usam uPlot, separadas por unidade. Health/status usam barras SVG com texto, intervalo e evidência acessíveis por toque e controle de teclado. Unknown/lacunas permanecem neutros, not_configured não é sucesso; stopped é vermelho na trilha de estado. Erro preserva a leitura da mesma seleção e oferece retry. Não há histórico automático nos cards do dashboard nem na lista de containers.

Problemas usam um helper compartilhado de seis severidades: Não classificado, Informação, Atenção, Média, Alta e Desastre. Mantêm severidade original, descrição e horário, ordenados por severidade e início. A vista completa oferece a descrição original expandida quando houver texto humanizado. Não executa acknowledgement, encerramento ou notificação externa.

O bloco `container_inventory` é elegível no catálogo/overview/player, com lista atual e scroll interno. Não altera as telas salvas nem adiciona `/servicos` à alternância. A faixa de destaques e os painéis compactos ASGARD/problemas permanecem no lugar.

## Modal de workloads por VM

Cada linha das tabelas detalhadas do ASGARD e da VM possui “Ver serviços”, com nome acessível “Serviços e containers de <VM>” e alvo de 44px. Abre a VM daquela linha sem mudar URL, gráfico ou seleção. O nome continua link independente. A tabela compacta da raiz não recebe essa ação adicional.

O modal chama apenas o wrapper por pai/VM documentado no [BFF](bff.md). Valida a identidade retornada e apresenta ausência de vínculo, host indisponível, ausência de snapshot e descoberta vazia como situações distintas. Serviços resolvidos são labels junto do container, inclusive desabilitados; configurações ausentes/ambíguas ficam em seção própria. Não inventa systemd, stacks ou réplicas desejadas.

Atualização segue refreshAfterMs somente enquanto aberto e visível, sem sobreposição. Fechar/trocar/navegar/desmontar cancela pedidos e timers; respostas antigas não aparecem em outra VM. Falha mantém somente o resultado da mesma identidade, com aviso persistente, retry e toast não repetido por ciclo. Atualização não recria expansões nem redefine foco/scroll.

Diálogos Radix mantêm foco contido, Escape e retorno ao acionador; se a linha deixou de existir, o foco retorna à região estável da tabela. Cabeçalho/fechar permanecem fora do corpo rolável. O detalhe com gráfico pode ter 920px; o inventário de workloads, 1240px, ambos limitados ao espaço disponível por percentuais, inclusive com zoom CSS de 200%. São extensões de largura para dados reais; cores, bordas, tipografia, paddings e hierarquia seguem o diálogo do protótipo. Tabelas possuem rolagem interna e todas as ações continuam acessíveis no celular. A matriz de Serviços/modais foi verificada de 320px a 1920px, incluindo tablet, paisagem, toque e teclado; homologação física adicional permanece separada.

Implementação em `components/services`, com estados/rótulos em `lib/services/presentation.ts`, wrapper em `lib/server/monitoring/vm-workloads.ts` e testes em `tests/e2e/services.spec.ts` e na integração de configuração. Nenhuma migration, alteração de credenciais ou escrita externa é necessária.
