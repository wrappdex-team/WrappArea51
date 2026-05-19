"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bufferFromHex = bufferFromHex;
exports.bufferToHex = bufferToHex;
const byte_utils_1 = require("@1inch/byte-utils");
const assert_1 = __importDefault(require("assert"));
const buffer_1 = require("buffer");
function bufferFromHex(hex, bytesSize = -1) {
    (0, assert_1.default)((0, byte_utils_1.isHexBytes)(hex));
    (0, assert_1.default)(bytesSize === -1 || hex.slice(2).length / 2 <= bytesSize, 'cannot extend buffer');
    if (bytesSize === -1) {
        return buffer_1.Buffer.from(hex.slice(2), 'hex');
    }
    return buffer_1.Buffer.from(hex.slice(2).padStart(bytesSize * 2, '0'), 'hex');
}
function bufferToHex(buf) {
    return '0x' + buffer_1.Buffer.from(buf).toString('hex');
}
//# sourceMappingURL=bytes.js.map