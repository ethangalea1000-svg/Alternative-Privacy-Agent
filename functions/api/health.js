import { json, methodNotAllowed } from "../_lib/http.js";

export function onRequest(context) {
  if (context.request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }
  // Intentionally disclose no bindings, secrets, versions, or database details.
  return json({ ok: true, service: "apa-api" });
}
