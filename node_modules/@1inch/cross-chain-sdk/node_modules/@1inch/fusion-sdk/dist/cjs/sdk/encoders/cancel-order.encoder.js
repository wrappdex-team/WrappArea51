"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "encodeCancelOrder", {
    enumerable: true,
    get: function() {
        return encodeCancelOrder;
    }
});
var _ethers = require("ethers");
var _assert = /*#__PURE__*/ _interop_require_default(require("assert"));
var _AggregationRouterV6abijson = /*#__PURE__*/ _interop_require_default(require("../../abi/AggregationRouterV6.abi.json"));
var _validations = require("../../validations.js");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
var lopAbi = new _ethers.Interface(_AggregationRouterV6abijson.default);
function encodeCancelOrder(hash, makerTraits) {
    (0, _assert.default)((0, _validations.isHexBytes)(hash), 'Invalid order hash');
    return lopAbi.encodeFunctionData('cancelOrder', [
        makerTraits.asBigInt(),
        hash
    ]);
}
