# Monitor público em navegadores de TV

Esta camada pertence ao `/monitor` desta versão do aplicativo. O dashboard React continua sendo usado por navegadores modernos; equipamentos antigos recebem uma página pública renderizada no servidor, com os dados já presentes no HTML. Não depende da hidratação do Next.js para mostrar os cards.

## Problema atendido

O WebView de teste `83.0.4103.120` recusou os bundles modernos com `Unexpected token '='` e `Unexpected token '{'`. Os arquivos continham atribuição lógica (`??=`) e bloco estático de classe (`static {}`). Os requisitos de CSS moderno também impedem resolver o caso apenas com um polyfill de JavaScript. Essa falha é diferente do bloqueio de cookies/localStorage e de CORS em iframe com origem isolada; as correções anteriores desses casos permanecem.

Não existe garantia de funcionamento em qualquer TV desconhecida: TLS, suporte de HTML/CSS, permissão de JavaScript, políticas do aplicativo que contém o iframe e acesso à rede continuam dependendo do aparelho. A camada reduz as exigências do Pulse e inclui uma alternativa sem JavaScript; não contorna bloqueios do aplicativo hospedeiro.

## Seleção da página

- `proxy.ts` intercepta somente `GET`/`HEAD /monitor`. Chromium anterior a 111, Firefox anterior a 128, Safari/iOS anterior a 16.4 e agentes desconhecidos são encaminhados internamente para `/monitor/compat`, mantendo a URL e seus parâmetros.
- `/monitor?compat=1` força a camada em qualquer navegador. `/monitor/compat` é a entrada direta para diagnóstico.
- A página moderna contém um bootstrap clássico independente dos bundles. Se o agente se apresenta como moderno, mas não fornece as APIs, a sintaxe e a cor CSS exigidas, ele redireciona para `compat=1`. Sem JavaScript, um `noscript` também oferece esse caminho.
- As demais páginas autenticadas e subrotas de `/monitor` mantêm a implementação atual. Não foi rebaixado o alvo de compilação de todo o aplicativo.

## Dados e segurança

`lib/server/monitor-compat/read.ts` chama os handlers públicos existentes **dentro do processo**, para a apresentação e o overview da tela selecionada. Não faz uma requisição HTTP do servidor contra seu próprio endereço. O `Host` original precisa passar por `PULSE_PUBLIC_HOSTS`; `X-Forwarded-Host` não concede acesso. Authorization e cookies da requisição de entrada não são repassados para essas leituras, portanto a projeção é sempre anônima, inclusive se o visitante estiver logado em outra tela.

Não há worker, consulta adicional ao Zabbix, tabela, migration, dependência npm ou alteração de cadastros. As preferências continuam vindo do documento de apresentação existente. Sanitização pública de VPS/Storage/Signal continua sendo feita pelo BFF. Inventário de containers permanece indisponível ao visitante anônimo.

| Entrada | Resposta |
|---|---|
| `GET /monitor/compat` | HTML completo, CSS e scripts clássicos; `Cache-Control: no-store` |
| `GET /monitor/compat?fragment=1` | `{html, state}` com a tela pública atual, sem documento React/RSC |
| `screenId=<uuid>` | Seleciona uma tela habilitada; uma referência válida que deixou de existir usa a primeira tela reproduzível |
| `layout=overview\|wall`, `tv=0\|1`, `theme=dark\|light` | Preferências locais opcionais; não gravam configuração |

Valores inválidos retornam 400. Host não permitido retorna 403. Não há métodos de escrita. Respostas do modo compatível em hosts permitidos liberam CORS `*`, sem credenciais, para a atualização no iframe com `Origin: null`; o gate continua anterior à leitura. O mesmo header foi adicionado somente aos arquivos públicos `/sounds/notifications/*`, necessários para decodificar WAV em origem isolada. APIs privadas não foram alteradas.

A leitura inicial tem prazo de oito segundos. Falha inicial gera uma página de erro legível com nova tentativa, sem carregamento infinito. Falha ao atualizar conserva os valores e horários anteriores, sinaliza desatualização e retira a confirmação saudável. Divergência entre tela/revisão da apresentação e overview não é apresentada como uma combinação válida.

## Cards, composição e interação

`render.ts` reaproveita `storageLayout`, opções por bloco, resolução dos cards de disponibilidade, filtros, ordenação, disponibilidade e formatadores existentes. Mantém os dez tipos de bloco e os seis tipos de minicard desta versão. CPU/RAM respeitam a fonte resolvida; disco/capacidade e RX/TX do Storage vêm da seleção já calculada pelo BFF. A camada não soma filesystems por conta própria.

O CSS dedicado traduz a hierarquia e a paleta atuais para cores hexadecimais, tabelas e flexbox, sem Tailwind em tempo de execução, `oklch`, `color-mix`, variáveis CSS ou container queries. Usa fontes do sistema. Os minicards conservam 120px e largura normal de 230px; no split, quatro colunas. Todos os cards continuam disponíveis por rolagem, respeitando as fileiras configuradas. Larguras de blocos, empacotamento por UUID, escala da apresentação em TV/fullscreen e listas internas são mantidos. Fileiras contendo apenas disponibilidade têm altura pelo conteúdo.

O split sem Storage conserva a proporção original de colunas `1.25:1` e, sem Problemas, coloca Signal na posição superior direita e ASGARD abaixo. Com Storage, utiliza a composição por UUID já existente. Alturas reservam o mínimo necessário antes de distribuir o espaço restante, preservando a rolagem quando a tela não comporta o conteúdo.

O controlador ES5 usa XMLHttpRequest para atualizar somente o HTML do conteúdo. Não depende de Fetch, ResizeObserver, Intl ou armazenamento local. Não sobrepõe leituras; troca de tela descarta a resposta antiga. Preserva foco e rolagem das regiões internas, pausa alternância durante leitura/interação e não troca o corpo de um detalhe enquanto ele está aberto.

Há seleção/alternância de telas, formatos, modo TV, fullscreen quando permitido e detalhes locais dos minicards. Esses detalhes usam o snapshot atual, sem gráficos de histórico ou edição. A central compatível consulta as últimas 30 notificações e o estado compartilhado de leitura; não marca eventos como lidos. As telas administrativas, navegação operacional completa e seus formulários continuam na aplicação moderna.

Sem JavaScript, o HTML inicial ainda contém os cards e as leituras, e `noscript` agenda recarga completa conforme o intervalo. Alternância, atualização parcial, modais, sininho e áudio exigem JavaScript.

## Notificações e sons

O controlador consulta somente os GETs públicos existentes de notificações. Snapshot inicial e ressincronização são silenciosos. Mudanças posteriores respeitam `announce`, elegibilidade, leitura global, incidente encerrado, revisão de política e idade da ocorrência. Os avisos são sobrepostos, temporários e agrupados; conservam a posição configurada, até três grupos pendentes e o intervalo entre avisos. Aba oculta descarta a fila visual, enquanto o som pode ser entregue na chegada.

`monitor-compat-audio.js` é um adaptador ES5 do fluxo operacional, com os mesmos quatro WAVs Kobra (`notification`, `warning`, `error`, `success`). Usa AudioBufferSourceNode novo por reprodução, preferências `kobra-sound-muted`/`kobra-sound-volume`, volume zero, cooldown e chaves de deduplicação públicas existentes. Armazenamento bloqueado usa apenas estado local da página. Web Locks são opcionais; sem storage/locks não é possível coordenar a reprodução entre documentos isolados.

Uma interação confiável prepara/resume o AudioContext. Não há alarme repetitivo, áudio silencioso em loop, síntese ou reprodução adiada ao recuperar o foco. Sem Web Audio ou autorização do navegador/aplicativo, a exibição dos dados continua funcionando e o som pode permanecer indisponível. Detalhes semânticos e limites em [Sons da interface](interface-sounds.md).

## Validação

Nesta alteração, por solicitação explícita, **não foram instaladas dependências nem executados testes ou build**. A revisão de sintaxe não substitui verificação de tipos, build, testes de execução ou homologação física.

Foram preparados, sem execução:

- `tests/monitor-compat.test.mjs`: seleção de agentes, fronteira pública/credenciais, erros, escape de HTML/JSON, tipos de bloco, conservação dos cards e análise da sintaxe ES5/CSS dos arquivos clássicos.
- `tests/runtime/production.test.mjs`: servidor empacotado, seleção por UA, modo forçado, bootstrap, dados no HTML sem JS, origem isolada, storage bloqueado, detalhes, refresh, mute e restrições de acesso. A troca de UA nesse teste **não** emula o motor Chromium 83.

Para homologar no equipamento, usar primeiro a URL habitual `/monitor`; se a identificação do navegador for inadequada, comparar `/monitor?compat=1`. Confirmar cards e valores, horários, rolagem, duas telas quando configuradas, reconexão e mute/volume zero. Em iframe isolado, a atualização também precisa receber dados novos; terminar o indicador de carregamento não comprova o funcionamento. O teste real depende de uma versão do aplicativo que inclua estes arquivos e de acesso aos serviços já existentes.

Ao ampliar os cards no futuro, manter o renderer compatível alinhado com os contratos públicos e atualizar as verificações acima. Não importar componentes React, CSS compilado do Tailwind ou módulos de browser modernos no caminho clássico.
