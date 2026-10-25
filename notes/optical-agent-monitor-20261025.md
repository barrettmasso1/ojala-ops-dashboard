# Same-agent optical health and uncertain receipt regressions

Optional opticalPickup health is read by the existing unified agent, not a second
application. Missing/stale health, thermal/load pauses, auth/receipt holds, wrong
business dates and stopped service remain visible. No processed recording window
means unknown (null), not zero delivered cups. Coverage remains partial.

55 local optical tests and 66 agent-monitor tests pass. Transport tests cover
three revisions, uncertain-write readback, restart recovery, wrong tenant/hash,
forbidden manual/external-AI receipt claims and authorization hold without blind
replay. All tests use isolated fixtures. No source image, POS, manual or certified
count data are written by tests. The existing <=83 C guard is not weakened.
