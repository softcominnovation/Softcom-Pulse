import { useState } from "react";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Providers, usePublicConfig } from "@/app/providers";
import { toast } from "sonner";

function PublicConfigProbe() {
  return <output className="break-all" data-testid="config">{JSON.stringify(usePublicConfig())}</output>;
}
export function ConfirmationFixture({ failFirst = false, longText = false }: { failFirst?: boolean; longText?: boolean }) {
  const [calls, setCalls] = useState(0);
  return <Providers config={{ appName: "Pulse", softcomUrl: "https://example.org/" }}>
    <div className="p-4">
      <Label htmlFor="example">Nome</Label><Input id="example" className="mb-4" />
      <ConfirmationDialog trigger={<Button>Remover exemplo</Button>} title="Remover configuração de exemplo?"
        description={"A configuração será removida. Os dados de monitoramento serão preservados. ".repeat(longText ? 60 : 1)}
        confirmLabel="Remover configuração" destructive
        onConfirm={async () => {
          setCalls(value => value + 1);
          await new Promise(resolve => setTimeout(resolve, 300));
          if (failFirst && calls === 0) throw new Error("Test failure");
        }} />
      <output data-testid="calls">{calls}</output>
      <span data-testid="numeric" className="font-mono">12:34:56</span>
      <Button onClick={() => toast("Mensagem de confirmação com texto longo para verificar o acesso em dispositivos móveis.")}>Mostrar alerta</Button>
      <PublicConfigProbe />
    </div>
  </Providers>;
}
