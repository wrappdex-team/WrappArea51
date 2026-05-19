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
    AmountCalculator: function() {
        return _amountcalculator.AmountCalculator;
    },
    FeeCalculator: function() {
        return FeeCalculator;
    }
});
var _limitordersdk = require("@1inch/limit-order-sdk");
_export_star(require("./auction-calculator/index.js"), exports);
var _amountcalculator = require("./amount-calculator.js");
function _export_star(from, to) {
    Object.keys(from).forEach(function(k) {
        if (k !== "default" && !Object.prototype.hasOwnProperty.call(to, k)) {
            Object.defineProperty(to, k, {
                enumerable: true,
                get: function() {
                    return from[k];
                }
            });
        }
    });
    return from;
}
var FeeCalculator = _limitordersdk.FeeTakerExt.FeeCalculator;
