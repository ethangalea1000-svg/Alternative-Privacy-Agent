import { json } from "../_lib/http.js";

// Pages Functions catch-all: keep unknown API routes machine-readable like the test Worker.
export async function onRequest() {
  return json({ error: "not_found" }, 404);
}
