import { createServer } from 'node:http';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

// ★★★★★ Z.AI 私人中转 START ★★★★★
// 固定上游地址，调用者只能提交聊天参数；真实模型 Key 留在 Render 环境变量里。
const UPSTREAM_URL = 'https://api.z.ai/api/paas/v4/chat/completions';
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 180000;

export function createRelayServer({
  apiKey = process.env.ZAI_API_KEY,
  token = process.env.RELAY_TOKEN,
  origins = process.env.ALLOWED_ORIGINS || 'https://795799.xyz,https://www.795799.xyz',
  fetchUpstream = fetch
} = {}) {
  if (!apiKey || !token || token.length < 32) {
    throw new Error('请设置 ZAI_API_KEY 和至少 32 字符的 RELAY_TOKEN');
  }
  const allowedOrigins = new Set(origins.split(',').map(s => s.trim()).filter(Boolean));
  const digest = value => createHash('sha256').update(value).digest();
  const expectedToken = digest(`Bearer ${token}`);
  let activeRequests = 0;

  return createServer(async (req, res) => {
    const reply = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    const path = new URL(req.url, 'http://relay.local').pathname;
    // ★ 健康检查仅确认进程可用，不调用 GLM，不消耗模型额度。
    if (path === '/healthz' && req.method === 'GET') return reply(200, { ok: true });
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return reply(403, { error: 'origin_not_allowed' });
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    if (!['/v1/chat/completions', '/v1/models'].includes(path)) return reply(404, { error: 'not_found' });
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.writeHead(204);
      return res.end();
    }
    // ★ CORS 不是鉴权；Worker 没有 Origin，也必须通过独立中转密码检查。
    if (!timingSafeEqual(digest(req.headers.authorization || ''), expectedToken)) {
      return reply(401, { error: 'relay_unauthorized' });
    }
    if (path === '/v1/models' && req.method === 'GET') {
      return reply(200, { object: 'list', data: [{ id: 'glm-5', object: 'model', owned_by: 'zai' }] });
    }
    if (path !== '/v1/chat/completions' || req.method !== 'POST') {
      res.setHeader('Allow', path === '/v1/models' ? 'GET' : 'POST');
      return reply(405, { error: 'method_not_allowed' });
    }
    // ★ 私人聊天最多同时转发四个请求，避免误触发大量并行任务。
    if (activeRequests >= 4) return reply(429, { error: 'relay_busy' });
    activeRequests++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    const onClose = () => { if (!res.writableFinished) controller.abort(); };
    res.on('close', onClose);
    const id = randomUUID();
    try {
      let bytes = 0;
      const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) return reply(413, { error: 'request_too_large' });
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return reply(400, { error: 'invalid_json' }); }
      if (!body || body.model !== 'glm-5' || !Array.isArray(body.messages) || !body.messages.length) {
        return reply(400, { error: 'expected_glm5_and_messages' });
      }
      const upstream = await fetchUpstream(UPSTREAM_URL, {
        method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json', Accept: 'application/json',
          'Accept-Language': 'en-US,en', 'User-Agent': 'TeleWindy-Relay/1.0'
        },
        body: JSON.stringify(body)
      });
      // ★ 日志仅保留状态与定位编号；聊天正文、请求头和真实 Key 均不打印。
      console.log(JSON.stringify({ event: 'zai_response', id, status: upstream.status,
        contentType: upstream.headers.get('content-type'), cfRay: upstream.headers.get('cf-ray') }));
      if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel();
        return reply(502, { error: 'upstream_redirect', status: upstream.status, id });
      }
      // ★ 按流转发成功及错误响应，不缓存整段回复；原始 405 可继续用于定位。
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
        'X-Relay-Request-Id': id
      });
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res);
      else res.end();
    } catch {
      const error = controller.signal.aborted ? 'relay_timeout_or_disconnected' : 'relay_network_error';
      console.warn(JSON.stringify({ event: error, id }));
      if (!res.headersSent && !res.destroyed) reply(controller.signal.aborted ? 504 : 502, { error, id });
      else res.destroy();
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
      activeRequests--;
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createRelayServer();
  server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.log('zai_relay_ready'));
}
// ★★★★★ Z.AI 私人中转 END ★★★★★
