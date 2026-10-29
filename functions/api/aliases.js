import {
  isValidCategory,
  isValidStatus,
  json,
  methodNotAllowed,
  newId,
  newInternalLabel,
  readJsonObject,
  validateAliasInput
} from "../_lib/http.js";
import { requireSession, sameOriginError } from "../_lib/auth.js";

const SELECT_FIELDS = "id, name, label, category, status, created_at, updated_at";

export async function onRequest(context) {
  const { request } = context;
  if (!["GET", "POST"].includes(request.method)) {
    return methodNotAllowed(["GET", "POST"]);
  }

  if (request.method === "POST") {
    const originError = sameOriginError(request);
    if (originError) return originError;
  }
  const session = await requireSession(request, context.env);
  if (session.error) return session.error;
  const { db, user } = session;

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

    const conditions = ["owner_id = ?"];
    const values = [user.id];
    if (category !== null) {
      conditions.push("category = ?");
      values.push(category);
    }
    if (status !== null) {
      conditions.push("status = ?");
      values.push(status);
    }
    values.push(limit);
    const sql = "SELECT " + SELECT_FIELDS + " FROM aliases WHERE " +
      conditions.join(" AND ") + " ORDER BY created_at DESC LIMIT ?";

    try {
      const result = await db.prepare(sql).bind(...values).all();
      return json({ aliases: result.results || [] });
    } catch {
      return json({ error: "database_error" }, 500);
    }
  }

  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const validated = validateAliasInput(parsed.value);
  if (validated.error) return json({ error: validated.error }, 400);

  const now = new Date().toISOString();
  const id = newId();
  const label = newInternalLabel(validated.value.name);

  try {
    const ownedCount = await db.prepare("SELECT COUNT(*) AS count FROM aliases WHERE owner_id = ?")
      .bind(user.id).first();
    if (Number(ownedCount?.count) >= 25) {
      return json({ error: "test_alias_limit_reached" }, 429);
    }

    await db.prepare(
      "INSERT INTO aliases (id, name, label, category, status, created_at, updated_at, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, validated.value.name, label, validated.value.category, validated.value.status,
      now, now, user.id).run();

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
    const message = String(error?.message || "");
    if (/UNIQUE constraint failed: aliases\.(?:label|id)\b/i.test(message)) {
      return json({ error: "alias_conflict_retry" }, 409);
    }
    return json({ error: "database_error" }, 500);
  }
}
