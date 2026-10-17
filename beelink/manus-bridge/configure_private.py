#!/usr/bin/env python3
"""Enter a Manus API key locally via a masked GUI; never via terminal arguments."""
import json
from datetime import datetime, timezone
import os
from pathlib import Path
import subprocess
import sys
import manus_bridge as b


def setup_state(status, phase, code=None):
    """Record only safe workflow status, never the key or API response."""
    b.private_json(b.BASE/'manus-bridge/state/setup-state.json', {
        'status': status, 'phase': phase, 'code': code,
        'at': datetime.now(timezone.utc).isoformat(),
    })


def setup_error_code(error):
    if isinstance(error, b.ApiError):
        return f'api_http_{error.code}'
    safe = {'invalid_api_key', 'wrong_task', 'task_must_be_private', 'cannot_read_crontab',
            'host_timezone_requires_check', 'cannot_install_bridge_cron',
            'api_network_or_response_error', 'api_response_not_ok',
            'task_visibility_unknown', 'task_privacy_update_not_verified',
            'api_key_empty', 'api_key_masked', 'api_key_whitespace', 'api_key_characters'}
    return str(error) if isinstance(error, b.BridgeError) and str(error) in safe else 'setup_step_failed'


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


def ensure_task_private(api):
    """Use the supported API to narrow sharing, then independently read it back."""
    task = api.call('task.detail', {'task_id': b.TASK})['task']
    b.require(task['id'] == b.TASK, 'wrong_task')
    previous = task.get('share_visibility')
    b.require(previous in {'private', 'team', 'public'} and task.get('status') != 'deleted',
              'task_visibility_unknown')
    changed = previous != 'private'
    if changed:
        api.call('task.update', {'task_id': b.TASK, 'share_visibility': 'private'}, post=True)
        task = api.call('task.detail', {'task_id': b.TASK})['task']
        b.require(task['id'] == b.TASK, 'wrong_task')
        b.require(task.get('share_visibility') == 'private', 'task_privacy_update_not_verified')
    return {'taskId': b.TASK, 'previousVisibility': previous,
            'currentVisibility': 'private', 'changed': changed}


KEY_ERRORS = {
    'api_key_empty': 'El campo quedó vacío. Pega el valor de la API Key antes de aceptar.',
    'api_key_masked': 'Se pegó un valor oculto o abreviado. Copia la clave completa, no los asteriscos ni puntos suspensivos.',
    'api_key_whitespace': 'Se pegó texto con espacios o saltos internos. Copia solo el valor de la clave, no su nombre ni instrucciones.',
    'api_key_characters': 'El texto contiene caracteres que no forman un token de API. Usa el botón de copiar junto a la clave completa.',
}


def parse_key_entry(raw):
    """Remove only outer copy formatting; never join/change token characters."""
    key = raw.strip().strip('\u200b\ufeff').strip()
    pairs = {'"': '"', "'": "'", '`': '`', '“': '”', '‘': '’'}
    if len(key) >= 2 and key[0] in pairs and key[-1] == pairs[key[0]]:
        key = key[1:-1].strip()
    b.require(bool(key), 'api_key_empty')
    b.require(not any(marker in key for marker in ('...', '…', '••', '**')), 'api_key_masked')
    b.require(not any(c.isspace() for c in key), 'api_key_whitespace')
    b.require(all(33 <= ord(c) <= 126 for c in key), 'api_key_characters')
    return key


def prompt_key(env):
    hint = ''
    hint_code = None
    while True:
        setup_state('waiting_for_local_key', 'enter_key', hint_code)
        result = subprocess.run(['zenity', '--entry', '--hide-text', '--width=640',
            '--title=Ojala: pegar VALOR COMPLETO de API Key',
            '--text=' + hint +
            'En Manus > Settings > Developers, copia el VALOR de la API Key.\n'
            'No pegues su nombre (Ojala Beelink), una clave oculta ni la clave Frigate.\n'
            'Si ya no tienes el valor completo, Manus solo lo muestra al crear la clave.\n'
            'Pégalo aquí; se validará con Manus y se guardará privado en esta Beelink.\n'
            'La conversación se pondrá privada; el dashboard publicado no cambia.\n'
            'La API accede a tu cuenta y las tareas consumen créditos. No pegues la clave en el chat.'],
            env=env, capture_output=True, text=True)
        if result.returncode:
            setup_state('cancelled', 'enter_key')
            return None
        try:
            return parse_key_entry(result.stdout)
        except b.BridgeError as error:
            code = setup_error_code(error)
            hint_code = code
            setup_state('input_needs_correction', 'enter_key', code)
            hint = KEY_ERRORS.get(code, 'Revisa el valor copiado.') + '\n\n'


def remember_authenticated_key(api, key):
    # Keep a valid credential through a later privacy/schedule failure. Workers
    # never read this pending file, and it is never written before authentication.
    api.call('user.me')
    b.private_json(b.BASE/'manus-bridge/setup-authenticated-key.private.json', {'manusApiKey': key})


def configure():
    os.umask(0o077)
    env = gui_environment()
    phase = 'enter_key'
    pending = b.BASE/'manus-bridge/setup-authenticated-key.private.json'
    try:
        saved = b.BASE/'manus-bridge/config.private.json'
        reusable = pending if pending.exists() else saved if saved.exists() else None
        key = b.read_key(reusable) if reusable else prompt_key(env)
        if key is None:
            return 0
        phase = 'authenticate'; setup_state('checking', phase)
        api = b.ManusApi(key)
        remember_authenticated_key(api, key)
        phase = 'make_task_private'; setup_state('checking', phase)
        privacy = ensure_task_private(api)
        b.private_json(b.BASE/'manus-bridge/state/task-privacy-receipt.json', {
            **privacy, 'verifiedAt': datetime.now(timezone.utc).isoformat(),
        })
        b.private_json(b.BASE/'manus-bridge/config.private.json', {'manusApiKey': key})
        pending.unlink(missing_ok=True)
        del key
        phase = 'install_schedule'; setup_state('checking', phase)
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
                   "AND last_error IN ('api_http_401','api_http_403','task_must_be_private')")
        db.commit()
        db.close()
        lines += [f'15 22 * * * /usr/bin/python3 {bridge} collect >> {log} 2>&1 # ojala-manus-api-bridge',
                  f'20,50 * * * * /usr/bin/python3 {bridge} reconcile >> {log} 2>&1 # ojala-manus-api-bridge',
                  f'25,55 * * * * /usr/bin/python3 {bridge} send >> {log} 2>&1 # ojala-manus-api-bridge']
        b.private_json(state/'crontab-before-bridge.json', {'crontab': current.stdout})
        result = subprocess.run(['crontab', '-'], input='\n'.join(lines)+'\n', capture_output=True, text=True)
        b.require(result.returncode == 0, 'cannot_install_bridge_cron')
        setup_state('configured', 'complete')
        subprocess.run(['zenity', '--info', '--width=540', '--title=Ojala: conexión guardada',
                        '--text=La API de Manus autenticó correctamente. La cola quedó activada.\n'
                        'La importación en el dashboard todavía debe confirmarse con un recibo real.'], env=env)
        return 0
    except (b.BridgeError, KeyError, OSError, ValueError) as error:
        if phase == 'authenticate' and isinstance(error, b.ApiError) and error.code == 401:
            pending.unlink(missing_ok=True)
        code = setup_error_code(error)
        setup_state('failed', phase, code)
        explanation = {
            'invalid_api_key': 'La clave está incompleta o contiene espacios.',
            'api_http_401': 'Manus rechazó la clave API. Debe ser una API Key de Manus, no Frigate.',
            'api_http_403': 'La API de Manus rechazó el acceso con esa credencial.',
            'task_must_be_private': 'La tarea Ojala debe tener su visibilidad en privada antes de enviar evidencia.',
            'task_privacy_update_not_verified': 'Se solicitó privacidad, pero Manus todavía no la confirmó al consultar la tarea.',
            'task_visibility_unknown': 'Manus no devolvió un estado de privacidad válido para esta tarea.',
            'wrong_task': 'La clave no dio acceso a la tarea Ojala esperada.',
        }.get(code, 'La configuración se detuvo; se guardó el código de diagnóstico sin credenciales.')
        subprocess.run(['zenity', '--error', '--width=580', '--text=No se completó la activación.\n'
                        + explanation + '\nCódigo: ' + code + '\nNinguna captura se envió desde esta ventana.'], env=env)
        return 2


if __name__ == '__main__':
    sys.exit(configure())
