# Ojala verified handoff visual sender (Beelink)

This package sends **only** still images from:

```text
/home/ojala/frigate/config/verified_snapshots/handoff/
```

> It does **not** read Frigate tracks, video, or any automatic/legacy snapshot location. It opens no listening port and does not make a database connection.

The sender keeps a durable local SQLite queue. A network failure, HTTP error, or a server response explicitly marked `retryable: true` is retried with exponential backoff. An ambiguous `pending_review` result marked `retryable: false` is delivered once and stays available for a manager instead of looping forever. Every image uses a deterministic `cupEventId` (or a sidecar-supplied `cup_event_id`), so retrying does not create another visual event for the same store/camera/event.

## Prerequisites

1. The reviewed application migrations **0012, 0013, and 0014** must be applied to the selected target database before enabling this sender. Do **not** point it at an environment where the visual-event route/table is absent.
2. The Frigate machine key must resolve server-side to Ojala Store 1. During the controlled legacy transition this can be the existing Ojala Frigate environment key; after managed credentials are provisioned, use the Store 1 managed Frigate machine key.
3. The existing Frigate cup-count sender must first be updated to include `sourceEventId` and `sourceEventAt` for absolute count snapshots. That remains a separate `frigate.submitCounts` contract.
4. Python 3.11+ is installed on the Beelink. No third-party Python package is required.

## Installation

```bash
sudo install -d -o ojala -g ojala -m 0750 /opt/ojala-handoff-visual-sender
sudo cp handoff_visual_sender.py /opt/ojala-handoff-visual-sender/
sudo chmod 0750 /opt/ojala-handoff-visual-sender/handoff_visual_sender.py

sudo install -d -o ojala -g ojala -m 0700 /var/lib/ojala-handoff-visual-sender
sudo install -m 0640 -o root -g ojala config.example.json /etc/ojala-handoff-visual-sender.json
sudoedit /etc/ojala-handoff-visual-sender.json
```

The configuration file stores the public HTTPS endpoint and the **name** of the key environment variable. It must never contain the API key itself.

Create the root-owned environment file:

```bash
sudo sh -c 'umask 077; cat > /etc/ojala-handoff-visual-sender.env'
# Add exactly one line locally; do not commit, paste into tickets, or log it:
# OJALA_FRIGATE_API_KEY=...
sudo chown root:ojala /etc/ojala-handoff-visual-sender.env
sudo chmod 0640 /etc/ojala-handoff-visual-sender.env
```

Install and enable the local timer:

```bash
sudo cp ojala-handoff-visual.service /etc/systemd/system/
sudo cp ojala-handoff-visual.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ojala-handoff-visual.timer
systemctl list-timers ojala-handoff-visual.timer
```

Run once without revealing the key:

```bash
sudo -u ojala /usr/bin/python3 /opt/ojala-handoff-visual-sender/handoff_visual_sender.py \
  --config /etc/ojala-handoff-visual-sender.json \
  --queue /var/lib/ojala-handoff-visual-sender/queue.sqlite3
```

The one-line JSON output contains aggregate counts only: `discovered`, `sent`, and `retry`. It never prints keys, data URLs, image bytes, or image paths.

## Snapshot and metadata contract

- Supported files: `.jpg`, `.jpeg`, `.png`, `.webp`, max **8 MB**.
- Default `cupEventId`: hash of the exact image bytes. This is stable across sender restarts and internet retries.
- Optional sidecar: `<image>.json` or `<image-stem>.json` containing `{ "cup_event_id": "..." }`. The ID must be at least 8 characters.
- Capture time: file modification time, sent as UTC `capturedAt`; business date is derived in `America/Mazatlan`.
- The server only accepts `cameraName: "handoff"` and resolves the store from the API key, never from the payload.

## Operational behavior

The server stores the image and durable visual record, then runs conservative image analysis. It verifies a visible person, a gelato cup, the handoff zone, and cup count visible in that **same image**. Lamps, arms, hands without a cup, reflections, and unrelated objects are discarded. Any low-confidence or ambiguous response is saved as `pending_review`.

The Manager **Handoff Review** queue allows a manager to approve or discard evidence. Those actions change only the evidence label. They do not increment a delivery, Frigate cup count, POS sale, inventory record, or revenue field.

## Troubleshooting

```bash
systemctl status ojala-handoff-visual.timer
journalctl -u ojala-handoff-visual.service --since '30 minutes ago'
```

The service intentionally logs only aggregate sender failures. Do not add API keys, image URLs, image data, or full request payloads to logs.
