"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
var _relayerapi = require("./relayer.api.js");
var _relayerrequest = require("./relayer.request.js");
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
describe('Relayer API', function() {
    var httpProvider = {
        get: jest.fn().mockImplementationOnce(function() {
            return Promise.resolve();
        }),
        post: jest.fn().mockImplementation(function() {
            return Promise.resolve();
        })
    };
    it('should submit one order', /*#__PURE__*/ _async_to_generator(function() {
        var quoter, orderData, params;
        return _ts_generator(this, function(_state) {
            switch(_state.label){
                case 0:
                    quoter = _relayerapi.RelayerApi.new({
                        url: 'https://test.com/relayer',
                        network: 1
                    }, httpProvider);
                    orderData = {
                        order: {
                            maker: '0x00000000219ab540356cbb839cbe05303d7705fa',
                            makerAsset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
                            makingAmount: '1000000000000000000',
                            receiver: '0x0000000000000000000000000000000000000000',
                            salt: '45118768841948961586167738353692277076075522015101619148498725069326976558864',
                            takerAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                            takingAmount: '1420000000',
                            makerTraits: '0'
                        },
                        signature: '0x123signature-here789',
                        quoteId: '9a43c86d-f3d7-45b9-8cb6-803d2bdfa08b',
                        extension: '0x'
                    };
                    params = _relayerrequest.RelayerRequest.new(orderData);
                    return [
                        4,
                        quoter.submit(params)
                    ];
                case 1:
                    _state.sent();
                    expect(httpProvider.post).toHaveBeenCalledWith('https://test.com/relayer/v2.0/1/order/submit', orderData);
                    return [
                        2
                    ];
            }
        });
    }));
    it('should submit two orders order', /*#__PURE__*/ _async_to_generator(function() {
        var quoter, orderData1, orderData2, params;
        return _ts_generator(this, function(_state) {
            switch(_state.label){
                case 0:
                    quoter = _relayerapi.RelayerApi.new({
                        url: 'https://test.com/relayer',
                        network: 1
                    }, httpProvider);
                    orderData1 = {
                        order: {
                            maker: '0x00000000219ab540356cbb839cbe05303d7705fa',
                            makerAsset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
                            makingAmount: '1000000000000000000',
                            receiver: '0x0000000000000000000000000000000000000000',
                            salt: '45118768841948961586167738353692277076075522015101619148498725069326976558864',
                            takerAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                            takingAmount: '1420000000',
                            makerTraits: '0'
                        },
                        signature: '0x123signature-here789',
                        quoteId: '9a43c86d-f3d7-45b9-8cb6-803d2bdfa08b',
                        extension: '0x'
                    };
                    orderData2 = {
                        order: {
                            maker: '0x12345678219ab540356cbb839cbe05303d771111',
                            makerAsset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
                            makingAmount: '1000000000000000000',
                            receiver: '0x0000000000000000000000000000000000000000',
                            salt: '45118768841948961586167738353692277076075522015101619148498725069326976558864',
                            takerAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                            takingAmount: '1420000000',
                            makerTraits: '0'
                        },
                        signature: '0x123signature-2-here789',
                        quoteId: '1a36c861-ffd7-45b9-1cb6-403d3bdfa084',
                        extension: '0x'
                    };
                    params = [
                        _relayerrequest.RelayerRequest.new(orderData1),
                        _relayerrequest.RelayerRequest.new(orderData2)
                    ];
                    return [
                        4,
                        quoter.submitBatch(params)
                    ];
                case 1:
                    _state.sent();
                    expect(httpProvider.post).toHaveBeenCalledWith('https://test.com/relayer/v2.0/1/order/submit/many', params);
                    return [
                        2
                    ];
            }
        });
    }));
});
