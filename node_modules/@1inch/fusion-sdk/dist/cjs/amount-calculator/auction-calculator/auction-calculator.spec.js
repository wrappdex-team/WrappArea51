"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
var _ethers = require("ethers");
var _auctioncalculator = require("./auction-calculator.js");
var _index = require("../../fusion-order/index.js");
describe('Auction Calculator', function() {
    it('should be created successfully from suffix and salt', function() {
        var auctionStartTime = 1708448252n;
        var auctionDetails = new _index.AuctionDetails({
            startTime: auctionStartTime,
            initialRateBump: 50000,
            duration: 120n,
            points: []
        });
        var calculator = _auctioncalculator.AuctionCalculator.fromAuctionData(auctionDetails);
        var rate = calculator.calcRateBump(auctionStartTime + 60n);
        var auctionTakingAmount = calculator.calcAuctionTakingAmount(1420000000n, rate);
        expect(rate).toBe(25000);
        expect(auctionTakingAmount).toBe(1423550000n);
    });
    // 1423550000 from rate
    describe('Gas bump', function() {
        var now = BigInt(Math.floor(Date.now() / 1000));
        var duration = 1800n;
        // 30m
        var takingAmount = (0, _ethers.parseEther)('1');
        var calculator = new _auctioncalculator.AuctionCalculator(now - 60n, duration, 1000000n, [
            {
                delay: 60,
                coefficient: 500000
            }
        ], {
            gasBumpEstimate: 10000n,
            // 0.1% of taking amount
            gasPriceEstimate: 1000n
        });
        // 1gwei
        it('0 gwei = no gas fee', function() {
            var bump = calculator.calcRateBump(now);
            expect(calculator.calcAuctionTakingAmount(takingAmount, bump)).toBe((0, _ethers.parseEther)('1.05'));
        });
        it('0.1 gwei = 0.01% gas fee', function() {
            var bump = calculator.calcRateBump(now, (0, _ethers.parseUnits)('1', 8));
            expect(calculator.calcAuctionTakingAmount(takingAmount, bump)).toBe((0, _ethers.parseEther)('1.0499'));
        });
        it('15 gwei = 1.5% gas fee', function() {
            var bump = calculator.calcRateBump(now, (0, _ethers.parseUnits)('15', 9));
            expect(calculator.calcAuctionTakingAmount(takingAmount, bump)).toBe((0, _ethers.parseEther)('1.035'));
        });
        it('100 gwei = 10% gas fee, should be capped with takingAmount', function() {
            var bump = calculator.calcRateBump(now, (0, _ethers.parseUnits)('100', 9));
            expect(calculator.calcAuctionTakingAmount(takingAmount, bump)).toBe((0, _ethers.parseEther)('1'));
        });
    });
});
