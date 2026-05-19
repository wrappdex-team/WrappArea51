"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "SurplusParams", {
    enumerable: true,
    get: function() {
        return SurplusParams;
    }
});
var _byteutils = require("@1inch/byte-utils");
var _limitordersdk = require("@1inch/limit-order-sdk");
var _assert = /*#__PURE__*/ _interop_require_default(require("assert"));
function _class_call_check(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}
function _defineProperties(target, props) {
    for(var i = 0; i < props.length; i++){
        var descriptor = props[i];
        descriptor.enumerable = descriptor.enumerable || false;
        descriptor.configurable = true;
        if ("value" in descriptor) descriptor.writable = true;
        Object.defineProperty(target, descriptor.key, descriptor);
    }
}
function _create_class(Constructor, protoProps, staticProps) {
    if (protoProps) _defineProperties(Constructor.prototype, protoProps);
    if (staticProps) _defineProperties(Constructor, staticProps);
    return Constructor;
}
function _define_property(obj, key, value) {
    if (key in obj) {
        Object.defineProperty(obj, key, {
            value: value,
            enumerable: true,
            configurable: true,
            writable: true
        });
    } else {
        obj[key] = value;
    }
    return obj;
}
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
var SurplusParams = /*#__PURE__*/ function() {
    "use strict";
    function SurplusParams(estimatedTakerAmount, protocolFee) {
        _class_call_check(this, SurplusParams);
        _define_property(this, "estimatedTakerAmount", void 0);
        _define_property(this, "protocolFee", void 0);
        this.estimatedTakerAmount = estimatedTakerAmount;
        this.protocolFee = protocolFee;
        (0, _assert.default)(protocolFee.value % 100n == 0n, 'only integer percent supported for protocolFee');
    }
    _create_class(SurplusParams, [
        {
            key: "isZero",
            value: function isZero() {
                return this.protocolFee.isZero();
            }
        }
    ], [
        {
            key: "decodeFrom",
            value: /**
     * Create `SurplusParams` from encoded bytes
     * @param bytes
     * - `32 bytes` - estimatedTakerAmount
     * - `1 byte` - protocolFee
     */ function decodeFrom(bytes) {
                var amount = BigInt(bytes.nextUint256());
                var protocolFee = new _limitordersdk.Bps(BigInt(bytes.nextUint8()) * 100n);
                return new SurplusParams(amount, protocolFee);
            }
        }
    ]);
    return SurplusParams;
}();
_define_property(SurplusParams, "NO_FEE", new SurplusParams(_byteutils.UINT_256_MAX, _limitordersdk.Bps.ZERO));
