# Templates do hipervisor

O BFF separa templates das VMs operacionais pela convenção definida para o Pulse: nome técnico iniciado literalmente por `tpl` (sensível a maiúsculas). Não depende de uma flag Proxmox nem de uma label configurada. O Collector e os snapshots Redis preservam o inventário completo; PostgreSQL guarda somente metadados de apresentação escolhidos por uma pessoa.

## Separação e indicadores

`Host.vms`, `AsgardSummary.vms` e `Summary.vms` expostos pelo BFF excluem templates. Isso vale também para o host retornado em serviços configurados. Nenhuma capacidade, uso, storage, filesystem, interface ou métrica geral do ASGARD é subtraída ou recalculada a partir dessa exclusão.

Problemas associados pelo Collector a uma VM comprovadamente template são retirados da lista operacional. A associação exige tipo `vm`, host e referência opaca correspondentes no inventário da mesma geração. Um problema de host, sem vínculo resolvido ou cujo texto apenas mencione `tpl`, permanece. O BFF não reconhece templates pelo texto de um alerta.

`Summary.problems` conta as entradas da lista operacional pública, após o filtro; não é o total bruto de eventos do Collector. Um evento relacionado a vários recursos pode produzir várias entradas. Os contadores específicos de VMs/problemas não alteram métricas gerais do hipervisor, contadores Docker ou o snapshot bruto. Sem a evidência necessária, contador desconhecido continua null. A rota de histórico de VM operacional retorna 404 para um template; não há histórico de templates nesta entrega.

## Consultas e DTO

Todas as rotas exigem sessão válida e retornam `Cache-Control: no-store`, conforme [BFF](bff.md). Usar o cliente axios autenticado do Pulse, sem acesso direto do browser ao Redis/Zabbix/PostgreSQL.

| Rota | Resposta |
|---|---|
| `GET /api/monitoring/templates?hostKey=ASGARD` | Envelope `ReadResult<Template[]>`; hostKey opcional, lista dos templates descobertos no escopo atual |
| `GET /api/monitoring/templates/:templateKey` | Envelope `ReadResult<Template>`; ausente na descoberta: 404 `template_not_found` |
| `GET /api/settings/templates` | `{data: TemplateConfig[]}`; todas as configurações persistidas, inclusive sem descoberta atual; independe do Redis |
| `PUT /api/settings/templates/:templateKey` | Corpo estrito `{expectedRevision, displayName, roleOverride}`; 200 `{data: TemplateConfig}` na criação e na edição |

Lista de descoberta ordenada por hostKey, technicalName e templateKey. Filtro sem correspondência retorna lista vazia. Sem snapshot, lista vazia com `availability: no_data`; ciclo antigo/falho mantém sinalização stale e qualidade individual das métricas. Banco/cache inacessível: 503, nunca lista artificialmente bem-sucedida. Configurações sem descoberta não são apresentadas como templates disponíveis.

| Campo Template | Significado |
|---|---|
| templateKey | Mesma referência opaca da VM, usada para leitura/gravação e união com PostgreSQL |
| hostKey, templateId | Pai técnico e ID numérico do hipervisor como string; ID pode ser null quando não comprovado |
| technicalName | Nome atual da descoberta |
| displayName | Label persistida, quando não nula; caso contrário technicalName |
| virtualizationType | `qemu`, `lxc` ou null se a identidade não puder ser comprovada |
| role | `worker` ou `manager` efetivo |
| roleSource | `configuration` ou `name_convention` |
| memoryBytes | Capacidade de memória: Metric em bytes ou null |
| virtualCpuCount | Quantidade de vCPUs provisionadas: Metric em count a partir de VM.metrics.provisionedCpuCount, ou null quando sem item/evidência |
| diskBytes | Capacidade de disco: Metric em bytes ou null; nunca taxa de I/O nem disco livre do host |
| operatingSystem | Nome/versão confiável ou null; atualmente null |
| state, evidence | Estado e evidência da perspectiva do hipervisor; parado é normal para um template |
| configuration | TemplateConfig persistida ou null |

Metric preserva value, unit, observedAt, quality e validUntil quando disponível. Ausência não é zero. O nome não é usado para deduzir distribuição/versão, quantidade de CPUs ou disco. `worker` em qualquer posição do nome, sem distinguir caixa, define Worker; a ausência define Manager. Não foi encontrado metadado confiável de papel na origem consultada. `roleOverride` humano não nulo prevalece sobre a convenção.

## Persistência e edição

Migration `20261003093000_vm_template_configuration`; modelo Prisma `VmTemplateConfig`, tabela `vm_template_config`:

| Campos físicos | Regra |
|---|---|
| template_key | PK `vm-` + 32 dígitos hexadecimais; não é UUID de cadastro livre |
| host_key, template_id, virtualization_type | Identidade imutável; chave única composta; tipo qemu/lxc |
| original_name | Nome técnico capturado no primeiro salvamento humano; não acompanha renomeações automaticamente |
| display_name | Label opcional, aparada, 1–120 caracteres, sem controles; null restaura o nome técnico atual |
| role_override | worker/manager ou null para convenção automática do nome atual |
| revision | Inteiro positivo, incrementado pelo servidor; inicia em 1 |
| created_at, updated_at | Datas de persistência; não são datas da telemetria |

Não há campos de CPU, memória, disco, SO, estado ou histórico nessa tabela. Não se criam linhas automaticamente durante coleta/consulta. A primeira edição informa `expectedRevision: 0`; as demais usam a revision recebida. Ambos os campos editáveis são obrigatórios no PUT, inclusive quando null. Identidade, nome técnico e outros campos enviados no corpo são rejeitados; somente o servidor captura a identidade na criação.

A identidade utiliza o algoritmo existente do Collector: `vm-` seguido dos primeiros 32 caracteres SHA-256 de `JSON.stringify([hostKey, "qemu/ID" ou "lxc/ID"])`. O BFF verifica qual tipo reproduz exatamente a referência descoberta. Não tenta extrair IDs de nomes. Não unir por label, índice de lista ou ID sem host/tipo. Renomear preserva o vínculo enquanto pai/tipo/ID não mudarem. Reutilizar deliberadamente o mesmo ID no mesmo pai/tipo conserva essa identidade: a origem atual não oferece uma identidade de encarnação distinta, portanto não se promete detectar recriação.

Criação exige descoberta atual pronta, ciclo não stale e identidade verificada. Edição de uma configuração existente depende apenas do banco e da revisão, inclusive quando o template desaparece ou o Redis fica indisponível. A linha não é removida automaticamente; quando o mesmo template volta, as preferências reaparecem. Não existe DELETE: limpar preferências envia os dois campos null e preserva identidade/revisão.

Gravações usam transação Prisma, SQL parametrizado e advisory lock `734021005`, com comparação de revisão dentro da trava. Leituras usam Prisma sem depender de novo delegate em um cliente já carregado no desenvolvimento. Migrations seguem o mecanismo normal da imagem; aplicar a nova migration antes de utilizar essas rotas.

Erros: 400 entrada inválida; 401 sessão; 404 template não descoberto; 409 `revision_conflict`, `template_inventory_unavailable` ou `template_identity_unverified`; 503 dependência indisponível. Em conflito, o editor deve conservar rascunho e recarregar/reconciliar, sem repetir uma sobrescrita automaticamente. Configurações não resolvidas continuam disponíveis no GET de settings.

## Descrições de problemas

`Problem.description` conserva o texto original. `displayDescription`, opcional, encurta somente o prefixo exato `Proxmox VE: VM [HOST/NOME (TIPO/ID)]` quando host, VM, tipo e ID coincidem com a identidade descoberta e o sufixo tem separador reconhecido. Exemplo: `vm-operacao (101) · Not running`. A descrição do evento não é traduzida ou reinterpretada. Formato desconhecido ou vínculo ausente mantém o original.

O dashboard usa `displayDescription ?? description` e conserva o original no atributo title. Isso não altera severidade, início, recurso ou ID do problema. Um futuro detalhe deve permitir consultar o original também por toque/teclado, sem depender apenas do hover.

## Evidência e limites

Em 03/10/2026, a consulta de leitura do ASGARD encontrou 9 templates, com 90 itens relacionados: 4 Workers e 5 Managers pela convenção autorizada. `maxmem` forneceu memória para os nove. Não havia item comprovado de quantidade de vCPUs, capacidade de disco ou SO/versão. Os nove itens mestres `proxmox.qemu.get.data` não tinham valor armazenado (`lastclock=0`); não forneceram esses campos. Não foi criada integração Proxmox direta nem inferência pelo nome.

O inventário bruto tinha 33 entidades; o BFF retornou 24 VMs operacionais e os 9 templates em sua consulta própria. Métricas e storages do ASGARD permaneceram idênticos aos da fonte. Quantidades são evidência daquele instante, não constantes do aplicativo. O padrão dos alertas foi confirmado nos problemas reais antes da transformação.

Atualização posterior em 03/10/2026: o responsável disponibilizou o item dependente QEMU de vCPU. A API passou a retornar 33 itens de capacidade, incluindo os nove templates. `virtualCpuCount` agora reutiliza a métrica provisionada da VM, com qualidade/horário originais, sem depender de Agent e sem preencher pela CPU do SO. A ausência de disco virtual e SO/versão continua separada. O teste de integração confirma o novo campo e a preservação do filtro operacional.

O editor visual está implementado em `/admin/configuracoes`, com grupos Worker/Manager, capacidades observadas, preferências sem descoberta, conflitos de revisão e restauração confirmada. Consulte [Administração](administration.md). Testes cobrem persistência independente do Redis, identidade, desaparecimento/retorno e ausência de telemetria no banco.
