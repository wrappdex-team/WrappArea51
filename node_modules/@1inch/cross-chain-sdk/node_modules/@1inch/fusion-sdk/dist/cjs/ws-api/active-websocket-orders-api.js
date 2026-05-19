"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ActiveOrdersWebSocketApi", {
    enumerable: true,
    get: function() {
        return ActiveOrdersWebSocketApi;
    }
});
var _constants = require("./constants.js");
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
var ActiveOrdersWebSocketApi = /*#__PURE__*/ function() {
    "use strict";
    function ActiveOrdersWebSocketApi(provider) {
        _class_call_check(this, ActiveOrdersWebSocketApi);
        _define_property(this, "provider", void 0);
        this.provider = provider;
    }
    _create_class(ActiveOrdersWebSocketApi, [
        {
            key: "onOrder",
            value: function onOrder(cb) {
                this.provider.onMessage(function(data) {
                    if (_constants.orderEvents.includes(data.event)) {
                        cb(data);
                    }
                });
            }
        },
        {
            key: "onOrderCreated",
            value: function onOrderCreated(cb) {
                this.provider.onMessage(function(data) {
                    if (data.event === 'order_created') {
                        cb(data);
                    }
                });
            }
        },
        {
            key: "onOrderInvalid",
            value: function onOrderInvalid(cb) {
                this.provider.onMessage(function(data) {
                    if (data.event === 'order_invalid') {
                        cb(data);
                    }
                });
            }
        },
        {
            key: "onOrderBalanceOrAllowanceChange",
            value: function onOrderBalanceOrAllowanceChange(cb) {
                this.provider.onMessage(function(data) {
                    if (data.event === 'order_balance_or_allowance_change') {
                        cb(data);
                    }
                });
            }
        },
        {
            key: "onOrderFilled",
            value: function onOrderFilled(cb) {
                this.provider.onMessage(function(data) {
                    if (data.event === 'order_filled') {
                        cb(data);
                    }
                });
            }
        },
        {
            key: "onOrderCancelled",
            value: function onOrderCancelled(cb) {
                this.provider.onMessage(function(data) {
                    if (data.event === 'order_cancelled') {
                        cb(data);
                    }
                });
            }
        },
        {
            key: "onOrderFilledPartially",
            value: function onOrderFilledPartially(cb) {
                this.provider.onMessage(function(data) {
                    if (data.event === 'order_filled_partially') {
                        cb(data);
                    }
                });
            }
        }
    ]);
    return ActiveOrdersWebSocketApi;
}();
