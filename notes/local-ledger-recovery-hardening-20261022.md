# Local registry recovery hardening

Follow-up to PR39. A source false-positive update now supersedes a cached local
proof without losing the original archived image. A collector startup/day rollover
finalizes the already-recorded previous day; it does not invent missing history.

Native sync still never blindly repeats an uncertain write. Since the new server
contract is revision/hash idempotent and conditional-write protected, a replay can
be scheduled after TWO authenticated absence readbacks and a 120-second settling
period. Maximum three sends; authorization/edge denials remain held. A receipt
found on reconciliation never causes another send. Existing source rows and new
observations remain preserved while a previous write is unresolved.

92 Python tests PASS, including nine collector integration tests and three bounded
recovery tests. No new production request, camera/model/threshold changes, browser
operations, external AI, approved count writes, or original evidence deletion.
