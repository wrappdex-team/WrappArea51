"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
var _auctiondetails = require("./auction-details.js");
describe('Auction details', function() {
    it('Should encode/decode details', function() {
        var details = new _auctiondetails.AuctionDetails({
            duration: 180n,
            startTime: 1673548149n,
            initialRateBump: 50000,
            points: [
                {
                    delay: 10,
                    coefficient: 10000
                },
                {
                    delay: 20,
                    coefficient: 5000
                }
            ]
        });
        expect(_auctiondetails.AuctionDetails.decode(details.encode())).toStrictEqual(details);
    });
});
