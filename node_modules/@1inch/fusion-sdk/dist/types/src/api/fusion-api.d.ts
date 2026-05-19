import { FusionApiConfig } from './types.js';
import { QuoterRequest, QuoterCustomPresetRequest, Quote } from './quoter/index.js';
import { RelayerRequest } from './relayer/index.js';
import { ActiveOrdersRequest, ActiveOrdersResponse, OrdersByMakerRequest, OrderStatusRequest, OrderStatusResponse, OrdersByMakerResponse } from './orders/index.js';
import { OrdersVersion } from './ordersVersion.js';
export declare class FusionApi {
    private readonly quoterApi;
    private readonly relayerApi;
    private readonly ordersApi;
    constructor(config: FusionApiConfig);
    static new(config: FusionApiConfig): FusionApi;
    getQuote(params: QuoterRequest): Promise<Quote>;
    getQuoteWithCustomPreset(params: QuoterRequest, body: QuoterCustomPresetRequest): Promise<Quote>;
    getActiveOrders(params?: ActiveOrdersRequest, ordersVersion?: OrdersVersion): Promise<ActiveOrdersResponse>;
    getOrderStatus(params: OrderStatusRequest): Promise<OrderStatusResponse>;
    getOrdersByMaker(params: OrdersByMakerRequest, ordersVersion?: OrdersVersion): Promise<OrdersByMakerResponse>;
    submitOrder(params: RelayerRequest): Promise<void>;
    submitOrderBatch(params: RelayerRequest[]): Promise<void>;
}
