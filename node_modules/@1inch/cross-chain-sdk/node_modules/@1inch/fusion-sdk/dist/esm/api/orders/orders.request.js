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
import { isHexString, isValidAddress } from '../../validations.js';
import { PaginationRequest } from '../pagination.js';
export var ActiveOrdersRequest = /*#__PURE__*/ function() {
    "use strict";
    function ActiveOrdersRequest() {
        var params = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
        _class_call_check(this, ActiveOrdersRequest);
        _define_property(this, "pagination", void 0);
        this.pagination = new PaginationRequest(params.page, params.limit);
    }
    _create_class(ActiveOrdersRequest, [
        {
            key: "validate",
            value: function validate() {
                var res = this.pagination.validate();
                if (res) {
                    return res;
                }
                return null;
            }
        },
        {
            key: "build",
            value: function build() {
                return {
                    page: this.pagination.page,
                    limit: this.pagination.limit
                };
            }
        }
    ], [
        {
            key: "new",
            value: function _new(params) {
                return new ActiveOrdersRequest(params);
            }
        }
    ]);
    return ActiveOrdersRequest;
}();
export var OrderStatusRequest = /*#__PURE__*/ function() {
    "use strict";
    function OrderStatusRequest(params) {
        _class_call_check(this, OrderStatusRequest);
        _define_property(this, "orderHash", void 0);
        this.orderHash = params.orderHash;
    }
    _create_class(OrderStatusRequest, [
        {
            key: "validate",
            value: function validate() {
                if (this.orderHash.length !== 66) {
                    return "orderHash length should be equals 66";
                }
                if (!isHexString(this.orderHash)) {
                    return "orderHash have to be hex";
                }
                return null;
            }
        },
        {
            key: "build",
            value: function build() {
                return {
                    orderHash: this.orderHash
                };
            }
        }
    ], [
        {
            key: "new",
            value: function _new(params) {
                return new OrderStatusRequest(params);
            }
        }
    ]);
    return OrderStatusRequest;
}();
export var OrdersByMakerRequest = /*#__PURE__*/ function() {
    "use strict";
    function OrdersByMakerRequest(params) {
        _class_call_check(this, OrdersByMakerRequest);
        _define_property(this, "address", void 0);
        _define_property(this, "pagination", void 0);
        this.address = params.address;
        this.pagination = new PaginationRequest(params.page, params.limit);
    }
    _create_class(OrdersByMakerRequest, [
        {
            key: "validate",
            value: function validate() {
                var res = this.pagination.validate();
                if (res) {
                    return res;
                }
                if (!isValidAddress(this.address)) {
                    return "".concat(this.address, " is invalid address");
                }
                return null;
            }
        },
        {
            key: "buildQueryParams",
            value: function buildQueryParams() {
                return {
                    limit: this.pagination.limit,
                    page: this.pagination.page
                };
            }
        }
    ], [
        {
            key: "new",
            value: function _new(params) {
                return new OrdersByMakerRequest(params);
            }
        }
    ]);
    return OrdersByMakerRequest;
}();
