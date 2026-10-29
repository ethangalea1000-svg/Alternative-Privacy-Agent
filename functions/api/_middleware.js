import { isAllowedOrigin, withCors, json } from "../_lib/http.js";

const SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000"
});

function applySecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method === "OPTIONS") {
    if (!isAllowedOrigin(request)) {
      return applySecurityHeaders(json({ error: "test_origin_not_allowed" }, 403));
    }
    return applySecurityHeaders(withCors(new Response(null, { status: 204 }), request));
  }

  const response = await context.next();
  return applySecurityHeaders(withCors(response, request));
}
