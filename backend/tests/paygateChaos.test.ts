import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { createCharge, signPaygateBody } from '../src/services/paygateService';

jest.useFakeTimers();

const app = createApp();
const charges = new Map<string, { chargeId: string; idempotencyKey: string; reference: string; amountMinor: number; currency: string; status: string }>();
const fetchMock = jest.fn().mockResolvedValue({ status: 200 });

function randomSequence(values: number[]): void {
  let index = 0;
  jest.spyOn(Math, 'random').mockImplementation(() => values[Math.min(index++, values.length - 1)]);
}

beforeEach(() => {
  process.env.PAYGATE_CHAOS = 'on';
  process.env.PAYGATE_SECRET = 'chaos-test-secret';
  delete process.env.VERCEL;
  global.fetch = fetchMock as unknown as typeof fetch;
  (jest.spyOn(prisma.paygateCharge, 'findUnique') as unknown as jest.Mock).mockImplementation(async ({ where }: any) => {
    return [...charges.values()].find((charge) => charge.idempotencyKey === where.idempotencyKey || charge.chargeId === where.chargeId) as never;
  });
  (jest.spyOn(prisma.paygateCharge, 'create') as unknown as jest.Mock).mockImplementation(async ({ data }: any) => {
    const charge = { ...data, status: 'PROCESSING' };
    charges.set(charge.idempotencyKey, charge);
    return charge as never;
  });
  (jest.spyOn(prisma.paygateCharge, 'update') as unknown as jest.Mock).mockImplementation(async ({ where, data }: any) => {
    const charge = [...charges.values()].find((item) => item.chargeId === where.chargeId);
    if (!charge) throw new Error('charge not found');
    charge.status = data.status;
    return charge as never;
  });
});

afterEach(() => {
  charges.clear();
  fetchMock.mockClear();
  jest.restoreAllMocks();
});

afterAll(() => {
  jest.useRealTimers();
  delete process.env.PAYGATE_CHAOS;
  delete process.env.PAYGATE_SECRET;
});

describe('Paygate chaos contract', () => {
  it('returns a transient 500, then succeeds on the same idempotency key without duplicating a charge', async () => {
    randomSequence([0.05, 0.5, 0.5, 0.5]);
    const body = { amount_minor: 45000, currency: 'PKR', reference: 'booking-transient' };
    const signature = signPaygateBody(JSON.stringify(body));
    const first = await request(app).post('/paygate/charges').set('Idempotency-Key', 'same-key').set('x-paygate-signature', signature).send(body);
    const retry = await request(app).post('/paygate/charges').set('Idempotency-Key', 'same-key').set('x-paygate-signature', signature).send(body);

    expect(first.status).toBe(500);
    expect(retry.status).toBe(202);
    expect(charges.size).toBe(1);
  });

  it('rejects invalid webhook signatures without invoking payment processing', async () => {
    const response = await request(app)
      .post('/api/paygate/webhook')
      .set('x-paygate-signature', 'invalid')
      .set('x-paygate-delivery', 'delivery-invalid')
      .send({ charge_id: 'ch_invalid', reference: 'booking-invalid', event: 'charge.succeeded', amount_minor: 100 });

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('delivers duplicate webhooks with distinct delivery attempts', async () => {
    randomSequence([0.5, 0.5, 0.2]);
    await createCharge(prisma, { idempotencyKey: 'duplicate-key', amountMinor: 100, currency: 'PKR', reference: 'booking-duplicate' });
    await jest.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const deliveries = fetchMock.mock.calls.map((call) => (call[1] as RequestInit).headers as Record<string, string>);
    expect(deliveries[0]['x-paygate-delivery']).not.toBe(deliveries[1]['x-paygate-delivery']);
  });

  it('supports the response/webhook race after the charge is persisted', async () => {
    randomSequence([0.5, 0.5, 0.5]);
    fetchMock.mockResolvedValue({ status: 200 });
    await createCharge(prisma, { idempotencyKey: 'race-key', amountMinor: 100, currency: 'PKR', reference: 'booking-race' });
    await jest.runAllTimersAsync();

    expect(charges.size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('holds a delayed webhook for 60 to 90 seconds before delivery', async () => {
    randomSequence([0.5, 0.01, 0.5]);
    await createCharge(prisma, { idempotencyKey: 'delayed-key', amountMinor: 100, currency: 'PKR', reference: 'booking-delayed' });

    expect(fetchMock).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60000);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});