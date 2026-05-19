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
import { AxiosProviderConnector } from '../../connector/index.js';
export var RelayerApi = /*#__PURE__*/ function() {
    "use strict";
    function RelayerApi(config, httpClient) {
        _class_call_check(this, RelayerApi);
        _define_property(this, "config", void 0);
        _define_property(this, "httpClient", void 0);
        this.config = config;
        this.httpClient = httpClient;
    }
    _create_class(RelayerApi, [
        {
            key: "submit",
            value: function submit(params) {
                var url = "".concat(this.config.url, "/").concat(RelayerApi.Version, "/").concat(this.config.network, "/order/submit");
                return this.httpClient.post(url, params);
            }
        },
        {
            key: "submitBatch",
            value: function submitBatch(params) {
                var url = "".concat(this.config.url, "/").concat(RelayerApi.Version, "/").concat(this.config.network, "/order/submit/many");
                return this.httpClient.post(url, params);
            }
        }
    ], [
        {
            key: "new",
            value: function _new(config) {
                var httpClient = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : new AxiosProviderConnector(config.authKey);
                return new RelayerApi(config, httpClient);
            }
        }
    ]);
    return RelayerApi;
}();
_define_property(RelayerApi, "Version", 'v2.0');
