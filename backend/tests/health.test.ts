import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /health', () => {
  it('returns a JSON success response without starting a server', async () => {
    const database = {
      $queryRaw: async (): Promise<number> => 1,
    };
    const paygateHealth = { count: async (): Promise<number> => 0 };

    const response = await request(createApp({ database, paygateHealth })).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/json/);
    expect(response.body).toEqual({ status: 'ok', dependencies: { postgres: 'ok', paygate: 'ok' } });
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('returns 503 when a dependency is unavailable', async () => {
    const database = { $queryRaw: async (): Promise<never> => { throw new Error('database unavailable'); } };
    const paygateHealth = { count: async (): Promise<number> => 0 };

    const response = await request(createApp({ database, paygateHealth }))
      .get('/health')
      .set('X-Request-ID', 'health-test-request');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unhealthy');
    expect(response.headers['x-request-id']).toBe('health-test-request');
  });

  it('allows only the configured CORS origin', async () => {
    const previousOrigin = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://atrium-one.vercel.app';
    try {
      const database = { $queryRaw: async (): Promise<number> => 1 };
      const paygateHealth = { count: async (): Promise<number> => 0 };
      const app = createApp({ database, paygateHealth });
      const allowed = await request(app).get('/health').set('Origin', 'https://atrium-one.vercel.app');
      const denied = await request(app).get('/health').set('Origin', 'https://other.example');

      expect(allowed.headers['access-control-allow-origin']).toBe('https://atrium-one.vercel.app');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      if (previousOrigin === undefined) delete process.env.CORS_ORIGIN;
      else process.env.CORS_ORIGIN = previousOrigin;
    }
  });

  it('handles preflight and rejects unrelated origins without a wildcard in production', async () => {
    const previousOrigin = process.env.CORS_ORIGIN;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.CORS_ORIGIN = 'https://atrium-one.vercel.app';
    process.env.NODE_ENV = 'production';
    try {
      const database = { $queryRaw: async (): Promise<number> => 1 };
      const paygateHealth = { count: async (): Promise<number> => 0 };
      const app = createApp({ database, paygateHealth });
      const preflight = await request(app)
        .options('/api/bookings/holds')
        .set('Origin', 'https://atrium-one.vercel.app')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Authorization, Content-Type');
      const unrelated = await request(app).get('/health').set('Origin', 'https://other.example');

      expect(preflight.status).toBe(204);
      expect(preflight.headers['access-control-allow-origin']).toBe('https://atrium-one.vercel.app');
      expect(preflight.headers['access-control-allow-headers']).toContain('Authorization');
      expect(preflight.headers['access-control-allow-methods']).toContain('POST');
      expect(unrelated.headers['access-control-allow-origin']).toBeUndefined();
      expect(unrelated.headers['access-control-allow-origin']).not.toBe('*');
    } finally {
      if (previousOrigin === undefined) delete process.env.CORS_ORIGIN;
      else process.env.CORS_ORIGIN = previousOrigin;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
