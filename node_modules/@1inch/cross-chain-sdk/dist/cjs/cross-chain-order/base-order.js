"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseOrder = void 0;
const fusion_sdk_1 = require("@1inch/fusion-sdk");
const assert_1 = __importDefault(require("assert"));
const index_js_1 = require("../utils/index.js");
const index_js_2 = require("../domains/immutables/index.js");
class BaseOrder {
    /**
     * Calculate expiration delay from deadline and auction times
     */
    static calcExpirationDelay(
    /**
     * Order deadline
     */
    deadline, 
    /**
     * Auction start time
     */
    startTime, 
    /**
     * Auction duration
     */
    duration) {
        return deadline - startTime - duration;
    }
    /**
     * @param srcChainId
     * @param taker executor of tx (signer or msg.sender)
     * @param amount making amount (make sure same amount passed to contract)
     * @param hashLock leaf of a merkle tree for multiple fill
     */
    toSrcImmutables(srcChainId, taker, amount, hashLock = this.hashLock) {
        const isPartialFill = amount !== this.makingAmount;
        const isHashRoot = hashLock.eq(this.hashLock);
        if (isPartialFill && isHashRoot) {
            throw new Error('Provide leaf of merkle tree as HashLock for partial fill');
        }
        return index_js_2.Immutables.new({
            hashLock,
            safetyDeposit: this.srcSafetyDeposit,
            taker,
            maker: this.maker,
            orderHash: this.getOrderHashBuffer(srcChainId),
            amount,
            timeLocks: this.timeLocks,
            token: this.makerAsset
        });
    }
    getMultipleFillIdx(fillAmount, remainingAmount = this.makingAmount) {
        (0, assert_1.default)(this.multipleFillsAllowed, 'Multiple fills disabled for order');
        const partsCount = this.hashLock.getPartsCount();
        const calculatedIndex = ((this.makingAmount - remainingAmount + fillAmount - 1n) *
            partsCount) /
            this.makingAmount;
        if (remainingAmount === fillAmount) {
            return Number(calculatedIndex + 1n);
        }
        return Number(calculatedIndex);
    }
    /**
     * Check is order expired at a given time
     *
     * @param time timestamp in seconds
     */
    isExpiredAt(time = (0, index_js_1.now)()) {
        return time >= this.deadline;
    }
    /**
     * Calculates required taking amount for passed `makingAmount` at block time `time`
     *
     * @param makingAmount maker swap amount
     * @param time execution time in sec
     * @param blockBaseFee block fee in wei.
     * */
    calcTakingAmount(makingAmount, time, blockBaseFee = 0n) {
        const takingAmount = (0, fusion_sdk_1.calcTakingAmount)(makingAmount, this.makingAmount, this.takingAmount);
        const calculator = this.getCalculator();
        const bump = calculator.calcRateBump(time, blockBaseFee);
        return calculator.calcAuctionTakingAmount(takingAmount, bump);
    }
}
exports.BaseOrder = BaseOrder;
//# sourceMappingURL=base-order.js.map