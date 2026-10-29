const CATEGORIES = new Set(["achats", "projets", "public", "personnel"]);
const STATUSES = new Set(["planned", "active", "paused"]);
const MAX_BODY_BYTES = 4096;
const ALLOWED_TEST_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);

export function isAllowedOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.origin === new URL(request.url).origin) return true;
    return ALLOWED_TEST_ORIGINS.has(parsed.origin);
  } catch {
    return false;
  }
}

export function corsHeaders(request) {
  const origin = request.headers.get("origin");
  if (!origin || !isAllowedOrigin(request)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}

export function withCors(response, request) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(request))) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function testOriginError(request) {
  return isAllowedOrigin(request) ? null : json({ error: "test_origin_not_allowed" }, 403);
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "cross-origin-resource-policy": "cross-origin",
      "cross-origin-opener-policy": "same-origin",
      "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "strict-transport-security": "max-age=31536000",
      ...extraHeaders
    }
  });
}

export function methodNotAllowed(allowed) {
  return json({ error: "method_not_allowed", allowed }, 405, { allow: allowed.join(", ") });
}

export function isValidCategory(value) {
  return typeof value === "string" && CATEGORIES.has(value);
}

export function isValidStatus(value) {
  return typeof value === "string" && STATUSES.has(value);
}

function hasControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export async function readJsonObject(request) {
  const contentType = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return { error: json({ error: "content_type_must_be_application_json" }, 415) };
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      return { error: json({ error: "invalid_content_length" }, 400) };
    }
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length)) {
      return { error: json({ error: "invalid_content_length" }, 400) };
    }
    if (length > MAX_BODY_BYTES) {
      return { error: json({ error: "request_body_too_large" }, 413) };
    }
  }

  // Enforce the byte limit while reading, not after buffering an unbounded body.
  const chunks = [];
  let totalBytes = 0;
  if (request.body) {
    const reader = request.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_BODY_BYTES) {
          await reader.cancel("request body too large").catch(() => {});
          return { error: json({ error: "request_body_too_large" }, 413) };
        }
        chunks.push(value);
      }
    } catch {
      return { error: json({ error: "invalid_request_body" }, 400) };
    } finally {
      reader.releaseLock();
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { error: json({ error: "invalid_request_body_encoding" }, 400) };
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: json({ error: "invalid_json" }, 400) };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: json({ error: "json_object_required" }, 400) };
  }
  return { value };
}

export function validateAliasInput(value) {
  if (
    typeof value.name !== "string" ||
    !/^test-[a-z0-9][a-z0-9 _-]{0,41}$/i.test(value.name.trim())
  ) {
    return { error: "test_alias_name_required" };
  }
  if (!isValidCategory(value.category)) {
    return { error: "invalid_category" };
  }
  const status = value.status === undefined ? "planned" : value.status;
  if (!isValidStatus(status)) {
    return { error: "invalid_status" };
  }
  return {
    value: {
      name: value.name.trim(),
      category: value.category,
      status
    }
  };
}

export function validateStatusInput(value) {
  if (!isValidStatus(value.status)) return { error: "invalid_status" };
  return { value: value.status };
}

export function getDatabase(env) {
  if (!env?.DB || typeof env.DB.prepare !== "function") return null;
  return env.DB;
}

export function newId() {
  return crypto.randomUUID();
}

export function newInternalLabel(name) {
  const slug = name.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30) || "alias";
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return slug + "-" + suffix;
}

export function isValidId(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
