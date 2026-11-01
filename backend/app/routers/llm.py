"""
Proveedores de IA gratuitos (compatibles con la API de OpenAI) para Bit y el editor de imágenes.

Orden de preferencia: Anthropic (de pago, mejor calidad) → Gemini (GEMINI_API_KEY, capa gratuita
en aistudio.google.com) → Groq (GROQ_API_KEY, capa gratuita en console.groq.com).
Modelos ajustables con GEMINI_MODEL / GROQ_MODEL / GROQ_VISION_MODEL.
"""
import json
import os
import urllib.request

PROVIDERS = {
    "gemini": {
        "env": "GEMINI_API_KEY",
        "url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "model": ("GEMINI_MODEL", "gemini-2.5-flash"),
        "vision": ("GEMINI_MODEL", "gemini-2.5-flash"),
    },
    "groq": {
        "env": "GROQ_API_KEY",
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "model": ("GROQ_MODEL", "llama-3.3-70b-versatile"),
        "vision": ("GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct"),
    },
}


def free_provider():
    """Devuelve (nombre, clave) del primer proveedor gratuito configurado, o None."""
    for name, p in PROVIDERS.items():
        k = os.getenv(p["env"], "").strip()
        if k:
            return name, k
    return None


def complete(system: str, messages: list, max_tokens: int = 700, image: str | None = None) -> str:
    """messages: [{role, content}]. image: data URL opcional (se adjunta al último mensaje de usuario)."""
    fp = free_provider()
    if not fp:
        raise RuntimeError("sin proveedor")
    name, key = fp
    p = PROVIDERS[name]
    env, default = p["vision" if image else "model"]
    model = os.getenv(env, "").strip() or default
    msgs = [{"role": "system", "content": system}] + [dict(m) for m in messages]
    if image:
        last = msgs[-1]
        last["content"] = [{"type": "text", "text": last["content"]}, {"type": "image_url", "image_url": {"url": image}}]
    req = urllib.request.Request(
        p["url"], data=json.dumps({"model": model, "messages": msgs, "max_tokens": max_tokens}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    return (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
