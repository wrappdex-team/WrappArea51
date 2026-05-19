"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "RelayerRequest", {
    enumerable: true,
    get: function() {
        return RelayerRequest;
    }
});
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
var RelayerRequest = /*#__PURE__*/ function() {
    "use strict";
    function RelayerRequest(params) {
        _class_call_check(this, RelayerRequest);
        _define_property(this, "order", void 0);
        _define_property(this, "signature", void 0);
        _define_property(this, "quoteId", void 0);
        _define_property(this, "extension", void 0);
        this.order = params.order;
        this.signature = params.signature;
        this.quoteId = params.quoteId;
        this.extension = params.extension;
    }
    _create_class(RelayerRequest, [
        {
            key: "build",
            value: function build() {
                return {
                    order: this.order,
                    signature: this.signature,
                    quoteId: this.quoteId,
                    extension: this.extension
                };
            }
        }
    ], [
        {
            key: "new",
            value: function _new(params) {
                return new RelayerRequest(params);
            }
        }
    ]);
    return RelayerRequest;
}();
