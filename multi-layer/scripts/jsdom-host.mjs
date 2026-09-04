import { JSDOM } from 'jsdom';

const hostDom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.document = hostDom.window.document;
