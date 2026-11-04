# Monitoramento de VMs de Storage

## Métricas do minicard

Em **Editar configuração → Métricas do minicard**, escolha CPU/RAM, CPU/Disco (padrão), Disco/RAM ou CPU/RAM/Disco. No trio, disco ocupa a linha superior inteira e CPU/RAM ficam abaixo. Na Disponibilidade, o envelope respeita Padrão (120px) ou Ampliado (140px) do bloco, compartilhado com os outros cards da grade. Os painéis grandes conservam seu conteúdo.

Disco usa os volumes já selecionados, RAM usa o percentual do Agent e o rodapé mantém RX/TX da interface configurada. Ausência/expiração conserva a célula selecionada com **—**; zero aparece como zero. Alterar as métricas não altera o alerta de disco; salvar Notificações conserva as métricas. Restaurar padrões de apresentação volta a CPU/Disco, preservando os limites/volumes do alerta ativo.

Preferência em `storage_config.card_metrics`, adicionada por `20261103190000_minicard_three_metrics` com default CPU/Disco. Requisições legadas que omitem o campo conservam o valor anterior. Sem nova rota, worker ou consulta Zabbix.

## Alerta de ocupação do disco

Em **Serviços → Storages → Notificações deste serviço → Alerta de disco**, marque **Alertar ocupação do disco**, informe **Limite de disco (%)** (1–100) e clique em **Salvar alerta de disco**. A sugestão inicial é 70; só salvar ativa a regra. O limite significa percentual **ocupado**, usando a mesma capacidade ponderada dos cards. Salve primeiro o cadastro do Storage, caso ainda não exista.

O alerta exige volumes explícitos. Ao marcar, o modal apresenta a seleção atual do card (raiz/único quando disponível) e a fixa ao salvar. Para escolher outros volumes ou confirmar independência de mais de um, use **Editar configuração**; depois revise o alerta. Uma montagem desaparecida não é substituída por outra. Ativação/novos volumes exigem descoberta e capacidade válidas; desativação e ajuste de limite existente, conservando seleção, funcionam durante falha de coleta.

O Collector existente confirma após duas amostras novas e válidas separadas por pelo menos 30s. Recupera após o mesmo prazo abaixo de `limite − min(5, limite/2)`; para 70%, abaixo de 65%. Dado antigo/incompleto/ausente não abre nem recupera. O aviso é `usage`/Atenção, sem mudar a disponibilidade do Storage. Uma condição contínua gera um incidente, sem repetição a cada coleta ou após marcar como lido.

Os 30s são um prazo mínimo: o intervalo/heartbeat dos itens Zabbix pode prolongar a confirmação. Reempacotar a mesma leitura em outro ciclo do Collector não conta como amostra nova.

Confira **Storage crítico**, a política geral e **Notificações deste serviço → Entrega e sons → Uso acima do limite**. Histórico/leitura são compartilhados; som warning pelo player Kobra existente, respeitando mute, volume zero e cooldown. A configuração é independente das regras da VM/Agent em ASGARD; mantenha somente a desejada para evitar avisos de dois cadastros sobre o mesmo disco.

O botão **Notificações deste serviço** fica no bloco da máquina, junto de **Editar configuração**, e abre seu próprio modal, dividido em **Alerta de disco** e **Entrega e sons**. Ativação/limite e preferências de entrega têm botões de salvamento próprios; alternar abas ou fechar não salva nem descarta rascunhos. **Editar configuração** mantém nome, apresentação, criticidade, volumes e rede, preservando o limite salvo. Restaurar padrões preserva criticidade, alerta ativo e os volumes desse alerta. Revisões continuam impedindo sobrescritas concorrentes.

`diskWarningPercent` é privado do editor e persiste em `storage_config.disk_warning_percent` (nullable). Requisição legada que omite o campo preserva o valor existente; null explícito desativa. Mudar limite/seleção cancela somente `metric:disk`, preservando histórico, disponibilidade e problemas Zabbix. Capturas anteriores à edição não reativam a regra antiga. GET/PUT e revisão são os mesmos.

A migration aditiva `20261029120000_storage_disk_alert` mantém cadastros anteriores com alerta desativado. Atualizar Web/Collector e aplicar migrations no procedimento autorizado; reiniciar o Collector existente e recarregar clientes ao disponibilizar em outro ambiente. Sem worker, rota, player ou consulta Zabbix por card adicionais. Consulte [Notificações](notifications.md).

No desenvolvimento local, depois de aplicar a migration e gerar o Prisma Client, reinicie **a aplicação e o Collector**, pois os processos podem conservar o cliente/modelo anterior em memória. Recarregue o navegador. Não é necessário cadastrar novamente o Storage nem reiniciar os demais workers por esta funcionalidade. Se Web/Collector já carregaram o alerta de disco, os refinamentos de modais/abas exigem apenas o app atualizado e recarregar a página.

Storage é um serviço descoberto pelo Collector Zabbix existente. A classificação exige uma tag do próprio host com o par **exato** `role=storage`, sensível a maiúsculas e espaços. Uma correspondência basta, mesmo após outra tag `role`. Hostname, endereço, VMID, tags de item e templates não classificam a máquina.

## Descoberta e identidade

O Collector faz `host.get` filtrado por tag com `selectTags`, revalida o resultado e inclui hosts fora do escopo manual. Não altera `monitoringScope`, vínculos de VMs, `Host.role` ou contadores do ASGARD. Não exige vínculo com o hipervisor. Hosts desabilitados continuam identificados, com estado neutro e sem coleta operacional.

`storageKey` é uma referência opaca derivada de `hostid`. Renomear o host conserva preferências; outro hostid com o mesmo nome não as recebe. Volumes/interfaces têm chaves opacas vinculadas ao host e à identidade técnica da montagem/interface. Seleções desaparecidas não são remapeadas por semelhança de nome.

A rotina reaproveita itens/valores já coletados e busca os demais em lote. Limites: 100 hosts (sentinela 101), 5.000 metadados adicionais (sentinela 5.001). Não solicita valores raw ou Docker para Storage. Conserva metadados de masters para avaliar itens dependentes, sem buscar seus corpos. Uma fonte direta prevalece sobre uma cópia dependente do mesmo mount/chave; duplicidade na família preferida é ambígua e não produz capacidade.

O ramo tem até 8s, limitado pelo tempo restante do ciclo de 25s, com reserva para publicação. Usa o mesmo cliente, cancelamento e processo. Não existe worker, script contínuo, credencial ou endpoint adicional de coleta.

## Evidência e disponibilidade

`pulse:inventory:storages` participa da mesma transação/geração Redis dos snapshots principais. Payload interno: versão 1, estado `ok|failed`, tentativa, último sucesso, classificação/evidência, métricas e ausências confirmadas. Preferências não entram nesse snapshot.

Falha isolada preserva os dados anteriores com os horários originais e marca Storage como `failed`, sem envelhecer o ASGARD. Falha/cancelamento global mantém a semântica do Collector. Reempacotar o snapshot não renova classificação ou métricas. Classificação expira pelo `SNAPSHOT_STALE_AFTER_MS`; métricas usam a validade/heartbeat comum.

Ao marcar uma falha global, o Lua/cjson do Redis pode regravar listas vazias como `{}`. A leitura normaliza somente esse objeto vazio para `[]` em `sync.keys` e `sync.extensionKeys`, preservando a leitura das últimas amostras como desatualizadas. Objetos com propriedades, listas inválidas e gerações misturadas continuam rejeitados. A marcação de falha não renova TTL, geração ou horário do último sucesso.

Uma consulta completa confirma configurações ausentes em lote por hostid: `tag_missing` ou `host_missing`. Falha, limite e resposta inconsistente usam `inventory_unavailable`. Configurações são preservadas. Web novo com Collector antigo/sem a chave retorna `no_data`.

Uma função define a pílula em Serviços, minicard e painel:

| Evidência | Apresentação |
|---|---|
| Host desabilitado na origem | Monitoramento desativado |
| Tag/host ausente ou identidade não comprovada | Neutro, com motivo |
| Ramo falho ou evidência vencida | Desatualizado |
| Indisponibilidade atual comprovada | Indisponível |
| Agent alcançável | Disponível |
| Agent alcançável e CPU/RAM atuais simultaneamente ≥90% | Atenção |

Silêncio não significa offline. Agent disponível não prova saúde de NFS/SMB. Disco/readonly não introduzem outro limiar de disponibilidade.

## Capacidade e métricas

CPU, RAM e uptime reutilizam a normalização Agent. RAM pode derivar de used/total ou total/available coerentes, conservando a evidência mais restritiva. Disco usa filesystems do Agent, sem fallback Proxmox ou outra máquina.

Sem seleção explícita, usa `/`; se não existir, somente o único filesystem descoberto. Vários sem raiz pedem seleção. A abrangência fica visível: raiz não significa todos os discos físicos.

Seleção múltipla exige confirmação humana de volumes independentes. O software não prova que mounts, bind mounts ou datasets não compartilham capacidade. O editor mostra tipo/capacidade observados; trocar o conjunto limpa a confirmação no rascunho.

Capacidade é `100 × ΣusedBytes / ΣtotalBytes` dos mesmos volumes. Exige todos os pares presentes, finitos, não negativos, total positivo e used ≤ total. Não usa média de percentuais ou infere bytes de pused. Ausência de um volume/operando torna o agregado incompleto; dado antigo torna o resultado antigo. Horário é o mais antigo e validade é a mais curta dos operandos. O percentual nativo permanece na linha do volume.

Disponível vem do `free` observado e pode diferir de total-used por espaço reservado. Complementos: uptime, espera por I/O, inodes livres e readonly quando suportados. RX/TX aparece somente após escolher uma interface; não soma bridges com interfaces físicas. Ausência não vira zero. IOPS, latência de disco, saúde de exports e nomes de containers ficam fora desta entrega.

## Uso da interface

**Serviços → Storages** mostra toda máquina descoberta, sem cadastro. O título da seção fica dentro do contêiner, com um painel próprio por máquina. Os cabeçalhos dos painéis usam `ServiceTitle`: nome, ponto neutro decorativo e disponibilidade, com espaçamento igual nos dois lados do separador, conforme o guia Kobra. Editores configuram nome, descrição, destaque, criticidade, ordem, volumes e interface. O nome vale apenas para Storage. Outro recurso genérico da mesma VM pode continuar destacado; o editor avisa sobre essa possibilidade.

O destaque inclui o minicard no conjunto padrão de **Disponibilidade de Serviços**. A seleção personalizada aceita `storage:<UUID-da-preferência>` mesmo sem destaque. O minicard mantém 120px, mostra CPU e disco ocupado (%) da capacidade selecionada, com barra de disco âmbar. O rodapé mostra RX e TX da **interface de rede já configurada**, com as mesmas taxas/unidades do painel, sem somá-las. Zero observado permanece zero; sem seleção/amostra aparece “—”; dado antigo é identificado. Uptime/leitura ficam na dica e no painel completo. O minicard abre o detalhe e permite ir à máquina em Serviços. Desligar destaque não esconde o painel em Serviços.

Para exibir o tráfego, abra **Configurar Storage** na máquina em Serviços, selecione a interface de rede monitorada e salve. Essa única seleção alimenta painel, modal e minicard; não há configuração separada de I/O. RX é a taxa de entrada e TX a de saída da conexão escolhida, sem relação com IOPS de disco ou com o percentual de espera por I/O da CPU. Se o modal já mostra RX/TX, o minicard usa os mesmos dados após a atualização normal, sem migration ou reinício adicional por esse ajuste.

Para painel grande, configure a máquina em Serviços e adicione **Storage · capacidade e recursos** em **Configurações → Novo bloco**. Escolha a preferência e de 1 a 10 linhas de volumes (padrão 3). Usa `options.storageConfigId`, não `resourceConfigId`. Nome e capacidade vêm da configuração única. Nenhum bloco é inserido automaticamente em telas salvas.

`StoragePanel` é compartilhado por Serviços, raiz, modal e prévia. Volumes continuam alcançáveis por rolagem com cabeçalho/rodapé preservados. Telas com Storage usam planejador por UUID; layouts anteriores conservam seu caminho. A prévia avisa quando é preciso rolar. Consulte [Encaixe](overview-fit.md).

Adicionar um painel Storage não estica uma fileira exclusiva de Disponibilidade: ela mantém a altura dos cards visíveis, com rodapé logo abaixo. O espaço restante atende aos painéis flexíveis. Fileiras mistas, como Disponibilidade/Problemas no split, continuam compartilhando altura. O encaixe se recalcula quando o conteúdo muda pelo monitoramento, também na prévia.

Falha/409 preserva rascunho; recarregar e restaurar padrões exigem confirmação. Salvar usa toast Kobra após a resposta e o listener global fornece o som. Polling não toca alarmes. Tema, mute, volume e movimento reduzido seguem os [guias de interface](design-system.md) e [sons](interface-sounds.md).

## Persistência e BFF

Migration `20261027160000_storage_configuration` cria apenas `storage_config`. Não semeia hosts ou muda apresentação. Armazena identidade derivada no servidor, UUID, preferências, seleções, confirmação, revisão e datas; não telemetria, tags, IP ou credenciais.

Criação usa `expectedRevision:0`; edição compara/incrementa revisão atomicamente. Concorrência retorna 409. Reset envia defaults com revisão e preserva UUID. Criação/novas seleções exigem descoberta atual do mesmo Storage. Texto/apresentação/reset de preferências existentes funcionam sem Redis. Não há DELETE operacional ou pausa da coleta.

| Rota | Resposta/acesso |
|---|---|
| `GET /api/monitoring/storages` | `ReadResult<StorageInventory>`, lista e configurações órfãs separadas |
| `GET /api/monitoring/storages/:storageKey` | `ReadResult<StorageView>`, sem consulta Zabbix |
| `GET /api/settings/storages` | `{data:StorageConfig[]}`, somente editor |
| `PUT /api/settings/storages/:storageKey` | Preferências estritas + expectedRevision, somente editor |

Overview resolve snapshot/preferências em lote, sem consulta por máquina/bloco. Serviços faz polling agregado; detalhe só lê enquanto aberto e cancela respostas tardias por identidade. BFF/browser não executam coleta. Banco indisponível conserva telemetria/nomes técnicos e informa personalização indisponível.

As versões públicas dos dois GETs de monitoramento usam `PULSE_PUBLIC_HOSTS` e o no-store existente. Overview público também sanitiza cards/blocos. Devolvem nome intencional de exibição, estado, referências opacas e métricas seguras. Volumes recebem labels genéricos estáveis. Não devolvem hostid/itemid, tags, endereços, mounts, nomes de interfaces ou notas privadas. Não existem settings/escrita sob `/api/public`.

Para disponibilizar em outro ambiente, aplicar a migration e atualizar Web/Collector pelo procedimento autorizado. A chave Storage é anunciada em `sync.extensionKeys`, na mesma geração; `sync.keys` conserva somente os namespaces anteriores. Assim, Web antigo ignora a extensão sem rejeitar os snapshots principais. Web novo aceita a ausência da extensão e retorna sem dados quando o Collector ainda é antigo. A migration foi aplicada no PostgreSQL local `pulse` em 27/10/2026 para habilitar o editor; nenhum ambiente remoto foi publicado.
