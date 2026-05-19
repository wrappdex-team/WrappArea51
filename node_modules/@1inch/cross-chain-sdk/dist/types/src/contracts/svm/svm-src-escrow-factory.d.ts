import { Buffer } from 'buffer';
import { Immutables } from 'domains/immutables';
import { Instruction } from './instruction.js';
import { BaseProgram } from './base-program.js';
import { WhitelistContract } from './whitelist.js';
import { EscrowAddressParams, ParsedCreateInstructionData, ParsedCreateSrcEscrowInstructionData } from './types.js';
import { AuctionDetails, MerkleLeaf, SolanaAddress } from '../../domains/index.js';
import { SvmCrossChainOrder } from '../../cross-chain-order/svm/svm-cross-chain-order.js';
export declare class SvmSrcEscrowFactory extends BaseProgram {
    static DEFAULT: SvmSrcEscrowFactory;
    private static readonly coder;
    constructor(programId: SolanaAddress);
    static parseCreateInstruction(ix: Instruction): ParsedCreateInstructionData;
    static parseCreateEscrowInstruction(ix: Instruction): ParsedCreateSrcEscrowInstructionData;
    static parsePrivateWithdrawInstruction(ix: Instruction): {
        secret: string;
    };
    static parsePublicWithdrawInstruction(ix: Instruction): {
        secret: string;
    };
    getOrderAccount(orderHash: Buffer): SolanaAddress;
    getEscrowAddress(params: EscrowAddressParams): SolanaAddress;
    createOrder(order: SvmCrossChainOrder, extra: {
        srcTokenProgramId: SolanaAddress;
    }): Instruction;
    createEscrow(immutables: ActionParams, auction: AuctionDetails, extra: {
        /**
         * If not passed, than `WhitelistContract.DEFAULT` will be used
         * @see WhitelistContract.DEFAULT
         */
        whitelistProgramId?: SolanaAddress;
        /**
         * TokenProgram or TokenProgram 2022
         */
        tokenProgramId: SolanaAddress;
        /**
         * Required if order allows partial fills
         */
        merkleProof?: {
            /**
             * Merkle proof for index `idx`
             *
             * @see HashLock.getProof
             */
            proof: MerkleLeaf[];
            /**
             * @see SvmCrossChainOrder.getMultipleFillIdx
             */
            idx: number;
            /**
             * Hash of secret at index `idx`
             */
            secretHash: Buffer;
        };
    }): Instruction;
    withdrawPrivate(params: ActionParams, secret: Buffer, extra: {
        /**
         * TokenProgram or TokenProgram 2022
         */
        tokenProgramId: SolanaAddress;
    }): Instruction;
    withdrawPublic(params: ActionParams, secret: Buffer, resolver: SolanaAddress, extra: {
        /**
         * If not passed, than `WhitelistContract.DEFAULT` will be used
         * @see WhitelistContract.DEFAULT
         */
        whitelistProgramId?: SolanaAddress;
        /**
         * TokenProgram or TokenProgram 2022
         */
        tokenProgramId: SolanaAddress;
    }): Instruction;
    /**
     * Cancel fill escrow private
     */
    cancelPrivate(params: ActionParams, extra: {
        /**
         * TokenProgram or TokenProgram 2022
         */
        tokenProgramId: SolanaAddress;
        assetIsNative: boolean;
    }): Instruction;
    /**
     * Cancel fill escrow public
     */
    cancelPublic(params: Immutables<SolanaAddress>, payer: SolanaAddress, extra: {
        /**
         * If not passed, than `WhitelistContract.DEFAULT` will be used
         * @see WhitelistContract.DEFAULT
         */
        whitelistProgramId?: SolanaAddress;
        /**
         * TokenProgram or TokenProgram 2022
         */
        tokenProgramId: SolanaAddress;
        assetIsNative: boolean;
    }): Instruction;
    cancelOwnOrder(params: {
        orderHash: Buffer;
        maker: SolanaAddress;
        token: SolanaAddress;
    }, extra: {
        /**
         * TokenProgram or TokenProgram 2022
         */
        tokenProgramId: SolanaAddress;
        assetIsNative: boolean;
    }): Instruction;
    cancelOrderByResolver(params: {
        orderHash: Buffer;
        resolver: SolanaAddress;
        maker: SolanaAddress;
        token: SolanaAddress;
        /**
         * Max reward resolver willing to take. Real reward will be `min(cancellationPremium, rewardLimit)`
         */
        rewardLimit: bigint;
    }, extra: {
        /**
         * TokenProgram or TokenProgram 2022
         */
        tokenProgramId: SolanaAddress;
        /**
         * Whitelist program for resolver access validation
         */
        whitelistProgram?: WhitelistContract;
        assetIsNative: boolean;
    }): Instruction;
}
export type ActionParams = Pick<Immutables<SolanaAddress>, 'amount' | 'taker' | 'maker' | 'token' | 'hashLock' | 'orderHash'>;
