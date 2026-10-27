# Public network and web OAuth security patch

## Source findings

- The authenticated playground proxy validated only literal private hostnames and followed redirects. Hostnames resolving privately and redirect chains bypassed that check.
- User-configured MCP discovery, initialization notification, and tool calls used unrestricted server-side fetch, including redirects.
- Legacy GitHub/Oura/WHOOP web callbacks accepted unbound or fixed state while storing tokens for the current logged-in user. The in-thread flows already used provider-bound one-use tokens and are retained.

This is source evidence, not a live exploit or evidence of data loss.

## Network behavior

A shared Node transport validates every DNS answer and every redirect, pins the actual socket lookup to the validated IP, keeps TLS verification against the original hostname, rejects caller Host/proxy headers, and avoids pooled sockets. Private/reserved IPv4, IPv6, mapped addresses and transition ranges are denied. Public HTTPS remains supported. MCP may explicitly use public HTTP for compatibility; HTTP is unencrypted, as before. HTTPS redirects may not downgrade to HTTP. The playground retains its HTTPS-only contract.

Same-origin redirects retain API credentials and bodies. Cross-origin redirects remove credentials, including custom header names. Redirects that preserve a body across origins are refused, since stripping headers does not protect sensitive JSON. Standard 301/302 POST and 303 conversion to GET is retained. Maximum five redirects, 30 seconds overall and 5 MiB response/decompressed body cap limit resource exhaustion. The previous playground already had a 30-second limit; MCP and response size were previously unbounded. Operators may raise response size with `PUBLIC_NETWORK_MAX_RESPONSE_BYTES` (up to 100 MiB) and duration with `PUBLIC_NETWORK_TIMEOUT_MS` (up to five minutes) for known requirements; invalid/unbounded values use the defaults. The playground retains its existing independent 30-second abort. These controls may reject large, slow or cross-origin-body MCP servers and must be assessed before activation. No actual customer connection inventory or content was accessed for this patch.

Tests mock DNS, HTTP and HTTPS. They make no private-address connections or live exploitation calls.

## OAuth deployment order

1. Review and apply `078_web_oauth_states.sql` with separate authorization, before deploying app code. It creates only a service-role-accessible table; browser roles have no access. Verify the next free migration number before applying.
2. Deploy the code. No dependency or lockfile changes are included here.
3. Start fresh legacy web GitHub/Oura/WHOOP connects to verify positive provider round trips in a controlled account. Pending old web flows will be refused and need restarting. Existing connected tokens and sessions are unchanged. In-thread state values continue to dispatch to the existing provider-bound token claims.

New state has 256 random bits, a browser-only HttpOnly/SameSite cookie, and a server row bound to user, signed-session hash and provider. Only a SHA-256 state hash is stored. An atomic DELETE RETURNING with expiry is the one-use claim before code exchange, so concurrent callbacks cannot both exchange. Failure after claim requires a fresh connect. Rows expire after ten minutes and indexed opportunistic cleanup runs on initiation. Idle expired rows can remain until the next initiation; there are no raw tokens in those rows. A missing/unavailable table fails closed and prevents affected web connects, so migration-first ordering matters. Browser cookies are deleted on callback. Expired state is refused even when a browser retains a cookie.

## Separate finding, not changed

Existing signed session cookies have no issued-at or expiry claim. A copied valid signature remains server-valid beyond browser maxAge. A bounded follow-up should issue HMAC-signed `iat`/`exp` claims on all new sessions with a seven-day server maximum, reject future/invalid timestamps, and retain old-format cookies only until one fixed deployment cutoff (deployment time plus seven days, never a rolling extension). Successfully read legacy sessions before that fixed cutoff can be upgraded once into the timestamped format, capped by the same fixed cutoff; passive reads must not extend their lifetime. After the cutoff, any remaining old cookie requires sign-in. This prevents a forever-legacy bypass and avoids immediate mass logout, but eventual reauthentication and the exact cutoff still need owner approval. No session expiry code is activated here. Rejecting legacy cookies immediately would log out existing users. This patch does not do that without approval.

## Verification limits

Focused tests include real PGlite execution of the migration, browser-role denial and single-use SQL, plus mocked route and transport tests. Full-project TypeScript check exceeded the local runner memory budget. Full CI/build remains required before merge. No production migration, deployment, access revocation, real OAuth exchange, or SSRF probe has been performed.
