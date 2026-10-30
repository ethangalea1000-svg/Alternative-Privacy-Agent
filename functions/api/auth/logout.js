import { json, getDatabase, methodNotAllowed } from "../../_lib/http.js";
import {
  expiredSessionCookie, revokeSession, sameOriginError
} from "../../_lib/auth.js";

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  const originError = sameOriginError(request);
  if (originError) return originError;

  const db = getDatabase(env);
  if (!db) return json({ error: "database_not_configured" }, 503);
  try {
    await revokeSession(request, db);
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "no-store",
        "set-cookie": expiredSessionCookie(),
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer"
      }
    });
  } catch {
    return json({ error: "database_error" }, 500);
  }
}
