#!/usr/bin/env bash
set -eu
/usr/bin/python3 /home/ojala/frigate/manus-bridge/live_cycle.py >> /home/ojala/frigate/manus-bridge/state/realtime-visual-cycle.log 2>&1
