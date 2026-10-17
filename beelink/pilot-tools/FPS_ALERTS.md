# Persistent handoff FPS alert

The existing one-minute guard now calls `fps_monitor.check_report` under its existing lock. Install `fps_monitor.py` next to `ojala_guard.py` in the Frigate config directory. Neither file changes camera geometry, model, recording settings or counts.

An incident opens when camera ingress or frame processing stays below 3 FPS for at least 300 seconds of consecutive telemetry. Missing samples, gaps over 90 seconds, reboot and backward clock changes reset the duration. `detection_fps` is deliberately excluded: low object inference demand is not a camera failure. Two healthy samples spanning at least 60 seconds close an incident. Scheduled shutdown is not an incident; manually running sessions are monitored.

A critical desktop notification is delivered through the owner's session bus, including under cron. `fps-alert-state.json` and `fps-alerts/*.json` preserve the incident and failed notification attempts. This is a Beelink desktop notification, not a configured phone/WhatsApp/email notification. Success means the desktop notification service accepted it, not that a person read it. Delivery failures retry on later guard runs. A crash immediately after notification and before persisting its outcome may repeat that notification (at-least-once).

Run `python3 -m unittest discover -s beelink/pilot-tools -p 'test_*.py'`. Installation on 2026-10-17 passed 32 tests, backed up the prior guard and verified a clearly labeled test notification. Production incident files are never synthesized for testing.

## Operational record rule

Every operating day, preserve physical closing weights, the manual tally and the POS report even if the website is unavailable. Use paper/notes and enter the real data in the dashboard within 12 hours of the physical closing time. Missing values remain missing; a later weight is not the previous night's closing weight. Camera evidence, AI approvals and reviewed physical-cup counts remain separate from sales and inventory. Weekend comparisons must use the same shift and identify coverage gaps.
