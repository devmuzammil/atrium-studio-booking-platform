import { defaultRefundTerms } from '../src/services/cancellationService';

describe('default cancellation policy', () => {
  it.each([
    [49, { roomPercent: 100, equipmentPercent: 100 }],
    [48, { roomPercent: 50, equipmentPercent: 100 }],
    [24, { roomPercent: 50, equipmentPercent: 100 }],
    [3, { roomPercent: 0, equipmentPercent: 100 }],
    [2, { roomPercent: 0, equipmentPercent: 0 }],
    [0, { roomPercent: 0, equipmentPercent: 0 }],
  ])('calculates terms at %s hours before start', (hours, expected) => {
    expect(defaultRefundTerms(hours)).toEqual(expected);
  });
});