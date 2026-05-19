"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "FusionApi", {
    enumerable: true,
    get: function() {
        return FusionApi;
    }
});
var _index = require("./quoter/index.js");
var _index1 = require("./relayer/index.js");
var _index2 = require("./orders/index.js");
var _ordersVersion = require("./ordersVersion.js");
var _index3 = require("../connector/index.js");
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
var FusionApi = /*#__PURE__*/ function() {
    "use strict";
    function FusionApi(config) {
        _class_call_check(this, FusionApi);
        _define_property(this, "quoterApi", void 0);
        _define_property(this, "relayerApi", void 0);
        _define_property(this, "ordersApi", void 0);
        this.quoterApi = _index.QuoterApi.new({
            url: "".concat(config.url, "/quoter"),
            network: config.network,
            authKey: config.authKey
        }, config.httpProvider);
        this.relayerApi = _index1.RelayerApi.new({
            url: "".concat(config.url, "/relayer"),
            network: config.network,
            authKey: config.authKey
        }, config.httpProvider);
        this.ordersApi = _index2.OrdersApi.new({
            url: "".concat(config.url, "/orders"),
            network: config.network,
            authKey: config.authKey
        }, config.httpProvider);
    }
    _create_class(FusionApi, [
        {
            key: "getQuote",
            value: function getQuote(params) {
                return this.quoterApi.getQuote(params);
            }
        },
        {
            key: "getQuoteWithCustomPreset",
            value: function getQuoteWithCustomPreset(params, body) {
                return this.quoterApi.getQuoteWithCustomPreset(params, body);
            }
        },
        {
            key: "getActiveOrders",
            value: function getActiveOrders() {
                var params = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : _index2.ActiveOrdersRequest.new(), ordersVersion = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : _ordersVersion.OrdersVersion._2_1;
                return this.ordersApi.getActiveOrders(params, ordersVersion);
            }
        },
        {
            key: "getOrderStatus",
            value: function getOrderStatus(params) {
                return this.ordersApi.getOrderStatus(params);
            }
        },
        {
            key: "getOrdersByMaker",
            value: function getOrdersByMaker(params) {
                var ordersVersion = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : _ordersVersion.OrdersVersion._2_1;
                return this.ordersApi.getOrdersByMaker(params, ordersVersion);
            }
        },
        {
            key: "submitOrder",
            value: function submitOrder(params) {
                return this.relayerApi.submit(params);
            }
        },
        {
            key: "submitOrderBatch",
            value: function submitOrderBatch(params) {
                return this.relayerApi.submitBatch(params);
            }
        }
    ], [
        {
            key: "new",
            value: function _new(config) {
                return new FusionApi({
                    network: config.network,
                    url: config.url,
                    authKey: config.authKey,
                    httpProvider: config.httpProvider || new _index3.AxiosProviderConnector(config.authKey)
                });
            }
        }
    ]);
    return FusionApi;
}();
