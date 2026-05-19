import { add0x, UINT_160_MAX } from '@1inch/byte-utils';
import assert from 'assert';
/**
 * Contains highest bits of address (>UINT_160_MAX) if address is bigger than UINT_160_MAX
 *
 * @see SolanaAddress.splitToParts
 */
export class AddressComplement {
    inner;
    static ZERO = new AddressComplement(0n);
    constructor(inner) {
        this.inner = inner;
        assert(inner <= UINT_160_MAX);
    }
    asHex() {
        const hex = this.inner.toString(16);
        return add0x(hex.length % 2 ? '0' + hex : hex);
    }
    isZero() {
        return this.inner == 0n;
    }
}
//# sourceMappingURL=address-complement.js.map