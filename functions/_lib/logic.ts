export const ROLES = ["SUPER_ADMIN", "USER"] as const;
export type Role = (typeof ROLES)[number];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normalizeEmail = (v: unknown): string => String(v ?? "").trim().toLowerCase();
export interface CreateInput { fullName: string; email: string; role: Role; isActive: boolean }

/** The role is validated against the allowlist here; whatever the browser sends is never trusted beyond that. */
export function validateCreate(body: unknown): { ok: true; value: CreateInput } | { ok: false; fields: string[] } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fullName = String(b.fullName ?? "").trim(), email = normalizeEmail(b.email), fields: string[] = [];
  if (fullName.length < 2 || fullName.length > 100) fields.push("fullName");
  if (email.length > 254 || !EMAIL.test(email)) fields.push("email");
  if (!(ROLES as readonly unknown[]).includes(b.role)) fields.push("role");
  if (b.isActive !== undefined && typeof b.isActive !== "boolean") fields.push("isActive");
  return fields.length ? { ok: false, fields } : { ok: true, value: { fullName, email, role: b.role as Role, isActive: b.isActive !== false } };
}
export function validateUpdate(body: unknown): { ok: true; uid: string; role?: Role; isActive?: boolean } | { ok: false; fields: string[] } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>, fields: string[] = [];
  if (typeof b.uid !== "string" || !/^[A-Za-z0-9_-]{6,128}$/.test(b.uid)) fields.push("uid");
  if (b.role !== undefined && !(ROLES as readonly unknown[]).includes(b.role)) fields.push("role");
  if (b.isActive !== undefined && typeof b.isActive !== "boolean") fields.push("isActive");
  if (b.role === undefined && b.isActive === undefined) fields.push("change");
  return fields.length ? { ok: false, fields } : { ok: true, uid: b.uid as string, role: b.role as Role | undefined, isActive: b.isActive as boolean | undefined };
}
/** True when the change would leave the system without an active Super Admin. */
export function removesLastSuperAdmin(target: { role: string; isActive: boolean }, change: { role?: Role; isActive?: boolean }, activeSuperAdmins: number): boolean {
  const wasActiveSuper = target.role === "SUPER_ADMIN" && target.isActive;
  const stays = (change.role ?? target.role) === "SUPER_ADMIN" && (change.isActive ?? target.isActive);
  return wasActiveSuper && !stays && activeSuperAdmins <= 1;
}
