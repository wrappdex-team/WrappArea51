"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RpcWebsocketApi = void 0;
const types_js_1 = require("./types.js");
const pagination_js_1 = require("../api/pagination.js");
class RpcWebsocketApi {
    provider;
    constructor(provider) {
        this.provider = provider;
    }
    onPong(cb) {
        this.provider.onMessage((data) => {
            if (data.method === types_js_1.RpcMethod.Ping) {
                cb(data.result);
            }
        });
    }
    ping() {
        this.provider.send({ method: types_js_1.RpcMethod.Ping });
    }
    getActiveOrders({ limit, page } = {}) {
        const paginationRequest = new pagination_js_1.PaginationRequest(page, limit);
        this.provider.send({
            method: types_js_1.RpcMethod.GetActiveOrders,
            param: paginationRequest
        });
    }
    onGetActiveOrders(cb) {
        this.provider.onMessage((data) => {
            if (data.method === types_js_1.RpcMethod.GetActiveOrders) {
                cb(data.result);
            }
        });
    }
    getSecrets({ limit, page } = {}) {
        const paginationRequest = new pagination_js_1.PaginationRequest(page, limit);
        this.provider.send({
            method: types_js_1.RpcMethod.GetSecrets,
            param: paginationRequest
        });
    }
    onGetSecrets(cb) {
        this.provider.onMessage((data) => {
            if (data.method === types_js_1.RpcMethod.GetSecrets) {
                cb(data.result);
            }
        });
    }
    getAllowedMethods() {
        this.provider.send({ method: types_js_1.RpcMethod.GetAllowedMethods });
    }
    onGetAllowedMethods(cb) {
        this.provider.onMessage((data) => {
            if (data.method === types_js_1.RpcMethod.GetAllowedMethods) {
                cb(data.result);
            }
        });
    }
}
exports.RpcWebsocketApi = RpcWebsocketApi;
//# sourceMappingURL=rpc-websocket-api.js.map