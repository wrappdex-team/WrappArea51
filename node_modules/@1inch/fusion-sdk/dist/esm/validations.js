import { isAddress } from 'ethers';
export function isValidAddress(address) {
    return isAddress(address);
}
export function isValidAmount(value) {
    try {
        var amount = BigInt(value);
        return amount >= 0n;
    } catch (e) {
        return false;
    }
}
var HEX_REGEX = /^(0x)[0-9a-f]+$/i;
export function isHexString(val) {
    return HEX_REGEX.test(val.toLowerCase());
}
/**
 * Check that string is valid hex with 0x prefix and length is even
 * @param val
 */ export function isHexBytes(val) {
    return isHexString(val) && val.length % 2 === 0;
}
