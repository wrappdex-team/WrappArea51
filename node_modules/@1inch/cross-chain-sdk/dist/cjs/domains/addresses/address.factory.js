"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAddress = createAddress;
const evm_address_js_1 = require("./evm-address.js");
const solana_address_js_1 = require("./solana-address.js");
const chains_js_1 = require("../../chains.js");
function createAddress(
// hex/base58/bigint
address, chainId, complement) {
    if ((0, chains_js_1.isEvm)(chainId)) {
        return evm_address_js_1.EvmAddress.fromUnknown(address);
    }
    if (complement) {
        const evm = evm_address_js_1.EvmAddress.fromUnknown(address);
        return solana_address_js_1.SolanaAddress.fromParts([
            complement,
            evm
        ]);
    }
    return solana_address_js_1.SolanaAddress.fromUnknown(address);
}
//# sourceMappingURL=address.factory.js.map