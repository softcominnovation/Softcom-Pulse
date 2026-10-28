"use client";

import {
  IconActivityHeartbeat,
  IconApps,
  IconBox,
  IconBrandWhatsapp,
  IconCpu,
  IconDatabase,
  IconDeviceTv,
  IconLayoutDashboard,
  IconMaximize,
  IconMoon,
  IconSearch,
  IconServer,
  IconSettings,
  IconSettings2,
  IconSun,
  IconVolume,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CommandMenu,
  type CommandMenuAction,
  openCommandMenu,
} from "@/components/ui/command-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import {
  setSoundMuted,
  setSoundVolume,
  SoundToggle,
  useSoundMuted,
  useSoundVolume,
} from "@/components/ui/sound";
import { toast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useInstanceInventory } from "@/components/whatsapp/whatsapp-instances";
import { toPublicHref } from "@/lib/public/paths";
import { statusLabels } from "@/lib/whatsapp/instances";
import { useUiStore } from "@/store/ui.store";

export function KobraControls({ publicRead = false }: { publicRead?: boolean }) {
  const router = useRouter();
  const theme = useUiStore((state) => state.theme);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const tvMode = useUiStore((state) => state.tvMode);
  const isFullscreen = useUiStore((state) => state.isFullscreen);
  const setTvMode = useUiStore((state) => state.setTvMode);
  const soundSettingsOpen = useUiStore((state) => state.soundSettingsOpen);
  const setSoundSettingsOpen = useUiStore((state) => state.setSoundSettingsOpen);
  const muted = useSoundMuted();
  const volume = useSoundVolume();
  const { instances, selectInstance } = useInstanceInventory();
  const soundPercent = Math.round(volume * 100);

  const navigateTo = useCallback(
    (path: string) => {
      const destination = publicRead ? (toPublicHref(path) ?? "/monitor") : path;
      router.push(destination);
    },
    [publicRead, router]
  );

  const commandActions = useMemo<CommandMenuAction[]>(() => {
    const navActions: CommandMenuAction[] = [
      {
        id: "nav-overview",
        label: "Ir para Visão geral",
        group: "Navegação",
        icon: <IconLayoutDashboard className="size-4" />,
        keywords: ["visao", "geral", "painel", "dashboard", "noc"],
        action: () => navigateTo("/"),
      },
      {
        id: "nav-infra",
        label: "Ir para Infraestrutura",
        group: "Navegação",
        icon: <IconServer className="size-4" />,
        keywords: ["infraestrutura", "hosts", "proxmox", "vms"],
        action: () => navigateTo("/infraestrutura"),
      },
      ...(!publicRead
        ? [
            {
              id: "nav-asgard",
              label: "Ir para Asgard & VMs",
              group: "Navegação",
              icon: <IconCpu className="size-4" />,
              keywords: ["asgard", "vms", "hypervisor"],
              action: () => navigateTo("/asgard"),
            },
          ]
        : []),
      {
        id: "nav-vps",
        label: "Ir para VPS",
        group: "Navegação",
        icon: <IconDatabase className="size-4" />,
        keywords: ["vps", "servidores", "externos"],
        action: () => navigateTo("/admin/vps"),
      },
      {
        id: "nav-services",
        label: "Ir para Serviços",
        group: "Navegação",
        icon: <IconBox className="size-4" />,
        keywords: ["servicos", "signal", "containers", "filas"],
        action: () => navigateTo("/servicos"),
      },
      {
        id: "nav-whatsapp",
        label: "Ir para WhatsApp · Instâncias",
        group: "Navegação",
        icon: <IconBrandWhatsapp className="size-4" />,
        badge: `${instances.length}`,
        keywords: ["whatsapp", "meta", "evolution", "instancias", "mensageria"],
        action: () => navigateTo("/whatsapp"),
      },
      {
        id: "nav-apps",
        label: "Ir para Aplicações",
        group: "Navegação",
        icon: <IconApps className="size-4" />,
        keywords: ["aplicacoes", "sondas", "probes", "http"],
        action: () => navigateTo("/admin/aplicacoes"),
      },
      ...(!publicRead
        ? [
            {
              id: "nav-resources",
              label: "Ir para Recursos",
              group: "Navegação",
              icon: <IconActivityHeartbeat className="size-4" />,
              keywords: ["recursos", "seletores", "inventario"],
              action: () => navigateTo("/admin/recursos"),
            },
            {
              id: "nav-settings",
              label: "Ir para Configurações",
              group: "Navegação",
              icon: <IconSettings className="size-4" />,
              keywords: ["configuracoes", "admin", "apresentacao", "usuarios"],
              action: () => navigateTo("/admin/configuracoes"),
            },
          ]
        : []),
    ];

    const whatsappActions: CommandMenuAction[] = instances.map((instance) => ({
      id: `whatsapp-${instance.id}`,
      label: `${instance.name} · ${
        instance.provider === "meta" ? "Meta" : "Evolution"
      }`,
      group: "Instâncias WhatsApp",
      icon: <IconBrandWhatsapp className="size-4" />,
      badge: statusLabels[instance.status],
      hint:
        instance.provider === "meta"
          ? instance.enabledLabel
          : instance.sessionLabel,
      keywords: [
        "whatsapp",
        "instancia",
        instance.name,
        instance.provider,
        instance.enabledLabel,
        instance.sessionLabel,
      ],
      action: () => {
        selectInstance(instance.id);
        navigateTo("/whatsapp");
      },
    }));

    const preferenceActions: CommandMenuAction[] = [
      {
        id: "theme-toggle",
        label:
          theme === "dark"
            ? "Alternar para tema claro"
            : "Alternar para tema escuro",
        group: "Aparência e som",
        icon:
          theme === "dark" ? (
            <IconSun className="size-4" />
          ) : (
            <IconMoon className="size-4" />
          ),
        keywords: ["tema", "claro", "escuro", "light", "dark", "aparencia"],
        action: () => toggleTheme(),
      },
      {
        id: "tv-toggle",
        label: tvMode ? "Sair do modo TV" : "Ativar modo TV",
        group: "Aparência e som",
        icon: <IconDeviceTv className="size-4" />,
        shortcut: ["T"],
        keywords: ["tv", "painel", "noc", "exibicao"],
        action: () => setTvMode(!tvMode),
      },
      {
        id: "fullscreen-toggle",
        label: "Alternar tela cheia",
        group: "Aparência e som",
        icon: <IconMaximize className="size-4" />,
        shortcut: ["F"],
        keywords: ["tela", "cheia", "fullscreen"],
        action: () => {
          if (document.fullscreenElement) {
            void document.exitFullscreen?.();
          } else {
            void document.documentElement.requestFullscreen?.();
          }
        },
      },
      {
        id: "sound-toggle",
        label: muted
          ? "Ativar sons da interface"
          : "Silenciar sons da interface",
        group: "Aparência e som",
        icon: <IconVolume className="size-4" />,
        badge: muted ? "Mudo" : `${soundPercent}%`,
        keywords: ["som", "audio", "volume", "mudo", "efeitos", "kobra"],
        action: () => setSoundMuted(!muted),
      },
      {
        id: "sound-settings",
        label: "Ajustar sons da interface",
        group: "Aparência e som",
        icon: <IconSettings2 className="size-4" />,
        badge: `${soundPercent}%`,
        keywords: ["som", "audio", "volume", "ajustes", "configurar"],
        action: () => {
          window.setTimeout(() => setSoundSettingsOpen(true), 210);
        },
      },
    ];

    return [...navActions, ...whatsappActions, ...preferenceActions];
  }, [
    instances,
    muted,
    navigateTo,
    publicRead,
    selectInstance,
    setSoundSettingsOpen,
    setTvMode,
    soundPercent,
    theme,
    toggleTheme,
    tvMode,
  ]);

  return (
    <>
      {!tvMode && !isFullscreen && (
        <div
          className="kobra-header-controls"
          role="group"
          aria-label="Busca, som e tema"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  variant="outline"
                  className="command-trigger"
                  aria-label="Buscar no Pulse"
                  data-sound="command"
                  onClick={() => openCommandMenu()}
                >
                  <IconSearch data-icon="inline-start" />
                  <span className="command-trigger-label">Buscar</span>
                  <kbd className="command-trigger-label rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    ⌘K
                  </kbd>
                </Button>
              }
            />
            <TooltipContent>Buscar telas, instâncias e ações (⌘K)</TooltipContent>
          </Tooltip>

          <div
            className="sound-control-group"
            role="group"
            aria-label="Som da interface"
          >
            <SoundToggle
              aria-label={
                muted ? "Ativar sons da interface" : "Silenciar sons da interface"
              }
              title={muted ? "Ativar sons" : "Silenciar sons"}
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Ajustar sons"
                    onClick={() => setSoundSettingsOpen(true)}
                  >
                    <IconSettings2 />
                  </Button>
                }
              />
              <TooltipContent>Volume e teste de áudio</TooltipContent>
            </Tooltip>
          </div>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={
                    theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"
                  }
                  aria-pressed={theme === "dark"}
                  onClick={() => toggleTheme()}
                >
                  {theme === "dark" ? <IconSun /> : <IconMoon />}
                </Button>
              }
            />
            <TooltipContent>
              {theme === "dark" ? "Tema claro" : "Tema escuro"}
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      <Dialog open={soundSettingsOpen} onOpenChange={setSoundSettingsOpen}>
        <DialogContent size="sm" className="sound-dialog">
          <DialogHeader>
            <DialogTitle>Sons da interface</DialogTitle>
            <DialogDescription>
              Respostas sonoras sutis para acompanhar suas ações no Softcom Pulse.
            </DialogDescription>
          </DialogHeader>
          <div className="pulse-audio-settings">
            <div className="pulse-audio-status">
              <SoundToggle
                aria-label={muted ? "Ativar sons" : "Silenciar sons"}
              />
              <span>{muted || soundPercent === 0 ? "Silenciados" : "Ativados"}</span>
              <Badge variant="neutral" size="sm">
                Kobra Sound
              </Badge>
            </div>
            <div className="pulse-volume-label">
              <label id="volume-label">Volume</label>
              <output>{soundPercent}%</output>
            </div>
            <Slider
              min={0}
              max={100}
              step={5}
              value={[soundPercent]}
              onValueChange={(value) =>
                setSoundVolume(
                  (Array.isArray(value) ? value[0] : value) / 100
                )
              }
              aria-labelledby="volume-label"
              size="sm"
              animated={false}
            />
            <p>
              Botões, seleção de opções, abas e notificações usam os sons oficiais
              do Kobra.
            </p>
            <Button
              variant="outline"
              disabled={muted || soundPercent === 0}
              data-sound="notification"
              onClick={() =>
                toast({
                  message: `Áudio de interface ativo em ${soundPercent}%.`,
                  state: "success",
                  sound: false,
                })
              }
            >
              <IconVolume data-icon="inline-start" />
              Testar som
            </Button>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Concluir
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CommandMenu
        actions={commandActions}
        placeholder="Buscar telas, instâncias WhatsApp ou ações…"
      />
    </>
  );
}
