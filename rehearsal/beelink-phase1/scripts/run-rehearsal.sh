#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PACKAGE="$ROOT/rehearsal/beelink-phase1"
RESULTS="$PACKAGE/results/$(date -u +%Y%m%dT%H%M%SZ)"
DUMP=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump) DUMP="${2:?missing dump path}"; shift 2 ;;
    *) echo "Usage: $0 --dump /absolute/path/to/validated-backup" >&2; exit 64 ;;
  esac
done
[[ -n "$DUMP" && "$DUMP" = /* && -d "$DUMP" ]] || { echo "--dump must be an existing absolute local directory" >&2; exit 64; }
mkdir -p "$RESULTS"

# The only accepted target is this compose file, bound to loopback only.
docker compose -f "$PACKAGE/docker-compose.yml" up -d --wait
export DATABASE_URL="mysql://root@127.0.0.1:4000/ojala_phase1_rehearsal"
export REHEARSAL_DB_HOST="127.0.0.1"
export REHEARSAL_DB_PORT="4000"
export REHEARSAL_DB_USER="root"

node "$PACKAGE/scripts/restore-isolated.mjs" --dump "$DUMP" --reset > "$RESULTS/restore.json"

# A before audit is expected to exit 2 because it detects that Phase 1 has not
# yet added stores/storeId. Preserve the original JSON and its exit code.
set +e
node "$ROOT/scripts/audit-phase1.mjs" --from 2026-07-01 --to 2026-09-22 --output "$RESULTS/before-audit.json" > "$RESULTS/before-audit.stdout" 2> "$RESULTS/before-audit.stderr"
BEFORE_AUDIT_EXIT=$?
set -e
printf '%s\n' "$BEFORE_AUDIT_EXIT" > "$RESULTS/before-audit.exit-code"
[[ "$BEFORE_AUDIT_EXIT" == "0" || "$BEFORE_AUDIT_EXIT" == "2" ]] || { echo "Before audit failed unexpectedly" >&2; exit "$BEFORE_AUDIT_EXIT"; }
node "$PACKAGE/scripts/capture-row-fingerprints.mjs" --output "$RESULTS/before-row-fingerprints.json" > "$RESULTS/before-row-fingerprints.stdout"

node "$PACKAGE/scripts/migrate-isolated.mjs" > "$RESULTS/migration.json"
node "$ROOT/scripts/audit-phase1.mjs" --from 2026-07-01 --to 2026-09-22 --output "$RESULTS/after-audit.json" > "$RESULTS/after-audit.stdout" 2> "$RESULTS/after-audit.stderr"
node "$PACKAGE/scripts/verify-row-fingerprints.mjs" --before "$RESULTS/before-row-fingerprints.json" > "$RESULTS/row-preservation.json"

# Do not alter the existing verifier or hide a mismatch. Its output and status
# are evidence; the known pre-0012 Store 1 expectation mismatch is recorded.
set +e
node "$ROOT/scripts/verify-phase1-evidence.mjs" "$RESULTS/before-audit.json" "$RESULTS/after-audit.json" > "$RESULTS/evidence-verifier.json" 2> "$RESULTS/evidence-verifier.stderr"
EVIDENCE_EXIT=$?
set -e
printf '%s\n' "$EVIDENCE_EXIT" > "$RESULTS/evidence-verifier.exit-code"

node "$PACKAGE/scripts/run-tenant-fixtures.mjs" > "$RESULTS/tenant-fixtures.json"
printf '%s\n' "$RESULTS" > "$PACKAGE/results/latest-run-path.txt"
printf 'Rehearsal completed. Results: %s\n' "$RESULTS"
