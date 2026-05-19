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
    Fees: function() {
        return _fees.Fees;
    },
    IntegratorFee: function() {
        return _integratorfee.IntegratorFee;
    },
    ResolverFee: function() {
        return _resolverfee.ResolverFee;
    }
});
var _fees = require("./fees.js");
var _integratorfee = require("./integrator-fee.js");
var _resolverfee = require("./resolver-fee.js");
