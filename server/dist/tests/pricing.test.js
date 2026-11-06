import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrice, overlaps } from '../src/domain/pricing.js';
test('day-use pricing combines package, guest fees and services then applies discount', () => {
    assert.equal(calculatePrice({ kind: 'DAY_USE', basePrice: 1000, extraAdultCount: 1, extraAdultFee: 100, extraChildCount: 2, extraChildFee: 50, serviceTotal: 300, discount: 100 }), 1400);
});
test('overnight pricing multiplies nightly rate by number of nights', () => {
    assert.equal(calculatePrice({ kind: 'OVERNIGHT', basePrice: 2000, nights: 3, serviceTotal: 250 }), 6250);
});
test('invalid negative amounts are rejected', () => {
    assert.throws(() => calculatePrice({ kind: 'DAY_USE', basePrice: -1 }), /non-negative/);
});
test('overnight requires at least one night', () => {
    assert.throws(() => calculatePrice({ kind: 'OVERNIGHT', basePrice: 1000, nights: 0 }), /at least one night/);
});
test('time intervals overlap only when they share occupied time', () => {
    assert.equal(overlaps('2026-12-01T10:00:00Z', '2026-12-01T12:00:00Z', '2026-12-01T11:00:00Z', '2026-12-01T13:00:00Z'), true);
    assert.equal(overlaps('2026-12-01T10:00:00Z', '2026-12-01T12:00:00Z', '2026-12-01T12:00:00Z', '2026-12-01T13:00:00Z'), false);
});
