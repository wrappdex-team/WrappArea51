"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "now", {
    enumerable: true,
    get: function() {
        return now;
    }
});
function now() {
    return BigInt(Math.floor(Date.now() / 1000));
}
