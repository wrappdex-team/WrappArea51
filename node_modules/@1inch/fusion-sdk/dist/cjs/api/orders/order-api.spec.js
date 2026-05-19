"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
var _tsmockito = require("ts-mockito");
var _types = require("./types.js");
var _index = require("../../connector/index.js");
var _constants = require("../../constants.js");
var _index1 = require("../../sdk/index.js");
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
function createHttpProviderFake(mock) {
    return {
        get: jest.fn().mockImplementationOnce(function() {
            return Promise.resolve(mock);
        }),
        post: jest.fn().mockImplementation(function() {
            return Promise.resolve(null);
        })
    };
}
describe(__filename, function() {
    var web3Provider;
    var web3ProviderConnector;
    beforeEach(function() {
        web3Provider = (0, _tsmockito.mock)();
        web3ProviderConnector = new _index.Web3ProviderConnector((0, _tsmockito.instance)(web3Provider));
    });
    describe('getActiveOrders', function() {
        it('success', /*#__PURE__*/ _async_to_generator(function() {
            var expected, url, httpProvider, sdk, response;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        expected = {
                            items: [
                                {
                                    quoteId: '6f3dc6f8-33d3-478b-9f70-2f7c2becc488',
                                    orderHash: '0x496755a88564d8ded6759dff0252d3e6c3ef1fe42b4fa1bbc3f03bd2674f1078',
                                    signature: '0xb6ffc4f4f8500b5f49d2d01bc83efa5750b10f242db3f10f09df51df1fafe6604b35342a2aadc9f10ad14cbaaad9844689a5386c860c31212be3452601eb71de1c',
                                    deadline: '2024-04-25T13:27:48.000Z',
                                    auctionStartDate: '2024-04-25T13:24:36.000Z',
                                    auctionEndDate: '2024-04-25T13:27:36.000Z',
                                    remainingMakerAmount: '33058558528525703',
                                    order: {
                                        salt: '102412815596156525137376967412477025111761562902072504909418068904100646989168',
                                        maker: '0xe2668d9bef0a686c9874882f7037758b5b520e5c',
                                        receiver: '0x0000000000000000000000000000000000000000',
                                        makerAsset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
                                        takerAsset: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
                                        makerTraits: '62419173104490761595518734107493289545375808488163256166876037723686174720000',
                                        makingAmount: '33058558528525703',
                                        takingAmount: '147681'
                                    },
                                    extension: '0x000000830000005e0000005e0000005e0000005e0000002f0000000000000000fb2809a5314473e1165f6b58018e20ed8f07b8400c956a00003e1b662a59940000b40ecaaa002b1d00540e41ea003cfb2809a5314473e1165f6b58018e20ed8f07b8400c956a00003e1b662a59940000b40ecaaa002b1d00540e41ea003cfb2809a5314473e1165f6b58018e20ed8f07b840662a597cd1a23c3abeed63c51b86000008',
                                    version: '2.2'
                                },
                                {
                                    quoteId: '8343588a-da1e-407f-b41f-aa86f0ec4266',
                                    orderHash: '0x153386fa8e0b27b09d1250455521531e392e342571de31ac50836a3b6b9001d8',
                                    signature: '0x9ef06d325568887caace5f82bba23c821224df23886675fdd63259ee1594269e2768f58fe90a0ae6009184f2f422eb61e9cbd4f6d3c674befd0e55302995d4301c',
                                    deadline: '2023-01-31T11:01:06.000Z',
                                    auctionStartDate: '2023-01-31T10:58:11.000Z',
                                    auctionEndDate: '2023-01-31T11:01:11.000Z',
                                    remainingMakerAmount: '470444951856649710700841',
                                    order: {
                                        salt: '102412815605188492728297784997818915205705878873010401762040598952855113412064',
                                        maker: '0xdc8152a435d76fc89ced8255e28f690962c27e52',
                                        receiver: '0x0000000000000000000000000000000000000000',
                                        makerAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                                        takerAsset: '0xdac17f958d2ee523a2206206994597c13d831ec7',
                                        makerTraits: '62419173104490761595518734107503940736863610329190665072877236599067968012288',
                                        makingAmount: '30000000',
                                        takingAmount: '20653338'
                                    },
                                    extension: '0x00000079000000540000005400000054000000540000002a0000000000000000fb2809a5314473e1165f6b58018e20ed8f07b840423b06000034016627b1dc0000b444e602447208003cfb2809a5314473e1165f6b58018e20ed8f07b840423b06000034016627b1dc0000b444e602447208003cfb2809a5314473e1165f6b58018e20ed8f07b8406627b1c4d1a23c3abeed63c51b86000008',
                                    version: '2.2'
                                }
                            ],
                            meta: {
                                totalItems: 11,
                                currentPage: 1,
                                itemsPerPage: 2,
                                totalPages: 6
                            }
                        };
                        url = 'https://test.com';
                        httpProvider = createHttpProviderFake(expected);
                        sdk = new _index1.FusionSDK({
                            url: url,
                            network: _constants.NetworkEnum.ETHEREUM,
                            httpProvider: httpProvider,
                            blockchainProvider: web3ProviderConnector
                        });
                        return [
                            4,
                            sdk.getActiveOrders({
                                page: 1,
                                limit: 2
                            })
                        ];
                    case 1:
                        response = _state.sent();
                        expect(response).toEqual(expected);
                        expect(httpProvider.get).toHaveBeenLastCalledWith("".concat(url, "/orders/v2.0/1/order/active/?page=1&limit=2&version=2.1"));
                        return [
                            2
                        ];
                }
            });
        }));
        it('passes without providing args', /*#__PURE__*/ _async_to_generator(function() {
            var expected, url, httpProvider, sdk, response;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        expected = {
                            items: [
                                {
                                    quoteId: '6f3dc6f8-33d3-478b-9f70-2f7c2becc488',
                                    orderHash: '0x496755a88564d8ded6759dff0252d3e6c3ef1fe42b4fa1bbc3f03bd2674f1078',
                                    signature: '0xb6ffc4f4f8500b5f49d2d01bc83efa5750b10f242db3f10f09df51df1fafe6604b35342a2aadc9f10ad14cbaaad9844689a5386c860c31212be3452601eb71de1c',
                                    deadline: '2024-04-25T13:27:48.000Z',
                                    auctionStartDate: '2024-04-25T13:24:36.000Z',
                                    auctionEndDate: '2024-04-25T13:27:36.000Z',
                                    remainingMakerAmount: '33058558528525703',
                                    order: {
                                        salt: '102412815596156525137376967412477025111761562902072504909418068904100646989168',
                                        maker: '0xe2668d9bef0a686c9874882f7037758b5b520e5c',
                                        receiver: '0x0000000000000000000000000000000000000000',
                                        makerAsset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
                                        takerAsset: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
                                        makerTraits: '62419173104490761595518734107493289545375808488163256166876037723686174720000',
                                        makingAmount: '33058558528525703',
                                        takingAmount: '147681'
                                    },
                                    extension: '0x000000830000005e0000005e0000005e0000005e0000002f0000000000000000fb2809a5314473e1165f6b58018e20ed8f07b8400c956a00003e1b662a59940000b40ecaaa002b1d00540e41ea003cfb2809a5314473e1165f6b58018e20ed8f07b8400c956a00003e1b662a59940000b40ecaaa002b1d00540e41ea003cfb2809a5314473e1165f6b58018e20ed8f07b840662a597cd1a23c3abeed63c51b86000008'
                                },
                                {
                                    quoteId: '8343588a-da1e-407f-b41f-aa86f0ec4266',
                                    orderHash: '0x153386fa8e0b27b09d1250455521531e392e342571de31ac50836a3b6b9001d8',
                                    signature: '0x9ef06d325568887caace5f82bba23c821224df23886675fdd63259ee1594269e2768f58fe90a0ae6009184f2f422eb61e9cbd4f6d3c674befd0e55302995d4301c',
                                    deadline: '2023-01-31T11:01:06.000Z',
                                    auctionStartDate: '2023-01-31T10:58:11.000Z',
                                    auctionEndDate: '2023-01-31T11:01:11.000Z',
                                    remainingMakerAmount: '470444951856649710700841',
                                    order: {
                                        salt: '102412815605188492728297784997818915205705878873010401762040598952855113412064',
                                        maker: '0xdc8152a435d76fc89ced8255e28f690962c27e52',
                                        receiver: '0x0000000000000000000000000000000000000000',
                                        makerAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                                        takerAsset: '0xdac17f958d2ee523a2206206994597c13d831ec7',
                                        makerTraits: '62419173104490761595518734107503940736863610329190665072877236599067968012288',
                                        makingAmount: '30000000',
                                        takingAmount: '20653338'
                                    },
                                    extension: '0x00000079000000540000005400000054000000540000002a0000000000000000fb2809a5314473e1165f6b58018e20ed8f07b840423b06000034016627b1dc0000b444e602447208003cfb2809a5314473e1165f6b58018e20ed8f07b840423b06000034016627b1dc0000b444e602447208003cfb2809a5314473e1165f6b58018e20ed8f07b8406627b1c4d1a23c3abeed63c51b86000008'
                                }
                            ],
                            meta: {
                                totalItems: 11,
                                currentPage: 1,
                                itemsPerPage: 2,
                                totalPages: 6
                            }
                        };
                        url = 'https://test.com';
                        httpProvider = createHttpProviderFake(expected);
                        sdk = new _index1.FusionSDK({
                            url: url,
                            network: _constants.NetworkEnum.ETHEREUM,
                            httpProvider: httpProvider,
                            blockchainProvider: web3ProviderConnector
                        });
                        return [
                            4,
                            sdk.getActiveOrders()
                        ];
                    case 1:
                        response = _state.sent();
                        expect(response).toEqual(expected);
                        expect(httpProvider.get).toHaveBeenLastCalledWith("".concat(url, "/orders/v2.0/1/order/active/?version=2.1"));
                        return [
                            2
                        ];
                }
            });
        }));
    });
    describe('getOrderStatus', function() {
        it('success', /*#__PURE__*/ _async_to_generator(function() {
            var url, expected, httpProvider, sdk, orderHash, response;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        url = 'https://test.com';
                        expected = {
                            order: {
                                salt: '102412815611787935992271873344279698181002251432500613888978521074851540062603',
                                maker: '0xdc8152a435d76fc89ced8255e28f690962c27e52',
                                receiver: '0x0000000000000000000000000000000000000000',
                                makerAsset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
                                takerAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                                makerTraits: '33471150795161712739625987854073848363835857014350031386507831725384548745216',
                                makingAmount: '40000000000000000',
                                takingAmount: '119048031'
                            },
                            cancelTx: null,
                            points: null,
                            auctionStartDate: 1713866825,
                            auctionDuration: 360,
                            initialRateBump: 654927,
                            status: _types.OrderStatus.Filled,
                            extension: '0x0000006f0000004a0000004a0000004a0000004a000000250000000000000000fb2809a5314473e1165f6b58018e20ed8f07b840000000000000006627884900016809fe4ffb2809a5314473e1165f6b58018e20ed8f07b840000000000000006627884900016809fe4ffb2809a5314473e1165f6b58018e20ed8f07b8406627883dd1a23c3abeed63c51b86000008',
                            createdAt: '2024-04-23T10:06:58.807Z',
                            fromTokenToUsdPrice: '3164.81348508000019137398',
                            toTokenToUsdPrice: '0.99699437304091353962',
                            fills: [
                                {
                                    txHash: '0x346d2098059da884c61dfb95c357f11abbf51466c7903fe9c0d5a3d8471b8549',
                                    filledMakerAmount: '40000000000000000',
                                    filledAuctionTakerAmount: '120997216',
                                    takerFeeAmount: null
                                }
                            ],
                            isNativeCurrency: false
                        };
                        httpProvider = createHttpProviderFake(expected);
                        sdk = new _index1.FusionSDK({
                            url: url,
                            network: _constants.NetworkEnum.ETHEREUM,
                            httpProvider: httpProvider,
                            blockchainProvider: web3ProviderConnector
                        });
                        orderHash = "0x1beee023ab933cf5446c298eadadb61c05705f2156ef5b2db36c160b36f31ce4";
                        return [
                            4,
                            sdk.getOrderStatus(orderHash)
                        ];
                    case 1:
                        response = _state.sent();
                        expect(response).toEqual(expected);
                        expect(httpProvider.get).toHaveBeenLastCalledWith("".concat(url, "/orders/v2.0/1/order/status/").concat(orderHash));
                        return [
                            2
                        ];
                }
            });
        }));
        it('throws an error when the string is not hexadecimal', /*#__PURE__*/ _async_to_generator(function() {
            var url, expected, httpProvider, sdk, orderHash, promise;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        url = 'https://test.com';
                        expected = {
                            order: {
                                salt: '102412815611787935992271873344279698181002251432500613888978521074851540062603',
                                maker: '0xdc8152a435d76fc89ced8255e28f690962c27e52',
                                receiver: '0x0000000000000000000000000000000000000000',
                                makerAsset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
                                takerAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                                makerTraits: '33471150795161712739625987854073848363835857014350031386507831725384548745216',
                                makingAmount: '40000000000000000',
                                takingAmount: '119048031'
                            },
                            cancelTx: null,
                            points: null,
                            auctionStartDate: 1713866825,
                            auctionDuration: 360,
                            initialRateBump: 654927,
                            status: _types.OrderStatus.Filled,
                            extension: '0x0000006f0000004a0000004a0000004a0000004a000000250000000000000000fb2809a5314473e1165f6b58018e20ed8f07b840000000000000006627884900016809fe4ffb2809a5314473e1165f6b58018e20ed8f07b840000000000000006627884900016809fe4ffb2809a5314473e1165f6b58018e20ed8f07b8406627883dd1a23c3abeed63c51b86000008',
                            createdAt: '2024-04-23T10:06:58.807Z',
                            fromTokenToUsdPrice: '3164.81348508000019137398',
                            toTokenToUsdPrice: '0.99699437304091353962',
                            fills: [
                                {
                                    txHash: '0x346d2098059da884c61dfb95c357f11abbf51466c7903fe9c0d5a3d8471b8549',
                                    filledMakerAmount: '40000000000000000',
                                    filledAuctionTakerAmount: '120997216',
                                    takerFeeAmount: null
                                }
                            ],
                            isNativeCurrency: false
                        };
                        httpProvider = createHttpProviderFake(expected);
                        sdk = new _index1.FusionSDK({
                            url: url,
                            network: _constants.NetworkEnum.ETHEREUM,
                            httpProvider: httpProvider,
                            blockchainProvider: web3ProviderConnector
                        });
                        orderHash = "0x1beee023ab933cf5446c298eaddb61c0-5705f2156ef5b2db36c160b36f31ce4";
                        promise = sdk.getOrderStatus(orderHash);
                        return [
                            4,
                            expect(promise).rejects.toThrow(/orderHash have to be hex/)
                        ];
                    case 1:
                        _state.sent();
                        return [
                            2
                        ];
                }
            });
        }));
        it('throws an error when the string length is not equals 66', /*#__PURE__*/ _async_to_generator(function() {
            var url, expected, httpProvider, sdk, orderHash, promise;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        url = 'https://test.com';
                        expected = {
                            order: {
                                salt: '102412815611787935992271873344279698181002251432500613888978521074851540062603',
                                maker: '0xdc8152a435d76fc89ced8255e28f690962c27e52',
                                receiver: '0x0000000000000000000000000000000000000000',
                                makerAsset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
                                takerAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                                makerTraits: '33471150795161712739625987854073848363835857014350031386507831725384548745216',
                                makingAmount: '40000000000000000',
                                takingAmount: '119048031'
                            },
                            cancelTx: null,
                            points: null,
                            auctionStartDate: 1713866825,
                            auctionDuration: 360,
                            initialRateBump: 654927,
                            status: _types.OrderStatus.Filled,
                            extension: '0x0000006f0000004a0000004a0000004a0000004a000000250000000000000000fb2809a5314473e1165f6b58018e20ed8f07b840000000000000006627884900016809fe4ffb2809a5314473e1165f6b58018e20ed8f07b840000000000000006627884900016809fe4ffb2809a5314473e1165f6b58018e20ed8f07b8406627883dd1a23c3abeed63c51b86000008',
                            createdAt: '2024-04-23T10:06:58.807Z',
                            fromTokenToUsdPrice: '3164.81348508000019137398',
                            toTokenToUsdPrice: '0.99699437304091353962',
                            fills: [
                                {
                                    txHash: '0x346d2098059da884c61dfb95c357f11abbf51466c7903fe9c0d5a3d8471b8549',
                                    filledMakerAmount: '40000000000000000',
                                    filledAuctionTakerAmount: '120997216',
                                    takerFeeAmount: null
                                }
                            ],
                            isNativeCurrency: false
                        };
                        httpProvider = createHttpProviderFake(expected);
                        sdk = new _index1.FusionSDK({
                            url: url,
                            network: _constants.NetworkEnum.ETHEREUM,
                            httpProvider: httpProvider,
                            blockchainProvider: web3ProviderConnector
                        });
                        orderHash = "0x1beee023ab933cf5446c298eadasdasdb61c0x5705f2156ef5b2db36c160b36f31ce4";
                        promise = sdk.getOrderStatus(orderHash);
                        return [
                            4,
                            expect(promise).rejects.toThrow(/orderHash length should be equals 66/)
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
    describe('getOrdersByMaker', function() {
        it('success', /*#__PURE__*/ _async_to_generator(function() {
            var url, expected, httpProvider, sdk, address, response;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        url = 'https://test.com';
                        expected = {
                            meta: {
                                totalItems: 2,
                                currentPage: 1,
                                itemsPerPage: 100,
                                totalPages: 1
                            },
                            items: [
                                {
                                    orderHash: '0x32b666e75a34bd97844017747a3222b0422b5bbce15f1c06913678fcbff84571',
                                    makerAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                                    takerAsset: '0xdac17f958d2ee523a2206206994597c13d831ec7',
                                    makerAmount: '30000000',
                                    minTakerAmount: '23374478',
                                    createdAt: '2024-04-23T11:36:45.980Z',
                                    fills: [],
                                    status: _types.OrderStatus.Pending,
                                    cancelTx: null,
                                    isNativeCurrency: false,
                                    auctionStartDate: 1713872226,
                                    auctionDuration: 180,
                                    initialRateBump: 2824245,
                                    points: [
                                        {
                                            coefficient: 2805816,
                                            delay: 60
                                        }
                                    ]
                                },
                                {
                                    orderHash: '0x726c96911b867c84880fcacbd4e26205ecee58be72b31e2969987880b53f35f2',
                                    makerAsset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
                                    takerAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                                    makerAmount: '40000000000000000',
                                    minTakerAmount: '119048031',
                                    createdAt: '2024-04-23T10:06:58.807Z',
                                    fills: [
                                        {
                                            txHash: '0x346d2098059da884c61dfb95c357f11abbf51466c7903fe9c0d5a3d8471b8549',
                                            filledMakerAmount: '40000000000000000',
                                            filledAuctionTakerAmount: '120997216',
                                            takerFeeAmount: null
                                        }
                                    ],
                                    status: _types.OrderStatus.Filled,
                                    cancelTx: null,
                                    isNativeCurrency: false,
                                    auctionStartDate: 1713866825,
                                    auctionDuration: 360,
                                    initialRateBump: 654927,
                                    points: null
                                }
                            ]
                        };
                        httpProvider = createHttpProviderFake(expected);
                        sdk = new _index1.FusionSDK({
                            url: url,
                            network: _constants.NetworkEnum.ETHEREUM,
                            httpProvider: httpProvider,
                            blockchainProvider: web3ProviderConnector
                        });
                        address = '0xfa80cd9b3becc0b4403b0f421384724f2810775f';
                        return [
                            4,
                            sdk.getOrdersByMaker({
                                address: address,
                                limit: 1,
                                page: 1
                            })
                        ];
                    case 1:
                        response = _state.sent();
                        expect(response).toEqual(expected);
                        expect(httpProvider.get).toHaveBeenLastCalledWith("".concat(url, "/orders/v2.0/1/order/maker/").concat(address, "/?limit=1&page=1&version=2.1"));
                        return [
                            2
                        ];
                }
            });
        }));
        it('handles the case when no pagination params was passed', /*#__PURE__*/ _async_to_generator(function() {
            var url, expected, httpProvider, sdk, address, response;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        url = 'https://test.com';
                        expected = {
                            meta: {
                                totalItems: 2,
                                currentPage: 1,
                                itemsPerPage: 100,
                                totalPages: 1
                            },
                            items: [
                                {
                                    orderHash: '0x32b666e75a34bd97844017747a3222b0422b5bbce15f1c06913678fcbff84571',
                                    makerAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                                    takerAsset: '0xdac17f958d2ee523a2206206994597c13d831ec7',
                                    makerAmount: '30000000',
                                    minTakerAmount: '23374478',
                                    createdAt: '2024-04-23T11:36:45.980Z',
                                    fills: [],
                                    status: _types.OrderStatus.Pending,
                                    cancelTx: null,
                                    isNativeCurrency: false,
                                    auctionStartDate: 1713872226,
                                    auctionDuration: 180,
                                    initialRateBump: 2824245,
                                    points: [
                                        {
                                            coefficient: 2805816,
                                            delay: 60
                                        }
                                    ]
                                },
                                {
                                    orderHash: '0x726c96911b867c84880fcacbd4e26205ecee58be72b31e2969987880b53f35f2',
                                    makerAsset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
                                    takerAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                                    makerAmount: '40000000000000000',
                                    minTakerAmount: '119048031',
                                    createdAt: '2024-04-23T10:06:58.807Z',
                                    fills: [
                                        {
                                            txHash: '0x346d2098059da884c61dfb95c357f11abbf51466c7903fe9c0d5a3d8471b8549',
                                            filledMakerAmount: '40000000000000000',
                                            filledAuctionTakerAmount: '120997216',
                                            takerFeeAmount: null
                                        }
                                    ],
                                    status: _types.OrderStatus.Filled,
                                    cancelTx: null,
                                    isNativeCurrency: false,
                                    auctionStartDate: 1713866825,
                                    auctionDuration: 360,
                                    initialRateBump: 654927,
                                    points: null
                                }
                            ]
                        };
                        httpProvider = createHttpProviderFake(expected);
                        sdk = new _index1.FusionSDK({
                            url: url,
                            network: _constants.NetworkEnum.ETHEREUM,
                            httpProvider: httpProvider,
                            blockchainProvider: web3ProviderConnector
                        });
                        address = '0xfa80cd9b3becc0b4403b0f421384724f2810775f';
                        return [
                            4,
                            sdk.getOrdersByMaker({
                                address: address
                            })
                        ];
                    case 1:
                        response = _state.sent();
                        expect(response).toEqual(expected);
                        expect(httpProvider.get).toHaveBeenLastCalledWith("".concat(url, "/orders/v2.0/1/order/maker/").concat(address, "/?version=2.1"));
                        return [
                            2
                        ];
                }
            });
        }));
        it('throws an error with invalid address', /*#__PURE__*/ _async_to_generator(function() {
            var url, expected, httpProvider, sdk, address, promise;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        url = 'https://test.com';
                        expected = {
                            meta: {
                                totalItems: 2,
                                currentPage: 1,
                                itemsPerPage: 100,
                                totalPages: 1
                            },
                            items: [
                                {
                                    orderHash: '0x32b666e75a34bd97844017747a3222b0422b5bbce15f1c06913678fcbff84571',
                                    makerAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                                    takerAsset: '0xdac17f958d2ee523a2206206994597c13d831ec7',
                                    makerAmount: '30000000',
                                    minTakerAmount: '23374478',
                                    createdAt: '2024-04-23T11:36:45.980Z',
                                    fills: [],
                                    status: _types.OrderStatus.Pending,
                                    cancelTx: null,
                                    isNativeCurrency: false,
                                    auctionStartDate: 1713872226,
                                    auctionDuration: 180,
                                    initialRateBump: 2824245,
                                    points: [
                                        {
                                            coefficient: 2805816,
                                            delay: 60
                                        }
                                    ]
                                },
                                {
                                    orderHash: '0x726c96911b867c84880fcacbd4e26205ecee58be72b31e2969987880b53f35f2',
                                    makerAsset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
                                    takerAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                                    makerAmount: '40000000000000000',
                                    minTakerAmount: '119048031',
                                    createdAt: '2024-04-23T10:06:58.807Z',
                                    fills: [
                                        {
                                            txHash: '0x346d2098059da884c61dfb95c357f11abbf51466c7903fe9c0d5a3d8471b8549',
                                            filledMakerAmount: '40000000000000000',
                                            filledAuctionTakerAmount: '120997216',
                                            takerFeeAmount: null
                                        }
                                    ],
                                    status: _types.OrderStatus.Filled,
                                    cancelTx: null,
                                    isNativeCurrency: false,
                                    auctionStartDate: 1713866825,
                                    auctionDuration: 360,
                                    initialRateBump: 654927,
                                    points: null
                                }
                            ]
                        };
                        httpProvider = createHttpProviderFake(expected);
                        sdk = new _index1.FusionSDK({
                            url: url,
                            network: _constants.NetworkEnum.ETHEREUM,
                            httpProvider: httpProvider,
                            blockchainProvider: web3ProviderConnector
                        });
                        address = '0xfa80cd9b3becc0b4403b0f42138472ewewewewewewew2810775f';
                        promise = sdk.getOrdersByMaker({
                            address: address,
                            limit: 1,
                            page: 1
                        });
                        return [
                            4,
                            expect(promise).rejects.toThrow(/is invalid address/)
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
});
