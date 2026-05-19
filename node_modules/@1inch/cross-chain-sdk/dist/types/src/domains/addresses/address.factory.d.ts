import { AddressComplement } from './address-complement.js';
import { SupportedChain } from '../../chains.js';
import { AddressForChain } from '../../type-utils.js';
export declare function createAddress<Chain extends SupportedChain>(address: string | bigint, chainId: Chain, complement?: AddressComplement): AddressForChain<Chain>;
