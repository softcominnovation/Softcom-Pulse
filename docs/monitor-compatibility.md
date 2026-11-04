# Monitor público em iframe e navegadores de TV

A entrada `/monitor` conserva a aplicação React para navegadores modernos e oferece uma apresentação HTML compatível para TVs/WebViews sem os recursos exigidos pelos bundles atuais. A adaptação pertence somente a essa superfície pública. Rotas privadas, administração, notificações, alertas de Agent/Storage e workers continuam usando os contratos atuais.

## Seleção da apresentação

- `/monitor?compat=1`: força a apresentação clássica. `/monitor/compat` é sua entrada direta.
- `/monitor?compat=0`: mantém React, inclusive para comparação e cobertura do iframe moderno.
- A seleção automática atende iframe (`Sec-Fetch-Dest: iframe`), Chromium anterior a 111, Firefox anterior a 128, Safari/iOS anterior a 16.4 e agentes desconhecidos.
- O bootstrap clássico verifica as capacidades necessárias se o navegador declara um UA moderno inadequado. Sem JavaScript, o HTML React oferece a entrada clássica por `noscript`. No renderer React, esse arquivo externo usa `async` para participar do gerenciamento de recursos do React também na navegação interna; não trocar por um script `defer` inserido como componente. O renderer clássico continua com seus scripts HTML próprios. Consulte [scripts no React](https://react.dev/reference/react-dom/components/script).
- O matcher do Proxy limita-se ao `/monitor`; subrotas existentes permanecem com sua implementação atual.

WebView 83 falhava ao interpretar `??=` e blocos estáticos de classe nos bundles atuais. A solução clássica não carrega esses bundles para mostrar os dados: o servidor entrega o HTML completo, CSS convencional e scripts ES5 com XMLHttpRequest. Não há rebaixamento global de JavaScript, React, Tailwind ou bibliotecas do restante do app.

## Fronteira pública e transporte

`lib/server/monitor-compat/read.ts` usa os handlers públicos atuais dentro do processo, sem uma requisição HTTP do servidor para si mesmo. As leituras internas recebem somente o Host original, sem Cookie/Authorization. Um visitante autenticado não amplia essa projeção pública. Continuam valendo as redações atuais de VPS, Storage, Signal e inventário privado.

Host precisa estar em `PULSE_PUBLIC_HOSTS`. `X-Forwarded-Host` não concede acesso. Respostas não são cacheadas; dados de atualização e WAVs usam CORS anônimo, sem credenciais, para suportar iframe com `Origin: null`. Não se abre CORS nas APIs privadas nem uma rota de escrita pública.

| Entrada | Função |
|---|---|
| `GET /monitor/compat` | Documento HTML completo |
| `GET /monitor/compat?fragment=1` | `{html,state}` para atualizar somente o conteúdo |
| `screenId`, `layout=overview\|wall`, `tv=0\|1`, `theme=dark\|light` | Preferências locais e seleção de tela, sem salvar configuração |
| `GET /monitor/compat/notifications/[[...segments]]` | Adaptador de consulta dos contratos atuais de notificações, com texto formatado no servidor |
| `GET /monitor/compat/audio/:sound` | Somente os WAVs `notification`, `warning`, `error`, `success` já existentes |

O Proxy usa `new URL(request.url)` e `skipProxyUrlNormalize: true`. A combinação impede que o Next converta um destino loopback de `127.0.0.1` para `localhost`, transformando a reescrita interna numa conexão externa. É relevante também quando o túnel informa HTTPS em `X-Forwarded-Proto`, mas a origem local usa HTTP. Preservar essa opção junto de `allowedDevOrigins`; elas não resolvem o mesmo problema.

Se o túnel resolve `localhost` como `[::1]` e o app escuta em `127.0.0.1`, configurar a origem do túnel com o IPv4 explícito e a mesma porta. Isso é configuração externa; a camada não modifica túneis, endereços ou processos.

## Dados e funcionalidades atuais

O renderer adapta a projeção atual dos dez tipos de bloco e seis famílias de minicard. Mantém nomes, estado, opções, ordem, UUIDs, seleção customizada, larguras e alternância. Não instala outro Collector, não consulta o Zabbix diretamente e não cria tabelas ou migrations.

- Minicards de recursos usam `availabilityCardSlots` e as métricas já resolvidas pelo BFF. CPU/disco, disco/RAM e CPU/RAM conservam a escolha atual; não se recalcula o disco usando outro filesystem.
- Serviços Signal usam o par e o disco da VM retornados pelo BFF. Os detalhes mantêm CPU/RAM e as demais informações disponíveis nesta apresentação.
- Storage usa capacidade/volumes selecionados, disponibilidade e RX/TX atuais. Não soma volumes novamente nem identifica Storage por hostname/IP.
- Amostras antigas mantêm seus horários e indicação de desatualização. Evidência expirada retira a confirmação saudável; uma nova consulta não renova a amostra.
- Ícones são SVGs inline com paths locais Tabler, namespace e dimensões explícitos. Não dependem de fontes de símbolos, hidratação React ou sprites externos.
- O HTML inicial contém mute e “Ajustar sons” com ícones compactos, além do template do modal. Volume/percentual/teste ficam no modal “Sons da interface”. Falha do adaptador informa indisponibilidade sem impedir o restante da página.

O modo TV inicia ligado, como no `/monitor` moderno, e pode ser desligado localmente. A rota exata `/monitor` mantém escala de elementos em 100%, inclusive em TV/fullscreen: não aplica `displayScalePercent`. Esse campo continua funcionando nas demais rotas como antes.

## Zoom inicial do monitor

Em **Configurações → Leitura no telão → Zoom inicial do /monitor (%)**, informe um inteiro de 50 a 150 e clique em **Salvar leitura do telão** (ou salve a apresentação completa). Padrão: 100. Por exemplo, 70% reduz o conteúdo e conserva o preenchimento do viewport. O valor é compartilhado entre os dispositivos que abrem `/monitor`; não controla o menu de zoom do navegador.

O campo `publicMonitorZoomPercent` integra o JSON `dashboardPresentation` existente no PostgreSQL e sua revisão otimista. Documentos antigos recebem 100 na leitura. Não há migration, nova rota, novo worker ou alteração de permissão. O save de leitura conserva a composição ainda não salva, como antes.

O clássico entrega o zoom e a área inicial no HTML/CSS, inclusive sem JS; depois acompanha mudanças da configuração e viewport. O renderer React recebe o valor pela leitura pública anônima no servidor e aplica a proporção em um frame exclusivo antes da hidratação. Uma falha nessa leitura inicial mantém 100 e os estados de erro atuais. Atualizações de apresentação ajustam o frame sem gravar preferências locais. Ao sair da rota, o frame deixa de existir e não deixa zoom na raiz do documento. A escala TV de 110/120/125% não é somada a esse zoom.

A avaliação de CSS variables/calc isoladamente não comprova compatibilidade do aplicativo inteiro: Next.js, Tailwind e bibliotecas têm seus próprios requisitos. O fallback clássico permanece necessário. [CSS zoom](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/zoom) altera o conteúdo/layout e [CSS.supports](https://developer.mozilla.org/en-US/docs/Web/API/CSS/supports_static) detecta o recurso disponível; não se deduz suporte por densidade da tela.

## Composição e rolagem

Indicadores usam a mesma opção `summary.options.fontScalePercent` da raiz autenticada (100/110/125/150, padrão 100). No clássico, os tamanhos de título, número e legenda já vêm no HTML inicial, sem depender de JavaScript; snapshots seguintes mantêm o fator do bloco e o controlador de densidade não o sobrescreve. Ícones e outras fontes não são ampliados. No React, o fator fica restrito à seção de KPIs; o zoom do monitor continua sendo aplicado uma única vez pelo frame existente.

Com Indicadores desabilitados, o React deriva as trilhas da composição realmente habilitada, compartilhando o cálculo com a prévia. O clássico conserva suas faixas flexíveis sem gerar uma banda de resumo vazia e aplica no HTML os mínimos calculados de cada fileira. Se os mínimos não couberem, a composição rola dentro do shell; o corpo do ASGARD preserva uma janela útil de leitura para as VMs. A ausência dos KPIs não deve reduzir os painéis inferiores a seus cabeçalhos nem deixar uma faixa vazia até a legenda. Os testes medem base e área de conteúdo dos painéis, não apenas o tamanho externo do iframe.

No monitor React desktop, o shell deve usar `height: 100%` da altura lógica já compensada do `.public-monitor-stage`. O seletor `.public-monitor-frame .public-monitor-stage > .dashboard-shell` tem prioridade sobre as regras compartilhadas `.dashboard-shell:has(.balanced)` e `.dashboard-shell:has(.has-storage)`, que usam `100dvh` nas telas normais. Não reduzir sua especificidade: com a mesma prioridade, uma folha compartilhada carregada depois pode reaplicar `100dvh` dentro do zoom. Em zoom 70%, isso deixava o frame com 1080 px e o shell com somente 756 px, produzindo a faixa vazia inferior. O restante do app e a fórmula de zoom não foram alterados. O teste deve medir shell, rodapé e base dos painéis, além do frame, inclusive acima de 740 px de altura e após carga posterior das folhas compartilhadas.

Essa regressão foi reproduzida antes da correção e validada depois em 50/70/100/125/150%, split, Storage em overview/wall, TV desligado e viewport 1280×720. A rodada final passou no check (263 unitários e build), oito cenários selecionados de interface e nos 13 testes runtime completos. Não requer mudar o zoom salvo para 100%.

O dashboard React e seu encaixe existente não foram substituídos. Na apresentação clássica, CSS convencional organiza as mesmas fileiras e larguras. Em viewports a partir de 761×480, flexbox ocupa o espaço disponível e os corpos dos painéis podem encolher com `min-height: 0`. Cabeçalhos e rodapés permanecem fora da área rolável. Abaixo desse recorte, o fluxo da página permite rolagem para manter o conteúdo acessível.

ASGARD, Signal, Storage e tabelas longas têm corpo rolável por teclado, toque ou roda. Conteúdo não é reduzido a altura zero para aparentar encaixe. Quando os mínimos das fileiras não cabem, a composição também pode rolar dentro da área disponível, conservando a legenda e a página. O controlador preserva foco/rolagem após atualizações. Disponibilidade conserva o tamanho dos minicards e seu limite de linhas.

O clássico não infere zoom por DPR ou estilo computado e não usa sensores. Com suporte nativo aplica CSS zoom; sem suporte, usa apenas `transform: scale()` com o fator explicitamente configurado e a área lógica inversa, sem calibrador automático. Na WebView 83, o zoom computado da raiz pode incluir densidade nativa sem declaração CSS; tratá-lo como zoom manual encolhia a tela.

Para o zoom aplicado pelo ADB a `document.documentElement.style.zoom` **dentro do iframe**, o controlador expande a largura e a altura lógica do viewport por `innerWidth / zoom` e `innerHeight / zoom`. Em 1280×720 com 70%, são aproximadamente 1829×1029 pixels CSS; o zoom reduz fontes/cards e o flex continua preenchendo toda a área visível. A mudança é observada sem recarga, assim como resize/orientação. Em 100%, as medidas adicionais são removidas. A compensação inclui as camadas de modal/toast e mantém a rolagem dos corpos. Não altera o zoom escolhido nem o documento pai.

Zoom aplicado à página pai pode reduzir o próprio iframe; o documento filho não consegue ocupar pixels externos a ele. O utilitário deve manter o pai em 100% e aplicar zoom apenas ao contexto do `/monitor`.

## Cache dos arquivos compatíveis

CSS, controlador, bootstrap e adaptador de áudio recebem `?v=<sha256 do conteúdo>` nas URLs geradas pelo servidor. Uma mudança no arquivo muda sua URL, inclusive no desenvolvimento. Isso impede a combinação observada na TV entre HTML atual sem sensores e controlador antigo guardado por navegador/CDN. O HTML/JSON permanece sem cache conforme a fronteira pública existente; o identificador não muda autorização nem política de dados. Os arquivos de `public` devem acompanhar o build standalone, como já previsto no empacotamento.

## Atualização e falhas

O HTML inicial tem prazo de leitura e uma mensagem legível de falha. Sem JavaScript, há recarga completa conforme o intervalo informado. Com JavaScript, o cliente atualiza fragmentos sem sobrepor requisições, confere tela/revisão e conserva a última leitura em caso de falha. Tentativas sucessivas recebem recuo limitado.

A alternância aguarda a leitura/interação e não cancela continuamente uma tela lenta. Modal aberto não troca seu corpo por um snapshot novo. Respostas pendentes anteriores a uma falha não reaplicam dados como se fossem recentes. Retorno à página restaura polling sem tocar notificações históricas.

## Notificações e áudio

O adaptador de notificações chama o mesmo leitor público usado pelo BFF atual e acrescenta `message`, obtido por `notificationText`. Não há outro motor de alertas nem versão antiga da política. Eventos `usage`, contexto de percentual/limite, recuperação e mensagens de Storage continuam reconhecidos.

A consulta clássica apresenta Não lidas, Incidentes atuais e Histórico. Histórico usa o dia de Fortaleza como padrão, data inicial obrigatória, final opcional, bloqueio de datas futuras e paginação pelo cursor atual. Estado e leitura vêm do PostgreSQL compartilhado; a página pública é somente consulta. O sininho mostra badge vermelho, `99+` acima de 99 e total acessível completo; o favicon acompanha os indicadores atuais quando a aba fica oculta.

Avisos temporários são sobrepostos e não reservam espaço nos cards. Bootstrap, reconexão e mudança da revisão da política são silenciosos. Eventos lidos/encerrados retiram avisos visuais pendentes. A entrega sonora preserva a chegada mais grave, inclusive quando há recuperação na mesma enquete, e não aguarda o retorno do foco.

O toast clássico usa a mesma composição operacional Kobra: título/detalhe, ícone por estado, ação **Ver central**, raio de 18px e mínimo de 76px. Na posição central superior, mantém 16px de distância da borda superior, conforme ajuste solicitado para a WebView. Erro tem superfície vermelha e halo; atenção, recuperação e informação usam as respectivas cores e a faixa lateral. `public/monitor-compat-notifications.css` isola esses estilos do layout dos cards. Tem cores sRGB legíveis para WebView antiga e as misturas/tokens do Kobra compilado para motores que os suportam. O teste compara as cores renderizadas, tipografia, espaçamento e dimensões com o toast React nos dois temas; revisá-lo ao alterar os tokens ou o componente normal. Hover não fixa o aviso; foco na ação pausa a duração até sair.

A tipografia deve seguir os valores computados do Kobra: título com peso 700, detalhe com peso 400 e ação com 12,8px/19,2px e peso 400. O contorno da ação não acrescenta largura à caixa. Conferir também os estilos dos filhos: comparar somente a fonte do container permitia diferenças que se compensavam no Windows e falhavam na medição do CI Linux. O cenário runtime controla o relógio dos dois documentos para medir após a animação de entrada e informa as larguras obtidas quando há divergência, sem ampliar a tolerância de comparação.

O adaptador ES5 usa os WAVs Kobra existentes e cria um AudioBufferSourceNode por reprodução. Respeita `kobra-sound-muted`, `kobra-sound-volume`, zero, cooldown e as chaves de deduplicação atuais. Reduzir/mutar interrompe vozes. Sem storage, guarda preferências na memória do documento; Web Locks são opcionais. Origem opaca sem storage/locks não permite coordenar deduplicação entre documentos diferentes.

O clássico prepara o AudioContext e os quatro buffers ao carregar o adaptador, quando mute/volume permitem; a própria entrega também pode inicializá-los. Assim, uma WebView que permite autoplay não depende de abrir o volume nem apertar **Testar som**. Uma interação autorizada continua tentando preparar o contexto quando o navegador exige gesto. Recusa ou preparação acima de 1500ms não deixa fonte pendente, claim consumido ou replay ao reativar. Não há áudio silencioso em loop, bypass de autoplay ou alarme repetitivo. Permissões do navegador, da aba, do sistema e do hospedeiro continuam podendo impedir som. Consulte [Sons da interface](interface-sounds.md).

O som de teste confirma reprodução no dispositivo, mas não habilita sons na política. Em **Configurações → Notificações**, **Permitir sons nas notificações**, o escopo/criticidade e o tipo correspondente precisam permitir a chegada. **Som: Recuperação** tem padrão desligado; habilite-o se quiser ouvir recuperações, respeitando eventuais exceções por serviço. `sound:false` retornado pelo BFF permanece silencioso nos dois renderers, mesmo com volume ativo. Nenhuma configuração humana é alterada automaticamente por uma correção visual ou de reprodução.

## Rolagem automática dos painéis

Somente a rota exata `/monitor` percorre automaticamente as regiões internas com conteúdo vertical excedente, independentemente de Modo TV ou tela cheia. Isso vale para React e para a apresentação compatível usada no iframe da TV. A raiz autenticada, subrotas públicas, página/composição inteira, formulários e modais continuam manuais.

O movimento reproduz a TV do Signal: **24 pixels CSS por segundo**, pausa inicial e nas extremidades de **2 segundos**, ida até o final e retorno lento. Um acumulador fracionário evita perder movimentos pequenos em WebViews que arredondam `scrollTop`; um limite de 100 ms por passo impede saltos após interrupções. Em zoom diferente de 100%, a unidade continua sendo o pixel CSS do conteúdo.

Em **Configurações → Leitura no telão → Iniciar rolagem automática no /monitor**, escolha o estado inicial e use **Salvar leitura do telão** ou **Salvar apresentação**. O padrão é ligado. `publicMonitorAutoScrollOnLoad` é um booleano do JSON compartilhado de apresentação no PostgreSQL, com revisão otimista; documentos antigos recebem `true` na leitura, sem regravação nem migration. A configuração vale somente para `/monitor`, nos renderers React e clássico, mesmo sem Modo TV ou tela cheia, e não depende de cookies/storage do iframe.

Ligado inicia a rolagem inclusive quando a TV informa movimento reduzido; desligado abre pausado. Essa escolha explícita afeta apenas a rolagem dos painéis: não altera as preferências do Android, outras animações, sons, volume ou mute. O React recebe o valor inicial na mesma consulta anônima usada pelo zoom; a primeira configuração do cliente pode completar o fallback. O clássico recebe `autoScrollOnLoad` no JSON inicial. Mudanças do estado inicial valem na próxima abertura/recarga, preservando as escolhas manuais do documento atual.

O controle **Rolagem** na barra existente continua pausando/retomando todos os painéis apenas na sessão aberta, sem gravar no banco. Polling e troca de tela não desfazem essa escolha temporária; recarregar volta ao estado inicial salvo. Wheel, toque, arraste e teclado suspendem a região por 5 segundos e a retomada respeita a pausa de leitura de 2 segundos. Documento oculto ou diálogo aberto suspendem o movimento. A rolagem não emite som nem anúncios repetitivos.

Antes da configuração persistente, a TV de teste com WebView 83 iniciava pausada porque suas escalas de animação estavam em zero e `matchMedia('(prefers-reduced-motion: reduce)').matches` retornava `true`. Em 01/11/2026, a retomada manual fez duas regiões passarem de 0 para aproximadamente 60 pixels CSS em 4,5 segundos. Esse diagnóstico motivou a configuração atual: movimento reduzido, isoladamente, não determina mais o início da rolagem; verificar o valor salvo e o estado do botão. Não exige reiniciar workers nem alterar o APK.

`public/monitor-auto-scroll.js` é o núcleo ES5 compartilhado. O hook `use-monitor-auto-scroll` só é montado pelo `PublicMonitor`; o clássico carrega o mesmo arquivo com hash de conteúdo antes do controlador principal. A descoberta verifica overflow e dimensões reais dentro de blocos identificados por `data-block-id`, acompanha mudanças do DOM/viewport e preserva posição/direção em memória durante atualização e troca de tela. O cache é limitado, com um único ciclo de animação por monitor e limpeza na desmontagem.

Eventos comandados pelo núcleo são identificados pelo alvo e pela posição da última escrita. A identificação não expira por tempo: um evento nativo pode chegar atrasado quando outro listener ocupa a thread. A marca é invalidada imediatamente pela interação manual na região ou por uma posição diferente da comandada. Não usar `isTrusted` para distingui-los: um scroll programático também gera eventos nativos. O player e o temporizador de inatividade ignoram apenas os eventos reconhecidos como automáticos. Interações manuais continuam pausando a alternância e reiniciando a inatividade. No clássico, sincronizar o núcleo depois de restaurar as posições do snapshot; não reinicializar o movimento em cada atualização.

Antes de substituir o HTML clássico, chamar `capture()`: ela redescobre as regiões e guarda o `scrollTop` real sem alterar direção ou pausa. Isso também cobre um overflow que acabou de reaparecer após zoom e uma rolagem manual cujo evento ainda não foi entregue. Depois da restauração existente de foco/posição, chamar `sync()`. Confiar apenas no último frame pode restaurar uma posição antiga e sobrescrever a leitura manual.

## Validação e manutenção

Para a rolagem automática, `tests/monitor-auto-scroll.test.mjs` cobre o modelo temporal; `tests/runtime/monitor-auto-scroll.test.mjs` percorre overflow real e testa interação, refresh e limpeza; `tests/e2e/monitor-auto-scroll.spec.ts` cobre o monitor React, alternância, isolamento de rota, polling, inatividade e movimento reduzido. O cenário clássico adicional usa iframe com `sandbox="allow-scripts"`, confirma posição após snapshot e conserva os limites do viewport. Servir a fixture HTML por HTTP real: interceptar o documento inteiro com `route.fulfill` pode perder os metadados loopback e disparar a proteção de rede local do Chromium. Não desativar essa proteção para fazer o teste passar.

A regressão de evento atrasado usa um scroll nativo real e um listener que ocupa a thread por 350 ms: a origem continua automática, e wheel/teclado continuam manuais. No teste de polling/inatividade, esperar também a aplicação do indicador atualizado no DOM antes de avançar o relógio; receber a resposta HTTP, isoladamente, não comprova que o React terminou de aplicar o novo estado.

Na retomada após sair do Modo TV, medir a posição no layout atual: a área rolável pode mudar e o movimento pode estar no retorno. Não exigir sempre um `scrollTop` maior que o registrado antes da mudança de modo. O teste de início ligado/desligado usa relógio controlado e pausa a lista no fim, confirma a imobilidade e então verifica o retorno após as pausas de interação e leitura, mantendo movimento reduzido ativo e sem tela cheia.

Essa explicação da classificação da fixture é uma inferência da comparação local: o documento interceptado bloqueou CSS/scripts com erro de acesso a `loopback`; a resposta HTTP real passou no mesmo navegador. O [Playwright documenta que `fulfill` responde sem passar pela rede](https://playwright.dev/docs/network), e o [Chrome documenta a restrição entre espaços de endereçamento](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access).

`tests/monitor-compat.test.mjs` verifica fronteira anônima, pares de métricas atuais, contexto de uso, escape, SVG/volume no HTML e sintaxe clássica. A fixture é validada pelo schema atual de apresentação, sem alterar os defaults. `tests/monitor-compat-audio.test.mjs` exercita o adaptador WAV com mute, volume zero, deduplicação, interrupção e armazenamento bloqueado. `tests/runtime/monitor-compat.test.mjs` verifica o build empacotado, HTTPS encaminhado, Host proibido, iframe opaco, ausência de JavaScript, composição nativa, rolagem e filtros. Os testes de iframe React existentes usam `compat=0` para continuar cobrindo esse renderer.

Trocar User-Agent no Chromium atual verifica seleção e comportamento do código, não emula o motor de uma TV antiga. O aceite físico no equipamento final permanece necessário. Uma TV desconhecida pode impor limites de TLS, HTML/CSS, JavaScript, áudio e rede que o Pulse não controla.

Na validação local de 31/10/2026, `npm run check` passou com TypeScript, 254 testes unitários e build/empacotamento. O lint não encontrou erros; permanece um aviso preexistente de import não utilizado na navegação moderna. Seis cenários runtime selecionados passaram no build final, incluindo o iframe React existente e os novos testes clássicos. A rolagem foi conferida até a última linha e depois de refresh; badge foi verificado em 0/4/150. Servidores e dados eram isolados, sem usar a porta 3000 nem modificar configurações reais. Isso não registra execução da suíte completa de integração/Component/UI ou homologação física na TV.

Ao ampliar tipos de card ou contratos públicos, atualizar a apresentação compatível e suas fixtures. Não importar schemas/Prisma da cópia antiga nem remover campos novos para fazê-la aceitar um banco recente. Os 503 de `cardMetrics`/`usage` vistos naquela cópia eram incompatibilidades entre versões, não uma solução a portar para este app.

A revisão de zoom de 31/10/2026 também foi conferida por ADB numa TV com WebView 83, DPR 1,5 e iframe 1280×720: início sem zoom explícito, 50/70/100/125%, duas telas, overview/wall e modal preencheram o viewport. O app hospedeiro permaneceu com zoom 100%; somente a raiz do `/monitor` recebeu zoom. Isso registra o equipamento efetivamente testado, sem prometer compatibilidade com todo motor proprietário.

Monitor 01 encerrada pelo responsável em 31/10/2026, commit `acc08ba`, após validação física descrita acima. A evolução do zoom inicial e do volume pertence à etapa complementar Monitor 02.

Monitor 02: a configuração nova afeta somente `/monitor`; o editor apenas grava o valor no documento compartilhado. No clássico, o controle compacto conserva o adaptador de áudio, armazenamento, mute, zero, deduplicação e interrupção existentes. Não se tenta carregar o componente React na WebView que exige o renderer clássico.

Verificação Monitor 02 (31/10/2026): lint/TypeScript, 258 unitários, build e oito cenários selecionados de runtime passaram; nove testes de UI em ambiente isolado cobriram persistência real, primeiro HTML com zoom 70%, responsividade e separação entre escala privada e pública. O encaixe React também foi conferido em 1280×720. Na WebView 83 física, o cabeçalho compacto e o modal de som foram verificados em zoom manual de 70%, sem alterar a configuração compartilhada nem as preferências de áudio do responsável.

Verificação Monitor 03 (31/10/2026): check final com lint sem erros, TypeScript, 263 unitários e build/empacotamento; 13 testes runtime completos no artefato final, 68 integrações, 28 componentes e 72 cenários selecionados de interface passaram. Os quatro cenários específicos do monitor foram repetidos após o refinamento da captura de posição. O único aviso de lint continua sendo o import anterior não usado na navegação. Testes e configurações foram isolados, sem alterar dados reais, versão antiga ou APK. A rolagem não foi homologada fisicamente na TV nesta etapa. Não confundir a comparação por User-Agent com emulação de um motor antigo.
