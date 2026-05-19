import { Address, Bps } from '@1inch/limit-order-sdk';
export declare class IntegratorFee {
    readonly integrator: Address;
    readonly protocol: Address;
    readonly fee: Bps;
    readonly share: Bps;
    static ZERO: IntegratorFee;
    constructor(integrator: Address, protocol: Address, fee: Bps, share: Bps);
}
