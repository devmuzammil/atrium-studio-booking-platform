import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /health', () => {
  it('returns a JSON success response without starting a server', async () => {
    const database = {
      $queryRaw: async (): Promise<number> => 1,
    };

    const response = await request(createApp({ database })).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/json/);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
