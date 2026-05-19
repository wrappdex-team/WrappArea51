import { ActiveOrdersRequest, OrdersByMakerRequest, OrderStatusRequest } from './orders.request.js';
import { ActiveOrdersResponse, OrdersApiConfig, OrdersByMakerResponse, OrderStatusResponse } from './types.js';
import { HttpProviderConnector } from '../../connector/index.js';
import { OrdersVersion } from '../ordersVersion.js';
export declare class OrdersApi {
    private readonly config;
    private readonly httpClient;
    private static Version;
    constructor(config: OrdersApiConfig, httpClient: HttpProviderConnector);
    static new(config: OrdersApiConfig, httpClient?: HttpProviderConnector): OrdersApi;
    getActiveOrders(params: ActiveOrdersRequest, ordersVersion: OrdersVersion): Promise<ActiveOrdersResponse>;
    getOrderStatus(params: OrderStatusRequest): Promise<OrderStatusResponse>;
    getOrdersByMaker(params: OrdersByMakerRequest, ordersVersion: OrdersVersion): Promise<OrdersByMakerResponse>;
}
