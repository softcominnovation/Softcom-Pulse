import { useEffect } from "react";
import { SoundEffects, setSoundMuted, setSoundVolume, useSoundMuted, useSoundVolume, playOperationalSound } from "@/components/ui/sound";
import { Toasts, toast } from "@/components/ui/toast";
function Controls() {
  const volume = useSoundVolume(), muted = useSoundMuted();
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ complete: (played: boolean) => void }>).detail;
      void playOperationalSound("error", 0.65).then(detail.complete);
    };
    window.addEventListener("test:background-sound", receive);
    return () => window.removeEventListener("test:background-sound", receive);
  }, []);
  return <div className="p-5"><output data-testid="audio-preferences">{muted ? "muted" : "on"}:{volume}</output>
    <input aria-label="Entrada sem efeito sonoro" />
    <button onClick={() => setSoundVolume(0)}>Volume zero</button>
    <button onClick={() => { setSoundVolume(0.5); setSoundMuted(false); }}>Ativar áudio</button>
    <button onClick={() => setSoundMuted(true)}>Silenciar áudio</button>
    <button data-sound="none" onClick={() => { toast({ operational: true, message: "Falha", sound: "error", lifetime: 1000 }); setSoundMuted(true); }}>Notificar e silenciar</button>
    <button data-sound="none" onClick={() => { toast({ operational: true, message: "Falha", sound: "error", lifetime: 1000 }); setSoundVolume(0); }}>Notificar e zerar</button>
    <button onClick={() => toast({ id: "operational-test", operational: true, message: "Storage indisponível", state: "error", sound: "error", lifetime: 1000, action: { label: "Ver central", run: () => undefined } })}>Novo incidente</button>
    <Toasts position="bottom-end" />
  </div>;
}
export function NotificationToastFixture() { return <SoundEffects><Controls /></SoundEffects>; }
