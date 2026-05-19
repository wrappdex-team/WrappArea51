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
export var PaginationRequest = /*#__PURE__*/ function() {
    "use strict";
    function PaginationRequest(page, limit) {
        _class_call_check(this, PaginationRequest);
        _define_property(this, "page", void 0);
        _define_property(this, "limit", void 0);
        this.page = page;
        this.limit = limit;
    }
    _create_class(PaginationRequest, [
        {
            key: "validate",
            value: function validate() {
                if (this.limit != null && (this.limit < 1 || this.limit > 500)) {
                    return 'limit should be in range between 1 and 500';
                }
                if (this.page != null && this.page < 1) {
                    return "page should be >= 1";
                }
                return null;
            }
        }
    ]);
    return PaginationRequest;
}();
