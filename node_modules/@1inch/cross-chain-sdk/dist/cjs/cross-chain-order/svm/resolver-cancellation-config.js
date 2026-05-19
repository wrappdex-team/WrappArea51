"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResolverCancellationConfig = void 0;
const byte_utils_1 = require("@1inch/byte-utils");
const assert_1 = __importDefault(require("assert"));
const index_js_1 = require("../../utils/validation/index.js");
class ResolverCancellationConfig {
    maxCancellationPremium;
    cancellationAuctionDuration;
    static BASE_1E3 = 1000n;
    static ZERO = new ResolverCancellationConfig(0n, 0);
    static ALMOST_ZERO = new ResolverCancellationConfig(1n, 1);
    constructor(maxCancellationPremium, cancellationAuctionDuration) {
        this.maxCancellationPremium = maxCancellationPremium;
        this.cancellationAuctionDuration = cancellationAuctionDuration;
        (0, index_js_1.assertUInteger)(cancellationAuctionDuration);
        (0, index_js_1.assertUInteger)(maxCancellationPremium, byte_utils_1.UINT_64_MAX);
        if (maxCancellationPremium === 0n ||
            cancellationAuctionDuration === 0) {
            (0, assert_1.default)(maxCancellationPremium === 0n &&
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
exports.ResolverCancellationConfig = ResolverCancellationConfig;
//# sourceMappingURL=resolver-cancellation-config.js.map