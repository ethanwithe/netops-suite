/* NetOps Suite · service worker: la app abre y funciona sin conexión.
 *  - Programa (HTML/JS/CSS): se guarda al usarla; sin Internet se abre desde el equipo.
 *  - Fotos subidas: inmutables, se guardan; las que aún no se subieron se sirven desde la cola local (IndexedDB).
 *  - Datos de la API (clientes, ventanas...) NO se guardan aquí: viven en la base local de la app (ver src/sync).
 */
const VERSION = "v1";
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

function pendingPhoto(name) {
  const id = name.replace(/\.[^.]+$/, "");
  return new Promise((res) => {
    try {
      const rq = indexedDB.open("netops-sync");
      rq.onerror = () => res(null);
      rq.onsuccess = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains("photos")) { db.close(); res(null); return; }
        const g = db.transaction("photos").objectStore("photos").get(id);
        g.onsuccess = () => { db.close(); res(g.result ? g.result.blob : null); };
        g.onerror = () => { db.close(); res(null); };
      };
    } catch { res(null); }
  });
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
    if (net.ok && (url.pathname.startsWith("/assets/") || /\.(png|jpg|svg|webmanifest|woff2?)$/.test(url.pathname))) cache.put(req, net.clone());
    return net;
  })());
});
