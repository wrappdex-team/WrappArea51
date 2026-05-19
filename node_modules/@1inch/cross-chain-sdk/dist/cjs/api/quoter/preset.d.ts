import { PresetData } from './types.js';
import { AuctionDetails, AuctionPoint } from '../../domains/auction-details/index.js';
import { EvmAddress as Address } from '../../domains/addresses/index.js';
export declare class Preset {
    readonly auctionDuration: bigint;
    readonly startAuctionIn: bigint;
    readonly initialRateBump: number;
    readonly auctionStartAmount: bigint;
    readonly startAmount: bigint;
    readonly costInDstToken: bigint;
    readonly auctionEndAmount: bigint;
    readonly points: AuctionPoint[];
    readonly gasCostInfo: {
        gasBumpEstimate: bigint;
        gasPriceEstimate: bigint;
    };
    readonly exclusiveResolver?: Address;
    readonly allowPartialFills: boolean;
    readonly allowMultipleFills: boolean;
    readonly secretsCount: number;
    constructor(preset: PresetData);
    createAuctionDetails(additionalWaitPeriod?: bigint): AuctionDetails;
    private calcAuctionStartTime;
}
