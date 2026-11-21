/* NetOps Suite · service worker: la app abre y funciona sin conexión.
 *  - Programa (HTML/JS/CSS): se guarda al usarla; sin Internet se abre desde el equipo.
 *  - Fotos subidas: inmutables, se guardan; las que aún no se subieron se sirven desde la cola local (IndexedDB).
 *  - Datos de la API (clientes, ventanas...) NO se guardan aquí: viven en la base local de la app (ver src/sync).
 */
const VERSION = "v2";
const SHELL = "netops-shell-" + VERSION;
const PHOTOS = "netops-photos-" + VERSION;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![SHELL, PHOTOS].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("message", (e) => {
  if (e.data === "clear") e.waitUntil(Promise.all([caches.delete(SHELL), caches.delete(PHOTOS)]));   // al cerrar sesión
});

function idbGet(store, key) {
  return new Promise((res) => {
    try {
      const rq = indexedDB.open("netops-sync");
      rq.onerror = () => res(null);
      rq.onsuccess = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains(store)) { db.close(); res(null); return; }
        const g = db.transaction(store).objectStore(store).get(key);
        g.onsuccess = () => { db.close(); res(g.result || null); };
        g.onerror = () => { db.close(); res(null); };
      };
    } catch { res(null); }
  });
}
async function pendingPhoto(name) {
  const r = await idbGet("photos", name.replace(/\.[^.]+$/, ""));
  return r ? r.blob : null;
}
const MIME = { pdf: "application/pdf", zip: "application/zip", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
function fromOutput(o, name) {
  const ext = name.split(".").pop().toLowerCase();
  return new Response(o.blob, { headers: { "Content-Type": MIME[ext] || o.blob.type || "application/octet-stream", "Content-Disposition": "inline; filename*=UTF-8''" + encodeURIComponent(name) } });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith("/api/files/uploads/")) {
    e.respondWith((async () => {
      const name = decodeURIComponent(url.pathname.split("/").pop());
      const local = await pendingPhoto(name);
      if (local) return new Response(local, { headers: { "Content-Type": local.type || "image/jpeg" } });
      const cache = await caches.open(PHOTOS);
      const hit = await cache.match(req);
      if (hit) return hit;
      const net = await fetch(req);
      if (net.ok) cache.put(req, net.clone());
      return net;
    })());
    return;
  }
  // Archivos generados: los de este equipo que aún no se subieron salen de la base local; si no hay red, también los ya subidos.
  if (url.pathname.startsWith("/api/files/outputs/")) {
    e.respondWith((async () => {
      const name = decodeURIComponent(url.pathname.split("/").pop());
      const loc = await idbGet("outputs", name);
      if (loc && !loc.synced) return fromOutput(loc, name);
      try { const net = await fetch(req); if (net.ok || !loc) return net; } catch (err) { if (!loc) throw err; }
      return fromOutput(loc, name);
    })());
    return;
  }
  // Logos e iconos de gráfica (los usan los generadores sin conexión): primero el equipo, se actualizan al haber red.
  if (/^\/api\/(logos\/[^/]+\/image|diagrams\/icons\/[^/]+\/image)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(PHOTOS);
      try { const net = await fetch(req); if (net.ok) { cache.put(req, net.clone()); return net; } } catch { /* sin red */ }
      return (await cache.match(req)) || Response.error();
    })());
    return;
  }
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      try { const net = await fetch(req); if (net.ok) cache.put("/", net.clone()); return net; }
      catch { return (await cache.match("/")) || Response.error(); }
    })());
    return;
  }
  // archivos con huella en el nombre (/assets/xxxx.js): no cambian, primero el equipo
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req);
    if (hit) return hit;
    const net = await fetch(req);
    if (net.ok && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/pyodide/") || /\.(png|jpg|svg|webmanifest|woff2?)$/.test(url.pathname))) cache.put(req, net.clone());
    return net;
  })());
});
