"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
var _tsmockito = require("ts-mockito");
var _limitordersdk = require("@1inch/limit-order-sdk");
var _web3providerconnector = require("./web3-provider-connector.js");
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
describe('Web3 provider connector', function() {
    var web3Provider;
    var web3ProviderConnector;
    var limitOrder = {
        salt: '618054093254',
        makerAsset: '0xe9e7cea3dedca5984780bafc599bd69add087d56',
        takerAsset: '0x111111111117dc0aa78b770fa6a738034120c302',
        maker: '0xfb3c7eb936cAA12B5A884d612393969A557d4307',
        receiver: '0x0000000000000000000000000000000000000000',
        makingAmount: '1000000000000000000',
        takingAmount: '1000000000000000000',
        makerTraits: '0'
    };
    var typedData = {
        primaryType: 'Order',
        types: {
            EIP712Domain: _limitordersdk.EIP712Domain,
            Order: _limitordersdk.Order
        },
        domain: {
            name: _limitordersdk.LimitOrderV4TypeDataName,
            version: _limitordersdk.LimitOrderV4TypeDataVersion,
            chainId: 1,
            verifyingContract: (0, _limitordersdk.getLimitOrderContract)(1)
        },
        message: limitOrder
    };
    beforeEach(function() {
        web3Provider = (0, _tsmockito.mock)();
        web3ProviderConnector = new _web3providerconnector.Web3ProviderConnector((0, _tsmockito.instance)(web3Provider));
    });
    it('should call eth_signTypedData_v4 rpc method', /*#__PURE__*/ _async_to_generator(function() {
        var walletAddress, extendedWeb3;
        return _ts_generator(this, function(_state) {
            switch(_state.label){
                case 0:
                    walletAddress = '0xasd';
                    extendedWeb3 = {
                        signTypedDataV4: jest.fn()
                    };
                    (0, _tsmockito.when)(web3Provider.extend((0, _tsmockito.anything)())).thenReturn(extendedWeb3);
                    return [
                        4,
                        web3ProviderConnector.signTypedData(walletAddress, typedData)
                    ];
                case 1:
                    _state.sent();
                    expect(extendedWeb3.signTypedDataV4).toHaveBeenCalledWith(walletAddress, JSON.stringify(typedData));
                    return [
                        2
                    ];
            }
        });
    }));
});
