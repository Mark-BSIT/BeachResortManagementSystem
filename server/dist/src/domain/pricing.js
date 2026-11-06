export function calculatePrice(input) {
    const values = [input.basePrice, input.extraAdultCount ?? 0, input.extraChildCount ?? 0,
        input.extraAdultFee ?? 0, input.extraChildFee ?? 0, input.serviceTotal ?? 0, input.discount ?? 0];
    if (values.some(v => !Number.isFinite(v) || v < 0))
        throw new Error('Prices and guest counts must be non-negative numbers');
    const nights = input.kind === 'OVERNIGHT' ? input.nights : 1;
    if (!Number.isInteger(nights) || (nights ?? 0) < 1)
        throw new Error('Overnight bookings require at least one night');
    const base = input.basePrice * (nights ?? 1);
    const total = base + (input.extraAdultCount ?? 0) * (input.extraAdultFee ?? 0)
        + (input.extraChildCount ?? 0) * (input.extraChildFee ?? 0)
        + (input.serviceTotal ?? 0) - (input.discount ?? 0);
    return Math.max(0, Math.round(total * 100) / 100);
}
export function overlaps(startA, endA, startB, endB) {
    return startA < endB && startB < endA;
}
