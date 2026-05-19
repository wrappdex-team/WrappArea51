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
import { PaginationRequest } from '../api/pagination.js';
export var RpcWebsocketApi = /*#__PURE__*/ function() {
    "use strict";
    function RpcWebsocketApi(provider) {
        _class_call_check(this, RpcWebsocketApi);
        _define_property(this, "provider", void 0);
        this.provider = provider;
    }
    _create_class(RpcWebsocketApi, [
        {
            key: "onPong",
            value: function onPong(cb) {
                this.provider.onMessage(function(data) {
                    if (data.method === 'ping') {
                        cb(data.result);
                    }
                });
            }
        },
        {
            key: "ping",
            value: function ping() {
                this.provider.send({
                    method: 'ping'
                });
            }
        },
        {
            key: "getActiveOrders",
            value: function getActiveOrders() {
                var _ref = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {}, limit = _ref.limit, page = _ref.page;
                var paginationRequest = new PaginationRequest(page, limit);
                var err = paginationRequest.validate();
                if (err) {
                    throw new Error(err);
                }
                this.provider.send({
                    method: 'getActiveOrders',
                    param: {
                        limit: limit,
                        page: page
                    }
                });
            }
        },
        {
            key: "onGetActiveOrders",
            value: function onGetActiveOrders(cb) {
                this.provider.onMessage(function(data) {
                    if (data.method === 'getActiveOrders') {
                        cb(data.result);
                    }
                });
            }
        },
        {
            key: "getAllowedMethods",
            value: function getAllowedMethods() {
                this.provider.send({
                    method: 'getAllowedMethods'
                });
            }
        },
        {
            key: "onGetAllowedMethods",
            value: function onGetAllowedMethods(cb) {
                this.provider.onMessage(function(data) {
                    if (data.method === 'getAllowedMethods') {
                        cb(data.result);
                    }
                });
            }
        }
    ]);
    return RpcWebsocketApi;
}();
