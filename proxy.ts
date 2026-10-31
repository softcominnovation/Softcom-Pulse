import { NextResponse, type NextRequest } from "next/server";
import { needsCompatibleMonitor } from "./lib/public/monitor-compatibility";

export function proxy(request: NextRequest) {
  if (!["GET", "HEAD"].includes(request.method)) return NextResponse.next();
  if (request.nextUrl.searchParams.get("compat") !== "1" && !needsCompatibleMonitor(request.headers.get("user-agent") ?? "")) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/monitor/compat";
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/monitor"] };
