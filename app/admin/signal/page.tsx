import { redirect } from "next/navigation";

/** Signal lives on /servicos — no dedicated admin route. */
export default function SignalAdminRedirectPage() {
  redirect("/servicos#signal");
}
