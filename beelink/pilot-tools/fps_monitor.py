"""Persistent local FPS alerts. Never restarts Frigate or edits camera data."""
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile

THRESHOLD = 3.0
DELAY = 300
MAX_GAP = 90


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, tmp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def desktop_notify(title, body):
    """Use this owner's desktop bus, including when invoked by cron."""
    env = dict(os.environ)
    runtime = '/run/user/' + str(os.getuid())
    env['XDG_RUNTIME_DIR'] = runtime
    env['DBUS_SESSION_BUS_ADDRESS'] = 'unix:path=' + runtime + '/bus'
    try:
        r = subprocess.run(['/usr/bin/notify-send', '--app-name=Ojala',
                            '--urgency=critical', '--expire-time=0', title, body],
                           env=env, capture_output=True, timeout=5)
        return r.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def advance(state, report):
    """Pure transition; missing telemetry never establishes low-FPS duration."""
    now = report['checked_epoch']
    old = dict(state)
    gap = now - old.get('last_epoch', now)
    reset = gap < 0 or gap > MAX_GAP or old.get('boot_id') != report.get('boot_id')
    current = dict(old, last_epoch=now, boot_id=report.get('boot_id'))
    if reset:
        current.update(low_since=None, healthy_since=None, telemetry_gap=True)
    active = report.get('operating_hours') or report.get('manual_session_outside_schedule')
    values = [report.get(k) for k in ('process_fps', 'camera_fps')]
    valid = all(isinstance(v, (int, float)) and not isinstance(v, bool)
                and math.isfinite(v) and v >= 0 for v in values)
    if not active:
        current.update(status='inactive', low_since=None, healthy_since=None,
                       incident=None)
        return current, None
    if not valid:
        current.update(status='telemetry_unavailable', low_since=None, healthy_since=None)
        return current, None
    low = min(values) < THRESHOLD
    if low:
        current['healthy_since'] = None
        if current.get('low_since') is None:
            current['low_since'] = now
        seconds = now - current['low_since']
        current['status'] = 'alert' if current.get('incident') else 'observing_low_fps'
        if seconds >= DELAY and not current.get('incident'):
            incident = 'handoff-' + str(int(current['low_since']))
            current.update(status='alert', incident=incident)
            return current, {'id':incident, 'kind':'low_fps', 'firstLowEpoch':current['low_since'],
                             'triggeredAt':report['checked_at'], 'observedSeconds':seconds,
                             'processFps':values[0], 'cameraFps':values[1],
                             'maxTemperatureC':report.get('max_temperature_c'),
                             'title':'Ojala: Frigate procesa menos de 3 FPS',
                             'body':('Handoff lleva al menos 5 minutos por debajo de 3 FPS. '
                                     'Puede omitir vasos. Revisa Beelink y ventilación; '
                                     'la cobertura requiere revisión.'),
                             'notificationDelivered':False}
    else:
        current['low_since'] = None
        if current.get('healthy_since') is None:
            current['healthy_since'] = now
        current['status'] = 'recovering' if current.get('incident') else 'healthy'
        if current.get('incident') and now-current['healthy_since'] >= 60:
            prior = current['incident']
            current.update(incident=None, status='healthy')
            return current, {'id':prior+'-recovered', 'kind':'recovered',
                             'triggeredAt':report['checked_at'],
                             'processFps':values[0], 'cameraFps':values[1],
                             'title':'Ojala: FPS recuperados',
                             'body':'Handoff volvió a 3 FPS o más en las dos últimas muestras. '
                                    'Se conserva el incidente y su intervalo de cobertura.',
                             'notificationDelivered':False}
    return current, None


def check_report(report, root, notify=desktop_notify):
    """Called under the existing guard lock. One durable record per incident."""
    root = Path(root)
    state_path = root/'fps-alert-state.json'
    try:
        state = json.loads(state_path.read_text())
    except (OSError, ValueError):
        state = {}
    state, event = advance(state, report)
    if event:
        # Persist before notification. Failure is retried, never called delivered.
        save(root/'fps-alerts'/(event['id']+'.json'), event)
    state['last_checked_at'] = report['checked_at']
    save(state_path, state)
    # A crash after event persistence must not lose the notification.
    pending = []
    for path in sorted((root/'fps-alerts').glob('*.json')):
        try:
            item = json.loads(path.read_text())
            if not item.get('notificationDelivered'):
                pending.append((path,item))
        except (OSError, ValueError):
            continue
    for path, item in pending[-3:]:
        ok = notify(item['title'], item['body'])
        item.update(notificationDelivered=bool(ok), notificationChannel='beelink_desktop',
                    notificationAttemptAt=report['checked_at'])
        save(path, item)
    return {'status':state['status'], 'low_since':state.get('low_since'),
            'incident':state.get('incident'), 'channel':'beelink_desktop',
            'pendingNotifications':sum(not p[1].get('notificationDelivered') for p in pending),
            'thresholdFps':THRESHOLD, 'durationSeconds':DELAY}
