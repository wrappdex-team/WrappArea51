"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
var _limitordersdk = require("@1inch/limit-order-sdk");
var _fusionorder = require("./fusion-order.js");
var _index = require("./auction-details/index.js");
var _fusionextension = require("./fusion-extension.js");
var _index1 = require("./whitelist/index.js");
var _surplusparams = require("./surplus-params.js");
describe('FusionExtension', function() {
    it('should decode', function() {
        var extensionContract = new _limitordersdk.Address('0x8273f37417da37c4a6c3995e82cf442f87a25d9c');
        var order = _fusionorder.FusionOrder.new(extensionContract, {
            makerAsset: new _limitordersdk.Address('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'),
            takerAsset: new _limitordersdk.Address('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'),
            makingAmount: 1000000000000000000n,
            takingAmount: 1420000000n,
            maker: new _limitordersdk.Address('0x00000000219ab540356cbb839cbe05303d7705fa'),
            salt: 10n
        }, {
            auction: new _index.AuctionDetails({
                duration: 180n,
                startTime: 1673548149n,
                initialRateBump: 50000,
                points: [
                    {
                        coefficient: 20000,
                        delay: 12
                    }
                ]
            }),
            whitelist: _index1.Whitelist.new(1673548139n, [
                {
                    address: new _limitordersdk.Address('0x00000000219ab540356cbb839cbe05303d7705fa'),
                    allowFrom: 0n
                }
            ]),
            surplus: _surplusparams.SurplusParams.NO_FEE
        });
        var fusionExtension = _fusionextension.FusionExtension.decode(order.extension.encode());
        expect(fusionExtension).toStrictEqual(order.fusionExtension);
    });
    it('should decode with permit', function() {
        var extensionContract = new _limitordersdk.Address('0x8273f37417da37c4a6c3995e82cf442f87a25d9c');
        var order = _fusionorder.FusionOrder.new(extensionContract, {
            makerAsset: new _limitordersdk.Address('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'),
            takerAsset: new _limitordersdk.Address('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'),
            makingAmount: 1000000000000000000n,
            takingAmount: 1420000000n,
            maker: new _limitordersdk.Address('0x00000000219ab540356cbb839cbe05303d7705fa'),
            salt: 10n
        }, {
            auction: new _index.AuctionDetails({
                duration: 180n,
                startTime: 1673548149n,
                initialRateBump: 50000,
                points: [
                    {
                        coefficient: 20000,
                        delay: 12
                    }
                ]
            }),
            whitelist: _index1.Whitelist.new(1673548139n, [
                {
                    address: new _limitordersdk.Address('0x00000000219ab540356cbb839cbe05303d7705fa'),
                    allowFrom: 0n
                }
            ]),
            surplus: _surplusparams.SurplusParams.NO_FEE
        }, {
            permit: '0xdeadbeef'
        });
        var fusionExtension = _fusionextension.FusionExtension.decode(order.extension.encode());
        expect(fusionExtension).toStrictEqual(order.fusionExtension);
    });
});
