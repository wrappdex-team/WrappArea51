"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelayerRequestSvm = exports.RelayerRequestEvm = void 0;
const chains_js_1 = require("../../chains.js");
class RelayerRequestEvm {
    order;
    signature;
    quoteId;
    extension;
    srcChainId;
    secretHashes;
    constructor(params) {
        this.order = params.order;
        this.signature = params.signature;
        this.quoteId = params.quoteId;
        this.extension = params.extension;
        this.srcChainId = params.srcChainId;
        this.secretHashes = params.secretHashes;
    }
    build() {
        return {
            order: this.order,
            signature: this.signature,
            quoteId: this.quoteId,
            extension: this.extension,
            srcChainId: this.srcChainId,
            secretHashes: this.secretHashes
        };
    }
}
exports.RelayerRequestEvm = RelayerRequestEvm;
class RelayerRequestSvm {
    order;
    auctionOrderHash;
    quoteId;
    secretHashes;
    constructor(params) {
        this.order = params.order;
        this.quoteId = params.quoteId;
        this.secretHashes = params.secretHashes;
        this.auctionOrderHash = params.auctionOrderHash;
    }
    build() {
        const auction = this.order.details.auction;
        const startTime = Number(auction.startTime);
        const duration = Number(auction.duration);
        return {
            srcChainId: chains_js_1.NetworkEnum.SOLANA,
            dstChainId: this.order.escrowParams.dstChainId,
            auctionData: {
                startTime,
                duration,
                initialRateBump: Number(auction.initialRateBump),
                pointsAndTimeDeltas: auction.points.map((p) => ({
                    rateBump: Number(p.coefficient),
                    timeDelta: Number(p.delay)
                }))
            },
            secretHashes: this.secretHashes,
            quoteId: this.quoteId,
            order: {
                hashLock: this.order.escrowParams.hashLock,
                amount: this.order.orderInfo.srcAmount,
                srcSafetyDeposit: this.order.escrowParams.srcSafetyDeposit,
                dstSafetyDeposit: this.order.escrowParams.dstSafetyDeposit,
                timeLocks: this.order.escrowParams.timeLocks,
                expirationTime: Number(this.order.extra.orderExpirationDelay) +
                    startTime +
                    duration,
                assetIsNative: this.order.extra.srcAssetIsNative,
                dstAmount: this.order.orderInfo.minDstAmount,
                dutchAuctionDataHash: this.auctionOrderHash,
                maxCancellationPremium: this.order.extra.resolverCancellationConfig
                    .maxCancellationPremium,
                cancellationAuctionDuration: Number(this.order.extra.resolverCancellationConfig
                    .cancellationAuctionDuration),
                allowMultipleFills: this.order.extra.allowMultipleFills,
                salt: this.order.extra.salt,
                maker: this.order.orderInfo.maker,
                receiver: this.order.orderInfo.receiver,
                srcMint: this.order.orderInfo.srcToken,
                dstMint: this.order.orderInfo.dstToken
            }
        };
    }
}
exports.RelayerRequestSvm = RelayerRequestSvm;
//# sourceMappingURL=relayer.request.js.map