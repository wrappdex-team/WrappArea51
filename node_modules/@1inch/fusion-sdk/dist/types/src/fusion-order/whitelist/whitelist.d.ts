import { Address } from '@1inch/limit-order-sdk';
import { BytesBuilder, BytesIter } from '@1inch/byte-utils';
import { WhitelistItem } from './types.js';
export declare class Whitelist {
    readonly resolvingStartTime: bigint;
    readonly whitelist: WhitelistItem[];
    private constructor();
    get length(): number;
    static decodeFrom<T extends string | bigint>(bytes: BytesIter<T>): Whitelist;
    static decode(bytes: string): Whitelist;
    static new(resolvingStartTime: bigint, whitelist: {
        address: Address;
        allowFrom: bigint;
    }[]): Whitelist;
    static fromNow(whitelist: {
        address: Address;
        allowFrom: bigint;
    }[]): Whitelist;
    canExecuteAt(executor: Address, executionTime: bigint): boolean;
    isExclusivityPeriod(time?: bigint): boolean;
    isExclusiveResolver(wallet: Address): boolean;
    isWhitelisted(address: Address): boolean;
    encodeInto(builder?: BytesBuilder): BytesBuilder;
    encode(): string;
    equal(other: Whitelist): boolean;
}
