import { NetworkEnum } from '../constants.js';
import { HttpProviderConnector } from '../connector/index.js';
export type FusionApiConfig = {
    url: string;
    network: NetworkEnum;
    authKey?: string;
    httpProvider?: HttpProviderConnector;
};
export type PaginationMeta = {
    totalItems: number;
    itemsPerPage: number;
    totalPages: number;
    currentPage: number;
};
export type PaginationOutput<T extends Record<string, any> = Record<string, any>> = {
    meta: PaginationMeta;
    items: T[];
};
