export function now() {
    return BigInt(Math.floor(Date.now() / 1000));
}
