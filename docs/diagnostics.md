# Diagnóstico de erros no container

O app escreve uma linha JSON por ocorrência no stdout/stderr do processo web. Não há nova variável de ambiente, serviço, dependência ou migration. Os logs são ativados ao publicar a imagem atualizada. A retenção/rotação do arquivo de logs continua responsabilidade do Docker/host.

## Eventos

| Evento | Uso |
|---|---|
| `http_diagnostics_ready` | Confirma que o pacote instalou o observador HTTP e informa `maxHeaderBytes`. |
| `http_request_rejected` | Falha de parser antes de existir uma rota, incluindo `HPE_HEADER_OVERFLOW`/431. Registra código, limite, bytes do fragmento recebido e tamanhos observados de Authorization/Cookie, nunca os valores. |
| `application_request_failed` | Erro tratado de autenticação, BFF privado/público, healthcheck ou erro inesperado capturado pelo Next. Inclui status, código, rota sem query string, método, `requestId`, contagens de bytes e causas técnicas seguras. |
| `auth_session_issued` | A cada login/refresh bem-sucedido, informa tamanhos dos tokens/envelopes/usuário e quantidades de acessos/permissões. Permite verificar crescimento entre renovações da mesma sessão sem registrar sua credencial ou identidade pessoal. |

Os erros tratados preservam exatamente seus status e corpos públicos. O cabeçalho `X-Request-ID` permite relacionar uma resposta com o log. No parser não há Request completo; seu identificador existe apenas no log, e as medidas `*InChunk` podem representar um fragmento, não o cabeçalho inteiro. Uma rejeição no proxy anterior ao container exige os logs desse proxy e não aparecerá no app.

As causas mostram nomes/códigos técnicos (por exemplo `ECONNREFUSED`, `P1001`, `42P01`), motivo de autenticação e status retornado pelo upstream. Frames são reduzidos a arquivo/linha/coluna. Mensagens brutas de exceção, SQL, URL de conexão, corpos, senha, token, cookies, API key e query string não são registrados. Erros repetidos equivalentes são limitados a uma linha por 30 segundos; a próxima ocorrência depois da janela informa quantas foram suprimidas. As estruturas de limitação têm tamanho máximo. Uma falha de escrita de log não substitui a resposta original.

## Onde consultar

No Portainer, abrir os logs do serviço/container **web do Pulse**. Para Swarm:

```sh
docker service logs --since 30m --timestamps --follow NOME_DO_SERVICO_WEB
```

Para um container individual:

```sh
docker logs --since 30m --timestamps --follow NOME_DO_CONTAINER_WEB
```

Os nomes acima são marcadores: usar o nome da instalação. Logs de Redis/PostgreSQL ajudam em dependências, mas não mostram uma requisição HTTP recusada antes do BFF.

## HTTP 431 e uso contínuo

Auditoria de 25/11/2026:

- `pulse.auth.v1` é sobrescrito; o refresh guarda somente o token corporativo atual. O merge do usuário substitui arrays quando recebidos, e mantém os anteriores somente quando o campo está ausente. Não há concatenação de sessões ou recifragem recursiva de envelopes.
- `Authorization` é sobrescrito pelo interceptor, não anexado a cada polling/repetição. No formato anterior, o token corporativo e as listas completas iam dentro dele; poderiam estar grandes já no login ou crescer na API corporativa. O formato compacto remove esses campos do header.
- Claims de áudio React têm janela de três minutos e até 1000 IDs; a memória de eventos vistos é reduzida quando passa de 5000. O clássico também limita eventos vistos. Esses dados locais não são enviados como cabeçalho. Preferências de tema/áudio também não são cabeçalhos.
- O cookie criado pelo componente de sidebar contém somente `true`/`false`. Cookies de outras aplicações no domínio não foram inspecionados. O responsável reproduziu o erro em janela anônima, reduzindo a hipótese de cookies antigos acumulados naquele navegador.
- O histórico no PostgreSQL pode crescer: a manutenção preserva ocorrências ativas e eventos não lidos, além das condições de retenção. Respostas e cursores podem refletir esse histórico, mas ele não entra no Authorization. Isso pode exigir análise própria de volume/desempenho; não demonstra a causa de um 431.

Um teste simula 200 renovações, aumentando o token corporativo e as listas de permissões, e verifica substituição e tamanho constante do access compacto. Não equivale a deixar a instalação real ligada por vários dias. O teste HTTP com perfil artificial grande reproduz 431 com o envelope antigo de 41313 bytes e 200 com 327 bytes no novo. O token real de produção não foi coletado; os novos eventos de tamanho permitem confirmar sua evolução na instalação.

## Implementação e limites

`lib/server/diagnostics.ts` centraliza dados seguros. `instrumentation.ts` usa `onRequestError` do Next para falhas inesperadas. O empacotamento carrega `http-diagnostics.cjs` antes do servidor standalone. O observador envolve a emissão de `clientError` de cada servidor criado e delega ao método original, preservando retorno, listeners, status e fechamento de sockets; não instala um listener que tomaria posse do tratamento nativo de 431. Também cria a correlação nas requisições válidas. HTTP e HTTPS são cobertos.

A captura do parser é instalada no **standalone empacotado**. Em `next dev`, os logs do BFF e do Next estão presentes, mas o bootstrap do parser é específico do pacote de produção. Nada altera os limites HTTP, políticas de autenticação, layouts, zoom, rolagem ou distribuição dos painéis.

Testes cobrem ausência de segredos, preservação do contrato HTTP, falha do destino de logs, limitação de repetições, tratamento nativo/customizado do parser e o arquivo já empacotado. A regressão de rolagem estabiliza somente o relógio virtual do teste antes de iniciar o controlador, sem mudar o código de rolagem ou as expectativas de posição.

## Validação — 25/11/2026

- `npm run check`: lint, tipos, **319 testes unitários** e build aprovados; permanece somente o aviso preexistente de `IconBrandWhatsapp` não utilizado.
- `npm run test:integration`: **86/86** aprovados.
- E2E de autenticação (`tests/e2e/login.spec.ts`): **18/18** aprovados, incluindo duas abas, sessão antiga grande e 431 persistente sem logout indevido.
- `npm run test:runtime`: **29/29** aprovados no pacote final, incluindo parser HTTP, autenticação com perfil corporativo grande, rotas protegidas e regressões do monitor clássico.

Durante a verificação, o bootstrap foi ajustado para usar `import` no servidor standalone ESM e `require` no CommonJS; empacotamento e lint dos scripts foram reexecutados, e a suíte runtime completa acima usa essa versão final. Execução local em Windows; não houve nova execução integral dos shards E2E, teste de vários dias na instalação real ou deploy. O CI Linux e a confirmação do cabeçalho efetivo de produção continuam pendentes. Sem commit, push ou alterações de preferências operacionais.
