import { QuoterRequest } from './quoter.request.js';
import { QuoterApiConfig } from './types.js';
import { Quote } from './quote/index.js';
import { QuoterCustomPresetRequest } from './quoter-custom-preset.request.js';
import { HttpProviderConnector } from '../../connector/index.js';
export declare class QuoterApi {
    private readonly config;
    private readonly httpClient;
    private static Version;
    constructor(config: QuoterApiConfig, httpClient: HttpProviderConnector);
    static new(config: QuoterApiConfig, httpClient?: HttpProviderConnector): QuoterApi;
    getQuote(params: QuoterRequest): Promise<Quote>;
    getQuoteWithCustomPreset(params: QuoterRequest, body: QuoterCustomPresetRequest): Promise<Quote>;
}
