"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseProgram = void 0;
class BaseProgram {
    programId;
    encoder = new TextEncoder();
    constructor(programId) {
        this.programId = programId;
    }
    optionalAccount(meta, skip) {
        if (skip) {
            return {
                pubkey: this.programId,
                isSigner: false,
                isWritable: false
            };
        }
        return meta;
    }
}
exports.BaseProgram = BaseProgram;
//# sourceMappingURL=base-program.js.map