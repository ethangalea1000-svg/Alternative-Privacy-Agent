# APA test prototype — security review findings

**Review date:** 2026-10-29  
**Scope:** experimental branch `feat/cloudflare-d1-api-tests` and the user-reported test Worker `apa-test-api`.  
**Not a production approval:** this is a source-level review and reconciliation checklist, not a penetration test or independent verification of the deployed Worker. No production resources or real data were accessed.

## Findings

### P1 — Worker runtime compatibility is not yet reconciled with the branch

**Evidence:** `functions/_lib/auth.js` still sets `PBKDF2_ITERATIONS = 310_000`. Both registration (`createPasswordRecord`) and the fallback derivation for an unknown/malformed user can invoke this iteration count. The reported deployed Worker rejected 310,000 iterations because WebCrypto in that runtime supports at most 100,000.

**Impact:** the branch implementation is not equivalent to the tested Worker. In a compatible-looking deployment, registration and some login paths may fail before reaching the expected API response.

**Required action:** during the explicit Worker/branch reconciliation step, align the *test branch only* with the verified 100,000-iteration test setting, add a regression assertion for the stored iteration count, and clearly mark it as test-only. Do not infer that 100,000 iterations is production-approved.

### P2 — The test Worker is internet-reachable and must be treated as an exposed test surface

**Evidence:** the Worker has a public `workers.dev` URL. The user reports that it is not connected to the public site and its D1 binding targets only `apa-test-db`.

**Impact:** third parties can still send requests to the Worker. CORS does not prevent non-browser clients from calling it. Test-only username prefixes and caps reduce accidental data growth but are not authentication or a complete abuse defense.

**Required action:** keep synthetic data only, monitor usage, avoid real credentials, and disable the Worker when no longer needed. Do not connect the public UI or any production database.

### P2 — Registration can be an expensive unauthenticated operation

**Evidence:** in the branch, `createPasswordRecord(password)` is performed before the `try` block and before checking whether the username already exists. Registration has input validation but no equivalent of the login rate-limit buckets in the inspected handler.

**Impact:** repeated registration attempts, including attempts with duplicate usernames, can consume CPU in password derivation and may produce uncaught runtime errors on incompatible runtimes.

**Required action:** before any broader exposure, validate runtime compatibility, consider throttling registration, and avoid doing expensive derivation before cheap duplicate checks where race-safe handling permits. Keep any test-only restriction separate from a production policy decision.

### P2 — Lockout policy permits username-bucket denial of service

**Evidence:** login throttling uses both a hashed client-IP bucket and a hashed username bucket; 10 failures trigger a 15-minute block. The user confirmed the correct password is also blocked during that window.

**Impact:** this is consistent with the current design but can temporarily deny a test account if another party deliberately submits failed logins for its username.

**Required action:** retain as a documented prototype trade-off. Before production, review account lockout, recovery, monitoring and abuse controls; do not remove the limit without a replacement control.

### P2 — Cross-origin browser behavior is not identical between the two implementations

**Evidence:** the Pages Functions branch uses strict same-origin checks (`Origin` must equal the request URL origin) and `SameSite=Lax`; the reported standalone test Worker uses an allowlist for development origins and cross-origin cookie behavior.

**Impact:** a browser test that succeeds against one implementation may fail against the other because of CORS, cookie policy or origin validation. A CORS allowlist is not authentication and does not replace authorization checks.

**Required action:** choose and document the intended test topology. Verify preflight, allowed/disallowed origins, credentials, cookie attributes and CSRF protections against the actual deployed Worker. Do not silently copy cross-origin settings into a future production configuration.

### P3 — User-reported remote results are not yet independently reproducible from repository evidence

**Evidence:** the test results are documented from the user's report; no raw response transcript or machine-readable run artifact is checked in. The new opt-in remote suite only exercises non-destructive smoke checks and does not create accounts or aliases.

**Impact:** the results are useful evidence but do not yet provide a repeatable artifact for the authenticated end-to-end flow.

**Required action:** record the opt-in smoke test result and, for authenticated tests, use an explicit manual test plan with unique synthetic fixtures and a verified cleanup strategy. Never delete the existing synthetic fixtures or the legacy alias.

## Controls that are present in the inspected branch

- Alias queries and mutations include the authenticated user's `owner_id`.
- Session tokens are random; only token hashes are stored; sessions have expiration and user foreign keys.
- Cookies are marked `HttpOnly`, `Secure`, and `SameSite=Lax` in the Pages branch.
- Input JSON is size-limited and validated; SQL uses bound parameters.
- API errors generally avoid returning raw SQL error details.
- Login throttling stores hashed IP/username bucket keys and removes stale buckets.

These are positive implementation observations, not proof that all attack paths are covered.

## Out of scope / gates

- No production deployment, public-site integration, real user data, secret creation, paid service, or remote D1 migration is approved by this review.
- No destructive D1 tests were run.
- No independent penetration test, dependency audit, backup/restore test or full browser cookie matrix was performed.
- PR #1 must remain a draft and must not be merged without separate explicit authorization.
