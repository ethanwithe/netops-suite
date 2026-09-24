"""
ws_utils.py
Patron reutilizable para correr una funcion bloqueante (SSH/Serial) en un
hilo aparte y transmitir su progreso en vivo por WebSocket, terminando con
un mensaje final de resultado o error.
"""

import asyncio
import queue
import threading

from fastapi import WebSocket


async def run_streaming(websocket: WebSocket, blocking_fn):
    """
    blocking_fn(progress_cb) -> result_dict
    Se ejecuta en un hilo; progress_cb(msg:str) encola mensajes que se
    reenvian al cliente como {"type":"log","message":...} en tiempo real.
    Al terminar, envia {"type":"done","result":...} o
    {"type":"error","message":...}.
    """
    q: "queue.Queue" = queue.Queue()
    result_holder = {}

    def progress_cb(msg):
        q.put({"type": "log", "message": msg})

    def worker():
        try:
            result = blocking_fn(progress_cb)
            result_holder["ok"] = True
            result_holder["result"] = result
        except Exception as e:
            result_holder["ok"] = False
            result_holder["error"] = str(e)
        finally:
            q.put(None)

    t = threading.Thread(target=worker, daemon=True)
    t.start()

    loop = asyncio.get_event_loop()
    while True:
        item = await loop.run_in_executor(None, q.get)
        if item is None:
            break
        await websocket.send_json(item)

    if result_holder.get("ok"):
        await websocket.send_json({"type": "done", "result": result_holder.get("result")})
    else:
        await websocket.send_json({"type": "error", "message": result_holder.get("error", "Error desconocido")})
