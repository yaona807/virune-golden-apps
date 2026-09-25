import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { summaryFromStorage } from '../dist/domain.js';
import { processStoredJob } from '../dist/main.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const indexPath = resolve(repositoryRoot, 'vue/full-stack/browser/index.html');
const browserOutput = resolve(repositoryRoot, 'vue/full-stack/dist/browser');
const jobs = sqliteTable('jobs', {
	id: text('id').primaryKey(),
	status: text('status').notNull(),
	detail: text('detail').notNull(),
});

function jobSummary(row, id) {
	return row
		? summaryFromStorage(row.id, row.status, row.detail)
		: summaryFromStorage(id, 'queued', '');
}

function escapeHtmlAttribute(value) {
	return value.replace(/[&"<>']/gu, character => ({
		'&': '&amp;',
		'"': '&quot;',
		'<': '&lt;',
		'>': '&gt;',
		"'": '&#39;',
	})[character]);
}

export async function startFullStackServer({
	port = 0,
	hostname = '127.0.0.1',
} = {}) {
	const databasePath = resolve(process.cwd(), 'multi-layer-full-stack.sqlite');
	const sqlite = new Database(databasePath);
	sqlite.exec('DROP TABLE IF EXISTS jobs; CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT NOT NULL)');
	const db = drizzle({ client: sqlite });
	db.insert(jobs).values({ id: 'job-42', status: 'queued', detail: 'preview' }).run();

	const app = new Hono();
	const selectJob = id => db.select({ id: jobs.id, status: jobs.status, detail: jobs.detail })
		.from(jobs).where(eq(jobs.id, id)).all()[0];

	app.get('/', async c => {
		const row = selectJob('job-42');
		if (!row) return c.text(jobSummary(row, 'job-42'), 404);
		const template = await readFile(indexPath, 'utf8');
		const marker = 'data-initial-status=""';
		if (!template.includes(marker)) throw new Error('Full-stack HTML is missing the initial-status marker');
		const html = template.replace(marker, `data-initial-status="${escapeHtmlAttribute(jobSummary(row, row.id))}"`);
		return c.html(html);
	});

	app.get('/jobs/:id', c => {
		const id = c.req.param('id');
		const row = selectJob(id);
		return row ? c.text(jobSummary(row, id)) : c.text(jobSummary(row, id), 404);
	});

	app.post('/jobs/:id', async c => {
		const id = c.req.param('id');
		const row = selectJob(id);
		if (!row) return c.text(jobSummary(row, id), 404);
		if (row.status !== 'queued') return c.text(jobSummary(row, id), 409);
		const workerSummary = await processStoredJob(databasePath, id);
		const completed = selectJob(id);
		if (!completed || completed.status !== 'completed' || workerSummary !== jobSummary(completed, id)) {
			return c.text(workerSummary, 500);
		}
		return c.redirect('/', 303);
	});

	const assets = new Map([
		['/main.js', ['main.js', 'text/javascript; charset=utf-8']],
		['/main.js.map', ['main.js.map', 'application/json; charset=utf-8']],
		['/main.css', ['main.css', 'text/css; charset=utf-8']],
	]);
	for (const [route, [filename, contentType]] of assets) {
		app.get(route, async c => c.body(await readFile(resolve(browserOutput, filename)), 200, {
			'cache-control': 'no-store',
			'content-type': contentType,
		}));
	}

	let server;
	try {
		server = serve({ fetch: app.fetch, hostname, port });
		if (!server.listening) await once(server, 'listening');
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('Hono did not bind a TCP address');
		return {
			app,
			url: `http://${hostname}:${address.port}/`,
			async close() {
				await new Promise((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
				sqlite.close();
			},
		};
	} catch (error) {
		if (server?.listening) await new Promise(resolvePromise => server.close(() => resolvePromise()));
		sqlite.close();
		throw error;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const port = Number(process.env.PORT ?? 4173);
	const server = await startFullStackServer({ port });
	process.stdout.write(`Virune full-stack consumer: ${server.url}\n`);
	const stop = async () => {
		await server.close();
		process.exitCode = 0;
	};
	process.once('SIGINT', stop);
	process.once('SIGTERM', stop);
}
