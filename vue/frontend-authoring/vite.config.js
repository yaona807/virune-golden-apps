import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vueJsx from '@vitejs/plugin-vue-jsx';
import { defineConfig } from 'vite';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export default defineConfig({
	root: resolve(projectRoot, 'frontend-authoring/browser'),
	plugins: [vueJsx()],
	server: {
		host: '127.0.0.1',
		port: 0,
		strictPort: false,
		fs: { allow: [projectRoot] },
	},
});
