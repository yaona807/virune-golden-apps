import axios from 'axios';

const client = axios.create({
	timeout: 2500,
	headers: { Accept: 'text/plain' },
});
const uri = client.getUri({
	url: 'data:text/plain,safe',
	responseType: 'text',
});
const response = await client.get('data:text/plain,safe', {
	responseType: 'text',
});

export const result = `ecosystem:axios:${uri}:${response.status}`;
