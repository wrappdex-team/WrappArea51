"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bigintToBN = bigintToBN;
const bn_js_1 = require("./bn.js");
function bigintToBN(value) {
    return new bn_js_1.BN(value.toString());
}
//# sourceMappingURL=bigint-to-bn.js.map