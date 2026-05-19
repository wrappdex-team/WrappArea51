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
function _object_spread(target) {
    for(var i = 1; i < arguments.length; i++){
        var source = arguments[i] != null ? arguments[i] : {};
        var ownKeys = Object.keys(source);
        if (typeof Object.getOwnPropertySymbols === "function") {
            ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function(sym) {
                return Object.getOwnPropertyDescriptor(source, sym).enumerable;
            }));
        }
        ownKeys.forEach(function(key) {
            _define_property(target, key, source[key]);
        });
    }
    return target;
}
function ownKeys(object, enumerableOnly) {
    var keys = Object.keys(object);
    if (Object.getOwnPropertySymbols) {
        var symbols = Object.getOwnPropertySymbols(object);
        if (enumerableOnly) {
            symbols = symbols.filter(function(sym) {
                return Object.getOwnPropertyDescriptor(object, sym).enumerable;
            });
        }
        keys.push.apply(keys, symbols);
    }
    return keys;
}
function _object_spread_props(target, source) {
    source = source != null ? source : {};
    if (Object.getOwnPropertyDescriptors) {
        Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    } else {
        ownKeys(Object(source)).forEach(function(key) {
            Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
        });
    }
    return target;
}
import { ActiveOrdersWebSocketApi } from './active-websocket-orders-api.js';
import { RpcWebsocketApi } from './rpc-websocket-api.js';
import { castUrl } from './url.js';
import { WebsocketClient } from '../connector/ws/index.js';
export var WebSocketApi = /*#__PURE__*/ function() {
    "use strict";
    function WebSocketApi(configOrProvider) {
        _class_call_check(this, WebSocketApi);
        _define_property(this, "rpc", void 0);
        _define_property(this, "order", void 0);
        _define_property(this, "provider", void 0);
        if (instanceOfWsApiConfigWithNetwork(configOrProvider)) {
            var url = castUrl(configOrProvider.url);
            var urlWithNetwork = "".concat(url, "/").concat(WebSocketApi.Version, "/").concat(configOrProvider.network);
            var configWithUrl = _object_spread_props(_object_spread({}, configOrProvider), {
                url: urlWithNetwork
            });
            var provider = new WebsocketClient(configWithUrl);
            this.provider = provider;
            this.rpc = new RpcWebsocketApi(provider);
            this.order = new ActiveOrdersWebSocketApi(provider);
            return;
        }
        this.provider = configOrProvider;
        this.rpc = new RpcWebsocketApi(configOrProvider);
        this.order = new ActiveOrdersWebSocketApi(configOrProvider);
    }
    _create_class(WebSocketApi, [
        {
            key: "init",
            value: function init() {
                this.provider.init();
            }
        },
        {
            key: "on",
            value: function on(event, cb) {
                this.provider.on(event, cb);
            }
        },
        {
            key: "off",
            value: function off(event, cb) {
                this.provider.off(event, cb);
            }
        },
        {
            key: "onOpen",
            value: function onOpen(cb) {
                this.provider.onOpen(cb);
            }
        },
        {
            key: "send",
            value: function send(message) {
                this.provider.send(message);
            }
        },
        {
            key: "close",
            value: function close() {
                this.provider.close();
            }
        },
        {
            key: "onMessage",
            value: function onMessage(cb) {
                this.provider.onMessage(cb);
            }
        },
        {
            key: "onClose",
            value: function onClose(cb) {
                this.provider.onClose(cb);
            }
        },
        {
            key: "onError",
            value: function onError(cb) {
                this.provider.onError(cb);
            }
        }
    ], [
        {
            key: "new",
            value: function _new(configOrProvider) {
                return new WebSocketApi(configOrProvider);
            }
        }
    ]);
    return WebSocketApi;
}();
_define_property(WebSocketApi, "Version", 'v2.0');
function instanceOfWsApiConfigWithNetwork(val) {
    return 'url' in val && 'network' in val;
}
