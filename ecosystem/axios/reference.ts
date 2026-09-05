import axios from 'axios';

const client = axios.create({
	baseURL: 'http://example.com/api',
});
const uri = client.getUri({
	url: '/users',
	params: { page: 2 },
});
const response = await client.get('data:text/plain,safe', {
	responseType: 'text',
});

export const result = `ecosystem:axios:${uri}:${response.status}`;
