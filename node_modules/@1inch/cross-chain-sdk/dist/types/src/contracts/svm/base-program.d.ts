import { AccountMeta } from './instruction.js';
import { SolanaAddress } from '../../domains/addresses/index.js';
export declare abstract class BaseProgram {
    readonly programId: SolanaAddress;
    protected encoder: import("util").TextEncoder;
    constructor(programId: SolanaAddress);
    protected optionalAccount(meta: AccountMeta, skip: boolean): AccountMeta;
}
