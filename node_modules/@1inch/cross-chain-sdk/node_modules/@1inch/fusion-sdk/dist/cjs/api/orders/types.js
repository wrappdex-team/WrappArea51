"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "OrderStatus", {
    enumerable: true,
    get: function() {
        return OrderStatus;
    }
});
var OrderStatus = /*#__PURE__*/ function(OrderStatus) {
    OrderStatus["Pending"] = "pending";
    OrderStatus["Filled"] = "filled";
    OrderStatus["FalsePredicate"] = "false-predicate";
    OrderStatus["NotEnoughBalanceOrAllowance"] = "not-enough-balance-or-allowance";
    OrderStatus["Expired"] = "expired";
    OrderStatus["PartiallyFilled"] = "partially-filled";
    OrderStatus["WrongPermit"] = "wrong-permit";
    OrderStatus["Cancelled"] = "cancelled";
    OrderStatus["InvalidSignature"] = "invalid-signature";
    return OrderStatus;
}({});
