"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOLANA_WHITELIST = exports.SOLANA_SRC_ESCROW = exports.SOLANA_DST_ESCROW = void 0;
var cross_chain_escrow_dst_js_1 = require("./cross-chain-escrow-dst.js");
Object.defineProperty(exports, "SOLANA_DST_ESCROW", { enumerable: true, get: function () { return cross_chain_escrow_dst_js_1.IDL; } });
var cross_chain_escrow_src_js_1 = require("./cross-chain-escrow-src.js");
Object.defineProperty(exports, "SOLANA_SRC_ESCROW", { enumerable: true, get: function () { return cross_chain_escrow_src_js_1.IDL; } });
var whitelist_js_1 = require("./whitelist.js");
Object.defineProperty(exports, "SOLANA_WHITELIST", { enumerable: true, get: function () { return whitelist_js_1.IDL; } });
//# sourceMappingURL=index.js.map