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
import { ethers } from 'ethers';
import { BytesBuilder, BytesIter } from '@1inch/byte-utils';
import assert from 'assert';
import { isHexBytes } from '../../validations.js';
import { add0x, trim0x } from '../../utils.js';
import { UINT_24_MAX, UINT_32_MAX } from '../../constants.js';
export var AuctionDetails = /*#__PURE__*/ function() {
    "use strict";
    function AuctionDetails(/**
         * Rate bump to cover gas price. 10_000_000 means 100%
         */ /**
         * Gas price at estimation time. 1000 means 1 Gwei
         */ auction) {
        _class_call_check(this, AuctionDetails);
        _define_property(this, "startTime", void 0);
        _define_property(this, "duration", void 0);
        _define_property(this, "initialRateBump", void 0);
        _define_property(this, "points", void 0);
        _define_property(this, "gasCost", void 0);
        /**
         * It defined as a ratio of startTakingAmount to endTakingAmount. 10_000_000 means 100%
         *
         * @see `AuctionCalculator.calcInitialRateBump`
         */ /**
         * Allows to scale estimate gas costs to actual gas costs
         */ this.startTime = BigInt(auction.startTime);
        this.initialRateBump = BigInt(auction.initialRateBump);
        this.duration = auction.duration;
        this.points = auction.points;
        this.gasCost = auction.gasCost || {
            gasBumpEstimate: 0n,
            gasPriceEstimate: 0n
        };
        assert(this.gasCost.gasBumpEstimate <= UINT_24_MAX);
        assert(this.gasCost.gasPriceEstimate <= UINT_32_MAX);
        assert(this.startTime <= UINT_32_MAX);
        assert(this.duration <= UINT_24_MAX);
        assert(this.initialRateBump <= UINT_24_MAX);
    }
    _create_class(AuctionDetails, [
        {
            key: "encode",
            value: /**
     * Serialize auction data to bytes
     */ function encode() {
                var details = ethers.solidityPacked([
                    'uint24',
                    'uint32',
                    'uint32',
                    'uint24',
                    'uint24',
                    'uint8'
                ], [
                    this.gasCost.gasBumpEstimate,
                    this.gasCost.gasPriceEstimate,
                    this.startTime,
                    this.duration,
                    this.initialRateBump,
                    this.points.length
                ]);
                for(var i = 0; i < this.points.length; i++){
                    details += trim0x(ethers.solidityPacked([
                        'uint24',
                        'uint16'
                    ], [
                        this.points[i].coefficient,
                        this.points[i].delay
                    ]));
                }
                return details;
            }
        },
        {
            key: "encodeInto",
            value: /**
     * Serialize auction data into
     */ function encodeInto() {
                var builder = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : new BytesBuilder();
                return builder.addBytes(this.encode());
            }
        }
    ], [
        {
            key: "decodeFrom",
            value: /**
     * Construct `AuctionDetails`
     *
     * @param iter :
     * - uint24 gasBumpEstimate
     * - uint32 gasPriceEstimate
     * - uint32 startTime
     * - uint24 duration
     * - uint24 initialRateBump
     * - uint8  N = count of points
     * - [uint24 rate, uint16 delay] * N points
     *
     * All data is tight packed
     *
     * @see AuctionDetails.encode
     */ function decodeFrom(iter) {
                var gasBumpEstimate = iter.nextUint24();
                var gasPriceEstimate = iter.nextUint32();
                var start = iter.nextUint32();
                var duration = iter.nextUint24();
                var rateBump = Number(iter.nextUint24());
                var points = [];
                var pointsLen = BigInt(iter.nextUint8());
                while(pointsLen--){
                    points.push({
                        coefficient: Number(iter.nextUint24()),
                        delay: Number(iter.nextUint16())
                    });
                }
                return new AuctionDetails({
                    startTime: BigInt(start),
                    duration: BigInt(duration),
                    initialRateBump: rateBump,
                    points: points,
                    gasCost: {
                        gasBumpEstimate: BigInt(gasBumpEstimate),
                        gasPriceEstimate: BigInt(gasPriceEstimate)
                    }
                });
            }
        },
        {
            key: "decode",
            value: /**
     * Construct `AuctionDetails` from bytes
     *
     * @see AuctionDetails.decodeFrom
     * @see AuctionDetails.encode
     */ function decode(data) {
                assert(isHexBytes(data), 'Invalid auction details data');
                var iter = BytesIter.BigInt(data);
                return AuctionDetails.decodeFrom(iter);
            }
        },
        {
            key: "fromExtension",
            value: function fromExtension(extension) {
                return AuctionDetails.decode(add0x(extension.makingAmountData.slice(42)));
            }
        }
    ]);
    return AuctionDetails;
}();
