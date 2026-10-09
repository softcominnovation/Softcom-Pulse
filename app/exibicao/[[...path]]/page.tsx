import { redirect } from "next/navigation";

export default async function ExibicaoCatchAllRedirect({ params }: { params: Promise<{ path?: string[] }> }) {
  const segments = (await params).path ?? [];
  redirect(`/monitor${segments.length ? `/${segments.join("/")}` : ""}`);
}
