import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRelayServer, RELAY_VERSION } from './server.mjs';

// ★ 本地假上游验证鉴权边界和响应转发，不调用真实 API，也不消耗模型额度。
test('私人中转鉴权、CORS、固定上游与原始错误透传', async () => {
  const token = 'test-relay-token-12345678901234567890';
  const calls = [];
  let status = 200;
  const server = createRelayServer({ apiKey: 'test-zai-key', moonshotApiKey: 'test-moonshot-key', token,
    fetchUpstream: async (url, options) => {
      calls.push({ url, options });
      return new Response(status === 200 ? '{"choices":[{"message":{"content":"Hello"}}]}' : '<html>405</html>',
        { status, headers: { 'content-type': status === 200 ? 'application/json' : 'text/html' } });
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (body, extra = {}) => fetch(`${base}/v1/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify(body)
  });
  try {
    // ★ 健康检查必须回带版本名，部署后靠它确认新代码已上线。
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).version, RELAY_VERSION);
    assert.equal((await fetch(`${base}/v1/models`)).status, 401);
    const preflight = await fetch(`${base}/v1/chat/completions`, { method: 'OPTIONS',
      headers: { Origin: 'https://www.795799.xyz' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://www.795799.xyz');
    assert.equal((await send({}, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await send({ model: 'other', messages: [{}] })).status, 400);
    assert.equal(calls.length, 0);
    const body = { model: 'glm-5', messages: [{ role: 'user', content: 'Hello' }], stream: false };
    const response = await send(body);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).choices[0].message.content, 'Hello');
    assert.equal(calls[0].url, 'https://api.z.ai/api/paas/v4/chat/completions');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-zai-key');
    assert.equal(calls[0].options.redirect, 'manual');
    assert.deepEqual(JSON.parse(calls[0].options.body), body);
    const listed = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${token}` } });
    assert.deepEqual((await listed.json()).data.map(m => m.id),
      ['glm-5', 'glm-5.1', 'glm-5.2', 'glm-5.3-flash', 'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6']);
    for (const model of ['glm-5.1', 'glm-5.2', 'glm-5.3-flash', 'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6']) {
      const response = await send({ ...body, model });
      assert.equal(response.status, 200);
      await response.text();
      const call = calls.at(-1);
      const kimi = model.startsWith('kimi-');
      assert.equal(call.url, kimi ? 'https://api.moonshot.ai/v1/chat/completions' : 'https://api.z.ai/api/paas/v4/chat/completions');
      assert.equal(call.options.headers.Authorization, kimi ? 'Bearer test-moonshot-key' : 'Bearer test-zai-key');
      assert.equal(JSON.parse(call.options.body).model, model);
    }
    const before = calls.length;
    assert.equal((await send({ ...body, model: 'https://evil.example' })).status, 400);
    assert.equal(calls.length, before);
    status = 405;
    const failed = await send(body);
    assert.equal(failed.status, 405);
    assert.equal(await failed.text(), '<html>405</html>');
    status = 302;
    assert.equal((await send(body)).status, 502);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
