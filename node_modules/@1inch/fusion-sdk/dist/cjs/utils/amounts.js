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
    calcMakingAmount: function() {
        return calcMakingAmount;
    },
    calcTakingAmount: function() {
        return calcTakingAmount;
    }
});
/**
 * Calculates taker amount by linear proportion
 * Note: use for minReturn only, because other amounts calculated based on auction curve
 *
 * @see AuctionCalculator
 * @return Ceiled taker amount
 * @see https://github.com/1inch/limit-order-protocol/blob/23d655844191dea7960a186652307604a1ed480a/contracts/libraries/AmountCalculatorLib.sol#L6
 */ function calcTakingAmount(swapMakerAmount, orderMakerAmount, orderTakerAmount) {
    return (swapMakerAmount * orderTakerAmount + orderMakerAmount - 1n) / orderMakerAmount;
}
/**
 * Calculates maker amount by linear proportion
 * Note: use for minReturn only, because other amounts calculated based on auction curve
 *
 * @see AuctionCalculator
 * @return Floored maker amount
 * @see https://github.com/1inch/limit-order-protocol/blob/23d655844191dea7960a186652307604a1ed480a/contracts/libraries/AmountCalculatorLib.sol#L6
 */ function calcMakingAmount(swapTakerAmount, orderMakerAmount, orderTakerAmount) {
    return swapTakerAmount * orderMakerAmount / orderTakerAmount;
}
