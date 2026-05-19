"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WebsocketClient", {
    enumerable: true,
    get: function() {
        return WebsocketClient;
    }
});
var _ws = /*#__PURE__*/ _interop_require_default(require("ws"));
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
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
var WebsocketClient = /*#__PURE__*/ function() {
    "use strict";
    function WebsocketClient(config) {
        _class_call_check(this, WebsocketClient);
        _define_property(this, "ws", void 0);
        _define_property(this, "url", void 0);
        _define_property(this, "initialized", void 0);
        _define_property(this, "authKey", void 0);
        this.url = config.url;
        this.authKey = config.authKey;
        var lazyInit = config.lazyInit || false;
        if (!lazyInit) {
            this.initialized = true;
            this.ws = new _ws.default(this.url, this.authKey ? {
                headers: {
                    Authorization: "Bearer ".concat(this.authKey)
                }
            } : undefined);
            return;
        }
        this.initialized = false;
    }
    _create_class(WebsocketClient, [
        {
            key: "init",
            value: function init() {
                if (this.initialized) {
                    throw new Error('WebSocket is already initialized');
                }
                // @ts-expect-error hack for readonly property
                this.initialized = true;
                // @ts-expect-error hack for readonly property
                this.ws = new _ws.default(this.url, this.authKey ? {
                    headers: {
                        Authorization: "Bearer ".concat(this.authKey)
                    }
                } : undefined);
            }
        },
        {
            key: "on",
            value: function on(event, cb) {
                this.checkInitialized();
                this.ws.on(event, cb);
            }
        },
        {
            key: "off",
            value: function off(event, cb) {
                this.checkInitialized();
                this.ws.off(event, cb);
            }
        },
        {
            key: "onOpen",
            value: function onOpen(cb) {
                this.on('open', cb);
            }
        },
        {
            key: "send",
            value: function send(message) {
                this.checkInitialized();
                var serialized = JSON.stringify(message);
                this.ws.send(serialized);
            }
        },
        {
            key: "onMessage",
            value: function onMessage(cb) {
                this.on('message', function(data) {
                    var parsedData = JSON.parse(data);
                    cb(parsedData);
                });
            }
        },
        {
            key: "ping",
            value: function ping() {
                this.ws.ping();
            }
        },
        {
            key: "onPong",
            value: function onPong(cb) {
                this.on('pong', function() {
                    cb();
                });
            }
        },
        {
            key: "onClose",
            value: function onClose(cb) {
                this.on('close', cb);
            }
        },
        {
            key: "onError",
            value: function onError(cb) {
                this.on('error', cb);
            }
        },
        {
            key: "close",
            value: function close() {
                this.checkInitialized();
                this.ws.close();
            }
        },
        {
            key: "checkInitialized",
            value: function checkInitialized() {
                if (!this.initialized) {
                    throwInitError();
                }
            }
        }
    ]);
    return WebsocketClient;
}();
function throwInitError() {
    throw new Error('WebSocket is not initialized. Call init() first.');
}
