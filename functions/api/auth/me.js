import { json, methodNotAllowed } from "../../_lib/http.js";
import { publicUser, requireSession } from "../../_lib/auth.js";

export async function onRequest(context) {
  if (context.request.method !== "GET") return methodNotAllowed(["GET"]);
  const session = await requireSession(context.request, context.env);
  if (session.error) return session.error;
  return json({ user: publicUser(session.user) });
}
