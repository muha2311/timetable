// Minimal Google REST client for Cloudflare Workers/Pages Functions (the Firebase Admin SDK needs Node, so it cannot run here).
// The service account JSON is read ONLY from the FIREBASE_SERVICE_ACCOUNT secret; nothing privileged is ever sent to the browser.
export interface Env { FIREBASE_PROJECT_ID: string; FIREBASE_WEB_API_KEY: string; FIREBASE_SERVICE_ACCOUNT: string }
export type FsData = Record<string, string | boolean | null>;
export class GoogleError extends Error { code: string; status: number; constructor(code: string, status: number) { super(code); this.code = code; this.status = status; } }

const b64url = (b: ArrayBuffer | string): string => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = ""; bytes.forEach((x) => { s += String.fromCharCode(x); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const pemToDer = (pem: string): ArrayBuffer => {
  const raw = atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
};

let cached: { token: string; exp: number } | null = null;
/** OAuth access token for the service account (RS256 JWT signed with WebCrypto, cached ~1h per isolate). */
export async function accessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as { client_email: string; private_key: string; token_uri?: string };
  const aud = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud, iat: now, exp: now + 3600 }));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claim}`));
  const r = await fetch(aud, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${b64url(sig)}` }) });
  if (!r.ok) throw new GoogleError("token_exchange_failed", 502);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}
export const resetTokenCache = (): void => { cached = null; };

const idt = (env: Env) => `https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}`;
async function call(env: Env, url: string, body: unknown, method = "POST"): Promise<Record<string, unknown>> {
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${await accessToken(env)}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } } & Record<string, unknown>;
  if (!r.ok) throw new GoogleError(String(j.error?.message ?? "google_error").split(" ")[0] ?? "google_error", r.status);
  return j;
}

/** Verifies a Firebase ID token by asking Google (signature, expiry, revocation). Returns null when invalid. */
export async function lookupIdToken(env: Env, idToken: string): Promise<{ uid: string; email: string; disabled: boolean } | null> {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
  if (!r.ok) return null;
  const u = ((await r.json()) as { users?: { localId: string; email?: string; disabled?: boolean }[] }).users?.[0];
  return u ? { uid: u.localId, email: u.email ?? "", disabled: u.disabled === true } : null;
}
export const createAuthUser = async (env: Env, email: string, displayName: string, disabled: boolean): Promise<string> =>
  String((await call(env, `${idt(env)}/accounts`, { email, displayName, emailVerified: false, disabled })).localId);
export const setAuthDisabled = async (env: Env, uid: string, disabled: boolean): Promise<void> => {
  await call(env, `${idt(env)}/accounts:update`, { localId: uid, disableUser: disabled, ...(disabled ? { validSince: String(Math.floor(Date.now() / 1000)) } : {}) }); // validSince revokes existing sessions
};
export const deleteAuthUser = async (env: Env, uid: string): Promise<void> => { await call(env, `${idt(env)}/accounts:delete`, { localId: uid }); };
/** Password-setup link (Firebase "reset password" action). The admin never sees or chooses a password. */
export const passwordSetupLink = async (env: Env, email: string): Promise<string> =>
  String((await call(env, `${idt(env)}/accounts:sendOobCode`, { requestType: "PASSWORD_RESET", email, returnOobLink: true })).oobLink);

// ---- Firestore REST (flat documents only) ----
const fsBase = (env: Env) => `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const enc = (v: string | boolean | null | Date) => (v === null ? { nullValue: null } : typeof v === "boolean" ? { booleanValue: v } : v instanceof Date ? { timestampValue: v.toISOString() } : { stringValue: v });
const encAll = (d: Record<string, string | boolean | null | Date>) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, enc(v)]));
const dec = (fields: Record<string, Record<string, unknown>> | undefined): FsData => {
  const out: FsData = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = "stringValue" in v ? String(v.stringValue) : "booleanValue" in v ? v.booleanValue === true : "timestampValue" in v ? String(v.timestampValue) : null;
  return out;
};
export async function fsGet(env: Env, path: string): Promise<FsData | null> {
  const r = await fetch(`${fsBase(env)}/${path}`, { headers: { authorization: `Bearer ${await accessToken(env)}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new GoogleError("firestore_read_failed", 502);
  return dec(((await r.json()) as { fields?: Record<string, Record<string, unknown>> }).fields);
}
/** Creates a document and fails if it already exists (never overwrites a profile). */
export const fsCreate = async (env: Env, collection: string, id: string, data: Record<string, string | boolean | null | Date>): Promise<void> => {
  await call(env, `${fsBase(env)}/${collection}/${encodeURIComponent(id)}?currentDocument.exists=false`, { fields: encAll(data) }, "PATCH");
};
export const fsPatch = async (env: Env, path: string, data: Record<string, string | boolean | null | Date>): Promise<void> => {
  const mask = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  await call(env, `${fsBase(env)}/${path}?${mask}&currentDocument.exists=true`, { fields: encAll(data) }, "PATCH");
};
export const fsAdd = async (env: Env, collection: string, data: Record<string, string | boolean | null | Date>): Promise<void> => { await call(env, `${fsBase(env)}/${collection}`, { fields: encAll(data) }); };
export async function countActiveSuperAdmins(env: Env): Promise<number> {
  const eq = (f: string, v: string | boolean) => ({ fieldFilter: { field: { fieldPath: f }, op: "EQUAL", value: enc(v) } });
  const r = await fetch(`${fsBase(env)}:runQuery`, { method: "POST", headers: { authorization: `Bearer ${await accessToken(env)}`, "content-type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "users" }], where: { compositeFilter: { op: "AND", filters: [eq("role", "SUPER_ADMIN"), eq("isActive", true)] } } } }) });
  if (!r.ok) throw new GoogleError("firestore_query_failed", 502);
  return ((await r.json()) as { document?: unknown }[]).filter((x) => x.document).length;
}
