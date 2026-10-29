# APA test prototype — security review findings

**Review date:** 2026-10-29  
**Scope:** experimental branch `feat/cloudflare-d1-api-tests` and the user-reported test Worker `apa-test-api`.  
**Not a production approval:** this is a source-level review and reconciliation checklist, not a penetration test or independent verification of the deployed Worker. No production resources or real data were accessed.

## Findings

### P1 — Worker runtime compatibility: branch setting aligned; runtime still needs independent verification

**Evidence:** the branch originally used `PBKDF2_ITERATIONS = 310_000`, matching the reported failure. The reconciliation commit changed the *test branch only* to 100,000 iterations, added a regression assertion for the stored count, and added a test-only comment. The deployed Worker test report says the same setting fixed registration/login.

**Impact:** the source-level mismatch is addressed in the branch, but the assistant did not independently deploy or run the remote suite. Runtime behavior must still be confirmed with the opt-in remote test and the exact deployed source.

**Required action:** keep this value explicitly test-only. Do not infer that 100,000 iterations is production-approved or equivalent in security to 310,000.

### P2 — The test Worker is internet-reachable and must be treated as an exposed test surface

**Evidence:** the Worker has a public `workers.dev` URL. The user reports that it is not connected to the public site and its D1 binding targets only `apa-test-db`.

**Impact:** third parties can still send requests to the Worker. CORS does not prevent non-browser clients from calling it. Test-only username prefixes and caps reduce accidental data growth but are not authentication or a complete abuse defense.

**Required action:** keep synthetic data only, monitor usage, avoid real credentials, and disable the Worker when no longer needed. Do not connect the public UI or any production database.

### P2 — Registration still needs an abuse-control review

**Evidence:** the branch now checks duplicate usernames and a 20-user cap before PBKDF2, and caps each user's aliases at 25. It also requires usernames to begin with `test-`. Registration still has no dedicated per-IP rate limit, and the branch cap counts all users in its bound database.

**Impact:** the checks reduce accidental test-data growth and avoid expensive derivation for duplicate/full-cap requests, but a public endpoint can still receive repeated unique test registrations up to the cap and consume CPU.

**Required action:** keep the Worker isolated and synthetic-only. Before any broader exposure, review registration throttling and abuse monitoring. Do not treat test-only caps as production account policy.

### P3 — Test-only account and alias caps are not concurrency-atomic

**Evidence:** the 20-user and 25-alias limits are checked with `COUNT(*)` before the corresponding insert; the check and insert are not wrapped in a transaction.

**Impact:** simultaneous requests could both pass a cap check and exceed the intended limit by a small amount. This is acceptable only as a test-data guardrail, not as a strict quota.

**Required action:** do not rely on these caps as a production abuse control. If strict quotas are ever needed, implement a concurrency-safe design and test it against the target runtime.

### P2 — Lockout policy permits username-bucket denial of service

**Evidence:** login throttling uses both a hashed client-IP bucket and a hashed username bucket; 10 failures trigger a 15-minute block. The user confirmed the correct password is also blocked during that window.

**Impact:** this is consistent with the current design but can temporarily deny a test account if another party deliberately submits failed logins for its username.

**Required action:** retain as a documented prototype trade-off. Before production, review account lockout, recovery, monitoring and abuse controls; do not remove the limit without a replacement control.

### P2 — Cross-origin browser behavior is not identical between the two implementations

**Evidence:** the branch has now been changed to match the test Worker’s development-origin allowlist, CORS credential headers, and `SameSite=None` cookie attributes. This makes local cross-origin browser testing possible; the allowlist still does not protect against non-browser callers.

**Impact:** the two implementations are closer, but browser cookie policy can still block third-party cookies. `SameSite=None` increases cross-site cookie exposure and requires careful CSRF/origin enforcement. A CORS allowlist is not authentication and does not replace authorization checks.

**Required action:** keep these cross-origin settings confined to the test prototype. The local automated tests now cover preflight and allowed-origin headers, but remote/browser behavior still needs verification. Do not copy `SameSite=None` or development-origin allowlists into production without a dedicated CSRF and cookie-policy review.

### P3 — User-reported remote results are not yet independently reproducible from repository evidence

**Evidence:** the test results are documented from the user's report; no raw response transcript or machine-readable run artifact is checked in. The new opt-in remote suite only exercises non-destructive smoke checks and does not create accounts or aliases.

**Impact:** the results are useful evidence but do not yet provide a repeatable artifact for the authenticated end-to-end flow.

**Required action:** record the opt-in smoke test result and, for authenticated tests, use an explicit manual test plan with unique synthetic fixtures and a verified cleanup strategy. Never delete the existing synthetic fixtures or the legacy alias.

## Controls that are present in the inspected branch

- Alias queries and mutations include the authenticated user's `owner_id`.
- Session tokens are random; only token hashes are stored; sessions have expiration and user foreign keys.
- Cookies are marked `HttpOnly`, `Secure`, and `SameSite=None` in the experimental branch to support the reported cross-origin test topology; this is test-only and not a production recommendation.
- Input JSON is size-limited and validated; SQL uses bound parameters.
- API errors generally avoid returning raw SQL error details.
- Login throttling stores hashed IP/username bucket keys and removes stale buckets.

These are positive implementation observations, not proof that all attack paths are covered.

## Out of scope / gates

- No production deployment, public-site integration, real user data, secret creation, paid service, or remote D1 migration is approved by this review.
- No destructive D1 tests were run.
- No independent penetration test, dependency audit, backup/restore test or full browser cookie matrix was performed.
- PR #1 must remain a draft and must not be merged without separate explicit authorization.
