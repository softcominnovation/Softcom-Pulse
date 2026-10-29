# Notificações de serviços

A central do cabeçalho reúne histórico, não lidas e incidentes atuais. Avisos temporários usam o toast Kobra sobre a página, sem reservar espaço dos cards. O bloco legado comentado permanece preservado. Consulte também [Design system](design-system.md), [Sons](interface-sounds.md), [BFF](bff.md) e [Workers](workers.md).

## Uso e configuração

A política geral fica em **Configurações → Notificações de serviços**. Recursos, aplicações HTTP, VPS, Signal, serviços do cluster Signal e Storage possuem exceções no respectivo editor, depois que o cadastro existe. Salvar notificações é uma ação própria; não salva nem descarta o rascunho do cadastro. Criticidade continua sendo propriedade do serviço; as exceções de notificações não a alteram. O serviço do cluster (`signal_service`) notifica status e health do container pelo prefixo estável. A troca da task não cancela o incidente. Sem cobertura Docker integral, a ausência do container não abre indisponibilidade.

| Opção | Padrão |
|---|---|
| Elegibilidade | Serviços críticos |
| Eventos | Indisponibilidade, problema e recuperação; atenção desativada |
| Problemas Zabbix | Severidade mínima 4 |
| Áudio | Indisponibilidade/problema críticos; recuperação silenciosa |
| Posição do aviso | Centro do header; também canto inferior direito e canto superior direito |
| Duração do aviso | 8 segundos; configurável entre 4 e 15 |
| Intervalo mínimo entre sons | 15 segundos; configurável até 120 |
| Retenção | 30 dias; configurável entre 7 e 365 |

Exceções podem herdar, habilitar ou desabilitar notificações e sons, além de selecionar eventos. A configuração usa revisão: edição concorrente retorna conflito e mantém o rascunho. Exceções órfãs são identificadas sem transferir regras para outro cadastro. VPS também possui `critical`, inicialmente falsa.

Histórico e leitura são globais no PostgreSQL. Marcar como lida em uma tela atualiza as outras no próximo polling, aproximadamente dez segundos. Abrir a central não marca automaticamente; a ação exige editor autenticado. A apresentação pública consulta a mesma central em modo de leitura. **Ler não resolve o incidente**: recuperação depende de evidência da origem. “Marcar todas” considera somente a revisão já observada, preservando eventos posteriores.

## Registro e entrega

Os monitores existentes avaliam disponibilidade, estado, health e problemas confirmados. Não há novos limiares de CPU, RAM ou disco. HTTP usa duas amostras válidas consecutivas; evidência explícita Zabbix pode confirmar imediatamente. Amostra antiga, desconhecida ou ausente não significa recuperação. Falha na API Zabbix não torna todos os serviços indisponíveis.

O primeiro estado de cada família estabelece referência silenciosa. Reinício, reconexão e retorno de uma aba ao primeiro plano sincronizam sem reproduzir avisos históricos. Desabilitar alertas preserva incidentes reais; pausar/remover o monitor ou trocar sua identidade cancela os incidentes anteriores sem anunciar recuperação. Uma nova identidade começa silenciosamente. Remover um cadastro preserva seu histórico e retira o link de navegação.

O navegador agrupa chegadas por dois segundos, mantém até três grupos pendentes e mostra somente um aviso operacional por vez, e somente com a aba visível. Excesso de chegadas é incorporado ao último resumo; ocorrências e serviços distintos são contados separadamente. Há dez segundos de intervalo visual após fechar um aviso. Somente eventos criados há até 60 segundos podem gerar o aviso na tela. O som com a aba fora de foco aceita o alerta que a enquete ainda alcança em até 3 minutos. Os mais antigos continuam no histórico. Leitura compartilhada e fechamento do incidente removem avisos pendentes na tela. Uma recuperação que chegue na mesma enquete não apaga o som da queda: toca o mais grave.

Um alerta novo solicita reprodução assim que o polling o recebe, inclusive com a aba fora de foco, depois de uma interação real e respeitando mute, volume e movimento reduzido. O som independe do agrupamento e do temporizador dos toasts: um aviso visual ainda aberto não impede o áudio de uma nova chegada depois do cooldown. Retornar ao foco não reproduz o que ficou para trás. Se uma aba não conseguir iniciar, não marca o som como consumido.

As notificações usam arquivos WAV dos próprios sons Kobra, decodificados e guardados em memória. Em cada chegada, `NotificationAudio` retoma o contexto Web Audio quando necessário e cria um `AudioBufferSourceNode`, seguindo a rotina do projeto de referência indicado pelo dev. O botão **Testar som** no cabeçalho testa o mesmo caminho. Reprodução recusada não fica guardada para o próximo foco; mute e volume zero zeram o ganho e interrompem a fonte. Esta abordagem substitui o player HTMLAudioElement que não funcionou no teste do dev. Não há worker, permissão de notificação do sistema ou configuração nova no servidor.

O teste de regressão usa um perfil temporário de navegador, sem a emulação de foco do Playwright, minimiza a janela, verifica `document.hidden === true` e mede sinal de áudio de um evento novo enquanto ela continua oculta. Isso valida o cenário automatizado; o aceite no navegador e saída de som do dev permanece pendente.

O navegador pode atrasar o polling de uma aba oculta ou suspender/descartar a página para economizar recursos. O som acompanha a chegada enquanto o JavaScript da página continua executando; aba descartada, navegador fechado e dispositivo suspenso não oferecem essa garantia. Essa limitação não significa que abas em segundo plano sejam proibidas de tocar áudio. Referências: [autoplay do Chrome](https://developer.chrome.com/blog/autoplay/) e [timers de abas ocultas](https://developer.chrome.com/blog/timer-throttling-in-chrome-88).

Enquanto a aba está fora de foco, com incidente ativo e notificação ainda não lida, o ícone da aba ganha um X vermelho. Marcar as notificações como lidas tira o X, mesmo que o incidente continue aberto. A recuperação do serviço também tira o X. Ao focar, o ícone volta ao traço normal. Sair de novo só recoloca o X se ainda houver incidente ativo e notificação não lida. O contador do sino continua sendo o de não lidas.

O sino fica por último nas ações do cabeçalho. **Ctrl+Shift+K** abre e fecha a central; **Ctrl+K** continua sendo a busca e ignora Shift e Alt. A central abre em Não lidas e oferece, nessa ordem, Não lidas, Incidentes atuais e Histórico.

O aviso operacional segue a posição salva na política. O padrão é o centro da faixa do header, 16 px acima do meio dessa faixa. Canto inferior direito entra na pilha dos avisos comuns. Canto superior direito usa uma pilha própria no topo. A posição vale para a instalação e chega nas telas pelo `runtime`; não é exceção por serviço.

O toast expira mesmo com mouse sobre ele; somente foco de teclado dentro do próprio aviso pausa sua expiração. Falha de sincronização mantém as últimas contagens com indicação de indisponibilidade, sem gerar outro alarme. A última atividade de cada origem indica coleta recebida, não garante saúde de todos os serviços.

## Sons Kobra

| Situação elegível pela política | Som |
|---|---|
| Indisponibilidade/problema crítico | `error` |
| Atenção | `warning` |
| Informação | `notification` |
| Recuperação, quando habilitada | `success` |

Não há sirene, repetição até reconhecimento ou fila de áudio. Todo som passa pelo mecanismo único de `components/ui/sound.tsx`. Mute e volume zero bloqueiam novos sons e interrompem os atuais; aumentar depois não reproduz notificações antigas. Movimento reduzido e a exigência de uma interação prévia nessa página continuam respeitados. Aba fora de foco não é, por si, motivo para descartar o som da chegada.

Abas da mesma origem coordenam somente áudio por Web Locks e identificadores temporários locais, inclusive a aba que toca um alerta enquanto está atrás. Todas as telas visíveis podem exibir seu aviso. Sem coordenação/armazenamento, cada aba ainda aplica seus limites locais. Dispositivos diferentes possuem volume e mute próprios e podem tocar independentemente. Nenhuma preferência sonora local altera o histórico compartilhado.

## Persistência e execução

A migration `20261028010000_notification_center` cria `notification_target_state`, `notification_incident`, `notification_event`, `notification_stream_state` e `notification_change`, acrescenta `standalone_vps.critical` e inicializa `pulse_settings.notifications`. Deve ser aplicada antes dos processos atualizados. O entrypoint existente continua executando `prisma migrate deploy` nas instalações usuais. Não há variável de ambiente nem worker novo.

Collector Zabbix, Probe, VPS Monitor e Signal Monitor registram transições após sua coleta principal. Falha nesse registro não invalida a amostra técnica. Configuração, época do monitor e checkpoints são revalidados na transação. Triggers de configuração cancelam incidentes e renovam a época na mesma transação da alteração, impedindo uma coleta antiga de reabrir o serviço removido.

A revisão global é bloqueada no fim da escrita para seguir a ordem de commit. O feed mantém alterações imutáveis e janela capturada de paginação. Abort não avança o cursor. Há uma repetição curta de persistência, com orçamento total de 2,5 segundos e cancelamento; não se repete a consulta externa. Não se promete entrega exata durante indisponibilidade prolongada do banco: a coleta seguinte reconcilia o estado válido, silenciosamente quando necessário.

Consultas Zabbix adicionais são limitadas e compartilham o cancelamento do ciclo. Falha no complemento Storage não descarta os demais recursos. Ausência de problema só permite recuperação quando sua resolução foi confirmada. Troca da referência efetiva de container cancela o incidente anterior, sem atribuí-lo ao novo container.

A manutenção usa o Collector existente, com lotes limitados. Incidentes ativos e eventos não lidos são preservados; incidentes encerrados com leitura antiga podem expirar conforme retenção. O feed técnico possui janela de sete dias; cursor expirado exige sincronização completa silenciosa. Não são armazenadas séries de métricas nem inventário Zabbix nessas tabelas.

## Contrato BFF

| Método e rota | Finalidade |
|---|---|
| `GET /api/monitoring/notifications` | Histórico, filtros, contagens, atividade das origens e cursor |
| `GET /api/monitoring/notifications/changes` | Alterações após um cursor, em janela consistente |
| `GET /api/monitoring/notifications/incidents` | Lista de incidentes |
| `GET /api/monitoring/notifications/:eventId` | Detalhe do evento e do incidente |
| `GET /api/monitoring/notifications/incidents/:incidentId` | Detalhe e histórico do incidente |
| `POST /api/monitoring/notifications/read` | Leitura global por IDs ou revisão limite |
| `GET /api/settings/notifications` | Política, serviços e exceções órfãs |
| `PUT /api/settings/notifications` | Política geral com revisão esperada |
| `PUT /api/settings/notifications/targets/:targetRef` | Exceção de serviço com revisão esperada |

As cinco consultas também existem sob `/api/public/monitoring/notifications`, sujeitas ao host público permitido. Não há escrita pública. Políticas e escrita exigem editor. Listas retornam até 100 entradas; feed, até 200 alterações por página. Corpo da política geral: até 512 KiB; demais escritas: 64 KiB. Conflito de revisão ou cursor expirado retorna 409.

DTOs usam IDs opacos e mensagens permitidas. Não expõem credenciais, payloads HTTP, nomes brutos de problemas, hostid, chaves internas de condição ou identidade de quem marcou como lida. Links de detalhe são internos e respeitam modo público/privado.
