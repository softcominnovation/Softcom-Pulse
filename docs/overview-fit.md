# Encaixe da rota principal

**Espaçamento dos minicards no monitor (05/11/2026):** somente no `/monitor`, Padrão mede 148px e Ampliado 168px antes do zoom (+28px sobre os perfis da raiz). Disco tem 6px de separação da linha CPU/RAM no trio. Somente os valores percentuais de uso dos minicards recebem mais 30% de fonte e peso 600; nomes, descrições, badges, rótulos e rodapés conservam sua escala configurada. O fator tipográfico do bloco e o zoom são aplicados uma vez. `availabilityDimensions(size, monitor)` alimenta alturas, janela de fileiras e mínimos das composições; a grade continua sendo o único scroll de Disponibilidade. As caixas não variam ao trocar a fonte de 100% a 160%. Raiz e prévias continuam com 120/140px.

## Tipografia independente no monitor

O percentual de fontes por bloco é exclusivo do `/monitor`; não entra nas contas de zoom, mínimo das fileiras, largura/altura dos minicards ou divisão dos espaços. A geometria usa 148/168px no monitor e 120/140px na raiz/prévia, com as fileiras configuradas. Na raiz e na prévia, o novo fator permanece neutro.

Em componentes compartilhados, aplicar `var(--monitor-font-scale, 1)` somente à fonte, uma vez. Tamanhos relativos herdados não recebem um segundo multiplicador. Não usar `zoom`, `transform`, `rem` global ou alteração de padding para simular essa preferência. Preservar linhas dos cabeçalhos/KPIs, rodapé compacto e a grade como único scroll de Disponibilidade. Textos maiores podem ocupar mais espaço dentro dos corpos roláveis, sem esticar a distribuição externa.

Ao adicionar um novo texto a um bloco, verificar os percentuais 100–160 no navegador e no clássico, incluindo pares/trios, duas/três fileiras, painéis empilhados e zooms independentes. A versão clássica usa regras literais geradas da folha CSS; instruções em [compatibilidade](monitor-compatibility.md#escala-de-fontes-por-bloco).

As barras de uso dos minicards no `/monitor` têm 4× a altura original, independentemente do fator tipográfico (12px no Padrão e 16px no Ampliado, antes do zoom). As dos painéis continuam em 12px, ou 3× a altura original. `monitor-readability.ts` compartilha o orçamento de padding/linhas internas dos minicards entre React e clássico, comportando o trio nas caixas de 148/168px e recalculando a janela das fileiras. Os históricos de disponibilidade não mudam. KPIs preservam a linha com truncamento de texto longo; a área interna dos volumes do ASGARD acompanha a fonte para não cortar a primeira leitura, sem ampliar o painel externo.

## Composições com Storage

`storage_summary` usa `storageLayout` e `StorageComposition`, compartilhados pela raiz e pela prévia. O caminho anterior permanece sem Storage habilitado. Indicadores têm faixa própria; demais blocos entram em fileiras de 12 colunas, por UUID, ordem e larguras. Repetições não disputam áreas CSS por tipo.

Em split, uma única Disponibilidade e um único Problemas conservam o par superior 1,25:1. Os demais painéis entram na grade. Sem dupla única, todos entram por UUID. Overview padrão e wall usam o mesmo empacotamento e as larguras efetivas existentes.

Em >=1201×740, as fileiras de painéis dividem a altura restante. Uma fileira composta somente por Disponibilidade de Serviços acompanha a altura real de seus cards, até o limite de linhas configurado; não recebe uma parcela igual da altura nem reserva linhas vazias. ASGARD, Storage e os demais painéis flexíveis aproveitam o espaço liberado. Uma Disponibilidade que divide a fileira com Problemas ou outro painel conserva o alinhamento pela altura compartilhada.

O cálculo de encaixe mede as fileiras de Disponibilidade, os indicadores e os espaçamentos reais, e reage quando os cards ganham ou perdem uma linha. Se o mínimo de leitura dos demais painéis não couber, só a composição rola; todos os painéis continuam alcançáveis e a legenda da raiz fica visível. A prévia usa o mesmo cálculo e anuncia esse fallback. Abaixo do recorte, a página rola normalmente. Nenhuma composição salva, escala ou fonte é alterada para produzir encaixe. O painel Storage conserva cabeçalho/rodapé e rola corpo/volumes. Consulte [Storage](storage.md). As seções seguintes descrevem também o caminho legado, preservado sem Storage.

Os componentes novos seguem o [Design system Kobra](design-system.md) e os [Sons da interface](interface-sounds.md). Este documento governa distribuição e rolagem; a paleta e as primitivas atuais vêm do guia de design.

A rota `/` é a tela de monitoramento. Em resolução grande ela cabe na área visível: cabeçalho, navegação, blocos e legenda aparecem juntos, sem rolagem da página. O que passar da altura do painel rola dentro dele. Em tela estreita ou baixa, a página pode rolar. Detalhe, infraestrutura, ASGARD, serviços e administração não herdam esta trava.

## Quando a regra vale

A classe `balanced` entra no dashboard quando o layout ativo é `overview`. O encaixe liga neste recorte:

- largura mínima de 1201px
- altura mínima de 740px

Abaixo de qualquer um desses limites, o shell não trava a altura. Celular, tablet estreito e janela baixa usam a rolagem normal da página. Até 1200px a grade também deixa de ter 12 colunas e passa a duas.

Entre 740px e 900px de altura, o mesmo encaixe continua, com cabeçalho, navegação, indicadores e paddings mais baixos. O conteúdo principal permanece na área visível.

Modo TV e tela cheia usam o mesmo shell. A escala de leitura (`--dashboard-scale`, 100, 110, 120 ou 125) aumenta fonte e espaçamento. Ela não é `zoom` nem `transform`. O componente novo usa `calc(... * var(--dashboard-scale, 1))` nas medidas que acompanham o telão.

## Como o encaixe funciona

Serviços destacados pode usar o perfil Padrão ou Ampliado por bloco. `availability-sizing.ts` concentra geometria e limite: a escolha manual de **Fileiras visíveis** (1–3) prevalece sobre KPIs/largura em ambos os perfis. Automático explícito usa duas no dividido com KPIs, três sem KPIs e duas na faixa inteira; sem modo novo, conserva o comportamento legado de cada perfil. A escala privada é aplicada uma vez e os zooms por rota permanecem independentes. Não há fileira vazia reservada quando há menos cards. Fileiras mistas com Storage e o clássico medem a altura natural de grades Ampliadas ou com modo explícito.

A faixa inteira continua acompanhando o conteúdo e as fileiras flexíveis aproveitam a sobra. Se a janela completa de cards e os mínimos inferiores não couberem, usar a rolagem interna da composição preservada na correção sem KPIs, informada na prévia. Não reduzir a caixa nem a quantidade de fileiras para caber parcialmente em uma reserva antiga de 120/128px. O perfil Padrão conserva suas regras legadas quando não há modo explícito; a seleção nova de 1–3 prevalece em ambos os perfis; os detalhes estão em [Minicards](availability-cards.md#perfis-de-tamanho-por-bloco).

As trilhas externas do grid React são derivadas dos blocos habilitados por `dashboardGridRows`, em vez de reservar posições fixas para os Indicadores. O mesmo cálculo alimenta a prévia e a raiz pública. Uma faixa de Indicadores ou de Disponibilidade isolada acompanha o conteúdo; fileiras de painéis recebem a altura restante. Sem Indicadores, não fica uma trilha vazia absorvendo o espaço de ASGARD/Signal. UUIDs, ordem e larguras continuam os da composição salva.

As fileiras flexíveis conservam mínimo de leitura de 210px lógicos multiplicado pela escala de apresentação vigente. A composição por fileiras também mede o conteúdo de Disponibilidade para preservar as fileiras completas configuradas. O miolo do ASGARD pode rolar quando suas métricas ocupam a altura disponível, preservando uma janela útil para a tabela. Se fontes maiores, múltiplas faixas ou zoom deixarem espaço insuficiente, a composição rola dentro do shell em vez de comprimir ASGARD/Signal até zerar seus corpos; cabeçalho e legenda permanecem visíveis. A prévia desktop recebe uma altura delimitada para mostrar esse mesmo comportamento sem aplicar a trava à página administrativa inteira.

Na grade Duas colunas sem Storage, `overviewSplitRows`/`overviewSplitTracks` incluem somente as fileiras com blocos habilitados. Se restar apenas a fileira superior ou inferior, ela recebe toda a altura útil; não reservar uma segunda fileira vazia. As áreas nomeadas são usadas apenas quando os tipos são únicos. Com tipos repetidos, `usesRowComposition` encaminha dashboard e prévia à composição por UUID já usada com Storage, evitando sobreposição e mantendo as opções de cada bloco. O clássico usa a mesma seleção de fileiras, com flex e larguras próprias em vez de CSS Grid. Não mudar a ordem salva nem gravar configurações durante o cálculo.

Cada bloco de Indicadores pode usar `fontScalePercent` (100/110/125/150). A variável local `--kpi-font-scale` multiplica a tipografia do recorte atual, sem escalar ícones, paddings ou os demais blocos. Múltiplas faixas têm fatores independentes. As medições da composição com Storage usam `offsetHeight`/`clientHeight` em pixels lógicos coerentes, evitando misturar retângulos físicos reduzidos pelo zoom com o orçamento lógico; observadores de tamanho reagem às fontes maiores e à remoção das faixas.

A partir de 1201×740, `.dashboard-shell:has(.balanced)` fica com `height: 100dvh` e `overflow: hidden`. A barra superior não encolhe. O miolo (`.dashboard-main`) ocupa o resto, com `min-height: 0`, para o grid poder ceder altura.

`.dashboard.balanced` é uma coluna. Tudo que não é `.dashboard-blocks` — navegação, título, avisos, legenda — tem `flex-shrink: 0`. A grade `.dashboard-blocks` recebe `flex: 1` e `min-height: 0`. Cada `.dashboard-panel` dentro dela tem `height: 100%`, `min-height: 0` e `overflow: hidden`.

A lista que pode crescer não estica o painel. Ela fica numa área com `flex: 1 1 0`, `min-height: 0` e `overflow: auto`. Já estão nesse grupo: problemas, VMs do ASGARD, hosts, containers, uptime e a grade de recursos. A grade de Disponibilidade de Serviços tem altura máxima própria e rola por dentro; no perfil Padrão, o card mantém altura de 120px e largura usual até 230px, com colunas elásticas no split. O Ampliado usa o envelope e as contas próprios descritos em [minicards](availability-cards.md).

Nada é apagado para caber. O que não cabe na altura do painel continua acessível na rolagem interna.

Disponibilidade reserva a janela completa de cards conforme perfil/fileiras e só `.availability-grid` rola dentro desse painel. A medição da composição com Storage observa também o perfil Padrão legado e soma alturas fracionárias/margens/bordas, preservando altura natural com poucos cards. No clássico, a grade é direta e a medição inclui o padding da fileira. Não comprimir a janela para introduzir outra rolagem em seu entorno; os [orçamentos de fileiras](availability-cards.md) mantêm cabeçalho/rodapé visíveis.

Nas composições com Storage, `--row-minimum` também limita a distribuição flexível quando há espaço total suficiente; a fileira de Disponibilidade recebe seu mínimo antes de repartir o restante. Sem Storage, o grupo split usa mínimo intrínseco e a fileira única com Disponibilidade respeita seu conteúdo, mesmo em zoom alto. Em telas estreitas, Disponibilidade não recebe o teto genérico de 560px das outras listas: o limite de conteúdo é sua quantidade de fileiras, e o shell mantém o acesso ao restante da composição.

Quando existem outras fileiras abaixo, a fileira medida de Disponibilidade não participa do crescimento flexível: usa a altura real de cabeçalho, janela de cards e rodapé. O restante continua disponível para ASGARD, Signal e demais painéis. O piso genérico de 210px não cria sobra artificial nesses painéis medidos. No split sem Storage, a altura natural de Disponibilidade prevalece também sobre o `height:100%` dos wrappers de zoom. Seu rodapé é uma linha sem crescimento, limitada a 28px antes de escala/zoom; não transferir espaço vazio para baixo dele nem comprimir os cards para acomodá-lo. A fileira única continua com o comportamento de preenchimento já existente.

No ASGARD compacto, a partir de 480px de largura do contêiner, o cabeçalho reserva espaço para a disponibilidade e o link, enquanto o nome pode truncar na mesma linha. Evitar que fontes mais largas ou a escala de 125% quebrem a disponibilidade em uma segunda linha e consumam a área útil da tabela de VMs. Abaixo desse recorte o cabeçalho continua podendo reorganizar o conteúdo. Validar o encaixe com nomes longos e diferentes métricas de fonte, preservando a tabela rolável e a legenda visível.

## Composição opcional com espaços configuráveis

`overviewGrid: split_custom` usa `overviewSlotLayout` para resolver quatro espaços por UUID, cada um com um painel ou dois empilhados. Os modos `default`, `split` e `wall` conservam os caminhos anteriores. Indicadores ficam acima; a proporção das colunas continua 1,25:1. Só um espaço ocupado usa toda a largura; fileiras vazias não reservam altura.

`SlotComposition` mede a Disponibilidade e compara seu orçamento ao mínimo dos grupos vizinhos: uma pilha soma dois mínimos de 210px mais o gap de 12px, todos sujeitos à escala local uma vez. A fileira com Disponibilidade e outras abaixo usa esse mínimo real, deixando o restante para os painéis inferiores. Dentro da pilha, desconta-se um gap e divide-se o restante igualmente. A Disponibilidade conserva altura natural e sua janela de fileiras; seu rodapé não vira preenchimento quando a pilha vizinha exige mais espaço.

Com mínimos maiores que a área útil, a composição rola pelo fallback existente, preservando legenda, cabeçalhos, rodapés e corpos acessíveis. O grupo da pilha nunca cria um terceiro scroll. Em largura até 850px, os espaços/painéis seguem a ordem de leitura e alturas naturais, com os limites de corpo já existentes. A prévia informa também quando a pilha exige mais altura que a Disponibilidade, mesmo sem overflow de toda a composição.

Os observadores usam medidas lógicas antes do zoom e acompanham mudanças de conteúdo, perfil/fontes e remoção de nós. A atribuição não modifica fonte de métricas, opções, alertas ou áudio. Veja o [editor](administration.md#painéis-empilhados-por-espaço) e o [modo compatível](monitor-compatibility.md#espaços-configuráveis).

## O que um componente novo obedece

Um bloco, card ou painel feito para a visão geral da rota `/` segue esta lista. Vale para TV e tela cheia na mesma faixa de 1201×740 ou maior.

1. Entrar em `.dashboard-blocks`, dentro de `.dashboard-panel`. Não criar um segundo scroll na página.
2. O painel aceita `min-height: 0` e não impõe uma altura fixa maior que a faixa que a grade lhe der.
3. Cabeçalho e rodapé do painel ficam de fora da área que rola. Só o miolo longo rola.
4. A área rolável usa `min-height: 0` e `overflow: auto`. Sem `min-height: 0`, o flex não encolhe e o painel empurra a página para fora dos `100dvh`.
5. Uma linha a mais de dado não aumenta a altura do bloco. Aumenta a rolagem interna, como a tabela de VMs do ASGARD.
6. Medidas de fonte, ícone, gap e padding do telão passam por `--dashboard-scale`.
7. Em largura menor que 1201px, o bloco empilha e a página pode rolar. Não se esconde ação nem dado só porque a trava de altura não está ligada.
8. Rotas que não são a visão geral da raiz continuam com rolagem de página. Não copiar `100dvh` e `overflow: hidden` para o detalhe, a administração ou a infraestrutura.

A prévia em configurações avisa quando a composição precisa de rolagem na altura da janela. Esse aviso é o sinal de que o bloco passou do espaço da visão geral.

### Validação de altura e rodapé

Em escalas altas, o `getBoundingClientRect()` de um painel pode ultrapassar a composição porque inclui a parte recortada pelo `overflow: auto`. Isso não representa, por si só, sobreposição visível ao rodapé. O E2E de escalas verifica que a legenda fica fora da caixa da composição e desobstruída, depois rola a composição até o fim e confirma que o final do último painel fica acessível acima dela. Mantém também o acesso à última VM e a cobertura de 390, 1366, 1920 e 3440px nas escalas 100, 110, 120 e 125%. Não reduzir os mínimos dos painéis apenas para fazer suas caixas completas caberem sem rolagem.

Nas transições entre normal, TV e fullscreen, o atributo da escala pode mudar antes da medição pelo `ResizeObserver`. Os testes de Storage aguardam a geometria final, preservando conjuntamente corpo utilizável, rodapé no viewport e ausência de sobreposição/overflow horizontal. Não usar a primeira leitura síncrona após o clique como prova de um defeito persistente, nem relaxar os limites para aceitar um corpo vazio.

## Apresentação pública compatível

### Zoom independente da raiz

A rota `/` usa `RootDashboard` com `dashboardZoomPercent` (50–150, default 100), recebido pelo BFF autenticado e atualizado conforme o player aplica revisões. `root-dashboard-stage` compensa largura/altura lógica inversamente ao percentual e aplica zoom uma vez, com fallback por transform. Desktop conserva o shell no viewport também ao mudar entre overview e wall; se os mínimos não couberem, rola a composição e mantém a legenda. Mobile a 100% conserva o fluxo existente; demais percentuais mantêm acesso pelo stage. CSS limitado ao wrapper da raiz; não muda o monitor público, administração ou detalhes.

A escala privada de TV/fullscreen e os fatores locais de KPIs e minicards continuam dentro desse zoom. Nenhum percentual é inferido de DPR/densidade. O valor não é compartilhado com `publicMonitorZoomPercent`. Com o cabeçalho nome/badge em uma linha, o Ampliado usa 140px e os cálculos de fileiras/mínimos usam essa mesma base.

O renderer clássico de `/monitor` usa uma [composição CSS própria](monitor-compatibility.md#composição-e-rolagem), limitada àquele documento, sem alterar o encaixe React descrito acima. Não transporta o algoritmo antigo de sensores/transformação. Compensa apenas zoom CSS explicitamente definido na raiz do iframe, expandindo o viewport lógico e mantendo a composição flex; não deduz zoom por densidade da tela. Mantém regiões roláveis e pode rolar a composição quando os mínimos não cabem, preservando os dados e a legenda.

A rota exata `/monitor` usa `publicMonitorZoomPercent` (50–150, padrão 100) e mantém `--dashboard-scale` em 1, inclusive em TV/fullscreen. O frame React expande largura/altura lógica inversamente ao zoom; o clássico faz a compensação equivalente. Quando CSS zoom não existe, o fator explícito pode ser aplicado por transform, sem estimar escala por DPR. A raiz autenticada e as demais rotas mantêm os fatores atuais. Consulte [configuração do zoom inicial](monitor-compatibility.md#zoom-inicial-do-monitor).

### Trio explícito respeita o perfil do bloco

O conteúdo CPU/RAM/disco não substitui `highlighted_resources.options.cardSize`. Padrão (`compact`) mantém 120px e Ampliado 140px na raiz/prévia; no monitor, os envelopes são 148/168px, inclusive custom. O observador de Storage e o planejamento clássico usam esse perfil e a geometria real. A janela manual de 1–3 fileiras tem prioridade; os mínimos, o fallback de rolagem e o preenchimento inferior continuam os mesmos. A prévia isolada de trio, sem bloco, conserva 140px.
## Storage: espaço mínimo e rolagem — 06/11/2026

O Storage tem uma única região rolável interna, a tabela `.storage-volumes`. O corpo externo é flexível sem barra. `storagePanelMinimum` mede as áreas fixas e a primeira linha da tabela sem misturar pixels lógicos e zoom; as composições normal e por espaços observam essas medidas. Pares de painéis com alturas iguais reservam duas vezes o maior mínimo, mais o gap. Se o conjunto não cabe no viewport, usa a rolagem existente da composição, preservando todos os dados e a legenda externa. A versão clássica do `/monitor` mantém o mesmo contrato no controlador ES5. A visibilidade de volumes é independente da capacidade/alerta; ver [Storage](storage.md).
