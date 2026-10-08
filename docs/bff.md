# Contratos do BFF e configuração

O browser chama somente `/api` no Pulse, usando o cliente axios autenticado. As rotas abaixo exigem `Authorization: Bearer <access cifrado>` e validam a sessão no servidor antes de acessar as dependências. Qualquer colaborador autenticado pode utilizá-las. Não há permissão adicional nem tabela de usuários. [Contrato de autenticação](authentication.md).

Todas as respostas usam `Cache-Control: no-store`. `/api/health` permanece público. O Collector publica gerações completas no Redis; as leituras correntes usam esse cache. Somente históricos solicitados ao BFF consultam o Zabbix. Mapeamento e operação: [integração Zabbix](zabbix.md). Não há cliente Proxmox direto.

## Persistência humana

Prisma gerencia `monitored_resource_config`, `pulse_settings` e `vm_template_config`. Campos físicos são snake_case, objetos públicos são camelCase. UUID do Pulse identifica uma configuração de recurso; templates usam a identidade opaca de pai/tipo/ID do hipervisor, persistida apenas para vincular preferências humanas. ID técnico de container, hostid/itemid do Zabbix, estado operacional, métricas, histórico, usuários e credenciais não são persistidos nessas tabelas. Contrato de templates, labels e classificação: [Templates](templates.md).

`monitored_resource_config` contém `id`, `resourceType`, `source`, `zabbixHostKey`, `selectorType`, `selectorValue`, `displayName`, `dashboardEnabled`, `critical`, `displayOrder`, `presentation`, `enabled`, `createdAt` e `updatedAt`.

- `resourceType`: `host` ou `docker_container`; `source`: somente `zabbix`.
- `zabbixHostKey`: 1–256 caracteres, sem espaços nas extremidades, controles, `/` ou `\`. É a chave textual estável, não o hostid numérico.
- Host exige seletores nulos. Container exige `exact_name|name_prefix|name_contains|regex` e valor de 1–256 caracteres.
- `displayName`: nulo ou texto aparado de 1–120 caracteres. `displayOrder`: inteiro de 0 a 2147483647, default 0.
- `dashboardEnabled` e `critical`: default false. `enabled`: default true. Desabilitar preserva a configuração editável.
- Banco impõe unicidade parcial de `(zabbix_host_key, resource_type)` para hosts, incluindo seletores NULL; para containers, de `(zabbix_host_key, resource_type, selector_type, selector_value)`. CHECKs reforçam fonte, tipo, seletores, ordem e formato/allowlist de presentation.

`presentation` é estrito por tipo. Defaults: `showStatus`, `showCpu`, `showMemory` true; `showDisk`, `showNetwork`, `showUptime` false. Containers também têm `showHealth` e `showHealthTimeline` false e `healthTimelineRange: "1h"`. A janela aceita `1h|24h|7d`; timeline exige health habilitado. Hosts não aceitam os três campos Docker. Não se grava capacidade descoberta junto às preferências.

| Rota | Resultado |
|---|---|
| `GET /api/settings/resources` | `{data: ResourceConfig[]}` ordenado por displayOrder/UUID, independente do Redis; usado pela administração de preferências existentes |
| `GET /api/monitoring/services` | Envelope de leitura com `data: ConfiguredResource[]`, incluindo configurações desabilitadas e alvos ausentes |
| `GET /api/monitoring/services/:id` | Envelope com `data: ConfiguredResource`; UUID inexistente: 404 |
| `POST /api/monitoring/services` | JSON da configuração, sem id/timestamps; 201 `{data: ResourceConfig}` |
| `PATCH /api/monitoring/services/:id` | JSON parcial não vazio; 200 `{data: ResourceConfig}` |
| `DELETE /api/monitoring/services/:id` | 204 sem corpo; remove somente a configuração Pulse e seus vínculos de apresentação |
| `GET /api/monitoring/services/:id/history?range=1h` | Histórico sob demanda do alvo técnico atual; configuração sem alvo resolvido retorna no_data |

PATCH preserva campos omitidos. Se `presentation` for enviado, substitui o objeto inteiro, aplicando defaults aos campos omitidos dentro dele. Alteração de tipo deve fornecer os seletores e a apresentação compatíveis. Campos desconhecidos, telemetria, UUIDs inválidos e JSON inválido retornam 400. Conflito de unicidade retorna 409. Ordenação: `displayOrder`, depois UUID.

Aplicações fora do Zabbix ficam em `external_service` e nas amostras `external_service_sample`. Não entram em `monitored_resource_config`. O segredo não sai na resposta: a leitura traz `secretConfigured`. Cada cadastro tem `timeoutMs`, de 1000 a 30000, padrão 5000. PATCH exige `expectedRevision`. Há no máximo 100 cadastros.

| Rota | Resultado |
|---|---|
| `GET /api/monitoring/external-services` | `{data}` sem segredo. Cada item inclui `uptime`: `reason`, `latencyMs`, `checkedAt`, `uptime24h` e `strip` com as últimas 40 consultas. Falha do Redis deixa `uptime` vazio e a lista continua |
| `POST /api/monitoring/external-services` | 201 `{data}` |
| `PATCH /api/monitoring/external-services/:id` | 200 `{data}`; revisão divergente: 409 `revision_conflict` |
| `DELETE /api/monitoring/external-services/:id` | 204; remove o cadastro e as amostras |
| `GET /api/monitoring/external-services/:id/history?range=24h\|7d\|30d` | `{data}` com um ponto `{checkedAt, reason, latencyMs}` por amostra da janela, sem downsampling, e o resumo `uptime24h`, `uptime7d`, `uptime30d` |

Gravação no BFF autenticado exige `editor: true` em `GET /api/auth/session`. O e-mail da sessão precisa estar em `PULSE_EDITOR_EMAILS`. Sem isso, POST, PATCH, PUT e DELETE respondem 403 `editor_required`. A lista de e-mails não sai na resposta. Quem não é editor lê a lista e o detalhe da VPS sem `apiKey`, e a aplicação sem `bodyTemplate`, `headerName` e `expectedValue`.

VPS avulsas ficam em `standalone_vps`, `vps_stack` e `vps_monitor_sample`. Não entram em `monitored_resource_config` nem em `external_service`. A lista e o detalhe do cadastro devolvem `apiKey` para o editor, no formulário. A visão geral não devolve a chave. Quem não é editor também não recebe `apiKey`. A leitura também traz `monitorConfigured`. `provider` é texto opcional, até 120 caracteres; vazio fica nulo. URL base e chave entram juntas ou saem juntas; o par incompleto responde 422 `monitor_incomplete`. Há no máximo 100 VPS e 50 stacks por VPS.

| Rota | Resultado |
|---|---|
| `GET /api/monitoring/standalone-vps` | `{data}` com `apiKey` para edição. Cada item inclui `monitorConfigured`, `monitorState` e `strip`. A visão geral omite `apiKey` |
| `POST /api/monitoring/standalone-vps` | 201 `{data}` |
| `PATCH /api/monitoring/standalone-vps/:id` | 200 `{data}`; revisão divergente: 409 `revision_conflict` |
| `DELETE /api/monitoring/standalone-vps/:id` | 204; remove a VPS, as stacks e as amostras |
| `GET /api/monitoring/standalone-vps/:id?range=24h\|7d\|30d` | `{data}` com cadastro, `apiKey`, stacks, último resultado e amostras da janela |
| `POST /api/monitoring/standalone-vps/:id/stacks` | 201 `{data}` |
| `PATCH /api/monitoring/standalone-vps/:id/stacks/:stackId` | 200 `{data}` |
| `DELETE /api/monitoring/standalone-vps/:id/stacks/:stackId` | 204 |

O overview ganha `standaloneVps` só com as linhas em destaque. VPS inativa ou sem monitor traz faixa vazia. Isso não altera `externalServices` nem os problemas do Zabbix.

Seletores são sensíveis a maiúsculas/minúsculas. Prefixo `evolution_evolution` casa o nome exato ou tasks iniciadas em `evolution_evolution.`; também se aceita o prefixo com ponto explícito. Não casa `evolution_evolution_backup`. `name_contains` busca trecho literal. Regex usa [RE2JS](https://github.com/le0pard/re2js), versão fixada 2.8.6, com avaliação linear e limite de 256 caracteres no padrão e 512 no nome; não usa RegExp nativo com padrão do usuário. Sintaxe não suportada, incluindo backreferences, retorna 400.

A resolução usa host + seletor: um candidato é resolved, zero é missing, vários são ambiguous. Na criação ou alteração efetiva de identidade/seletor, múltiplos candidatos retornam 400 selector_ambiguous; ausência do alvo retorna 400 resource_not_discovered; descoberta indisponível/stale retorna 409 resource_inventory_unavailable. Preferências de uma configuração existente continuam editáveis quando o alvo desaparece ou se torna ambíguo. Reenviar a mesma identidade não exige nova descoberta.

## Apresentação compartilhada

`pulse_settings` recebe somente `dashboardPresentation` pelas rotas de apresentação. A seleção operacional de `monitoringScope` e `asgardHostKey` é feita pelo comando documentado em [Zabbix](zabbix.md), sem endpoint genérico de escrita. A inicialização cria a apresentação ausente com revisão 1, modo TV/início automático false, intervalo 20s e uma tela “Visão geral”, layout overview, com summary/full, highlighted_resources/full, asgard_summary/wide e problems/wide, nessa ordem. IDs UUID são gerados uma vez; acesso posterior e reinício não sobrescrevem o documento. Não há seed de hosts ou métricas.

| Rota | Contrato |
|---|---|
| `GET /api/settings/presentation` | 200 `{data: PresentationDocument, updatedAt: ISO}` |
| `PUT /api/settings/presentation` | Corpo `{expectedRevision, settings}`; 200 no mesmo formato do GET |

`settings` contém schemaVersion 2, defaultTvMode, displayScalePercent, idlePresentation, rotation e screens. A versão 1 continua aceita durante a transição. revision é emitida pelo servidor. PUT troca o documento inteiro, compara expectedRevision e incrementa atomicamente. Revisão vencida retorna 409 revision_conflict; exige recarregar/revisar sem sobrescrita automática. Gravações e migration de opções compartilham advisory lock transacional 734021003.

`displayScalePercent` aceita somente números **100, 110, 120 ou 125**, padrão **110**. Controla o tamanho de leitura apenas na raiz em TV ou fullscreen, aplicado uma única vez. Campo ausente em v1/v2 recebe o default na leitura e no próximo salvamento; a leitura não modifica o registro/revisão. Valores fora da lista, null, boolean e string retornam 400 invalid_request. É configuração humana compartilhada, não telemetria nem preferência local. A adição é compatível com o JSON existente e não exige migration nem altera telas, UUIDs ou larguras.

`idlePresentation`: objeto estrito `{enabled: boolean, afterMinutes: integer, requestFullscreen: boolean}`, defaults **false/5/true**. `afterMinutes` deve ficar entre 1 e 120, inclusive quando desabilitado; strings, nulls, frações, campos desconhecidos e valores fora dos limites são rejeitados com 400. Ausência do objeto/campos em v1/v2 recebe defaults na leitura, sem regravar/revisionar o documento, e no próximo PUT. Configura a ativação por inatividade na raiz; fullscreen é tentativa sujeita à permissão do navegador, nunca promessa. Cronômetro, atividade e estado real dos modos são locais, não escritos no banco. Sem migration, nova rota ou mudança de telemetria.

Tela: `{id, name, enabled, layout, blocks}`. Nome de 1–80 caracteres; layout `overview|wall`. De uma a três telas no total, contando desabilitadas, e pelo menos uma habilitada. A ordem dos arrays é a ordem de exibição. Cada tela tem no máximo 24 blocos; uma tela habilitada precisa de pelo menos um bloco habilitado. Todos os IDs de tela e bloco são UUIDs únicos no documento.

Bloco v2: `{id, type, enabled, width, options, resourceConfigId?}`. Largura standard/wide/full. Até seis blocos habilitados e 24 totais por tela; v1 mantém o limite antigo. Somente resource_card exige resourceConfigId habilitado para destaque. options usa allowlist/defaults por tipo em lib/config/presentation.ts; contratos e comportamento em [Administração](administration.md). hostKeys do inventário de containers aceita até 32 chaves únicas do escopo persistido. Desconhecidas retornam 400 invalid_host_reference.

| Tipo | Contrato BFF/gravação nesta entrega | Interface prevista |
|---|---|---|
| summary | disponível | fase 05 |
| highlighted_resources | disponível | fase 05 |
| problems | disponível | fase 05; detalhe ampliado na 07 |
| asgard_summary | disponível | fase 05 |
| resource_card | disponível | fase 05 |
| host_inventory | disponível; Host[] operacional | fase 06 implementada |
| container_inventory | disponível; Container[] agregado dos hosts do escopo | fase 07 implementada |

Os sete tipos estão implementados e disponíveis no editor em `/admin/configuracoes`. A composição muda somente no salvamento explícito; detalhes em [Administração](administration.md).

`intervalSeconds` inteiro de 5 a 300, default 20. AutoStart exige duas telas habilitadas com bloco habilitado disponível; ausência de telemetria não desabilita uma tela. A reprodução revalida essa condição. Tela atual, pausa, contador, formato temporário e fullscreen não são gravados neste documento.

DELETE de configuração remove todos os seus resource_cards na mesma transação, incrementando a revisão da apresentação se houve vínculo removido. Se uma tela ficar vazia, ou habilitada sem bloco habilitado, recebe um summary novo. A tela, a ordem e o layout são preservados. Desativação/retirada do destaque preserva o vínculo no documento, mas o overview oculta o conteúdo e marca o bloco unavailable; o editor sinaliza a referência indisponível. Novo PUT exige corrigi-lo. Apresentação pode ser lida/salva mesmo com Redis fora do ar.

As migrations de layout anteriores permanecem imutáveis. A migration 20261003180000_presentation_options converte v1 compatível para v2, preservando composição/IDs e incrementando revision uma única vez. V1 com mais de seis blocos habilitados permanece intacta e reproduzível. Reexecução não modifica v2. Defaults v1 são resolvidos em memória nas leituras.

## Leituras de monitoramento

Envelope público: `{data, availability, stale, lastUpdated, refreshAfterMs}`. Availability é `ready|no_data|unavailable`; lastUpdated é ISO ou null; refreshAfterMs acompanha `COLLECTOR_INTERVAL_MS`. Sem primeira coleta: listas vazias, resumo com contadores null, no_data, stale false e lastUpdated null. Zero só representa zero observado. Não há resposta 501 nem host fictício.

| Rota GET | data |
|---|---|
| `/api/dashboard/overview?screenId=<uuid>` | Overview da primeira tela habilitada ou da tela solicitada |
| `/api/monitoring/hosts` | Host[] |
| `/api/monitoring/hosts/:hostKey` | Host; ausente: 404 |
| `/api/monitoring/hosts/:hostKey/containers` | Container[]; host ausente: 404 |
| `/api/monitoring/hosts/:hostKey/vms/:vmKey/containers` | VmWorkloads; pai e VM operacional validados; sem query |
| `/api/monitoring/containers?hostKey=<chave>` | Container[] geral ou filtrado por host, agrupável pelo campo hostKey |
| `/api/monitoring/problems` | Problem[] |
| `/api/monitoring/templates?hostKey=<chave>` | Template[] descobertos, combinados com metadados humanos |
| `/api/monitoring/templates/:templateKey` | Template; ausente na descoberta: 404 |
| `/api/monitoring/hosts/:hostKey/history?range=1h` | History sob demanda; host ausente: 404 |
| `/api/monitoring/hosts/:hostKey/vms/:vmKey/history?range=1h` | History; host/VM ausente: 404 |

Componentes de caminho e query devem usar URL encoding. Históricos aceitam range `1h|24h|7d`, default 1h. O servidor resolve somente os itens mapeados para o recurso, sem aceitar itemid do browser. source descreve as séries numéricas: history para 1h/24h e trends para 7d; estados discretos usam history em qualquer janela. Serviços são configuração humana resolvida, não sinônimo da lista de containers.

O envelope de `GET /api/monitoring/hosts` acrescenta `asgardHostKey: string|null`: identidade efetiva presente no overview da mesma geração, validada contra um host de papel hypervisor no inventário. Sem evidência correspondente, é null. Não é uma seleção por nome no browser. O bloco `host_inventory` recebe `Host[]` da mesma leitura agregada, com templates removidos apenas das listas operacionais e capacidades do host preservadas. Nenhum endpoint novo nem escrita de telemetria foi necessário para as telas de infraestrutura.

VMs com nome iniciado literalmente por `tpl` saem das listas e contadores operacionais, inclusive problemas com vínculo comprovado à VM template. As métricas gerais do ASGARD permanecem integrais. Summary.problems conta entradas públicas após o filtro, e não eventos brutos; um evento pode ter mais de um recurso. Histórico de VM não aceita template. O Collector/Redis preserva o inventário completo. Metadados usam `GET /api/settings/templates` e `PUT /api/settings/templates/:templateKey`, com revisão concorrente; payloads, ausência/stale e limites em [Templates](templates.md).

History acrescenta `technicalReference`, `coverageLimited` e `states`. Séries numéricas têm `aggregation: last_min_max|hourly_average` e até 1000 pontos `{timestamp,value,min,max}`. Resampling curto conserva o último valor e extremos do bucket; só mantém um valor entre amostras dentro da cadência suportada. Janela de 7d usa média horária do Zabbix, com mínimo/máximo preservados. Null explicita lacuna. States contêm key `status|health`, aggregation `worst_state`, coverageLimited e até 1000 segmentos `{from,to,state,observedAt}`. Não se calcula média de códigos de health. Estado anterior só é carregado dentro da validade sustentada; itens por evento usam evidência de coleta do mesmo mestre quando disponível. Sem evidência, lacuna unknown. O limite de leitura ou uma lacuna sinalizam coverageLimited.

Histórico tem timeout total de 25s, fila global limitada, no máximo três chamadas simultâneas por processo e refreshAfterMs de 60000. Não é pré-carregado nem persistido no Redis/PostgreSQL. A identidade opaca muda no redeploy do container. A UI de infraestrutura cancela a seleção anterior e descarta respostas de outra identidade/janela; o BFF propaga o sinal de cancelamento HTTP. O cache de página e o orçamento por perspectiva estão em [Infraestrutura](infrastructure.md).

Overview mantém summary, highlightedResources, problems, asgardSummary, screenId, presentationRevision e blocks. Acrescenta `externalServices` e `uptimeBoard`, lidos só do Redis da sonda. Falha dessa leitura devolve listas vazias e não altera `stale` nem a ordem de `highlightedResources`. O bloco `uptime_list`, quando habilitado na tela, recebe `uptimeBoard` em `data` e fica com `stale: false` mesmo se a sincronização do Zabbix falhar. Sem esse bloco, `uptimeBoard` vem vazio. Cada bloco habilitado inclui `{blockId, type, options, data, availability, stale, lastUpdated}`. options contém defaults efetivos também na leitura v1, sem gravar. O renderer aplica ordenação/filtros/janela; o BFF não trunca o inventário. UUID inválido retorna 400; tela ausente/desabilitada, 404. Só são consultados os inventários dos destaques visíveis, exceto container_inventory, que agrega os hosts do escopo. Não há requests de histórico por bloco/linha.

## Serviços e containers de uma VM

`GET /api/monitoring/hosts/:hostKey/vms/:vmKey/containers` está disponível. Recebe somente os dois componentes de caminho codificados, sem query. Retorna o envelope de leitura padrão com:

```ts
type VmWorkloads = {
  vm: VirtualMachine;
  association: "linked" | "unlinked" | "host_unavailable";
  containers: Container[];
  configuredServices: ConfiguredResource[];
};
```

O pai precisa ser um hipervisor do inventário operacional. A VM precisa pertencer a ele e não ser template. O servidor usa exclusivamente `vm.linuxHostKey`; não aceita host alternativo nem infere vínculo por nome/IP/ID numérico. Confere a mesma geração entre pai, vínculo e inventário Docker, repetindo a leitura até três vezes se houver publicação concorrente. Cada container é validado contra o host selecionado. PostgreSQL fornece somente as configurações `docker_container` daquele host, inclusive desabilitadas. Resolução preserva missing/ambiguous, sem escolher um candidato arbitrário.

| Situação | Resposta |
|---|---|
| VM e Agent válidos com snapshot Docker | linked, ready; lista descoberta e configurações |
| Sem vínculo Agent | unlinked, unavailable; arrays vazios, sem afirmar ausência de containers |
| Host associado ausente da geração ou inalcançável | host_unavailable, unavailable; sem dados de outro host |
| Agent válido sem snapshot Docker | linked, no_data; configurações preservadas, ainda que sem alvo |
| Snapshot Docker com lista vazia | linked, ready; nenhum container individualizado nesta coleta |
| Coleta antiga/falha com snapshot retido | dados retidos com stale e qualidade desatualizada |
| Formato/query inválidos | 400 invalid_request |
| Pai/VM ausentes ou template | 404 host_not_found/vm_not_found |
| Cache/banco indisponível ou gerações divergentes | 503 seguro; nunca sucesso com lista vazia artificial |

O modal cancela pedidos ao fechar/trocar de identidade; a rota confere cancelamento antes de acessar dependências e antes de entregar o resultado. Comandos de leitura de Redis/PostgreSQL já enviados terminam no servidor, sujeitos aos seus limites, sem trabalho externo novo. As rotas existentes por host Linux mantêm o contrato.

Histórico de recurso configurado filtra os bindings pelas preferências atuais: CPU/memória/disco/rede/uptime e, quando habilitados, health/status discretos. Timeline requer showHealth + showHealthTimeline; showStatus controla a trilha de estado. Reinícios permanecem informação técnica disponível. Fonte, unidades, lacunas e cobertura continuam explícitos; não há média de códigos de health nem polling histórico por container. A lista global usa uma leitura agregada, sem chamadas por host para montá-la.

## DTOs normalizados

Schemas e tipos compartilhados em `lib/monitoring/contracts.ts` filtram campos internos antes da resposta. O cache pode conter informação técnica para o Collector, mas ela não atravessa esse limite.

| Tipo | Campos |
|---|---|
| Metric | `value: number|null`, `unit`, `observedAt: ISO|null`, `quality: fresh|stale|missing|unsupported`, `validUntil: ISO|null` quando a cadência foi avaliada |
| Metrics | CPU percent, provisionedCpuCount e osCpuCount (count); memória usada/total/percent; disco usado/total/percent/leitura/escrita; rede recebida/transmitida; uptime; restartCount, todos opcionais e tipados |
| Host | hostKey, name, role `hypervisor|linux|unknown`, availability `reachable|unreachable|unknown`, metrics, storages, filesystems, interfaces, vms, evidence |
| VM | vmKey, vmId anulável, name, parentHostKey, state `running|stopped|paused|unknown`, metrics, linuxHostKey anulável, evidence |
| Container | reference opaca, hostKey, name atual sem `/` inicial do Docker, image anulável, status, health, healthReason, healthObservedAt, healthValidUntil, metrics, evidence |
| ConfiguredResource | id, config (ResourceConfig), resolved, resolution `resolved|missing|ambiguous`, resource (Host/Container/null), metrics |
| Problem | id opaco, resource, description original, displayDescription opcional e humanizada por identidade comprovada, severity original 0–5, visualState `info|warning|critical|unknown`, startedAt |
| History | resource, window, source, technicalReference, coverageLimited, series e states conforme contrato acima |
| Summary | hostsKnown, hostsReachable, vms, containersRunning, containersStopped, containersTotal, problems, criticalAffected; inteiros ou null |
| AsgardSummary | host: Host/null e vms: VM[] |

Evidence contém source zabbix, observedAt, validUntil quando avaliado e basis `item|discovery|configuration|unknown`. Dispositivos de host contêm key, name e metrics. Resource de problema/histórico contém type `host|vm|docker_container|configured_resource`, hostKey e reference anulável. VM sem Agent mantém linuxHostKey null; nunca se fabrica um host Linux. HealthReason distingue observed, missing, unsupported, stale e unrecognized. Campos de capacidade opcionais ausentes não indicam zero.

`VM.metrics.provisionedCpuCount` é a quantidade provisionada no Proxmox, obtida do item dependente QEMU, inclusive sem Agent. `Host.metrics.osCpuCount` representa CPUs reconhecidas pelo SO via Agent. São inteiros positivos, unidade count, com horário/qualidade/validade próprios; um campo nunca substitui o outro. A UI consulta o SO somente pelo `linuxHostKey` confirmado. O leitor aceita o antigo `cpuCount` de snapshots Linux exclusivamente como `osCpuCount`, removendo o nome antigo da saída; não o converte em provisionamento. Ausência continua explícita.

Os campos seguem nas rotas existentes de hosts, detalhe, overview e histórico por recurso. Templates de VM expõem `virtualCpuCount` a partir de `provisionedCpuCount`. Não há endpoint por quantidade de CPU nem requests por linha. Fontes e heartbeat estão no [contrato Zabbix](zabbix.md).

Unidades: percent, bytes, bytes/s, bits/s, seconds e count. Uso e capacidade são campos separados, assim como taxas e acumulados. Campos indisponíveis não viram zero. Status Docker (`running|stopped|paused|restarting|created|removing|dead|unknown`) e health (`healthy|unhealthy|starting|not_configured|unknown`) são separados. Sem HEALTHCHECK não significa healthy.

## Redis e consistência

Um cliente Redis de servidor, compartilhado com health; operações têm limite de dois segundos. Nenhum cliente Prisma/Redis é importado pelo browser.

Envelope interno: `{data, updatedAt: ISO, source: "zabbix", generation: UUID}`. updatedAt é horário do ciclo; observedAt de cada métrica preserva a evidência original. Helpers ficam em `lib/server/cache/snapshots.ts`; não são endpoints públicos.

| Chave | Conteúdo data |
|---|---|
| `pulse:snapshot:overview` | `{summary, asgardSummary}` |
| `pulse:inventory:hosts` | Host[] com detalhes atuais normalizados |
| `pulse:inventory:containers:<host-key>` | Container[] daquele host |
| `pulse:snapshot:host:<host-key>` | Host detalhado, opcional; leitura usa inventário como fallback |
| `pulse:snapshot:service:<pulse-config-id>` | recurso destacado normalizado, métricas de presentation e status resolved/missing/ambiguous; leituras aplicam inventário + configuração PostgreSQL vigente |
| `pulse:problems:current` | Problem[] |
| `pulse:source:bindings` | mapa privado de recurso opaco para itens históricos, tipos, unidades, transformações e evidência; nunca retornado pelo BFF |
| `pulse:sync:last` | `{status: ok|failed, lastSuccessfulAt: ISO|null, lastAttemptAt: ISO, error: código|null, keys: string[]}` |

Sufixos host-key usam encodeURIComponent. `publishSnapshots` recebe o conjunto completo do ciclo e grava snapshots + manifesto sync por MULTI/EXEC, com uma geração única e TTL comum. O Collector fornece todos os snapshots válidos do ciclo. Chaves omitidas da nova geração deixam de ser lidas, mesmo enquanto seu valor antigo ainda existe no Redis; expiram normalmente. Nunca publicar pequenos fragmentos independentes com esse helper.

Leituras usam MGET incluindo sync. Só aceitam chaves declaradas no manifesto e com geração correspondente. Inventário que determina outras chaves usa dois lotes e confere a geração entre eles, repetindo no máximo três vezes; não mistura ciclos. Valores inválidos/inconsistentes retornam 503 normalizado. Exclusão/desativação de configuração também é aplicada no BFF, impedindo cards antigos de reaparecer por snapshot atrasado.

`markSyncFailure` muda o status atomicamente, preservando última geração/dados/TTL; registra lastAttemptAt e um código curto permitido. Sem snapshot cria somente indicação de falha, com lastSuccessfulAt null. Não persiste erro bruto nem credencial. LastSuccessfulAt é o nome canônico desde a fase 03; não há propriedade paralela lastSuccessAt.

Retenção: SNAPSHOT_TTL_SECONDS default 300s. Freshness do ciclo: SNAPSHOT_STALE_AFTER_MS default 60000ms, ao menos duas vezes COLLECTOR_INTERVAL_MS (15000–30000, default 20000), e estritamente menor que o TTL. Configuração inválida retorna 503. Stale considera falha OU idade do ciclo, mesmo se o Collector morreu sem registrar erro. Métricas consideram observedAt e validUntil calculado da cadência/heartbeat/evidência; o limite global de 60s não é aplicado cegamente a itens por evento. Ciclo vencido ou falho invalida a confiança em estado/health; último valor numérico pode permanecer com quality stale. Redis inacessível retorna 503. Após expirar toda a retenção, não há evidência em cache para recuperar lastUpdated. Perder cache não remove configurações PostgreSQL. [Variáveis e operação](environment.md).

## Erros e verificação

Erros têm `{error: {code}}`, sem stack, URL, SQL ou payload de origem. Validação Zod acrescenta `fields: [{path, message}]` com caminho e mensagem genérica, sem valores recebidos. 400: entrada, query, seletor ou referência inválida; 401: sessão; 404: recurso/tela; 409: revisão/unicidade ou descoberta indisponível para nova identidade; 503: dependência/configuração/snapshot indisponível. JSON exige Content-Type application/json e no máximo 64 KiB. Defeito inesperado retorna 500 internal_error.

Testes cobrem schema, NULL/zero, defaults/PATCH, regex patológica, migrations reais, unicidade concorrente, revisão, exclusão e referências, seleção por tela, ausência/falha/stale/generation, autenticação e pacote standalone. Integração usa banco PostgreSQL temporário e Redis DB 15 vazio com trava; runtime usa outro banco temporário e DB 14 vazio somente para leitura. Não usam telemetria permanente nem conta corporativa real.
