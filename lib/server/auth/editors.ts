import "server-only";

export function editorEmails(value = process.env.PULSE_EDITOR_EMAILS) {
  if (!value?.trim()) return new Set<string>();
  return new Set(value.split(",").map(item => item.trim().toLowerCase()).filter(Boolean));
}

export function isEditor(email: string | null | undefined, value = process.env.PULSE_EDITOR_EMAILS) {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  if (process.env.PULSE_DEMO_MODE === "1" && process.env.PULSE_E2E !== "1" && !value?.trim()) return true;
  return editorEmails(value).has(normalized);
}
