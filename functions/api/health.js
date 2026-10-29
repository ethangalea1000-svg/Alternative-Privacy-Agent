import { json, methodNotAllowed, getDatabase } from "../_lib/http.js";

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const db = getDatabase(context.env);
  if (!db) return json({ ok: false, service: "apa-api", database: "unavailable" }, 503);

  try {
    const result = await db.prepare("SELECT 1 AS ok").first();
    if (Number(result?.ok) !== 1) {
      return json({ ok: false, service: "apa-api", database: "unavailable" }, 503);
    }
    return json({ ok: true, service: "apa-api", database: "ok" });
  } catch {
    return json({ ok: false, service: "apa-api", database: "unavailable" }, 503);
  }
}
