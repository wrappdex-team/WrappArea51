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
import { Address } from '@1inch/limit-order-sdk';
import { PresetEnum } from '../types.js';
export var FusionOrderParams = /*#__PURE__*/ function() {
    "use strict";
    function FusionOrderParams(params) {
        _class_call_check(this, FusionOrderParams);
        _define_property(this, "preset", PresetEnum.fast);
        _define_property(this, "receiver", Address.ZERO_ADDRESS);
        _define_property(this, "permit", void 0);
        _define_property(this, "nonce", void 0);
        _define_property(this, "delayAuctionStartTimeBy", void 0);
        _define_property(this, "isPermit2", void 0);
        if (params.preset) {
            this.preset = params.preset;
        }
        if (params.receiver) {
            this.receiver = params.receiver;
        }
        this.isPermit2 = params.isPermit2;
        this.nonce = params.nonce;
        this.permit = params.permit;
        this.delayAuctionStartTimeBy = params.delayAuctionStartTimeBy || 0n;
    }
    _create_class(FusionOrderParams, null, [
        {
            key: "new",
            value: function _new(params) {
                return new FusionOrderParams(params);
            }
        }
    ]);
    return FusionOrderParams;
}();
