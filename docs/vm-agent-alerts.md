# Alertas de uso das VMs e métricas dos minicards

VMs com Agent Linux associado podem acompanhar CPU, RAM e ocupação do armazenamento. A configuração pertence ao recurso do Agent e é compartilhada entre ASGARD/VMs e Signal. Não depende da descoberta de containers e continua existindo após desvincular a VM do Signal.

## Configurar

1. Em **ASGARD e VMs**, abra a VM e use **Alertas e exibição**. O mesmo editor fica junto das VMs vinculadas e dos serviços de container em **Serviços → Signal**.
2. Ative somente os limites desejados e informe um percentual inteiro de 1 a 100. Nenhum limite é ativado automaticamente.
3. Para disco, selecione os filesystems que compõem o armazenamento monitorado. Mais de um exige confirmar que são independentes. Bind mounts e volumes que compartilham capacidade não devem ser somados.
4. Escolha CPU/RAM, CPU/Disco ou Disco/RAM e a fonte de CPU/RAM do minicard. Salve **Alertas e exibição**. A primeira gravação cria o recurso, se necessário, sem colocá-lo automaticamente no dashboard.
5. Confira a criticidade e **Notificações deste serviço**. A política geral, o escopo de críticos e as exceções continuam valendo. Essa política tem salvamento próprio.

É possível habilitar somente disco, deixando CPU/RAM desmarcados e mantendo o minicard CPU/RAM. O percentual sozinho não define quais volumes serão monitorados: marque ao menos um em **Armazenamento monitorado**. O formulário destaca essa seção e informa a pendência antes de enviar. Requisições diretas sem volumes retornam `400 capacity_required`; nenhuma seleção é inferida ou salva automaticamente.

Os alertas de CPU/RAM sempre usam o Agent. A fonte dos cards existentes permanece configurável: hipervisor, Agent ou automática. A prévia do editor identifica os valores como Agent; não promete o mesmo número quando o card usa hipervisor. As colunas do inventário ASGARD mantêm sua origem e composição anteriores.

Em **Serviços do cluster**, o seletor **Métricas do minicard** configura o par de cada serviço. CPU/RAM são do container; **Disco da VM** é da máquina onde o container resolveu nessa leitura. O botão **Alertas e exibição** abre a seleção de capacidade dessa VM. Mudar de worker passa a usar o Agent do novo worker; não conserva o disco da máquina anterior nem cria outro alerta de uso por container.

## Capacidade e ausência de leitura

O total é `100 × soma(usado em bytes) / soma(total em bytes)` dos volumes selecionados, nunca média dos percentuais. O detalhe da VM e o minicard com disco usam esse agregado. A raiz `/` isolada continua identificada como raiz quando não existe seleção salva; capacidade virtual do hipervisor não substitui ocupação interna.

Se faltar um volume ou operando, o agregado fica incompleto. Não se soma apenas a parte disponível. Leitura vencida pode ser consultada como antiga, mas não confirma excesso nem recuperação. O editor mostra usado/total, quantidade de volumes e a leitura atual; “—” não significa zero.

O vínculo deve ser único entre VM e Agent. Troca/perda da associação suspende as condições de uso. O editor preserva a configuração e permite **Usar vínculo atual da VM** quando houver nova associação comprovada; é necessário revisar e salvar novamente. Os alertas não são transferidos silenciosamente para outra VM.

## Controle de ruído e notificações

| Métrica | Excesso e recuperação |
|---|---|
| CPU/RAM | Pelo menos 60 segundos e duas amostras novas válidas |
| Disco | Pelo menos 30 segundos e duas amostras novas válidas |

Abre em valor maior ou igual ao limite. Recupera abaixo de `limite − min(5, limite/2)` pontos percentuais, pelo mesmo prazo. Para 70%, recupera abaixo de 65%. Esses tempos são mínimos: o intervalo/heartbeat dos itens Zabbix pode prolongá-los. Polling da mesma evidência não conta como nova amostra.

O primeiro excesso após ativação manual pode gerar aviso após confirmação. Um excesso contínuo produz um incidente, sem repetição a cada coleta ou após marcar como lido. Ausência de leitura conserva incidente ativo e limpa confirmação pendente; não é recuperação. Reinício conserva checkpoint e deduplicação no PostgreSQL.

O evento **Uso de recursos** (`usage`) usa severidade e som **warning**. A recuperação é contextual e segue a política existente; som de recuperação continua desligado no padrão. `attention` permanece separado e desligado no padrão. Nenhum som novo por componente: o caminho Kobra existente respeita mute, volume zero, cooldown, coordenação entre abas e áudio em segundo plano.

Histórico/leitura são compartilhados. O evento salva valor, limite, margem de recuperação, origem, abrangência segura e data da evidência. Editar o limite não reescreve esse histórico. O detalhe do incidente identifica o último evento como histórico, não como medição atual.

## Contratos e operação

- `monitored_resource_config.agent_monitoring`: vínculo VM, seleção de volumes e limites; `{}` significa não configurado. `revision` cobre todas as alterações do recurso.
- `presentation.cardMetrics`: par opcional do minicard host, editável também em Recursos por um único seletor. Recursos e o editor da VM sincronizam o par e as flags legadas ao salvar; não há checkboxes de CPU/RAM/disco independentes no host. Ausente mantém até duas leituras legadas das flags, com prioridade para disco quando marcado. A adoção de um par legado ao abrir Recursos é somente um rascunho até salvar.
- `signal_service.card_metrics`: par do serviço do cluster, padrão CPU/RAM, usando as revisões existentes.
- `notification_event.metric_context`: contexto imutável do evento; não armazena série de telemetria.
- `GET/PUT /api/settings/agent-monitoring/:hostKey`: editor autenticado. PUT exige `expectedRevision` (zero na criação), contexto, capacidade e limites. GET não cria recurso.
- PATCH/DELETE de `/api/monitoring/services/:id` também exigem `expectedRevision`; conflito retorna 409 e mantém o rascunho. O CRUD genérico preserva as preferências omitidas e não aceita configurar regras sem o contexto validado do Agent.
- Leituras do BFF expõem somente os valores/apresentação necessários; a superfície pública remove `agentMonitoring` e não oferece edição.

O Collector existente avalia as métricas já coletadas. Não existe worker adicional, consulta por serviço ao Zabbix ou player novo. Configurações são capturadas antes da observação; regra, revisão de escopo e identidade são revalidadas na transação. Alterar limite limpa somente sua condição `metric:*`; selecionar volumes afeta disco. Disponibilidade mantém lifecycle próprio.

O recurso avulso sem `agentMonitoring` pode exibir a leitura percentual da raiz `/` no minicard, com origem identificada; isso não configura agregado nem alerta. Quando existe configuração de monitoramento, o card exige a capacidade e o vínculo correspondentes: falta de dados não autoriza substituir a seleção pela raiz. O editor de regras **Alertas e exibição** continua exigindo seleção explícita para disco. Prévia de Recursos e dashboard compartilham o cálculo; o indicador mantém duas métricas e 120px. Detalhes em [Minicards](availability-cards.md).

A migration `20261029090000_agent_usage_alerts` é aditiva e não ativa limites. Para uma publicação futura autorizada, atualizar Web e Collector como uma entrega compatível, aplicar migrations e reiniciar o Collector existente antes de ativar regras. Recarregar clientes abertos. Não servir leitores antigos que desconheçam `usage`. Um retorno de versão precisa preservar a leitura desse contrato/histórico ou restaurar um conjunto aplicação/banco compatível; desativar novos limites, sozinho, não torna eventos existentes compatíveis com leitores antigos.

Consulte [Notificações](notifications.md), [BFF](bff.md), [Minicards](availability-cards.md), [Workers](workers.md), [Design system](design-system.md) e [Sons](interface-sounds.md).
