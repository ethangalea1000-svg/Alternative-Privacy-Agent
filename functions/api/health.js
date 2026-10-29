import { json } from "../_lib/http.js";

export function onRequestGet() {
  // Intentionally disclose no bindings, secrets, versions, or database details.
  return json({ ok: true, service: "apa-api" });
}

export function onRequest(context) {
  if (context.request.method === "GET" || context.request.method === "HEAD") {
    return context.next();
  }
  return new Response(JSON.stringify({ error: "method_not_allowed", allowed: ["GET", "HEAD"] }), {
    status: 405,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      allow: "GET, HEAD"
    }
  });
}
