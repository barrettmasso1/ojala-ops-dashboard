# Reconciliation tab validation notes

- Initial preview of `/dashboard` surfaced a React hook-order error on `ManagerDashboard` after the reconciliation work landed.
- The dashboard source was updated to remove the late `useMemo` call that had been introduced after an early return path.
- Focused Vitest coverage still passed after the fix.
- The browser preview continued to show the older hook stack trace with an earlier timestamp, so the next step is a hard refresh / clean navigation to confirm the fresh bundle is now rendering correctly.

The refreshed preview is now rendering again, and the dedicated **Reconciliation** tab is visible in the manager inventory switcher. The tab opens the new formula summaries and secondary gelato-versus-packaging breakdown tabs, which confirms the comparison view is now separated from the standard product inventory table instead of relying on the overly wide report tables alone.
