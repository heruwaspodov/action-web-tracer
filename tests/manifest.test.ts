import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('extension manifest', () => {
	it('uses the supported MV3 platform and local-only scripts', async () => {
		const manifest = JSON.parse(await readFile('manifest.json', 'utf8')) as {
			background: { service_worker: string; type: string };
			content_security_policy: { extension_pages: string };
			manifest_version: number;
			minimum_chrome_version: string;
			permissions: string[];
		};

		expect(manifest.manifest_version).toBe(3);
		expect(manifest.minimum_chrome_version).toBe('125');
		expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
		expect(manifest.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self';");
		expect(manifest.permissions).toEqual(['activeTab', 'debugger', 'scripting', 'sidePanel', 'storage']);
	});
});
