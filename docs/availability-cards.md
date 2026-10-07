# Minicards de Disponibilidade de Serviços

A grade **Disponibilidade de Serviços** é um único grid. Hoje entram três origens, nesta ordem: recurso destacado do Zabbix, aplicação da sonda e VPS avulsa com destaque. Um serviço novo que também apareça aqui entra nessa mesma grade, com o mesmo retângulo. O miolo muda conforme a leitura que o serviço tem. A caixa não muda.

## A grade

Classe `availability-grid`.

- Colunas: `repeat(auto-fill, minmax(min(100%, 230px), 230px))`.
- Espaço entre cards: 8px.
- Alinhamento: à esquerda, sem esticar o card para preencher a linha.
- Altura máxima da grade: duas linhas visíveis, com rolagem interna. A conta atual é `var(--service-rows, 2) * 128px`.

O card novo não altera essas medidas. Não cria uma segunda grade ao lado.

## A caixa, comum aos três

Classe `availability-card`. Todo card da grade usa esta classe.

| Parte | Medida |
|---|---|
| Largura | até 230px |
| Altura | 120px fixos (`height`, `min-height` e `max-height`) |
| Padding do card de recurso | 10px 12px |
| Padding do card com faixa | 8px 12px, pela classe `probe-card` |
| Raio | 9px |
| Borda | 1px `var(--pulse-line)` |
| Fundo | `var(--pulse-service)`; hover `#1b2a32` |
| Direção | coluna, `overflow: hidden` |

De cima para baixo, todo card tem quatro faixas:

1. **Estado.** Classe `availability-state`, com `status-dot` de 6px. Texto de 10px, uma linha. A cor vem de `tone-good`, `tone-warn`, `tone-bad` ou `tone-unknown`.
2. **Nome.** Classe `availability-name`, 13px, peso 600, uma linha com reticências.
3. **Descrição.** Classe `availability-description`, 10px, cor muted, uma linha com reticências.
4. **Miolo preso embaixo.** `margin-top: auto`. É a única zona que muda entre os tipos. Termina no rodapé.

O card é um `button` quando abre detalhe. O nome acessível diz o nome, o estado e, quando há faixa, a disponibilidade. O foco usa o contorno verde de 2px por dentro do card.

## Os dois miolos que já existem

### Recurso do Zabbix

Componente `ServiceAvailabilityCard`. Só a classe `availability-card`.

O miolo são duas leituras, classe `availability-readings`, em duas colunas: CPU e RAM. Cada uma tem rótulo, valor tabular de 10px e uma barra de 3px. CPU usa o verde. RAM usa o azul. Sem as duas leituras habilitadas, a zona mostra o texto **Ver detalhes**.

O rodapé, classe `availability-footer`, fica abaixo das barras. À esquerda, o tipo (Host, Container ou o tipo cadastrado). À direita, o tempo ativo ou o horário da leitura. Uma métrica só.

O clique abre o detalhe do serviço, não um modal curto.

### Presença: aplicação e VPS

Componentes `ProbeAvailabilityCard` e `VpsAvailabilityCard`. Classes `availability-card probe-card`. A VPS acrescenta `vps-card-highlight`, sem mudar a caixa.

O miolo é a classe `probe-card-uptime`: a faixa e, debaixo dela, o rodapé. O espaço entre a faixa e o rodapé é 7px. O rodapé não ganha margem extra.

A faixa usa `ProbeStrip`, 40 retângulos, sempre. As consultas reais ocupam da esquerda para a direita. O restante fica cinza `#9daeb9` com opacidade 0.35. No card, a faixa tem 16px de altura. Não estique 1 ou 4 amostras para preencher os 230px: os 40 lugares existem mesmo vazios.

O rodapé continua sendo uma linha com borda superior. À esquerda, a identidade curta e um dado auxiliar. À direita, um único número.

| Card | Esquerda | Direita |
|---|---|---|
| Aplicação | tipo, ou **Aplicação**, e a latência | disponibilidade em 24h |
| VPS | **VPS ·** o IP | disponibilidade das posições visíveis da faixa |

A aplicação usa as cores da sonda. A VPS passa `colorFor`, porque os motivos numéricos dela não são os da sonda. Um serviço novo que reutilize a faixa informa o próprio mapa de cor. Não reuse o mapa da sonda se o número não significar a mesma coisa.

O clique da aplicação abre o modal de histórico. O clique da VPS abre o modal curto: estado, IP, três medidores (CPU geral, RAM e disco) e o link para o detalhe. Os núcleos ficam no detalhe, não no card nem nesse modal.

## Cores de estado

| Tom | Uso no card | Token |
|---|---|---|
| `good` | disponível, no ar | `--pulse-green` (`#64d6b0`) |
| `warn` | atenção, lento | `--pulse-amber` (`#f2c275`) |
| `bad` | fora, indisponível | `--pulse-red` (`#ff8585`) |
| `unknown` | sem dados, pausado, inativo, monitor ausente | `--pulse-muted` (`#9daeb9`) |

A barra de RAM usa `--pulse-blue` (`#80bdf2`). A faixa não troca para vermelho só porque o percentual subiu. O estado do texto é que carrega o tom.

## Especificação para o próximo card

O serviço que for exibido nesta grade implementa um componente no mesmo grid, nesta ordem de blocos. Não inventa largura, altura, raio ou uma terceira fileira de rodapé.

1. Use `availability-card`. Se a leitura principal for uma faixa de consultas, use também `probe-card`. Se for CPU e RAM no estilo do Zabbix, use só `availability-card` e `availability-readings`.
2. Mantenha 230×120. Texto que não cabe leva reticências. Não aumente o card para caber uma linha a mais.
3. Estado, nome e descrição permanecem nas três primeiras linhas, com as classes atuais.
4. O miolo fica em `margin-top: auto`, para o rodapé encostar na base com o mesmo respiro dos cards atuais.
5. O rodapé é a última linha, com `availability-footer`: borda superior, espaço entre as pontas, texto muted à esquerda, um número tabular à direita. Sem leitura, o número é **—**.
6. Faixa, quando existir, tem 40 posições e 16px no card. Posição vazia é cinza a 0,35 de opacidade. Pausado e inativo desenham a faixa vazia, sem pintar de vermelho.
7. O clique abre detalhe ou modal. O card em si não vira a tela de detalhe. Métrica que não cabe nas quatro linhas vai para o modal ou para a rota de detalhe.
8. O nome acessível inclui o nome do item e o estado. Se houver número de disponibilidade no rodapé, inclui esse número.
9. O card entra no `availability-grid` do bloco `highlighted_resources`, depois dos tipos já renderizados, ou na posição que o produto definir sem criar outro grid.
10. A nota de rodapé do painel pode ganhar uma frase curta do novo tipo. O título do painel continua **Disponibilidade de Serviços**.

Fora deste contrato: não colocar o card em `uptime_list` só para reaproveitar a lista, não desenhar o card como linha de tabela e não usar o tamanho dos painéis de ASGARD ou de infraestrutura.
