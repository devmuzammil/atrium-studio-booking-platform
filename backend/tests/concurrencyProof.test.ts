import 'dotenv/config';

jest.setTimeout(60000);

const baseUrl = process.env.CONCURRENCY_API_URL;
const token = process.env.CONCURRENCY_USER_TOKEN;
const roomId = process.env.CONCURRENCY_ROOM_ID;
const start = process.env.CONCURRENCY_START;
const end = process.env.CONCURRENCY_END;
const equipmentId = process.env.CONCURRENCY_EQUIPMENT_ID;
const equipmentRoomIds = (process.env.CONCURRENCY_EQUIPMENT_ROOM_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const proofConfigured = Boolean(baseUrl && token && roomId && start && end);

async function postHold(targetRoomId: string, equipment: Array<{ equipmentTypeId: string; quantity: number }> = []) {
  const response = await fetch(`${baseUrl}/api/bookings/holds`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ roomId: targetRoomId, start, end, equipment }),
  });

  return { status: response.status, body: await response.json() as unknown };
}

(proofConfigured ? describe : describe.skip)('MANDATORY THREE-REPLICA CONCURRENCY PROOF', () => {
  it('allows exactly one active hold for 200 requests to the same room slot', async () => {
    const responses = await Promise.all(Array.from({ length: 200 }, () => postHold(roomId as string)));
    const successes = responses.filter((response) => response.status === 201);
    const conflicts = responses.filter((response) => response.status === 409);
    const unexpected = responses.filter((response) => ![201, 409].includes(response.status));

    console.log('Room proof counts', { successes: successes.length, conflicts: conflicts.length, unexpected: unexpected.length, samples: unexpected.slice(0, 5) });
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(199);
    expect(unexpected).toHaveLength(0);
  });

  const equipmentProofConfigured = proofConfigured && Boolean(equipmentId) && equipmentRoomIds.length > 0;
  (equipmentProofConfigured ? it : it.skip)('never reserves more than three equipment units across 200 requests', async () => {
    const responses = await Promise.all(Array.from({ length: 200 }, (_, index) => postHold(
      equipmentRoomIds[index % equipmentRoomIds.length],
      [{ equipmentTypeId: equipmentId as string, quantity: 1 }],
    )));
    const successes = responses.filter((response) => response.status === 201);
    const conflicts = responses.filter((response) => response.status === 409);
    const unexpected = responses.filter((response) => ![201, 409].includes(response.status));

    console.log('Equipment proof counts', { successes: successes.length, conflicts: conflicts.length, unexpected: unexpected.length, samples: JSON.stringify(unexpected.slice(0, 5)) });
    expect(successes.length).toBeLessThanOrEqual(3);
    expect(conflicts.length + successes.length).toBe(200);
    expect(unexpected).toHaveLength(0);
  });
});
