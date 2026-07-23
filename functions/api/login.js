import { verifyPassword, signSession, timingSafeEqualStr } from "../_lib/auth.js";

const SESSION_COOKIE = "cbo_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD_HASH || !env.PASSWORD_SALT || !env.SESSION_SECRET) {
    return json({ error: "Login is not configured yet — set the auth secrets in Cloudflare Pages." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Bad request" }, 400);
  }

  const username = String((body && body.username) || "");
  const password = String((body && body.password) || "");
  if (!username || !password) {
    return json({ error: "Username and password required" }, 400);
  }

  const validUser = timingSafeEqualStr(username, env.ADMIN_USERNAME);
  const validPass = await verifyPassword(
    password,
    env.ADMIN_PASSWORD_HASH,
    env.PASSWORD_SALT,
    Number(env.PASSWORD_ITERATIONS) || 100000,
  );

  if (!validUser || !validPass) {
    return json({ error: "Invalid username or password" }, 401);
  }

  const token = await signSession({ exp: Date.now() + SESSION_TTL_MS }, env.SESSION_SECRET);
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append(
    "Set-Cookie",
    SESSION_COOKIE + "=" + token + "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=" + SESSION_TTL_MS / 1000,
  );
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
