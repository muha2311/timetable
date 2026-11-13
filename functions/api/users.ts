import { createUser } from "../_lib/handlers.ts";
import type { Env } from "../_lib/google.ts";

export const onRequest = (ctx: { request: Request; env: Env }): Promise<Response> => createUser(ctx.request, ctx.env);
