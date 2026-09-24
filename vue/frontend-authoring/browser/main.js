import { createApp } from 'vue';
import { App } from '../dist/app.transformed.mjs';
import logoUrl from './logo.svg';
import './styles.css';

document.querySelector('#asset-probe').src = logoUrl;
createApp(App).mount('#root');
