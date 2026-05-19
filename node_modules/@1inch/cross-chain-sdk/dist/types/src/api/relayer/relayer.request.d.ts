import { LimitOrderV4Struct } from '@1inch/fusion-sdk';
import { Jsonify } from 'type-fest';
import { SolanaOrderJSON } from 'cross-chain-order';
import { DataFor } from '../../type-utils.js';
import { NetworkEnum, SupportedChain } from '../../chains.js';
export declare class RelayerRequestEvm {
    readonly order: LimitOrderV4Struct;
    readonly signature: string;
    readonly quoteId: string;
    readonly extension: string;
    readonly srcChainId: SupportedChain;
    readonly secretHashes: string[] | undefined;
    constructor(params: DataFor<RelayerRequestEvm>);
    build(): Jsonify<DataFor<RelayerRequestEvm>>;
}
export declare class RelayerRequestSvm {
    readonly order: SolanaOrderJSON;
    readonly auctionOrderHash: string;
    readonly quoteId: string;
    readonly secretHashes: string[] | undefined;
    constructor(params: Readonly<DataFor<RelayerRequestSvm>>);
    build(): RelayerRequestSvmSerialzied;
}
type RelayerRequestSvmSerialzied = {
    srcChainId: NetworkEnum.SOLANA;
    dstChainId: number;
    auctionData: {
        startTime: number;
        duration: number;
        initialRateBump: number;
        pointsAndTimeDeltas: Array<{
            rateBump: number;
            timeDelta: number;
        }>;
    };
    secretHashes: string[] | undefined;
    quoteId: string;
    order: {
        hashLock: string;
        amount: string;
        srcSafetyDeposit: string;
        dstSafetyDeposit: string;
        timeLocks: string;
        expirationTime: number;
        assetIsNative: boolean;
        dstAmount: string;
        dutchAuctionDataHash: string;
        maxCancellationPremium: string;
        cancellationAuctionDuration: number;
        allowMultipleFills: boolean;
        salt: string;
        maker: string;
        receiver: string;
        srcMint: string;
        dstMint: string;
    };
};
export {};
