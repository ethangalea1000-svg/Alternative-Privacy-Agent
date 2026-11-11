import { json, methodNotAllowed, readJsonObject } from "../../_lib/http.js";
import {
  createSession, publicUser, sameOriginError, validateCredentials, verifyPassword
} from "../../_lib/auth.js";
import { clearLoginFailures, loginRateLimitStatus, recordLoginFailure } from "../../_lib/login-rate-limit.js";

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
  if (validated.error) return json({ error: validated.error }, 400);

  const { username, password } = validated.value;
  try {
    const rateLimit = await loginRateLimitStatus(db, request, username);
    if (rateLimit.blocked) {
      return json({ error: "too_many_login_attempts", retry_after_seconds: rateLimit.retryAfter }, 429, {
        "retry-after": String(rateLimit.retryAfter)
      });
    }
    const user = await db.prepare(
      "SELECT id, username, password_hash, password_salt, password_iterations, created_at FROM users WHERE username = ?"
    ).bind(username).first();

    const passwordMatches = await verifyPassword(password, user);
    if (!user || !passwordMatches) {
      await recordLoginFailure(db, rateLimit.keys);
      return json({ error: "invalid_credentials" }, 401);
    }

    await clearLoginFailures(db, rateLimit.keys);
    const session = await createSession(db, user.id);
    return json({ user: publicUser(user) }, 200, { "set-cookie": session.cookie });
  } catch {
    return json({ error: "database_error" }, 500);
  }
}
