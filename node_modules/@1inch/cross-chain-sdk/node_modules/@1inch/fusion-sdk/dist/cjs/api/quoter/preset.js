"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "Preset", {
    enumerable: true,
    get: function() {
        return Preset;
    }
});
var _limitordersdk = require("@1inch/limit-order-sdk");
var _index = require("../../fusion-order/index.js");
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
var Preset = /*#__PURE__*/ function() {
    "use strict";
    function Preset(preset) {
        _class_call_check(this, Preset);
        var _preset_gasCost, _preset_gasCost1;
        _define_property(this, "auctionDuration", void 0);
        _define_property(this, "startAuctionIn", void 0);
        _define_property(this, "bankFee", void 0);
        _define_property(this, "initialRateBump", void 0);
        _define_property(this, "auctionStartAmount", void 0);
        _define_property(this, "auctionEndAmount", void 0);
        _define_property(this, "tokenFee", void 0);
        _define_property(this, "points", void 0);
        _define_property(this, "gasCostInfo", void 0);
        _define_property(this, "exclusiveResolver", void 0);
        _define_property(this, "allowPartialFills", void 0);
        _define_property(this, "allowMultipleFills", void 0);
        this.auctionDuration = BigInt(preset.auctionDuration);
        this.startAuctionIn = BigInt(preset.startAuctionIn);
        this.bankFee = BigInt(preset.bankFee);
        this.initialRateBump = preset.initialRateBump;
        this.auctionStartAmount = BigInt(preset.auctionStartAmount);
        this.auctionEndAmount = BigInt(preset.auctionEndAmount);
        this.tokenFee = BigInt(preset.tokenFee);
        this.points = preset.points;
        this.gasCostInfo = {
            gasPriceEstimate: BigInt(((_preset_gasCost = preset.gasCost) === null || _preset_gasCost === void 0 ? void 0 : _preset_gasCost.gasPriceEstimate) || 0n),
            gasBumpEstimate: BigInt(((_preset_gasCost1 = preset.gasCost) === null || _preset_gasCost1 === void 0 ? void 0 : _preset_gasCost1.gasBumpEstimate) || 0n)
        };
        this.exclusiveResolver = preset.exclusiveResolver ? new _limitordersdk.Address(preset.exclusiveResolver) : undefined;
        this.allowPartialFills = preset.allowPartialFills;
        this.allowMultipleFills = preset.allowMultipleFills;
    }
    _create_class(Preset, [
        {
            key: "createAuctionDetails",
            value: function createAuctionDetails() {
                var additionalWaitPeriod = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : 0n;
                return new _index.AuctionDetails({
                    duration: this.auctionDuration,
                    startTime: this.calcAuctionStartTime(additionalWaitPeriod),
                    initialRateBump: this.initialRateBump,
                    points: this.points,
                    gasCost: this.gasCostInfo
                });
            }
        },
        {
            key: "calcAuctionStartTime",
            value: function calcAuctionStartTime() {
                var additionalWaitPeriod = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : 0n;
                return BigInt(Math.floor(Date.now() / 1000)) + additionalWaitPeriod + this.startAuctionIn;
            }
        }
    ]);
    return Preset;
}();
