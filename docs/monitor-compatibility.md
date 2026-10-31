# Monitor público em navegadores de TV

Esta camada pertence ao `/monitor` desta versão do aplicativo. O dashboard React continua sendo usado por navegadores modernos; equipamentos antigos recebem uma página pública renderizada no servidor, com os dados já presentes no HTML. Não depende da hidratação do Next.js para mostrar os cards.

## Problema atendido

O WebView de teste `83.0.4103.120` recusou os bundles modernos com `Unexpected token '='` e `Unexpected token '{'`. Os arquivos continham atribuição lógica (`??=`) e bloco estático de classe (`static {}`). Os requisitos de CSS moderno também impedem resolver o caso apenas com um polyfill de JavaScript. Essa falha é diferente do bloqueio de cookies/localStorage e de CORS em iframe com origem isolada; as correções anteriores desses casos permanecem.

Não existe garantia de funcionamento em qualquer TV desconhecida: TLS, suporte de HTML/CSS, permissão de JavaScript, políticas do aplicativo que contém o iframe e acesso à rede continuam dependendo do aparelho. A camada reduz as exigências do Pulse e inclui uma alternativa sem JavaScript; não contorna bloqueios do aplicativo hospedeiro.

## Seleção da página

- `proxy.ts` intercepta somente `GET`/`HEAD /monitor`. Requisições identificadas como iframe por `Sec-Fetch-Dest: iframe`, Chromium anterior a 111, Firefox anterior a 128, Safari/iOS anterior a 16.4 e agentes desconhecidos são encaminhados internamente para `/monitor/compat`, mantendo a URL e seus parâmetros.
- `/monitor?compat=1` força a camada em qualquer navegador, inclusive TVs sem identificação confiável. `/monitor?compat=0` seleciona explicitamente a página React para comparação em navegador moderno. `/monitor/compat` é a entrada direta para diagnóstico.
- A página moderna contém um bootstrap clássico independente dos bundles. Se o agente se apresenta como moderno, mas não fornece as APIs, a sintaxe e a cor CSS exigidas, ele redireciona para `compat=1`. Sem JavaScript, um `noscript` também oferece esse caminho.
- As demais páginas autenticadas e subrotas de `/monitor` mantêm a implementação atual. Não foi rebaixado o alvo de compilação de todo o aplicativo.

O rewrite usa `new URL(request.url)` e `skipProxyUrlNormalize: true`, opção suportada pelo Next desta versão. `NextURL` normaliza loopback (`127.0.0.1`/`[::1]`) para `localhost`; usar sua cópia como destino fazia a leitura retornar 403 quando somente o IP estava permitido. A combinação preserva a origem de entrada e impede o rewrite de virar uma chamada HTTP para outro hostname. O gate de Host continua estrito: não foram adicionados aliases à allowlist e não se confia em headers encaminhados para contorná-lo. A opção atua sobre o Proxy, cujo matcher permanece restrito a `/monitor`.

## Dados e segurança

`lib/server/monitor-compat/read.ts` chama os handlers públicos existentes **dentro do processo**, para a apresentação e o overview da tela selecionada. Não faz uma requisição HTTP do servidor contra seu próprio endereço. O `Host` original precisa passar por `PULSE_PUBLIC_HOSTS`; `X-Forwarded-Host` não concede acesso. Authorization e cookies da requisição de entrada não são repassados para essas leituras, portanto a projeção é sempre anônima, inclusive se o visitante estiver logado em outra tela.

Não há worker, consulta adicional ao Zabbix, tabela, migration, dependência npm ou alteração de cadastros. As preferências continuam vindo do documento de apresentação existente. Sanitização pública de VPS/Storage/Signal continua sendo feita pelo BFF. Inventário de containers permanece indisponível ao visitante anônimo.

| Entrada | Resposta |
|---|---|
| `GET /monitor/compat` | HTML completo, CSS e scripts clássicos; `Cache-Control: no-store` |
| `GET /monitor/compat?fragment=1` | `{html, state}` com a tela pública atual, sem documento React/RSC |
| `screenId=<uuid>` | Seleciona uma tela habilitada; uma referência válida que deixou de existir usa a primeira tela reproduzível |
| `layout=overview\|wall`, `tv=0\|1`, `theme=dark\|light` | Preferências locais opcionais; não gravam configuração |

Valores inválidos e parâmetros duplicados retornam 400. Host não permitido retorna 403. Não há métodos de escrita. Respostas do modo compatível em hosts permitidos liberam CORS `*`, sem credenciais, para a atualização no iframe com `Origin: null`; o gate continua anterior à leitura. O envelope do overview é validado antes de aceitar a leitura, sem descartar campos opcionais do payload original. APIs privadas não foram alteradas.

`GET /monitor/compat/audio/:sound` fornece somente os quatro WAVs existentes (`notification`, `warning`, `error`, `success`), com gate de Host e CORS anônimo. Nomes diferentes retornam 404. Essa rota lê os arquivos já copiados em `public` para o runtime; não aceita um caminho de arquivo arbitrário. A regra global de CORS em `/sounds/notifications/*` foi removida, mantendo a extensão de áudio restrita ao namespace do monitor. O documento/fragmento também recebe `no-referrer` e `noindex`.

A leitura inicial tem prazo de oito segundos. Falha inicial gera uma página de erro legível com nova tentativa, sem carregamento infinito. Falha ao atualizar conserva os valores e horários anteriores, sinaliza desatualização e retira a confirmação saudável. Divergência entre tela/revisão da apresentação e overview não é apresentada como uma combinação válida.

Falhas sucessivas têm recuo limitado a 120 segundos; uma atualização válida restaura o intervalo do BFF. O botão Atualizar permite nova tentativa imediata. O cliente valida os metadados do fragmento antes de trocar conteúdo, e uma falha elimina qualquer atualização pendente de modal. Fechar o modal não reaplica um snapshot anterior ao erro nem redefine o relógio para a hora daquela resposta antiga.

## Cards, composição e interação

`render.ts` reaproveita `storageLayout`, opções por bloco, resolução dos cards de disponibilidade, filtros, ordenação, disponibilidade e formatadores existentes. Mantém os dez tipos de bloco e os seis tipos de minicard desta versão. CPU/RAM respeitam a fonte resolvida; disco/capacidade e RX/TX do Storage vêm da seleção já calculada pelo BFF. A camada não soma filesystems por conta própria.

O CSS dedicado traduz a hierarquia e a paleta atuais para cores hexadecimais, tabelas e flexbox, sem Tailwind em tempo de execução, `oklch`, `color-mix`, variáveis CSS ou container queries. Usa fontes do sistema. Os minicards conservam 120px e largura normal de 230px; no split, quatro colunas. Todos os cards continuam disponíveis por rolagem, respeitando as fileiras configuradas. Larguras de blocos, empacotamento por UUID, escala da apresentação em TV/fullscreen e listas internas são mantidos. Fileiras contendo apenas disponibilidade têm altura pelo conteúdo.

### Ícones e volume na WebView

A revisão do APK de referência `TVIframeTester` não identificou filtro de ícones ou scripts: JavaScript e DOM storage estão habilitados, a interceptação atende os assets locais do APK, e o iframe HTTPS permite fullscreen/autoplay, sem `sandbox`. O navegador moderno e a TV podem selecionar renderers diferentes do Pulse; funcionar no navegador normal não comprova paridade da página compatível.

No HTML compatível publicado antes deste ajuste, havia apenas dois SVGs (marca e sininho). Os painéis usavam caracteres de fonte (`▤`, `◇`, `∿`, `⚠`), e vários comandos e indicadores não tinham ícone. O volume era criado pelo JavaScript somente após carregar o adaptador de áudio. Isso deixava o componente ausente caso o controlador/adaptador não concluísse; o cabeçalho em tabela, sem quebra de linha, também podia colocar controles fora da área visível. Essas fragilidades foram confirmadas no código; não houve diagnóstico remoto do console da TV que comprove uma falha específica no download do áudio.

`lib/server/monitor-compat/icons.ts` agora serializa os paths locais Tabler em SVG inline, com namespace, `viewBox`, dimensões, cor e traço explícitos. Painéis, indicadores e controles não dependem de uma fonte de símbolos, sprite externo, CDN ou hidratação React. Rótulos variáveis usam spans próprios, para a troca de tema/TV/fullscreen/alternância não apagar o SVG ao atualizar `textContent`. A licença dos paths acompanha o módulo.

Mute, slider, percentual e teste de som fazem parte do HTML inicial, inclusive em TV e sem JavaScript. São habilitados quando o adaptador fica pronto, usando as mesmas preferências Kobra. Falha/atraso no arquivo de áudio informa indisponibilidade sem remover o controle nem interromper atualização, detalhes e alternância dos cards. Sem Web Audio, as preferências continuam acessíveis e o teste permanece desabilitado. O ícone reflete mute e volume zero; reativar em zero restaura 50%, sem reproduzir notificações anteriores. O cabeçalho usa flexbox com quebra de linha e margens, sem depender de `gap`, para acomodar os controles na largura disponível.

Não foi alterado o APK nem o aplicativo moderno. Esta correção precisa estar na versão do Pulse servida à TV; não exige recompilar o APK de referência. A confirmação no motor e na tela reais permanece necessária, inclusive para permissões de áudio.

### Encaixe automático na área visível

O encaixe anterior combinava alturas mínimas fixas, estimativas de espaçamento, linhas em tabela e `zoom` CSS quando disponível. Se a composição mínima não coubesse, a página crescia; aplicar outro zoom no APK não fazia esse cálculo medir novamente a composição na mesma referência. A página compatível agora mede e ocupa a área que o navegador disponibiliza, a cada tela, sem um percentual fixo de 70%.

`#compat-viewport` delimita a área visível. O controlador usa `VisualViewport` quando disponível, com fallback para `innerWidth`/`innerHeight` e `clientWidth`/`clientHeight`. Não limita o viewport visual à menor medida de `innerWidth`: ao reduzir o zoom, a área visível pode comportar mais pixels CSS. Não usa a resolução física de `screen`: em iframe, a referência é o viewport do próprio documento incorporado, conforme [VisualViewport — MDN](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport). A largura/altura do iframe continuam sendo responsabilidade de quem o incorpora.

O shell usa uma área lógica com dimensões explícitas e `transform: scale()`, com origem no canto superior esquerdo. O fator automático e o zoom externo são calculados separadamente, pois as propriedades afetam o layout de formas diferentes, conforme [zoom — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/zoom). Reduzir o zoom preserva o texto menor e amplia a área lógica, mantendo o conjunto em toda a tela; não se amplia novamente a fonte para anular a escolha. O controlador não apaga `shell.style.zoom`. A largura lógica mínima de 1200px conserva as colunas salvas em WebViews que expõem uma área CSS pequena. A escala de apresentação continua sendo a preferência máxima em TV/fullscreen; quando a composição não cabe, o controlador procura a maior escala automática que comporte largura e altura. Essa adaptação é local, não grava outra escala no PostgreSQL nem muda a configuração dos blocos.

Uma referência invisível de 100px, fora da transformação do shell, mede a relação entre dimensões lógicas e renderizadas. Outra referência com `zoom: 2` identifica a convenção de `getBoundingClientRect()` do motor: navegadores antigos podem descontar o zoom CSS efetivo, enquanto os atuais o incluem. Nesse caso legado, `effectiveZoom` recompõe o produto dos fatores dos ancestrais e `viewportRect` normaliza as posições antes de encaixar a área. Não depende da API recente `currentCSSZoom`. Contexto: [MDN — zoom efetivo e medidas](https://developer.mozilla.org/en-US/docs/Web/API/Element/currentCSSZoom) e [alteração dos retângulos no Chromium](https://bugzilla.mozilla.org/show_bug.cgi?id=1870835).

O viewport recebe largura e altura compensadas pelo zoom externo, e o shell recebe as dimensões lógicas correspondentes. O recorte do documento fica no elemento raiz; o `body` permite passar a área fixa expandida, evitando cortar o conteúdo no seu retângulo reduzido. Modais não acrescentam uma segunda trava no body quando esse encaixe está ativo. Isso corrige as margens vazias à direita e abaixo que o cálculo anterior produzia ao receber zoom de 70% depois da carga.

Flexbox reserva as alturas reais do cabeçalho, controles, avisos, indicadores e legenda. A grade recebe a altura restante, sem subtrair estimativas fixas para essas regiões. Fileiras compostas só por Disponibilidade mantêm a altura real dos cards, limitada pelas opções do bloco. As demais fileiras recebem seu mínimo e dividem a sobra, inclusive após alternar telas com composições diferentes. Os painéis permanecem inteiros; tabelas, volumes e listas longas mantêm rolagem interna. Os minicards conservam 120px na área lógica, escalados junto com o conjunto.

O corpo `.panel-content` participa do flex do painel com `min-height: 0` e `flex: 1 1 auto`, mas organiza seus filhos em fluxo de bloco. Faixa de disponibilidade, KPIs, textos e tabelas mantêm sua altura natural, produzindo overflow real quando o painel fica baixo. Isso evita que a faixa ou a tabela do Signal sejam reduzidas a zero, sem conteúdo alcançável. Cabeçalho e rodapé continuam fora da área rolável. No encaixe ativo, tabelas e inventários deixam o corpo ser o dono da rolagem vertical, sem uma segunda altura máxima dentro dele; fora desse encaixe, o limite de linhas da tabela continua disponível. A grade de minicards mantém seu limite próprio.

O corpo é uma região com nome e `tabindex="0"`, permitindo foco e rolagem por teclado, além de roda/toque. Scrollbars WebKit recebem trilho e thumb com contraste nos dois temas, com fallback nativo nos demais motores. A atualização salva também a posição/foco desse corpo e os restaura **depois** de recalcular as alturas, para o novo DOM não limitar `scrollTop` prematuramente a zero. A rolagem da página continua bloqueada no modo ajustado.

O ajuste reage a resize, orientação, carregamento, retorno à página, troca de tela/layout/TV/tema, novas leituras e alterações do cabeçalho/áudio. Observa também mudanças de zoom/estilo nos contêineres, quando MutationObserver está disponível. A cada segundo, o relógio existente compara uma assinatura de viewport/zoom e só recalcula se ela mudou; isso cobre zoom que não dispara resize, sem uma nova consulta ou timer de dados. `VisualViewport.resize`/`scroll` e MutationObserver são opcionais; não depende de ResizeObserver ou novas APIs obrigatórias. Modais e toasts ficam fora da transformação automática do shell e preservam sua interação. As proporções do split (`1.25:1` no caminho legado), UUIDs, larguras e ordenação continuam vindo da composição atual.

A trava de rolagem do documento só é ativada pelo controlador compatível. Sem JavaScript, sem transformações suportadas ou se o motor não permitir encontrar um encaixe válido, o conteúdo mantém o fluxo normal e continua acessível. Essa regra não se aplica à página React, às rotas autenticadas ou ao restante do app. Não se deve portar a trava globalmente.

Para conferir na TV, abrir `/monitor` e variar o zoom entre **100%, 70% e 125% sem recarregar**, alternando também as telas em cada percentual. A 70%, os elementos devem continuar menores, com mais área lógica disponível e sem aumentar as margens externas. Cabeçalho, painéis e legenda devem permanecer dentro do iframe, sem rolagem da página; a fileira flexível inferior deve aproveitar a altura restante. Não é necessário manter o APK em 100%. Conferir também redimensionamento, mute/volume e abertura dos detalhes. O diagnóstico está em `#compat-viewport`: `data-fit-state`, `data-fit-scale`, `data-fit-width`, `data-fit-height`, `data-fit-zoom-x/y` e `data-fit-rect-mode`. `ready` informa que o controlador calculou o encaixe; a homologação visual no aparelho ainda é necessária.

O controlador ES5 usa XMLHttpRequest para atualizar somente o HTML do conteúdo. Não depende de Fetch, ResizeObserver, Intl ou armazenamento local. Não sobrepõe leituras; troca de tela descarta a resposta antiga. Preserva foco e rolagem das regiões internas, pausa alternância durante leitura/interação e não troca o corpo de um detalhe enquanto ele está aberto.

A alternância aguarda a requisição em andamento e só inicia um novo prazo após a tela efetivamente apresentada; atualizações periódicas da mesma tela não reiniciam esse prazo. Isso evita cancelar repetidamente uma resposta mais lenta que o intervalo dos slides. A identidade dos minicards inclui tipo, bloco e chave estável do recurso, preservando o alvo do foco quando os cards mudam de ordem.

Leituras/badges com `validUntil` conhecido carregam esse metadado no HTML. O relógio verifica expiração também nos detalhes abertos: mantém o valor antigo identificado, zera apenas a barra visual e retira confirmação de disponibilidade. Não inventa prazo quando a origem não o fornece. Diagnóstico não visível da leitura fica nos atributos `data-monitor-controller` e `data-connection` de `#compat-content`.

Há seleção/alternância de telas, formatos, modo TV, tema claro/escuro, fullscreen quando permitido e detalhes locais dos minicards. Mute, volume e teste de som continuam acessíveis no modo TV. Esses detalhes usam o snapshot atual, sem gráficos de histórico ou edição. A central compatível consulta as últimas 30 notificações e o estado compartilhado de leitura; não marca eventos como lidos. As telas administrativas, navegação operacional completa e seus formulários continuam na aplicação moderna.

Sem JavaScript, o HTML inicial ainda contém os cards e as leituras, e `noscript` agenda recarga completa conforme o intervalo. Alternância, atualização parcial, modais, sininho e áudio exigem JavaScript.

## Notificações e sons

O sininho tem badge vermelho posicionado sobre o ícone quando `unreadCount > 0`. Usa o número até 99 e `99+` acima disso; zero/estado inicial não exibem badge. O nome acessível conserva o total completo de não lidas e incidentes atuais. A contagem permanece no badge ao atualizar a central, sem substituir o SVG do sino, e não depende do CSS moderno do Kobra carregado em outra rota.

O controlador consulta somente os GETs públicos existentes de notificações. Snapshot inicial e ressincronização são silenciosos. Mudanças posteriores respeitam `announce`, elegibilidade, leitura global, incidente encerrado, revisão de política e idade da ocorrência. Os avisos são sobrepostos, temporários e agrupados; conservam a posição configurada, até três grupos pendentes e o intervalo entre avisos. Aba oculta descarta a fila visual, enquanto o som pode ser entregue na chegada.

`monitor-compat-audio.js` é um adaptador ES5 do fluxo operacional, com os mesmos quatro WAVs Kobra (`notification`, `warning`, `error`, `success`). Usa AudioBufferSourceNode novo por reprodução, preferências `kobra-sound-muted`/`kobra-sound-volume`, volume zero, cooldown e chaves de deduplicação públicas existentes. Armazenamento bloqueado usa apenas estado local da página. Web Locks são opcionais; sem storage/locks não é possível coordenar a reprodução entre documentos isolados.

Uma interação confiável prepara/resume o AudioContext. Não há alarme repetitivo, áudio silencioso em loop, síntese ou reprodução adiada ao recuperar o foco. Sem Web Audio ou autorização do navegador/aplicativo, a exibição dos dados continua funcionando e o som pode permanecer indisponível. Detalhes semânticos e limites em [Sons da interface](interface-sounds.md).

## Validação

Nesta alteração, por solicitação explícita, **não foram instaladas dependências nem executados testes ou build**. A revisão de sintaxe não substitui verificação de tipos, build, testes de execução ou homologação física.

Na revisão posterior do CI, o lint interrompeu `npm run check` no teste de retângulos legados por `@typescript-eslint/no-this-alias`. A simulação passou a calcular o zoom em uma função que recebe o elemento, preservando o uso de `this` apenas na chamada do método original. Os avisos de catches e diretivas dos scripts clássicos também foram corrigidos, mantendo os bindings obrigatórios do ES5 e as regras de lint ativas. O import não utilizado de WhatsApp ficou comentado junto com a funcionalidade já reservada, sem remover seu código.

Após essa correção, o ESLint analisou **434 arquivos: zero erros e zero avisos**. Foi usada a configuração do próprio projeto, com dependências já disponíveis cujas versões foram conferidas contra o lockfile; a versão do React foi informada em memória a partir do lockfile para substituir a autodetecção nesta cópia sem `node_modules`. Não houve instalação, alteração da configuração de lint ou escrita no projeto mais recente. Sintaxe dos testes e sintaxe ES5 dos três scripts clássicos também foram revistas. Typecheck, execução dos testes e build continuam sem execução local nesta cópia.

Foram preparados, sem execução:

- `tests/monitor-compat.test.mjs`: seleção de agentes, fronteira pública/credenciais, parâmetros duplicados, overview inválido, escape de HTML/JSON, tipos de bloco, conservação/identidade dos cards, SVGs/volume presentes no HTML inicial e análise da sintaxe ES5/CSS dos arquivos clássicos.
- `tests/runtime/production.test.mjs`: servidor empacotado, loopback com allowlist exclusiva do IP, Host forjado, seleção por UA/iframe moderno, modo forçado, bootstrap, dados no HTML sem JS, origem isolada, storage bloqueado, detalhes, refresh, mute e WAVs. Cobre ainda sucesso pendente seguido de falha no modal, resposta inválida, expiração e alternância com leitura de seis segundos e intervalo de cinco. A troca de UA nesse teste **não** emula o motor Chromium 83.
- Os testes de iframe React usam `compat=0`, para continuar exercitando esse caminho independentemente da seleção automática do clássico.
- O runtime também verifica ícones após atualizar rótulos, volume visível em TV e sem JavaScript, mute/zero, falha do asset de áudio e ausência de Web Audio sem impedir os dados. Esses cenários novos foram preparados, sem execução nesta cópia.
- O cenário de encaixe cobre as duas telas de demonstração em iframe isolado menor que a janela, DPI 2 e ausência de VisualViewport; redimensiona entre 1920×1080, 1280×720, 960×540 e 640×360, retornando à tela grande. Verifica limites dos painéis, ausência de overflow do documento, legenda junto ao limite inferior, distribuição das fileiras e escala automática. Também foi preparado sem execução.
- Esse cenário também prepara zoom CSS dinâmico de 70%, 125% e 100% no body, raiz e shell, sem disparar resize manualmente. Confere preenchimento da área, texto menor a 70%, ampliação lógica e preservação do zoom ao trocar de tela. Repete a verificação em uma simulação da convenção antiga de retângulos, conservando o método nativo como referência de renderização. Outro caso simula uma API de viewport visual maior que `innerWidth`, verificando detecção pelo relógio sem evento. Essas simulações não substituem a WebView real, e não foram executadas localmente.
- Outro cenário runtime prepara um viewport baixo, inventário de VMs extenso e contagens 4/0/150. Confere badge vermelho/oculto/`99+`, rolagem por roda e tecla End em ASGARD e Signal, acesso à última linha, preservação da posição após atualizar e ausência de overflow da página. Usa somente dados de demonstração e interceptações locais de leitura, sem cadastro ou escrita no banco. Preparado, sem execução.

O log de CI fornecido pelo desenvolvedor mostrou 63 integrações aprovadas e 7 de 8 testes runtime aprovados; o teste clássico falhou com 403 em `old-ua`. A correção de origem descrita acima responde a essa falha. O aviso `.env not found` não era a asserção que falhou: o teste prepara seu ambiente pelo processo filho. Esta revisão não foi executada novamente no CI pelo agente.

No retorno seguinte, o CI aprovou 8 de 9 testes runtime, incluindo o controlador com leitura lenta. O teste clássico avançou pelos cenários de carregamento e parou na tentativa de enviar um Host proibido por `fetch`: recebeu 200, pois o Fetch/Undici do Node analisado remove esse header e o deriva da URL. A fixture `tests/fixtures/http-host.mjs` passou a usar `node:http` para enviar o Host real, sem relaxar a asserção 403 ou alterar a proteção do aplicativo. `tests/http-host.test.mjs` verifica o cabeçalho recebido por um servidor HTTP isolado. O runtime também verifica que `X-Forwarded-Host` não concede acesso, e que o áudio recusa Host não permitido. Esses ajustes ficaram preparados, sem execução local nesta cópia.

Os recursos de pares Agent/VM e texto detalhado de limites existentes somente na versão mais recente não foram transplantados para esta versão. A entrada direta moderna continua React; `idlePresentation` e a central completa continuam fora da paridade clássica atual. A homologação visual/física e os checks completos permanecem pendentes, conforme a restrição de não instalar/executar nesta cópia.

Para homologar no equipamento, usar primeiro a URL habitual `/monitor`; se a identificação do navegador for inadequada, comparar `/monitor?compat=1`. Confirmar cards e valores, horários, rolagem, duas telas quando configuradas, reconexão e mute/volume zero. Em iframe isolado, a atualização também precisa receber dados novos; terminar o indicador de carregamento não comprova o funcionamento. O teste real depende de uma versão do aplicativo que inclua estes arquivos e de acesso aos serviços já existentes.

Ao ampliar os cards no futuro, manter o renderer compatível alinhado com os contratos públicos e atualizar as verificações acima. Não importar componentes React, CSS compilado do Tailwind ou módulos de browser modernos no caminho clássico.
