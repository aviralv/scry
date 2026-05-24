import { Hono } from 'hono';
import { getCsrfToken } from '../middleware/csrf-token.js';

export const csrfRoute = new Hono().get('/', (c) => c.json({ token: getCsrfToken() }));
