"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Preset = void 0;
const index_js_1 = require("../../domains/auction-details/index.js");
const index_js_2 = require("../../domains/addresses/index.js");
class Preset {
    auctionDuration;
    startAuctionIn;
    initialRateBump;
    auctionStartAmount;
    // auctionStartAmount taking into account gas bump
    startAmount;
    costInDstToken;
    auctionEndAmount;
    points;
    gasCostInfo;
    exclusiveResolver;
    allowPartialFills;
    allowMultipleFills;
    secretsCount;
    constructor(preset) {
        this.startAmount = BigInt(preset.startAmount);
        this.secretsCount = preset.secretsCount;
        this.costInDstToken = BigInt(preset.costInDstToken);
        this.auctionDuration = BigInt(preset.auctionDuration);
        this.startAuctionIn = BigInt(preset.startAuctionIn);
        this.initialRateBump = preset.initialRateBump;
        this.auctionStartAmount = BigInt(preset.auctionStartAmount);
        this.auctionEndAmount = BigInt(preset.auctionEndAmount);
        this.points = preset.points;
        this.gasCostInfo = {
            gasPriceEstimate: BigInt(preset.gasCost?.gasPriceEstimate || 0n),
            gasBumpEstimate: BigInt(preset.gasCost?.gasBumpEstimate || 0n)
        };
        this.exclusiveResolver = preset.exclusiveResolver
            ? index_js_2.EvmAddress.fromString(preset.exclusiveResolver)
            : undefined;
        this.allowPartialFills = preset.allowPartialFills;
        this.allowMultipleFills = preset.allowMultipleFills;
    }
    createAuctionDetails(additionalWaitPeriod = 0n) {
        return new index_js_1.AuctionDetails({
            duration: this.auctionDuration,
            startTime: this.calcAuctionStartTime(additionalWaitPeriod),
            initialRateBump: this.initialRateBump,
            points: this.points,
            gasCost: this.gasCostInfo
        });
    }
    calcAuctionStartTime(additionalWaitPeriod = 0n) {
        return (BigInt(Math.floor(Date.now() / 1000)) +
            additionalWaitPeriod +
            this.startAuctionIn);
    }
}
exports.Preset = Preset;
//# sourceMappingURL=preset.js.map