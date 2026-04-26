# Mobile Staff Login Validation — 2026-04-25

The shared staff login flow was rechecked on mobile-sized layouts and clean-session paths during the recent access fixes. The staff entry page remained reachable on the published domain, the shared password flow successfully routed employees into the intended portal opening path, and the visible sign-out action made it possible to switch sessions cleanly between staff and manager validation passes.

| Area checked | Result | Notes |
|---|---|---|
| `/staff-login` load on mobile-sized layout | Pass | The page remained readable and reachable without exposing manager-only dashboard controls. |
| Shared staff password sign-in | Pass | Successful sign-in landed on `/portal/opening` rather than the manager dashboard. |
| Staff sign-out control | Pass | The visible sign-out action allowed clean session resets for repeated validation. |
| Manager entry separation | Pass in current build | The updated manager login flow now preserves the dashboard return path in the current production candidate; the live published site still requires a fresh publish to expose that fix. |

The remaining practical note is not a responsive problem but a deployment state issue: the current checkpoint contains the manager login redirect fix, while the already published domain will keep showing the older behavior until the new checkpoint is published.
