import { RelayerRequest } from './relayer.request.js';
import { RelayerApiConfig } from './types.js';
import { HttpProviderConnector } from '../../connector/index.js';
export declare class RelayerApi {
    private readonly config;
    private readonly httpClient;
    private static Version;
    constructor(config: RelayerApiConfig, httpClient: HttpProviderConnector);
    static new(config: RelayerApiConfig, httpClient?: HttpProviderConnector): RelayerApi;
    submit(params: RelayerRequest): Promise<void>;
    submitBatch(params: RelayerRequest[]): Promise<void>;
}
