import { OnGetActiveOrdersCb, OnGetAllowedMethodsCb, OnPongCb } from './types.js';
import { PaginationParams } from '../api/pagination.js';
import { WsProviderConnector } from '../connector/ws/index.js';
export declare class RpcWebsocketApi {
    readonly provider: WsProviderConnector;
    constructor(provider: WsProviderConnector);
    onPong(cb: OnPongCb): void;
    ping(): void;
    getActiveOrders({ limit, page }?: PaginationParams): void;
    onGetActiveOrders(cb: OnGetActiveOrdersCb): void;
    getAllowedMethods(): void;
    onGetAllowedMethods(cb: OnGetAllowedMethodsCb): void;
}
