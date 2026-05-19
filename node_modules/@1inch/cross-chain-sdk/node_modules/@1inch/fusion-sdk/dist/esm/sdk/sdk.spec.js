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
import { instance, mock } from 'ts-mockito';
import { FusionSDK } from './sdk.js';
import { Web3ProviderConnector } from '../connector/index.js';
import { NetworkEnum } from '../constants.js';
function createHttpProviderFake(mock) {
    var httpProvider = {
        get: jest.fn().mockImplementationOnce(function() {
            return Promise.resolve(mock);
        }),
        post: jest.fn().mockImplementation(function() {
            return Promise.resolve(null);
        })
    };
    return httpProvider;
}
describe(__filename, function() {
    var web3Provider;
    var web3ProviderConnector;
    beforeEach(function() {
        web3Provider = mock();
        web3ProviderConnector = new Web3ProviderConnector(instance(web3Provider));
    });
    it('returns encoded call data to cancel order', /*#__PURE__*/ _async_to_generator(function() {
        var url, expected, httpProvider, sdk, orderHash, callData;
        return _ts_generator(this, function(_state) {
            switch(_state.label){
                case 0:
                    url = 'https://test.com';
                    expected = {
                        order: {
                            salt: '45144194282371711345892930501725766861375817078109214409479816083205610767025',
                            maker: '0x6f250c769001617aff9bdf4b9fd878062e94af83',
                            receiver: '0x0000000000000000000000000000000000000000',
                            makerAsset: '0x6eb15148d0ea88433dd8088a3acc515d27e36c1b',
                            takerAsset: '0xdac17f958d2ee523a2206206994597c13d831ec7',
                            makingAmount: '2246481050155000',
                            takingAmount: '349837736598',
                            makerTraits: '0'
                        },
                        cancelTx: null,
                        points: null,
                        auctionStartDate: 1674491231,
                        auctionDuration: 180,
                        initialRateBump: 50484,
                        status: 'filled',
                        createdAt: '2023-01-23T16:26:38.803Z',
                        fromTokenToUsdPrice: '0.01546652159249409068',
                        toTokenToUsdPrice: '1.00135361305236370022',
                        fills: [
                            {
                                txHash: '0xcdd81e6860fc038d4fe8549efdf18488154667a2088d471cdaa7d492f24178a1',
                                filledMakerAmount: '2246481050155001',
                                filledAuctionTakerAmount: '351593117428'
                            }
                        ],
                        isNativeCurrency: false
                    };
                    httpProvider = createHttpProviderFake(expected);
                    sdk = new FusionSDK({
                        url: url,
                        network: NetworkEnum.ETHEREUM,
                        httpProvider: httpProvider,
                        blockchainProvider: web3ProviderConnector
                    });
                    orderHash = "0x1beee023ab933cf5446c298eadadb61c05705f2156ef5b2db36c160b36f31ce4";
                    return [
                        4,
                        sdk.buildCancelOrderCallData(orderHash)
                    ];
                case 1:
                    callData = _state.sent();
                    expect(callData).toBe('0xb68fb02000000000000000000000000000000000000000000000000000000000000000001beee023ab933cf5446c298eadadb61c05705f2156ef5b2db36c160b36f31ce4');
                    return [
                        2
                    ];
            }
        });
    }));
    it('throws an exception if order is not get from api', /*#__PURE__*/ _async_to_generator(function() {
        var url, expected, httpProvider, sdk, orderHash, promise;
        return _ts_generator(this, function(_state) {
            switch(_state.label){
                case 0:
                    url = 'https://test.com';
                    expected = undefined;
                    httpProvider = createHttpProviderFake(expected);
                    sdk = new FusionSDK({
                        url: url,
                        network: NetworkEnum.ETHEREUM,
                        httpProvider: httpProvider,
                        blockchainProvider: web3ProviderConnector
                    });
                    orderHash = "0x1beee023ab933cf5446c298eadadb61c05705f2156ef5b2db36c160b36f31ce4";
                    promise = sdk.buildCancelOrderCallData(orderHash);
                    return [
                        4,
                        expect(promise).rejects.toThrow('Can not get order with the specified orderHash 0x1beee023ab933cf5446c298eadadb61c05705f2156ef5b2db36c160b36f31ce4')
                    ];
                case 1:
                    _state.sent();
                    return [
                        2
                    ];
            }
        });
    }));
});
