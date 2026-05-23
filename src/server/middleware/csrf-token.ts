import { randomBytes } from 'crypto';

let token: string | null = null;

export function generateCsrfToken(): string {
  token = randomBytes(32).toString('hex');
  return token;
}

export function getCsrfToken(): string {
  if (!token) throw new Error('CSRF token not initialized — call generateCsrfToken() at boot');
  return token;
}

export function resetCsrfTokenForTests(): void {
  token = null;
}
