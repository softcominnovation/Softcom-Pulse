"use client";

import type { ReactNode } from "react";
import { useCanEdit } from "@/store/auth.store";

export function EditorGate({ children }: { children: ReactNode }) {
  const editor = useCanEdit();
  if (!editor) return <div className="admin-page"><p className="admin-notice">Esta sessão lê a configuração compartilhada e não altera telas, nomes nem templates.</p></div>;
  return children;
}
