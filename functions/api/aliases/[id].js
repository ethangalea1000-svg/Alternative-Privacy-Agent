import {
  isValidId,
  json,
  methodNotAllowed,
  readJsonObject,
  validateStatusInput
} from "../../_lib/http.js";
import { requireSession, sameOriginError } from "../../_lib/auth.js";

export async function onRequest(context) {
  const { request, params } = context;
  if (!["PATCH", "DELETE"].includes(request.method)) {
    return methodNotAllowed(["PATCH", "DELETE"]);
  }
  const originError = sameOriginError(request);
  if (originError) return originError;

  const session = await requireSession(request, context.env);
  if (session.error) return session.error;
  const { db, user } = session;

  const id = params?.id;
  if (!isValidId(id)) return json({ error: "invalid_alias_id" }, 400);

  if (request.method === "PATCH") {
    const parsed = await readJsonObject(request);
    if (parsed.error) return parsed.error;
    const validated = validateStatusInput(parsed.value);
    if (validated.errors) return json({ error: "validation_failed", fields: validated.errors }, 400);

    const now = new Date().toISOString();
    try {
      const result = await db.prepare(
        "UPDATE aliases SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ?"
      ).bind(validated.value.status, now, id, user.id).run();
      if (!result.meta || result.meta.changes === 0) return json({ error: "alias_not_found" }, 404);
      return json({ ok: true, id, status: validated.value.status, updated_at: now });
    } catch {
      return json({ error: "database_error" }, 500);
    }
  }

  try {
    const result = await db.prepare(
      "DELETE FROM aliases WHERE id = ? AND owner_id = ?"
    ).bind(id, user.id).run();
    if (!result.meta || result.meta.changes === 0) return json({ error: "alias_not_found" }, 404);
    return json({ ok: true, id, deleted: true });
  } catch {
    return json({ error: "database_error" }, 500);
  }
}
