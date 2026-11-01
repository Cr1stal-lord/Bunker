// Сервер игры «Бункер»: статика + комнаты по 3-значному коду (SSE + POST). Без зависимостей.
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = {'.html':'text/html; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.json':'application/json','.js':'text/javascript','.css':'text/css'};
const HOST_ONLY = ['ph','rd','out','seats','cat','bk','res','h'];
const rooms = new Map(); // code -> Map(peerId -> {res, presence, creator, timer})

const snap = code => [...(rooms.get(code) || [])].map(([peer, c]) => ({peer, presence: c.presence}));
function bc(code) {
  const m = rooms.get(code); if (!m) return;
  const data = 'data: ' + JSON.stringify(snap(code)) + '\n\n';
  for (const c of m.values()) if (c.res) c.res.write(data);
}
function drop(code, id) {
  const m = rooms.get(code); if (!m) return;
  const c = m.get(id);
  if (c) { clearTimeout(c.timer); if (c.res) try { c.res.end(); } catch {} m.delete(id); }
  if (c && c.creator) { for (const k of [...m.keys()]) { const x = m.get(k); clearTimeout(x.timer); if (x.res) try { x.res.end(); } catch {} } m.clear(); }
  if (!m.size) rooms.delete(code); else bc(code);
}
const json = (res, st, obj) => { res.writeHead(st, {'Content-Type': 'application/json'}); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise(ok => {
  let s = ''; req.on('data', d => { s += d; if (s.length > 20000) req.destroy(); });
  req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } });
});
const okCode = c => /^\d{3}$/.test(c), okId = i => /^[\w]{6,40}$/.test(i);

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/events' && req.method === 'GET') {
    const code = u.searchParams.get('code'), id = u.searchParams.get('id');
    const c = rooms.get(code) && rooms.get(code).get(id);
    if (!c) return json(res, 404, {error: 'notfound'});
    clearTimeout(c.timer);
    if (c.res) try { c.res.end(); } catch {}
    c.res = res;
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'});
    res.write('retry: 2000\n\ndata: ' + JSON.stringify(snap(code)) + '\n\n');
    req.on('close', () => { if (c.res === res) { c.res = null; c.timer = setTimeout(() => drop(code, id), 20000); } });
    return;
  }
  if (req.method === 'POST' && u.pathname.startsWith('/api/')) {
    const b = await readBody(req), {code, id} = b;
    if (!okCode(code) || !okId(id)) return json(res, 400, {error: 'bad'});
    const op = u.pathname.slice(5);
    if (op === 'join') {
      let m = rooms.get(code);
      if (b.create) {
        if (m) return json(res, 409, {error: 'exists'});
        m = new Map(); rooms.set(code, m);
      } else {
        if (!m) return json(res, 404, {error: 'notfound'});
        const host = [...m.values()].find(c => c.presence.h);
        if (!host) return json(res, 404, {error: 'notfound'});
        if (host.presence.ph !== 'lobby') return json(res, 403, {error: 'started'});
        if (m.size >= 12) return json(res, 403, {error: 'full'});
      }
      const c = {res: null, presence: {}, creator: !!b.create, timer: null};
      c.timer = setTimeout(() => drop(code, id), 20000);
      m.set(id, c);
      return json(res, 200, {ok: 1});
    }
    const m = rooms.get(code), c = m && m.get(id);
    if (!c) return json(res, 404, {error: 'notfound'});
    if (op === 'presence') {
      const p = b.patch;
      if (!p || typeof p !== 'object' || JSON.stringify(p).length > 4000) return json(res, 400, {error: 'bad'});
      if (!c.creator) for (const k of HOST_ONLY) delete p[k];
      Object.assign(c.presence, p);
      bc(code);
      return json(res, 200, {ok: 1});
    }
    if (op === 'leave') { drop(code, id); return json(res, 200, {ok: 1}); }
    return json(res, 404, {error: 'bad'});
  }
  // статика
  let f = u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname);
  f = path.normalize(path.join(PUB, f));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, {'Content-Type': MIME[path.extname(f)] || 'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log('Бункер запущен: http://localhost:' + PORT));

setInterval(() => { for (const m of rooms.values()) for (const c of m.values()) if (c.res) c.res.write(': ping\n\n'); }, 20000);
