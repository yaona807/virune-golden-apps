import { startFrontendDevWorkflow } from './frontend-dev-workflow.mjs';

const workflow = await startFrontendDevWorkflow({
	onBuild(result) {
		if (!result.ok) console.error(`Virune rebuild failed (exit ${result.code ?? 'unknown'})`);
	},
});

console.log(`Virune Vue JSX dev server: ${workflow.url}`);
await new Promise(resolvePromise => {
	process.once('SIGINT', resolvePromise);
	process.once('SIGTERM', resolvePromise);
});
await workflow.close();
