"""
IA para el editor de imágenes.

- /adjust  (Claude con visión, ANTHROPIC_API_KEY): entiende la foto y lo que pide el
  usuario y devuelve ajustes (brillo, sombras, nitidez…), un recorte sugerido y zonas a
  difuminar. No inventa píxeles: es seguro para evidencias.
- /edit    (edición generativa, OPENAI_API_KEY): cambia la imagen según la instrucción
  (quitar objetos, cambiar fondo, limpiar, etc.). Modifica el contenido de la foto.
Sin las claves, el editor usa su mejora local y avisa.
"""
import base64
import json
import os
import re
import urllib.error
import urllib.request
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import llm

router = APIRouter(prefix="/api/imageai", tags=["imageai"])

VISION_MODEL = os.getenv("IMAGE_AI_MODEL", "claude-sonnet-5-5").strip() or "claude-sonnet-5-5"
EDIT_MODEL = os.getenv("IMAGE_EDIT_MODEL", "gpt-image-1").strip() or "gpt-image-1"
MAX_B64 = 8_000_000

SYSTEM = """Eres el asistente de edición de fotos de una herramienta de documentación técnica (redes, fibra óptica, equipos, instalaciones).
Recibes una foto y una instrucción en español. Responde SOLO con un JSON (sin texto extra) con esta forma:
{"note": "explicación breve en español de lo que hiciste y por qué",
 "adjust": {"brightness": -100..100, "contrast": -100..100, "saturation": -100..100, "sharpen": 0..100,
            "shadows": 0..100, "highlights": 0..100, "warmth": -100..100, "denoise": 0..100, "gray": true|false, "auto": true|false},
 "crop": null | {"x": 0..1, "y": 0..1, "w": 0..1, "h": 0..1},
 "blur": [{"x": 0..1, "y": 0..1, "w": 0..1, "h": 0..1}]}
Reglas:
- Analiza la foto de verdad (oscura, borrosa, contraluz, reflejos, ruido, tonos amarillos…) y elige ajustes moderados y útiles; omite o deja en 0 lo que no haga falta.
- 'highlights' reduce las luces quemadas; 'shadows' aclara sombras; 'warmth' negativo enfría, positivo calienta.
- 'crop' solo si el usuario pide encuadrar/recortar algo concreto; coordenadas relativas al ancho y alto de la imagen.
- 'blur' solo si piden difuminar o proteger datos (caras, placas de vehículos, pantallas con datos sensibles, etiquetas con nombres); lista cada zona con su caja.
- Nunca inventes contenido: solo ajustes, recorte y zonas a difuminar."""


class AdjustIn(BaseModel):
    image: str = Field(max_length=MAX_B64)  # data URL jpeg/png
    prompt: str = Field(default="", max_length=600)


def _anthropic_key() -> str:
    return os.getenv("ANTHROPIC_API_KEY", "").strip()


def _openai_key() -> str:
    return os.getenv("OPENAI_API_KEY", "").strip()


@router.get("/status")
def status():
    return {"adjust": bool(_anthropic_key()) or bool(llm.free_provider()), "edit": bool(_openai_key())}


def _num(v, lo, hi, default=0):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return default


def _box(b):
    try:
        x, y, w, h = (_num(b.get(k), 0, 1) for k in ("x", "y", "w", "h"))
    except AttributeError:
        return None
    if w < 0.01 or h < 0.01:
        return None
    return {"x": x, "y": y, "w": min(w, 1 - x), "h": min(h, 1 - y)}


@router.post("/adjust")
def adjust(body: AdjustIn):
    key = _anthropic_key()
    if not key and not llm.free_provider():
        raise HTTPException(503, "IA no configurada")
    m = re.match(r"data:(image/(?:jpeg|png|webp));base64,(.+)$", body.image, re.S)
    if not m:
        raise HTTPException(400, "Imagen inválida")
    prompt = body.prompt.strip() or "Mejora la calidad general de la foto para un informe técnico."
    if key:
        payload = {
            "model": VISION_MODEL,
            "max_tokens": 700,
            "system": SYSTEM,
            "messages": [{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": m.group(1), "data": m.group(2)}},
                {"type": "text", "text": f"Instrucción del usuario: {prompt}"},
            ]}],
        }
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages", data=json.dumps(payload).encode(),
            headers={"content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read())
        except urllib.error.HTTPError as e:
            raise HTTPException(502, f"La IA respondió {e.code}")
        except Exception:
            raise HTTPException(502, "No se pudo contactar a la IA")
        text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    else:
        try:
            text = llm.complete(SYSTEM, [{"role": "user", "content": f"Instrucción del usuario: {prompt}"}], 700, image=body.image)
        except urllib.error.HTTPError as e:
            raise HTTPException(502, f"La IA respondió {e.code}")
        except Exception:
            raise HTTPException(502, "No se pudo contactar a la IA")
    j = re.search(r"\{.*\}", text, re.S)
    try:
        res = json.loads(j.group(0)) if j else {}
    except json.JSONDecodeError:
        res = {}
    a = res.get("adjust") or {}
    out = {
        "brightness": _num(a.get("brightness"), -100, 100), "contrast": _num(a.get("contrast"), -100, 100),
        "saturation": _num(a.get("saturation"), -100, 100), "sharpen": _num(a.get("sharpen"), 0, 100),
        "shadows": _num(a.get("shadows"), 0, 100), "highlights": _num(a.get("highlights"), 0, 100),
        "warmth": _num(a.get("warmth"), -100, 100), "denoise": _num(a.get("denoise"), 0, 100),
        "gray": bool(a.get("gray")), "auto": bool(a.get("auto")),
    }
    crop = _box(res["crop"]) if isinstance(res.get("crop"), dict) else None
    blur = [b for b in (_box(x) for x in (res.get("blur") or [])[:12] if isinstance(x, dict)) if b]
    return {"note": str(res.get("note") or "Listo.")[:400], "adjust": out, "crop": crop, "blur": blur}


@router.post("/edit")
async def edit(file: UploadFile = File(...), prompt: str = Form(...)):
    key = _openai_key()
    if not key:
        raise HTTPException(503, "Edición generativa no configurada")
    prompt = prompt.strip()[:900]
    if not prompt:
        raise HTTPException(400, "Escribe qué quieres cambiar")
    img = await file.read()
    if len(img) > 12_000_000:
        raise HTTPException(413, "Imagen demasiado grande")
    ctype = file.content_type or "image/jpeg"
    ext = "png" if "png" in ctype else "jpg"
    boundary = uuid.uuid4().hex
    parts = []
    for k, v in (("model", EDIT_MODEL), ("prompt", prompt), ("n", "1")):
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="foto.{ext}"\r\nContent-Type: {ctype}\r\n\r\n'.encode() + img + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        "https://api.openai.com/v1/images/edits", data=b"".join(parts),
        headers={"Authorization": f"Bearer {key}", "Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise HTTPException(502, f"El servicio de edición respondió {e.code}")
    except Exception:
        raise HTTPException(502, "No se pudo contactar al servicio de edición")
    item = (data.get("data") or [{}])[0]
    if item.get("b64_json"):
        return {"image": "data:image/png;base64," + item["b64_json"]}
    if item.get("url"):
        try:
            with urllib.request.urlopen(item["url"], timeout=60) as r:
                return {"image": "data:image/png;base64," + base64.b64encode(r.read()).decode()}
        except Exception:
            pass
    raise HTTPException(502, "El servicio no devolvió imagen")
