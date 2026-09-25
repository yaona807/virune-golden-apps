import { createApp } from 'vue';
import { App } from '../dist/app.transformed.mjs';
import './styles.css';

const root = document.querySelector('#root');
if (!root) throw new Error('Missing Vue root element');
createApp(App, { initialStatus: root.dataset.initialStatus ?? '' }).mount(root);
