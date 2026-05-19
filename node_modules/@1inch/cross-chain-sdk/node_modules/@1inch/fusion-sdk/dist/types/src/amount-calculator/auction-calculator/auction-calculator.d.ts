import { AuctionDetails, AuctionPoint, AuctionGasCostInfo } from '../../fusion-order/index.js';
export declare class AuctionCalculator {
    private readonly startTime;
    private readonly duration;
    private readonly initialRateBump;
    private readonly points;
    private readonly gasCost;
    static RATE_BUMP_DENOMINATOR: bigint;
    private static GAS_PRICE_BASE;
    constructor(startTime: bigint, duration: bigint, initialRateBump: bigint, points: AuctionPoint[], gasCost?: AuctionGasCostInfo);
    get finishTime(): bigint;
    static fromAuctionData(details: AuctionDetails): AuctionCalculator;
    static calcInitialRateBump(startAmount: bigint, endAmount: bigint): number;
    static calcAuctionTakingAmount(takingAmount: bigint, rate: number): bigint;
    static calcAuctionMakingAmount(makingAmount: bigint, rate: number): bigint;
    static baseFeeToGasPriceEstimate(baseFee: bigint): bigint;
    static calcGasBumpEstimate(endTakingAmount: bigint, gasCostInToToken: bigint): bigint;
    calcAuctionTakingAmount(takingAmount: bigint, rate: number): bigint;
    calcRateBump(time: bigint, blockBaseFee?: bigint): number;
    private getGasPriceBump;
    private getAuctionBump;
}
