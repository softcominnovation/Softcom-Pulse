# Coleta e integração Zabbix

O Collector lê o Zabbix Server e publica snapshots descartáveis no Redis. O BFF consulta esses snapshots para os dados atuais e consulta history/trends somente quando recebe um pedido de histórico. PostgreSQL contém escolhas humanas; não contém inventário, métricas ou histórico. O browser não recebe credencial, endereço da API, hostid ou itemid. Contratos públicos: [BFF](bff.md). Variáveis e stacks: [ambiente](environment.md).

## Iniciar e configurar

Preencher `ZABBIX_API_URL` com o endpoint JSON-RPC do Server e `ZABBIX_API_TOKEN` no `.env` privado ou nas variáveis da stack. A URL não é hardcoded. O token precisa permitir as consultas de leitura usadas abaixo; o Pulse não altera hosts, templates, itens ou permissões no Zabbix.

```powershell
npm run collector:once
npm run collector
```

O primeiro comando executa um ciclo e termina. O segundo mantém o loop, com intervalo padrão de 20s, sem sobreposição e sem servidor HTTP. `--once` retorna código 1 quando a coleta falha. Logs contêm eventos, sucesso, duração e códigos controlados; não imprimem erros brutos do Axios/Zabbix. Ctrl+C encerra o processo.

Quando tags não comprovam o escopo/vínculo, uma pessoa deve fornecer a decisão. O arquivo de entrada abaixo é um exemplo de formato: substituir os nomes/IDs por escolhas confirmadas. Mantê-lo fora do versionamento, por exemplo em `.cache/monitoring-scope.json`.

```json
{
  "asgardHostKey": "ASGARD",
  "scope": {
    "hostKeys": ["ASGARD", "linux-host"],
    "vmLinks": [
      { "hostKey": "linux-host", "parentHostKey": "ASGARD", "vmId": "qemu/101" }
    ]
  }
}
```

```powershell
npm run collector:scope -- .cache/monitoring-scope.json
```

O comando valida e salva somente `pulse_settings.asgardHostKey` e `pulse_settings.monitoringScope`, numa transação. Substitui a seleção anterior, preservando apresentação e cadastros de recursos. O próximo ciclo lê a nova decisão. Cada banco de ambiente precisa de sua própria configuração; a seleção do banco local não é enviada à VPS pela imagem. Dentro da imagem, o equivalente é `node --conditions=react-server collector/configure-scope.mjs CAMINHO_DO_JSON`.

Sem seleção persistida, aceita apenas o host técnico `ASGARD` (ou um único host com tag `pulse.role=asgard`) e hosts cuja tag `pulse.parent` aponte explicitamente para ele. Um vínculo VM/Agent por metadados exige também `pulse.vm=qemu/ID` ou `lxc/ID`. Nenhum host entra só porque está visível ao token, no grupo Linux servers ou porque tem nome parecido. A seleção explícita ausente do inventário falha com `monitoring_scope_unavailable`; não publica geração parcial.

`vmLinks` resolve associação humana quando a origem não tem tags. Exige host e pai no escopo, sem duplicatas de host ou de VM. Não cria host no Zabbix nem inventário no PostgreSQL. O hipervisor precisa apresentar itens Proxmox. VM continua existindo na perspectiva do hipervisor sem Agent associado.

## Processo, limites e pacote

As duas stacks mantêm uma réplica e atualização `stop-first`. O comando é `node --conditions=react-server collector/index.mjs`. A condição habilita os módulos `server-only` no processo Node; a proteção contra importação por Client Components continua ativa no Next.

Além da ausência de sobreposição dentro do processo, uma conexão PostgreSQL dedicada mantém advisory lock de sessão `734021004`. Um segundo processo no mesmo banco termina com `collector_already_running`. A trava é distinta das migrations (`734021001`) e das configurações (`734021003`). Perda da conexão solicita parada. SIGTERM/SIGINT cancelam requests e espera do loop; o processo aguarda o ciclo antes de liberar as conexões. O ciclo tem orçamento de 25s, dentro dos 30s de grace period da stack.

Na inicialização, `apiinfo.version` confirma compatibilidade com 7.0.x. Depois, cada ciclo realiza lotes independentes da quantidade de recursos:

1. `host.get`: escopo, host keys, tags e metadados mínimos; limite de 500 hosts.
2. `item.get`: metadados, cadência, dependência, discovery e value map; limite de 20000 itens.
3. `item.get`: valores somente dos itens mapeados/escalares necessários, num lote. Não solicita valores brutos de `docker.container_info[...,full]`, JSON de containers, URLs de itens, headers, macros de credenciais ou configurações Proxmox.
4. `problem.get`: problemas atuais do escopo, com limite de 5000.
5. `trigger.get`, quando há problemas: associa em lote os itens/hosts desses eventos aos recursos públicos.

Ultrapassar um limite, perder um item entre metadados/valores, receber formato inválido ou falhar uma chamada impede a publicação do ciclo inteiro. Não existe request por host/container/métrica nem escrita remota. Parâmetros de [host.get](https://www.zabbix.com/documentation/7.0/en/manual/api/reference/host/get), [item.get](https://www.zabbix.com/documentation/7.0/en/manual/api/reference/item/get) e [problem.get](https://www.zabbix.com/documentation/7.0/en/manual/api/reference/problem/get).

O cliente axios limita cada request a 10s e o sinal total da chamada a 12s, sem redirecionamentos. Há até três chamadas ativas e 24 aguardando por processo; excesso retorna `zabbix_busy`. Resposta máxima 24 MiB. Método fora da allowlist de leitura é recusado. Não usa token de colaborador no Zabbix.

`npm run build` executa `scripts/package-collector.mjs` depois do Next. O pacote inclui `collector/`, módulos compartilhados, cliente Prisma gerado e dependências transitivas do worker. O tracing do Next sozinho não cobre o processo independente. O Dockerfile recebe esse conteúdo via standalone e continua copiando dependências de produção, Prisma/migrations e entrypoint. Nenhuma nova biblioteca foi instalada nesta fase.

`node --conditions=react-server collector/index.mjs --check` importa o pacote sem abrir banco, Redis ou Zabbix. Os dois workflows executam esse teste na imagem de cada arquitetura, junto às verificações de UID/arquivos/dependências; usam o digest específico de amd64/arm64. Gatilhos, plataformas, tags e push não mudaram. A execução remota continua dependente de uma tag enviada pelo responsável.

## Evidência do ambiente consultado

Verificação de leitura em 02–03/10/2026:

- `apiinfo.version`: **7.0.31**, confirmado pela API real.
- Dois hosts acessíveis no escopo aprovado: hipervisor e uma VM com Agent. O vínculo dessa VM foi confirmado pelo responsável e salvo somente no banco local.
- A consulta de metadados retornou 680 itens. Há chaves Proxmox, Linux/Agent e Docker, com itens herdados e descobertos. `template.get` retornou vazio: **a versão instalada dos templates não pôde ser medida com esse acesso**. Não confundir a versão da API com a dos templates.
- O value map real de health confirmou 1 starting, 2 unhealthy, 3 healthy, 4 none. A normalização exige esse mapeamento, sem deduzi-lo apenas do nome do item.
- Um ciclo completo levou aproximadamente 2s e publicou 2 hosts, 33 entidades QEMU, 3 containers não marcados como perdidos e 16 problemas. São uma observação daquela consulta, não valores fixados no código nem fixtures de produção.
- Muitas amostras estavam antigas no Zabbix. CPU/RAM/estado/health e totais Docker refletiram a qualidade da origem: a consulta bem-sucedida não os tornou recentes. Totais sem amostra fresca ficaram null. Não foi alterado o Zabbix para contornar isso.
- Histórico real do hipervisor em 7d: trends disponíveis, 14 séries, até 169 pontos; cobertura parcial. Histórico de 1h da VM associada: sem amostras na janela consultada, `no_data`, sem preencher zeros.

Não foi lido código de Proxy/projetos de referência nem consultada a API Proxmox. Metadados operacionais brutos da análise ficam apenas no cache local ignorado, nunca neste documento ou nas fixtures versionadas.

## Mapa de itens

`value_type`: 0 float, 1 character, 3 unsigned, 4 text. A tabela registra os padrões reconhecidos; a existência de uma capacidade é conferida nos itens de cada recurso. Campos sem item ficam ausentes/null/unknown conforme o DTO, nunca zero fabricado.

| Chave/tag da origem | Campo Pulse | Unidade/tipo da origem → saída | Evidência/origem |
|---|---|---|---|
| `proxmox.node.cpu[NODE]` | cpuUsagePercent | % / 0 → percent, sem multiplicar novamente | hipervisor; percentual já processado pelo template |
| `proxmox.node.memused/memtotal[NODE]` | memoryUsedBytes/TotalBytes; razão derivada | B / 0 → bytes e percent | hipervisor |
| `proxmox.node.rootused/roottotal[NODE]` | diskUsedBytes/TotalBytes; razão derivada | B / 0 → bytes e percent | filesystem raiz do hipervisor |
| `proxmox.node.netin/netout[NODE]` | networkReceive/TransmitBitsPerSecond | bps / 0 → bits/s | taxa já normalizada pelo template |
| `proxmox.node.uptime[NODE]` | uptimeSeconds | uptime / 3 → seconds | hipervisor |
| `proxmox.node.online[NODE]` | availability | 0 offline, 1 online / 3 | item de cluster, com validade da evidência |
| `proxmox.node.disk/maxdisk[NODE,STORAGE]` | storages[].metrics | B / 3 → bytes; razão derivada | storage identificado separadamente |
| `proxmox.qemu.*[qemu/ID]`, tags node/name/qemu | VM, vmId, parentHostKey, vmKey | identidade → hash opaco para navegação | itens descobertos no hipervisor; não é host Linux |
| `proxmox.lxc.*[lxc/ID]`, tags node/name/lxc | mesma perspectiva de convidado | identidade própria por tipo/ID | suportado pelo normalizador; não observado no escopo real |
| `proxmox.qemu/lxc.vmstatus[...]` | VM.state | character / 1 → running/stopped/paused/unknown | preserva estado observado |
| `proxmox.qemu/lxc.cpu,mem,maxmem,uptime` | CPU/RAM/uptime da VM | %, B, uptime / 0 ou 3 | perspectiva hipervisor |
| `proxmox.qemu/lxc.diskread/diskwrite` | diskRead/WriteBytesPerSecond | Bps / 0 → bytes/s | taxa processada na origem |
| `proxmox.qemu/lxc.netin/netout` | networkReceive/TransmitBitsPerSecond | bps / 0 → bits/s | não diferencia de novo um valor que já é taxa |
| `system.cpu.util` ou `system.cpu.util[,idle]` | cpuUsagePercent | % / 0 → percent; idle vira 100 − valor | Agent; prefere utilização total quando disponível |
| `vm.memory.util` | memoryUsagePercent | % / 0 → percent | Agent |
| `vm.memory.size[total]`, `[available]` | memoryTotalBytes, memoryUsedBytes derivada | B / 3 → bytes; usado = total − disponível | representa memória não disponível; não soma caches como uso por suposição |
| `system.uptime` | uptimeSeconds | uptime / 3 → seconds | Agent |
| `zabbix[host,agent,available]` | availability | 1 disponível, 2 indisponível, 0 desconhecido / 3 | disponibilidade de coleta; host.status não é usado como saúde |
| `agent.ping` | disponibilidade quando não há item anterior | 1 / 3 → reachable se fresco; ausência unknown | Agent; não converte ausência em unreachable |
| `vfs.fs.dependent.size[FS,used/total/pused]` ou `vfs.fs.size[...]` | filesystems[].metrics; raiz também no resumo do host | B/% / 3 ou 0 → bytes/percent | Agent; cada filesystem separado |
| `net.if.in/out[IFACE]` | interfaces[].metrics | bps / 0 → bits/s, com CHANGE_PER_SECOND comprovado | Agent; não converte dropped/errors em tráfego |
| `docker.container_info.state.status[NAME]` | Container.status | character / 1; exited vira stopped | Docker, independente de health |
| `docker.container_info.state.health[NAME]` | health/healthReason | código / 0; exige value map confirmado | 4 none significa not_configured; falta de item significa unknown |
| `docker.container_stats.cpu_usage.total.rate[NAME]` | cpuUsagePercent | s / 0, com CHANGE_PER_SECOND → valor × 100 | CPU equivalente a um núcleo; pode ultrapassar 100% |
| `docker.container_stats.memory.usage_active[NAME]` ou `.usage_total[NAME]` | memoryUsedBytes | B / 0 ou 3 → bytes | prefere active quando existe; unsupported continua explícito |
| `docker.container_stats.memory.limit[NAME]` | memoryTotalBytes | B / 0 ou 3 → bytes | capacidade reconhecida, não observada na consulta real |
| `docker.networks.rx_bytes/tx_bytes[NAME]` | networkReceive/TransmitBitsPerSecond | B / 0 com CHANGE_PER_SECOND → valor × 8 | o rótulo B do template acompanha uma taxa processada |
| `docker.container_info.restart_count[NAME]` | restartCount | sem unidade / 3 → count | contador de reinícios |
| `docker.container_info.started[NAME]` | uptimeSeconds derivado | unixtime / 0 → agora − início | somente container running, início válido e evidência fresca |
| `docker.container_info.image/created[NAME]` | image; identidade técnica opaca | character / 1; unixtime / 3 | criação participa da identidade para separar redeploys |
| `docker.containers.running/stopped/total` | contadores Docker do summary | sem unidade / 3 → count | itens agregados do template; não conta linhas da LLD |
| problem.get + trigger.get | Problem e associação host/VM/container | severidade 0–5 e clock | IDs opacos; um evento pode afetar mais de um recurso |

O mapa baseia-se nas chaves/unidades/preprocessing medidos e foi comparado aos templates oficiais [Proxmox](https://raw.githubusercontent.com/zabbix/zabbix/release/7.0/templates/app/proxmox/template_app_proxmox.yaml) e [Docker](https://raw.githubusercontent.com/zabbix/zabbix/release/7.0/templates/app/docker/template_app_docker.yaml). O código nunca executa scripts de preprocessing recebidos: lê apenas tipos/parâmetros necessários para unidade e validade.

Não há CPU de Swarm desired/running, média inventada entre réplicas, conversão de operações de disco por segundo em bytes por segundo, nem taxa calculada a partir de um contador sem processamento temporal comprovado. Métricas derivadas do snapshot não geram automaticamente séries históricas sintéticas: o histórico expõe os itens numéricos mapeados existentes, com seus próprios nomes/unidades.

## Validade, identidade e consistência

`observedAt` preserva lastclock. `validUntil` considera delay simples em s/m/h/d/w, dependência do item mestre e DISCARD_UNCHANGED_HEARTBEAT. Para item dependente cujo mestre não guarda histórico (`lastclock=0`), um irmão suportado com amostra observada comprova atividade do mesmo mestre. Cadência não resolvida, dependência sem evidência, relógio futuro excessivo ou item vencido não vira fresh. Itens unsupported/desabilitados não expõem o valor anterior como métrica válida. Macros e calendários de coleta complexos não resolvidos são tratados conservadoramente como stale.

Health sem value map comprovado é unknown/unrecognized. Falta de item é unknown/missing; unsupported é unknown/unsupported; amostra antiga é unknown/stale. Running não implica healthy. BFF reavalia validade entre ciclos; falha ou envelhecimento do próprio ciclo invalida estado/health mesmo quando algum heartbeat do item ainda não venceu.

VM é identificada por hash de pai + tipo/ID do hipervisor. Nome não liga a host Linux. Container tem nome de discovery sem `/` inicial; sua referência é hash de host, nome e criação. Sem criação, usa conjunto de IDs dos itens, separando mudanças de forma conservadora. Configuração humana continua UUID + host key + seletor. Mais de um candidato é ambiguous; zero é missing. Snapshot interno do serviço inclui status de resolução; o contrato público mantém `resolved` e `resolution`. Nenhuma configuração é apagada por desaparecimento da descoberta.

O ciclo publica inventário, detalhes de host, containers por host, problemas, overview, serviços destacados e `pulse:source:bindings` com o mesmo generation, atomicamente com `pulse:sync:last`. O mapa de bindings é servidor apenas; não é histórico armazenado. Serviços são novamente combinados com a configuração atual no BFF, impedindo que um snapshot reapresente um card removido/oculto.

Sync distingue `lastAttemptAt`, `lastSuccessfulAt`, status e error controlado. Falha não renova TTL nem avança sucesso; retém geração íntegra anterior. Chaves que saíram do novo manifesto são imediatamente ignoradas, mesmo antes de seu TTL expirar. Após expiração completa, devolve no_data, nunca zeros saudáveis. Redis indisponível retorna 503. Detalhes do contrato e retenção estão no [BFF](bff.md).

## Histórico

Somente `1h`, `24h`, `7d`, com IDs resolvidos no servidor a partir da geração corrente. Para cada janela, chamadas agrupadas por value_type. Numéricos de 7d usam [trend.get](https://www.zabbix.com/documentation/7.0/en/manual/api/reference/trend/get), preservando média/min/max horários. Numéricos curtos e estados usam [history.get](https://www.zabbix.com/documentation/7.0/en/manual/api/reference/history/get).

Até 128 bindings por recurso, até 1000 pontos por série e 1000 segmentos por estado. History usa páginas de 5000 registros e até dez páginas por grupo; trends tem limite de 50000 registros por lote. Limite atingido, retenção insuficiente ou lacuna são sinalizados, sem afirmar cobertura completa. O timeout total é 25s. Nenhuma request do loop busca histórico e não há cache de histórico nesta entrega.

Health/status nunca passam por trends. A amostra anterior pode sustentar o início da janela dentro do intervalo suportado. Em estados por evento, consulta também um item contínuo do mesmo mestre quando disponível; falta de amostras de evidência interrompe continuidade. Sem prova, usa limite conservador e unknown. Se há mais de 1000 segmentos, buckets preservam o pior estado observado, incluindo incidentes; não fazem média dos códigos. A referência técnica devolvida muda no redeploy e evita continuidade falsa entre containers.

## Limites conhecidos e testes

As 33 entidades QEMU observadas vêm dos itens descobertos; o Collector mantém todas no Redis. Na correção da fase 05, o responsável definiu explicitamente nomes iniciados por `tpl` como templates. O BFF aplica essa convenção às listas/contadores de VMs e aos problemas comprovadamente vinculados, preservando métricas e storages gerais do ASGARD. Consulta separada encontrou 9 templates (4 Workers/5 Managers), memória disponível e ausência de fonte confiável para vCPUs, capacidade de disco ou SO/versão; detalhes em [Templates](templates.md). Não confundir templates de criação de VM com os templates de coleta do Zabbix citados no mapa de itens.

Sem Agent correlacionado, métricas internas estão ausentes, mantendo as externas disponíveis. Discovery Docker pode ter contagem de parados sem nomes individualizados, e a cadência da descoberta difere da coleta de métricas.

Testes sanitizados cobrem Proxmox/Agent/Docker, VM sem Agent, nomes divergentes, saúde ausente/unsupported, unidades, zero/null, contagens agregadas divergentes da LLD, desaparecimento, redeploy, paginação/limites de saída e intervalos discretos com falha. Integração usa PostgreSQL temporário e Redis DB 13 vazio com trava; runtime usa PostgreSQL temporário e DB 12 vazio com trava. Removem apenas dados próprios. Não escrevem no Zabbix.

O teste do pacote inicia Collector e web standalone, valida BFF autenticado/histórico, falha, exclusão de processos concorrentes e parada por sinal emitido dentro do processo Node. O sinal é emitido assim para portabilidade no Windows; a execução em Swarm e os dois binários de arquitetura ainda dependem da publicação remota. Não houve deploy nesta implementação.
