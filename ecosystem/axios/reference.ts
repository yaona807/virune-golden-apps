import axios from 'axios';

const uriClient = axios.create({
	baseURL: 'http://example.com/api',
});
const uri = uriClient.getUri({
	url: '/users',
});
const requestClient = axios.create();
const response = await requestClient.get('data:text/plain,safe', {
	responseType: 'text',
});

export const result = `ecosystem:axios:${uri}:${response.status}`;
