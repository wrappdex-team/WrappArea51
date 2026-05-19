"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AuctionCalculator", {
    enumerable: true,
    get: function() {
        return AuctionCalculator;
    }
});
var _limitordersdk = require("@1inch/limit-order-sdk");
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
var AuctionCalculator = /*#__PURE__*/ function() {
    "use strict";
    function AuctionCalculator(// 1000 means 1 Gwei
    startTime, duration, initialRateBump, points) {
        var gasCost = arguments.length > 4 && arguments[4] !== void 0 ? arguments[4] : {
            gasBumpEstimate: 0n,
            gasPriceEstimate: 0n
        };
        _class_call_check(this, AuctionCalculator);
        _define_property(this, "startTime", void 0);
        _define_property(this, "duration", void 0);
        _define_property(this, "initialRateBump", void 0);
        _define_property(this, "points", void 0);
        _define_property(this, "gasCost", void 0);
        this.startTime = startTime;
        this.duration = duration;
        this.initialRateBump = initialRateBump;
        this.points = points;
        this.gasCost = gasCost;
    }
    _create_class(AuctionCalculator, [
        {
            key: "finishTime",
            get: function get() {
                return this.startTime + this.duration;
            }
        },
        {
            key: "calcAuctionTakingAmount",
            value: function calcAuctionTakingAmount(takingAmount, rate) {
                return AuctionCalculator.calcAuctionTakingAmount(takingAmount, rate);
            }
        },
        {
            key: "calcRateBump",
            value: /**
     * @see https://github.com/1inch/limit-order-settlement/blob/273defdf7b0f1867299dcbc306f32f035579310f/contracts/extensions/BaseExtension.sol#L121
     * @param time auction timestamp in seconds
     * @param blockBaseFee blockBaseFee in Wei, if passed, then rate will be calculated as if order executed in block with `blockBaseFee`
     */ function calcRateBump(time) {
                var blockBaseFee = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 0n;
                var gasBump = this.getGasPriceBump(blockBaseFee);
                var auctionBump = this.getAuctionBump(time);
                var final = auctionBump > gasBump ? auctionBump - gasBump : 0n;
                return Number(final);
            }
        },
        {
            key: "getGasPriceBump",
            value: function getGasPriceBump(blockBaseFee) {
                if (this.gasCost.gasBumpEstimate === 0n || this.gasCost.gasPriceEstimate === 0n || blockBaseFee === 0n) {
                    return 0n;
                }
                return this.gasCost.gasBumpEstimate * blockBaseFee / this.gasCost.gasPriceEstimate / AuctionCalculator.GAS_PRICE_BASE;
            }
        },
        {
            key: "getAuctionBump",
            value: function getAuctionBump(blockTime) {
                var auctionFinishTime = this.finishTime;
                if (blockTime <= this.startTime) {
                    return this.initialRateBump;
                } else if (blockTime >= auctionFinishTime) {
                    return 0n;
                }
                var currentPointTime = this.startTime;
                var currentRateBump = this.initialRateBump;
                var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
                try {
                    for(var _iterator = this.points[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
                        var _step_value = _step.value, nextRateBump = _step_value.coefficient, delay = _step_value.delay;
                        var nextPointTime = BigInt(delay) + currentPointTime;
                        if (blockTime <= nextPointTime) {
                            return ((blockTime - currentPointTime) * BigInt(nextRateBump) + (nextPointTime - blockTime) * currentRateBump) / (nextPointTime - currentPointTime);
                        }
                        currentPointTime = nextPointTime;
                        currentRateBump = BigInt(nextRateBump);
                    }
                } catch (err) {
                    _didIteratorError = true;
                    _iteratorError = err;
                } finally{
                    try {
                        if (!_iteratorNormalCompletion && _iterator.return != null) {
                            _iterator.return();
                        }
                    } finally{
                        if (_didIteratorError) {
                            throw _iteratorError;
                        }
                    }
                }
                return (auctionFinishTime - blockTime) * currentRateBump / (auctionFinishTime - currentPointTime);
            }
        }
    ], [
        {
            key: "fromAuctionData",
            value: function fromAuctionData(details) {
                return new AuctionCalculator(details.startTime, details.duration, details.initialRateBump, details.points, details.gasCost);
            }
        },
        {
            key: "calcInitialRateBump",
            value: function calcInitialRateBump(startAmount, endAmount) {
                var bump = AuctionCalculator.RATE_BUMP_DENOMINATOR * startAmount / endAmount - AuctionCalculator.RATE_BUMP_DENOMINATOR;
                return Number(bump);
            }
        },
        {
            key: "calcAuctionTakingAmount",
            value: /**
     * @see https://github.com/1inch/limit-order-settlement/blob/82f0a25c969170f710825ce6aa6920062adbde88/contracts/SimpleSettlement.sol#L54
     */ function calcAuctionTakingAmount(takingAmount, rate) {
                return (0, _limitordersdk.mulDiv)(takingAmount, BigInt(rate) + AuctionCalculator.RATE_BUMP_DENOMINATOR, AuctionCalculator.RATE_BUMP_DENOMINATOR, _limitordersdk.Rounding.Ceil);
            }
        },
        {
            key: "calcAuctionMakingAmount",
            value: /**
     * @see https://github.com/1inch/limit-order-settlement/blob/82f0a25c969170f710825ce6aa6920062adbde88/contracts/SimpleSettlement.sol#L34
     */ function calcAuctionMakingAmount(makingAmount, rate) {
                return (0, _limitordersdk.mulDiv)(makingAmount, AuctionCalculator.RATE_BUMP_DENOMINATOR, BigInt(rate) + AuctionCalculator.RATE_BUMP_DENOMINATOR);
            }
        },
        {
            key: "baseFeeToGasPriceEstimate",
            value: /**
     * Encode estimation `baseFee` as `gasPriceEstimate` for `AuctionGasCostInfo`
     */ function baseFeeToGasPriceEstimate(baseFee) {
                return baseFee / AuctionCalculator.GAS_PRICE_BASE;
            }
        },
        {
            key: "calcGasBumpEstimate",
            value: /**
     * Calculates `gasBumpEstimate` for `AuctionGasCostInfo`
     *
     * @param endTakingAmount min return in destToken
     * @param gasCostInToToken gas cost in destToken
     */ function calcGasBumpEstimate(endTakingAmount, gasCostInToToken) {
                return gasCostInToToken * AuctionCalculator.RATE_BUMP_DENOMINATOR / endTakingAmount;
            }
        }
    ]);
    return AuctionCalculator;
}();
_define_property(AuctionCalculator, "RATE_BUMP_DENOMINATOR", 10000000n);
// 100%
_define_property(AuctionCalculator, "GAS_PRICE_BASE", 1000000n);
