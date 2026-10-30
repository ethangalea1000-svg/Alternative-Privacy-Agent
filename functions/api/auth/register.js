import { json, methodNotAllowed, readJsonObject } from "../../_lib/http.js";
import {
  createPasswordRecord, createSession, newUserId, publicUser,
  sameOriginError, sessionCookie, validateCredentials
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
  if (validated.error) return json({ error: validated.error }, 400);

  const { username, password } = validated.value;

  try {
    const existing = await db.prepare("SELECT id FROM users WHERE username = ?")
      .bind(username).first();
    if (existing) return json({ error: "username_unavailable" }, 409);

    const userCount = await db.prepare("SELECT COUNT(*) AS count FROM users").first();
    if (Number(userCount?.count) >= 20) {
      return json({ error: "test_user_limit_reached" }, 429);
    }

    // Cheap checks happen before PBKDF2 to limit avoidable CPU work on duplicates.
    const id = newUserId();
    const createdAt = new Date().toISOString();
    const passwordRecord = await createPasswordRecord(password);

    await db.prepare(
      "INSERT INTO users (id, username, password_hash, password_salt, password_iterations, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(id, username, passwordRecord.password_hash, passwordRecord.password_salt,
      passwordRecord.password_iterations, createdAt).run();

    const user = { id, username, created_at: createdAt };
    const session = await createSession(db, id);
    return json({ user: publicUser(user) }, 201, { "set-cookie": session.cookie });
  } catch (error) {
    const message = String(error?.message || "");
    if (/UNIQUE constraint failed: users\.username/i.test(message)) {
      return json({ error: "username_unavailable" }, 409);
    }
    return json({ error: "database_error" }, 500);
  }
}
