# Ambiente e publicação

## Versões e instalação

Base validada em 02/10/2026: Next.js **16.3.8**, React **19.3.0**, Tailwind **4.3.3**, TypeScript **5.9.3**, Prisma **7.10.0** e cliente Redis **6.3.0**. Dependências diretas têm versões exatas; `package-lock.json` fixa a árvore.

Next 16 está na linha Active LTS da [política oficial](https://nextjs.org/support-policy). A escolha usa o patch estável dessa linha. Não se copiou Next 14 da referência. Node **24 LTS** é a linha de execução: `.nvmrc`, CI e imagem usam **24.21.0**; o host Windows foi validado com **24.20.0** e npm **11.19.0**, compatíveis com `engines`. Ver [ciclo do Node](https://nodejs.org/en/about/previous-releases). Prisma 7 mantém os comandos `migrate dev` e `migrate deploy` exigidos; não foi adotada a versão candidata do Prisma 8. Ver [CLI Prisma 7](https://docs.prisma.io/docs/cli/v7).

O ESLint 10 usa o adaptador oficial `@eslint/compat` para os plugins React, import e acessibilidade da configuração Next, cujas faixas publicadas ainda terminam no ESLint 9. Overrides específicos alinham esses peers ao ESLint instalado; não há `legacy-peer-deps`. A compatibilidade foi exercitada por lint e typecheck. Ver [utilitários oficiais de compatibilidade](https://eslint.org/blog/2024/05/eslint-compatibility-utilities/).

Dois overrides de segurança ficam restritos às dependências Prisma: `@prisma/config → deepmerge-ts 8.0.2` e `prisma → mysql2 3.24.5`. A configuração, o baseline e o deploy Prisma foram testados com eles. Reavaliar os overrides quando o Prisma incorporar as correções. A auditoria npm desta entrega não encontrou vulnerabilidades.

`package.json.allowScripts` autoriza somente os scripts de instalação necessários às versões fixadas de Prisma, engines Prisma e unrs-resolver. Usar npm compatível com o projeto e `npm ci` no CI. Em atualização de dependências, revisar qualquer novo script antes de autorizá-lo.

O Next gera `AGENTS.md` e `CLAUDE.md` locais ao detectar uma sessão assistida em `next dev`. Esses arquivos automáticos ficam ignorados no Git e no contexto Docker, mantendo as instruções de trabalho fora do produto versionado.

## Desenvolvimento no Windows

PostgreSQL e Redis rodam diretamente no host, nas portas 5432 e 6379. Não há Docker no fluxo local.

1. Instalar as dependências com `npm install`.
2. Copiar `.env.example` para `.env` somente se o arquivo local ainda não existir. Preencher `DATABASE_URL`, `REDIS_URL`, `API_BASE_URL` e `TOKEN_ENCRYPTION_KEY`, conforme a tabela abaixo.
3. Executar `npm run db:prepare`. O script verifica/cria exclusivamente o banco `pulse` em PostgreSQL local. O usuário precisa de permissão para criar esse banco. Não recria um banco existente.
4. Executar `npm run db:validate` e `npm run db:migrate`.
5. Executar `npm run dev` e acessar http://127.0.0.1:3000.

O schema contém as tabelas de configuração humana `monitored_resource_config` e `pulse_settings`, na migration `20261003010322_human_configuration`, e `vm_template_config`, na migration `20261003093000_vm_template_configuration`. A primeira inclui índices únicos parciais e CHECKs, inclusive para impedir hosts duplicados com seletores NULL. A segunda armazena identidade, label e papel opcional dos templates, com revisão; não contém telemetria nem cria cadastros automaticamente. A migration `20261004160000_external_service` acrescenta `external_service` e `external_service_sample` para aplicações consultadas por URL; não altera as tabelas já existentes. `npm run db:migrate` aplica migrations localmente; o entrypoint continua usando `prisma migrate deploy`, sem reset. Para atualizar uma instalação com migrations já prontas, usar `npx prisma migrate deploy` antes de consultar os novos endpoints. As migrations de dados `20261003103000_dashboard_layout` e `20261003120000_compact_dashboard` reorganizam somente o preset inicial reconhecido, preservando IDs/configurações personalizadas e incrementando a revisão. Não criam tabelas nem exigem novas envs. A composição final é indicadores e destaques em faixas inteiras, ASGARD e problemas em meias larguras. Não editar migrations já aplicadas; atualizações usam uma nova migration. O cliente Prisma usa o adapter pg sobre o mesmo pool do health. `dev`, `typecheck` e `build` geram o cliente antes de executar o Next; `npm run db:generate` permite geração explícita. A geração não conecta ao banco nem exige credenciais no build; operação e migrations exigem DATABASE_URL. Contratos e limites: [BFF](bff.md) e [Templates](templates.md).

`npm run collector` executa a coleta real do Zabbix em loop; `npm run collector:once` faz um ciclo e termina. Os dois geram snapshots no Redis e não abrem HTTP. SIGINT/SIGTERM interrompem a espera/requests e aguardam o ciclo para encerrar. Configurar ZABBIX_API_URL/TOKEN e o escopo humano conforme [Zabbix](zabbix.md); `npm run collector:scope -- CAMINHO_JSON` salva apenas as escolhas de escopo/vínculo no banco. Não inicia a UI do dashboard.

`npm run probe` consulta as aplicações externas em loop; `npm run probe:once` faz uma rodada e termina. Não abre HTTP, não chama o Zabbix e não escreve `pulse:sync:last`. Sem `PROBE_INTERVAL_MS`, o intervalo é 60000 ms.

`npm run vps-monitor` consulta o monitor das VPS avulsas que estão ativas e têm URL base; `npm run vps-monitor:once` faz uma rodada e termina. Não chama o Zabbix, não escreve `pulse:sync:last` e não altera a sonda. Sem `VPS_MONITOR_INTERVAL_MS`, o intervalo é 60000 ms.

A configuração local usa URLs completas. Os campos antigos `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_PASSWORD`, `REDIS_HOST`, `REDIS_PORT` e `REDIS_PASSWORD`, se existirem num `.env` anterior, não substituem `DATABASE_URL` e `REDIS_URL`. Não imprimir credenciais em logs. `.env`, variações locais e artefatos de teste estão ignorados no Git; o contexto Docker exclui `.env*`.

## Variáveis

Web e collector recebem o mesmo contrato de ambiente. Autenticação utiliza a URL corporativa e a chave de cifra. O BFF usa banco, Redis e os intervalos de freshness; Collector e histórico sob demanda usam endereço/token Zabbix somente no servidor. O Collector não envia credenciais corporativas ao Zabbix.

| Variável | Leitor/uso | Browser | Compose |
|---|---|---|---|
| `DATABASE_URL` | Web/health, Prisma, configuração humana e inicialização de web/collector | Não | Mesmo nome nos dois serviços da stack. Obrigatória, banco `pulse`; host `pulse_postgres` em produção ou `pulse_postgres_dev` em dev |
| `REDIS_URL` | Web/health e leitura/publicação de envelopes pelo Collector | Não | Mesmo nome nos dois serviços; default `redis://pulse_redis:6379` ou `redis://pulse_redis_dev:6379` |
| `API_BASE_URL` | BFF de login, refresh e logout | Não | Web e collector leem `${API_BASE_URL:-https://api.softcom.cloud}`. Exemplo, `.env` local e os dois arquivos do Portainer trazem `https://api.softcom.cloud`. Sem chave de serviço |
| `TOKEN_ENCRYPTION_KEY` | AES-256-GCM dos envelopes de sessão | Não | Obrigatória: 32 bytes aleatórios em base64, segredo próprio por ambiente e igual entre réplicas do mesmo ambiente |
| `ZABBIX_API_URL` | Collector e BFF de histórico | Não | Mesmo nome nos dois ambientes; endpoint JSON-RPC do Server |
| `ZABBIX_API_TOKEN` | Collector e BFF de histórico | Não | Mesmo nome nos dois ambientes; somente consultas de leitura |
| `COLLECTOR_INTERVAL_MS` | BFF/refreshAfterMs e Collector | Não | Mesmo nome, default `20000` |
| `PROBE_INTERVAL_MS` | Processo da sonda | Não | Default `60000` se ausente ou vazia. Inteiro de 30000 a 120000. O collector não lê esta variável |
| `VPS_MONITOR_INTERVAL_MS` | Processo do monitor de VPS | Não | Default `60000` se ausente ou vazia. Inteiro de 30000 a 120000. O collector e a sonda não leem esta variável |
| `SNAPSHOT_TTL_SECONDS` | Helpers de snapshot: retenção por TTL | Não | Mesmo nome, default `300` |
| `SNAPSHOT_STALE_AFTER_MS` | BFF/helpers de snapshot: limite de freshness | Não | Mesmo nome, default `60000` |
| `POSTGRES_USER` | Container PostgreSQL | Não | Mesmo nome, default `postgres`; deve coincidir com o usuário da URL |
| `POSTGRES_PASSWORD` | PostgreSQL de produção | Não | Variável da stack de produção → `POSTGRES_PASSWORD` do container; obrigatória |
| `POSTGRES_PASSWORD_DEV` | PostgreSQL de desenvolvimento | Não | Variável da stack de dev → `POSTGRES_PASSWORD` do container; obrigatória e independente de produção |
| `POSTGRES_DB` | Container PostgreSQL | Não | Mesmo nome, default `pulse`; deve coincidir com o banco da URL |
| `NEXT_PUBLIC_APP_NAME` | Servidor → provider e interface | Sim, apenas o valor público | Mesmo nome, default `Softcom Pulse` |
| `NEXT_PUBLIC_SOFTCOM_URL` | Servidor → provider e link institucional | Sim, apenas o valor público | Mesmo nome, default `https://www.softcomtecnologia.com.br` |

COLLECTOR_INTERVAL_MS aceita 15000–30000ms. SNAPSHOT_STALE_AFTER_MS deve ser pelo menos o dobro desse intervalo e menor que SNAPSHOT_TTL_SECONDS × 1000. Valores inválidos impedem a leitura de monitoramento com 503; não produzem estado saudável. O TTL não substitui a avaliação de idade. Os mesmos nomes e padrões estão em `.env.example`, no `.env` local e em `docker/portainer.desenvolvimento.env` e `docker/portainer.producao.env`.

PROBE_INTERVAL_MS pertence só à sonda. Ausente ou vazia, vale 60000. Um inteiro de 30000 a 120000 é aceito. Fora dessa faixa a sonda não coleta. Os dois composes trazem `PROBE_INTERVAL_MS: ${PROBE_INTERVAL_MS:-60000}`. O collector do Zabbix não lê essa variável.

VPS_MONITOR_INTERVAL_MS pertence só ao processo `vps-monitor`. Ausente ou vazia, vale 60000. Um inteiro de 30000 a 120000 é aceito. Fora dessa faixa o processo não coleta. Os dois composes trazem `VPS_MONITOR_INTERVAL_MS: ${VPS_MONITOR_INTERVAL_MS:-60000}`. O resultado recente usa o mesmo `SNAPSHOT_TTL_SECONDS` dos snapshots.

`PORT=3000`, `HOSTNAME=0.0.0.0`, `NODE_ENV=production` e `NEXT_TELEMETRY_DISABLED=1` são controles técnicos da imagem, não variáveis de produto que precisem ser preenchidas no Portainer. O comando local restringe o servidor a `127.0.0.1`.

As duas variáveis públicas são lidas no servidor a cada renderização dinâmica. Só `{appName, softcomUrl}` é serializado para o provider. Client Components não leem `process.env.NEXT_PUBLIC_*`. Alterar o ambiente do serviço e recriar suas tarefas muda nome e link usando a mesma imagem. URLs institucionais inválidas ou que não sejam HTTP(S) usam o default. Ver [variáveis do Next](https://nextjs.org/docs/app/guides/environment-variables).

## Stacks Swarm

| Ambiente | Arquivo | Imagem | Host público |
|---|---|---|---|
| Produção | `docker/docker-compose.yaml` | `ghcr.io/softcominnovation/softcom-pulse:${PULSE_VERSION:-latest}` | `pulse.softcomtecnologia.com` |
| Desenvolvimento | `docker/docker-compose.dev.yaml` | `ghcr.io/softcominnovation/softcom-pulse:${PULSE_VERSION:-dev}` | `dev-pulse.softcomtecnologia.com` |

`PULSE_VERSION` define a tag da imagem do aplicativo. Web, collector, sonda e monitor de VPS usam essa mesma tag. Em desenvolvimento o padrão é `dev`; em produção, `latest`. Para fixar uma publicação, por exemplo `0.2.0-dev`, altere só essa variável na stack. PostgreSQL e Redis não usam essa tag.

As stacks usam `version: "3.8"`, placement `node.role == manager` e a rede externa existente `network_public`. A rede e o Traefik precisam existir na VPS. Somente o web recebe labels Traefik: `websecure`, `letsencryptresolver`, porta interna 3000, router/service `pulse` ou `pulse-dev`. PostgreSQL e Redis não publicam portas no host.

Serviços de produção: `pulse`, `pulse-collector`, `pulse-probe`, `pulse_postgres`, `pulse_redis`. Serviços de dev: `pulse-dev`, `pulse-dev-collector`, `pulse-dev-probe`, `pulse_postgres_dev`, `pulse_redis_dev`. Cada serviço começa com uma réplica. Collector e sonda mantêm uma réplica e atualização `stop-first`. A sonda não publica porta nem labels do Traefik e não usa as variáveis do Zabbix.

PostgreSQL usa `postgres:17-bookworm`. Redis usa `redis:8-alpine`, com AOF habilitado. As tags dessas dependências acompanham patches da linha escolhida; a imagem do aplicativo é fixada pelo lockfile e pela tag/digest de release.

Volumes persistentes explícitos: `pulse_postgres_data`, `pulse_redis_data`, `pulse_postgres_dev_data` e `pulse_redis_dev_data`. Os volumes locais ficam no manager que hospeda os dados; em um cluster com vários managers, é necessário manter os serviços de dados no nó desses volumes ou usar armazenamento compartilhado adequado. Atualizar a senha por env não troca automaticamente a senha de um PostgreSQL que já tenha volume inicializado.

Preencher as variáveis da stack no Portainer. A `DATABASE_URL` deve usar o serviço PostgreSQL do ambiente, banco `pulse`, usuário correspondente e a mesma senha fornecida ao container. A senha na URL precisa de percent-encoding; a variável `POSTGRES_PASSWORD`/`POSTGRES_PASSWORD_DEV` recebe a senha original. Exemplo de formato, sem segredo: `postgresql://USUARIO:SENHA_CODIFICADA@pulse_postgres:5432/pulse`. Em dev, trocar o host por `pulse_postgres_dev`. A URL completa é intencional: interpolar a senha original dentro de uma URL quebraria caracteres como `@`, `:` e `/`.

### Recursos iniciais

Valores definidos para esta base; são ponto de partida para medição de carga, não dimensionamento já homologado na VPS.

| Ambiente / serviço | Limite CPU / memória | Reserva CPU / memória |
|---|---|---|
| Produção web | 1 / 768M | 0,25 / 128M |
| Produção collector | 0,5 / 512M | 0,1 / 64M |
| Produção sonda | 0,5 / 512M | 0,1 / 64M |
| Produção monitor de VPS | 0,5 / 512M | 0,1 / 64M |
| Produção PostgreSQL | 1 / 1G | 0,25 / 256M |
| Produção Redis | 0,5 / 256M | 0,1 / 64M |
| Dev web | 0,5 / 512M | 0,1 / 128M |
| Dev collector | 0,25 / 512M | 0,05 / 32M |
| Dev sonda | 0,25 / 512M | 0,05 / 32M |
| Dev monitor de VPS | 0,25 / 512M | 0,05 / 32M |
| Dev PostgreSQL | 0,5 / 512M | 0,1 / 128M |
| Dev Redis | 0,25 / 128M | 0,05 / 32M |

Update: uma tarefa por vez, intervalo de 10s, rollback em falha. Web usa `start-first`; collector e dados usam `stop-first`. Rollback usa `stop-first`. Restart: somente em falha, espera de 5s, janela de 120s, sem limite de tentativas imposto. Cada tentativa de inicialização do app é limitada: 120s para conexão/trava; limite total de 15 minutos para migrations. Não há dependência de ordem via `depends_on`. Grace period: 30s para web/collector/Redis e 60s para PostgreSQL.

### Inicialização e imagem

Dockerfile multi-stage com Node 24, OpenSSL e certificados, build standalone e processo `node` sem root. Copia explicitamente dependências de produção, CLI/engines Prisma, schema, diretório de migrations, configuração Prisma e collector. O build executa `scripts/package-collector.mjs`, que inclui fontes compartilhados, cliente Prisma gerado e dependências transitivas do worker no standalone; não depende só do tracing das rotas Next. Compõe a imagem a partir de `app_pulse`; composes, testes, documentação, Git, caches e envs locais não entram. O comando do Collector é `node --conditions=react-server collector/index.mjs`; preserva a barreira server-only dos módulos compartilhados.

`docker/entrypoint.sh` usa LF e permissão executável. Chama `docker/migrate.mjs`, que aguarda PostgreSQL e obtém advisory lock de sessão na chave exclusiva `734021001`, usando conexão dedicada. A conexão fica aberta enquanto `prisma migrate deploy` executa. Só depois do sucesso a trava é liberada e o shell usa `exec` para iniciar web/collector. Perda da conexão, timeout, sinal de encerramento ou erro do subprocesso abortam a inicialização; não executa reset nem `db push`. O encerramento alcança o subprocesso e sua árvore. Ver [locks do PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html).

`GET /api/health` retorna `200` com `status: "ok"` ou `503` com `status: "unavailable"`. `checks.database` e `checks.cache` usam `up`/`down`; não há host, URL, credencial ou erro bruto no payload. A resposta usa `Cache-Control: no-store`.

## GitHub e publicação

Os workflows publicam imagem no GHCR com `GITHUB_TOKEN`, sem webhook ou deploy da VPS:

- `deploy-dev.yml`: tags estritas `vX.Y.Z-dev`, commit pertencente à história de `origin/develop`; publica `X.Y.Z-dev` e `dev`.
- `deploy-prod.yml`: tags estritas `vX.Y.Z`, commit pertencente à história de `origin/main`; publica `X.Y.Z`, `X.Y`, `X` e `latest`.
- Push de branch, pull request e disparo manual não são gatilhos. Não se aceitam beta, rc, sufixos adicionais ou zeros à esquerda.
- O script valida formato e ancestralidade antes de autenticar/publicar no registry. Checkout completo e apenas leitura do Git.
- CI executa lint, tipos, testes unitários, build, migrations, runtime, componentes e interface. PostgreSQL/Redis temporários do runner usam credenciais de teste descartáveis, sem segredo externo. O uso de containers no runner não altera o desenvolvimento local no host.
- Buildx/QEMU publica `linux/amd64` e `linux/arm64`. Depois inspeciona o índice publicado e executa um smoke test de arquivos/dependências, UID sem root e importação do Collector com `--check` em cada arquitetura, sem conexão externa. `scripts/platform-digest.mjs` seleciona exatamente um manifesto Linux por arquitetura, exclui atestações e exige digest sha256 válido. Cada `docker run` usa esse digest próprio; o digest do índice é usado somente na inspeção. Isso evita `cannot overwrite digest` no daemon do runner.
- Permissões do workflow: `contents: read` e `packages: write`. Não há build-args de conexão ou segredo. O repositório deve permitir Actions e a publicação do pacote no GHCR.
- Após uma release, o operador atualiza a stack pelo Portainer. Produção e desenvolvimento têm variáveis e volumes independentes.

A validação local de YAML, tags e artefato standalone não substitui a execução remota. O teste real dos gatilhos, publicação GHCR, duas arquiteturas e conteúdo da imagem publicada fica pendente até que o responsável autorize/crie e envie as tags correspondentes. Nenhuma imagem ou stack foi publicada nesta implementação local.

## Verificação

`npm run check`: lint, typecheck, testes unitários e build.

Ao alterar workflows, validar também a gramática específica do GitHub Actions com `actionlint` (versão usada na correção de 02/10/2026: 1.7.12). O parse YAML e os testes de contrato não substituem essa verificação. Com a ferramenta instalada, executar:

```text
actionlint -shellcheck= -pyflakes= .github/workflows/deploy-prod.yml .github/workflows/deploy-dev.yml
```

Esse comando valida os workflows sem exigir os analisadores opcionais de shell/Python. No Windows desta revisão, o executável está em `.cache/tools/actionlint.exe`, ignorado no Git. A ferramenta é de verificação, não uma dependência do aplicativo.

No filtro de tags, o `+` literal deve ser escapado: `'!*\+*'` no YAML com aspas simples. `!*+*` é inválido porque `+` tem significado de repetição na gramática de filtros. O GitHub pode registrar a falha de validação no push da branch antes de criar jobs; isso não equivale à execução de uma publicação por branch. Ver [sintaxe oficial dos filtros](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#filter-pattern-cheat-sheet).

Com PostgreSQL/Redis locais configurados:

```powershell
npm run test:integration
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.cache/ms-playwright"
npx playwright install chromium
npm run test:components
npm run test:ui
npm run test:runtime
```

`test:runtime` requer build prévio. Os testes de autenticação utilizam um upstream simulado local; não precisam de conta corporativa ou chave de serviço. `test:ui` usa portas 3100/3102 e cache próprio em `.cache/next-e2e`, preservando o servidor de desenvolvimento da porta 3000. Preencher DATABASE_URL/REDIS_URL locais: o harness cria exclusivamente `pulse_ui05_test_<pid>_<timestamp>`, aplica migrations nesse banco e reserva o Redis DB 11, que deve estar vazio. Não executa FLUSHDB. A apresentação de duas/três telas é salva pelo BFF somente nesse banco temporário; os demais casos visuais usam respostas interceptadas no navegador de teste. `PULSE_E2E=1` e `PULSE_UI_RUN_ID` são controles internos do harness, não envs de produto ou de stack.

O global teardown remove o banco e a trava identificados em `.cache/ui-runtime.json`, verificando o identificador da própria execução. Isso também cobre Windows, onde encerrar a árvore do webServer pode não entregar SIGTERM ao wrapper. O arquivo contém apenas nome temporário, identificador da execução e token da trava, sem credenciais. Se o próprio runner for encerrado à força, verificar que seu processo terminou antes de limpar esses objetos; não apagar chaves desconhecidas nem dados de outra execução. Os testes usam portas locais próprias, encerram seus processos e salvam evidências ignoradas em `.cache/screenshots`. Componentes são montados no harness de testes; não há rota de demonstração incluída no aplicativo.

Os testes de integração criam bancos temporários com prefixos `pulse_phase01_test_` e `pulse_phase03_test_`, restritos a PostgreSQL local, e removem somente seus bancos ao terminar. A suíte de configuração exige Redis DB 15 vazio, adquire uma trava de teste e remove somente chaves próprias; não executa FLUSHDB. A suíte de runtime cria `pulse_runtime03_test_` e usa Redis DB 14 vazio somente para leitura. Nenhuma fixture entra no banco pulse ou no Redis DB 0 do desenvolvimento. Validam processos reais de migration, falha do subprocesso, perda da sessão, timeouts, CRUD, constraints, concorrência de revisão, referências, seletores, snapshots e erros. Não usam dados de negócio.

Interface validada em Chromium: 320/360/390px, tablet retrato/paisagem, desktop e reflow equivalente a 200% (viewport CSS de 640px para tela de 1280px). Cores/fontes computadas, logo/favicon, labels, foco, Escape, clique fora, cancelamento, repetição da confirmação, erro/retry, texto longo, toast e alvos de toque são exercitados. Isso não equivale a homologação em todos os aparelhos físicos ou navegadores.

Autenticação, shell protegido, configuração PostgreSQL, BFF e Collector Zabbix estão implementados. A fase 04 também testa PostgreSQL temporário `pulse_phase04_test_`/`pulse_runtime04_test_` e Redis DB 13/12 vazio com trava; remove somente suas próprias chaves. O runtime exercita o processo empacotado, coleta, histórico autenticado, falha, exclusão entre workers e encerramento. Fixtures não usam o Redis DB 0 nem persistem telemetria no banco pulse.

Dashboard, editores de recursos/apresentação e templates estão implementados. Aplicar a migration 20261003180000_presentation_options com `npx prisma migrate deploy` antes de disponibilizar o editor v2. Não há env nova nem reinício do Collector necessário. Ver [Administração](administration.md), [Interface](ui.md), [BFF](bff.md) e [Zabbix](zabbix.md).
