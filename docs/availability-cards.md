# Minicards de Disponibilidade de Serviços

O tamanho e a janela pertencem ao bloco de cada tela. Automático ou 1/2/3 fileiras mantém a precedência descrita abaixo; a contagem é um limite, sem reservar fileiras vazias quando há poucos cards. Ocultar outros painéis elimina suas fileiras da composição. Quando há dois blocos do mesmo tipo em Duas colunas, cada UUID tem sua própria posição e opções, sem sobreposição. Os painéis restantes ocupam a altura útil e a composição rola quando os mínimos e as fileiras completas não cabem. Consulte [encaixe](overview-fit.md).

Disponibilidade tem uma única região rolável: `.availability-grid`. Cabeçalho e rodapé ficam fora dela; o painel não cria outra rolagem. No clássico, a grade é filha direta de `.availability-panel`, como no React, sem o wrapper rolável genérico `.panel-content`.

| Perfil | Janela de 2 fileiras | Janela de 3 fileiras |
|---|---|---|
| Padrão | 256px | 384px |
| Ampliado | 296px | 444px |

São medidas lógicas da janela, com passo de 128/148px por fileira; preservam-se a folga legada de 2px quando aplicável e os fatores de escala/zoom já vigentes. Cabeçalho, rodapé, margens, bordas e padding da fileira entram separadamente no orçamento do painel. Com a quantidade exata de fileiras, os cards cabem sem overflow; a fileira excedente rola somente nessa grade. A falta de altura para toda a composição é tratada pelo shell, mantendo a janela de cards completa e os demais painéis acessíveis.

Storage usa `kind:storage` e UUID da preferência, disponível após configurar a máquina em Serviços. Default inclui os destacados após as famílias anteriores, com ordem interna e criticidade; custom aceita configuração sem destaque. Preserva 120px no perfil Padrão e acompanha a caixa comum no Ampliado, com CPU e disco ocupado (%) por padrão. O seletor de métricas permite os outros pares e CPU/RAM/disco, sempre usando a capacidade selecionada e a cor âmbar de disco. No rodapé, RX e TX vêm da interface já escolhida em Serviços, separados e com suas unidades; uptime/leitura ficam na dica e no detalhe. Ausência é “—”, zero é zero e dado antigo mantém identificação. O trio explícito coloca disco inteiro acima de CPU/RAM; não acrescenta faixa de uptime. Abre o painel compartilhado sob demanda, com link por storageKey para Serviços e equivalente público. Disponibilidade usa o mesmo helper do painel. Referência órfã conserva estado neutro; sem preferência recuperável, aplica a política de omissão do custom. Detalhes em [Storage](storage.md).

Construção visual pelo [Design system Kobra](design-system.md). Os tokens Pulse abaixo acompanham o tema; cores fixas remanescentes das faixas são paletas de telemetria, não a paleta global.

A grade **Disponibilidade de Serviços** é um único grid. No modo **default** do bloco entram as origens globais nesta ordem: recurso Zabbix destacado, aplicação da sonda, VPS destacada e Signal destacado. No modo **custom**, a ordem é a lista `cards` daquele bloco (`kind:uuid`). Um serviço novo que também apareça aqui entra nessa mesma grade, com o mesmo retângulo. O miolo muda conforme a leitura que o serviço tem. A caixa é uniforme dentro do perfil escolhido.

## Perfis de tamanho por bloco

Em Configurações → tela → **Serviços destacados**, **Tamanho dos minicards** oferece **Padrão** (`compact`, default, antes chamado Atual) e **Ampliado** (`expanded`). A preferência pertence ao bloco, em `highlighted_resources.options.cardSize`, e usa o JSON/revisão existentes. Sem o campo, o leitor aplica Padrão em memória. **Ver prévia** não grava; **Salvar apresentação** compartilha a escolha. O perfil escolhido vale também para cards com três métricas: Padrão tem 120px e Ampliado 140px, sem promoção automática. Métricas e fileiras permanecem preservadas.

No Ampliado, todas as famílias da grade usam a mesma caixa de **140px**, nome de **15px**, estado/descrição/rodapé/leituras de **11px** (line-height de 14px) e medidores de **4px**. Faixas continuam com 40 posições e passam a 20px de altura. Valores longos usam reticências/detalhe; estado, nome e ação conservam seu significado. Painéis grandes, detalhes e minicards fora desse contexto continuam com o envelope atual.

A largura confortável inicial é **260px**. A faixa inteira calcula colunas pela largura útil e distribui a sobra entre elas, inclusive colunas vazias, para um serviço isolado não preencher o painel inteiro. Em split e no par Disponibilidade/Problemas com Storage, há no máximo **três colunas**, reduzidas para duas/uma conforme o contêiner, inclusive sua scrollbar. Não são alteradas as larguras salvas dos blocos.

A prévia isolada do editor de recurso conserva até **230px** para um par e **260px** para o trio, com altura de 120/140px respectivamente. A expansão horizontal pertence à grade/grupo de cards, não ao formulário inteiro. Não usar um seletor combinado que aplique `max-width: none` também ao card isolado com três métricas.

**Isolamento por bloco:** a renderização React obtém as opções do bloco na tela ativa de `dashboardPresentation`, identificado por UUID e tipo; o overview fornece a evidência correspondente. Opções ausentes no payload de evidências não podem substituir a configuração salva por defaults. KPIs, perfil e fileiras de uma tela não são preferências globais nem são herdados da primeira tela. O renderer clássico usa a mesma precedência. Troca, cache, recarga e reordenação devem conservar esse vínculo; o limite atual continua sendo três telas.

As medidas ampliadas de caixa, fontes, barras, gaps e paddings acompanham `--dashboard-scale` uma única vez na apresentação privada. No `/monitor`, o fator permanece 1 e o zoom público atua pela camada existente. `availability-sizing.ts` concentra altura, largura confortável, gap e contas de orçamento. O clássico recebe o perfil no HTML inicial, mantém fontes maiores nas atualizações e recalcula colunas em ES5 usando a largura efetiva.

**Proporção e zoom:** `dashboardZoomPercent`, campo **Zoom inicial da Visão geral (%)**, controla somente a raiz `/`; `publicMonitorZoomPercent`, campo **Zoom inicial do /monitor (%)**, controla somente `/monitor`. Ambos aceitam 50–150, padrão 100, e atuam uma vez sobre os aumentos locais dos cards e textos dos KPIs. Com 70%, o card Ampliado de 140px aparece com 98px, e seu nome de 15px com 10,5px. A compensação de largura/altura lógica mantém o preenchimento do viewport. Na raiz, a escala privada de TV/fullscreen continua dentro do zoom próprio; normal mantém esse fator em 1. Detalhes e administração não herdam esses zooms.

**Fileiras visíveis**, no mesmo editor, oferece **Automático**, **1**, **2** ou **3 fileiras completas**. A escolha manual tem prioridade sobre os KPIs e a largura, nos perfis Padrão e Ampliado. Pode mostrar três com KPIs, três na faixa inteira ou uma no split. A preferência é por bloco/tela e compartilhada com raiz, monitor e prévia; **Salvar apresentação** publica, enquanto Salvar leitura do telão conserva o rascunho dos blocos.

O JSON reutiliza `visibleRows` como contagem e usa `rowMode: manual | auto` para distinguir a seleção nova do comportamento legado. Em Automático explícito, são duas fileiras no dividido com KPIs, três sem KPIs e duas na faixa inteira. Documentos sem `rowMode` preservam suas regras anteriores: Ampliado automático e Padrão com limites/compactação legados. Não há escrita durante leitura/medição. Trocar perfil ou grade preserva uma seleção manual. Com menos cards, não reserva fileiras vazias.

A conta ampliada usa card de 140px, gap de 8px e padding real. Seleções explícitas no Padrão usam 120px com gap/padding de 8px, sem a reserva legada de duas linhas no split ou a compactação de 130px. Fileiras com Storage e o clássico medem a altura natural das grades Ampliadas ou com modo explícito. Quando a janela completa e os mínimos inferiores não cabem, a composição inteira rola dentro do shell, preservando os dados e a legenda; não corta cards nem reduz a quantidade manual para simular encaixe. A prévia indica quando a composição precisa rolar. O trio adapta seu espaçamento ao perfil do bloco; não muda `cardSize`, colunas ou fileiras.

## A grade do perfil Padrão

Classe `availability-grid`.

- Colunas: `repeat(auto-fill, minmax(min(100%, 230px), 230px))`.
- Espaço entre cards: 8px.
- Alinhamento: à esquerda, sem esticar o card para preencher a linha.
- Altura máxima legada: até duas linhas, com as compactações existentes. Com seleção explícita, a janela de 1–3 linhas usa `fileiras × 128px`, preservando cards completos e rolagem apenas na próxima fileira.

O card novo não altera essas medidas. Não cria uma segunda grade ao lado.

Exceção existente: em `overviewGrid: split`, `.overview-split-grid .availability-grid` usa quatro colunas elásticas e os cards ocupam a largura da coluna (`max-width: none`). A altura dos cards continua 120px. Essa regra de quatro colunas não possui override móvel próprio em `availability.css`; não presumir que empilhar os painéis também reduz suas colunas internas. Reutilizar a grade atual, sem impor largura fixa por componente que quebre esse modo.

## A caixa do perfil Padrão, comum às famílias

Classe `availability-card`. Todo card da grade usa esta classe.

| Parte | Medida |
|---|---|
| Largura | até 230px |
| Altura | 120px fixos (`height`, `min-height` e `max-height`) |
| Padding do card de recurso | 10px 12px |
| Padding do card com faixa | 8px 12px, pela classe `probe-card` |
| Raio | 9px |
| Borda | 1px `var(--pulse-line)` |
| Fundo | `var(--pulse-service)`; hover `var(--pulse-hover)` |
| Direção | coluna, `overflow: hidden` |

De cima para baixo, todo card tem cabeçalho, descrição e miolo com rodapé:

1. **Nome e estado.** `AvailabilityCardHeader` coloca `availability-name` à esquerda e o badge `availability-state status-pill` à direita. Nome de 13px no Padrão e 15px no Ampliado, com reticências e título completo. O badge conserva o estado e usa os mesmos fundos semânticos dos painéis: verde, âmbar, vermelho ou neutro. Nome e badge não se sobrepõem.
2. **Descrição.** Classe `availability-description`, 10px, cor muted, uma linha com reticências.
3. **Miolo preso embaixo.** `margin-top: auto`. É a única zona que muda entre os tipos. Termina no rodapé.

O card é um `button` quando abre detalhe. O nome acessível diz o nome, o estado e, quando há faixa, a disponibilidade. O foco usa `var(--ring)` de 2px por dentro do card.

O card de container do cluster Signal (`signal_service`) usa o mesmo envelope. O estado vem do container resolvido pelo prefixo nas VMs vinculadas ao alvo, não do `/health/ready`. Sem `flowKpi`, a fileira Em fila / Rodando / Pendentes do bloco `signal_flow` permanece em três colunas. Com Banco e/ou Redis, esses blocos entram na mesma fileira e os três KPIs dividem a largura. Crítico é propriedade do cadastro e segue a política de notificações já existente. A ausência do container só vira Fora quando houver cobertura Docker integral; neste ambiente a cobertura publicada é `coverage_unavailable`, então o sumiço fica Sem leitura.

## Os dois miolos que já existem

### Recurso do Zabbix

Componente `ServiceAvailabilityCard`. Só a classe `availability-card`.

O miolo usa duas ou três leituras, classe `availability-readings`. O seletor único **Métricas do minicard** em Recursos oferece CPU/RAM, CPU/Disco, Disco/RAM ou **CPU, RAM e Disco**, gravando `presentation.cardMetrics`. Pares conservam sua ordem e metades; somente no trio o disco ocupa a linha superior inteira e CPU/RAM ficam abaixo. Não há checkboxes duplicados de CPU/memória/disco para hosts. Recursos e Alertas e exibição da VM salvam essa mesma escolha e sincronizam `showCpu`/`showMemory`/`showDisk` para compatibilidade, sem seleções contraditórias. Cada leitura tem rótulo, valor tabular de 10px e barra de 3px: CPU verde, RAM azul, disco âmbar. Cadastros sem par explícito continuam respeitando suas flags, limitadas a duas leituras; Disco marcado tem prioridade sobre RAM quando CPU também está marcada. Sem leituras, a zona mostra **Ver detalhes**. Abrir um par legado no editor só o adota no rascunho, sem gravar automaticamente.

CPU/RAM do card de recurso Zabbix seguem `presentation.metricsSource` do recurso (Recursos → editar host): padrão **hypervisor** (mesma fonte da listagem de VMs do Asgard); opcional **agent**. A lista de VMs do Asgard não muda.

Prévia e dashboard usam `resolveAvailabilityCardMetrics`, sem fallback posterior no componente. Com configuração de monitoramento do Agent, Disco usa somente a capacidade selecionada e o vínculo válido; falta de seleção, volume, vínculo ou leitura atual mostra **—**, sem substituir pela raiz. Sem configuração de monitoramento, o recurso avulso pode exibir o percentual observado de `/`, ou a métrica percentual do host quando não há raiz no inventário; a dica identifica a origem e não anuncia total geral. A preferência de CPU/RAM não muda essa origem. Zero observado aparece como **0%**; bytes não viram percentuais. `cardDiskLabel` é metadado opcional de apresentação do BFF, sem nova configuração no banco, nomes técnicos de volumes ou regras privadas, e preserva a mesma indicação no leitor público.

A altura permanece **120px**, com nome, descrição e rodapé visíveis. Estado, rede e tempo ativo mantêm suas opções de exibição; a escolha das métricas do host existe somente no seletor. Containers conservam seus controles e CPU/RAM: sua flag de disco não vira medidor de capacidade de uma VM. A dica de disco é discreta, sem faixa permanente ou alteração de grade.

O rodapé, classe `availability-footer`, fica abaixo das barras. À esquerda, o tipo (Host, Container ou o tipo cadastrado). À direita, o tempo ativo ou o horário da leitura. Uma métrica só.

O clique abre o detalhe do serviço, não um modal curto.

### Presença: aplicação e VPS

Componentes `ProbeAvailabilityCard` e `VpsAvailabilityCard`. Classes `availability-card probe-card`. A VPS acrescenta `vps-card-highlight`, sem mudar a caixa.

O miolo é a classe `probe-card-uptime`: a faixa e, debaixo dela, o rodapé. O espaço entre a faixa e o rodapé é 7px. O rodapé não ganha margem extra.

A faixa usa `ProbeStrip`, 40 retângulos, sempre. As consultas reais ocupam da esquerda para a direita. O restante fica cinza `#9daeb9` com opacidade 0.35. No card, a faixa tem 16px de altura. Não estique 1 ou 4 amostras para preencher os 230px: os 40 lugares existem mesmo vazios.

O rodapé continua sendo uma linha com borda superior. À esquerda, a identidade curta e um dado auxiliar. À direita, um único número.

| Card | Esquerda | Direita |
|---|---|---|
| Aplicação | tipo, ou **Aplicação**, e a latência | disponibilidade em 24h |
| VPS | **VPS ·** o IP | disponibilidade das posições visíveis da faixa |

A aplicação usa as cores da sonda. A VPS passa `colorFor`, porque os motivos numéricos dela não são os da sonda. Um serviço novo que reutilize a faixa informa o próprio mapa de cor. Não reuse o mapa da sonda se o número não significar a mesma coisa.

A VPS mantém a faixa por padrão (`cardMetrics: null`). Em seu editor, **Métricas do minicard** oferece os três pares e o trio, usando somente `cpuPercent`, `memoryPercent` e `diskPercent` do monitor. Escolha explícita mantém o selo/rodapé e troca o miolo; sem monitor, pausa, falha ou leitura vencida, os campos ficam **—**. A janela de leitura é de até seis minutos (três ciclos do maior intervalo suportado), sem mudar estado/alertas do monitor. Voltar para **Faixa de disponibilidade (atual)** salva null; omitir o campo em um PATCH conserva a seleção anterior.

O clique da aplicação abre o modal de histórico. O clique da VPS abre o modal curto: estado, IP, três medidores (CPU geral, RAM e disco) e o link para o detalhe. Os núcleos ficam no detalhe, não no card nem nesse modal.

## Cores de estado

| Tom | Uso no card | Token |
|---|---|---|
| `good` | disponível, no ar | `--pulse-green` → `--success` |
| `warn` | atenção, lento | `--pulse-amber` → `--warning` |
| `bad` | fora, indisponível | `--pulse-red` → `--error` |
| `unknown` | sem dados, pausado, inativo, monitor ausente | `--pulse-muted` → `--muted-foreground` |

A barra de RAM usa `--pulse-blue` → `--info`. A faixa não troca para vermelho só porque o percentual subiu. O estado do texto é que carrega o tom. As faixas SVG ainda recebem cores fixas de seus helpers (`#64d6b0`, `#f2c275`, `#ff8585`, ausência `#9daeb9`); preservar a distinção entre mapa da série e tokens do texto.

## Especificação para o próximo card

Os valores numéricos abaixo descrevem o perfil Padrão. Dentro de um bloco Ampliado, reutilizar as mesmas classes de conteúdo e deixar o contexto aplicar o envelope ampliado; não fixar 120px por família nem repassar o perfil para dentro dos detalhes/modais.

O serviço que for exibido nesta grade implementa um componente no mesmo grid, nesta ordem de blocos. Não inventa largura, altura, raio ou uma terceira fileira de rodapé.

1. Use `availability-card`. Se a leitura principal for uma faixa de consultas, use também `probe-card`. Se for CPU e RAM no estilo do Zabbix, use só `availability-card` e `availability-readings`.
2. Mantenha altura 120px e largura usual até 230px, aceitando a largura elástica do split pelo CSS existente. Texto que não cabe leva reticências. Não aumente a altura do card para caber uma linha a mais.
3. Estado, nome e descrição permanecem nas três primeiras linhas, com as classes atuais.
4. O miolo fica em `margin-top: auto`, para o rodapé encostar na base com o mesmo respiro dos cards atuais.
5. O rodapé é a última linha, com `availability-footer`: borda superior, espaço entre as pontas, texto muted à esquerda, um número tabular à direita. Sem leitura, o número é **—**.
6. Faixa, quando existir, tem 40 posições e 16px no card. Posição vazia é cinza a 0,35 de opacidade. Pausado e inativo desenham a faixa vazia, sem pintar de vermelho.
7. O clique abre detalhe ou modal. O card em si não vira a tela de detalhe. Métrica que não cabe nas quatro linhas vai para o modal ou para a rota de detalhe.
8. O nome acessível inclui o nome do item e o estado. Se houver número de disponibilidade no rodapé, inclui esse número.
9. O card entra no `availability-grid` do bloco `highlighted_resources`, depois dos tipos já renderizados, ou na posição que o produto definir sem criar outro grid.
10. A nota de rodapé do painel pode ganhar uma frase curta do novo tipo. O título do painel continua **Disponibilidade de Serviços**.

Fora deste contrato: não colocar o card em `uptime_list` só para reaproveitar a lista, não desenhar o card como linha de tabela e não usar o tamanho dos painéis de ASGARD ou de infraestrutura.

## Alertas de uso e pares dos minicards

O [guia de alertas das VMs com Agent](vm-agent-alerts.md) documenta limites percentuais, armazenamento agregado selecionado, configuração compartilhada entre ASGARD e Signal, revisão das escritas e seleção CPU/RAM, CPU/Disco ou Disco/RAM. O Collector existente avalia os limites; disponibilidade, processos, layouts salvos e o áudio mantêm seus contratos.

## Três métricas e persistência

A quarta combinação canônica é `["cpu","memory","disk"]`. O helper `cardMetricOrder` produz Disco → CPU → RAM para exibição sem reordenar o valor salvo. Combinações desconhecidas, duplicadas ou em outra ordem são rejeitadas. Flags antigas não promovem automaticamente para trio.

Dentro de Disponibilidade, toda a grade respeita a mesma caixa escolhida pelo bloco: **Padrão 120px** ou **Ampliado 140px**, inclusive quando há trio. O disco ocupa a linha superior inteira nos dois perfis. Grupos reutilizados no Signal e prévias isoladas de trio conservam o envelope de 140px; pares isolados continuam em 120px. Zooms e Fileiras visíveis manuais permanecem independentes.

Recursos/Agent/Signal reutilizam seus campos existentes. Storage grava `storage_config.card_metrics`, default CPU/Disco, sem alterar RX/TX/capacidade/limite. VPS grava `standalone_vps.card_metrics` nullable, default SQL null (faixa). A migration aditiva `20261103190000_minicard_three_metrics` amplia os checks existentes e acrescenta esses dois campos. Escritas antigas sem o novo campo preservam a escolha; ambos os modais do Storage preservam o escopo do outro. Alterar só apresentação não modifica regras/identidade de notificações.

O renderer clássico gera o trio no primeiro HTML e nos snapshots; usa flex-wrap compatível com WebView antiga, sem depender de Grid moderno. O contrato de fontes, barra, ausência e rodapé é o mesmo do React.
