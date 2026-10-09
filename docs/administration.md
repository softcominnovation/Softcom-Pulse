# Administração da visualização

As rotas `/admin/recursos` e `/admin/configuracoes` usam a sessão corporativa existente. Em Recursos, o bloco **Escopo Zabbix** (associar Agents) aparece só para editor (`PULSE_EDITOR_EMAILS`). Configurações exige editor para escrita. Os links ficam na navegação normal e são ocultos no modo TV. Não há cadastro de usuários, permissão nova nem ação operacional no Zabbix/Proxmox.

## Escopo Zabbix

Em `/admin/recursos`, abaixo das configurações salvas, o editor vê o escopo atual (`hostKeys` / `vmLinks`) e os Agents prontos no Zabbix ainda fora do escopo. Associar grava no PostgreSQL; o próximo ciclo do Collector inclui o host. Desassociar remove o vínculo com a VM; remover do escopo tira o host da coleta. Não há rota dedicada. Detalhes da API e da descoberta: [Zabbix](zabbix.md).

## Recursos destacados

Escolha um host ou container no inventário agregado. Para tasks Swarm no formato `serviço.número.identificador`, o formulário sugere um prefixo lógico; confira os candidatos antes de salvar. Mais de um candidato nunca vira associação arbitrária. Nome, destaque, criticidade, ordem, habilitação e flags do card são decisões do Pulse, não telemetria.

O formulário utiliza React Hook Form e os schemas Zod do contrato. A prévia usa o mesmo card do dashboard com as preferências locais, sem consultar histórico ou salvar. Healthcheck e histórico pertencem somente a containers; timeline exige health visível e janela 1h/24h/7d. O detalhe consulta o histórico sob demanda após o cadastro.

`GET /api/settings/resources` lê as configurações diretamente do PostgreSQL, independentemente do Redis. Assim, um recurso que desapareceu continua editável/removível. Criação ou mudança de identidade/seletor exige descoberta atual; editar somente preferências preserva o UUID e funciona sem coleta. POST/PATCH/DELETE continuam em `/api/monitoring/services`.

Remover exige confirmação e elimina somente a configuração Pulse. Os blocos individuais vinculados são retirados na mesma transação; uma tela esvaziada recebe indicadores. Desabilitar ou retirar o destaque preserva os vínculos, marcados indisponíveis até revisão.

## Telas do dashboard

O editor envia o documento completo em schemaVersion 2 para `/api/settings/presentation`, com a revisão carregada. Pode haver uma a três telas, pelo menos uma habilitada, até seis blocos habilitados por tela e até 24 contando desabilitados. Ordem, formato, largura, opções e associação são compartilhados. Reordenar/mover preserva UUID; duplicar gera outro UUID.

Os controles por botões funcionam com teclado e toque. Intervalo: 5–300 segundos; alternância automática requer pelo menos duas telas aptas. Modo TV inicial não aciona fullscreen automaticamente. Tela atual, pausa e cronômetro do player são locais e não são editados aqui.

O catálogo central valida opções específicas por tipo: indicadores, ordenação/direção, filtros de estados/severidades/criticidade/hosts e linhas ou fileiras visíveis. Campos de outro bloco são rejeitados. CPU/RAM ordenam percentuais numéricos; zero e valores acima de 100 são preservados. Valores ausentes, sem percentual, stale e expirados ficam por último em ambas as direções. Filtros mostram contagens parciais; não alteram os KPIs globais.

Linhas visíveis controlam a altura da janela, sem remover dados. Todas as entradas permanecem acessíveis por rolagem interna. A composição inicial preserva destaques em faixa inteira e ASGARD/problemas lado a lado. Alterar opções pode exigir rolagem da página; o editor não diminui artificialmente a escala.

A prévia usa os renderers reais e leituras agregadas existentes de overview, hosts, containers e serviços. É identificada como não salva, acompanha a largura atual do navegador e avisa quando sua altura excede o espaço disponível. Não há simulação de cenários, requests por linha nem polling de históricos. Fechar/navegar cancela as leituras. Dados indisponíveis mantêm estado honesto.

Falhas preservam o rascunho; 409 informa edição concorrente. “Recarregar para revisar” pede confirmação antes de descartar o rascunho. Cancelar alterações restaura a versão carregada sem gravar. Remover tela/bloco e restaurar composição inicial também pedem confirmação; só Salvar altera a apresentação compartilhada. Sucesso é anunciado depois da resposta do servidor.

## Tamanho dos elementos no telão

Em `/admin/configuracoes`, a seção **Leitura no telão** oferece **100%, 110%, 120% e 125%**, com **110% como padrão**. A opção é compartilhada pelas telas salvas e pelos dispositivos. “Restaurar tamanho padrão” volta o rascunho para 110%; **Salvar leitura do telão** grava tamanho e inatividade no PostgreSQL com proteção de revisão. Não utiliza localStorage.

O botão do bloco preserva as configurações já confirmadas de telas/reprodução e não grava nem descarta rascunhos de outras seções, mesmo quando estiverem inválidos. A revisão devolvida vira a base do próximo salvamento; “Cancelar alterações” restaura também as opções do telão que acabaram de ser confirmadas. Falha/conflito aparece no bloco e mantém o rascunho. O botão “Salvar apresentação” do rodapé continua salvando o formulário inteiro. Não há novo endpoint ou persistência paralela.

A escala atua exclusivamente no dashboard `/`, quando o modo TV **ou** a tela cheia do aplicativo está ativo. TV com fullscreen aplica o percentual uma única vez. Ao sair dos dois, a visualização normal volta a 100%. Administração, detalhes de hosts/VMs, serviços e modais conservam seus tamanhos. O zoom do navegador não é alterado.

“Ver prévia” permite comparar Normal · 100% e Telão · percentual escolhido antes de salvar, sem alterar a configuração compartilhada. A ampliação ajusta fontes, controles, espaçamentos, medidores e janelas de listas, mantendo a grade de blocos. Se a altura não for suficiente, a página pode rolar; listas e tabelas preservam acesso interno a todos os dados. A prévia mostra o conteúdo na largura atual, sem simular outra resolução.

O campo `displayScalePercent` integra `pulse_settings.dashboardPresentation`. Documentos antigos sem o campo recebem 110% na leitura, sem regravar o registro, mudar a revisão ou substituir telas/blocos. O próximo salvamento inclui o campo. Não exige migration, env ou reinício do Collector. Dashboards abertos recebem a revisão pela atualização normal das configurações; durante uma leitura/alternância, respeitam a aplicação de revisão do player.

## Entrada automática por inatividade

Em **Leitura no telão**, marque **Entrar no modo TV após inatividade**, escolha **Tempo sem interação (minutos)** e clique em **Salvar leitura do telão**. Aceita inteiros de 1 a 120; o valor sugerido é 5. A rotina começa desabilitada. **Tentar tela cheia ao entrar automaticamente** vem marcado, mas só é usado quando a rotina está habilitada. O tempo e as opções são compartilhados entre dispositivos; o cronômetro é local.

Mouse, toque, teclado, foco e rolagem reiniciam o prazo. Aba oculta e diálogo aberto suspendem a rotina; voltar/fechar inicia um período completo. Funciona apenas no dashboard principal após carregar a configuração. Administração, detalhes, login e prévias não têm essa ativação. Atualizações de métricas, relógio e slides não reiniciam o prazo. A atividade não sai automaticamente do modo TV; sair por um controle ou do fullscreen pelo navegador rearma o período inteiro.

No prazo, entra em TV e faz uma tentativa de fullscreen quando solicitado. Navegadores podem exigir gesto recente e bloquear a tentativa: nesse caso, um aviso oferece **Entrar em tela cheia** para um clique explícito. O aviso pode ser fechado; não é repetido a cada coleta. A rotina não força fullscreen no próximo clique arbitrário e não declara sucesso quando ele foi recusado. Consulte a exigência de ativação em [requestFullscreen (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen#security).

`idlePresentation` integra o documento de apresentação com a revisão existente. Legado recebe defaults somente em memória; salvar os inclui. Mudanças passam pela aplicação normal da revisão do player. Não exige migration, env, alteração de coleta ou reinício do Collector.

### Ajuda para autorizar no Chrome

**Como autorizar tela cheia automática**, no bloco Leitura no telão, abre um diálogo com a origem atual do Pulse e um comando PowerShell copiável para configurar o Chrome no Windows. Por solicitação do dev, o mesmo comando inclui sempre os três endereços: `http://localhost:3000`, `https://dev-pulse.softcomtecnologia.com` e `https://pulse.softcomtecnologia.com`. A origem exibida e a consulta de autorização continuam correspondendo à janela aberta; outros endereços/portas não são acrescentados automaticamente ao comando.

`chrome://settings/content/automaticFullScreen` apenas lista as entradas para sites como o Pulse; não oferece botão Adicionar/Permitir. Por isso deixou de ser indicado como etapa de autorização. A liberação é feita por `AutomaticFullscreenAllowedForUrls`. O comando mostrado no modal cria uma entrada REG_SZ para cada um dos três endereços ainda ausentes, sempre na primeira posição livre em `HKCU\Software\Policies\Google\Chrome\AutomaticFullscreenAllowedForUrls`. Preserva todos os outros valores, não repete uma origem já cadastrada e continua processando as demais quando encontra uma existente. Aceita somente origem HTTP(S) sem credenciais, caminho, query, fragmento ou wildcard. O texto é gerado localmente; copiar não o executa.

No Windows, abrir PowerShell como administrador com o mesmo usuário que usa o Chrome e executar o texto revisado. Se a elevação usar outra conta, solicitar aplicação ao responsável para o usuário do telão. O Chrome pode passar a indicar gerenciamento pela organização. Em seguida, abrir `chrome://policy`, usar **Recarregar políticas**, conferir a origem/estado da política e voltar ao Pulse para **Verificar autorização**. Uma política de bloqueio ou de maior prioridade pode prevalecer; não remover essas proteções como parte do procedimento. Se a política não carregar, cabe ao responsável aplicá-la pelo gerenciamento da organização. Outros sistemas usam os mecanismos administrativos do Chrome. Referências: [política oficial](https://chromeenterprise.google/policies/#AutomaticFullscreenAllowedForUrls), [Registro do Windows](https://support.google.com/chrome/a/answer/9131254?hl=pt-BR) e [explicação da equipe Chrome](https://github.com/explainers-by-googlers/html-fullscreen-without-a-gesture).

O diálogo consulta `navigator.permissions.query({ name: 'fullscreen', allowWithoutGesture: true })` quando disponível, escuta mudanças e verifica novamente ao voltar à janela ou usar **Verificar autorização**. Diferencia autorização concedida, ausente, consulta sem suporte e Fullscreen API indisponível no contexto. A consulta não solicita nem concede acesso e não tenta fullscreen na administração. A cópia tem retorno de sucesso/falha e seleção manual como alternativa. O modal mantém foco, rolagem e controles móveis do Pulse.

A autorização pertence ao navegador/perfil/computador, não ao PostgreSQL. Abrir a ajuda e copiar o comando não alteram Registro, política, extensão, env ou configuração salva; a escrita ocorre somente quando o responsável executa o comando no Windows. Depois de liberar, verificar no diálogo, salvar as opções de inatividade/tela cheia e voltar à raiz para aguardar o prazo. Comando concluído não prova que o Chrome carregou a política; sucesso da consulta também não substitui a confirmação nativa de cada entrada. O tratamento existente de recusa continua ativo. Para reverter, o responsável remove apenas o valor correspondente à origem na lista, preservando a chave e os outros valores, e recarrega as políticas.

## Templates

A seção Templates do ASGARD é independente da apresentação. Descoberta vem de `/api/monitoring/templates`, filtrada pelo hipervisor efetivo quando disponível; preferências vêm de `/api/settings/templates`, inclusive sem Redis. Workers/Managers usam configuração humana ou convenção explícita do nome técnico. Não são somados às VMs operacionais.

O editor altera apenas nome amigável e papel. Campos vazios/automáticos são enviados como null; expectedRevision é 0 na primeira preferência e a revisão salva nas seguintes. Reset confirma e envia nulls; não apaga templates. Preferências sem descoberta atual ficam em seção própria, vinculadas exclusivamente à identidade original. A descoberta nunca salva defaults automaticamente.

Capacidades e evidências são somente leitura. vCPUs vêm do item dependente Proxmox; não do SO. Disco/SO/versão sem fonte ficam ausentes. Mais detalhes em [Templates](templates.md).

## Compatibilidade e operação

Na tela de configurações, campos em uma linha compartilham as linhas de label, controle e ajuda. Checkboxes avulsos alinham com os controles, botões têm altura consistente e grupos de opções usam colunas regulares. Restauração fica junto ao seletor do telão; salvamento, no rodapé do painel. Reprodução, telas, opções de blocos e editor de templates usam a mesma organização. Em larguras menores, os controles passam a uma coluna, com alvos de toque de 44px e sem ocultar campos. A mudança visual é restrita à tela de configurações.

Aplicar `20261003180000_presentation_options` com `prisma migrate deploy`. A migration converte v1 compatível, acrescenta defaults e incrementa revision uma vez sob a mesma trava do editor. Preserva IDs, ordem, flags, vínculos, reprodução e larguras. Reexecução não modifica v2. V1 com mais de seis blocos ativos permanece intacta e reproduzível; o editor mantém todos os blocos até a pessoa adequar o rascunho. GET/PUT v1 continuam aceitos; leituras aplicam defaults em memória sem gravação.

Os editores não requerem env nova nem alteração do Collector. A correção complementar da validade de evidências, descrita em [Zabbix](zabbix.md#validade-identidade-e-consistência), exige reiniciar o Collector para aplicar os novos prazos. Telemetria não entra nas tabelas de configuração. Testes de persistência usam PostgreSQL temporário/Redis reservado; testes de navegador usam portas 3100/3102 e respostas controladas. A matriz visual inclui 320/390px, tablet, 1366/1920/2560/3440px, zoom de 200%, foco, erros, rascunhos, conflitos e confirmações. Homologação física adicional pertence à entrega final.
