"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    isHexBytes: function() {
        return isHexBytes;
    },
    isHexString: function() {
        return isHexString;
    },
    isValidAddress: function() {
        return isValidAddress;
    },
    isValidAmount: function() {
        return isValidAmount;
    }
});
var _ethers = require("ethers");
function isValidAddress(address) {
    return (0, _ethers.isAddress)(address);
}
function isValidAmount(value) {
    try {
        var amount = BigInt(value);
        return amount >= 0n;
    } catch (e) {
        return false;
    }
}
var HEX_REGEX = /^(0x)[0-9a-f]+$/i;
function isHexString(val) {
    return HEX_REGEX.test(val.toLowerCase());
}
/**
 * Check that string is valid hex with 0x prefix and length is even
 * @param val
 */ function isHexBytes(val) {
    return isHexString(val) && val.length % 2 === 0;
}
