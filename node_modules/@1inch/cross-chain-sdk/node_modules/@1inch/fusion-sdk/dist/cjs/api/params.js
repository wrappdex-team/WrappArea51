"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "concatQueryParams", {
    enumerable: true,
    get: function() {
        return concatQueryParams;
    }
});
var _ordersVersion = require("./ordersVersion.js");
/**
 * Concat all params to query encoded string. if `addVersion` is true, then `version` param is added to this string
 */ function concatQueryParams(params) {
    var version = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : false;
    var versionRequired = version && version !== _ordersVersion.OrdersVersion.all;
    if (!params) {
        return versionRequired ? "?version=".concat(version) : '';
    }
    if (versionRequired) {
        Object.assign(params, {
            version: version
        });
    }
    var keys = Object.keys(params);
    if (!keys.length) {
        return '';
    }
    return '?' + keys.reduce(function(a, k) {
        if (!params[k]) {
            return a;
        }
        var value = params[k];
        a.push(k + '=' + encodeURIComponent(Array.isArray(value) ? value.join(',') : value));
        return a;
    }, []).join('&');
}
