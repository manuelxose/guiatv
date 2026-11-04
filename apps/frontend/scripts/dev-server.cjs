const http = require('node:http');
const { spawn } = require('node:child_process');
const httpProxy = require('http-proxy');

const LOCAL = 'http://127.0.0.1:4000';
const PUBLIC = 'https://guiaprogramaciontv.com';

function localAvailable(local) {
  return new Promise((resolve) => {
    const request = http.get(`${local}/v2/health`, { timeout: 1000 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

function createRouter(local = LOCAL, remote = PUBLIC) {
  const selectTarget = async () => (await localAvailable(local)) ? local : remote;
  const proxy = httpProxy.createProxyServer({ changeOrigin: true, ws: true });
  proxy.on('error', (error, _request, response) => {
    console.error('Development API proxy:', error.message);
    if (response.writeHead) {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    } else response.destroy();
  });
  const server = http.createServer(async (request, response) => {
    try { proxy.web(request, response, { target: await selectTarget() }); }
    catch (error) { response.writeHead(502); response.end(error.message); }
  });
  server.on('upgrade', async (request, socket, head) => {
    try { proxy.ws(request, socket, head, { target: await selectTarget() }); }
    catch { socket.destroy(); }
  });
  return server;
}

if (require.main === module) {
  const server = createRouter();
  server.listen(0, '127.0.0.1', () => {
    const target = process.env.GUIATV_PROXY_TARGET || `http://127.0.0.1:${server.address().port}`;
    const env = { ...process.env, GUIATV_PROXY_TARGET: target, SSR_API_BASE_URL: process.env.SSR_API_BASE_URL || target };
    const cli = require.resolve('@angular/cli/bin/ng.js');
    const child = spawn(process.execPath, [cli, 'serve', '--proxy-config', 'proxy.conf.js', ...process.argv.slice(2)], { stdio: 'inherit', env });
    child.on('error', (error) => { console.error(error); server.close(); process.exitCode = 1; });
    child.on('exit', (code, signal) => { server.close(); process.exitCode = code ?? (signal ? 1 : 0); });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  });
}

module.exports = { createRouter };
