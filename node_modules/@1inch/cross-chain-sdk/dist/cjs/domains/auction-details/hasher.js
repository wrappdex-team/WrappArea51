"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashForSolana = hashForSolana;
const anchor_1 = require("@coral-xyz/anchor");
const ethers_1 = require("ethers");
const uint_as_be_bytes_js_1 = require("../../utils/numbers/uint-as-be-bytes.js");
const bytes_js_1 = require("../../utils/bytes.js");
const cross_chain_escrow_src_js_1 = require("../../idl/cross-chain-escrow-src.js");
function hashForSolana(details) {
    const bytes = new anchor_1.BorshCoder(cross_chain_escrow_src_js_1.IDL).types.encode('auctionData', {
        startTime: Number(details.startTime),
        duration: Number(details.duration),
        initialRateBump: [(0, uint_as_be_bytes_js_1.uintAsBeBytes)(details.initialRateBump, 24)],
        pointsAndTimeDeltas: details.points.map((p) => ({
            rateBump: [(0, uint_as_be_bytes_js_1.uintAsBeBytes)(BigInt(p.coefficient), 24)],
            timeDelta: p.delay
        }))
    });
    return (0, bytes_js_1.bufferFromHex)((0, ethers_1.keccak256)(bytes));
}
//# sourceMappingURL=hasher.js.map