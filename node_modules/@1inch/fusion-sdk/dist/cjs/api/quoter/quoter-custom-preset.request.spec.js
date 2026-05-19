"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
var _quotercustompresetrequest = require("./quoter-custom-preset.request.js");
describe(__filename, function() {
    it('auctionStartAmount should be valid', function() {
        var body = _quotercustompresetrequest.QuoterCustomPresetRequest.new({
            customPreset: {
                auctionDuration: 180,
                auctionStartAmount: 'ama bad string',
                auctionEndAmount: '50000',
                points: [
                    {
                        toTokenAmount: '90000',
                        delay: 20
                    },
                    {
                        toTokenAmount: '110000',
                        delay: 40
                    }
                ]
            }
        });
        var err = body.validate();
        expect(err).toMatch(/Invalid auctionStartAmount/);
    });
    it('auctionEndAmount should be valid', function() {
        var body = _quotercustompresetrequest.QuoterCustomPresetRequest.new({
            customPreset: {
                auctionDuration: 180,
                auctionStartAmount: '100000',
                auctionEndAmount: 'ama bad string',
                points: [
                    {
                        toTokenAmount: '90000',
                        delay: 20
                    },
                    {
                        toTokenAmount: '110000',
                        delay: 40
                    }
                ]
            }
        });
        var err = body.validate();
        expect(err).toMatch(/Invalid auctionEndAmount/);
    });
    it('auctionDuration should be valid', function() {
        var body = _quotercustompresetrequest.QuoterCustomPresetRequest.new({
            customPreset: {
                auctionDuration: 0.1,
                auctionStartAmount: '100000',
                auctionEndAmount: '50000',
                points: [
                    {
                        toTokenAmount: '90000',
                        delay: 20
                    },
                    {
                        toTokenAmount: '110000',
                        delay: 40
                    }
                ]
            }
        });
        var err = body.validate();
        expect(err).toMatch(/auctionDuration should be integer/);
    });
    it('points should be in range', function() {
        var body1 = _quotercustompresetrequest.QuoterCustomPresetRequest.new({
            customPreset: {
                auctionDuration: 180,
                auctionStartAmount: '100000',
                auctionEndAmount: '50000',
                points: [
                    {
                        toTokenAmount: '90000',
                        delay: 20
                    },
                    {
                        toTokenAmount: '110000',
                        delay: 40
                    }
                ]
            }
        });
        var body2 = _quotercustompresetrequest.QuoterCustomPresetRequest.new({
            customPreset: {
                auctionDuration: 180,
                auctionStartAmount: '100000',
                auctionEndAmount: '50000',
                points: [
                    {
                        toTokenAmount: '40000',
                        delay: 20
                    },
                    {
                        toTokenAmount: '70000',
                        delay: 40
                    }
                ]
            }
        });
        var err1 = body1.validate();
        var err2 = body2.validate();
        expect(err1).toMatch(/points should be in range/);
        expect(err2).toMatch(/points should be in range/);
    });
    it('points should be an array of valid amounts', function() {
        var body = _quotercustompresetrequest.QuoterCustomPresetRequest.new({
            customPreset: {
                auctionDuration: 180,
                auctionStartAmount: '100000',
                auctionEndAmount: '50000',
                points: [
                    {
                        toTokenAmount: 'ama bad string',
                        delay: 20
                    },
                    {
                        toTokenAmount: '70000',
                        delay: 40
                    }
                ]
            }
        });
        var err = body.validate();
        expect(err).toMatch(/points should be an array of valid amounts/);
    });
});
