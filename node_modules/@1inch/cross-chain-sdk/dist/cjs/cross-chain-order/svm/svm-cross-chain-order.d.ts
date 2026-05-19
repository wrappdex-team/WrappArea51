import { AuctionCalculator } from '@1inch/fusion-sdk';
import { ResolverCancellationConfig } from './resolver-cancellation-config.js';
import { SolanaDetails, SolanaExtra, SolanaEscrowParams, OrderHashParams } from './types.js';
import { EvmAddress, SolanaAddress } from '../../domains/addresses/index.js';
import { NetworkEnum, SupportedChain } from '../../chains.js';
import { HashLock } from '../../domains/hash-lock/index.js';
import { TimeLocks } from '../../domains/time-locks/index.js';
import { BaseOrder } from '../base-order.js';
import { AuctionDetails, AuctionPoint } from '../../domains/auction-details/index.js';
import { ParsedCreateInstructionData } from '../../contracts/svm/types.js';
export type SolanaOrderJSON = {
    orderInfo: {
        srcToken: string;
        dstToken: string;
        maker: string;
        srcAmount: string;
        minDstAmount: string;
        receiver: string;
    };
    escrowParams: {
        hashLock: string;
        srcChainId: NetworkEnum.SOLANA;
        dstChainId: number;
        srcSafetyDeposit: string;
        dstSafetyDeposit: string;
        timeLocks: string;
    };
    details: {
        auction: {
            startTime: string;
            duration: string;
            initialRateBump: number;
            points: AuctionPoint[];
        };
    };
    extra: {
        srcAssetIsNative: boolean;
        orderExpirationDelay: string;
        resolverCancellationConfig: {
            maxCancellationPremium: string;
            cancellationAuctionDuration: number;
        };
        source?: string;
        allowMultipleFills: boolean;
        salt: string;
    };
};
export type OrderInfoData = {
    srcToken: SolanaAddress;
    dstToken: EvmAddress;
    maker: SolanaAddress;
    srcAmount: bigint;
    minDstAmount: bigint;
    receiver: EvmAddress;
};
export declare class SvmCrossChainOrder extends BaseOrder<SolanaAddress, SolanaOrderJSON> {
    private static TRACK_CODE_MASK;
    private static DefaultExtra;
    private readonly orderConfig;
    private readonly details;
    private readonly escrowParams;
    private constructor();
    get auction(): AuctionDetails;
    get salt(): bigint;
    get resolverCancellationConfig(): ResolverCancellationConfig;
    get hashLock(): HashLock;
    get timeLocks(): TimeLocks;
    get srcSafetyDeposit(): bigint;
    get dstSafetyDeposit(): bigint;
    get dstChainId(): SupportedChain;
    get maker(): SolanaAddress;
    get makerAsset(): SolanaAddress;
    get takerAsset(): EvmAddress;
    get makingAmount(): bigint;
    get takingAmount(): bigint;
    /**
     * Real receiver of funds on dst chain
     */
    get receiver(): EvmAddress;
    get deadline(): bigint;
    get auctionStartTime(): bigint;
    get auctionEndTime(): bigint;
    get partialFillAllowed(): boolean;
    get multipleFillsAllowed(): boolean;
    get srcAssetIsNative(): boolean;
    get source(): string;
    static new(orderInfo: OrderInfoData, escrowParams: SolanaEscrowParams, details: SolanaDetails, extra: Omit<SolanaExtra, 'srcAssetIsNative'>): SvmCrossChainOrder;
    static fromContractOrder(data: ParsedCreateInstructionData, auction: AuctionDetails): SvmCrossChainOrder;
    static fromJSON(data: SolanaOrderJSON): SvmCrossChainOrder;
    static getOrderHashBuffer(params: OrderHashParams): Buffer;
    toJSON(): SolanaOrderJSON;
    getOrderAccount(
    /**
     * Src escrow factory program id
     */
    programId: SolanaAddress): SolanaAddress;
    /**
     * Returns escrow address - owner of ATA where funds stored after fill
     *
     * @see getSrcEscrowATA to get ATA where funds stored
     */
    getSrcEscrowAddress(
    /**
     * Src escrow factory program id
     */
    programId: SolanaAddress, 
    /**
     * Address who fill order and create corresponding escrow
     */
    taker: SolanaAddress, 
    /**
     * HashLock corresponding to the fill amount secret
     * Can be omitted  for orders where `multipleFillsAllowed` is false
     */
    hashLock?: HashLock, fillAmount?: bigint): SolanaAddress;
    /**
     * Account where funds stored after fill
     */
    getSrcEscrowATA(params: {
        /**
         * Src escrow factory program id
         */
        programId: SolanaAddress;
        /**
         * Address who fill order and create corresponding escrow
         */
        taker: SolanaAddress;
        /**
         * Making filled amount
         */
        fillAmount?: bigint;
        /**
         * HashLock corresponding to the fill amount secret
         * Can be omitted  for orders where `multipleFillsAllowed` is false
         */
        hashLock?: HashLock;
        /**
         * TokenProgram or TokenProgram 2022
         */
        tokenProgramId: SolanaAddress;
    }): SolanaAddress;
    /**
     * @returns order has in base58 encoding
     */
    getOrderHash(_srcChainId: number): string;
    getOrderHashBuffer(): Buffer;
    getCalculator(): AuctionCalculator;
}
