import { ActiveOrdersWebSocketApi } from './active-websocket-orders-api.js';
import { RpcWebsocketApi } from './rpc-websocket-api.js';
import { WsApiConfigWithNetwork } from './types.js';
import { AnyFunction, AnyFunctionWithThis, OnMessageCb, WsProviderConnector } from '../connector/ws/index.js';
export declare class WebSocketApi {
    private static Version;
    readonly rpc: RpcWebsocketApi;
    readonly order: ActiveOrdersWebSocketApi;
    readonly provider: WsProviderConnector;
    constructor(configOrProvider: WsApiConfigWithNetwork | WsProviderConnector);
    static new(configOrProvider: WsApiConfigWithNetwork | WsProviderConnector): WebSocketApi;
    init(): void;
    on(event: string, cb: AnyFunctionWithThis): void;
    off(event: string, cb: AnyFunctionWithThis): void;
    onOpen(cb: AnyFunctionWithThis): void;
    send<T>(message: T): void;
    close(): void;
    onMessage(cb: OnMessageCb): void;
    onClose(cb: AnyFunction): void;
    onError(cb: AnyFunction): void;
}
