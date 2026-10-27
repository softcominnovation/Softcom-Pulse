import type { ReactNode } from "react";
import "./service-title.css";

/** A single resource's heading and its existing availability, kept together. */
export function ServiceTitle({ children, status }: { children: ReactNode; status?: ReactNode }) {
  return <div className="service-title">{children}{status && <span className="service-title-status"><span className="service-title-separator" aria-hidden="true" />{status}</span>}</div>;
}
