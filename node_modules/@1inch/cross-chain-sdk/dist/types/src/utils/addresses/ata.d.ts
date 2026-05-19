import { SolanaAddress, AddressLike } from '../../domains/addresses/index.js';
/**
 * Return the associated token account for given params
 *
 * @param walletAddress
 * @param tokenMintAddress
 * @param tokenProgramId
 */
export declare function getAta(walletAddress: AddressLike, tokenMintAddress: AddressLike, tokenProgramId: AddressLike): SolanaAddress;
