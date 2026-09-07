import http from 'node:http';

const port = Number(process.env.VELA_QA_PROVIDER_PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error('VELA_QA_PROVIDER_PORT is required');
const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const models = ['qa-prompt', 'qa-qwen-vl', 'qa-image'];
let imageFailuresRemaining = 0;

const sendJson = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
};

http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
  if (request.method === 'POST' && url.pathname === '/qa/fail-next-images') {
    imageFailuresRemaining = Math.max(0, Number.parseInt(url.searchParams.get('count') || '1', 10) || 0);
    return sendJson(response, 200, { imageFailuresRemaining });
  }
  if (request.method === 'GET' && url.pathname === '/v1/models') {
    return sendJson(response, 200, { data: models.map((id) => ({ id })) });
  }
  let received = 0;
  request.on('data', (chunk) => {
    received += chunk.length;
    if (received > 20 * 1024 * 1024) request.destroy();
  });
  request.on('end', () => {
    if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
      return sendJson(response, 200, { choices: [{ message: { content: '只把裤子改为纯黑色，其他内容不变。' } }] });
    }
    if (request.method === 'POST' && ['/v1/images/edits', '/v1/images/generations'].includes(url.pathname)) {
      if (imageFailuresRemaining > 0) {
        imageFailuresRemaining -= 1;
        return sendJson(response, 503, { error: { message: 'QA injected image failure' } });
      }
      return sendJson(response, 200, { data: [{ b64_json: imageBase64, revised_prompt: '本地自动验收结果' }] });
    }
    return sendJson(response, 404, { error: { message: 'not found' } });
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`QA provider ready on http://127.0.0.1:${port}/v1`);
});
