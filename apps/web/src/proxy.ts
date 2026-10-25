import { NextResponse } from "next/server";

/**
 * The internal demo and session dashboard have no auth and talk to the local API,
 * so they exist only in local dev. On Vercel (the public marketing deploy) they 404.
 */
export function proxy() {
  if (process.env.VERCEL === "1") {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/demo/:path*", "/dashboard/:path*"],
};
