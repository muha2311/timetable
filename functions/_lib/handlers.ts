import { countActiveSuperAdmins, createAuthUser, deleteAuthUser, fsAdd, fsCreate, fsGet, fsPatch, GoogleError, lookupIdToken, passwordSetupLink, setAuthDisabled, type Env } from "./google.ts";
import { normalizeEmail, removesLastSuperAdmin, validateCreate, validateUpdate } from "./logic.ts";

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
type Auth = { ok: true; uid: string; email: string; body: unknown } | { ok: false; res: Response };

/**
 * Every privileged request: POST only -> Firebase ID token verified by Google -> account not disabled ->
 * role read from Firestore with the SERVER's credentials (never from the request) must be an active SUPER_ADMIN.
 */
async function authorize(req: Request, env: Env): Promise<Auth> {
  if (req.method !== "POST") return { ok: false, res: json(405, { error: "method_not_allowed" }) };
  const token = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return { ok: false, res: json(401, { error: "unauthenticated" }) };
  const who = await lookupIdToken(env, token).catch(() => null);
  if (!who) return { ok: false, res: json(401, { error: "unauthenticated" }) };
  if (who.disabled) return { ok: false, res: json(403, { error: "forbidden" }) };
  const profile = await fsGet(env, `users/${who.uid}`).catch(() => null);
  if (!profile || profile.role !== "SUPER_ADMIN" || profile.isActive !== true) return { ok: false, res: json(403, { error: "forbidden" }) };
  const text = await req.text();
  if (text.length > 4096) return { ok: false, res: json(413, { error: "too_large" }) };
  try { return { ok: true, uid: who.uid, email: who.email, body: text ? JSON.parse(text) : {} }; } catch { return { ok: false, res: json(400, { error: "invalid_json" }) }; }
}
const log = (env: Env, a: { uid: string; email: string }, action: string, target: string) =>
  fsAdd(env, "activityLog", { type: "user", action, target, actorUid: a.uid, actorEmail: a.email, createdAt: new Date() }).catch(() => undefined); // best-effort
const fail = (e: unknown): Response => (e instanceof GoogleError && e.status < 500 ? json(e.status === 404 ? 404 : 409, { error: e.code.toLowerCase() }) : json(502, { error: "upstream_failed" }));

export async function createUser(req: Request, env: Env): Promise<Response> {
  const a = await authorize(req, env); if (!a.ok) return a.res;
  const v = validateCreate(a.body); if (!v.ok) return json(400, { error: "validation", fields: v.fields });
  const { fullName, email, role, isActive } = v.value;
  let uid: string;
  try { uid = await createAuthUser(env, email, fullName, !isActive); }
  catch (e) { return e instanceof GoogleError && e.code === "EMAIL_EXISTS" ? json(409, { error: "email_exists" }) : json(502, { error: "upstream_failed" }); }
  const now = new Date();
  try { await fsCreate(env, "users", uid, { uid, fullName, email, role, isActive, createdAt: now, updatedAt: now, lastLoginAt: null, createdBy: a.uid }); }
  catch {
    // Auth account exists but the profile could not be saved: remove the account so the two stores never disagree.
    const rolledBack = await deleteAuthUser(env, uid).then(() => true).catch(() => false);
    return json(500, { error: "profile_failed", rolledBack, ...(rolledBack ? {} : { uid }) });
  }
  const setupLink = await passwordSetupLink(env, email).catch(() => null);
  await log(env, a, "create", email);
  return json(201, { uid, email, fullName, role, isActive, setupLink }); // never contains a password
}

export async function updateUser(req: Request, env: Env): Promise<Response> {
  const a = await authorize(req, env); if (!a.ok) return a.res;
  const v = validateUpdate(a.body); if (!v.ok) return json(400, { error: "validation", fields: v.fields });
  const target = await fsGet(env, `users/${v.uid}`).catch(() => null);
  if (!target) return json(404, { error: "not_found" });
  const cur = { role: String(target.role), isActive: target.isActive === true };
  const change = { role: v.role, isActive: v.isActive };
  if (removesLastSuperAdmin(cur, change, await countActiveSuperAdmins(env))) return json(409, { error: "last_super_admin" });
  try {
    if (v.isActive !== undefined && v.isActive !== cur.isActive) await setAuthDisabled(env, v.uid, !v.isActive);
    await fsPatch(env, `users/${v.uid}`, { ...(v.role ? { role: v.role } : {}), ...(v.isActive !== undefined ? { isActive: v.isActive } : {}), updatedAt: new Date() });
  } catch (e) { return fail(e); }
  await log(env, a, v.role && v.role !== cur.role ? "role" : "status", String(target.email));
  return json(200, { uid: v.uid, role: v.role ?? cur.role, isActive: v.isActive ?? cur.isActive });
}

export async function setupLink(req: Request, env: Env): Promise<Response> {
  const a = await authorize(req, env); if (!a.ok) return a.res;
  const uid = (a.body as { uid?: unknown }).uid;
  if (typeof uid !== "string") return json(400, { error: "validation", fields: ["uid"] });
  const target = await fsGet(env, `users/${uid}`).catch(() => null);
  if (!target) return json(404, { error: "not_found" });
  try { return json(200, { setupLink: await passwordSetupLink(env, normalizeEmail(target.email)) }); } catch (e) { return fail(e); }
}
