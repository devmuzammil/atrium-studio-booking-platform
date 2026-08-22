import { apiRequest } from './client';
import type { User } from '../types';

export async function login(email: string, password: string): Promise<{ token: string; user: User }> {
  return apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function fetchMe(): Promise<{ user: User }> {
  return apiRequest('/api/auth/me');
}
