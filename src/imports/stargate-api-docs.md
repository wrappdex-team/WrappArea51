Stargate API
Deprecation Notice: The Stargate API is being deprecated. Please migrate to the new LayerZero Value Transfer API . Migration documentation can be found here .

The Verifiable API for Cross-Chain Token Transfers
Stargate’s unified API enables seamless cross-chain token transfers between supported networks with a simple REST interface.

Stargate API Example

//Get quotes for a USDC ETHEREUM -> USDC POLYGON transfer
const response = await axios.get('https://stargate.finance/api/v1/quotes', {
  params: {
    srcToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC on Ethereum
    dstToken: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', // USDC on Polygon
    srcAddress: '0x1504482b4D3E5ec88acc21bdBE0e8632d8408840',
    dstAddress: '0x1504482b4D3E5ec88acc21bdBE0e8632d8408840',
    srcChainKey: 'ethereum',
    dstChainKey: 'polygon',
    srcAmount: '1000000', // 1 USDC (6 decimals)
    dstAmountMin: '990000', // Amount to receive deducted by Stargate fees (max 0.15%)
  },
});
Browse Endpoints
GET Quotes
Get quotes for cross-chain token transfers

GET Chains
Get list of supported chains

GET Tokens
Get list of supported tokens

Core Concepts
Verifiable
The API provides transparent transaction data for independent verification, allowing users to validate key parameters like addresses, amounts and chain details before signing.

RESTful
Built on REST principles with intuitive resource URLs, standard HTTP methods, and semantic status codes. The API is predictable and easy to integrate with any tech stack.

Non-Custodial
Users maintain full control of their assets. Stargate never takes custody of funds. All transactions are executed directly between user wallets and smart contracts.

Stateless
Stargate’s API is fully stateless, each request is self-contained and independent. No server-side session state or stored data is required, ensuring reliability and scalability.

Start Building
A typical integration involves the following steps:

Query Available Quotes
Use the quotes  endpoint to get available quotes for your desired token transfer

Get available transfer qoutes

const quotes = await axios.get("https://stargate.finance/api/v1/quotes", {
 ...
});
Create and sign transactions
Each quote contains an ordered array of transactions that need to be signed and executed sequentially to complete the cross-chain transfer.

Client-side Signing

const tx = Transaction.fromTxData({
  ...quotes.params,
});
 
const signedTx = tx.sign(privateKeyBuffer);
Submit and Monitor Transaction
Submit the signed transaction to the network and wait for confirmation that the transaction was successfully included in a block.

STEP 4. Network Submission

const serializedTx = '0x' + signedTx.serialize().toString('hex');
 
const receipt = await web3.eth.sendSignedTransaction(serializedTx);
Rate Limits
If you encounter any rate limiting issues please contact our support team for assistance. We appreciate your understanding and feedback .