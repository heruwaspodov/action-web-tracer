import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDirectory = fileURLToPath(new URL('./app/', import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function sendJson(response, status, body) {
	response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
	response.end(JSON.stringify(body));
}

function sendWebSocketText(socket, text) {
	const payload = Buffer.from(text);
	socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
}

const server = createServer(async (request, response) => {
	const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
	if (url.pathname.startsWith('/api/')) {
		const name = url.pathname.slice('/api/'.length);
		if (name === 'validation') return sendJson(response, 422, { error: 'email is required' });
		if (name === 'slow') return setTimeout(() => sendJson(response, 200, { ok: true }), 1_250);
		return sendJson(response, 200, { ok: true, name });
	}

	const requestedPath = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
	const filePath = join(fixtureDirectory, normalize(requestedPath));
	if (!filePath.startsWith(fixtureDirectory)) {
		response.writeHead(403).end();
		return;
	}

	try {
		const file = await stat(filePath);
		if (!file.isFile()) throw new Error('not a file');
		response.writeHead(200, { 'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream' });
		createReadStream(filePath).pipe(response);
	} catch {
		response.writeHead(404).end();
	}
});

server.on('upgrade', (request, socket) => {
	if (request.url !== '/ws/preexisting' || typeof request.headers['sec-websocket-key'] !== 'string') {
		socket.destroy();
		return;
	}

	const accept = createHash('sha1')
		.update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
		.digest('base64');
	socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
	setTimeout(() => sendWebSocketText(socket, 'background fixture frame'), 100);
});

server.listen(port, '0.0.0.0', () => {
	console.log(`ActionWebTracer fixtures: http://127.0.0.1:${port}`);
});
