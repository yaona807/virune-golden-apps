import { EventEmitter } from 'node:events';
import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceDirectory = resolve(projectRoot, 'frontend-authoring/src');
const compilerEntry = resolve(projectRoot, 'node_modules/virune/dist/src/entry.js');
const viteConfig = resolve(projectRoot, 'frontend-authoring/vite.config.js');

function compile() {
	return new Promise(resolvePromise => {
		const child = spawn(process.execPath, [compilerEntry, 'build', 'frontend-authoring'], {
			cwd: projectRoot,
			stdio: 'inherit',
		});
		child.once('error', error => resolvePromise({ ok: false, code: null, error: error.message }));
		child.once('close', code => resolvePromise({ ok: code === 0, code }));
	});
}

export async function startFrontendDevWorkflow({ onBuild, port = 0 } = {}) {
	const initialBuild = await compile();
	if (!initialBuild.ok) throw new Error(`Virune initial build failed (exit ${initialBuild.code})`);

	const server = await createServer({
		configFile: viteConfig,
		logLevel: 'error',
		server: { host: '127.0.0.1', port, strictPort: port !== 0 },
	});
	await server.listen();

	const events = new EventEmitter();
	let timer;
	let runningBuild;
	let pendingBuild = false;
	let closed = false;

	const runQueuedBuild = async () => {
		if (closed) return;
		if (runningBuild) {
			pendingBuild = true;
			return;
		}
		runningBuild = compile();
		const result = await runningBuild;
		events.emit('build', result);
		onBuild?.(result);
		runningBuild = undefined;
		if (pendingBuild) {
			pendingBuild = false;
			scheduleBuild();
		}
	};

	const scheduleBuild = () => {
		clearTimeout(timer);
		timer = setTimeout(() => { void runQueuedBuild(); }, 100);
	};

	const watcher = watch(sourceDirectory, { persistent: true }, (_event, filename) => {
		if (filename === null || filename.toString() === 'app.virune') scheduleBuild();
	});

	const baseUrl = server.resolvedUrls?.local?.[0];
	if (!baseUrl) {
		watcher.close();
		await server.close();
		throw new Error('Vite did not report a local development URL');
	}

	return {
		url: new URL('dev.html', baseUrl).href,
		events,
		async close() {
			closed = true;
			clearTimeout(timer);
			watcher.close();
			if (runningBuild) await runningBuild;
			await server.close();
		},
	};
}
