import { BytesBuilder, BytesIter } from '@1inch/byte-utils';
import { Extension } from '@1inch/limit-order-sdk';
import { AuctionGasCostInfo, AuctionPoint } from './types.js';
export declare class AuctionDetails {
    readonly startTime: bigint;
    readonly duration: bigint;
    readonly initialRateBump: bigint;
    readonly points: AuctionPoint[];
    readonly gasCost: {
        gasBumpEstimate: bigint;
        gasPriceEstimate: bigint;
    };
    constructor(auction: {
        startTime: bigint;
        initialRateBump: number;
        duration: bigint;
        points: AuctionPoint[];
        gasCost?: AuctionGasCostInfo;
    });
    static decodeFrom<T extends bigint | string>(iter: BytesIter<T>): AuctionDetails;
    static decode(data: string): AuctionDetails;
    static fromExtension(extension: Extension): AuctionDetails;
    encode(): string;
    encodeInto(builder?: BytesBuilder): BytesBuilder;
}
