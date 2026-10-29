import { json, methodNotAllowed, readJsonObject } from "../../_lib/http.js";
import {
  createSession, publicUser, sameOriginError, validateCredentials, verifyPassword
} from "../../_lib/auth.js";

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  const originError = sameOriginError(request);
  if (originError) return originError;

  const db = env?.DB;
  if (!db || typeof db.prepare !== "function") return json({ error: "database_not_configured" }, 503);
  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const validated = validateCredentials(parsed.value);
  if (validated.errors) return json({ error: "validation_failed", fields: validated.errors }, 400);

  const { username, password } = validated.value;
  try {
    const user = await db.prepare(
      "SELECT id, username, password_hash, password_salt, password_iterations, created_at FROM users WHERE username = ?"
    ).bind(username).first();

    const passwordMatches = await verifyPassword(password, user);
    if (!user || !passwordMatches) return json({ error: "invalid_credentials" }, 401);

    const session = await createSession(db, user.id);
    return json({ user: publicUser(user) }, 200, { "set-cookie": session.cookie });
  } catch {
    return json({ error: "database_error" }, 500);
  }
}
