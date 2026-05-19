import { BaseProgram } from './base-program.js';
import { SolanaAddress } from '../../domains/addresses/index.js';
export declare class WhitelistContract extends BaseProgram {
    static DEFAULT: WhitelistContract;
    constructor(programId: SolanaAddress);
    getAccessAccount(taker: SolanaAddress): SolanaAddress;
}
