// Shared auth helpers for the Cloudflare Pages Functions in this project.
// Underscore-prefixed folder so Pages does not treat it as a route.

const enc = new TextEncoder();

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex) {
  const clean = String(hex || "");
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

// Constant-time-ish string compare — avoids short-circuiting on length so a
// timing attack can't easily learn how many leading characters matched.
export function timingSafeEqualStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ab[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

export async function hashPassword(password, saltHex, iterations) {
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: iterations || 100000 },
    keyMaterial,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function verifyPassword(password, storedHashHex, saltHex, iterations) {
  const hash = await hashPassword(password, saltHex, iterations);
  return timingSafeEqualStr(hash, String(storedHashHex || ""));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

// Session token = base64(json payload) + "." + hex(HMAC-SHA256 signature).
// Stateless: no KV/session store needed, verified fresh on every request.
export async function signSession(payload, secret) {
  const body = btoa(JSON.stringify(payload));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return body + "." + bytesToHex(new Uint8Array(sig));
}

export async function verifySession(token, secret) {
  if (!token || token.indexOf(".") === -1) return false;
  const dot = token.lastIndexOf(".");
  const body = token.slice(0, dot);
  const sigHex = token.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/i.test(sigHex)) return false; // must be exactly a SHA-256 HMAC (32 bytes)
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, hexToBytes(sigHex), enc.encode(body));
  if (!ok) return false;
  try {
    const payload = JSON.parse(atob(body));
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch (e) {
    return false;
  }
}

export function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.indexOf(name + "=") === 0);
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}
