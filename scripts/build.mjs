import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const outputDirectory = 'dist';

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });

await Promise.all([
	build({
		bundle: true,
		entryPoints: ['src/background/service-worker.ts'],
		format: 'esm',
		outfile: `${outputDirectory}/background.js`,
		platform: 'browser',
		target: 'chrome125',
	}),
	build({
		bundle: true,
		entryPoints: ['src/probe/page-probe.ts'],
		format: 'iife',
		outfile: `${outputDirectory}/page-probe.js`,
		platform: 'browser',
		target: 'chrome125',
	}),
	build({
		bundle: true,
		entryPoints: ['src/sidepanel/main.ts'],
		format: 'esm',
		outfile: `${outputDirectory}/sidepanel.js`,
		platform: 'browser',
		target: 'chrome125',
	}),
]);

await Promise.all([
	cp('manifest.json', `${outputDirectory}/manifest.json`),
	cp('sidepanel.html', `${outputDirectory}/sidepanel.html`),
	cp('sidepanel.css', `${outputDirectory}/sidepanel.css`),
]);

const packagedFiles = await Promise.all(
	['background.js', 'page-probe.js', 'sidepanel.html', 'sidepanel.css', 'sidepanel.js'].map(async (fileName) =>
		readFile(`${outputDirectory}/${fileName}`, 'utf8'),
	),
);

if (packagedFiles.some((file) => /https?:\/\//u.test(file))) {
	throw new Error('Extension artifacts must not load remote resources.');
}
