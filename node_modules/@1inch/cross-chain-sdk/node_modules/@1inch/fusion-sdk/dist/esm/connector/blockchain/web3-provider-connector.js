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
export var Web3ProviderConnector = /*#__PURE__*/ function() {
    "use strict";
    function Web3ProviderConnector(web3Provider) {
        _class_call_check(this, Web3ProviderConnector);
        _define_property(this, "web3Provider", void 0);
        this.web3Provider = web3Provider;
    }
    _create_class(Web3ProviderConnector, [
        {
            key: "signTypedData",
            value: function signTypedData(walletAddress, typedData) {
                var extendedWeb3 = this.web3Provider.extend({
                    methods: [
                        {
                            name: 'signTypedDataV4',
                            call: 'eth_signTypedData_v4',
                            params: 2
                        }
                    ]
                });
                return extendedWeb3.signTypedDataV4(walletAddress, JSON.stringify(typedData));
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
    return Web3ProviderConnector;
}();
