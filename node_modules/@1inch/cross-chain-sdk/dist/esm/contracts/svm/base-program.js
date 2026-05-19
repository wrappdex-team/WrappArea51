export class BaseProgram {
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
//# sourceMappingURL=base-program.js.map