# Sons da interface

Contrato do áudio Kobra incorporado ao Pulse, conferido no código de `develop` em 27/10/2026 (`b428b22`). Complementa o [Design system](design-system.md). O áudio acompanha interação e feedback de UI; não há nesta implementação um mecanismo de sirene operacional acionado por incidentes do monitoramento.

## 1. Onde o som funciona

`Providers` monta uma única instância de `SoundEffects`, que envolve a aplicação, inclusive login e leitura pública. Ela usa `SoundProvider` e `usePatch` de `@web-kits/audio/react` (versão instalada 0.2.0). O patch `kobra-ui` fica em `components/ui/sound.tsx`: síntese de senoides, triângulos, ruído, envelopes e filtros; não há arquivos MP3/WAV para cada interação nem download de um pacote sonoro remoto nesse caminho.

`SoundEffectListener` escuta eventos por delegação no documento e observa atributos. Não é preciso registrar handlers de áudio em cada botão. O helper interno `play` varia levemente afinação e intensidade, respeitando o volume/mute do provider. Ele e o patch não são exportados como um player público de efeitos.

Reprodução depende do contexto de áudio do navegador. O pacote cria/reutiliza `AudioContext` e tenta retomá-lo quando suspenso; um navegador ainda pode exigir interação. Não simular cliques nem assumir que abrir a página garante áudio. `usePatch` também respeita `prefers-reduced-motion`: na versão instalada, essa preferência suprime sons, mesmo com o controle visual em Ativados.

## 2. Preferências e controles

| Preferência | Contrato atual |
|---|---|
| Mute | `localStorage["kobra-sound-muted"]`: `"1"` silencia; demais valores não silenciam; padrão ativado |
| Volume | `localStorage["kobra-sound-volume"]`: leitura aceita valor finito >0 e <=1; ausente/inválido usa 0.5 |
| Controle visual | Slider 10–100%, passo 5; usar mute para silêncio |
| APIs exportadas | `setSoundMuted`, `useSoundMuted`, `setSoundVolume`, `useSoundVolume`, `SoundToggle`, `SoundEffects` e tipo `SoundName` |
| Sincronização | `useSyncExternalStore`, notificações na mesma aba e evento `storage` entre abas da mesma origem |
| Storage bloqueado | Fallback em memória para a sessão; não impede operar os controles |

`setSoundVolume` grava o número recebido sem clamp próprio. Chamadores devem enviar valor válido; a leitura faz o fallback. Volume zero não é mute e volta ao default na leitura.

As preferências pertencem ao browser/origem e não são gravadas no PostgreSQL. O volume do sistema operacional e o mute da aba também afetam o que se ouve, mas não são controlados pelo Pulse.

`KobraControls` coloca mute e ajustes no cabeçalho. O diálogo **Sons da interface** oferece toggle, slider, teste e Concluir. A busca global também permite ativar/silenciar e abrir ajustes. Ao sair de mudo para ativado, o listener toca `swoosh`. O botão **Testar som** usa `data-sound="notification"` e emite um toast Kobra de sucesso; a sequência pode conter tanto o som de interação quanto o de resultado, como no código atual.

TV/fullscreen ocultam o grupo de controles no cabeçalho, mas não alteram mute/volume. Não presumir que um telão entrou em silêncio ao ativar apresentação.

## 3. Como um controle recebe som

O listener usa `pointerdown` primário em captura e `keydown` Enter/Espaço, ignorando repetição automática. É um feedback de acionamento anterior ao resultado da operação. Controles com label são resolvidos para o input associado; alvos de texto são excluídos da sonorização comum.

A busca percorre o elemento interativo mais próximo e seus ancestrais. Se ele estiver `:disabled`, `aria-disabled="true"` ou tiver `data-disabled`, tenta `blocked`. Botões nativamente desabilitados/CSS `pointer-events: none` podem não entregar o evento: não contar com esse som como único feedback de indisponibilidade.

Após a verificação de desabilitado, a classificação segue esta precedência:

| Atributo/elemento | Efeito |
|---|---|
| `data-sound` com nome válido | Usa o efeito indicado, antes das demais regras |
| Slot de toggle/checkbox/switch/radio, input checkbox/radio, `aria-pressed` ou papéis menuitemcheckbox/menuitemradio | `toggleOn` ou `toggleOff`, a partir do estado anterior |
| `data-variant="destructive"` | `destructive` |
| `data-slot` terminado em `-close` | `close` |
| Slot terminado em `-clear` ou `-remove` | `chirp` |
| Slot terminado em `-trigger` | `open`/`close` conforme `aria-expanded`; sem esse atributo usa `select` |
| Slot terminado em `-item`, `-link`, `-option` | `select`, com variação de afinação pela posição |
| `slider-thumb` / `slider-track` | `tick` |
| `data-slot="button"`, button, link com href ou role button | `tap`; variantes ghost/link são mais suaves |

Essa ordem importa: por exemplo, `aria-pressed` tem prioridade sobre a variante destrutiva. Definir atributos pela semântica real do controle, sem falsificar ARIA para escolher um som. Slots e estados são fornecidos pelas primitivas locais.

Nomes válidos de `data-sound`: `tap`, `select`, `toggleOn`, `toggleOff`, `open`, `close`, `tick`, `sliderTick`, `destructive`, `key`, `success`, `error`, `warning`, `copy`, `notification`, `swoosh`, `chirp`, `command`, `blocked`.

Um nome desconhecido não desliga áudio: cai nas regras automáticas. Não existe `data-sound="none"` nem contrato de opt-out por subárvore. Não adicionar atributos fictícios como se fossem suportados.

### Exemplos para novas funcionalidades

```tsx
import { Button } from "@/components/ui/button";

// Acionamento comum: recebe tap automaticamente.
<Button onClick={openEditor}>Editar</Button>

// Fechamento/abertura: preferir DialogTrigger e DialogClose,
// que já fornecem os slots e a semântica adequados.

// Exceção explícita: feedback de tentativa de cópia.
<Button data-sound="copy" onClick={() => void copyValue()}>
  Copiar
</Button>
```

`data-sound="success"` no botão indicaria sucesso antes de o request/cópia terminar. Para operação assíncrona, escolher um efeito de interação e emitir sucesso/erro somente ao confirmar o resultado. Não chamar outro `AudioContext` ou player em `onClick` para repetir o som automático.

## 4. Eventos e efeitos complementares

| Origem | Comportamento |
|---|---|
| Command menu | Dentro de `.command-overlay`, a opção recebe `command`; opção com `.command-option-more`, `chirp`. Enter usa `aria-activedescendant` para a linha ativa |
| Digitação normal | Inputs de texto, textarea e contenteditable não recebem tap por digitação/foco do listener comum |
| OTP | Evento input confiável em input dentro de `data-slot="input-otp"` toca `key`; afinação varia com o comprimento e exclusão |
| Menu de contexto | Evento `contextmenu` no documento toca `open` |
| Slider | Mudança de `aria-valuenow` em input range/role slider toca `sliderTick`; afinação acompanha a posição normalizada |
| Arraste de slider | Movimento >3px caracteriza arraste; passos são espaçados em 28ms e a fila deixa de crescer ao exceder atraso de 60ms; soltar/cancelar limpa ticks pendentes |
| Resultado marcado no DOM | Mudança de `data-success` para valor não nulo, diferente de `"false"` e do anterior toca `success` |
| Campo inválido | Mesma regra de entrada de atributo para `aria-invalid` toca `error` |
| Retorno do mute | Transição silenciado → ativado toca `swoosh` |

O observer acompanha somente `aria-valuenow`, `aria-invalid` e `data-success`, com valor anterior. Não observa texto genérico de métricas nem detecta automaticamente que um servidor caiu. Se vários campos se tornarem inválidos juntos, pode haver mais de um efeito. Não combinar marcações de sucesso e toast sonoro sem necessidade.

Mudanças programáticas nesses atributos também podem gerar som; não há filtro `isTrusted` no observer. Atualizações de polling devem evitar escrever sinais de sucesso/erro de formulário a cada ciclo. No slider, os limites sem aria válidos e os valores novos precisam fazer sentido; usar o componente compartilhado em vez de reconstruir sua lógica.

Ao desmontar o listener, o código remove eventos, desconecta o MutationObserver e limpa ticks pendentes. Uma nova tela não deve montar outra instância de `SoundEffects` dentro da já global.

## 5. Toasts e resultado assíncrono

Há dois sistemas montados em `Providers`:

| API | Renderização | Integração sonora |
|---|---|---|
| `toast` de `@/components/ui/toast` | `<Toasts position="bottom-end" />`, Kobra | Emite evento `kobra:toast` ouvido pelo listener |
| `toast` de `sonner` | `<Toaster position="bottom-right" ... />`, tema da store e classe `pulse-toast` | Não emite esse evento nem recebe som automaticamente por essa integração |

Para novos fluxos que pedem feedback Kobra, usar a API local:

```tsx
import { toast, dismissToast } from "@/components/ui/toast";

const id = "save-preferences";
toast({ id, message: "Salvando…", state: "pending" });
try {
  await save();
  toast({ id, message: "Preferências salvas.", state: "success" });
} catch {
  toast({ id, message: "Não foi possível salvar.", state: "error" });
}

// Quando necessário, em outra ação: dismissToast(id).
```

`toast` aceita string ou `{ id?, message, state?, action?, lifetime? }` e não retorna um id. `action` é `{ label, run }`. Para atualizar/dispensar a mesma notificação, passar id explícito; não usar a API `toast.success(...)` do Sonner neste import. Estados: `pending`, `success`, `error`, `warning`, `info`. A vida padrão é 2400ms e 6000ms com ação; pending não expira enquanto mantiver esse estado. O mesmo id atualiza a notificação visual.

Mapa de áudio no evento: pending é silencioso; success → `success`, error → `error`, warning → `warning`, info/estado ausente → `notification`, intensidade 0.7. Cada emissão não pending toca de novo, mesmo com id repetido. Assim, reutilizar id não resolve spam sonoro em polling: emitir apenas na transição relevante, com a deduplicação da funcionalidade.

Preservar chamadas Sonner existentes quando a tarefa não pede migração. Não emitir os dois sistemas para o mesmo resultado e não prometer som em um fluxo que usa exclusivamente Sonner.

## 6. Critérios ao ampliar o áudio

1. Usar um efeito existente por semântica de ação; manter volume/mute centralizados e labels em pt-BR nos controles visíveis.
2. Separar tentativa de interação de resultado confirmado. O som não substitui feedback visual, texto, foco ou anúncio acessível.
3. Conferir mouse, Enter/Espaço, toque, erro, toggle e slider; não adicionar segundo disparo em click por cima do pointerdown já delegado.
4. Conferir mute, volume válido, storage indisponível e movimento reduzido. Autoplay/volume da aba e do sistema podem impedir reprodução audível.
5. Não disparar alarmes em loop a partir do polling. Alarmes operacionais futuros precisam de contrato próprio: este listener fornece efeitos de UI.
6. Se uma funcionalidade realmente precisar de efeito novo/opt-out, ampliar explicitamente o contrato compartilhado e atualizar este documento; esses recursos não existem apenas por atribuir um nome arbitrário no JSX.

Revisão por leitura de `sound.tsx`, `kobra-controls.tsx`, `toast.tsx`, providers e implementação instalada de `@web-kits/audio`. Não foi realizada uma nova sessão de teste auditivo ou alteração de preferências reais nesta documentação.
