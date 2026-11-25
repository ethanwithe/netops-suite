"""
ssh_executor.py
Ejecuta una sesión SSH automática contra el equipo (switch/router), como lo
haría un técnico en SecureCRT o MobaXterm, pero sin intervención manual:
  1. Se conecta.
  2. Desactiva el paginado (si aplica a la marca).
  3. Ejecuta el comando de configuración actual (current-config / running-config).
  4. Ejecuta cada prueba de la lista de la marca/tipo de equipo.
  5. Devuelve todo el texto capturado, listo para pegar en el PDF.

Usa paramiko (librería SSH en Python puro) para que funcione igual en
Windows/Linux/Mac y se pueda empaquetar en el .exe sin depender de
programas externos como PuTTY, sshpass, etc.
"""

import re
import time
import paramiko

ANSI_RE = re.compile(rb"\x1b\[[0-9;?]*[a-zA-Z]")
MORE_PATTERNS = (b"--More--", b"---- More ----", b"--More(", b"<--- More --->", b"-- more --")


def _strip_ansi(data: bytes) -> bytes:
    return ANSI_RE.sub(b"", data)


PROMPT_LINE = re.compile(r"[^\n]{1,80}[>\]#$]$")


def _prompt_of(text):
    """Último renglón que parece prompt (p. ej. «Router#», «<Huawei>») o ''."""
    lines = [l.rstrip() for l in text.splitlines() if l.strip()]
    last = lines[-1] if lines else ""
    return last.strip() if PROMPT_LINE.fullmatch(last.strip()) else ""


def _read_chunk(chan, quiet_time=1.2, max_time=20, on_more_send=b" ", prompt=""):
    """Lee la salida de un comando. Con el prompt del equipo conocido espera a que vuelva a aparecer (aunque el
    equipo tarde minutos, como un «show ip route» grande); si no, termina tras 'quiet_time' sin datos nuevos.
    Maneja '--More--' enviando espacio."""
    end_by = time.time() + (max(max_time, 600) if prompt else max_time)
    buf = b""
    last_data = time.time()
    more_at = -1
    while time.time() < end_by:
        if chan.recv_ready():
            chunk = chan.recv(65535)
            buf += chunk
            last_data = time.time()
            if any(p in buf[-200:] for p in MORE_PATTERNS) and len(buf) != more_at:
                more_at = len(buf)
                chan.send(on_more_send)
        else:
            quiet = time.time() - last_data
            if prompt:
                text = _strip_ansi(buf).decode(errors="ignore").rstrip()
                if text.endswith(prompt) and quiet > 0.8:
                    break
                if quiet > 120:
                    break
            elif quiet > quiet_time:
                break
            time.sleep(0.1)
    return _strip_ansi(buf).decode(errors="ignore")


def run_automatic_session(host, user, password, port, disable_paging_cmds,
                           config_test, tests, save_cmds=None,
                           timeout=12, progress_cb=None):
    """
    Ejecuta la sesión completa y devuelve:
      config_text: str  -> salida del comando de configuración actual
      results: list[(key, label, cmd, output_text)]  -> una por cada prueba

    config_test: (key, label, cmd)
    tests: lista [(key, label, cmd), ...]
    """
    def log(msg):
        if progress_cb:
            progress_cb(msg)

    log(f"Conectando a {host}:{port} ...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password,
                    timeout=timeout, look_for_keys=False, allow_agent=False,
                    banner_timeout=timeout, auth_timeout=timeout)

    chan = client.invoke_shell()
    time.sleep(1)
    banner = _read_chunk(chan, quiet_time=0.8, max_time=4)  # banner/login inicial
    chan.send("\n")
    prompt = _prompt_of(_read_chunk(chan, quiet_time=0.8, max_time=4)) or _prompt_of(banner)

    for cmd in (disable_paging_cmds or []):
        log(f"Configurando terminal: {cmd}")
        chan.send(cmd + "\n")
        _read_chunk(chan, quiet_time=0.8, max_time=6)

    config_text = ""
    if config_test:
        key, label, cmd = config_test
        log(f"Ejecutando: {label} ({cmd})")
        chan.send(cmd + "\n")
        config_text = _read_chunk(chan, quiet_time=1.5, max_time=30, prompt=prompt)

    results = []
    for key, label, cmd in tests:
        log(f"Ejecutando: {label} ({cmd})")
        chan.send(cmd + "\n")
        output = _read_chunk(chan, quiet_time=1.3, max_time=20, prompt=prompt)
        results.append((key, label, cmd, output))

    if save_cmds:
        for cmd in save_cmds:
            log(f"Guardando configuración: {cmd}")
            chan.send(cmd + "\n")
            _read_chunk(chan, quiet_time=1.0, max_time=10)

    chan.close()
    client.close()
    log("Sesión SSH finalizada.")
    return config_text, results


def send_raw_lines_ssh(host, user, password, port, lines, progress_cb=None,
                        per_line_wait=0.8, timeout=12):
    """Envía una lista de líneas de configuración tal cual por SSH (para aplicar
    plantillas) y devuelve el log completo de lo que respondió el equipo."""
    def log(msg):
        if progress_cb:
            progress_cb(msg)

    log(f"Conectando a {host}:{port} ...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password,
                    timeout=timeout, look_for_keys=False, allow_agent=False,
                    banner_timeout=timeout, auth_timeout=timeout)
    chan = client.invoke_shell()
    time.sleep(1)
    _read_chunk(chan, quiet_time=0.8, max_time=4)

    full_log = []
    for line in lines:
        if not line.strip():
            continue
        log(f">> {line}")
        chan.send(line + "\n")
        out = _read_chunk(chan, quiet_time=per_line_wait, max_time=15)
        full_log.append(f"{line}\n{out}")

    chan.close()
    client.close()
    log("Aplicación de comandos finalizada (SSH).")
    return "\n".join(full_log)
