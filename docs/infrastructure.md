# Infraestrutura, hosts e VMs

As rotas exigem a mesma sessão corporativa do dashboard. As abas **Visão geral**, **Infraestrutura** e **Asgard & VMs** navegam separadamente; a reprodução do telão continua restrita às composições salvas. A UI não chama Zabbix ou Proxmox diretamente e não oferece ações de energia.

## Navegação

| Rota | Conteúdo |
|---|---|
| `/infraestrutura` | Inventário de hosts, filtro por host, VMs operacionais e problemas do escopo |
| `/asgard?hostKey=<pai>&range=<janela>` | Indicadores, storages, totalizadores, histórico e outras métricas do hipervisor |
| `/asgard?hostKey=<pai>&vm=<vmKey>&range=<janela>` | Indicadores e histórico da VM selecionada, métricas complementares, Agent quando vinculado e tabela com a seleção destacada |
| `/hosts/<hostKey>?range=<janela>` | Perspectiva Linux/Agent: métricas internas, filesystems, interfaces, histórico e problemas |

Em `/asgard`, omitir `vm` seleciona o host. Omitir `hostKey` usa `asgardHostKey` do envelope de hosts; sem resolução explícita, somente um hipervisor único pode ser selecionado automaticamente. Vários candidatos exigem escolha. Não há seleção por nome fixo nem primeiro item arbitrário.

Os nomes das VMs no resumo da raiz e nas tabelas são links reais, com pai e `vmKey` opaca codificados. Funcionam em acesso direto, nova aba, recarga e voltar/avançar. Select, URL, período, título do gráfico e linha ativa permanecem sincronizados. A linha usa fundo `#192c29`, indicação textual acessível e `aria-current`. Trocar o select mantém seu foco; polling não move rolagem ou foco.

Parâmetros inválidos/duplicados e recursos fora do escopo produzem mensagens explícitas. VM de outro pai ou template nunca seleciona uma vizinha. Se a seleção desaparecer da coleta, a página mantém a URL, informa a perda e, quando conhecida nesta navegação, a última identificação. Não conserva métricas de outra VM.

Uma VM sem Agent tem detalhes e histórico do hipervisor. “Detalhes do Agent” existe somente quando `linuxHostKey` está associado. A expansão **Perspectiva do Agent desta VM** mostra dados internos em seção identificada; não mistura CPU/RAM das duas origens. Serviços e containers por VM continuam reservados à próxima entrega; não há botão inativo.

## Leitura e histórico

A tabela detalhada mantém a célula Agent compacta: um medidor do uso atual do filesystem raiz `/` e a quantidade de filesystems descobertos. Não soma capacidades nem empilha volumes; sem raiz, informa a ausência em vez de usar outro filesystem silenciosamente. Todos os volumes e capacidades continuam acessíveis no link/expansão Agent. O medidor não representa histórico e não inicia consulta por linha. Os dados permanecem textuais quando desatualizados, sem barra de uso atual.

Abaixo do uso de CPU, a listagem mostra somente a quantidade provisionada, como `4 vCPUs`, de `VM.metrics.provisionedCpuCount`. Não exibe o sufixo Proxmox nem uma segunda linha com CPUs do SO ou sua ausência. Sem capacidade provisionada, mostra `vCPUs: —`; nunca a preenche pelo Agent. Qualidade e horário permanecem no título do valor, com estilo de dado antigo quando necessário.

`Host.metrics.osCpuCount` permanece somente nos detalhes da VM/Agent com vínculo confirmado, incluindo a expansão da perspectiva Agent. A VM sem Agent continua exibindo vCPUs na tabela, sem rótulo redundante de SO indisponível. A composição compacta e a altura uniforme das linhas são preservadas.

Os detalhes e as séries históricas usam os nomes `vCPUs provisionadas · Proxmox` e `CPUs reconhecidas · SO`, com unidade count separada do percentual de uso. Não se infere quantidade pelo percentual, memória, nome ou métricas de containers. O item QEMU respeita o heartbeat de 10 minutos e não exige Agent; o item do SO mantém seu próprio heartbeat.

Inventários e problemas usam os endpoints existentes e `refreshAfterMs`, com requests canceláveis, sem sobreposição. Falha conserva somente a última leitura da mesma identidade e sinaliza desatualização; ausência nunca vira zero saudável. Métricas mantêm seu próprio horário, qualidade e validade.

Históricos são carregados sob demanda por recurso/janela, sem polling por linha:

- Uma chamada para o recurso exibido: host na visão do hipervisor ou VM na visão da máquina virtual. Abrir uma VM não carrega nem exibe o histórico do pai.
- Ao expandir a perspectiva Agent, no máximo uma chamada adicional para esse Agent.
- Trocar período atualiza somente os históricos exibidos. Requests superadas são abortadas; a resposta precisa corresponder à identidade e janela solicitadas.
- Cache em memória limitado a 24 entradas, reutilizadas por até 60 segundos durante a navegação da página. Não persiste no armazenamento do navegador e é descartado ao desmontar a página/sessão. Atualizar ignora o cache.

A página começa em **24 horas**; as opções são 1 hora, 24 horas e 7 dias. O default dos endpoints continua **1 hora**. Sete dias exibe médias horárias quando `source=trends`, com mínimos/máximos na leitura da amostra. `coverageLimited` e lacunas são visíveis. Sem série ou amostra, não há curva ilustrativa.

uPlot desenha as séries com resize e descarte da instância. CPU é verde `#64d6b0`, RAM azul `#80bdf2`, disco âmbar `#f2c275`; cores identificam métricas, não severidade. A seleção inicial prioriza CPU e séries com evidência. O seletor de métricas mantém disponíveis também grupos sem amostras.

Unidades e dispositivos são separados: percentuais, capacidade em bytes/GiB, taxas de rede e de I/O, uptime. RAM histórica em bytes não é convertida em percentual pela capacidade atual. Cada filesystem/interface/storage mantém seu nome. Não se somam pools, discos provisionados e filesystem; a capacidade do hipervisor não representa ocupação interna da VM.

O leitor de amostras oferece horário de Fortaleza, unidade, valor pt-BR, mínimos/máximos e “Sem dados”. Funciona por mouse, teclado ou toque, mesmo sem canvas disponível. Pontos ausentes são `null`, sem interpolação sobre a lacuna.

## Layout e componentes

A visão do host mantém seus KPIs, storages ao lado do histórico e tabela abaixo. A seleção de VM troca toda a visão: título e cards superiores passam a mostrar CPU/vCPUs, memória, armazenamento e containers daquela VM. Não há KPIs, storages, totalizadores, rede ou gráfico do ASGARD misturados ao detalhe da VM. O pai é apenas contexto de identidade e destino do link de retorno. A tabela compartilhada continua abaixo, destacando a VM selecionada.

No detalhe da VM, o painel de histórico contém o seletor host/VM e os períodos no cabeçalho. Métricas complementares de I/O, rede e uptime permanecem no mesmo painel, abaixo do gráfico; CPU, vCPUs e memória não se repetem nesse resumo. Dados atuais continuam disponíveis mesmo quando o histórico falha ou não tem série. Problemas são filtrados pela identidade exata da VM e pelo host Agent vinculado, sem incluir problemas gerais do pai ou de outra VM. Clicar no nome de uma VM leva ao topo do detalhe; trocar o seletor mantém o foco nele.

O card de armazenamento usa o filesystem raiz `/` do Agent quando presente, com usado/total separados; caso contrário, mostra somente a capacidade de disco virtual disponível no contrato e identifica a ausência de uso interno. Não reutiliza storages do pai nem estima capacidade por I/O. O disco virtual continua nas métricas complementares quando o card mostra o filesystem. CPUs reconhecidas pelo SO e todos os filesystems/interfaces ficam na perspectiva Agent expansível.

O card de containers usa `GET /api/monitoring/hosts/:linuxHostKey/containers`, somente para o Agent confirmado da VM selecionada. Conta os containers individualizados com estado running e evidência atual, não o agregado global nem o total instalado. A resposta é validada pelo host; erro, dados vencidos, ausência de descoberta, falta de Agent e vínculo sem host disponível são estados explícitos. Lista vazia não vira zero instalado. Só há uma consulta periódica para o card visível, sem requests por linha; mudar a VM cancela a leitura anterior. A fase 07 acrescenta a ação “Ver serviços” em cada linha detalhada, abrindo serviços/containers daquela VM pelo wrapper por pai/vmKey, sem mudar URL ou gráfico. A tabela compacta da raiz não recebe essa ação. O Agent também reutiliza a lista de containers do seu host; comportamento completo em [Interface](ui.md) e contrato em [BFF](bff.md).

Telas de detalhe têm scroll vertical normal; gráficos mantêm altura legível e tabelas usam rolagem horizontal interna. Mobile empilha painéis, preservando filtros, períodos, valores, legendas e ações.

Abaixo dos storages, **Estado das VMs** apresenta total no inventário e quantidades em execução, paradas, pausadas e sem estado atual. Usa as VMs operacionais da mesma leitura, sem outra request; evidência vencida ou falha de atualização entra em “Sem estado atual”. Em desktop, a coluna de armazenamento/resumo alinha sua base ao histórico vizinho, com distribuição flexível do espaço entre volumes e altura natural do gráfico. Mobile mantém altura natural e empilhamento. A mudança é restrita ao detalhe do ASGARD.

A raiz mantém destaques em faixa inteira acima, ASGARD e problemas compactos lado a lado. `host_inventory` está disponível no catálogo e tem renderer compacto que recebe `Host[]` pelo overview agregado, sem chamadas históricas. Nenhuma composição salva é alterada automaticamente. Editor e opções avançadas por bloco permanecem previstos para a administração.

Arquivos: `components/infrastructure/`, `lib/infrastructure/`, `components/dashboard/asgard-details.tsx` e tabela compartilhada `VmTable`. Contratos: [BFF](bff.md). Dashboard/player: [Interface](ui.md).

## Verificação

`npm test` cobre navegação codificada, seleção não ambígua, unidades/dispositivos, null/zero e prioridade de séries. `npm run test:integration` cobre o bloco disponível, identidade efetiva do hipervisor e exclusão de templates sem alterar capacidade bruta. `npm run test:ui` exercita seleção, cache/orçamento de requests, Agent sob demanda, respostas atrasadas, falhas/retry, parâmetros inválidos, desaparecimento, acesso direto/nova aba, gráficos, toque, teclado e zoom.

A matriz inclui 320×568, 360×800, 390×844, 768×1024, 1024×768, 1366×768, 1920×1080, 2560×1440, 3440×1440 e 844×390. Testes de navegador usam dados controlados e serviços temporários isolados; não substituem a conferência operacional do ambiente. Retenção e métricas disponíveis dependem do Zabbix, sem promessa de sete dias completos.
