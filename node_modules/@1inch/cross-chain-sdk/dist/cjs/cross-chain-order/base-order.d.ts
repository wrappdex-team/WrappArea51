import { AuctionCalculator } from '@1inch/fusion-sdk';
import { NetworkEnum, SupportedChain } from '../chains.js';
import { HashLock } from '../domains/hash-lock/index.js';
import { Immutables } from '../domains/immutables/index.js';
import { TimeLocks } from '../domains/time-locks/index.js';
import { AddressLike } from '../domains/addresses/index.js';
export declare abstract class BaseOrder<TSrcAddress extends AddressLike, TJSON, TDstAddress extends AddressLike = AddressLike> {
    abstract get hashLock(): HashLock;
    abstract get timeLocks(): TimeLocks;
    abstract get srcSafetyDeposit(): bigint;
    abstract get dstSafetyDeposit(): bigint;
    abstract get dstChainId(): NetworkEnum;
    abstract get maker(): TSrcAddress;
    abstract get takerAsset(): TDstAddress;
    abstract get makerAsset(): TSrcAddress;
    abstract get takingAmount(): bigint;
    abstract get makingAmount(): bigint;
    /**
     * If zero address, then maker will receive funds
     */
    abstract get receiver(): TDstAddress;
    /**
     * Timestamp in sec
     */
    abstract get deadline(): bigint;
    /**
     * Timestamp in sec
     */
    abstract get auctionStartTime(): bigint;
    /**
     * Timestamp in sec
     */
    abstract get auctionEndTime(): bigint;
    abstract get partialFillAllowed(): boolean;
    abstract get multipleFillsAllowed(): boolean;
    /**
     * Calculate expiration delay from deadline and auction times
     */
    static calcExpirationDelay(
    /**
     * Order deadline
     */
    deadline: bigint, 
    /**
     * Auction start time
     */
    startTime: bigint, 
    /**
     * Auction duration
     */
    duration: bigint): bigint;
    /**
     * @param srcChainId
     * @param taker executor of tx (signer or msg.sender)
     * @param amount making amount (make sure same amount passed to contract)
     * @param hashLock leaf of a merkle tree for multiple fill
     */
    toSrcImmutables(srcChainId: SupportedChain, taker: TSrcAddress, amount: bigint, hashLock?: HashLock): Immutables<TSrcAddress>;
    getMultipleFillIdx(fillAmount: bigint, remainingAmount?: bigint): number;
    /**
     * Check is order expired at a given time
     *
     * @param time timestamp in seconds
     */
    isExpiredAt(time?: number): boolean;
    /**
     * Calculates required taking amount for passed `makingAmount` at block time `time`
     *
     * @param makingAmount maker swap amount
     * @param time execution time in sec
     * @param blockBaseFee block fee in wei.
     * */
    calcTakingAmount(makingAmount: bigint, time: bigint, blockBaseFee?: bigint): bigint;
    abstract toJSON(): TJSON;
    abstract getOrderHash(srcChainId: number): string;
    abstract getOrderHashBuffer(srcChainId: number): Buffer;
    abstract getCalculator(): AuctionCalculator;
}
