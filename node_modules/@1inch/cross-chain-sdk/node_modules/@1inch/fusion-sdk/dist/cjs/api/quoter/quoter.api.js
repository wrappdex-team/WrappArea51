"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "QuoterApi", {
    enumerable: true,
    get: function() {
        return QuoterApi;
    }
});
var _index = require("./quote/index.js");
var _params = require("../params.js");
var _index1 = require("../../connector/index.js");
function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) {
    try {
        var info = gen[key](arg);
        var value = info.value;
    } catch (error) {
        reject(error);
        return;
    }
    if (info.done) {
        resolve(value);
    } else {
        Promise.resolve(value).then(_next, _throw);
    }
}
function _async_to_generator(fn) {
    return function() {
        var self = this, args = arguments;
        return new Promise(function(resolve, reject) {
            var gen = fn.apply(self, args);
            function _next(value) {
                asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value);
            }
            function _throw(err) {
                asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err);
            }
            _next(undefined);
        });
    };
}
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
function _ts_generator(thisArg, body) {
    var f, y, t, g, _ = {
        label: 0,
        sent: function() {
            if (t[0] & 1) throw t[1];
            return t[1];
        },
        trys: [],
        ops: []
    };
    return g = {
        next: verb(0),
        "throw": verb(1),
        "return": verb(2)
    }, typeof Symbol === "function" && (g[Symbol.iterator] = function() {
        return this;
    }), g;
    function verb(n) {
        return function(v) {
            return step([
                n,
                v
            ]);
        };
    }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while(_)try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [
                op[0] & 2,
                t.value
            ];
            switch(op[0]){
                case 0:
                case 1:
                    t = op;
                    break;
                case 4:
                    _.label++;
                    return {
                        value: op[1],
                        done: false
                    };
                case 5:
                    _.label++;
                    y = op[1];
                    op = [
                        0
                    ];
                    continue;
                case 7:
                    op = _.ops.pop();
                    _.trys.pop();
                    continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
                        _ = 0;
                        continue;
                    }
                    if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
                        _.label = op[1];
                        break;
                    }
                    if (op[0] === 6 && _.label < t[1]) {
                        _.label = t[1];
                        t = op;
                        break;
                    }
                    if (t && _.label < t[2]) {
                        _.label = t[2];
                        _.ops.push(op);
                        break;
                    }
                    if (t[2]) _.ops.pop();
                    _.trys.pop();
                    continue;
            }
            op = body.call(thisArg, _);
        } catch (e) {
            op = [
                6,
                e
            ];
            y = 0;
        } finally{
            f = t = 0;
        }
        if (op[0] & 5) throw op[1];
        return {
            value: op[0] ? op[1] : void 0,
            done: true
        };
    }
}
var QuoterApi = /*#__PURE__*/ function() {
    "use strict";
    function QuoterApi(config, httpClient) {
        _class_call_check(this, QuoterApi);
        _define_property(this, "config", void 0);
        _define_property(this, "httpClient", void 0);
        this.config = config;
        this.httpClient = httpClient;
    }
    _create_class(QuoterApi, [
        {
            key: "getQuote",
            value: function getQuote(params) {
                var _this = this;
                return _async_to_generator(function() {
                    var queryParams, url, res;
                    return _ts_generator(this, function(_state) {
                        switch(_state.label){
                            case 0:
                                queryParams = (0, _params.concatQueryParams)(params.build());
                                url = "".concat(_this.config.url, "/").concat(QuoterApi.Version, "/").concat(_this.config.network, "/quote/receive/").concat(queryParams);
                                return [
                                    4,
                                    _this.httpClient.get(url)
                                ];
                            case 1:
                                res = _state.sent();
                                return [
                                    2,
                                    new _index.Quote(params, res)
                                ];
                        }
                    });
                })();
            }
        },
        {
            key: "getQuoteWithCustomPreset",
            value: function getQuoteWithCustomPreset(params, body) {
                var _this = this;
                return _async_to_generator(function() {
                    var bodyErr, queryParams, bodyParams, url, res;
                    return _ts_generator(this, function(_state) {
                        switch(_state.label){
                            case 0:
                                bodyErr = body.validate();
                                if (bodyErr) {
                                    throw new Error(bodyErr);
                                }
                                queryParams = (0, _params.concatQueryParams)(params.build());
                                bodyParams = body.build();
                                url = "".concat(_this.config.url, "/").concat(QuoterApi.Version, "/").concat(_this.config.network, "/quote/receive/").concat(queryParams);
                                return [
                                    4,
                                    _this.httpClient.post(url, bodyParams)
                                ];
                            case 1:
                                res = _state.sent();
                                return [
                                    2,
                                    new _index.Quote(params, res)
                                ];
                        }
                    });
                })();
            }
        }
    ], [
        {
            key: "new",
            value: function _new(config) {
                var httpClient = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : new _index1.AxiosProviderConnector(config.authKey);
                return new QuoterApi(config, httpClient);
            }
        }
    ]);
    return QuoterApi;
}();
_define_property(QuoterApi, "Version", 'v2.0');
