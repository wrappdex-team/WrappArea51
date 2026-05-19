import WebSocket from 'ws';
import { AnyFunction, AnyFunctionWithThis, OnMessageCb, OnMessageInputVoidCb, WsApiConfig } from './types.js';
import { WsProviderConnector } from './websocket-provider.connector.js';
export declare class WebsocketClient implements WsProviderConnector {
    readonly ws: WebSocket;
    private readonly url;
    private readonly initialized;
    private readonly authKey?;
    constructor(config: WsApiConfig);
    init(): void;
    on(event: string, cb: AnyFunctionWithThis): void;
    off(event: string, cb: AnyFunctionWithThis): void;
    onOpen(cb: AnyFunctionWithThis): void;
    send<T>(message: T): void;
    onMessage(cb: OnMessageCb): void;
    ping(): void;
    onPong(cb: OnMessageInputVoidCb): void;
    onClose(cb: AnyFunction): void;
    onError(cb: AnyFunction): void;
    close(): void;
    private checkInitialized;
}
