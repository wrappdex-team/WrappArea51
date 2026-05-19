"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderEvents = void 0;
const types_js_1 = require("./types.js");
exports.orderEvents = [
    types_js_1.EventType.OrderCreated,
    types_js_1.EventType.OrderInvalid,
    types_js_1.EventType.OrderBalanceChange,
    types_js_1.EventType.OrderAllowanceChange,
    types_js_1.EventType.OrderFilled,
    types_js_1.EventType.OrderFilledPartially,
    types_js_1.EventType.OrderCancelled,
    types_js_1.EventType.OrderSecretShared
];
//# sourceMappingURL=constants.js.map