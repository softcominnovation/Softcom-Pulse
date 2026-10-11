import { redirect } from "next/navigation";

/** Recursos stays authenticated-only; public surface has no mirror route. */
export default function PublicResourcesPage() {
  redirect("/login");
}
