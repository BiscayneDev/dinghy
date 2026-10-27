# Server-enforced session expiry release gate

This is a separate fix for signed `dock_session` cookies previously remaining server-valid indefinitely. Existing source already sets browser `maxAge` to seven days, so new server expiry uses that same duration rather than inventing a new policy.

## Behavior

New cookies are HMAC-SHA256 signed version 2 envelopes with integer `iat` and `exp`. They expire server-side after at most seven days. Invalid types, unknown/partial versions, noninteger identifiers, expired, excessive-lifetime, or future-issued claims (over 60 seconds clock skew) are rejected before user lookup. Passive `getSession` does not refresh a cookie. Fresh successful authentication through existing `setSession` deliberately starts a new seven-day session. Existing user-existence checks remain.

Old signed cookies have no issue time. An automatic rolling grace period would preserve the vulnerability. They are accepted only under TWO explicit operator-set Unix second timestamps:

- `SESSION_LEGACY_WINDOW_START_SECONDS`: the fixed authorized rollout start.
- `SESSION_LEGACY_CUTOFF_SECONDS`: a fixed retirement deadline, after start and no more than seven days later.

Both timestamps must be valid integers. A future start beyond 60 seconds is refused. No dates or activation values are committed here. Missing/invalid configuration refuses legacy cookies. Once cutoff is reached, old cookies require sign-in even after restart/redeploy. Never move this deadline forward as routine rollout or rollback work. Configuration access must be restricted like other authentication settings.

A pure helper supports an explicit future auth-route legacy upgrade, but no passive page read writes cookies. Any such upgrade is capped at the SAME fixed cutoff, not upgrade-time plus seven days. A version-2 cookie cannot be upgraded again by that helper. Leaving old-format cookies unmodified during the fixed grace window also preserves the signed-cookie hash used by the separate web OAuth-state fix.

## Approval and rollout order

DO NOT merge/deploy without approval of the exact fixed window and eventual reauthentication effect. Deploying without valid window settings would log out all old-format sessions immediately. Applying a window setting to old code does not fix the vulnerability; the enforcement code must be deployed too. No production values have been configured.

1. Owner approves exact fixed start/cutoff and expected sign-in requirement at cutoff. Confirm that the current deployment time falls inside the window.
2. Configure those fixed timestamps and deploy the reviewed code together. Preview configuration uses separate test-only values.
3. Verify controlled fresh sign-in, expiry/refusal and a synthetic signed old cookie under test-only credentials. Do not copy real user cookies or impersonate users.
4. At the fixed cutoff, verify old-format cookies are refused. Keep the same fixed cutoff on later deployments, or remove settings to continue refusing old format. Do not roll back to code accepting indefinite signed sessions as routine restoration.

Existing connected-provider tokens are unaffected. Users who sign in freshly get a full seven-day session. Users who never sign in again during grace will need to sign in after cutoff. Any earlier logout requirement is a separate decision.

## Verification

Focused tests cover signed timestamps/types/future skew, tampering, strict seven-day expiry, malformed/absent/excessive window configuration, same-cutoff legacy upgrade, no passive renewal, normal fresh authentication, user deletion, and existing login/magic-link/connect-token regressions. CI full typecheck/tests must pass on the exact merge head. This change has no database migration or dependency edit.
