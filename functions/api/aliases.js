import {
  getDatabase,
  isValidCategory,
  isValidStatus,
  json,
  methodNotAllowed,
  newId,
  newInternalLabel,
  readJsonObject,
  requireApiToken,
  validateAliasInput
} from "../_lib/http.js";

const SELECT_FIELDS = "id, name, label, category, status, created_at, updated_at";

export async function onRequest(context) {
  const { request, env } = context;
  if (!["GET", "POST"].includes(request.method)) {
    return methodNotAllowed(["GET", "POST"]);
  }

  const authError = await requireApiToken(request, env);
  if (authError) return authError;

  const db = getDatabase(env);
  if (!db) return json({ error: "database_not_configured" }, 503);

  if (request.method === "GET") {
    const url = new URL(request.url);
    const category = url.searchParams.get("category");
    const status = url.searchParams.get("status");
    const limitValue = url.searchParams.get("limit");
    const limit = limitValue === null ? 50 : Number(limitValue);

    if (category !== null && !isValidCategory(category)) {
      return json({ error: "invalid_category" }, 400);
    }
    if (status !== null && !isValidStatus(status)) {
      return json({ error: "invalid_status" }, 400);
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return json({ error: "invalid_limit", allowed: "1..100" }, 400);
    }

    let sql = "SELECT " + SELECT_FIELDS + " FROM aliases";
    const conditions = [];
    const values = [];
    if (category !== null) {
      conditions.push("category = ?");
      values.push(category);
    }
    if (status !== null) {
      conditions.push("status = ?");
      values.push(status);
    }
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY created_at DESC LIMIT ?";
    values.push(limit);

    try {
      const statement = db.prepare(sql).bind(...values);
      const result = await statement.all();
      return json({ aliases: result.results || [] });
    } catch {
      return json({ error: "database_error" }, 500);
    }
  }

  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const validated = validateAliasInput(parsed.value);
  if (validated.errors) return json({ error: "validation_failed", fields: validated.errors }, 400);

  const now = new Date().toISOString();
  const id = newId();
  const label = newInternalLabel(validated.value.name);

  try {
    await db.prepare(
      "INSERT INTO aliases (id, name, label, category, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, validated.value.name, label, validated.value.category, validated.value.status, now, now).run();

    return json({
      alias: {
        id,
        name: validated.value.name,
        label,
        category: validated.value.category,
        status: validated.value.status,
        created_at: now,
        updated_at: now
      }
    }, 201);
  } catch (error) {
    // A collision is rare, but never return SQL errors or details to clients.
    const message = String(error?.message || "");
    if (/UNIQUE constraint failed: aliases\.(?:label|id)\b/i.test(message)) {
      return json({ error: "alias_conflict_retry" }, 409);
    }
    return json({ error: "database_error" }, 500);
  }
}
