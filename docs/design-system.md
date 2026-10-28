# Design system do Softcom Pulse

Para avisos operacionais e histórico compartilhado, seguir [Notificações de serviços](notifications.md): sininho e Sheet Kobra, toast temporário sobre a página e áudio centralizado. Não acrescentar uma faixa fixa nem alterar o tamanho dos cards para acomodar notificações.

Padrão para construir e ampliar a interface a partir do Kobra já integrado ao aplicativo. Referência conferida em 27/10/2026, na branch `develop`, commit `b428b22`; a adoção visual está no commit `b4b69bb`. Este documento descreve o código atual e estabelece como reutilizá-lo. A paleta escura azulada, o botão verde e a marca laranja descritos em documentos anteriores deixaram de ser o padrão de novas telas.

Leia este guia e [Sons da interface](interface-sounds.md) antes de implementar UI. Para a raiz, leia também [Encaixe do dashboard](overview-fit.md) e [Minicards](availability-cards.md). Os arquivos locais do app são a referência executável; o comentário de `app/theme.css` registra a origem externa Kobra. Não é necessário buscar ou reinstalar componentes de uma galeria para usar o sistema já incorporado.

## 1. Organização e fontes da verdade

| Arquivo ou área | Responsabilidade |
|---|---|
| `app/theme.css` | Tokens semânticos claro/escuro, fontes, pesos, raios e aliases Tailwind |
| `app/kobra.css` | Superfícies com relevo, sombras, badges, foco, movimento, command menu e efeitos compartilhados |
| `app/globals.css` | Importa Tailwind → animações → theme → Kobra; mapeia `--pulse-*` e aplica estilos globais/shell |
| `components/ui/*` | Primitivas locais, variantes, semântica e composição; importar por `@/components/ui/...` |
| `app/providers.tsx` | Tema, direção LTR, áudio, tooltips, inventário WhatsApp e os dois sistemas de toast |
| `store/ui.store.ts` | Tema, TV, fullscreen, escala de apresentação e abertura do diálogo de som |
| `components/layout/app-shell.tsx` | Cabeçalho, marca, relógio, autenticação ou leitura pública, navegação e escopo do telão |
| `components/layout/kobra-controls.tsx` | Busca global, alternância de tema, mute, volume e teste de áudio |
| CSS de cada domínio | Densidade e comportamento específico de dashboard, administração, infraestrutura, serviços, login e WhatsApp |

A aplicação usa Next.js App Router/React, Tailwind 4 e componentes locais adaptados do Kobra. A maior parte das novas primitivas usa Base UI; `Dialog` conserva Radix com adaptadores locais. CVA define variantes e `cn` combina classes com `clsx`/`tailwind-merge`. O `components.json` ainda contém metadados de shadcn (`new-york`, `slate`, `lucide`); isso não descreve sozinho o visual atual. Não regenerar a biblioteca local a partir desse arquivo ao criar uma tela.

Os imports de CSS de domínio também participam da cascata. Antes de mudar uma medida, conferir o componente, seus seletores de domínio e os recortes TV/mobile. Um token de raio global não substitui todos os raios específicos.

## 2. Tema e paleta

O tema padrão é **escuro**: `RootLayout` entrega `html.dark` e a store começa com `theme: "dark"`. No cliente, `Providers` lê primeiro `?theme=light|dark`, depois `localStorage["softcom-pulse-theme"]`; sem valor válido mantém o padrão. Atualiza a classe `.dark`, `data-theme` e persiste a escolha. Não há seleção automática por `prefers-color-scheme`, nem listener de tema entre abas neste provider. A troca suprime temporariamente animações/transições para evitar interpolação da página inteira.

Para mudar o tema, usar `useUiStore(state => state.toggleTheme)` ou `setTheme`. Não criar outro provider, outra chave de storage ou manipular `.dark` por componente. A preferência é local à origem/browser; não integra `dashboardPresentation` no PostgreSQL.

### Tokens principais

Usar classes semânticas como `bg-card text-card-foreground border-border`, ou os aliases Pulse em CSS de domínio. Os valores abaixo são os tokens declarados; cores derivadas por `color-mix`, transparência e superfícies podem ter aparência diferente do valor base.

| Papel / token | Claro | Escuro |
|---|---|---|
| Fundo geral `--shell-canvas` / `--pulse-bg` | `#fafafa` | `#191919` |
| Shell `--shell` | `#f0f0f0` | `#171717` |
| Painel do shell `--shell-panel` | `#ffffff` | `#1c1c1c` |
| Campo do shell `--shell-field` | `#ffffff` | `#1b1b1b` |
| Linha do shell `--shell-line` | `#e6e6e6` | `#2b2b2b` |
| Linha forte `--shell-line-strong` | `#dcdcdc` | `#303030` |
| Texto do shell `--shell-fg` | `#171717` | `#ededed` |
| Texto secundário do shell `--shell-fg-muted` | `#333333` | `#d4d4d4` |
| Texto sutil do shell `--shell-fg-subtle` | `#5c5c5c` | `#a3a3a3` |
| Texto fraco do shell `--shell-fg-faint` | `#6d6d6d` | `#8e8e8e` |
| Fundo de controle `--background` | `oklch(1 0 0)` | `oklch(0.145 0 0)` |
| Texto `--foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` |
| Card / popover | `oklch(1 0 0)` | `oklch(0.205 0 0)` |
| Primário `--primary` | `oklch(0.205 0 0)` | `oklch(0.922 0 0)` |
| Secundário / muted / accent | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` |
| Texto muted `--muted-foreground` | `oklch(0.556 0 0)` | `oklch(0.708 0 0)` |
| Borda `--border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%)` |
| Input `--input` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 15%)` |
| Foco `--ring` | `oklch(0.62 0 0)` | `oklch(0.556 0 0)` |
| Sucesso `--success` | `oklch(0.5 0.13 152)` | `oklch(0.704 0.15 152)` |
| Atenção `--warning` | `oklch(0.5 0.14 70)` | `oklch(0.704 0.15 75)` |
| Erro `--error` | `oklch(0.5 0.21 27.3)` | `oklch(0.704 0.191 22.216)` |
| Informação `--info` | `oklch(0.5 0.17 255)` | `oklch(0.704 0.15 255)` |

`--card-foreground`, `--popover-foreground`, `--primary-foreground` e `--secondary-foreground` são os pares de contraste das respectivas superfícies. Usar o par fornecido; por exemplo, o botão primário é escuro no tema claro e claro no tema escuro. Não fixar texto branco para ambos.

### Compatibilidade com os componentes Pulse

| Alias | Origem |
|---|---|
| `--pulse-surface` | `--card` |
| `--pulse-raised`, `--pulse-elevated` | `--muted` |
| `--pulse-line` | `--border` |
| `--pulse-text` | `--foreground` |
| `--pulse-muted` | `--muted-foreground` |
| `--pulse-faint` | `--shell-fg-faint` |
| `--pulse-green`, `--pulse-amber`, `--pulse-red`, `--pulse-blue` | `--success`, `--warning`, `--error`, `--info` |
| `--pulse-hover` | `--accent` |
| `--pulse-selected`, `--pulse-active` | `--secondary` (seleção escura também tem valor específico no CSS) |
| `--pulse-selected-border`, `--pulse-hover-border` | `--shell-line-strong` |
| `--pulse-dialog`, `--pulse-dialog-border` | `--popover`, `--border` |

`--pulse-service`, banners e tracks usam misturas/transparências já definidas em `globals.css`. Reutilizar esses aliases para ampliar vistas existentes. Novas primitivas genéricas usam os tokens semânticos Kobra. Evitar hexadecimais avulsos para fundos, texto, seleção e foco.

### Cores de telemetria que permanecem no código

A migração não eliminou todas as cores anteriores. `ProbeStrip`, `lib/probe/status.ts`, `lib/vps/labels.ts`, `lib/signal/labels.ts`, `lib/infrastructure/history.ts` e o gráfico de latência ainda fornecem cores próprias: verde `#64d6b0`, âmbar `#f2c275`, vermelho `#ff8585`, azul `#80bdf2`, ausência `#9daeb9`. Portanto, uma faixa SVG ou série canvas pode usar essa paleta enquanto o texto de estado usa um alias adaptado ao tema.

Ao estender uma família existente, reutilizar seu componente/helper de cores. Um `reason` de VPS, sonda e Signal não tem necessariamente o mesmo significado. A troca visual não autoriza alterar classificação, disponibilidade, freshness ou limites de alerta. Não apresentar cores fixas remanescentes como paleta global nem recolorir silenciosamente todas as séries.

`HistoryChart` observa a store de tema e recria o uPlot com eixos/grade adequados. `LatencyChart`, em `components/dashboard/probe-details.tsx`, lê `document.documentElement.dataset.theme` quando monta/recria o gráfico, sem assinatura direta da store. Essa diferença existe hoje; ao criar outro canvas, prever atualização das cores com o tema, além de resize e descarte da instância.

## 3. Tipografia, densidade e marca

Fontes de sistema: `--font-sans` / `--font-ui` para texto e `--font-mono` / `--font-numeric` para números, IDs e horários. `font-mono` e `pulse-mono` aplicam números tabulares nos estilos globais. Body de 14px, line-height 1.45. Em Tailwind, `font-medium` está configurado como **400**, `font-semibold` e `font-bold` como **700**. CSS específico ainda usa pesos 500/550/600/650; não assumir que todos os nomes de utilitários correspondem ao peso nativo usual.

`--radius` é `0.625rem` (10px na base usual de 16px); `rounded-lg` deriva desse token, `rounded-xl` soma 4px e `rounded-3xl` soma 12px. O app também declara `--radius-panel: 14px`, `--radius-control: 8px`, `--radius-dialog: 24px`, `--radius-badge: 9999px`. Regras concretas de domínio mantêm cards de disponibilidade em 9px e campos administrativos em 10px. O diálogo recebe 24px pelo override global de `data-slot="dialog-content"`.

`Brand` é a marca atual: `IconActivityHeartbeat` de Tabler em uma caixa com fundo `--foreground` e traço `--background`, mais o nome em cor neutra. Tamanho normal 32px; `AppShell` passa 42px em apresentação, com override de 45px até 1200px de largura e de 43px no dashboard balanceado acima de 1200px com altura entre 740 e 900px. O favicon principal é um SVG embutido em `app/layout.tsx`; o apple icon ainda aponta para `/logo.png`. Reutilizar `Brand` e suas props; não reconstruir a marca nem restaurar a palavra laranja ou o logo antigo a partir de instruções históricas.

Tabler é usado nas novas primitivas, shell e WhatsApp; Lucide continua nos domínios anteriores. Para novos controles Kobra, acompanhar Tabler e os tamanhos do componente. Não substituir ícones existentes em massa como efeito colateral de uma funcionalidade.

## 4. Componentes e composição

| Necessidade | Componente e contrato local |
|---|---|
| Ação | `Button`: variantes `default`, `primary`, `outline`, `secondary`, `ghost`, `destructive`, `link`, `push`; props `flat`, `rounded`, `asChild` |
| Tamanhos de botão | `xs` 24px, `sm` 28px, `default` 32px, `lg` 36px; versões `icon-xs`, `icon-sm`, `icon`, `icon-lg` equivalentes. CSS de domínio/toque pode ampliar |
| Campo | `Input` + `Label`; erros com `aria-invalid`, `aria-describedby` e texto visível. RHF/Zod continuam nos formulários administrativos |
| Seleção | `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`; componentes Base UI via `render` quando suportado |
| Abas internas | `Tabs`, `TabsList` (`default` ou `line`), `TabsTrigger`, `TabsContent` |
| Superfície genérica | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`; size `default` ou `sm` |
| Estado compacto | `Badge`: `positive`/`green`, `warning`/`amber`, `negative`/`destructive`, `neutral`, `blue`, além das variantes neutras e `tint`; tamanhos `default`, `sm`, `xs` |
| Informação/espera | `Alert`, `Skeleton`, `Spinner`, `StatusBadge`, `Progress` |
| Diálogo | `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogBody`, `DialogFooter`, `DialogClose` |
| Ação destrutiva | `ConfirmationDialog` existente: cancelar, aguardar confirmação, bloquear envio repetido e preservar erro |
| Dica | `Tooltip`, `TooltipTrigger`, `TooltipContent`; provider global com delay 180ms |
| Volume/valor contínuo | `Slider`, size `default` ou `sm`, `animated={false}` para o ajuste de áudio atual |
| Dados/navegação auxiliar | `Table` e suas partes, `Breadcrumb`, `Separator`, `Sheet` |
| Busca global | `CommandMenu` / `openCommandMenu`, catálogo no `KobraControls` |

`Sidebar` existe na biblioteca, mas não é a navegação atual do Pulse. As telas usam `MonitoringNav`, com links horizontais e `aria-current`. Não adicionar sidebar a uma funcionalidade sem uma mudança de layout solicitada.

### Superfícies e botões

Os botões de superfície usam `t-surface` e `::before`, com gradiente discreto, contorno, iluminação e sombra diferentes por tema/variante. `Button` usa `ResizeObserver` para reduzir a intensidade do relevo em controles largos por `--surface-calm`. O modo `flat` remove esse tratamento; `push` tem deslocamento próprio. Preferir a variante adequada, sem sobrepor `background`, sombras e pseudo-elementos por tela.

`data-slot`, `data-variant`, atributos ARIA e estados das primitivas são contratos usados por CSS, som e seletores. Preservá-los ao compor wrappers. `Button asChild` é apropriado para links Next. `TooltipTrigger render={<Button ... />}` evita botão dentro de botão. O `Dialog` local aceita `render` em trigger/close por adaptação de Radix; outras APIs não devem ser presumidas iguais entre Base UI e Radix.

### Diálogos e formulários

Usar `DialogBody` para conteúdo longo: ele fornece a área rolável e preserva cabeçalho/rodapé. A largura base é 540px, limitada à viewport menos 2rem; size admite `default|sm|md|lg|xl`, e diálogos de dados possuem extensões específicas. Altura máxima também respeita a viewport. Usar título, descrição e nome acessível no fechamento, com foco contido e retorno ao acionador.

Na administração, reutilizar `Field`, `Check`, `admin-form`, `admin-fields` e `admin-actions` de `components/admin/shared.tsx`/`admin.css`. A grade de campos usa mínimo de 220px, altura de 40px e raio de 10px; reorganiza em coluna. Os campos nativos já usados por esses editores são parte do padrão existente e não precisam ser trocados apenas para adicionar uma preferência.

Ações confirmam sucesso após resposta real; falha/revisão conflitante conserva rascunho. Uma aparência de sucesso ou som de clique não confirma persistência. Exclusão e reset usam confirmação com verbo explícito.

### Exemplo de reutilização

Trecho para um componente cliente dentro dos providers existentes; `save` representa a operação real da funcionalidade e o chamador deve bloquear envio duplicado enquanto ela executa.

```tsx
import { IconCheck } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

async function savePreferences() {
  try {
    await save();
    toast({ message: "Preferências salvas.", state: "success" });
  } catch {
    toast({ message: "Não foi possível salvar.", state: "error" });
  }
}

// No JSX da funcionalidade:
<Badge variant="neutral" size="sm">Sem dados</Badge>
<Button variant="primary" onClick={() => void savePreferences()}>
  <IconCheck data-icon="inline-start" aria-hidden="true" />
  Salvar
</Button>
```

O botão já recebe som de interação e o toast recebe o som de resultado. Não chamar outro player para repetir esses efeitos. API completa, mute e limitações em [Sons da interface](interface-sounds.md).

## 5. Padrões das telas existentes

O browser acessa o BFF; os workers publicam leituras de Zabbix, sonda HTTPS, VPS e Signal. A UI deve preservar identidade, qualidade, ausência de dado e separação entre estado operacional e preferência humana. Contratos em [BFF](bff.md) e [Workers](workers.md). Aplicar o design system não cria uma integração nem uma permissão.

| Superfície | Referência e regra |
|---|---|
| Raiz e `/monitor` | `AppShell dashboard`, blocos agregados, toolbar/player, painéis compactos e CSS do dashboard. Usar `dashboard-panel`, `panel-heading`, `panel-foot`; não substituir indiscriminadamente por Card |
| Infraestrutura, host, ASGARD e VM | Mesmo shell, tabelas e métricas com cores de domínio; gráficos uPlot sob demanda; rolagem de página normal |
| Serviços/Signal | Inventário, detalhes e estados independentes; a leitura pública tem restrições próprias |
| Administração | Layout e formulários de `admin.css`; editor/revisão/preview já existentes, com gates de escrita atuais |
| WhatsApp | `components/whatsapp` demonstra Card, Badge, Table, Select, Dialog, toasts e Tabler juntos; inventário local no provider, persistido no browser e avaliado por lógica demonstrativa. Não tomar esses dados como prova de integração Meta/Evolution |
| Login | Duas metades a partir de 1024px; painel ilustrativo com cards e assinatura, formulário em `login-glass-card` até 430px. Gradientes ambientais e blur são específicos dessa vista |

O login contém números ilustrativos estáticos. Também há caminhos de demonstração no servidor condicionados a `PULSE_DEMO_MODE`; a aparência não comprova fonte operacional. Novas funcionalidades de monitoramento devem usar seu contrato real, sem copiar fixtures ou os valores da vitrine do login como fallback.

### Encaixe, responsividade e telão

Nos painéis de um serviço/host individual, usar `ServiceTitle` (`components/dashboard/service-title.tsx`) para compor **nome • disponibilidade**. Ele mantém o título semântico, separador neutro (branco no tema escuro) decorativo e espaço igual de 8px escaláveis dos dois lados. A pílula vem do domínio, conservando estado/freshness e preferências de exibição. ASGARD, Signal, Storage, recursos individuais e cards de hosts compartilham esse cabeçalho na raiz, prévia e páginas que os reutilizam. Em largura reduzida pode reorganizar sem cortar a informação. Painéis agregados/tabelas conservam os estados por recurso; minicards mantêm sua composição compacta própria.

O ASGARD compacto reserva uma linha para nome/disponibilidade quando seu contêiner tem pelo menos 480px: o nome cede largura e trunca, preservando a pílula, o link e o espaço da tabela. Não aplicar essa restrição globalmente aos cabeçalhos menores; seguir o [contrato de encaixe](overview-fit.md).

Preservar a grade de 12 colunas: standard/wide/full correspondem a 4/6/12. A composição e as opções vêm da apresentação salva. O modo split tem regra específica para Disponibilidade/Problemas/ASGARD/Signal. Não injetar blocos ou reordenar preferências ao implementar outro componente.

O encaixe de `overview` em >=1201×740 usa flex/grid com `min-height: 0` e rolagem interna de listas; telas menores ou baixas usam rolagem normal. Detalhes/administração não recebem a trava da raiz. Os minicards preservam altura de 120px; largura usual até 230px, com exceção existente do split que distribui quatro colunas elásticas. Contratos completos em [Encaixe](overview-fit.md) e [Minicards](availability-cards.md).

TV, fullscreen e alternância são estados distintos. O shell aplica `--dashboard-scale` uma vez apenas no dashboard em apresentação (100/110/120/125). Componentes de domínio usam `calc(... * var(--dashboard-scale, 1))` nas medidas previstas. Não usar zoom ou transform global, nem fazer formulário/modal herdar o tamanho do telão. Controles Kobra do cabeçalho são ocultos quando TV ou fullscreen estão ativos; isso não equivale a mutar áudio.

Manter foco visível com `--ring`, labels, texto de estado além da cor, navegação por teclado e todos os dados/ações alcançáveis em celular. A regra global para ponteiro coarse amplia controles a pelo menos 44px, sujeita à cascata específica; conferir o resultado em controles novos. Texto longo pode truncar no resumo, mantendo detalhe acessível por toque/teclado. Tabela larga rola dentro de seu contêiner.

## 6. Movimento, feedback e acessibilidade

Reutilizar `transition-ring`, `focus-field` e as animações dos componentes. O Kobra usa transições curtas, relevo discreto, skeleton e estados de carregamento; não adicionar animações por polling, relógio ou troca de slide. `globals.css` desliga animação/transição em `prefers-reduced-motion: reduce`; os componentes também têm tratamentos próprios. O pacote de áudio instalado suprime reprodução nessa preferência, como detalhado no guia de sons.

O toast Kobra usa `motion`, empilhamento e `dissolve` em `lib/smoky-dissolve.ts`; tooltips usam transições próprias e Caption com Torph. Esses efeitos pertencem aos componentes compartilhados. Evitar copiar seu código para telas novas. `prefers-reduced-transparency` tem tratamento específico para tooltips e toasts em `kobra.css`.

Novas mensagens usam pt-BR, nomes acessíveis para botões de ícone e sucesso apenas após confirmação da ação. Reutilizar o toast Kobra para feedback com som; Sonner permanece disponível para os fluxos anteriores e não emite `kobra:toast`. Não disparar ambos para o mesmo resultado.

## 7. Roteiro para próximas implementações

1. Identificar a vista equivalente no código e o contrato de dados; usar o shell e os componentes já presentes nessa família.
2. Escolher tokens semânticos, variantes e medidas existentes. Tratar os dois temas desde o começo, inclusive SVG/canvas/portal.
3. Preservar `data-slot`/ARIA e deixar o listener global fornecer sons. Para resultado assíncrono, usar toast Kobra quando apropriado.
4. Prever loading, vazio, erro, dado antigo, cancelamento e confirmação; manter identidade e rascunho durante polling.
5. Conferir desktop/mobile, texto longo, teclado/toque, foco, movimento reduzido e contraste nos dois temas. Na raiz, incluir encaixe, split, TV/fullscreen e escala.
6. Conferir mute, volume e ausência de áudio duplicado. Não transformar falhas de polling em alertas sonoros contínuos.
7. Ao ampliar um componente compartilhado, atualizar este guia/guia de som e o contrato de domínio correspondente. Uma mudança de layout/tema global requer intenção explícita; uma funcionalidade usa os padrões atuais.

Esta revisão foi documental, baseada em fontes, dependências instaladas e histórico Git. Não representa uma nova homologação visual ou auditiva; não houve execução de build, testes, worker, migração ou servidor para escrevê-la.
