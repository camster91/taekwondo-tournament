"""Run the tracked production Compose with only isolated QA inputs and loopback TLS."""
import argparse
import json
import os
import pathlib
import re
import secrets
import shutil
import socket
import ssl
import subprocess
import tempfile
import time
import urllib.request

project = os.environ.get('BOWIN_TLS_QA_PREFIX', '')
if os.environ.get('GITHUB_ACTIONS') != 'true' or project != 'bowin-tls-' + os.environ.get('GITHUB_RUN_ID', '') + '-' + os.environ.get('GITHUB_RUN_ATTEMPT', '') or not re.fullmatch(r'bowin-tls-[0-9]+-[0-9]+', project):
    raise SystemExit('Exact disposable CI project required')
directory = pathlib.Path(tempfile.gettempdir()) / project
root = pathlib.Path(__file__).resolve().parents[2]
created = False


def command(args, input=None, required=True):
    result = subprocess.run(args, input=input, capture_output=True)
    if required and result.returncode:
        raise RuntimeError('Disposable QA command rejected: ' + args[0])
    return result


def compose(*args, **kwargs):
    return command(['docker', 'compose', '--project-name', project, '--env-file', str(directory / 'fixture.env'), '-f', str(directory / 'compose.json'), *args], **kwargs)


def current():
    ids = command(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + project]).stdout.decode().split()
    return json.loads(command(['docker', 'inspect', *ids]).stdout) if ids else []


def ready():
    deadline = time.monotonic() + 60
    revision = (directory / 'revision').read_text()
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen('https://127.0.0.1:19443/api/health/ready', context=ssl._create_unverified_context(), timeout=2) as response:
                value = json.load(response)
                if value['revision'] == revision and value['status'] == 'ok':
                    return
        except Exception:
            pass
        time.sleep(.5)
    raise RuntimeError('Disposable production Compose readiness failed')


def up():
    global created
    revision = os.environ.get('RELEASE_SHA', '')
    image = os.environ.get('BOWIN_CHECKED_IMAGE', '')
    if not re.fullmatch(r'[a-f0-9]{40}', revision) or image != 'bowin-rebuild-checked-runtime:' + revision:
        raise RuntimeError('Checked runtime identity required')
    inspected = json.loads(command(['docker', 'image', 'inspect', image]).stdout)[0]
    if inspected['Config']['User'] != 'node' or inspected['Config']['Labels'].get('org.opencontainers.image.revision') != revision:
        raise RuntimeError('Runtime user/revision differs')
    if directory.exists() or current() or command(['docker', 'volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project]).stdout.strip() or command(['docker', 'network', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project]).stdout.strip():
        raise RuntimeError('Disposable project already exists')
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 19443))
    raw = json.loads(root.joinpath('docker-compose.rebuild-production.json').read_text())
    if set(raw['services']) != {'postgres', 'runtime-role', 'migrate', 'app'} or any('ports' in value or 'build' in value for value in raw['services'].values()):
        raise RuntimeError('Production Compose topology differs')
    directory.mkdir(mode=0o700); created = True
    raw['networks'] = {'default': {'internal': True}, 'tls-loopback': {}}
    raw['services']['tls-proxy'] = {
        'image': 'nginx:alpine', 'ports': ['127.0.0.1:19443:443'], 'networks': ['default', 'tls-loopback'],
        'volumes': [str(directory / 'nginx.conf') + ':/etc/nginx/conf.d/default.conf:ro', str(directory / 'cert.pem') + ':/fixture/cert.pem:ro', str(directory / 'key.pem') + ':/fixture/key.pem:ro'],
        'depends_on': {'app': {'condition': 'service_healthy'}},
    }
    admin, owner, runtime = [secrets.token_hex(32) for _ in range(3)]
    values = {'POSTGRES_PASSWORD': admin, 'OWNER_DATABASE_PASSWORD': owner, 'RUNTIME_DATABASE_PASSWORD': runtime,
              'DATABASE_OWNER_URL': 'postgres://bowin_owner:' + owner + '@postgres:5432/bowin_rebuild_production',
              'DATABASE_URL': 'postgres://bowin_runtime:' + runtime + '@postgres:5432/bowin_rebuild_production',
              'BOWIN_RUNTIME_IMAGE': image, 'APP_ORIGIN': 'https://127.0.0.1:19443', 'SETUP_TOKEN': 'QaSetupOnly-' * 4}
    (directory / 'fixture.env').write_text(''.join(key + '=' + value + '\n' for key, value in values.items())); (directory / 'fixture.env').chmod(0o600)
    (directory / 'compose.json').write_text(json.dumps(raw)); (directory / 'revision').write_text(revision)
    (directory / 'nginx.conf').write_text('server { listen 443 ssl; ssl_certificate /fixture/cert.pem; ssl_certificate_key /fixture/key.pem; location / { resolver 127.0.0.11 valid=1s ipv6=off; set $bowin_upstream http://app:3001; proxy_pass $bowin_upstream; proxy_set_header Host $http_host; proxy_set_header X-Forwarded-Proto https; } }\n')
    command(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', str(directory / 'key.pem'), '-out', str(directory / 'cert.pem')]); (directory / 'key.pem').chmod(0o600)
    compose('up', '-d', '--wait', '--wait-timeout', '120'); ready()
    app = next(item for item in current() if item['Config']['Labels']['com.docker.compose.service'] == 'app')
    environment = dict(entry.split('=', 1) for entry in app['Config']['Env'])
    if 'LOCAL_QA' in environment or any(name in environment for name in ['POSTGRES_PASSWORD', 'OWNER_DATABASE_PASSWORD', 'RUNTIME_DATABASE_PASSWORD', 'DATABASE_OWNER_URL']) or environment.get('BOWIN_RUNTIME_ROLE') != 'bowin_runtime':
        raise RuntimeError('Production role/secret/cookie separation differs')
    for item in current():
        service = item['Config']['Labels']['com.docker.compose.service']; bindings = item['HostConfig']['PortBindings'] or {}
        if service != 'tls-proxy' and any(bindings.values()):
            raise RuntimeError('Unexpected exposed service')
    probe = compose('exec', '-T', 'app', 'node', '--input-type=module', input=root.joinpath('replacement/test/production-role-qa.mjs').read_bytes()).stdout
    role_proof = json.loads(probe); assert role_proof['status'] == 'passed'
    (root / 'bowin-production-role-verification.json').write_text(json.dumps(role_proof, indent=2))
    # Repeated provisioning/migrations must preserve existing credentials and data.
    compose('run', '--rm', '--no-deps', 'runtime-role'); compose('run', '--rm', '--no-deps', 'migrate')
    rejected = compose('run', '--rm', '--no-deps', '-e', 'OWNER_DATABASE_PASSWORD=' + secrets.token_hex(32), 'runtime-role', required=False)
    if rejected.returncode == 0:
        raise RuntimeError('Wrong existing owner credential was accepted')
    ready()


def restart(target):
    if target not in ['database', 'runtime'] or not directory.is_dir():
        raise RuntimeError('Disposable restart target required')
    before = next(item for item in current() if item['Config']['Labels']['com.docker.compose.service'] == 'app')['State']['StartedAt']
    compose('restart', 'postgres' if target == 'database' else 'app'); ready()
    after = next(item for item in current() if item['Config']['Labels']['com.docker.compose.service'] == 'app')
    if not after['State']['Running'] or target == 'database' and after['State']['StartedAt'] != before:
        raise RuntimeError('Database restart changed the application process')


def down():
    compose('down', '--volumes', '--remove-orphans')
    if current() or command(['docker', 'volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project]).stdout.strip() or command(['docker', 'network', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project]).stdout.strip():
        raise RuntimeError('Disposable production Compose cleanup incomplete')
    shutil.rmtree(directory)


parser = argparse.ArgumentParser(); parser.add_argument('phase', choices=['run', 'restart']); parser.add_argument('--target'); args = parser.parse_args()
if args.phase == 'restart':
    restart(args.target)
else:
    try:
        up()
        environment = {**os.environ, 'BROWSER_QA_REVISION': os.environ['RELEASE_SHA'], 'BROWSER_QA_ORIGIN': 'https://127.0.0.1:19443', 'BROWSER_QA_RESTART_SCRIPT': '.github/scripts/restart-tls-fixture.sh', 'BOWIN_PRODUCTION_COMPOSE_QA': 'true'}
        subprocess.run(['node', str(root / 'replacement/test/browser-qa.cjs')], env=environment, check=True)
    finally:
        if created:
            down()
    print('Imported production-mode TLS browser, secure session and restart checks passed; disposable fixtures removed')
    print('Tracked production Compose, restricted database role and secret separation verified')
