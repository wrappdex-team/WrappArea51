"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    addRatioToAmount: function() {
        return addRatioToAmount;
    },
    bpsToRatioFormat: function() {
        return bpsToRatioFormat;
    }
});
var FEE_BASE = 100000n;
var BPS_BASE = 10000n;
var BPS_TO_RATIO_NUMERATOR = FEE_BASE / BPS_BASE;
function bpsToRatioFormat(bps) {
    if (!bps) {
        return 0n;
    }
    return BigInt(bps) * BPS_TO_RATIO_NUMERATOR;
}
function addRatioToAmount(amount, ratio) {
    return amount + amount * ratio / FEE_BASE;
}
