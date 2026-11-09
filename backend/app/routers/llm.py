"""
Proveedores de IA gratuitos (compatibles con la API de OpenAI) para Bit y el editor de imágenes.

Orden de preferencia: Anthropic (de pago, mejor calidad) → Gemini (GEMINI_API_KEY, capa gratuita
en aistudio.google.com) → Groq (GROQ_API_KEY, capa gratuita en console.groq.com) → OpenRouter
(OPENROUTER_API_KEY, openrouter.ai: modelos gratuitos «:free»; por defecto «openrouter/free», que elige uno disponible).
Modelos ajustables con GEMINI_MODEL / GROQ_MODEL / GROQ_VISION_MODEL / OPENROUTER_MODEL / OPENROUTER_VISION_MODEL
(en OpenRouter se pueden poner varios separados por coma: si el primero falla o no hay cupo, prueba el siguiente).
"""
import json
import os
import re
import urllib.error
import urllib.request

PROVIDERS = {
    "gemini": {
        "env": "GEMINI_API_KEY",
        "url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "model": ("GEMINI_MODEL", "gemini-3.8-flash"),
        "vision": ("GEMINI_MODEL", "gemini-3.8-flash"),
    },
    "groq": {
        "env": "GROQ_API_KEY",
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "model": ("GROQ_MODEL", "llama-3.3-70b-versatile"),
        "vision": ("GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct"),
    },
    "openrouter": {
        "env": "OPENROUTER_API_KEY",
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "model": ("OPENROUTER_MODEL", "openrouter/free"),
        "vision": ("OPENROUTER_VISION_MODEL", "openrouter/free"),
    },
}


def configured():
    """Todos los proveedores gratuitos con clave, en orden de preferencia."""
    out = []
    for name, p in PROVIDERS.items():
        k = os.getenv(p["env"], "").strip().strip('"').strip("'")
        if k:
            out.append((name, k))
    return out


def free_provider():
    """Devuelve (nombre, clave) del primer proveedor gratuito configurado, o None."""
    c = configured()
    return c[0] if c else None


last_error = ""


GEMINI_NATIVE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
WEB = os.getenv("MASCOT_WEB", "1").strip() != "0"
TIMEOUT = float(os.getenv("LLM_TIMEOUT", "25") or 25)   # segundos por proveedor
HEDGE = float(os.getenv("LLM_HEDGE", "5") or 5)         # si el proveedor tarda más, se lanza el siguiente en paralelo


def _gemini_web(key: str, model: str, system: str, messages: list, max_tokens: int) -> str:
    """Gemini con búsqueda de Google integrada (grounding): el modelo decide solo cuándo buscar.
    No existe en el endpoint compatible con OpenAI, por eso se usa la API nativa."""
    contents = [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]} for m in messages]
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": contents,
        "tools": [{"google_search": {}}],
        "generationConfig": {"maxOutputTokens": max(max_tokens, 4000), "temperature": 0.6,
                             "thinkingConfig": {"thinkingBudget": 1024}},
    }
    req = urllib.request.Request(
        GEMINI_NATIVE.format(model=model), data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key}, method="POST")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        data = json.loads(r.read())
    parts = (((data.get("candidates") or [{}])[0].get("content") or {}).get("parts")) or []
    return "".join(p_.get("text", "") for p_ in parts if not p_.get("thought")).strip()


_RESOLVED: dict = {}   # modelo que dio 404 -> modelo vigente descubierto
_LIST = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200"


def discover_gemini(key: str, image: bool = False) -> str | None:
    """Pregunta a Google qué modelos ve esta clave y elige el flash más nuevo (o el flash-image más nuevo).
    Así no hay que tocar el código cada vez que Google retira un modelo."""
    try:
        req = urllib.request.Request(_LIST, headers={"x-goog-api-key": key})
        with urllib.request.urlopen(req, timeout=20) as r:
            models = json.loads(r.read()).get("models") or []
    except Exception as e:
        print("[IA] no pude listar los modelos de Gemini:", e, flush=True)
        return None
    pat = re.compile(r"^gemini-(\d+(?:\.\d+)*)-flash-image(?:-(?!lite)[\w-]+)?$" if image else r"^gemini-(\d+(?:\.\d+)*)-flash(?:-(?:preview[\w-]*|latest))?$")
    best = None
    for m in models:
        if "generateContent" not in (m.get("supportedGenerationMethods") or []):
            continue
        nm = (m.get("name") or "").split("/")[-1]
        mm = pat.match(nm)
        if mm:
            k = ("preview" not in nm, tuple(int(x) for x in mm.group(1).split(".")))  # primero los estables; entre ellos, la versión más nueva
            if best is None or k > best[0]:
                best = (k, nm)
    if best:
        print("[IA] modelo de Gemini descubierto:", best[1], flush=True)
    return best[1] if best else None


def _one(name: str, key: str, system: str, messages: list, max_tokens: int, image: str | None, think: bool = False) -> str:
    p = PROVIDERS[name]
    env, default = p["vision" if image else "model"]
    model = os.getenv(env, "").strip() or default
    if name == "gemini":
        model = _RESOLVED.get(model, model)
        try:
            return _do(name, key, system, messages, max_tokens, image, think, model)
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            new = discover_gemini(key)
            if not new or new == model:
                raise
            _RESOLVED[os.getenv(env, "").strip() or default] = new
            return _do(name, key, system, messages, max_tokens, image, think, new)
    return _do(name, key, system, messages, max_tokens, image, think, model)


_WEB_HINT = re.compile(r"busca|buscar|internet|\bweb\b|google|noticia|actual|hoy|ayer|[uú]ltim|reciente|precio|cu[aá]nto (cuesta|vale)|versi[oó]n|lanz|nuevo|20(2[4-9]|3\d)|qui[eé]n es|d[oó]nde (queda|est[aá])|clima|tipo de cambio|http", re.I)


def _needs_web(messages: list) -> bool:
    """La búsqueda de Google hace más lenta la respuesta: solo se usa si el mensaje parece pedirla."""
    try:
        return bool(_WEB_HINT.search(str(messages[-1].get("content", ""))))
    except Exception:
        return True


def _do(name: str, key: str, system: str, messages: list, max_tokens: int, image: str | None, think: bool, model: str) -> str:
    p = PROVIDERS[name]
    msgs = [{"role": "system", "content": system}] + [dict(m) for m in messages]
    if image:
        last = msgs[-1]
        last["content"] = [{"type": "text", "text": last["content"]}, {"type": "image_url", "image_url": {"url": image}}]
    if name == "gemini" and think and WEB and not image and _needs_web(messages):
        try:
            out = _gemini_web(key, model, system, messages, max_tokens)
            if out:
                return out
        except Exception as e:  # sin cuota de búsqueda o error: se responde sin buscar
            print("[IA] Gemini con búsqueda falló, sigo sin buscar:", e, flush=True)
    body = {"model": model, "messages": msgs, "max_tokens": max_tokens, "temperature": 0.6 if think else 0.3}
    if name == "gemini" and re.search(r"-(2\.5|3[\d.]*)-", model):
        # Gemini 2.5 «piensa» y ese pensamiento gasta max_tokens: sin esto la respuesta llegaba vacía.
        # think=True (chat de Bit): razonamiento ligero; el «pensamiento» gasta tokens, por eso el margen grande.
        body["reasoning_effort"] = "low" if think else "none"
        body["max_tokens"] = max(max_tokens, 4000 if think else 1500)
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
    if name == "openrouter":
        # Varios modelos separados por coma: OpenRouter prueba el siguiente si uno falla o no tiene cupo.
        names = [m.strip() for m in model.split(",") if m.strip()]
        body["model"] = names[0]
        if len(names) > 1:
            body["models"] = names
        headers["HTTP-Referer"] = os.getenv("APP_URL", "https://netops-suite.up.railway.app")
        headers["X-Title"] = "NetOps Suite"
    req = urllib.request.Request(p["url"], data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    return ((data.get("choices") or [{}])[0].get("message", {}).get("content", "") or "").strip()


def _ordered(provs: list, think: bool) -> list:
    """Sin búsqueda web (think=False) se prefiere el más rápido (Groq); con think, Gemini (razona y busca)."""
    pref = ["gemini", "groq", "openrouter"] if think else ["groq", "gemini", "openrouter"]
    return sorted(provs, key=lambda nk: pref.index(nk[0]) if nk[0] in pref else 9)


def complete(system: str, messages: list, max_tokens: int = 700, image: str | None = None, think: bool = False) -> str:
    """messages: [{role, content}]. image: data URL opcional (se adjunta al último mensaje de usuario).
    Prueba los proveedores configurados; si uno tarda más de LLM_HEDGE segundos se lanza el siguiente
    en paralelo y gana la primera respuesta válida. Si uno falla (cuota, error, vacío) pasa al siguiente."""
    global last_error
    provs = _ordered(configured(), think)
    if not provs:
        raise RuntimeError("sin proveedor")
    from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
    errs: list = []

    def run(name, key):
        try:
            out = _one(name, key, system, messages, max_tokens, image, think)
            if out:
                return out
            errs.append(f"{name}: respuesta vacía")
        except urllib.error.HTTPError as e:
            try:
                detail = e.read().decode("utf-8", "replace")[:300]
            except Exception:
                detail = ""
            errs.append(f"{name}: HTTP {e.code} {detail}")
        except Exception as e:
            errs.append(f"{name}: {e.__class__.__name__} {e}")
        return ""

    ex = ThreadPoolExecutor(max_workers=len(provs))
    try:
        pending, queue = set(), list(provs)
        while queue or pending:
            if queue and (not pending):
                pending.add(ex.submit(run, *queue.pop(0)))
            done, pending = wait(pending, timeout=HEDGE if queue else None, return_when=FIRST_COMPLETED)
            for f in done:
                out = f.result()
                if out:
                    last_error = ""
                    return out
            if not done and queue:          # el actual tarda: se lanza el siguiente sin cancelar el primero
                pending.add(ex.submit(run, *queue.pop(0)))
    finally:
        ex.shutdown(wait=False, cancel_futures=True)
    last_error = " | ".join(errs)
    print("[IA] todos los proveedores fallaron:", last_error, flush=True)  # visible en los logs de Railway
    raise RuntimeError(last_error)
