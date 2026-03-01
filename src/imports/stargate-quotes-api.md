Quotes
GET
Deprecation Notice: The Stargate API is being deprecated. Please migrate to the new LayerZero Value Transfer API . Migration documentation can be found here .


The ERC20 Routes endpoint returns a list of available quotes containing the required transactions needed to complete a cross-chain transfer between supported networks using the Stargate protocol.



GET /quotes
Configurator

Source Token

Destination Token
srcToken
required
string
Token contract address on the source chain.
dstToken
required
string
Token contract address on the destination chain.
srcAddress
required
string
Your wallet address on the source chain.
dstAddress
required
string
Your wallet address on the destination chain.
srcChainKey
required
string
Identifier for the source blockchain (e.g., `arbitrum`, `optimism`, `ethereum`).
dstChainKey
required
string
Identifier for the destination blockchain.
srcAmount
required
string
The amount of tokens you wish to transfer (in smallest unit).
dstAmountMin
required
string
The minimum amount expected on the destination chain after fees.
/routes Request

https://stargate.finance/api/v1/quotes?srcToken=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE&srcChainKey=ethereum&dstToken=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE&dstChainKey=arbitrum&srcAddress=0x1234567890abcdef1234567890abcdef12345678&dstAddress=0xabcdef1234567890abcdef1234567890abcdef12&srcAmount=1000000000000000000&dstAmountMin=950000000000000000
curl -X GET 'https://stargate.finance/api/v1/quotes?'\
'srcToken=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE&'\
'srcChainKey=ethereum&'\
'dstToken=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE&'\
'dstChainKey=arbitrum&'\
'srcAddress=0x1234567890abcdef1234567890abcdef12345678&'\
'dstAddress=0xabcdef1234567890abcdef1234567890abcdef12&'\
'srcAmount=1000000000000000000&'\
'dstAmountMin=950000000000000000'
/routes Response

{
  "message": "This API is deprecated. Please use the new VT API at https://transfer.layerzero-api.com/v1"
}
{
  "message": "This API is deprecated. Please use the new VT API at https://transfer.layerzero-api.com/v1"
}

List of chainKeys can be found under https://stargate.finance/api/v1/chains 