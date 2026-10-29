import {
  getDatabase,
  isValidId,
  json,
  methodNotAllowed,
  readJsonObject,
  requireApiToken,
  validateStatusInput
} from "../../_lib/http.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!["PATCH", "DELETE"].includes(request.method)) {
    return methodNotAllowed(["PATCH", "DELETE"]);
  }

  const authError = await requireApiToken(request, env);
  if (authError) return authError;

  const db = getDatabase(env);
  if (!db) return json({ error: "database_not_configured" }, 503);

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
        "UPDATE aliases SET status = ?, updated_at = ? WHERE id = ?"
      ).bind(validated.value.status, now, id).run();
      if (!result.meta || result.meta.changes === 0) return json({ error: "alias_not_found" }, 404);
      return json({ ok: true, id, status: validated.value.status, updated_at: now });
    } catch {
      return json({ error: "database_error" }, 500);
    }
  }

  try {
    const result = await db.prepare("DELETE FROM aliases WHERE id = ?").bind(id).run();
    if (!result.meta || result.meta.changes === 0) return json({ error: "alias_not_found" }, 404);
    return json({ ok: true, id, deleted: true });
  } catch {
    return json({ error: "database_error" }, 500);
  }
}
