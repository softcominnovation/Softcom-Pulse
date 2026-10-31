import { z } from "zod";

export const notificationTimeZone = "America/Fortaleza";
export const notificationDateSchema = z.iso.date().refine(value => value >= "0001-01-01");
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: notificationTimeZone, year: "numeric", month: "2-digit", day: "2-digit" });
export function notificationDay(now: number | string = Date.now()) {
  const parts = dayFormat.formatToParts(new Date(now));
  const part = (name: string) => parts.find(part => part.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export type NotificationDateRange = { from: string; to?: string };
export function notificationDateError(from: string, to: string | undefined, today = notificationDay()): { field: "from" | "to"; message: string } | null {
  if (!notificationDateSchema.safeParse(from).success) return { field: "from", message: "Informe uma data inicial válida." };
  if (to && !notificationDateSchema.safeParse(to).success) return { field: "to", message: "Informe uma data final válida." };
  if (from > today) return { field: "from", message: "A data inicial não pode estar no futuro." };
  if (to && to > today) return { field: "to", message: "A data final não pode estar no futuro." };
  if (to && to < from) return { field: "to", message: "A data final deve ser igual ou posterior à inicial." };
  return null;
}
