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
import { isValidAmount } from '../../validations.js';
export var QuoterCustomPresetRequest = /*#__PURE__*/ function() {
    "use strict";
    function QuoterCustomPresetRequest(params) {
        _class_call_check(this, QuoterCustomPresetRequest);
        _define_property(this, "customPreset", void 0);
        this.customPreset = params.customPreset;
    }
    _create_class(QuoterCustomPresetRequest, [
        {
            key: "build",
            value: function build() {
                return {
                    auctionDuration: this.customPreset.auctionDuration,
                    auctionEndAmount: this.customPreset.auctionEndAmount,
                    auctionStartAmount: this.customPreset.auctionStartAmount,
                    points: this.customPreset.points
                };
            }
        },
        {
            key: "validate",
            value: function validate() {
                if (!isValidAmount(this.customPreset.auctionStartAmount)) {
                    return 'Invalid auctionStartAmount';
                }
                if (!isValidAmount(this.customPreset.auctionEndAmount)) {
                    return 'Invalid auctionEndAmount';
                }
                var durationErr = this.validateAuctionDuration(this.customPreset.auctionDuration);
                if (durationErr) {
                    return durationErr;
                }
                var pointsErr = this.validatePoints(this.customPreset.points, this.customPreset.auctionStartAmount, this.customPreset.auctionEndAmount);
                if (pointsErr) {
                    return pointsErr;
                }
                return null;
            }
        },
        {
            key: "validateAuctionDuration",
            value: function validateAuctionDuration(duration) {
                if (typeof duration !== 'number' || isNaN(duration)) {
                    return 'auctionDuration should be integer';
                }
                if (!Number.isInteger(duration)) {
                    return 'auctionDuration should be integer (not float)';
                }
                return null;
            }
        },
        {
            key: "validatePoints",
            value: function validatePoints() {
                var points = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : [], auctionStartAmount = arguments.length > 1 ? arguments[1] : void 0, auctionEndAmount = arguments.length > 2 ? arguments[2] : void 0;
                if (!points) {
                    return null;
                }
                try {
                    var toTokenAmounts = points.map(function(p) {
                        return BigInt(p.toTokenAmount);
                    });
                    var isValid = toTokenAmounts.every(function(amount) {
                        return amount <= BigInt(auctionStartAmount) && amount >= BigInt(auctionEndAmount);
                    });
                    if (!isValid) {
                        return 'points should be in range of auction';
                    }
                } catch (e) {
                    return "points should be an array of valid amounts";
                }
                return null;
            }
        }
    ], [
        {
            key: "new",
            value: function _new(params) {
                return new QuoterCustomPresetRequest(params);
            }
        }
    ]);
    return QuoterCustomPresetRequest;
}();
