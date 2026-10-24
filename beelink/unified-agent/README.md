# One Ojala product, one autonomous device agent

The product consists of one tenant-scoped web app/API and an unattended camera
agent. This is one customer service, not separate customer-facing subscriptions
for photos, classification, sales forms and reconciliation. Internal workers are
separated for fault isolation; one systemd target controls their lifecycle.
No ChatGPT session, Manus task, remote desktop connection or browser belongs in
the runtime delivery path. Development tools are not production dependencies.

`ojala-agent.target` groups the existing collector, native detection sync,
local reference classifier, native original-photo sync and health monitor.
Install only after a genuine original-photo receipt passes independent readback.
Do not replace working units with a second concurrent sender. Legacy sender
queues and authorization holds are preserved; browser-based delivery is disabled
only after the native acceptance check succeeds. Heavy state remains on the
UUID-verified external mount, minimum reserve 8 GiB.

`agent_health.py` checks actual heartbeats, service status, photo queue and native
receipts. A green detection ledger does not mean photos are delivered. Missing
or old components, authentication holds, unresolved receipts, rejected evidence
and heat produce explicit issues. It does not open windows, restart Frigate,
change thresholds, read secrets or upload anything. Commercial/counting readiness
is never inferred from worker liveness or software unit-test success.

`reconciliation_audit.py` independently compares actual same-store/day sources.
The manual closing is not relabeled an independent tally or Shopify. Camera
observations are not relabeled unique deliveries. Unknown capacity and service
mode remain unknown. Delta/relative difference require validated unique-cup
counts, complete coverage, exactly matching observed periods and real quantities.
A zero manual denominator never yields a percentage. Equal totals are not recall.

Commercial rollout prerequisites (not completed by this change): configured
merchant billing/price, automated tenant/device provisioning, tested deployment
and backups, supported detector licenses, physical cooling, validated object
identity counting and all requested container/service classes. No fees or payment
accounts are created by this module. Existing stores and historical data remain.
