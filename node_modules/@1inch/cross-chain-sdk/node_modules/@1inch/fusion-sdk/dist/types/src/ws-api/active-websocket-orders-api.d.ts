import { OnOrderCancelledCb, OnOrderCb, OnOrderCreatedCb, OnOrderFilledCb, OnOrderFilledPartiallyCb, OnOrderInvalidCb, OnOrderNotEnoughBalanceOrAllowanceCb } from './types.js';
import { WsProviderConnector } from '../connector/ws/index.js';
export declare class ActiveOrdersWebSocketApi {
    readonly provider: WsProviderConnector;
    constructor(provider: WsProviderConnector);
    onOrder(cb: OnOrderCb): void;
    onOrderCreated(cb: OnOrderCreatedCb): void;
    onOrderInvalid(cb: OnOrderInvalidCb): void;
    onOrderBalanceOrAllowanceChange(cb: OnOrderNotEnoughBalanceOrAllowanceCb): void;
    onOrderFilled(cb: OnOrderFilledCb): void;
    onOrderCancelled(cb: OnOrderCancelledCb): void;
    onOrderFilledPartially(cb: OnOrderFilledPartiallyCb): void;
}
