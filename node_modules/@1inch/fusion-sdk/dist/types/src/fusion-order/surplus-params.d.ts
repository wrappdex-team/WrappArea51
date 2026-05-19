import { BytesIter } from '@1inch/byte-utils';
import { Bps } from '@1inch/limit-order-sdk';
export declare class SurplusParams {
    readonly estimatedTakerAmount: bigint;
    readonly protocolFee: Bps;
    static NO_FEE: SurplusParams;
    constructor(estimatedTakerAmount: bigint, protocolFee: Bps);
    static decodeFrom<T extends string | bigint>(bytes: BytesIter<T>): SurplusParams;
    isZero(): boolean;
}
