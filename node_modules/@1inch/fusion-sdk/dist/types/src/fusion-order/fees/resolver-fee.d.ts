import { Address, Bps } from '@1inch/limit-order-sdk';
export declare class ResolverFee {
    readonly receiver: Address;
    readonly fee: Bps;
    readonly whitelistDiscount: Bps;
    static ZERO: ResolverFee;
    constructor(receiver: Address, fee: Bps, whitelistDiscount?: Bps);
}
