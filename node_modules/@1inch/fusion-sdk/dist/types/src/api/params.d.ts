import { OrdersVersion } from './ordersVersion.js';
export declare function concatQueryParams<T extends Record<string | number, string | string[] | number | boolean>>(params: T, version?: false | OrdersVersion): string;
