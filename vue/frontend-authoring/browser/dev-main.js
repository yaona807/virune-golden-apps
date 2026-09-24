import { createApp } from 'vue';
import { App } from '../dist/app.jsx';
import logoUrl from './logo.svg';
import './styles.css';

document.querySelector('#asset-probe').src = logoUrl;
let app = createApp(App);
app.mount('#root');

window.__viruneHmrEvents = [];
if (import.meta.hot) {
	import.meta.hot.accept('../dist/app.jsx', updated => {
		if (!updated) return;
		app.unmount();
		app = createApp(updated.App);
		app.mount('#root');
		window.__viruneHmrEvents.push('component-update');
	});
	import.meta.hot.on('vite:beforeUpdate', event => {
		window.__viruneHmrEvents.push(event.type ?? 'update');
	});
}
