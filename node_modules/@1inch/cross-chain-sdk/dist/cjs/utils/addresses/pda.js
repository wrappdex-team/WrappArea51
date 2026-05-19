"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPda = getPda;
const anchor_1 = require("@coral-xyz/anchor");
const index_js_1 = require("../../domains/addresses/index.js");
function getPda(programId, seeds) {
    return index_js_1.SolanaAddress.fromBuffer(anchor_1.web3.PublicKey.findProgramAddressSync(seeds, new anchor_1.web3.PublicKey(programId.toBuffer()))[0].toBuffer());
}
//# sourceMappingURL=pda.js.map