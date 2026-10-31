"use client";

import {
  IconAlertTriangle,
  IconBrandWhatsapp,
  IconCheck,
  IconClock,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconServer,
  IconShieldCheck,
  IconTrash,
} from "@tabler/icons-react";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import {
  createInstanceDefinition,
  evaluateInstances,
  type InstanceDefinition,
  type InstanceDraft,
  type InstanceProvider,
  type InstanceStatus,
  normalizeInstanceInput,
  type Phone,
  readStoredInstances,
  removeInstanceDefinition,
  resetInstanceDefinitions,
  statusLabels,
  statusTone,
  updateInstanceDefinition,
  writeStoredInstances,
} from "@/lib/whatsapp/instances";
import "./whatsapp.css";

interface InstanceInventoryContextValue {
  definitions: InstanceDefinition[];
  instances: Phone[];
  selectedInstanceId: string | null;
  selectInstance: (id: string | null) => void;
  addInstance: (input: InstanceDraft) => InstanceDefinition | null;
  updateInstance: (id: string, input: InstanceDraft) => InstanceDefinition | null;
  removeInstance: (id: string) => InstanceDefinition | null;
  restoreDefaults: () => void;
}

const InstanceInventoryContext = createContext<InstanceInventoryContextValue | null>(null);

function instanceStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function InstanceInventoryProvider({ children }: { children: ReactNode }) {
  const [definitions, setDefinitions] = useState<InstanceDefinition[]>(() =>
    resetInstanceDefinitions()
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    "meta-atendimento"
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setDefinitions(readStoredInstances(instanceStorage()));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    writeStoredInstances(instanceStorage(), definitions);
  }, [definitions]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  const instances = useMemo(
    () => evaluateInstances(definitions, elapsedSeconds),
    [definitions, elapsedSeconds]
  );

  const addInstance = useCallback(
    (input: InstanceDraft): InstanceDefinition | null => {
      const normalized = normalizeInstanceInput(input);
      if (!normalized) return null;
      const created = createInstanceDefinition(definitions, normalized);
      setDefinitions([...definitions, created]);
      setSelectedInstanceId(created.id);
      return created;
    },
    [definitions]
  );

  const updateInstance = useCallback(
    (id: string, input: InstanceDraft): InstanceDefinition | null => {
      const normalized = normalizeInstanceInput(input);
      if (!normalized) return null;
      const next = updateInstanceDefinition(definitions, id, normalized);
      const updated = next.find((instance) => instance.id === id) ?? null;
      setDefinitions(next);
      return updated;
    },
    [definitions]
  );

  const removeInstance = useCallback(
    (id: string): InstanceDefinition | null => {
      const removed = definitions.find((instance) => instance.id === id) ?? null;
      setDefinitions(removeInstanceDefinition(definitions, id));
      return removed;
    },
    [definitions]
  );

  const restoreDefaults = useCallback(() => {
    const defaults = resetInstanceDefinitions();
    setDefinitions(defaults);
    setSelectedInstanceId(defaults[0]?.id ?? null);
  }, []);

  const value = useMemo<InstanceInventoryContextValue>(
    () => ({
      definitions,
      instances,
      selectedInstanceId,
      selectInstance: setSelectedInstanceId,
      addInstance,
      updateInstance,
      removeInstance,
      restoreDefaults,
    }),
    [
      definitions,
      instances,
      selectedInstanceId,
      addInstance,
      updateInstance,
      removeInstance,
      restoreDefaults,
    ]
  );

  return (
    <InstanceInventoryContext.Provider value={value}>
      {children}
    </InstanceInventoryContext.Provider>
  );
}

export function useInstanceInventory(): InstanceInventoryContextValue {
  const context = useContext(InstanceInventoryContext);
  if (!context) {
    throw new Error("useInstanceInventory must be used within InstanceInventoryProvider");
  }
  return context;
}

export function InstanceOriginBadge({ instance }: { instance: InstanceDefinition }) {
  return instance.demo ? (
    <Badge size="sm" variant="ghost">
      Demo
    </Badge>
  ) : (
    <Badge size="sm" variant="outline">
      Local
    </Badge>
  );
}

export function InstanceProviderBadge({ provider }: { provider: InstanceProvider }) {
  return (
    <Badge size="sm" variant={provider === "meta" ? "secondary" : "outline"}>
      {provider === "meta" ? "Meta · Oficial" : "Evolution · Não oficial"}
    </Badge>
  );
}

export function InstanceInventorySummary({
  instances,
}: {
  instances: readonly InstanceDefinition[];
}) {
  const metaCount = instances.filter((instance) => instance.provider === "meta").length;
  const evolutionCount = instances.filter(
    (instance) => instance.provider === "evolution"
  ).length;
  return (
    <span>
      {instances.length} {instances.length === 1 ? "instância" : "instâncias"} · {metaCount}{" "}
      Meta · {evolutionCount} Evolution
    </span>
  );
}

function InstanceFormDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: InstanceDefinition | null;
  onSave: (draft: InstanceDraft) => void;
}) {
  const formKey = `${open ? "open" : "closed"}:${initial?.id ?? "new"}:${initial?.name ?? ""}:${initial?.provider ?? "meta"}`;
  const [prevKey, setPrevKey] = useState(formKey);
  const [name, setName] = useState(initial?.name ?? "");
  const [provider, setProvider] = useState<InstanceProvider>(initial?.provider ?? "meta");
  const [number, setNumber] = useState(initial?.number ?? "");
  const [externalId, setExternalId] = useState(initial?.externalId ?? "");
  const [error, setError] = useState<string | null>(null);

  if (prevKey !== formKey) {
    setPrevKey(formKey);
    setName(initial?.name ?? "");
    setProvider(initial?.provider ?? "meta");
    setNumber(initial?.number ?? "");
    setExternalId(initial?.externalId ?? "");
    setError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeInstanceInput({ name, provider, number, externalId });
    if (!normalized) {
      setError("Informe um nome válido para identificar a instância.");
      return;
    }
    onSave(normalized);
  }

  const editing = Boolean(initial);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="instance-form-dialog">
        <DialogHeader>
          <DialogTitle>
            {editing ? `Editar ${initial?.name}` : "Adicionar instância"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Atualize os dados operacionais exibidos pelo Softcom Pulse nesta sessão do navegador."
              : "Cadastre uma instância de WhatsApp para acompanhar Meta Cloud API ou Evolution no painel."}
          </DialogDescription>
        </DialogHeader>
        <form className="instance-form" onSubmit={handleSubmit}>
          <div className="instance-field">
            <Label htmlFor="instance-name">Nome operacional</Label>
            <Input
              id="instance-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError(null);
              }}
              placeholder="Ex.: Cobrança, Pós-venda, Recepção"
              autoFocus
              required
            />
            {error && <p className="instance-field-error">{error}</p>}
          </div>

          <div className="instance-field">
            <Label>Provedor</Label>
            <div
              className="instance-provider-choice"
              role="radiogroup"
              aria-label="Provedor da instância"
            >
              {(["meta", "evolution"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={provider === option}
                  className={`instance-provider-option ${
                    provider === option ? "active" : ""
                  }`}
                  onClick={() => setProvider(option)}
                >
                  <strong>
                    {option === "meta"
                      ? "Meta · Cloud API"
                      : "Evolution · Não oficial"}
                  </strong>
                  <span>
                    {option === "meta"
                      ? "Habilitação, qualidade e falhas na janela"
                      : "Sessão conectada, entregas e falhas"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="instance-field-grid">
            <div className="instance-field">
              <Label htmlFor="instance-number">Número ou canal (opcional)</Label>
              <Input
                id="instance-number"
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                placeholder="Ex.: +55 83 99999-0000"
              />
            </div>
            <div className="instance-field">
              <Label htmlFor="instance-external-id">
                {provider === "meta"
                  ? "Phone Number ID / WABA (opcional)"
                  : "Nome da sessão Evolution (opcional)"}
              </Label>
              <Input
                id="instance-external-id"
                value={externalId}
                onChange={(event) => setExternalId(event.target.value)}
                placeholder={
                  provider === "meta" ? "Ex.: 10492837465" : "Ex.: softcom-suporte-01"
                }
              />
            </div>
          </div>

          <p className="instance-form-note">
            {editing && initial?.demo
              ? "Esta instância faz parte do conjunto de demonstração e continua recebendo telemetria simulada."
              : "Novas instâncias ficam marcadas como Sem dados (Integração pendente) até que um coletor real envie telemetria."}
          </p>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button type="submit" variant="primary">
              {editing ? "Salvar alterações" : "Adicionar instância"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteInstanceDialog({
  instance,
  open,
  onOpenChange,
  onConfirm,
}: {
  instance: InstanceDefinition | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover instância?</AlertDialogTitle>
          <AlertDialogDescription>
            {instance
              ? `A instância "${instance.name}" (${
                  instance.provider === "meta" ? "Meta" : "Evolution"
                }) deixará de aparecer no resumo operacional e na visão WhatsApp.`
              : "Esta instância deixará de aparecer no painel."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Remover instância
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function InstanceManagerDialog({
  open,
  onOpenChange,
  onSelectInstance,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectInstance?: (id: string) => void;
}) {
  const {
    definitions,
    instances,
    addInstance,
    updateInstance,
    removeInstance,
    restoreDefaults,
  } = useInstanceInventory();
  const [editing, setEditing] = useState<InstanceDefinition | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<InstanceDefinition | null>(null);

  function handleCreate(draft: InstanceDraft) {
    const created = addInstance(draft);
    if (!created) return;
    setCreating(false);
    toast({
      state: "success",
      message: `${created.name} foi incluída como ${
        created.provider === "meta" ? "Meta · Cloud API" : "Evolution"
      }.`,
    });
    onSelectInstance?.(created.id);
  }

  function handleUpdate(draft: InstanceDraft) {
    if (!editing) return;
    const updated = updateInstance(editing.id, draft);
    setEditing(null);
    if (!updated) return;
    toast({
      state: "success",
      message: `${updated.name} foi salva no inventário local.`,
    });
  }

  function handleDelete() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    removeInstance(target.id);
    toast({
      state: "info",
      message: `${target.name} foi removida da listagem monitorada.`,
    });
  }

  function handleRestore() {
    restoreDefaults();
    toast({
      state: "info",
      message: "As 6 instâncias de exemplo (3 Meta e 3 Evolution) foram restauradas.",
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="instance-manager-dialog">
          <DialogHeader>
            <DialogTitle>Gerenciar instâncias de WhatsApp</DialogTitle>
            <DialogDescription>
              Adicione, edite ou remova instâncias oficiais (Meta · Cloud API) e não
              oficiais (Evolution). As alterações ficam salvas neste navegador.
            </DialogDescription>
          </DialogHeader>

          <div className="instance-manager-toolbar">
            <div className="instance-manager-summary">
              <IconBrandWhatsapp className="size-4" />
              <InstanceInventorySummary instances={definitions} />
            </div>
            <div className="instance-manager-actions">
              <Button size="sm" variant="outline" onClick={handleRestore}>
                <IconRefresh data-icon="inline-start" /> Restaurar exemplos
              </Button>
              <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
                <IconPlus data-icon="inline-start" /> Adicionar instância
              </Button>
            </div>
          </div>

          {instances.length === 0 ? (
            <div className="instance-empty-state">
              <strong>Nenhuma instância cadastrada</strong>
              <p>
                Adicione uma instância Meta ou Evolution para acompanhar habilitação,
                sessão, entregas e falhas no Softcom Pulse, ou restaure as instâncias de
                exemplo.
              </p>
              <div className="instance-empty-actions">
                <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
                  <IconPlus data-icon="inline-start" /> Adicionar instância
                </Button>
                <Button size="sm" variant="outline" onClick={handleRestore}>
                  Restaurar exemplos
                </Button>
              </div>
            </div>
          ) : (
            <div className="instance-manager-list" aria-label="Instâncias cadastradas">
              {instances.map((instance) => (
                <div key={instance.id} className="instance-manager-row">
                  <div className="instance-manager-main">
                    <div className="instance-manager-title">
                      <strong>{instance.name}</strong>
                      <InstanceProviderBadge provider={instance.provider} />
                      <InstanceOriginBadge instance={instance} />
                      <Badge size="sm" variant={statusTone[instance.status]}>
                        <span className={`dot ${instance.status}`} />
                        {statusLabels[instance.status]}
                      </Badge>
                    </div>
                    <div className="instance-manager-meta">
                      <span>
                        {instance.provider === "meta"
                          ? `Habilitação: ${instance.enabledLabel} · Qualidade: ${instance.quality}`
                          : `Sessão: ${instance.sessionLabel}`}
                      </span>
                      {instance.number && <span>Canal: {instance.number}</span>}
                      {instance.externalId && <span>ID: {instance.externalId}</span>}
                    </div>
                  </div>
                  <div className="instance-manager-row-actions">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setEditing(instance)}
                    >
                      <IconEdit data-icon="inline-start" /> Editar
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setDeleting(instance)}
                    >
                      <IconTrash data-icon="inline-start" /> Remover
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      <InstanceFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSave={handleCreate}
      />
      <InstanceFormDialog
        open={Boolean(editing)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setEditing(null);
        }}
        initial={editing}
        onSave={handleUpdate}
      />
      <DeleteInstanceDialog
        instance={deleting}
        open={Boolean(deleting)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeleting(null);
        }}
        onConfirm={handleDelete}
      />
    </>
  );
}

type ProviderFilter = "all" | InstanceProvider;
type StatusFilter = "all" | InstanceStatus;

const providerFilterItems = [
  { value: "all", label: "Todos os provedores" },
  { value: "meta", label: "Meta · Cloud API" },
  { value: "evolution", label: "Evolution · Não oficial" },
];

const statusFilterItems = [
  { value: "all", label: "Todos os estados" },
  { value: "good", label: "Operacional" },
  { value: "warn", label: "Atenção" },
  { value: "bad", label: "Crítico" },
  { value: "unknown", label: "Sem dados" },
];

function instanceCriterion(phone: Phone): string {
  return phone.provider === "meta"
    ? "API oficial Meta: validar habilitação para envio, qualidade do número, entregas recentes e falhas na janela."
    : "Evolution não oficial: validar sessão conectada, entregas recentes e taxa de falha de envio.";
}

function instanceNextStep(phone: Phone): string {
  if (!phone.demo) {
    return "Instância cadastrada localmente; vincular o coletor correspondente (Meta Cloud API ou Evolution) para receber telemetria real.";
  }
  if (phone.status === "unknown") {
    return "Restaurar a coleta antes de concluir se a instância está operacional ou com falha.";
  }
  if (phone.provider === "meta" && phone.enabledLabel === "Restrito") {
    return "Conferir restrições da conta/número no Gerenciador da Meta, qualidade do template e webhooks de erro.";
  }
  if (phone.provider === "evolution" && phone.sessionLabel === "Desconectada") {
    return "Conferir o estado da sessão na Evolution, reconectar o dispositivo se necessário e validar uma entrega de teste.";
  }
  return "Nenhuma ação imediata; manter acompanhamento de entregas e falhas na janela.";
}

export function WhatsAppInstances({ publicRead = false }: { publicRead?: boolean }) {
  const {
    definitions,
    instances: phones,
    selectedInstanceId: selectedId,
    selectInstance: onSelectInstance,
    addInstance,
    updateInstance,
    removeInstance,
    restoreDefaults,
  } = useInstanceInventory();
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<InstanceDefinition | null>(null);
  const [deleting, setDeleting] = useState<InstanceDefinition | null>(null);
  const [managing, setManaging] = useState(false);

  const metaInstances = useMemo(
    () => phones.filter((phone) => phone.provider === "meta"),
    [phones]
  );
  const evolutionInstances = useMemo(
    () => phones.filter((phone) => phone.provider === "evolution"),
    [phones]
  );
  const operationalCount = useMemo(
    () => phones.filter((phone) => phone.status === "good").length,
    [phones]
  );
  const attentionCount = useMemo(
    () =>
      phones.filter((phone) => phone.status === "warn" || phone.status === "bad")
        .length,
    [phones]
  );
  const unknownCount = useMemo(
    () => phones.filter((phone) => phone.status === "unknown").length,
    [phones]
  );

  const filteredPhones = useMemo(
    () =>
      phones.filter((phone) => {
        if (providerFilter !== "all" && phone.provider !== providerFilter) return false;
        if (statusFilter !== "all" && phone.status !== statusFilter) return false;
        return true;
      }),
    [phones, providerFilter, statusFilter]
  );

  const selectedPhone = useMemo(() => {
    if (filteredPhones.length === 0) {
      return phones.find((phone) => phone.id === selectedId) ?? phones[0] ?? null;
    }
    return (
      filteredPhones.find((phone) => phone.id === selectedId) ??
      filteredPhones[0] ??
      null
    );
  }, [filteredPhones, phones, selectedId]);

  function handleCreate(draft: InstanceDraft) {
    const created = addInstance(draft);
    if (!created) return;
    setCreating(false);
    onSelectInstance(created.id);
    toast({
      state: "success",
      message: `${created.name} foi incluída como ${
        created.provider === "meta" ? "Meta · Cloud API" : "Evolution"
      }.`,
    });
  }

  function handleUpdate(draft: InstanceDraft) {
    if (!editing) return;
    const updated = updateInstance(editing.id, draft);
    setEditing(null);
    if (!updated) return;
    onSelectInstance(updated.id);
    toast({
      state: "success",
      message: `${updated.name} foi atualizada no inventário.`,
    });
  }

  function handleDelete() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    removeInstance(target.id);
    if (selectedId === target.id) {
      const remaining = definitions.filter((item) => item.id !== target.id);
      onSelectInstance(remaining[0]?.id ?? null);
    }
    toast({
      state: "info",
      message: `${target.name} foi removida da listagem monitorada.`,
    });
  }

  function handleRestore() {
    restoreDefaults();
    setProviderFilter("all");
    setStatusFilter("all");
    toast({
      state: "info",
      message: "As 6 instâncias de exemplo (3 Meta e 3 Evolution) foram restauradas.",
    });
  }

  const metaHealthy = metaInstances.filter((phone) => phone.status === "good").length;
  const metaRestricted = metaInstances.filter(
    (phone) => phone.enabledLabel === "Restrito"
  ).length;
  const evolutionConnected = evolutionInstances.filter(
    (phone) => phone.sessionLabel === "Conectada"
  ).length;
  const evolutionDisconnected = evolutionInstances.filter(
    (phone) => phone.sessionLabel === "Desconectada"
  ).length;

  return (
    <section
      className="view-section whatsapp-view"
      aria-label="Monitoramento de instâncias WhatsApp"
    >
      <div className="whatsapp-hero">
        <div className="whatsapp-hero-copy">
          <div className="whatsapp-eyebrow">
            <IconBrandWhatsapp className="size-4" />
            <span>Mensageria operacional · Meta Cloud API e Evolution</span>
            <Badge size="sm" variant="outline">
              <InstanceInventorySummary instances={definitions} />
            </Badge>
            {publicRead && (
              <Badge size="sm" variant="secondary">
                Leitura pública
              </Badge>
            )}
          </div>
          <h1>Instâncias WhatsApp</h1>
          <p>
            Visão dedicada das instâncias oficiais (Meta · Cloud API) e não oficiais
            (Evolution), separando habilitação, qualidade, conectividade de sessão,
            entregas e taxa de falha sem inventar dados quando a coleta estiver
            indisponível.
          </p>
        </div>
        <div className="whatsapp-hero-actions">
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <IconPlus data-icon="inline-start" /> Adicionar instância
          </Button>
          <Button size="sm" variant="outline" onClick={() => setManaging(true)}>
            Gerenciar instâncias
          </Button>
          <AlertDialog>
            <AlertDialogTrigger render={<Button size="sm" variant="ghost" />}>
              <IconRefresh data-icon="inline-start" /> Restaurar exemplos
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Restaurar instâncias de exemplo?</AlertDialogTitle>
                <AlertDialogDescription>
                  Isso restaura as 6 instâncias padrão (Atendimento, Comercial, Suporte,
                  Financeiro, Relacionamento e Campanhas) e remove personalizações
                  salvas apenas neste navegador.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleRestore}>
                  Restaurar exemplos
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="whatsapp-summary-strip" aria-label="Resumo das instâncias WhatsApp">
        <Card size="sm" className="whatsapp-summary-card">
          <CardHeader>
            <CardDescription>Total monitorado</CardDescription>
            <CardTitle className="whatsapp-summary-value">{phones.length}</CardTitle>
          </CardHeader>
          <CardContent className="whatsapp-summary-foot">
            <span>
              {metaInstances.length} Meta · {evolutionInstances.length} Evolution
            </span>
          </CardContent>
        </Card>

        <Card size="sm" className="whatsapp-summary-card">
          <CardHeader>
            <CardDescription>Meta · Cloud API</CardDescription>
            <CardTitle className="whatsapp-summary-value">
              {metaHealthy}
              <span className="whatsapp-summary-Unit"> / {metaInstances.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="whatsapp-summary-foot">
            <span>
              {metaRestricted > 0
                ? `${metaRestricted} com envio restrito`
                : "Habilitação e qualidade"}
            </span>
          </CardContent>
        </Card>

        <Card size="sm" className="whatsapp-summary-card">
          <CardHeader>
            <CardDescription>Evolution · Sessões</CardDescription>
            <CardTitle className="whatsapp-summary-value">
              {evolutionConnected}
              <span className="whatsapp-summary-Unit">
                {" "}
                / {evolutionInstances.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="whatsapp-summary-foot">
            <span>
              {evolutionDisconnected > 0
                ? `${evolutionDisconnected} sessão desconectada`
                : "Conectividade de sessão"}
            </span>
          </CardContent>
        </Card>

        <Card size="sm" className="whatsapp-summary-card">
          <CardHeader>
            <CardDescription>Operacionais</CardDescription>
            <CardTitle className="whatsapp-summary-value">
              {operationalCount}
            </CardTitle>
          </CardHeader>
          <CardContent className="whatsapp-summary-foot">
            <span>Entregas fluindo normalmente</span>
          </CardContent>
        </Card>

        <Card size="sm" className="whatsapp-summary-card">
          <CardHeader>
            <CardDescription>Com restrição ou falha</CardDescription>
            <CardTitle className="whatsapp-summary-value">{attentionCount}</CardTitle>
          </CardHeader>
          <CardContent className="whatsapp-summary-foot">
            <span>
              {attentionCount > 0
                ? "Exige verificação operacional"
                : "Nenhuma anomalia ativa"}
            </span>
          </CardContent>
        </Card>

        <Card size="sm" className="whatsapp-summary-card">
          <CardHeader>
            <CardDescription>Sem telemetria</CardDescription>
            <CardTitle className="whatsapp-summary-value">{unknownCount}</CardTitle>
          </CardHeader>
          <CardContent className="whatsapp-summary-foot">
            <span>
              {unknownCount > 0
                ? "Integração pendente ou sem coleta"
                : "Todas com evidência recente"}
            </span>
          </CardContent>
        </Card>
      </div>

      <div className="whatsapp-provider-grid">
        <Card size="sm" className="whatsapp-provider-card">
          <CardHeader>
            <CardTitle className="whatsapp-provider-title">
              <IconShieldCheck className="size-4" />
              <span>Meta · Cloud API (Oficial)</span>
            </CardTitle>
            <CardDescription>
              Avalia habilitação da conta/número, qualidade reportada pela Meta e taxa de
              falha nas entregas.
            </CardDescription>
            <CardAction>
              <Badge
                size="sm"
                variant={metaRestricted > 0 ? "warning" : "positive"}
              >
                {metaRestricted > 0
                  ? `${metaRestricted} restrita`
                  : `${metaHealthy}/${metaInstances.length} ativas`}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="whatsapp-provider-metrics">
            <div>
              <span>Instâncias</span>
              <strong>{metaInstances.length}</strong>
            </div>
            <div>
              <span>Habilitadas</span>
              <strong>
                {
                  metaInstances.filter((item) => item.enabledLabel === "Habilitado")
                    .length
                }
              </strong>
            </div>
            <div>
              <span>Qualidade alta</span>
              <strong>
                {metaInstances.filter((item) => item.quality === "Alta").length}
              </strong>
            </div>
            <div>
              <span>Restrições</span>
              <strong>{metaRestricted}</strong>
            </div>
          </CardContent>
        </Card>

        <Card size="sm" className="whatsapp-provider-card">
          <CardHeader>
            <CardTitle className="whatsapp-provider-title">
              <IconServer className="size-4" />
              <span>Evolution · Sessões não oficiais</span>
            </CardTitle>
            <CardDescription>
              Avalia estado da sessão conectada, última entrega confirmada e falhas de
              envio. Qualidade Meta não se aplica.
            </CardDescription>
            <CardAction>
              <Badge
                size="sm"
                variant={evolutionDisconnected > 0 ? "negative" : "positive"}
              >
                {evolutionDisconnected > 0
                  ? `${evolutionDisconnected} desconectada`
                  : `${evolutionConnected}/${evolutionInstances.length} conectadas`}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="whatsapp-provider-metrics">
            <div>
              <span>Instâncias</span>
              <strong>{evolutionInstances.length}</strong>
            </div>
            <div>
              <span>Sessões conectadas</span>
              <strong>{evolutionConnected}</strong>
            </div>
            <div>
              <span>Desconectadas</span>
              <strong>{evolutionDisconnected}</strong>
            </div>
            <div>
              <span>Qualidade Meta</span>
              <strong>Não se aplica</strong>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="whatsapp-main-grid">
        <Card size="sm" className="whatsapp-table-card">
          <CardHeader className="whatsapp-table-header">
            <div>
              <CardTitle>Inventário e saúde por instância</CardTitle>
              <CardDescription>
                Clique em uma instância para inspecionar evidências, critérios
                operacionais ou editar seus metadados.
              </CardDescription>
            </div>
            <div className="whatsapp-toolbar">
              <Select
                items={providerFilterItems}
                value={providerFilter}
                onValueChange={(value) =>
                  setProviderFilter((value as ProviderFilter) ?? "all")
                }
              >
                <SelectTrigger size="sm" aria-label="Filtrar por provedor">
                  <SelectValue placeholder="Provedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">Todos os provedores</SelectItem>
                    <SelectItem value="meta">Meta · Cloud API</SelectItem>
                    <SelectItem value="evolution">
                      Evolution · Não oficial
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>

              <Select
                items={statusFilterItems}
                value={statusFilter}
                onValueChange={(value) =>
                  setStatusFilter((value as StatusFilter) ?? "all")
                }
              >
                <SelectTrigger size="sm" aria-label="Filtrar por estado">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">Todos os estados</SelectItem>
                    <SelectItem value="good">Operacional</SelectItem>
                    <SelectItem value="warn">Atenção</SelectItem>
                    <SelectItem value="bad">Crítico</SelectItem>
                    <SelectItem value="unknown">Sem dados</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>

              <span className="whatsapp-filter-count">
                Exibindo {filteredPhones.length} de {phones.length}
              </span>

              {(providerFilter !== "all" || statusFilter !== "all") && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setProviderFilter("all");
                    setStatusFilter("all");
                  }}
                >
                  Limpar filtros
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent>
            {filteredPhones.length === 0 ? (
              <div className="instance-empty-state">
                <strong>
                  {phones.length === 0
                    ? "Nenhuma instância cadastrada"
                    : "Nenhuma instância corresponde aos filtros"}
                </strong>
                <p>
                  {phones.length === 0
                    ? "Cadastre uma instância Meta ou Evolution para acompanhar sua operação ou restaure as 6 instâncias de exemplo."
                    : "Ajuste os filtros de provedor e estado ou limpe a seleção para visualizar todo o inventário."}
                </p>
                <div className="instance-empty-actions">
                  {phones.length === 0 ? (
                    <>
                      <Button size="sm" onClick={() => setCreating(true)}>
                        <IconPlus data-icon="inline-start" /> Adicionar instância
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleRestore}>
                        Restaurar exemplos
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setProviderFilter("all");
                        setStatusFilter("all");
                      }}
                    >
                      Limpar filtros
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <Table className="whatsapp-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Instância</TableHead>
                    <TableHead>Provedor</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Habilitação / Sessão</TableHead>
                    <TableHead>Qualidade</TableHead>
                    <TableHead>Última entrega</TableHead>
                    <TableHead>Falhas na janela</TableHead>
                    <TableHead>Evidência</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPhones.map((phone) => {
                    const active = selectedPhone?.id === phone.id;
                    return (
                      <TableRow
                        key={phone.id}
                        data-state={active ? "selected" : undefined}
                        className="whatsapp-row"
                        onClick={() => onSelectInstance(phone.id)}
                      >
                        <TableCell>
                          <div className="whatsapp-cell-title">
                            <strong>{phone.name}</strong>
                            <InstanceOriginBadge instance={phone} />
                          </div>
                          {(phone.number || phone.externalId) && (
                            <div className="whatsapp-cell-sub">
                              {[phone.number, phone.externalId]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <InstanceProviderBadge provider={phone.provider} />
                        </TableCell>
                        <TableCell>
                          <Badge size="sm" variant={statusTone[phone.status]}>
                            <span className={`dot ${phone.status}`} />
                            {statusLabels[phone.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {phone.provider === "meta"
                            ? phone.enabledLabel
                            : phone.sessionLabel}
                        </TableCell>
                        <TableCell>{phone.quality}</TableCell>
                        <TableCell className="mono">{phone.delivery}</TableCell>
                        <TableCell className="mono">{phone.failures}</TableCell>
                        <TableCell>
                          <div className="whatsapp-cell-evidence">
                            <span>{phone.evidence}</span>
                            <small>{phone.evidenceSource}</small>
                          </div>
                        </TableCell>
                        <TableCell
                          className="text-right"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="inline-flex items-center justify-end gap-1">
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={`Editar ${phone.name}`}
                              title={`Editar ${phone.name}`}
                              onClick={() => setEditing(phone)}
                            >
                              <IconEdit />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={`Remover ${phone.name}`}
                              title={`Remover ${phone.name}`}
                              onClick={() => setDeleting(phone)}
                            >
                              <IconTrash />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card
          size="sm"
          className="whatsapp-detail-card"
          aria-label="Detalhes da instância selecionada"
        >
          {selectedPhone ? (
            <>
              <CardHeader>
                <div className="whatsapp-detail-badges">
                  <InstanceProviderBadge provider={selectedPhone.provider} />
                  <InstanceOriginBadge instance={selectedPhone} />
                  <Badge size="sm" variant={statusTone[selectedPhone.status]}>
                    <span className={`dot ${selectedPhone.status}`} />
                    {statusLabels[selectedPhone.status]}
                  </Badge>
                </div>
                <CardTitle className="whatsapp-detail-title">
                  {selectedPhone.name}
                </CardTitle>
                <CardDescription>{selectedPhone.evidenceSource}</CardDescription>
              </CardHeader>

              <CardContent className="whatsapp-detail-body">
                <dl className="whatsapp-detail-grid">
                  <div>
                    <dt>Provedor</dt>
                    <dd>
                      {selectedPhone.provider === "meta"
                        ? "Meta · Cloud API (Oficial)"
                        : "Evolution · Sessão não oficial"}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {selectedPhone.provider === "meta"
                        ? "Habilitação"
                        : "Sessão"}
                    </dt>
                    <dd>
                      {selectedPhone.provider === "meta"
                        ? selectedPhone.enabledLabel
                        : selectedPhone.sessionLabel}
                    </dd>
                  </div>
                  <div>
                    <dt>Qualidade</dt>
                    <dd>{selectedPhone.quality}</dd>
                  </div>
                  <div>
                    <dt>Última entrega</dt>
                    <dd className="mono">{selectedPhone.delivery}</dd>
                  </div>
                  <div>
                    <dt>Falhas na janela</dt>
                    <dd className="mono">{selectedPhone.failures}</dd>
                  </div>
                  <div>
                    <dt>Idade da evidência</dt>
                    <dd>{selectedPhone.evidence}</dd>
                  </div>
                  {selectedPhone.number && (
                    <div>
                      <dt>Número / Canal</dt>
                      <dd className="mono">{selectedPhone.number}</dd>
                    </div>
                  )}
                  {selectedPhone.externalId && (
                    <div>
                      <dt>Identificador externo</dt>
                      <dd className="mono">{selectedPhone.externalId}</dd>
                    </div>
                  )}
                </dl>

                <div className="whatsapp-detail-callout">
                  <div className="whatsapp-detail-callout-title">
                    {selectedPhone.status === "good" ? (
                      <IconCheck className="size-4" />
                    ) : selectedPhone.status === "unknown" ? (
                      <IconClock className="size-4" />
                    ) : (
                      <IconAlertTriangle className="size-4" />
                    )}
                    <strong>Critério operacional</strong>
                  </div>
                  <p>{instanceCriterion(selectedPhone)}</p>
                </div>

                <div className="whatsapp-detail-callout">
                  <div className="whatsapp-detail-callout-title">
                    <strong>Evidência e próxima ação</strong>
                  </div>
                  <p>{instanceNextStep(selectedPhone)}</p>
                </div>

                <div className="whatsapp-detail-actions">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(selectedPhone)}
                  >
                    <IconEdit data-icon="inline-start" /> Editar instância
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleting(selectedPhone)}
                  >
                    <IconTrash data-icon="inline-start" /> Remover
                  </Button>
                </div>
              </CardContent>
            </>
          ) : (
            <CardContent>
              <div className="instance-empty-state">
                <strong>Nenhuma instância selecionada</strong>
                <p>
                  Selecione ou cadastre uma instância para visualizar detalhes
                  operacionais.
                </p>
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      <InstanceFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSave={handleCreate}
      />
      <InstanceFormDialog
        open={Boolean(editing)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setEditing(null);
        }}
        initial={editing}
        onSave={handleUpdate}
      />
      <DeleteInstanceDialog
        instance={deleting}
        open={Boolean(deleting)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeleting(null);
        }}
        onConfirm={handleDelete}
      />
      <InstanceManagerDialog
        open={managing}
        onOpenChange={setManaging}
        onSelectInstance={onSelectInstance}
      />
    </section>
  );
}
