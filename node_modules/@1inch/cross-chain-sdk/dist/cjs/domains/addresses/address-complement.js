"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddressComplement = void 0;
const byte_utils_1 = require("@1inch/byte-utils");
const assert_1 = __importDefault(require("assert"));
/**
 * Contains highest bits of address (>UINT_160_MAX) if address is bigger than UINT_160_MAX
 *
 * @see SolanaAddress.splitToParts
 */
class AddressComplement {
    inner;
    static ZERO = new AddressComplement(0n);
    constructor(inner) {
        this.inner = inner;
        (0, assert_1.default)(inner <= byte_utils_1.UINT_160_MAX);
    }
    asHex() {
        const hex = this.inner.toString(16);
        return (0, byte_utils_1.add0x)(hex.length % 2 ? '0' + hex : hex);
    }
    isZero() {
        return this.inner == 0n;
    }
}
exports.AddressComplement = AddressComplement;
//# sourceMappingURL=address-complement.js.map