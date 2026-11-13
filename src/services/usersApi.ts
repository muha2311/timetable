import { auth } from "./firebase/init";

export class ApiError extends Error {
  code: string; status: number; fields: string[];
  constructor(code: string, status: number, fields: string[] = []) { super(code); this.code = code; this.status = status; this.fields = fields; }
}
/** Calls the Cloudflare Pages Function with the signed-in user's ID token. The server decides what that user may do. */
async function api<T>(path: string, body: unknown): Promise<T> {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new ApiError("unauthenticated", 401);
  let res: Response;
  try { res = await fetch(path, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw new ApiError("network", 0); }
  const j = (await res.json().catch(() => ({}))) as { error?: string; fields?: string[] };
  if (!res.ok) throw new ApiError(j.error ?? "error", res.status, j.fields);
  return j as T;
}
export interface CreatedUser { uid: string; email: string; fullName: string; role: "SUPER_ADMIN" | "USER"; isActive: boolean; setupLink: string | null }
export const createUserApi = (v: { fullName: string; email: string; role: string; isActive: boolean }) => api<CreatedUser>("/api/users", v);
export const updateUserApi = (v: { uid: string; role?: string; isActive?: boolean }) => api<{ uid: string; role: string; isActive: boolean }>("/api/users/update", v);
export const setupLinkApi = (uid: string) => api<{ setupLink: string }>("/api/users/link", { uid });
