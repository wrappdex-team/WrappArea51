// =======================================================================
// FUSION+ SDK SOURCE CODE ANALYSIS — Step 2 Complete Results
// =======================================================================
// Generated: 2026-03-03 from reading actual SDK source on GitHub
// Repos analyzed:
//   - github.com/1inch/cross-chain-sdk  (sha 813d9e0)
//   - github.com/1inch/fusion-sdk       (sha 7ef1e71)
//   - github.com/1inch/limit-order-sdk  (sha 9013fa8)
//
// IMPLEMENTATION NOTE: This file is a reference document, not executable code.
// It documents the exact binary encoding formats discovered by reading the SDK
// source, to guide the corrected reimplementation in fusion-plus-sdk.ts.
// =======================================================================

// ── 1. THREE-LAYER SDK ARCHITECTURE ──
//
// limit-order-sdk:  LimitOrder → Extension → ExtensionBuilder → MakerTraits
// fusion-sdk:       FusionOrder extends LimitOrder, FusionExtension handles auction/whitelist/fees
// cross-chain-sdk:  EvmCrossChainOrder extends FusionOrder, EscrowExtension extends FusionExtension

// ── 2. EXTENSION BINARY FORMAT (limit-order-sdk/extension.ts) ──
//
// 8 fields in order:
//   [0] makerAssetSuffix  [1] takerAssetSuffix  [2] makingAmountData  [3] takingAmountData
//   [4] predicate         [5] makerPermit        [6] preInteraction    [7] postInteraction
// Plus: customData (appended after field 7, NOT tracked in offsets)
//
// encode() = "0x" + offsets(32 bytes / 64 hex) + concat(all 8 fields bytes) + customData
//
// offsets word = 8 × uint32 packed into uint256:
//   slot[i] = cumulative byte count through field i
//   packed as: offsets |= BigInt(cumLen) << BigInt(i * 32)
//
// keccak256() = keccak256(encode()) — used for salt embedding

// ── 3. SALT EMBEDDING (limit-order-sdk/limit-order.ts) ──
//
// static buildSalt(extension, baseSalt = random96bit):
//   if extension.isEmpty(): return baseSalt
//   return (baseSalt << 160n) | (extension.keccak256() & UINT_160_MAX)
//
// static verifySalt(salt, extension):
//   if extension.isEmpty(): return salt
//   assert((salt & UINT_160_MAX) === (extension.keccak256() & UINT_160_MAX))
//
// ** CRITICAL: Lower 160 bits of salt MUST equal keccak256(encoded extension) & 0xFFFF...F (160 bits) **

// ── 4. WHITELIST ENCODING (fusion-sdk/whitelist.ts) ──
//
// Binary format of encodeInto(builder):
//   uint32 resolvingStartTime                    // 4 bytes
//   uint8  whitelistSize                         // 1 byte
//   For each entry (N entries):
//     bytes10 addressHalf (last 10 bytes of addr) // 10 bytes
//     uint16  delay (RELATIVE, not absolute!)     // 2 bytes
//   Total: 5 + N*12 bytes
//
// Delays are computed in Whitelist.new() as:
//   entries sorted by allowFrom ASC
//   sumDelay = 0
//   for each entry:
//     delay = entry.allowFrom - resolvingStartTime - sumDelay
//     sumDelay += delay
//
// ** CRITICAL: Delays are RELATIVE cumulative offsets from resolvingStartTime, NOT absolute timestamps **
// ** CRITICAL: Each delay is uint16 (2 bytes), NOT uint32 **
// ** With 4 entries: 5 + 4*12 = 53 bytes of whitelist data **

// ── 5. FUSION EXTENSION BUILD (fusion-sdk/fusion-extension.ts) ──
//
// build() produces Extension with:
//
// makingAmountData = settlement(20) + auctionDetails(variable) + fees(6) + whitelist_addresses(1+10*N)
//   fees(6) = uint16(integratorFee) + uint8(integratorShare) + uint16(resolverFee) + uint8(whitelistDiscountNumerator)
//   whitelist_addresses = uint8(count) + [bytes10(addressHalf)] * N   (no delays, just addresses)
//
// takingAmountData = SAME as makingAmountData
//
// postInteraction = Interaction(settlement, interactionData)
//   where Interaction.encode() = settlement(20) + interactionData
//   interactionData:
//     uint8  flags                          // 1 byte (bit 0 = has custom receiver)
//     address integratorFeeRecipient        // 20 bytes
//     address protocolFeeRecipient          // 20 bytes
//     [address customReceiver]              // 20 bytes (optional, if flag bit 0 set)
//     fees(6)                               // same 6 bytes as in amountData
//     whitelist_full(5+12*N)                // full whitelist with delays
//     uint256 estimatedTakerAmount          // 32 bytes (surplus)
//     uint8   protocolSurplusFee            // 1 byte (surplus)

// ── 6. ESCROW EXTENSION BUILD (cross-chain-sdk/escrow-extension.ts) ──
//
// EscrowExtension extends FusionExtension, overrides build():
//
// 1. Calls super.build() → gets base Extension
// 2. Parses base postInteraction:
//    iter = BytesIter(postInteraction)
//    extensionAddr = iter.nextAddress()          // 20 bytes
//    flags = iter.nextUint8()                    // 1 byte
//    integrator = iter.nextAddress()             // 20 bytes
//    protocol = iter.nextAddress()               // 20 bytes
//    [if flags bit 0: iter.nextAddress()]        // skip custom receiver
//    restBytes = remaining - 33 (surplus bytes)
//    feeAndWhitelist = iter.nextBytes(restBytes - 33)
//
// 3. Rebuilds postInteraction (CROSS-CHAIN FORMAT):
//    new BytesBuilder()
//      .addAddress(extensionAddr)                // 20 bytes
//      .addAddress(integrator)                   // 20 bytes
//      .addAddress(protocol)                     // 20 bytes
//      .addBytes(feeAndWhitelist)                // fees(6) + whitelist(5+12*N) bytes
//      .addBytes(encodeCrossChainData())         // 160 bytes
//
//    ** NOTE: NO flags byte, NO custom receiver, NO surplus bytes in cross-chain format **
//
// 4. encodeCrossChainData() = ABI.encode(
//      ['bytes32', 'uint256', 'uint256', 'uint256', 'uint256'],
//      [hashLock, dstChainId, dstToken, packedSafetyDeposit, timeLocks]
//    ) = 5 × 32 = 160 bytes
//
//    packedSafetyDeposit = (srcSafetyDeposit << 128n) | dstSafetyDeposit
//
// 5. customData = dstAddressFirstPart.asHex() (or "0x" if zero)
//    ** NOT srcChainId + dstChainId! **

// ── 7. CROSS-CHAIN DATA BINARY LAYOUT (160 bytes) ──
//
// All values are ABI-encoded as uint256 (32 bytes each, big-endian, zero-padded):
//
// Bytes [0..31]:   hashLock (bytes32)
// Bytes [32..63]:  dstChainId (uint256)
// Bytes [64..95]:  dstToken address (uint256, zero-padded from address)
// Bytes [96..127]: packedSafetyDeposit = (srcSafetyDeposit << 128) | dstSafetyDeposit
// Bytes [128..159]: timeLocks (uint256)
//
// TimeLocks.build() packs 8 × uint32 into one uint256:
//   [srcWithdrawal, srcPublicWithdrawal, srcCancellation, srcPublicCancellation,
//    dstWithdrawal, dstPublicWithdrawal, dstCancellation, deployedAt]
//   reduced as: (acc << 32n) | element

// ── 8. takerAsset (cross-chain-sdk/evm-cross-chain-order.ts) ──
//
// In EvmCrossChainOrder.new():
//   takerAsset: TRUE_ERC20[escrowParams.srcChainId]
//   = "0xda0000d4000015a526378bb6fafc650cea5966f8" (all non-ZKSync chains)
//   = "0xd66097c27eb8dee404bac235737932260edc6f3b" (ZKSync)
//
// ** CRITICAL: takerAsset is NOT the dst chain token! **
// The real destination token is encoded in the cross-chain data (dstToken field).

// ── 9. MAKER TRAITS (fusion-sdk/fusion-order.ts) ──
//
// const deadline = auctionDetails.startTime + auctionDetails.duration + orderExpirationDelay
// makerTraits = MakerTraits.default()
//   .withExpiration(deadline)
//   .setPartialFills(true)
//   .setMultipleFills(true)
//   .enablePostInteraction()
//   .withExtension()  // if extension not empty
//   [.withNonce(nonce)]
//   [.enablePermit2()]
//   [.enableNativeUnwrap()]

// ── 10. RELAYER SUBMIT FORMAT (cross-chain-sdk/relayer.request.ts) ──
//
// POST /v1.2/submit
// Body (JSON):
// {
//   srcChainId: number,
//   order: {
//     salt: string,          // decimal or hex string
//     maker: string,         // 0x address
//     receiver: string,      // 0x address (or 0x000...000)
//     makerAsset: string,    // 0x address (source token)
//     takerAsset: string,    // 0x address (TRUE_ERC20, NOT dst token!)
//     makingAmount: string,  // decimal string
//     takingAmount: string,  // decimal string
//     makerTraits: string    // decimal or hex string
//   },
//   signature: string,       // EIP-712 signature from MetaMask
//   quoteId: string,         // from quoter response
//   extension: string,       // 0x-prefixed encoded extension
//   secretHashes?: string[]  // only for multi-fill (>1 secrets); omitted for single
// }

// ── 11. HASH LOCK (cross-chain-sdk/hash-lock.ts) ──
//
// Single fill: HashLock.forSingleFill(secret) = keccak256(secret)
//   where secret is 0x + 64 hex chars (32 bytes)
//   The result has first byte zeroed by the SDK? No — looking more carefully:
//   forSingleFill just returns keccak256(secret) directly.
//   The "zero first byte" was from forMultipleFills which sets upper bits for count.
//
// Multi-fill: merkle tree root with leaves[i] = keccak256(abi.encodePacked(uint64(i), keccak256(secret[i])))
//   Root has upper 16 bits = (leaves.length - 1)

// ── 12. AUCTION DETAILS ENCODING (fusion-sdk/auction-details.ts) ──
//
// encodeInto(builder):
//   builder.addUint32(startTime)           // 4 bytes
//   builder.addUint24(duration)            // 3 bytes
//   builder.addUint24(initialRateBump)     // 3 bytes
//   for each point:
//     builder.addUint16(point.delay)       // 2 bytes
//     builder.addUint24(point.coefficient) // 3 bytes
//   Total: 10 + N*5 bytes

// ── 13. RECEIVER FIELD IN ORDER STRUCT ──
//
// From fusion-order.ts:
//   If order has fees or surplus: receiver = settlementExtensionContract
//   Else: receiver = orderInfo.receiver
//
// From evm-cross-chain-order.ts:
//   The EscrowExtension constructor always passes SurplusParams.NO_FEE
//   But the Fees are passed via EscrowExtensionExtra
//   So if fees exist, receiver = settlement contract address

// ── 14. ESCROW FACTORY ADDRESS (cross-chain-sdk/deployments.ts) ──
//
// ESCROW_FACTORY (all non-ZKSync): "0x03a25b3215a0e5c15cf23ac4d2e5cf86c0ff7efa"
// ESCROW_FACTORY (ZKSync):         "0xd9085ac07da21bd6eb003a530a524ab054ca8652"
//
// This is the "settlement address" / extension address used in makingAmountData,
// takingAmountData, and postInteraction.

// ── 15. WHAT OUR CODE GETS WRONG (fusion-plus-sdk.ts) ──
//
// 1. SALT: Random without extension hash embedding
// 2. WHITELIST: Missing uint32 startTime + uint8 count header; absolute not relative delays
// 3. POST-INTERACTION: Completely wrong structure (missing integrator/protocol addresses,
//    fees, cross-chain data encoding; surplus bytes not stripped)
// 4. TAKER-ASSET: Using dst token instead of TRUE_ERC20
// 5. MAKING/TAKING AMOUNT DATA: Missing fees(6) and whitelist addresses
// 6. CUSTOM DATA: Using srcChainId+dstChainId but SDK uses dstAddressFirstPart or empty
// 7. CROSS-CHAIN DATA: Not ABI-encoded, scattered incorrectly
// 8. MAKER TRAITS: Missing postInteraction flag, wrong bit positions
// 9. ORDER HASH: Using JSON hash instead of proper EIP-712 typed data hash

// ── 16. QUOTER API RESPONSE FORMAT (cross-chain-sdk/api/quoter/types.ts) ──
//
// QuoterResponse = {
//   quoteId: string | null,
//   srcTokenAmount: string,        // raw amount in source token's decimals
//   dstTokenAmount: string,        // raw amount in dst token's decimals
//   presets: { fast, medium, slow, custom? },
//   srcEscrowFactory: string,      // ← THIS IS THE SETTLEMENT ADDRESS!
//   dstEscrowFactory: string,      // dst chain escrow
//   recommendedPreset: "fast"|"medium"|"slow",
//   prices: { usd: { srcToken, dstToken } },
//   volume: { usd: { srcToken, dstToken } },
//   whitelist: string[],           // array of resolver addresses (full 0x...40hex)
//   timeLocks: {
//     srcWithdrawal, srcPublicWithdrawal, srcCancellation, srcPublicCancellation,
//     dstWithdrawal, dstPublicWithdrawal, dstCancellation
//   },
//   srcSafetyDeposit: string,      // decimal string
//   dstSafetyDeposit: string,      // decimal string
//   autoK: number,                 // slippage
//   feeInfo?: {
//     resolverFee?: { receiver: string, bps: number, whitelistDiscountPercent: number },
//     integratorFee?: { receiver: string, bps: number, share: number }
//   }
// }
//
// PresetData = {
//   auctionDuration: number,       // seconds
//   startAuctionIn: number,        // seconds delay from now
//   initialRateBump: number,       // e.g. 50000
//   auctionStartAmount: string,    // decimal
//   startAmount: string,           // with gas bump
//   auctionEndAmount: string,      // ← this becomes takingAmount
//   costInDstToken: string,
//   points: { delay: number, coefficient: number }[],
//   allowPartialFills: boolean,
//   allowMultipleFills: boolean,
//   gasCost: { gasBumpEstimate: number, gasPriceEstimate: string },
//   exclusiveResolver: string | null,
//   secretsCount: number
// }

// ── 17. QUOTE → ORDER FLOW (cross-chain-sdk/api/quoter/quote/quote.ts) ──
//
// quote.createEvmOrder({hashLock}):
//   1. preset = this.getPreset(recommendedPreset)
//   2. auctionDetails = preset.createAuctionDetails()
//      → AuctionDetails({ startTime: now+startAuctionIn, duration, initialRateBump, points, gasCost })
//   3. whitelist = this.whitelist.map(addr => ({ address: addr, allowFrom: isExclusive ? 0n : auctionStartTime }))
//   4. fees = buildFees() from feeInfo (resolverFee + integratorFee or undefined)
//   5. orderInfo = { makerAsset: srcToken, takerAsset: dstToken, makingAmount: srcTokenAmount,
//                    takingAmount: preset.auctionEndAmount, maker: walletAddress, receiver }
//   6. escrowParams = { hashLock, srcChainId, dstChainId, srcSafetyDeposit, dstSafetyDeposit, timeLocks }
//   7. EvmCrossChainOrder.new(srcEscrowFactory, orderInfo, escrowParams, details, extra)
//      → This REPLACES takerAsset with TRUE_ERC20[srcChainId]!
//      → This passes dstToken into EscrowExtension (encoded in cross-chain data)

// ── 18. CORRECT IMPLEMENTATION PLAN ──
//
// Step 3: Build faithful EscrowExtension encoder
//   - encodeAuctionDetails() ← already close, just verify byte widths
//   - encodeFees() ← new: uint16+uint8+uint16+uint8 = 6 bytes
//   - encodeWhitelist() ← fix: add header, use relative delays
//   - encodeWhitelistAddresses() ← new: count + 10*N bytes (for amountData)
//   - encodeCrossChainData() ← new: ABI-encode 5 × uint256 = 160 bytes
//
// Step 4: Build correct postInteraction
//   settlement(20) + integrator(20) + protocol(20) + fees(6) + whitelist(5+12*N) + crossChainData(160)
//
// Step 5: Build correct makingAmountData = takingAmountData
//   settlement(20) + auctionDetails(10+5*P) + fees(6) + whitelistAddresses(1+10*N)
//
// Step 6: Encode Extension, compute salt with extension hash
//   extension = encode(offsets, fields, customData)
//   salt = (random96 << 160) | (keccak256(extension) & UINT_160_MAX)
//
// Step 7: Build MakerTraits with correct flags
//   expiration, postInteraction, extension, partialFill, multipleFill
//
// Step 8: Build order struct with TRUE_ERC20 takerAsset
//
// Step 9: Build proper EIP-712 typed data + order hash
//
// Step 10: End-to-end test with the relayer

export {};