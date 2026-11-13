import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createUser, setupLink, updateUser } from "../functions/_lib/handlers.ts";
import { resetTokenCache } from "../functions/_lib/google.ts";
import { removesLastSuperAdmin, validateCreate } from "../functions/_lib/logic.ts";

// A real RSA key so the service-account JWT signing path is exercised for real.
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64");
const env = { FIREBASE_PROJECT_ID: "proj", FIREBASE_WEB_API_KEY: "KEY", FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "sa@proj.iam", private_key: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n` }) };

let db, authUsers, calls, failProfileWrite;
const tokens = { "tok-super": { uid: "u-super", email: "boss@x.com" }, "tok-super2": { uid: "u-super2", email: "boss2@x.com" }, "tok-user": { uid: "u-user", email: "user@x.com" }, "tok-noprofile": { uid: "u-none", email: "n@x.com" },
  "tok-off": { uid: "u-off", email: "off@x.com", disabled: true }, "tok-inactive": { uid: "u-inactive", email: "i@x.com" } };
const prof = (role, isActive = true, email = "p@x.com") => ({ fields: { role: { stringValue: role }, isActive: { booleanValue: isActive }, email: { stringValue: email } } });
const jres = (status, body) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  resetTokenCache(); calls = []; failProfileWrite = false; authUsers = new Map([["boss@x.com", "u-super"]]);
  db = new Map([["users/u-super", prof("SUPER_ADMIN", true, "boss@x.com")], ["users/u-super2", prof("SUPER_ADMIN", true, "boss2@x.com")], ["users/u-user", prof("USER", true, "user@x.com")],
    ["users/u-inactive", prof("SUPER_ADMIN", false, "i@x.com")], ["users/u-off", prof("SUPER_ADMIN", true, "off@x.com")]]);
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), body = init.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init.body;
    calls.push({ u, method: init.method ?? "GET", body });
    if (u.includes("oauth2.googleapis.com")) return jres(200, { access_token: "svc", expires_in: 3600 });
    if (u.includes("accounts:lookup")) { const t = tokens[body.idToken]; return t ? jres(200, { users: [{ localId: t.uid, email: t.email, disabled: t.disabled }] }) : jres(400, { error: { message: "INVALID_ID_TOKEN" } }); }
    if (u.includes(":runQuery")) return jres(200, [...db.entries()].filter(([k, v]) => k.startsWith("users/") && v.fields.role.stringValue === "SUPER_ADMIN" && v.fields.isActive.booleanValue).map(([k]) => ({ document: { name: k } })));
    if (u.endsWith("/accounts") && init.method === "POST") { if (authUsers.has(body.email)) return jres(400, { error: { message: "EMAIL_EXISTS" } }); const id = `uid-${authUsers.size + 1}`; authUsers.set(body.email, id); return jres(200, { localId: id }); }
    if (u.includes("accounts:delete")) { for (const [e, id] of authUsers) if (id === body.localId) authUsers.delete(e); return jres(200, {}); }
    if (u.includes("accounts:update") || u.includes("accounts:sendOobCode")) return jres(200, { oobLink: "https://proj.firebaseapp.com/__/auth/action?oobCode=abc" });
    const m = /documents\/(users\/[^?]+|activityLog)/.exec(u);
    if (m && (init.method ?? "GET") === "GET") { const d = db.get(decodeURIComponent(m[1])); return d ? jres(200, d) : jres(404, {}); }
    if (m && init.method === "PATCH") { if (failProfileWrite) return jres(500, { error: { message: "INTERNAL" } }); db.set(decodeURIComponent(m[1]), body); return jres(200, {}); }
    if (m && init.method === "POST") return jres(200, {});
    return jres(404, {});
  };
});
const req = (handler, token, body, method = "POST") => handler(new Request("https://app/api", { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: method === "POST" ? JSON.stringify(body ?? {}) : undefined }), env);
const newUser = { fullName: "Mona Ali", email: "Mona@Example.com ", role: "USER" };
const stored = (id) => Object.fromEntries(Object.entries(db.get(`users/${id}`).fields).map(([k, v]) => [k, Object.values(v)[0]]));

test("13/14. an active Super Admin creates a SUPER_ADMIN; profile is keyed by the Auth UID with the server-validated role", async () => {
  const r = await req(createUser, "tok-super", { ...newUser, role: "SUPER_ADMIN" });
  assert.equal(r.status, 201); const j = await r.json();
  assert.equal(j.role, "SUPER_ADMIN"); assert.equal(j.email, "mona@example.com"); assert.match(j.setupLink, /oobCode/);
  assert.deepEqual([stored(j.uid).role, stored(j.uid).isActive, stored(j.uid).uid, stored(j.uid).createdBy], ["SUPER_ADMIN", true, j.uid, "u-super"]);
});
test("15. a Super Admin creates regular USER accounts (also inactive ones)", async () => {
  const a = await (await req(createUser, "tok-super", newUser)).json(); assert.equal(stored(a.uid).role, "USER");
  const b = await (await req(createUser, "tok-super", { ...newUser, email: "x@y.com", isActive: false })).json();
  assert.equal(stored(b.uid).isActive, false); assert.ok(calls.some((c) => c.u.endsWith("/accounts") && c.body.disabled === true));
});
test("16/17. regular users, users without a profile, inactive or disabled admins, and anonymous callers are rejected on EVERY endpoint", async () => {
  for (const h of [createUser, updateUser, setupLink]) {
    assert.equal((await req(h, "tok-user", { ...newUser, uid: "u-super", role: "USER" })).status, 403);
    assert.equal((await req(h, "tok-noprofile", newUser)).status, 403);
    assert.equal((await req(h, "tok-inactive", newUser)).status, 403);
    assert.equal((await req(h, "tok-off", newUser)).status, 403);
    assert.equal((await req(h, "bad-token", newUser)).status, 401);
    assert.equal((await req(h, null, newUser)).status, 401);
    assert.equal((await req(h, "tok-super", {}, "GET")).status, 405);
  }
  assert.ok(!calls.some((c) => c.u.endsWith("/accounts") && c.method === "POST" && c.body?.email)); // no account was ever created
});
test("19. a regular user cannot promote themselves through the API", async () => {
  assert.equal((await req(updateUser, "tok-user", { uid: "u-user", role: "SUPER_ADMIN" })).status, 403); assert.equal(stored("u-user").role, "USER");
});
test("the role sent by the browser is never trusted: invalid roles / escalation attempts are rejected", async () => {
  for (const role of ["ADMIN", "super_admin", "", null, 1, ["SUPER_ADMIN"]]) assert.equal((await req(createUser, "tok-super", { ...newUser, role })).status, 400);
  assert.equal((await req(createUser, "tok-super", { ...newUser, role: "USER", isSuperAdmin: true })).status, 201);
  assert.equal(stored("uid-2").role, "USER");
});
test("validation: names, emails, oversized and malformed bodies", async () => {
  for (const bad of [{ ...newUser, email: "nope" }, { ...newUser, email: "a@b" }, { ...newUser, fullName: "x" }, { ...newUser, isActive: "yes" }, {}]) assert.equal((await req(createUser, "tok-super", bad)).status, 400);
  assert.equal((await createUser(new Request("https://a/api", { method: "POST", headers: { authorization: "Bearer tok-super" }, body: "{bad" }), env)).status, 400);
  assert.equal((await createUser(new Request("https://a/api", { method: "POST", headers: { authorization: "Bearer tok-super" }, body: JSON.stringify({ x: "a".repeat(5000) }) }), env)).status, 413);
  assert.equal(validateCreate({ ...newUser, email: "a@b.co" }).ok, true);
});
test("21. a duplicate email is rejected safely and nothing is written", async () => {
  const before = db.size; const r = await req(createUser, "tok-super", { ...newUser, email: "boss@x.com" });
  assert.equal(r.status, 409); assert.deepEqual(await r.json(), { error: "email_exists" }); assert.equal(db.size, before);
});
test("partial failure: if the profile cannot be saved the Auth account is rolled back", async () => {
  failProfileWrite = true; const r = await req(createUser, "tok-super", newUser); const j = await r.json();
  assert.equal(r.status, 500); assert.equal(j.rolledBack, true); assert.equal(authUsers.has("mona@example.com"), false); assert.ok(calls.some((c) => c.u.includes("accounts:delete")));
});
test("responses never contain passwords or secrets", async () => {
  const text = await (await req(createUser, "tok-super", newUser)).text();
  assert.ok(!/password|private_key|service|FIREBASE_/i.test(text));
  assert.ok(!calls.some((c) => c.u.endsWith("/accounts") && c.body && "password" in c.body)); // accounts are created WITHOUT a password
});
test("22. the last active Super Admin cannot be disabled or demoted; with two it can", async () => {
  db.delete("users/u-super2"); db.delete("users/u-off"); db.delete("users/u-inactive"); // only u-super remains active
  for (const change of [{ isActive: false }, { role: "USER" }]) { const r = await req(updateUser, "tok-super", { uid: "u-super", ...change }); assert.equal(r.status, 409); assert.deepEqual(await r.json(), { error: "last_super_admin" }); }
  assert.deepEqual([stored("u-super").role, stored("u-super").isActive], ["SUPER_ADMIN", true]);
});
test("a Super Admin can disable another one when a second active one remains; sessions are revoked", async () => {
  const r = await req(updateUser, "tok-super", { uid: "u-super2", isActive: false }); assert.equal(r.status, 200);
  assert.equal(stored("u-super2").isActive, false);
  const upd = calls.find((c) => c.u.includes("accounts:update")); assert.equal(upd.body.disableUser, true); assert.ok(upd.body.validSince);
});
test("role changes by a Super Admin work and are written with a field mask (nothing else is overwritten)", async () => {
  const r = await req(updateUser, "tok-super", { uid: "u-user", role: "SUPER_ADMIN" }); assert.equal(r.status, 200); assert.equal(stored("u-user").role, "SUPER_ADMIN");
  assert.ok(calls.find((c) => c.method === "PATCH").u.includes("updateMask.fieldPaths=role"));
  assert.equal((await req(updateUser, "tok-super", { uid: "nobody-123", role: "USER" })).status, 404);
});
test("setup link endpoint returns a fresh link only to Super Admins", async () => {
  const r = await req(setupLink, "tok-super", { uid: "u-user" }); assert.equal(r.status, 200); assert.match((await r.json()).setupLink, /oobCode/);
});
test("last-super-admin guard (pure)", () => {
  assert.equal(removesLastSuperAdmin({ role: "SUPER_ADMIN", isActive: true }, { isActive: false }, 1), true);
  assert.equal(removesLastSuperAdmin({ role: "SUPER_ADMIN", isActive: true }, { isActive: false }, 2), false);
  assert.equal(removesLastSuperAdmin({ role: "USER", isActive: true }, { isActive: false }, 1), false);
  assert.equal(removesLastSuperAdmin({ role: "SUPER_ADMIN", isActive: true }, { role: "SUPER_ADMIN" }, 1), false);
});
