"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PrivateKeyProviderConnector", {
    enumerable: true,
    get: function() {
        return PrivateKeyProviderConnector;
    }
});
var _ethers = require("ethers");
var _utils = require("../../utils.js");
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
function _object_spread(target) {
    for(var i = 1; i < arguments.length; i++){
        var source = arguments[i] != null ? arguments[i] : {};
        var ownKeys = Object.keys(source);
        if (typeof Object.getOwnPropertySymbols === "function") {
            ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function(sym) {
                return Object.getOwnPropertyDescriptor(source, sym).enumerable;
            }));
        }
        ownKeys.forEach(function(key) {
            _define_property(target, key, source[key]);
        });
    }
    return target;
}
var PrivateKeyProviderConnector = /*#__PURE__*/ function() {
    "use strict";
    function PrivateKeyProviderConnector(privateKey, web3Provider) {
        _class_call_check(this, PrivateKeyProviderConnector);
        _define_property(this, "privateKey", void 0);
        _define_property(this, "web3Provider", void 0);
        _define_property(this, "wallet", void 0);
        this.privateKey = privateKey;
        this.web3Provider = web3Provider;
        this.wallet = new _ethers.Wallet((0, _utils.add0x)(privateKey));
    }
    _create_class(PrivateKeyProviderConnector, [
        {
            key: "signTypedData",
            value: function signTypedData(_walletAddress, typedData) {
                var primaryTypes = _object_spread({}, typedData.types);
                delete primaryTypes['EIP712Domain'];
                return this.wallet.signTypedData(typedData.domain, primaryTypes, typedData.message);
            }
        },
        {
            key: "ethCall",
            value: function ethCall(contractAddress, callData) {
                return this.web3Provider.eth.call({
                    to: contractAddress,
                    data: callData
                });
            }
        }
    ]);
    return PrivateKeyProviderConnector;
}();
