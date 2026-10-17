#!/usr/bin/env python3
"""Enter a Manus API key locally via a masked GUI; never via terminal arguments."""
import json
import os
from pathlib import Path
import subprocess
import sys
import manus_bridge as b


def gui_environment():
    env = os.environ.copy()
    env['XDG_RUNTIME_DIR'] = f'/run/user/{os.getuid()}'
    env['DBUS_SESSION_BUS_ADDRESS'] = f'unix:path=/run/user/{os.getuid()}/bus'
    result = subprocess.run(['systemctl', '--user', 'show-environment'], env=env,
                            capture_output=True, text=True)
    for line in result.stdout.splitlines():
        key, sep, value = line.partition('=')
        if sep and key in {'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_SESSION_TYPE'}:
            env[key] = value
    return env


def configure():
    os.umask(0o077)
    env = gui_environment()
    result = subprocess.run(['zenity', '--entry', '--hide-text', '--width=580',
        '--title=Ojala: conectar API oficial de Manus',
        '--text=Crea una API Key en Manus > Settings > Developers, con nombre Ojala Beelink.\n'
               'Esta clave permite acceso a tu cuenta Manus y consume créditos al ejecutar tareas.\n'
               'Pégala aquí. Se guardará solo en esta Beelink con permisos privados.\n'
               'No es la clave Frigate. No la pegues en el chat.'],
        env=env, capture_output=True, text=True)
    if result.returncode:
        return 0
    key = result.stdout.strip()
    try:
        b.require(len(key) >= 20 and not any(c.isspace() for c in key), 'invalid_api_key')
        api = b.ManusApi(key)
        api.call('user.me')
        task = api.call('task.detail', {'task_id': b.TASK})['task']
        b.require(task['id'] == b.TASK, 'wrong_task')
        b.require(task.get('share_visibility') == 'private', 'task_must_be_private')
        b.private_json(b.BASE/'manus-bridge/config.private.json', {'manusApiKey': key})
        del key
        current = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
        b.require(current.returncode == 0 or 'no crontab' in current.stderr.lower(), 'cannot_read_crontab')
        lines = [line for line in current.stdout.splitlines() if '# ojala-manus-api-bridge' not in line]
        bridge = b.BASE/'manus-bridge/manus_bridge.py'
        log = b.BASE/'manus-bridge/state/worker.log'
        # Host is already configured for America/Mazatlan; verify before scheduling.
        zone = subprocess.run(['timedatectl', 'show', '-p', 'Timezone', '--value'],
                              capture_output=True, text=True).stdout.strip()
        b.require(zone == 'America/Mazatlan', 'host_timezone_requires_check')
        state = b.BASE/'manus-bridge/state'
        db = b.queue_db(state)
        db.execute("DELETE FROM controls WHERE key='api_auth_hold'")
        db.execute("UPDATE batches SET status='retry',next_at=0 WHERE status='blocked' "
                   "AND last_error IN ('api_http_401','api_http_403')")
        db.commit()
        db.close()
        lines += [f'15 22 * * * /usr/bin/python3 {bridge} collect >> {log} 2>&1 # ojala-manus-api-bridge',
                  f'20,50 * * * * /usr/bin/python3 {bridge} reconcile >> {log} 2>&1 # ojala-manus-api-bridge',
                  f'25,55 * * * * /usr/bin/python3 {bridge} send >> {log} 2>&1 # ojala-manus-api-bridge']
        b.private_json(state/'crontab-before-bridge.json', {'crontab': current.stdout})
        result = subprocess.run(['crontab', '-'], input='\n'.join(lines)+'\n', capture_output=True, text=True)
        b.require(result.returncode == 0, 'cannot_install_bridge_cron')
        subprocess.run(['zenity', '--info', '--width=540', '--title=Ojala: conexión guardada',
                        '--text=La API de Manus autenticó correctamente. La cola quedó activada.\n'
                        'La importación en el dashboard todavía debe confirmarse con un recibo real.'], env=env)
        return 0
    except (b.BridgeError, KeyError, OSError, ValueError):
        subprocess.run(['zenity', '--error', '--width=540', '--text=No se activó el envío. '
                        'Comprueba la clave API y que la tarea de Ojala sea privada. '
                        'Ninguna captura se envió desde esta ventana.'], env=env)
        return 2


if __name__ == '__main__':
    sys.exit(configure())
