# Sons da interface

Contrato do áudio Kobra incorporado ao Pulse, atualizado em 28/10/2026. Complementa o [Design system](design-system.md) e as [Notificações de serviços](notifications.md). O áudio acompanha interação, feedback e transições operacionais elegíveis, sem sirene ou repetição persistente.

## 1. Onde o som funciona

Para avisos de monitoramento, `toast` também aceita `operational`, `sound`, `velocity` e `onDismiss`. `sound: false` evita áudio no resultado de uma interação já sonorizada. Avisos operacionais usam o mesmo host; expiram sem pausa por hover, pausando somente com foco dentro do próprio aviso. A entrega centralizada controla agrupamento, idade, deduplicação e cooldown. A chegada usa `playOperationalSound` tanto em primeiro como em segundo plano; o toast visual é emitido silenciosamente para não repetir o áudio. Som que o navegador recusar não fica pendente para o foco. Não disparar sons diretamente a cada resposta de polling.

`Providers` monta uma instância de `SoundEffects`. Os efeitos de interação usam o sintetizador Kobra; notificações usam `NotificationAudio`, com WAVs locais decodificados em `AudioBuffer` e um novo `AudioBufferSourceNode` por chegada. Os quatro arquivos em `public/sounds/notifications` foram renderizados das definições Kobra por `node scripts/generate-notification-audio.mjs`, sem áudio externo. O contexto Web Audio é compartilhado com os efeitos de interface e retomado antes de reproduzir, se necessário. Ambos passam pelos mesmos controles de mute, volume e movimento reduzido.

`SoundEffectListener` escuta eventos por delegação no documento e observa atributos. Não é preciso registrar handlers de áudio em cada botão. O helper interno `play` varia levemente afinação e intensidade, respeitando o volume/mute do provider. Ele e o patch não são exportados como um player público de efeitos.

Durante uma interação confiável na página visível, o contexto é desbloqueado e os arquivos são carregados e decodificados em cache. O evento `click` também prepara o áudio, cobrindo a ativação de toque que ocorre depois do pointerdown. Não há reprodução silenciosa nem loop. Ao recarregar, interagir novamente com a página; o botão **Testar som** usa o mesmo caminho das notificações.

`playOperationalSound(sound, velocity, eligible?)` retorna Promise<boolean> em primeiro e segundo plano. Retoma o contexto se estiver suspenso, aguarda o buffer e só confirma após `source.start(0)` com o contexto em execução e a elegibilidade revalidada. Recusa, cancelamento ou preparação acima de 1500 ms não consomem a notificação compartilhada nem deixam um início pendente. Mute e zero interrompem a fonte e zeram seu ganho. Erros de preparação/reprodução são registrados no console como `[Pulse] Notification audio could not start`.

O provider tenta o som diretamente ao receber alterações elegíveis, independentemente de `document.hidden`, `document.hasFocus`, fila visual, agrupamento ou expiração de toasts. O cooldown e a deduplicação entre abas continuam aplicados. O relógio visual apenas monta o toast silencioso. O player HTMLAudioElement da tentativa anterior foi substituído depois da comparação com a rotina de áudio do projeto de referência fornecido pelo dev.

## 2. Preferências e controles

| Preferência | Contrato atual |
|---|---|
| Mute | `localStorage["kobra-sound-muted"]`: `"1"` silencia; demais valores não silenciam; padrão ativado |
| Volume | `localStorage["kobra-sound-volume"]`: leitura aceita valor finito >=0 e <=1; ausente/inválido usa 0.5; zero é silêncio |
| Controle visual | Slider 0–100%, passo 5; mute e zero silenciam |
| APIs exportadas | `setSoundMuted`, `useSoundMuted`, `setSoundVolume`, `useSoundVolume`, `SoundToggle`, `SoundEffects` e tipo `SoundName` |
| Sincronização | `useSyncExternalStore`, notificações na mesma aba e evento `storage` entre abas da mesma origem |
| Storage bloqueado | Fallback em memória para a sessão; não impede operar os controles |

`setSoundVolume` limita valores válidos ao intervalo 0–1. Zero persiste após recarregar. Mute, zero e redução do volume interrompem vozes em execução e limpam ticks pendentes. Reativar não reproduz eventos descartados. Ativar pelo botão quando o volume está zero restaura 0.5.

As preferências pertencem ao browser/origem e não são gravadas no PostgreSQL. O volume do sistema operacional e o mute da aba também afetam o que se ouve, mas não são controlados pelo Pulse.

`KobraControls` coloca mute e ajustes no cabeçalho. **Testar som** reproduz o WAV de notificação e informa se o navegador iniciou a reprodução. Não duplica o som por pointerdown; usa data-sound="none". O teste fica desabilitado em mute/zero.

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

`data-sound="none"` desliga o efeito automático daquele controle, permitindo testar o player de notificações sem som duplicado. Demais nomes desconhecidos continuam nas regras automáticas.

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

## 7. Monitor compatível de TV

O caminho clássico de `/monitor` não carrega os providers React. `public/monitor-compat-audio.js` fornece somente o áudio operacional das notificações com os quatro WAVs Kobra existentes, mantendo `kobra-sound-muted`, `kobra-sound-volume`, volume zero, cooldown e chaves públicas de deduplicação. Usa Web Audio com um novo AudioBufferSourceNode por chegada; não adiciona outro player à página moderna nem emite sons por atualização de métricas. Os controles clássicos usam esse mesmo adaptador.

A primeira interação confiável prepara o contexto e os buffers. Reprodução depende da permissão de áudio do navegador/WebView; o adapter não promete contornar autoplay. Storage bloqueado conserva preferências em memória, e Web Locks são opcionais. Snapshot inicial/ressincronização são silenciosos, não há repetição nem som adiado ao recuperar foco. Ausência de áudio não bloqueia os cards. Implementação, restrições e homologação em [Monitor compatível](monitor-compatibility.md).

Os arquivos são lidos por `GET /monitor/compat/audio/:sound`, com allowlist dos quatro nomes e Host público permitido. Esse caminho atende CORS de origem opaca sem ampliar a política dos WAVs gerais. Os controles de mute e volume permanecem disponíveis no header do modo TV.

Revisão por leitura de `sound.tsx`, `kobra-controls.tsx`, `toast.tsx`, providers e implementação instalada de `@web-kits/audio`. Não foi realizada uma nova sessão de teste auditivo ou alteração de preferências reais nesta documentação.
