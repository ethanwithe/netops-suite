"""
Proveedores de IA gratuitos (compatibles con la API de OpenAI) para Bit y el editor de imágenes.

Orden de preferencia: Anthropic (de pago, mejor calidad) → Gemini (GEMINI_API_KEY, capa gratuita
en aistudio.google.com) → Groq (GROQ_API_KEY, capa gratuita en console.groq.com).
Modelos ajustables con GEMINI_MODEL / GROQ_MODEL / GROQ_VISION_MODEL.
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
    with urllib.request.urlopen(req, timeout=60) as r:
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


def _do(name: str, key: str, system: str, messages: list, max_tokens: int, image: str | None, think: bool, model: str) -> str:
    p = PROVIDERS[name]
    msgs = [{"role": "system", "content": system}] + [dict(m) for m in messages]
    if image:
        last = msgs[-1]
        last["content"] = [{"type": "text", "text": last["content"]}, {"type": "image_url", "image_url": {"url": image}}]
    if name == "gemini" and think and WEB and not image:
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
    req = urllib.request.Request(
        p["url"], data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    return ((data.get("choices") or [{}])[0].get("message", {}).get("content", "") or "").strip()


def complete(system: str, messages: list, max_tokens: int = 700, image: str | None = None, think: bool = False) -> str:
    """messages: [{role, content}]. image: data URL opcional (se adjunta al último mensaje de usuario).
    Prueba cada proveedor configurado en orden; si uno falla (cuota, error, respuesta vacía) pasa al siguiente."""
    global last_error
    provs = configured()
    if not provs:
        raise RuntimeError("sin proveedor")
    errs = []
    for name, key in provs:
        try:
            out = _one(name, key, system, messages, max_tokens, image, think)
            if out:
                last_error = ""
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
    last_error = " | ".join(errs)
    print("[IA] todos los proveedores fallaron:", last_error, flush=True)  # visible en los logs de Railway
    raise RuntimeError(last_error)
