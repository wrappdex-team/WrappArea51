import { UINT_64_MAX } from '@1inch/byte-utils';
import assert from 'assert';
import { assertUInteger } from '../../utils/validation/index.js';
export class ResolverCancellationConfig {
    maxCancellationPremium;
    cancellationAuctionDuration;
    static BASE_1E3 = 1000n;
    static ZERO = new ResolverCancellationConfig(0n, 0);
    static ALMOST_ZERO = new ResolverCancellationConfig(1n, 1);
    constructor(maxCancellationPremium, cancellationAuctionDuration) {
        this.maxCancellationPremium = maxCancellationPremium;
        this.cancellationAuctionDuration = cancellationAuctionDuration;
        assertUInteger(cancellationAuctionDuration);
        assertUInteger(maxCancellationPremium, UINT_64_MAX);
        if (maxCancellationPremium === 0n ||
            cancellationAuctionDuration === 0) {
            assert(maxCancellationPremium === 0n &&
                cancellationAuctionDuration === 0, 'inconsistent cancellation config');
        }
    }
    static disableResolverCancellation() {
        return ResolverCancellationConfig.ZERO;
    }
    toJSON() {
        return {
            maxCancellationPremium: this.maxCancellationPremium.toString(),
            cancellationAuctionDuration: this.cancellationAuctionDuration
        };
    }
    isZero() {
        return this.maxCancellationPremium === 0n;
    }
}
//# sourceMappingURL=resolver-cancellation-config.js.map