const CATEGORIES = new Set(["achats", "projets", "public", "personnel"]);
const STATUSES = new Set(["planned", "active", "paused"]);
const MAX_BODY_BYTES = 4096;
const TOKEN_MIN_LENGTH = 32;
const TOKEN_MAX_LENGTH = 512;

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "cross-origin-resource-policy": "same-origin",
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

export async function requireApiToken(request, env) {
  const expected = typeof env?.APA_API_TOKEN === "string" ? env.APA_API_TOKEN : "";
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  const supplied = match?.[1] || "";

  // Fail closed when the deployment secret is missing, weak, or unreasonably large.
  if (expected.length < TOKEN_MIN_LENGTH || expected.length > TOKEN_MAX_LENGTH) {
    return json({ error: "service_not_configured" }, 503);
  }
  if (!match || supplied.length < TOKEN_MIN_LENGTH || supplied.length > TOKEN_MAX_LENGTH ||
      !(await constantTimeTokenMatch(supplied, expected))) {
    return json({ error: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
  }
  return null;
}

async function constantTimeTokenMatch(left, right) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right))
  ]);
  const first = new Uint8Array(a);
  const second = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first[index] ^ second[index];
  }
  return difference === 0;
}

export function isValidCategory(value) {
  return typeof value === "string" && CATEGORIES.has(value);
}

export function isValidStatus(value) {
  return typeof value === "string" && STATUSES.has(value);
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
  const errors = {};
  if (typeof value.name !== "string" || value.name.trim().length < 1 || value.name.trim().length > 48) {
    errors.name = "must_be_1_to_48_characters";
  }
  if (!isValidCategory(value.category)) {
    errors.category = "invalid_category";
  }
  if (value.status !== undefined && !isValidStatus(value.status)) {
    errors.status = "invalid_status";
  }
  if (Object.keys(errors).length) return { errors };
  return {
    value: {
      name: value.name.trim(),
      category: value.category,
      status: value.status || "planned"
    }
  };
}

export function validateStatusInput(value) {
  if (!isValidStatus(value.status)) return { errors: { status: "invalid_status" } };
  return { value: { status: value.status } };
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
