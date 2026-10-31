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

O split sem Storage conserva a proporção original de colunas `1.25:1` e, sem Problemas, coloca Signal na posição superior direita e ASGARD abaixo. Com Storage, utiliza a composição por UUID já existente. Alturas reservam o mínimo necessário antes de distribuir o espaço restante, preservando a rolagem quando a tela não comporta o conteúdo.

O controlador ES5 usa XMLHttpRequest para atualizar somente o HTML do conteúdo. Não depende de Fetch, ResizeObserver, Intl ou armazenamento local. Não sobrepõe leituras; troca de tela descarta a resposta antiga. Preserva foco e rolagem das regiões internas, pausa alternância durante leitura/interação e não troca o corpo de um detalhe enquanto ele está aberto.

A alternância aguarda a requisição em andamento e só inicia um novo prazo após a tela efetivamente apresentada; atualizações periódicas da mesma tela não reiniciam esse prazo. Isso evita cancelar repetidamente uma resposta mais lenta que o intervalo dos slides. A identidade dos minicards inclui tipo, bloco e chave estável do recurso, preservando o alvo do foco quando os cards mudam de ordem.

Leituras/badges com `validUntil` conhecido carregam esse metadado no HTML. O relógio verifica expiração também nos detalhes abertos: mantém o valor antigo identificado, zera apenas a barra visual e retira confirmação de disponibilidade. Não inventa prazo quando a origem não o fornece. Diagnóstico não visível da leitura fica nos atributos `data-monitor-controller` e `data-connection` de `#compat-content`.

Há seleção/alternância de telas, formatos, modo TV, tema claro/escuro, fullscreen quando permitido e detalhes locais dos minicards. Mute, volume e teste de som continuam acessíveis no modo TV. Esses detalhes usam o snapshot atual, sem gráficos de histórico ou edição. A central compatível consulta as últimas 30 notificações e o estado compartilhado de leitura; não marca eventos como lidos. As telas administrativas, navegação operacional completa e seus formulários continuam na aplicação moderna.

Sem JavaScript, o HTML inicial ainda contém os cards e as leituras, e `noscript` agenda recarga completa conforme o intervalo. Alternância, atualização parcial, modais, sininho e áudio exigem JavaScript.

## Notificações e sons

O controlador consulta somente os GETs públicos existentes de notificações. Snapshot inicial e ressincronização são silenciosos. Mudanças posteriores respeitam `announce`, elegibilidade, leitura global, incidente encerrado, revisão de política e idade da ocorrência. Os avisos são sobrepostos, temporários e agrupados; conservam a posição configurada, até três grupos pendentes e o intervalo entre avisos. Aba oculta descarta a fila visual, enquanto o som pode ser entregue na chegada.

`monitor-compat-audio.js` é um adaptador ES5 do fluxo operacional, com os mesmos quatro WAVs Kobra (`notification`, `warning`, `error`, `success`). Usa AudioBufferSourceNode novo por reprodução, preferências `kobra-sound-muted`/`kobra-sound-volume`, volume zero, cooldown e chaves de deduplicação públicas existentes. Armazenamento bloqueado usa apenas estado local da página. Web Locks são opcionais; sem storage/locks não é possível coordenar a reprodução entre documentos isolados.

Uma interação confiável prepara/resume o AudioContext. Não há alarme repetitivo, áudio silencioso em loop, síntese ou reprodução adiada ao recuperar o foco. Sem Web Audio ou autorização do navegador/aplicativo, a exibição dos dados continua funcionando e o som pode permanecer indisponível. Detalhes semânticos e limites em [Sons da interface](interface-sounds.md).

## Validação

Nesta alteração, por solicitação explícita, **não foram instaladas dependências nem executados testes ou build**. A revisão de sintaxe não substitui verificação de tipos, build, testes de execução ou homologação física.

Foram preparados, sem execução:

- `tests/monitor-compat.test.mjs`: seleção de agentes, fronteira pública/credenciais, parâmetros duplicados, overview inválido, escape de HTML/JSON, tipos de bloco, conservação/identidade dos cards e análise da sintaxe ES5/CSS dos arquivos clássicos.
- `tests/runtime/production.test.mjs`: servidor empacotado, loopback com allowlist exclusiva do IP, Host forjado, seleção por UA/iframe moderno, modo forçado, bootstrap, dados no HTML sem JS, origem isolada, storage bloqueado, detalhes, refresh, mute e WAVs. Cobre ainda sucesso pendente seguido de falha no modal, resposta inválida, expiração e alternância com leitura de seis segundos e intervalo de cinco. A troca de UA nesse teste **não** emula o motor Chromium 83.
- Os testes de iframe React usam `compat=0`, para continuar exercitando esse caminho independentemente da seleção automática do clássico.

O log de CI fornecido pelo desenvolvedor mostrou 63 integrações aprovadas e 7 de 8 testes runtime aprovados; o teste clássico falhou com 403 em `old-ua`. A correção de origem descrita acima responde a essa falha. O aviso `.env not found` não era a asserção que falhou: o teste prepara seu ambiente pelo processo filho. Esta revisão não foi executada novamente no CI pelo agente.

Os recursos de pares Agent/VM e texto detalhado de limites existentes somente na versão mais recente não foram transplantados para esta versão. A entrada direta moderna continua React; `idlePresentation` e a central completa continuam fora da paridade clássica atual. A homologação visual/física e os checks completos permanecem pendentes, conforme a restrição de não instalar/executar nesta cópia.

Para homologar no equipamento, usar primeiro a URL habitual `/monitor`; se a identificação do navegador for inadequada, comparar `/monitor?compat=1`. Confirmar cards e valores, horários, rolagem, duas telas quando configuradas, reconexão e mute/volume zero. Em iframe isolado, a atualização também precisa receber dados novos; terminar o indicador de carregamento não comprova o funcionamento. O teste real depende de uma versão do aplicativo que inclua estes arquivos e de acesso aos serviços já existentes.

Ao ampliar os cards no futuro, manter o renderer compatível alinhado com os contratos públicos e atualizar as verificações acima. Não importar componentes React, CSS compilado do Tailwind ou módulos de browser modernos no caminho clássico.
