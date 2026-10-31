import { NextResponse, type NextRequest } from "next/server";
import { needsCompatibleMonitor } from "./lib/public/monitor-compatibility";

export function proxy(request: NextRequest) {
  if (!["GET", "HEAD"].includes(request.method)) return NextResponse.next();
  const preference = request.nextUrl.searchParams.get("compat");
  if (preference === "0" || preference !== "1" && request.headers.get("sec-fetch-dest") !== "iframe" && !needsCompatibleMonitor(request.headers.get("user-agent") ?? "")) return NextResponse.next();
  const url = new URL(request.url);
  url.pathname = "/monitor/compat";
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/monitor"] };
