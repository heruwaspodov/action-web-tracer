const result = document.querySelector('#result');
const frame = document.querySelector('#fixture-frame');
const alternateOrigin = `${location.protocol}//${location.hostname === 'localhost' ? '127.0.0.1' : 'localhost'}:${location.port}`;

let fixtureSocket;

function report(message) {
	result.textContent = message;
}

function request(path, options) {
	return fetch(path, options).then(async (response) => ({ response, body: await response.json() }));
}

function connectSocket() {
	if (fixtureSocket?.readyState === WebSocket.OPEN || fixtureSocket?.readyState === WebSocket.CONNECTING) {
		return;
	}

	fixtureSocket = new WebSocket(`${location.origin.replace('http', 'ws')}/ws/preexisting`);
	fixtureSocket.addEventListener('message', () => report('Background WebSocket frame received'));
}

connectSocket();
frame.src = `${alternateOrigin}/frame.html`;

document.querySelectorAll('[data-scenario]').forEach((button) => {
	button.addEventListener('click', async () => {
		const { scenario } = button.dataset;

		switch (scenario) {
			case 'healthy':
			case 'polling-overlap':
			case 'analytics-overlap':
			case 'websocket-background-receive': {
				if (scenario === 'analytics-overlap') {
					void request('/api/analytics');
				}
				await request('/api/healthy');
				report('Healthy action completed');
				break;
			}
			case 'uncaught':
				setTimeout(() => {
					throw new Error('fixture uncaught exception');
				}, 0);
				break;
			case 'patch-without-ui':
				await request('/api/patch', { method: 'PATCH' });
				break;
			case 'silent':
				break;
			case 'websocket-send':
				fixtureSocket?.send('action');
				break;
			case 'rapid-actions':
				void request('/api/rapid-one');
				void request('/api/rapid-two');
				break;
			case 'request-outlives-window':
				void request('/api/slow');
				break;
			case 'same-origin-reload':
				location.reload();
				break;
			case 'cross-origin-coverage-loss':
				location.assign(alternateOrigin);
				break;
			case 'child-frame-action':
				frame.contentWindow?.postMessage({ type: 'fixture-child-action' }, alternateOrigin);
				break;
			case 'debugger-detach':
			case 'storage-quota':
				document.dispatchEvent(new CustomEvent('awt-fixture-control', { detail: scenario }));
				report(`Harness control requested: ${scenario}`);
				break;
			case 'secret-redaction':
				await request('/api/secret', { headers: { authorization: 'Bearer fixture-token-7c27db4f' } });
				report('fixture-api-key-4ebcc427 fixture.user@example.test');
				break;
		}
	});
});

document.querySelector('#fixture-form').addEventListener('submit', async (event) => {
	event.preventDefault();
	const submitter = event.submitter;
	if (!(submitter instanceof HTMLButtonElement)) {
		return;
	}

	if (submitter.value === 'chain') {
		await request('/api/chain-submit', { method: 'POST' });
		report('Submit chain completed');
		return;
	}

	await request('/api/validation', { method: 'POST' });
	if (submitter.value === 'visible') {
		report('Validation message: email is required');
	}
});

void request('/api/poll');
setInterval(() => void request('/api/poll'), 150);
