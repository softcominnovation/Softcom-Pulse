# Encaixe da rota principal

## Composições com Storage

`storage_summary` usa `storageLayout` e `StorageComposition`, compartilhados pela raiz e pela prévia. O caminho anterior permanece sem Storage habilitado. Indicadores têm faixa própria; demais blocos entram em fileiras de 12 colunas, por UUID, ordem e larguras. Repetições não disputam áreas CSS por tipo.

Em split, uma única Disponibilidade e um único Problemas conservam o par superior 1,25:1. Os demais painéis entram na grade. Sem dupla única, todos entram por UUID. Overview padrão e wall usam o mesmo empacotamento e as larguras efetivas existentes.

Em >=1201×740, as fileiras de painéis dividem a altura restante. Uma fileira composta somente por Disponibilidade de Serviços acompanha a altura real de seus cards, até o limite de linhas configurado; não recebe uma parcela igual da altura nem reserva linhas vazias. ASGARD, Storage e os demais painéis flexíveis aproveitam o espaço liberado. Uma Disponibilidade que divide a fileira com Problemas ou outro painel conserva o alinhamento pela altura compartilhada.

O cálculo de encaixe mede as fileiras de Disponibilidade, os indicadores e os espaçamentos reais, e reage quando os cards ganham ou perdem uma linha. Se o mínimo de leitura dos demais painéis não couber, só a composição rola; todos os painéis continuam alcançáveis e a legenda da raiz fica visível. A prévia usa o mesmo cálculo e anuncia esse fallback. Abaixo do recorte, a página rola normalmente. Nenhuma composição salva, escala ou fonte é alterada para produzir encaixe. O painel Storage conserva cabeçalho/rodapé e rola corpo/volumes. Consulte [Storage](storage.md). As seções seguintes descrevem também o caminho legado, preservado sem Storage.

Os componentes novos seguem o [Design system Kobra](design-system.md) e os [Sons da interface](interface-sounds.md). Este documento governa distribuição e rolagem; a paleta e as primitivas atuais vêm do guia de design.

A rota `/` é a tela de monitoramento. Em resolução grande ela cabe na área visível: cabeçalho, navegação, blocos e legenda aparecem juntos, sem rolagem da página. O que passar da altura do painel rola dentro dele. Em tela estreita ou baixa, a página pode rolar. Detalhe, infraestrutura, ASGARD, serviços e administração não herdam esta trava.

## Quando a regra vale

A classe `balanced` entra no dashboard quando o layout ativo é `overview`. O encaixe liga neste recorte:

- largura mínima de 1201px
- altura mínima de 740px

Abaixo de qualquer um desses limites, o shell não trava a altura. Celular, tablet estreito e janela baixa usam a rolagem normal da página. Até 1200px a grade também deixa de ter 12 colunas e passa a duas.

Entre 740px e 900px de altura, o mesmo encaixe continua, com cabeçalho, navegação, indicadores e paddings mais baixos. O conteúdo principal permanece na área visível.

Modo TV e tela cheia usam o mesmo shell. A escala de leitura (`--dashboard-scale`, 100, 110, 120 ou 125) aumenta fonte e espaçamento. Ela não é `zoom` nem `transform`. O componente novo usa `calc(... * var(--dashboard-scale, 1))` nas medidas que acompanham o telão.

## Como o encaixe funciona

A partir de 1201×740, `.dashboard-shell:has(.balanced)` fica com `height: 100dvh` e `overflow: hidden`. A barra superior não encolhe. O miolo (`.dashboard-main`) ocupa o resto, com `min-height: 0`, para o grid poder ceder altura.

`.dashboard.balanced` é uma coluna. Tudo que não é `.dashboard-blocks` — navegação, título, avisos, legenda — tem `flex-shrink: 0`. A grade `.dashboard-blocks` recebe `flex: 1` e `min-height: 0`. Cada `.dashboard-panel` dentro dela tem `height: 100%`, `min-height: 0` e `overflow: hidden`.

A lista que pode crescer não estica o painel. Ela fica numa área com `flex: 1 1 0`, `min-height: 0` e `overflow: auto`. Já estão nesse grupo: problemas, VMs do ASGARD, hosts, containers, uptime e a grade de recursos. A grade de Disponibilidade de Serviços tem altura máxima própria e rola por dentro; o card mantém altura de 120px e largura usual até 230px, com colunas elásticas no split, como em [minicards](availability-cards.md).

Nada é apagado para caber. O que não cabe na altura do painel continua acessível na rolagem interna.

No ASGARD compacto, a partir de 480px de largura do contêiner, o cabeçalho reserva espaço para a disponibilidade e o link, enquanto o nome pode truncar na mesma linha. Evitar que fontes mais largas ou a escala de 125% quebrem a disponibilidade em uma segunda linha e consumam a área útil da tabela de VMs. Abaixo desse recorte o cabeçalho continua podendo reorganizar o conteúdo. Validar o encaixe com nomes longos e diferentes métricas de fonte, preservando a tabela rolável e a legenda visível.

## O que um componente novo obedece

Um bloco, card ou painel feito para a visão geral da rota `/` segue esta lista. Vale para TV e tela cheia na mesma faixa de 1201×740 ou maior.

1. Entrar em `.dashboard-blocks`, dentro de `.dashboard-panel`. Não criar um segundo scroll na página.
2. O painel aceita `min-height: 0` e não impõe uma altura fixa maior que a faixa que a grade lhe der.
3. Cabeçalho e rodapé do painel ficam de fora da área que rola. Só o miolo longo rola.
4. A área rolável usa `min-height: 0` e `overflow: auto`. Sem `min-height: 0`, o flex não encolhe e o painel empurra a página para fora dos `100dvh`.
5. Uma linha a mais de dado não aumenta a altura do bloco. Aumenta a rolagem interna, como a tabela de VMs do ASGARD.
6. Medidas de fonte, ícone, gap e padding do telão passam por `--dashboard-scale`.
7. Em largura menor que 1201px, o bloco empilha e a página pode rolar. Não se esconde ação nem dado só porque a trava de altura não está ligada.
8. Rotas que não são a visão geral da raiz continuam com rolagem de página. Não copiar `100dvh` e `overflow: hidden` para o detalhe, a administração ou a infraestrutura.

A prévia em configurações avisa quando a composição precisa de rolagem na altura da janela. Esse aviso é o sinal de que o bloco passou do espaço da visão geral.
