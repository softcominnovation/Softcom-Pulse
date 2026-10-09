"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import "./not-found-view.css";

export function NotFoundView() {
  const [failed, setFailed] = useState(false);
  return (
    <section className="not-found-view" aria-label="Página não encontrada">
      {failed
        ? <p className="not-found-fallback" role="alert">Não foi possível carregar a imagem. Esta página não existe.</p>
        : <Image src="/images/404.png" alt="" width={1448} height={1086} priority sizes="(max-width: 720px) 92vw, 560px" className="not-found-art" onError={() => setFailed(true)} />}
      <Button asChild variant="primary"><Link href="/monitor">Voltar ao monitor</Link></Button>
    </section>
  );
}
