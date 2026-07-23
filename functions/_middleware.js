import { getCookie, verifySession } from "./_lib/auth.js";

const SESSION_COOKIE = "cbo_session";
const PUBLIC_PATHS = ["/login.html", "/api/login", "/api/logout"];

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  if (PUBLIC_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(p))) {
    return next();
  }

  const token = getCookie(request, SESSION_COOKIE);
  const ok = token && env.SESSION_SECRET && (await verifySession(token, env.SESSION_SECRET));
  if (!ok) {
    const dest = new URL("/login.html", url);
    dest.searchParams.set("next", url.pathname + url.search);
    return Response.redirect(dest.toString(), 302);
  }

  return next();
}
