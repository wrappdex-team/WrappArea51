import { EvmAddress } from './evm-address.js';
import { SolanaAddress } from './solana-address.js';
import { isEvm } from '../../chains.js';
export function createAddress(
// hex/base58/bigint
address, chainId, complement) {
    if (isEvm(chainId)) {
        return EvmAddress.fromUnknown(address);
    }
    if (complement) {
        const evm = EvmAddress.fromUnknown(address);
        return SolanaAddress.fromParts([
            complement,
            evm
        ]);
    }
    return SolanaAddress.fromUnknown(address);
}
//# sourceMappingURL=address.factory.js.map