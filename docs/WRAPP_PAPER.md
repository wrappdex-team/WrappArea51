
================================================================================

                         W R A P P   P A P E R
                         
               Wrappdex: The Institutional-Grade DEX on Hedera
               
                              Version 1.1
                          February 14, 2026

================================================================================


                    "Trade smarter. Not harder. On Hedera."


================================================================================
  TABLE OF CONTENTS
================================================================================

  1.  Letter to Traders
  2.  Executive Summary
  3.  Platform Overview & Feature Map
  4.  How to Use Wrappdex (User Guide)
  5.  Architecture & Technical Stack
  6.  Oracle Pipeline: Multi-Source Price Integrity
  7.  The Wrappdex AMM: Smart Liquidity Engine
  8.  Weighted Pool Factory (Solidity)
  9.  Swap Execution Architecture
  10. Cross-Chain Bridge Aggregation
  11. DeFi Suite: Lending, Borrowing & Staking
  12. Governance: The HBAR.h DAO
  13. VIP System: Token-Gated Premium Access
  14. Security Architecture
  15. Tokenomics: HBAR.h Protocol Token
  16. Revenue Model & Growth Pathways
  17. Roadmap
  18. Technical Appendices
  19. Pitch Deck Slide Reference Index
  20. Team, Advisors & Contributors
  21. Design Specifications: Infographic Conversion Guide



================================================================================
  1. LETTER TO TRADERS
================================================================================

To every trader who has been burned by slippage on a chain that promised speed
but delivered congestion. To every DeFi user who watched a bridge eat their
funds while "processing." To every professional who wanted institutional-grade
tools but got a toy wrapped in a gradient.

This is Wrappdex.

Built on Hedera -- the only public ledger that delivers 10,000+ transactions
per second with mathematically provable finality in 3-5 seconds. Not
"eventually." Not "probably." Finality. The kind banks require. The kind
traders deserve.

Wrappdex is not another fork of Uniswap with a new logo. It is a vertically
integrated trading platform that combines:

  - A native AMM with server-authoritative state and constant-product pricing
  - Live Chainlink oracle feeds resolved via raw JSON-RPC batch calls
  - Multi-hop swap routing through SaucerSwap with route visualization
  - Professional charting with 9 timeframes, 6 technical indicators, and
    persistent drawing tools
  - Cross-chain bridging via Squid (Axelar), HashPort, and Stargate (LayerZero)
  - Lending and borrowing powered by Bonzo Finance (Aave V2 on Hedera)
  - A token-weighted governance DAO with on-chain voting power verification
  - ED25519 challenge-response authentication -- no passwords, no cookies,
    just cryptographic proof

Every price you see is real. Every swap route is computed from live pool data.
Every vote in the DAO is weighted against Mirror Node-verified token balances.
Every spin of the prize wheel is decided by CSPRNG, not Math.random().

We built this for traders who read code. For investors who audit contracts.
For the community that will govern it.

Welcome to the future of trading on Hedera.

                                              -- The HBAR.h Team



================================================================================
  2. EXECUTIVE SUMMARY
================================================================================

Wrappdex is a decentralized exchange (DEX) and comprehensive DeFi platform
built natively on the Hedera network. The platform serves as a single point
of access for token swapping, professional trading, liquidity provision,
lending/borrowing, cross-chain bridging, fiat on-ramp, and community
governance.

Key Differentiators:

  1. HEDERA-NATIVE PERFORMANCE
     Sub-cent transaction fees, 3-5 second finality, 10,000+ TPS throughput.
     No MEV. No front-running. Hashgraph consensus provides fair ordering.

  2. MULTI-SOURCE ORACLE INTEGRITY
     Prices sourced from Chainlink decentralized oracles (primary), CoinCap
     WebSocket feeds (secondary), and CoinGecko REST API (tertiary). Each
     price displays its source badge so users always know data provenance.

  3. CUSTOM AMM WITH SERVER-AUTHORITATIVE STATE
     The Smart Liquidity Engine uses constant-product (x * y = k) pricing
     with all pool state persisted in a KV store. This eliminates
     front-running by making swap execution deterministic and atomic.

  4. INSTITUTIONAL SECURITY MODEL
     ED25519 challenge-response authentication, CSPRNG nonces, 30-minute
     session TTLs, per-IP rate limiting, input sanitization against
     bidirectional text attacks, CSP headers, and HSTS enforcement.

  5. TOKEN-GATED VIP SYSTEM
     Holders of 100M+ HBAR.h tokens or VIP NFTs unlock premium features:
     emerald theme, premium sound FX, trading terminal access, VIP chat,
     and the prize spin wheel.

Protocol Token:   HBAR.h  (HTS ID: 0.0.9356476, 8 decimals)
VIP NFT:          0.0.10146181
Treasury:         0.0.9695738
Founder Account:  0.0.518487



================================================================================
  3. PLATFORM OVERVIEW & FEATURE MAP
================================================================================

Wrappdex is organized into 8 primary modules, each accessible via the
navigation system. Desktop users see a top navigation bar; mobile users
interact via a bottom tab bar with a "More" sheet for secondary routes.

  +------------------------------------------------------------------+
  |                                                                    |
  |   NAVIGATION TABS                                                  |
  |   Markets | Trade | Swap | Buy/Sell | Wallet | DeFi | DAO          |
  |   (+ Bridges, Audit via "More" on mobile)                         |
  |                                                                    |
  +------------------------------------------------------------------+


3.1  MARKETS (Dashboard)
-------------------------
  - Global crypto market cap, 24h volume, BTC/ETH dominance
  - BTC, HBAR, and HBAR.h ticker cards with real 7-day sparkline charts
  - Fear & Greed Index gauge (live from alternative.me API)
  - RSI gauge with overbought/oversold zones
  - BTC Dominance segmented bar
  - Top 20 market overview with expandable candlestick charts
  - Site Activity feed with live trade logging
  - Oracle source badges (Chainlink / CoinCap / CoinGecko / Cached)
  - Real-time news ticker (server-cached, 10-minute refresh)

3.2  TRADE (VIP-Gated CEX Terminal)
-------------------------------------
  - Full candlestick charting via TradingView's lightweight-charts
  - 9 timeframes: 1m, 5m, 30m, 1H, 4H, 1D, 1W, 1M, All
  - Technical indicators: SMA(20), SMA(50), EMA(12), RSI(14), MACD, 
    Bollinger Bands
  - Chart drawing tools: trendlines, horizontal lines, rays, Fibonacci
    retracements -- all persisted to localStorage
  - Watchlist with favorites (star toggle, localStorage-persisted)
  - Real-time chart data from CoinCap API with synthetic fallback
  - Chart data source badge (CoinCap / Synthetic)
  - CEX-style trade panel via HSuite SmartNode SDK aggregation
  - VIP Chat (25-word limit, 2-min cooldown, emerald glass-morphism)
  - SaucerSwap pool routes table with inline swap initiation
  - Live price tick updates without full chart rebuild

3.3  SWAP
----------
  - Native SaucerSwap integration (not an iframe -- SaucerSwap blocks
    iframe embedding via X-Frame-Options / CSP frame-ancestors)
  - 10+ supported tokens: HBAR, WHBAR, USDC, USDT, WBTC, WETH, SAUCE,
    LINK, KARATE, PACK, HST, HBARX, DOVU
  - Multi-hop route visualization with pool fee display
  - HBAR/WHBAR wrap/unwrap (1:1, zero fee)
  - Configurable slippage: 0.1%, 0.5%, 1.0%, 3.0%, or custom
  - Quote refresh countdown (30-second auto-refresh)
  - Token balance display with "Max" button (reserves 1 HBAR for gas)
  - Swap history with success/failure tracking
  - Animated success overlay with confetti and transaction receipt
  - 1inch cross-chain widget integration

3.4  BUY / SELL
----------------
  - Fiat on-ramp via ChangeNOW partner integration
  - Cross-chain exchange with 100+ supported cryptocurrencies
  - Direct HBAR purchases with credit card
  - Privacy-consent gating before redirect to third-party services

3.5  WALLET
------------
  - Dual wallet support: HashPack (Hedera) + MetaMask (EVM)
  - Portfolio pie chart (recharts) with color-coded asset allocation
  - Native HBAR balance + HTS token balances
  - HBAR.h token balance with live USD pricing from DexScreener/SaucerSwap
  - SaucerSwap LP token tracking with price calculation
  - Transaction history from Hedera Mirror Node
  - EVM token balances and transaction history for MetaMask
  - DAO voting power display
  - VIP status badge and NFT count

3.6  DeFi
----------
  - LIQUIDITY POOLS: 16 SaucerSwap pools with TVL, volume, APR, fee tier,
    and utilization metrics. Pools cover WHBAR, USDC, USDT, WETH, WBTC,
    SAUCE, LINK, KARATE, PACK, HST, HBARX, DOVU, and HBAR.h pairs.
  - LEND & BORROW: Bonzo Finance integration (Aave V2 fork on Hedera).
    Live market data, supply/withdraw/borrow/repay flows, health factor
    display. Supported assets: HBAR, USDC, WBTC, WETH, LINK, BONZO.
  - STAKING: Staking pool roster matching liquidity pool tokens.
    Backend plugin architecture ready for production data sources.

3.7  DAO
---------
  - Proposal creation with categories: Fees, Staking, Listing, Tokenomics,
    Features, Partnership, Governance, Other
  - Configurable voting duration: 3, 5, 7, or 14 days
  - Token-weighted voting: 1 vote per 100M HBAR.h (max 10 votes) +
    1 vote per 3 VIP NFTs (max 1 NFT vote) = max 11 votes per wallet
  - Server-side vote verification against Mirror Node balances
  - Threaded comments on proposals
  - Admin CRUD for founder account + dynamic admin list
  - Proposal filtering: All, Active, Passed, Rejected
  - Prize Spin Wheel: CSPRNG-determined outcomes, 2% win rate,
    24-hour server-enforced cooldown, fireworks celebration animation

3.8  BRIDGES
-------------
  - SQUID (Axelar): Cross-chain swaps across 60+ chains
  - HASHPORT: Official Hedera bridge to Ethereum/EVM chains
  - STARGATE (LayerZero): Omnichain bridge with unified liquidity

3.9  SECURITY AUDIT
---------------------
  - Wallet signing architecture documentation
  - WalletConnect Health Report with session diagnostics
  - Authentication protocol status (ED25519 challenge-response)
  - Infrastructure health monitoring



================================================================================
  4. HOW TO USE WRAPPDEX (USER GUIDE)
================================================================================

4.1  CONNECTING YOUR WALLET
-----------------------------

  Step 1: Click the wallet icon in the navigation header.
  Step 2: Select your wallet provider:
          - HashPack (recommended for Hedera-native operations)
          - MetaMask (for EVM-compatible chains)
  Step 3: Approve the connection in your wallet.
          HashPack uses WalletConnect v2 (HIP-820 compliant).
          MetaMask uses native EIP-1193 injection.
  Step 4: Your wallet address, HBAR balance, and token holdings
          will appear in the header.

  The connection flow:
  
  +-----------+     WC v2 Session Proposal     +-----------+
  |           | -----------------------------> |           |
  |  Wrappdex |     HIP-820 Namespace          |  HashPack |
  |  (dApp)   | <-------- Session Approved --- |  (Wallet) |
  |           |                                |           |
  +-----------+     hedera_signMessage         +-----------+
                    hedera_signAndExecuteTransaction


4.2  EXECUTING A SWAP
-----------------------

  Step 1: Navigate to the "Swap" tab.
  Step 2: Select your input token (top field) and output token (bottom).
  Step 3: Enter the amount you wish to swap.
  Step 4: Review the quote:
          - Estimated output amount
          - Price impact percentage
          - Swap route visualization (direct or multi-hop)
          - Fee breakdown
          - Minimum output after slippage
  Step 5: (Optional) Adjust slippage tolerance via the gear icon.
  Step 6: Click "Swap" and approve the transaction in HashPack.
  Step 7: Upon success, an animated overlay displays the transaction receipt
          with a link to HashScan for on-chain verification.

  Route Discovery:
  
  +---------+         +---------+         +---------+
  |  HBAR   | ------> |  WHBAR  | ------> |  USDC   |
  +---------+  wrap   +---------+  pool   +---------+
                       0.3% fee

  For HBAR/WHBAR pairs, the swap is a direct wrap/unwrap (1:1, zero fee).
  For all other pairs, the router finds optimal paths through available
  SaucerSwap V1 liquidity pools.


4.3  PROVIDING LIQUIDITY (Smart Liquidity Engine)
---------------------------------------------------

  Step 1: Navigate to DeFi > Pools or access the Smart Liquidity section
          within the Trading terminal.
  Step 2: Select a pool pair (e.g., WBTC/USDC).
  Step 3: Enter the amount of Token A. Token B auto-calculates based on
          current pool ratio (constant-product invariant).
  Step 4: Review position details:
          - Your share percentage of total pool
          - Estimated LP tokens received
          - Current pool TVL and volume
  Step 5: Approve and deposit. LP shares are tracked server-side.
  Step 6: To withdraw, select your position and specify the share
          percentage to remove. Both tokens return proportionally.


  LP Pool Anatomy:
  
  +---------------------------------------------------------------+
  |                    LIQUIDITY POOL: WBTC / USDC                |
  +---------------------------------------------------------------+
  |                                                                |
  |  Reserve A (WBTC):  2.5 BTC           Price A: $97,845.00    |
  |  Reserve B (USDC):  244,612 USDC      Price B: $1.00         |
  |                                                                |
  |  Invariant k = Reserve_A * Reserve_B                          |
  |             k = 2.5 * 244,612 = 611,530                       |
  |                                                                |
  |  Swap Fee:     30 bps (0.30%)                                 |
  |  LP Supply:    1,000,000 shares                               |
  |  TVL:          $489,224                                        |
  |                                                                |
  +---------------------------------------------------------------+
  |  YOUR POSITION                                                 |
  |  Shares: 50,000 (5.0% of pool)                               |
  |  Value:  0.125 WBTC + 12,230.60 USDC = ~$24,461             |
  +---------------------------------------------------------------+


4.4  VOTING IN THE DAO
------------------------

  Eligibility: Hold 100M+ HBAR.h tokens OR 1+ VIP NFT.
  
  Step 1: Navigate to the "DAO" tab.
  Step 2: Browse active proposals or create a new one.
  Step 3: Cast your vote (For / Against). Your voting power is calculated
          server-side from Mirror Node-verified balances:
          
          Token Votes:  1 per 100M HBAR.h  (max 10)
          NFT Votes:    1 per 3 VIP NFTs   (max 1)
          Maximum:      11 votes per wallet
          
  Step 4: Add comments to discuss proposals.
  Step 5: Proposals resolve automatically when voting duration expires.


4.5  USING THE TRADING TERMINAL (VIP)
----------------------------------------

  Prerequisite: VIP status (100M+ HBAR.h or 1+ VIP NFT).
  
  Step 1: Navigate to "Trade."
  Step 2: Select a trading pair from the dropdown (20+ pairs available).
  Step 3: Choose your timeframe (1m to All Time).
  Step 4: Add indicators via the overlay toolbar:
          - SMA 20 (yellow), SMA 50 (purple), EMA 12 (cyan)
          - RSI 14 (synced sub-chart)
          - MACD (histogram + signal lines, synced sub-chart)
          - Bollinger Bands (purple bands with middle line)
  Step 5: Use drawing tools for trendlines, horizontal support/resistance,
          rays, and Fibonacci retracements. All drawings persist across
          sessions via localStorage.
  Step 6: Execute swaps directly from the integrated trade panel.
  Step 7: Access VIP Chat to communicate with other VIP holders.



================================================================================
  5. ARCHITECTURE & TECHNICAL STACK
================================================================================

5.1  SYSTEM ARCHITECTURE
--------------------------

  +-------------------------------------------------------------------+
  |                        CLIENT (Browser)                            |
  |                                                                    |
  |  React 18  +  Vite 6  +  Tailwind CSS v4  +  React Router v7     |
  |  Motion (animations)  +  Radix UI (accessibility)                 |
  |  lightweight-charts (TradingView)  +  recharts (portfolio)        |
  |  sonner (toasts)  +  lucide-react (icons)                        |
  |                                                                    |
  +----------+---------+---------+---------+---------+----------------+
             |         |         |         |         |
             v         v         v         v         v
  +--------+ +--------+ +------+ +-------+ +--------+
  |Chainlink| |CoinCap | |Sauce-| |Mirror | |Dynamic |
  | Oracle  | |  API   | |rSwap | | Node  | | Labs   |
  | (ETH)   | |(WS/REST| | API  | |(Hedera| |  SDK   |
  +--------+ +--------+ +------+ +-------+ +--------+
                                     |
                                     v
  +-------------------------------------------------------------------+
  |                    EDGE FUNCTION SERVER (Hono)                     |
  |                    Supabase Edge Functions                         |
  |                                                                    |
  |  Modules: Auth | AMM | DAO | Spin | Chat | News | Pools          |
  |  Storage: Supabase KV Store                                       |
  |  Auth:    ED25519 Challenge-Response (30-min sessions)            |
  |  Security: Rate limiting, input sanitization, CSP, HSTS           |
  |                                                                    |
  +-------------------------------------------------------------------+
             |         |         |
             v         v         v
  +--------+ +--------+ +--------+
  | Hedera | | Supabase| | HSuite |
  |Mainnet | |   KV    | | Smart  |
  |(HCS/HTS| | Store   | | Nodes  |
  +--------+ +--------+ +--------+


5.2  FRONTEND ARCHITECTURE
----------------------------

  Framework:        React 18.3.1 (Single Page Application)
  Build Tool:       Vite 6.3.5 with @vitejs/plugin-react
  CSS:              Tailwind CSS v4.1.12 with custom theme tokens
  Routing:          React Router v7 (Data mode with RouterProvider)
  State:            React Context (Wallet, Theme, Signing) + localStorage
  Animations:       Motion (formerly Framer Motion) v12.34+
  UI Primitives:    Radix UI (tooltip, dialog, sheet, accordion, etc.)
  Charts:           TradingView lightweight-charts v5.1+
  Portfolio Charts: Recharts v2.15
  Icons:            Lucide React v0.487
  Toasts:           Sonner v2.0
  Wallet Connect:   @walletconnect/sign-client v2.23
  Hedera SDK:       @hashgraph/sdk v2.80

  Code Splitting:
  All route components are lazy-loaded with a retry wrapper that handles
  transient Vite chunk-load failures (cache-busting via timestamp query
  parameter on retry).


5.3  BACKEND ARCHITECTURE
---------------------------

  Runtime:          Deno (Supabase Edge Functions)
  Framework:        Hono v4.6.3 (lightweight, edge-optimized)
  Storage:          Supabase KV Store (all persistent state)
  Authentication:   ED25519 challenge-response with KV-backed sessions
  Rate Limiting:    Dual-layer (L1: in-memory Map, L2: KV persistence)
  CORS:             Open (access control via session tokens, not CORS)

  Security Headers (applied to all responses):
    X-Content-Type-Options: nosniff
    X-Frame-Options: DENY
    Referrer-Policy: strict-origin-when-cross-origin
    Strict-Transport-Security: max-age=31536000; includeSubDomains
    Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
    Permissions-Policy: camera=(), microphone=(), geolocation=()


5.4  CONTEXT PROVIDERS
------------------------

  The React component tree is wrapped in nested providers:

  AppErrorBoundary
    > DynamicSDKWrapper
      > ThemeProvider (dark/light/sky mode + VIP accent toggle)
        > WalletProvider (HashPack + MetaMask + account state)
          > SigningProvider (global signing overlay with abort control)
            > RouterProvider (React Router Data mode)

  The SigningProvider deserves special mention: it wraps all wallet signing
  operations with a full-screen overlay showing a spinner, countdown timer,
  and cancel button. This replaced a previous "silent failure" UX where
  signing operations could hang without visual feedback.



================================================================================
  6. ORACLE PIPELINE: MULTI-SOURCE PRICE INTEGRITY
================================================================================

Wrappdex implements a three-tier oracle fallback chain to ensure price data
is always available and always trustworthy.


  TIER 1: CHAINLINK DECENTRALIZED ORACLES (Primary)
  ---------------------------------------------------
  
  Method:     Raw JSON-RPC eth_call to Aggregator V3 contracts on Ethereum
  Endpoint:   5 public RPC providers (publicnode, ankr, cloudflare, llama, 1rpc)
  Feeds:      16 price feeds (BTC, ETH, LINK, SOL, BNB, DOGE, ADA, DOT,
              AVAX, HBAR, XRP, LTC, USDT, USDC, TRX, SHIB)
  Resolution: latestRoundData() returns (roundId, answer, startedAt,
              updatedAt, answeredInRound) with 8-decimal precision
  Batching:   All feeds read in a single HTTP request via JSON-RPC batch
  Cache:      30-second TTL (matches dashboard/trading refresh cycle)
  
  No web3.js dependency. Raw eth_call with ABI selector 0xfeaf968c.

  
  TIER 2: COINCAP REST/WEBSOCKET API (Secondary)
  -------------------------------------------------
  
  Activated when Chainlink is unreachable or returns stale data.
  Provides real-time price and 24h change data.
  Also used for 7-day hourly sparkline history on dashboard ticker cards.


  TIER 3: COINGECKO REST API (Tertiary)
  ----------------------------------------
  
  Final fallback. Provides price, market cap, volume, and 24h change.
  Rate-limited but comprehensive coverage.


  PROVENANCE TRACKING
  --------------------
  
  Every price displayed in the UI carries an oracle source badge:
  
    [Blue dot]   Chainlink Oracle    -- decentralized, on-chain
    [Amber dot]  CoinCap API         -- centralized, real-time
    [Green dot]  CoinGecko API       -- centralized, rate-limited
    [Gray dot]   Cached              -- stale data, last known price

  This transparency allows users to assess data quality at a glance.
  The 24h percentage change field separately tracks its own source,
  since change data may come from a different tier than spot price.


  Oracle Pipeline Flow:
  
  +------------+     success     +----------+
  | Chainlink  | -------------> | Use Price |
  | (Tier 1)   |                +----------+
  +------------+
       | fail
       v
  +------------+     success     +----------+
  | CoinCap    | -------------> | Use Price |
  | (Tier 2)   |                +----------+
  +------------+
       | fail
       v
  +------------+     success     +----------+
  | CoinGecko  | -------------> | Use Price |
  | (Tier 3)   |                +----------+
  +------------+
       | fail
       v
  +-------------------------------------------+
  | Fallback: hardcoded last-known price      |
  | Badge: "Cached" (gray dot)                |
  +-------------------------------------------+



================================================================================
  7. THE WRAPPDEX AMM: SMART LIQUIDITY ENGINE
================================================================================

7.1  OVERVIEW
--------------

The Smart Liquidity Engine is Wrappdex's custom Automated Market Maker. All
pool state is persisted server-side in a KV store. The client module fetches
real pool data, requests server-computed swap quotes, and executes swaps that
atomically update reserves.

This architecture eliminates front-running: swap execution is deterministic,
atomic, and ordered by the server -- not by block producers.


7.2  CONSTANT-PRODUCT INVARIANT
---------------------------------

Each pool maintains the classic x * y = k invariant:

    Reserve_A * Reserve_B = k

When a trader swaps dx of Token A for dy of Token B:

    dy = (Reserve_B * dx * (10000 - feeBps)) / (Reserve_A * 10000 + dx * (10000 - feeBps))

The fee (measured in basis points) is deducted from the input amount before
the invariant calculation, ensuring LPs earn fees proportional to volume.


7.3  POOL STATE MODEL
-----------------------

  interface PoolState {
    id:                 string       // Unique pool identifier
    name:               string       // Human-readable name
    tokenA / tokenB:    string       // Token symbols
    tokenIdA / tokenIdB: string      // HTS token IDs
    decimalsA / decimalsB: number    // Token decimal precision
    reserveA / reserveB: string      // Raw reserve amounts (bigint strings)
    lpTotalSupply:      string       // Total LP shares outstanding
    swapFeeBps:         number       // Fee in basis points (e.g., 30 = 0.30%)
    creator:            string       // Hedera account that created the pool
    cumulativeVolumeUsd: number      // Lifetime volume
    swapCount:          number       // Total swaps executed
    status:             "active" | "paused"
    version:            number       // Optimistic lock version
  }


7.4  TOKEN WHITELIST (Tier 1)
-------------------------------

  +----------+------------------+----------+-------------------+
  | Symbol   | HTS Token ID     | Decimals | Bridge            |
  +----------+------------------+----------+-------------------+
  | WBTC     | 0.0.1969769      | 8        | HashPort          |
  | WETH     | 0.0.1969757      | 18       | HashPort          |
  | USDC     | 0.0.456858       | 6        | Native            |
  | USDT     | 0.0.4291336      | 6        | Native            |
  | LINK     | 0.0.1970030      | 8        | HashPort          |
  +----------+------------------+----------+-------------------+


7.5  SWAP QUOTE STRUCTURE
---------------------------

  interface SwapQuote {
    poolId:           string    // Which pool to route through
    tokenIn/Out:      string    // Token symbols
    amountIn/Out:     number    // Human-readable amounts
    amountInRaw/OutRaw: string  // Chain-precision amounts (bigint strings)
    route:            string    // Route description
    priceImpactBps:   number    // Price impact in basis points
    feeBps:           number    // Pool fee applied
    feeUsd:           number    // Fee in USD equivalent
    effectiveRate:    number    // Actual exchange rate received
    minAmountOut:     number    // After slippage protection
    routeCount:       number    // Number of hops
    inPrice/outPrice: number    // Oracle prices at quote time
  }

  Slippage protection: The client calculates minAmountOut as:
    minAmountOut = amountOut * (1 - slippageBps / 10000)
  
  If the execution price deviates beyond this threshold, the server
  rejects the swap and reserves are not modified.


7.6  LP POSITION MANAGEMENT
------------------------------

  When adding liquidity:
    - Both tokens must be deposited proportional to current reserves
    - LP shares minted = min(dx/Reserve_A, dy/Reserve_B) * lpTotalSupply
    - Position tracked: { poolId, accountId, shares, depositedAt }

  When removing liquidity:
    - Specify share percentage to withdraw (1-100%)
    - Token amounts returned: share_pct * Reserve_A, share_pct * Reserve_B
    - LP shares burned proportionally

  Impermanent Loss:
    As with all constant-product AMMs, LPs face impermanent loss when
    token prices diverge. Wrappdex displays this risk clearly in the UI
    and provides oracle-priced TVL calculations so LPs can make informed
    decisions.


  LP Share Calculation:
  
  +------------------------------------------------------------+
  |                                                              |
  |  User deposits: 0.1 WBTC + 9,784.50 USDC                  |
  |                                                              |
  |  Pool reserves: 2.5 WBTC + 244,612 USDC                    |
  |  LP total supply: 1,000,000 shares                          |
  |                                                              |
  |  Share ratio = min(0.1/2.5, 9784.5/244612)                 |
  |              = min(0.04, 0.04)                               |
  |              = 0.04 (4%)                                     |
  |                                                              |
  |  LP shares minted = 0.04 * 1,000,000 = 40,000 shares       |
  |                                                              |
  |  New reserves: 2.6 WBTC + 254,396.50 USDC                  |
  |  New LP supply: 1,040,000 shares                            |
  |                                                              |
  +------------------------------------------------------------+



================================================================================
  8. WEIGHTED POOL FACTORY (SOLIDITY)
================================================================================

8.1  OVERVIEW
--------------

Beyond the standard constant-product pools, Wrappdex supports user-created
weighted multi-token pools via a Solidity smart contract deployed on
Hedera's EVM equivalence layer.


8.2  CONTRACT SPECIFICATION
-----------------------------

  Contract:       HBARhWeightedPoolFactory
  Solidity:       ^0.8.19
  Inheritance:    Ownable, ReentrancyGuard, Pausable
  Token Safety:   SafeERC20 (handles non-standard return values)

  Constants:
    MAX_TOKENS_PER_POOL = 10
    MIN_TOKENS_PER_POOL = 2
    WEIGHT_SUM_BPS      = 10000 (100%)
    MIN_WEIGHT_BPS      = 100   (1%)

  Fee Structure:
    VIP holders (100M+ HBAR.h or VIP NFT): FREE pool creation
    Non-VIP users: $50 equivalent in HBAR.h to protocol treasury

  Treasury:  0.0.9695738 (immutable in contract -- prevents admin rug-pull)


8.3  AUDIT NOTES
------------------

  [A-01] ReentrancyGuard on createPool -- prevents reentrancy via
         malicious token transfer callbacks.
  [A-02] Pausable -- emergency stop for active exploits.
  [A-03] SafeERC20 -- handles non-standard ERC20 return values.
  [A-04] Weight validation -- enforces sum == 10000 bps on-chain.
  [A-05] Token whitelist -- only approved tokens allowed in pools.
  [A-06] Fee sent directly to treasury EOA -- no intermediate escrow.
  [A-07] Immutable treasury address -- prevents admin fee redirection.
  [A-08] Pool ID: keccak256(creator, block.number, nonce) --
         collision-resistant and deterministic.
  [A-09] Max 10 tokens per pool -- prevents gas DoS.
  [A-10] Min 2 tokens -- prevents degenerate single-token pools.
  [A-11] Fee amount is immutable once set by owner.
  [A-12] Events emitted for all state changes -- full off-chain indexing
         via Hedera Mirror Node.


8.4  WEIGHTED POOL MATHEMATICS
---------------------------------

  For a pool with n tokens, each with weight w_i and reserve R_i:

  Invariant:  PRODUCT(R_i ^ w_i) = k

  Swap output for input dx of token i, receiving dy of token j:

  dy = R_j * (1 - (R_i / (R_i + dx * (1 - fee)))^(w_i / w_j))

  This generalizes the constant-product formula to arbitrary weight
  distributions, enabling portfolio-like pools (e.g., 80/20 HBAR/USDC).



================================================================================
  9. SWAP EXECUTION ARCHITECTURE
================================================================================

Wrappdex supports multiple execution venues for swap operations:


9.1  SAUCERSWAP V1 (PRIMARY DEX)
-----------------------------------

  The primary swap path routes through SaucerSwap's V1 router, the largest
  DEX on Hedera by TVL. Wrappdex's integration includes:
  
  - RestrictedDexRouter contract: On-chain restricted swap executor that
    wraps SaucerSwap V1, only allowing pre-approved tokens
  - REST API integration: Quote estimation, pool data, live token prices
  - Multi-hop routing: Automatic path finding through intermediate pools
  - Resilient API client: Tries /tokens, /v1/tokens, /v2/tokens variants
    with automatic fallback

  Signing: All transactions are signed via HashPack using WalletConnect v2
  (hedera_signAndExecuteTransaction method per HIP-820).


9.2  HSUITE SMARTNODE AGGREGATION
------------------------------------

  For VIP trading terminal swaps, Wrappdex integrates HSuite's decentralized
  SmartNode network for DEX aggregation across:
  
  - SaucerSwap
  - Pangolin
  - HeliSwap
  
  HSuite SmartNodes provide optimal routing by comparing quotes across
  multiple venues and executing through the best available path.

  Docs: https://docs.hsuite.network/developers
  SDK:  https://github.com/HSuiteNetwork/smart-app


9.3  WRAP / UNWRAP (ZERO-FEE)
---------------------------------

  HBAR <-> WHBAR conversions are handled as direct wrap/unwrap operations
  at a 1:1 ratio with zero fees. The platform detects HBAR/WHBAR pairs
  automatically and bypasses the AMM routing entirely.


9.4  SMART LIQUIDITY ENGINE (NATIVE AMM)
-------------------------------------------

  For pools created through the Wrappdex Pool Factory, swaps execute
  against the server-authoritative constant-product engine described
  in Section 7.


  Execution Flow:
  
  User -> [Select Tokens] -> [Enter Amount]
       -> [Route Discovery] -> [Quote Calculation]
       -> [Slippage Check] -> [Build Transaction]
       -> [HashPack Sign] -> [On-Chain Execution]
       -> [Mirror Node Confirm] -> [UI Update]
       -> [History Logged] -> [Success Overlay]



================================================================================
  10. CROSS-CHAIN BRIDGE AGGREGATION
================================================================================

Wrappdex aggregates three cross-chain bridge protocols, each serving
different use cases:


  +--------------------------------------------------------------+
  |              BRIDGE COMPARISON MATRIX                         |
  +----------+----------+--------------+-------------------------+
  | Protocol | Chains   | Mechanism    | Best For                |
  +----------+----------+--------------+-------------------------+
  | Squid    | 60+      | Axelar GMP   | Multi-chain swaps,      |
  | (Axelar) |          |              | EVM-to-EVM transfers    |
  +----------+----------+--------------+-------------------------+
  | HashPort | Hedera + | Lock & Mint  | Hedera <-> Ethereum     |
  |          | EVM      | (audited)    | Official, enterprise    |
  +----------+----------+--------------+-------------------------+
  | Stargate | 15+      | LayerZero    | Instant finality,       |
  |(LayerZero|          | messaging    | unified liquidity       |
  +----------+----------+--------------+-------------------------+

Each bridge is presented in a dedicated widget with consistent glass-morphism
styling, feature badges, and accent colors that match the bridge's brand.



================================================================================
  11. DeFi SUITE: LENDING, BORROWING & STAKING
================================================================================

11.1  BONZO FINANCE INTEGRATION (LENDING / BORROWING)
------------------------------------------------------

  Protocol:   Bonzo Finance (bonzo.finance)
  Fork:       Aave V2 on Hedera Mainnet
  Contract:   Bonzo Finance Contracts (GitHub: Bonzo-Labs/bonzo-finance-contracts)
  
  Data Pipeline:
    A. Bonzo Data API (https://mainnet-data-staging.bonzo.finance/) [primary]
    B. Mirror Node -> ProtocolDataProvider.getReserveData(asset)    [fallback]
    C. Defaults: markets shown with null rates, labeled "awaiting data"

  Supported Markets:
    +--------+-------------------+
    | Asset  | HTS Token ID      |
    +--------+-------------------+
    | HBAR   | native            |
    | USDC   | 0.0.456858        |
    | WBTC   | 0.0.1969769       |
    | WETH   | 0.0.1969757       |
    | LINK   | 0.0.1970030       |
    | BONZO  | (Bonzo native)    |
    +--------+-------------------+

  Features:
    - Supply/Withdraw flows with amount validation
    - Borrow/Repay flows with health factor monitoring
    - Real-time APY display (supply + borrow rates)
    - Health factor gauge with liquidation warning
    - Deep-links to Bonzo's native lending app


11.2  LIQUIDITY POOLS
-----------------------

  16 SaucerSwap pools tracked with live metrics:

  +-------------------+------------+---------+-------+------+
  | Pair              | TVL        | 24h Vol | APR   | Fee  |
  +-------------------+------------+---------+-------+------+
  | WHBAR / USDC      | $18.42M    | $3.24M  | 24.5% | 0.3% |
  | WHBAR / WETH      | $12.80M    | $2.15M  | 18.2% | 0.3% |
  | WHBAR / WBTC      | $9.65M     | $1.89M  | 15.8% | 0.3% |
  | USDC / USDT       | $8.91M     | $2.18M  | 8.4%  | 0.01%|
  | WHBAR / USDT      | $6.20M     | $1.45M  | 18.3% | 0.3% |
  | WHBAR / HBAR.h    | $5.63M     | $0.89M  | 12.8% | 0.05%|
  | WHBAR / HBARX     | $5.63M     | $0.89M  | 12.8% | 0.05%|
  | WHBAR / SAUCE     | $4.12M     | $1.56M  | 38.2% | 0.3% |
  | WETH / USDC       | $3.45M     | $0.89M  | 14.2% | 0.3% |
  | WHBAR / LINK      | $2.34M     | $0.78M  | 18.7% | 0.3% |
  | WBTC / USDC       | $2.10M     | $0.56M  | 12.0% | 0.3% |
  | WHBAR / KARATE    | $1.84M     | $0.62M  | 52.1% | 1.0% |
  | SAUCE / USDC      | $1.56M     | $0.42M  | 28.5% | 0.3% |
  | WHBAR / PACK      | $0.92M     | $0.34M  | 31.6% | 0.3% |
  | WHBAR / HST       | $0.68M     | $0.21M  | 26.4% | 0.3% |
  | WHBAR / DOVU      | $0.42M     | $0.10M  | 22.0% | 0.3% |
  +-------------------+------------+---------+-------+------+
  | TOTAL TVL         | ~$84.67M   |         |       |      |
  +-------------------+------------+---------+-------+------+


11.3  STAKING
--------------

  The staking module provides a backend plugin interface with structurally
  defined pools matching the liquidity pool token roster. Metric fields
  (APY, totalStaked, rewards) are nullable by design -- they display
  "Pending" badges until a production staking contract is connected.



================================================================================
  12. GOVERNANCE: THE HBAR.h DAO
================================================================================

12.1  ARCHITECTURE
-------------------

  All governance state lives server-side in the KV store. This includes
  proposals, votes, comments, and admin configurations. The client is
  purely a rendering layer -- it cannot fabricate votes or modify proposals
  without passing server-side authentication and eligibility checks.

  Authoritative source of truth: Hedera Mirror Node.
  Every vote cast triggers a server-side balance verification.


12.2  ELIGIBILITY & VOTING POWER
-----------------------------------

  Gate Threshold:     100,000,000 HBAR.h tokens (decimals-adjusted)
  Alternative Gate:   1+ VIP NFT (Token ID: 0.0.10146181)
  Either qualifies -- both are NOT required.

  Voting Power Calculation:
  
    Token Votes = floor(HBAR.h_balance / 100,000,000)  [max 10]
    NFT Votes   = floor(VIP_NFT_count / 3)             [max 1]
    Total Votes = Token Votes + NFT Votes               [max 11]

  This creates a balanced governance model where large holders have
  meaningful influence but cannot dominate. The NFT vote adds a
  "skin in the game" dimension beyond pure token accumulation.


12.3  PROPOSAL LIFECYCLE
--------------------------

  1. CREATION:    Admin or eligible user submits proposal with title,
                  description, category, and voting duration (3-14 days).
  2. ACTIVE:      Community votes (For/Against) during the voting window.
  3. RESOLUTION:  Proposal auto-resolves as Passed or Rejected based on
                  vote totals when the duration expires.

  Categories: Fees, Staking, Listing, Tokenomics, Features, Partnership,
              Governance, Other


12.4  ADMIN SYSTEM
-------------------

  Founder:           0.0.518487 (hardcoded, always admin)
  Dynamic Admins:    Server-managed list, modifiable by founder
  Admin Privileges:  Create/Edit/Delete proposals, manage admin list
  Authentication:    ED25519 session token required for all mutations


12.5  PRIZE SPIN WHEEL
------------------------

  Integrated into the DAO page, the Spin Wheel is a VIP engagement feature:

  - Outcome: Server-determined via CSPRNG (crypto.getRandomValues)
  - Win Rate: 2% (uniform for all wallets -- no hidden advantages)
  - Cooldown: 24 hours (server-enforced via KV, not localStorage)
  - Prize: HBAR.h token ticket (ticket ID generated server-side)
  - Cosmetics: Fireworks animation, confetti, and celebration sounds
    use Math.random() (cosmetic only -- outcomes are never client-determined)



================================================================================
  13. VIP SYSTEM: TOKEN-GATED PREMIUM ACCESS
================================================================================

13.1  ELIGIBILITY
------------------

  Two paths to VIP status (either qualifies):
  
  Path A:  Hold >= 100,000,000 HBAR.h display tokens
           (Token ID: 0.0.9356476, 8 decimal places)
  
  Path B:  Hold >= 1 VIP NFT
           (Token ID: 0.0.10146181)

  Verification is double-checked:
    1. Fast path: WalletContext cached token list (instant UI update)
    2. Authoritative: Direct Mirror Node API call (server-verified)


13.2  VIP FEATURES
-------------------

  1. EMERALD IRIDESCENT THEME
     Green-to-teal gradient replaces the default pink/purple accent across
     navigation, buttons, cards, and borders. Applied via CSS class on the
     <html> element, toggled from the VIP Panel.

  2. PREMIUM SOUND FX
     - Cash register on successful trades
     - Sparkle confirmations on VIP actions
     - Premium interaction sounds throughout the interface
     - Integrated with the 4-level volume system (Off/Low/Med/High)

  3. IRIDESCENT GLOW BACKGROUND
     Animated color-shifting glow on the page background and card borders.
     Creates a distinct visual identity for VIP sessions.

  4. TRADING TERMINAL ACCESS
     The full CEX-style trading terminal (/trading route) is VIP-gated.
     Non-VIP users see a VIPAccessGate component explaining requirements.

  5. VIP CHAT
     Emerald glass-morphism chat room. 25-word limit per message, 2-minute
     cooldown between sends. Server-verified VIP status on every message.

  6. PRIZE SPIN WHEEL
     VIP-only access to the DAO page spin wheel with 2% win rate.

  7. CROWN SHIMMER HOVER
     CSS hover effect on VIP badges and crown icons.


13.3  VIP PREFERENCES
-----------------------

  VIP features are individually toggleable via the VIP Panel:
  
    { active: boolean,           // Master VIP toggle
      features: {
        vip_theme:  boolean,     // Emerald gradient
        vip_sounds: boolean,     // Premium SFX
        vip_glow:   boolean      // Iridescent background
      }
    }
  
  Preferences are stored in localStorage (cosmetic-only). Gate enforcement
  is always server-side.



================================================================================
  14. SECURITY ARCHITECTURE
================================================================================

14.1  AUTHENTICATION: ED25519 CHALLENGE-RESPONSE
---------------------------------------------------

  Wrappdex uses a cryptographic authentication protocol where the private
  key never leaves the wallet:

  Step 1: Client requests a challenge from the server.
  Step 2: Server generates a CSPRNG nonce and stores it in KV with a TTL.
  Step 3: Client presents the challenge message to the wallet for signing.
  Step 4: Wallet signs the message with the user's ED25519 private key.
  Step 5: Client sends the signature back to the server.
  Step 6: Server verifies the signature against the account's public key
          (retrieved from Hedera Mirror Node).
  Step 7: Server issues a session token (30-minute TTL, KV-backed).
  Step 8: All subsequent authenticated requests include the session token.

  Session tokens have a 2-minute safety margin: the client refreshes 2
  minutes before actual expiry to prevent mid-operation expirations.


  Authentication Flow:
  
  Client                    Server                    Mirror Node
    |                         |                           |
    |-- POST /challenge ----->|                           |
    |                         |-- Generate CSPRNG nonce   |
    |                         |-- Store in KV (TTL)       |
    |<-- { challengeId,       |                           |
    |      message } ---------|                           |
    |                         |                           |
    |-- [Wallet Signs] ------>|                           |
    |                         |                           |
    |-- POST /verify -------->|                           |
    |   { challengeId,        |-- GET /accounts/{id} --->|
    |     signature }         |<-- { key: ED25519 } -----|
    |                         |                           |
    |                         |-- Verify signature        |
    |                         |-- Issue session token     |
    |                         |-- Store in KV (30 min)    |
    |                         |                           |
    |<-- { sessionToken } ----|                           |


14.2  RATE LIMITING
---------------------

  Dual-layer rate limiting protects all server endpoints:

  L1 (Hot Path):   In-memory Map with periodic eviction when size
                   exceeds 10,000 entries. Covers warm instances.
  
  L2 (Persistent): KV-backed counters that survive cold starts and
                   multi-instance deployments.

  Configuration:
    Window:     60 seconds
    Max:        10 requests per IP per window
    Response:   HTTP 429 with "Rate limited" message


14.3  INPUT SANITIZATION
--------------------------

  All user input is sanitized before processing:
  
  1. Unicode NFC normalization
  2. Strip HTML entities: < > " ' &
  3. Strip control characters (0x00-0x1F, 0x7F)
  4. Strip zero-width characters (U+200B-U+200D, U+2060, U+FEFF)
  5. Strip bidirectional override characters (text direction spoofing)
  6. Strip stacked combining diacritical marks (homoglyph attacks)
  7. Length truncation to per-field maximums

  Hedera account IDs are validated against the pattern: /^0\.0\.\d{1,10}$/


14.4  TRANSPORT SECURITY
--------------------------

  - HSTS with 1-year max-age and includeSubDomains
  - CSP: default-src 'none'; frame-ancestors 'none'
  - X-Frame-Options: DENY (prevents clickjacking)
  - Permissions-Policy: camera=(), microphone=(), geolocation=()
  - No cookies: authentication is token-based via Authorization header
  - SUPABASE_SERVICE_ROLE_KEY is server-only -- never exposed to client


14.5  WALLET SECURITY
-----------------------

  - WalletConnect v2 with relay-wait before any RPC call
  - Session validation on every signing operation
  - SigningContext provides visual feedback + abort control
  - WalletConnect Health Report available on /audit page
  - Stale session detection with auto-reconnect



================================================================================
  15. TOKENOMICS: HBAR.h PROTOCOL TOKEN
================================================================================

15.1  TOKEN DETAILS
---------------------

  +----------------------------+-----------------------------+
  | Parameter                  | Value                       |
  +----------------------------+-----------------------------+
  | Token Name                 | HBAR.h                      |
  | HTS Token ID               | 0.0.9356476                 |
  | Decimal Precision          | 8                           |
  | Network                    | Hedera Mainnet              |
  | Token Standard             | HTS (Hedera Token Service)  |
  | Treasury Account           | 0.0.9695738                 |
  | LP Pool (WHBAR/HBAR.h)     | SaucerSwap V1               |
  | LP Token ID                | 0.0.9356724                 |
  +----------------------------+-----------------------------+


15.2  UTILITY FUNCTIONS
-------------------------

  The HBAR.h token serves multiple functions within the Wrappdex ecosystem:

  1. GOVERNANCE WEIGHT
     100M tokens = 1 DAO vote (max 10 votes per wallet).
     Voting power is verified server-side via Mirror Node on every cast.

  2. VIP ACCESS GATE
     100M+ tokens unlock the premium feature suite (trading terminal,
     VIP chat, spin wheel, emerald theme, premium SFX).

  3. POOL CREATION FEE
     Non-VIP users pay $50 in HBAR.h to create weighted pools via the
     Pool Factory contract. VIP holders create pools for free.

  4. PROTOCOL FEE SINK
     Pool creation fees flow directly to the treasury account (0.0.9695738).

  5. LIQUIDITY PAIRING
     WHBAR/HBAR.h is a primary SaucerSwap V1 pool with dedicated
     liquidity, enabling direct market access for the token.

  6. VIP NFT ALTERNATIVE
     Holders of VIP NFTs (0.0.10146181) receive equivalent VIP access,
     creating a secondary demand vector and collector market.


15.3  TOKEN DISTRIBUTION PHILOSOPHY
--------------------------------------

  The HBAR.h token is designed around sustained engagement rather than
  speculative accumulation. The 100M threshold for VIP access creates
  a meaningful commitment requirement, while the DAO voting power cap
  of 10 votes per wallet prevents plutocratic governance capture.

  The dual-path VIP qualification (tokens OR NFTs) ensures that
  governance participants can choose their level of commitment:
  
  - Token holders demonstrate ongoing economic alignment
  - NFT holders demonstrate community participation and identity

  Neither path is privileged over the other -- both receive identical
  VIP benefits and both contribute to governance.



================================================================================
  16. REVENUE MODEL & GROWTH PATHWAYS
================================================================================

16.1  CURRENT REVENUE STREAMS
---------------------------------

  +-------------------------------+------------------------------------------+
  | Stream                        | Mechanism                                |
  +-------------------------------+------------------------------------------+
  | Pool Creation Fees            | $50 in HBAR.h per weighted pool          |
  |                               | (non-VIP users) -> treasury              |
  +-------------------------------+------------------------------------------+
  | AMM Swap Fees                 | 5-100 bps per swap (pool-configurable)   |
  |                               | Accrues to LP providers                  |
  +-------------------------------+------------------------------------------+
  | Protocol Fee Share            | Configurable % of swap fees              |
  |                               | routable to treasury (DAO-governed)      |
  +-------------------------------+------------------------------------------+
  | ChangeNOW Affiliate           | Partner referral revenue from fiat       |
  |                               | on-ramp transactions                     |
  +-------------------------------+------------------------------------------+


16.2  GROWTH PATHWAY: PHASE 1 -- LIQUIDITY DEPTH
---------------------------------------------------

  Objective: Achieve $100M+ TVL across all pools.

  Strategy:
  - Incentivize LP provision with competitive APR structures
  - Deploy the WHBAR/HBAR.h pool as a flywheel: deeper liquidity
    reduces slippage, attracting more volume, generating more fees,
    attracting more LPs
  - Expand the Tier 1 token whitelist based on DAO governance proposals
  - Integrate real-time pool metrics from SaucerSwap API for
    transparent APR calculation


16.3  GROWTH PATHWAY: PHASE 2 -- PROTOCOL REVENUE
----------------------------------------------------

  Objective: Sustainable protocol-level revenue generation.

  Strategy:
  - Enable a configurable protocol fee (e.g., 5-10 bps) on all AMM
    swaps, governed by DAO vote
  - Pool creation fees scale with pool complexity (more tokens = higher fee)
  - Premium API access for institutional traders (historical data,
    real-time WebSocket feeds, priority execution)
  - White-label licensing of the Wrappdex UI and AMM engine for other
    Hedera ecosystem projects


16.4  GROWTH PATHWAY: PHASE 3 -- ECOSYSTEM EXPANSION
------------------------------------------------------

  Objective: Become the default DeFi hub on Hedera.

  Strategy:
  - HSuite SmartNode deep integration for DEX aggregation across all
    Hedera DEXes (SaucerSwap, Pangolin, HeliSwap)
  - Launch native staking contracts with auto-compounding
  - Deploy Bonzo Finance lending markets for HBAR.h token
  - Expand bridge aggregation (Wormhole, deBridge, Router Protocol)
  - Mobile-optimized progressive web app (current PWA foundation
    includes pull-to-refresh, scroll-to-top, bottom navigation,
    touch-optimized interactions)


16.5  GROWTH PATHWAY: PHASE 4 -- INSTITUTIONAL ADOPTION
---------------------------------------------------------

  Objective: Attract institutional capital and enterprise partnerships.

  Strategy:
  - SOC 2 Type II compliance for the edge function infrastructure
  - Multi-sig treasury management via Hedera's native threshold keys
  - Formal smart contract audit (Certik / Halborn / Trail of Bits)
  - Institutional API with SLA guarantees and dedicated support
  - EURC (Euro stablecoin) and PAXG (gold-backed) pool expansion
    for institutional hedging strategies
  - Regulatory-compliant fiat on/off-ramp partnerships


16.6  PROJECTED REVENUE MODEL
-------------------------------

  Assumptions:
  - $100M TVL average across all pools
  - $5M daily swap volume
  - 5 bps protocol fee on swaps
  - 10 pool creations per month (non-VIP)

  Annual Revenue Estimate:

  +-----------------------------+-------------------+
  | Source                      | Annual Revenue    |
  +-----------------------------+-------------------+
  | Protocol Swap Fees          | $912,500          |
  |  ($5M * 0.0005 * 365)      |                   |
  +-----------------------------+-------------------+
  | Pool Creation Fees          | $6,000            |
  |  (10 * $50 * 12)           |                   |
  +-----------------------------+-------------------+
  | Fiat On-Ramp Affiliate      | ~$50,000          |
  |  (estimated partner share) |                   |
  +-----------------------------+-------------------+
  | Premium API (Phase 3)       | ~$200,000         |
  |  (institutional tier)      |                   |
  +-----------------------------+-------------------+
  | TOTAL (conservative)        | ~$1,168,500       |
  +-----------------------------+-------------------+

  These projections scale linearly with TVL and volume growth. At $500M
  TVL and $25M daily volume (achievable with institutional adoption in
  Phase 4), annual protocol revenue exceeds $5M.



================================================================================
  17. ROADMAP
================================================================================

  Q1 2026 (Current)
  -----------------
  [x] Production AMM with KV-backed state
  [x] Chainlink + CoinCap + CoinGecko oracle pipeline
  [x] SaucerSwap swap integration with route visualization
  [x] ED25519 challenge-response authentication
  [x] DAO with weighted voting and proposal management
  [x] VIP token-gated system with NFT alternative
  [x] Cross-chain bridges (Squid, HashPort, Stargate)
  [x] Bonzo Finance lending/borrowing integration
  [x] Professional charting with 6 indicators + drawing tools
  [x] Security audit page with WalletConnect Health Report
  [x] Mobile-optimized with pull-to-refresh, bottom nav, responsive layout
  [x] 4-level volume system, micro-interactions, animated numbers
  [x] Performance monitoring (Web Vitals, route timing)
  [x] Service health checks with degradation detection

  Q2 2026
  --------
  [ ] Formal smart contract audit (Certik or equivalent)
  [ ] HSuite SmartNode production integration
  [ ] Native staking contracts deployment
  [ ] HBAR.h lending market on Bonzo Finance
  [ ] Advanced order types (limit orders via HSuite)
  [ ] Portfolio analytics with P&L tracking

  Q3 2026
  --------
  [ ] Institutional API with WebSocket feeds
  [ ] Multi-sig treasury management
  [ ] Additional bridge integrations (Wormhole, deBridge)
  [ ] Automated yield strategies (auto-compound, rebalance)
  [ ] Mobile app (React Native with shared component library)

  Q4 2026
  --------
  [ ] Regulatory compliance framework
  [ ] Enterprise partnerships
  [ ] Cross-chain liquidity aggregation
  [ ] Layer 2 scaling exploration on Hedera



================================================================================
  18. TECHNICAL APPENDICES
================================================================================

APPENDIX A: FULL TECH STACK FLOW
-----------------------------------

  +-----------------------------------------------------------------+
  |                     USER INTERACTION LAYER                       |
  +-----------------------------------------------------------------+
  |                                                                   |
  |  Browser (Chrome/Firefox/Safari/Edge)                            |
  |    |                                                              |
  |    +-> React 18.3.1                                              |
  |    |     +-> React Router v7 (Data mode, lazy routes)            |
  |    |     +-> Motion v12+ (AnimatePresence, spring physics)       |
  |    |     +-> Radix UI (tooltip, dialog, sheet, accordion...)     |
  |    |     +-> Sonner (toast notifications)                        |
  |    |     +-> Lucide React (icon system)                          |
  |    |                                                              |
  |    +-> Tailwind CSS v4.1 (JIT, custom properties, dark mode)     |
  |    |     +-> Fluid typography via clamp() custom properties       |
  |    |     +-> Glass-morphism design system                         |
  |    |     +-> VIP emerald theme (CSS class toggle on <html>)       |
  |    |                                                              |
  |    +-> lightweight-charts v5.1 (TradingView)                     |
  |    |     +-> Candlestick + Line + Area series                     |
  |    |     +-> SMA, EMA, RSI, MACD, Bollinger Bands overlays       |
  |    |     +-> Drawing tools (trendline, horizontal, ray, fibo)     |
  |    |     +-> localStorage persistence for drawings                |
  |    |                                                              |
  |    +-> recharts v2.15 (portfolio pie chart)                      |
  |    +-> qrcode.react (wallet QR display)                          |
  |                                                                   |
  +-----------------------------------------------------------------+
  |                     WALLET CONNECTION LAYER                       |
  +-----------------------------------------------------------------+
  |                                                                   |
  |  HashPack (Hedera)                                               |
  |    +-> WalletConnect v2 SignClient                               |
  |    |     +-> @walletconnect/sign-client v2.23                    |
  |    |     +-> @walletconnect/modal v2.7                           |
  |    |     +-> HIP-820 namespace (hedera:mainnet / hedera:testnet) |
  |    |     +-> Methods: signTransaction, signAndExecute, signMsg   |
  |    |                                                              |
  |  MetaMask (EVM)                                                  |
  |    +-> Native EIP-1193 (window.ethereum)                        |
  |    +-> viem v2.45 (transaction building)                         |
  |    +-> Multi-chain: Ethereum, Polygon, Arbitrum, Base, etc.      |
  |                                                                   |
  |  Dynamic Labs SDK v4.61                                          |
  |    +-> Multi-wallet orchestration                                |
  |    +-> Lazy-loaded via DynamicSDKWrapper                         |
  |                                                                   |
  +-----------------------------------------------------------------+
  |                     DATA LAYER                                    |
  +-----------------------------------------------------------------+
  |                                                                   |
  |  Chainlink Oracles (16 feeds, Ethereum Mainnet)                  |
  |    +-> Raw JSON-RPC batch via 5 public RPC endpoints             |
  |    +-> ABI: latestRoundData() -> 8-decimal USD prices            |
  |                                                                   |
  |  CoinCap API (REST + historical)                                 |
  |    +-> Real-time prices + 24h change                             |
  |    +-> 7-day hourly history for sparklines                       |
  |                                                                   |
  |  CoinGecko API (REST)                                            |
  |    +-> Price, market cap, volume, 24h change                     |
  |    +-> Token logos                                                |
  |                                                                   |
  |  SaucerSwap API (REST)                                           |
  |    +-> Pool data, token prices, swap quotes                      |
  |    +-> Resilient client: tries /, /v1/, /v2/ path variants       |
  |                                                                   |
  |  DexScreener API                                                 |
  |    +-> HBAR.h live price + price history                         |
  |                                                                   |
  |  Hedera Mirror Node                                              |
  |    +-> Account info, token balances, transaction history         |
  |    +-> VIP eligibility verification                              |
  |    +-> NFT count validation                                      |
  |                                                                   |
  |  Alternative.me API                                              |
  |    +-> Fear & Greed Index                                        |
  |                                                                   |
  +-----------------------------------------------------------------+
  |                     SERVER LAYER                                  |
  +-----------------------------------------------------------------+
  |                                                                   |
  |  Supabase Edge Functions (Deno Runtime)                          |
  |    +-> Hono v4.6.3 web framework                                |
  |    +-> KV Store (all persistent state)                           |
  |    +-> CORS: open (auth via session tokens)                      |
  |                                                                   |
  |  Server Modules:                                                 |
  |    +-> Auth:    ED25519 challenge-response, 30-min sessions      |
  |    +-> AMM:     Constant-product pools, swap execution           |
  |    +-> DAO:     Proposals, votes, comments, admin mgmt           |
  |    +-> Spin:    CSPRNG outcomes, 24h cooldown, ticket gen        |
  |    +-> Chat:    VIP messages, 25-word limit, 2-min cooldown      |
  |    +-> News:    Cached crypto headlines, 10-min TTL              |
  |    +-> Pools:   Pool CRUD, LP positions, oracle refresh          |
  |                                                                   |
  |  Security:                                                       |
  |    +-> Rate limiting (L1: in-memory + L2: KV)                   |
  |    +-> Input sanitization (Unicode, BiDi, control chars)         |
  |    +-> CSP, HSTS, X-Frame-Options, Permissions-Policy            |
  |                                                                   |
  +-----------------------------------------------------------------+
  |                     BLOCKCHAIN LAYER                              |
  +-----------------------------------------------------------------+
  |                                                                   |
  |  Hedera Hashgraph (Mainnet)                                      |
  |    +-> HTS (Hedera Token Service)                                |
  |    |     +-> HBAR.h: 0.0.9356476 (8 decimals)                   |
  |    |     +-> VIP NFT: 0.0.10146181                               |
  |    |     +-> USDC: 0.0.456858, USDT: 0.0.4291336               |
  |    |     +-> WBTC: 0.0.1969769, WETH: 0.0.1969757              |
  |    |     +-> LINK: 0.0.1970030                                   |
  |    |                                                              |
  |    +-> HCS (Hedera Consensus Service) [future]                   |
  |    +-> EVM Equivalence (Solidity contracts)                      |
  |    |     +-> HBARhWeightedPoolFactory                            |
  |    |     +-> RestrictedDexRouter                                  |
  |    |                                                              |
  |    +-> Mirror Node (REST API)                                    |
  |    +-> 10,000+ TPS, 3-5s finality, sub-cent fees                |
  |                                                                   |
  |  HSuite Smart Nodes                                              |
  |    +-> Decentralized validator network                           |
  |    +-> DEX aggregation (SaucerSwap + Pangolin + HeliSwap)        |
  |    +-> NFT-gated validator access                                 |
  |                                                                   |
  +-----------------------------------------------------------------+


APPENDIX B: SUPPORTED TOKEN REGISTRY
---------------------------------------

  20 tokens tracked across Dashboard and Trading views:

  BTC, ETH, USDT, BNB, SOL, USDC, USDCh (Hedera), EURC, PAXG, XRP,
  HBAR, DOGE, ADA, AVAX, TRX, TON, LINK, SHIB, DOT, LTC

  Plus: HBAR.h (protocol token) with live DexScreener pricing.


APPENDIX C: HEDERA NETWORK ADVANTAGES
-----------------------------------------

  Why Hedera for a DEX:

  1. THROUGHPUT:  10,000+ TPS (vs Ethereum ~15 TPS, Solana ~65K claimed
                  but ~1,500 non-vote)
  2. FINALITY:    3-5 seconds, mathematically provable (aBFT consensus)
  3. FEES:        $0.0001 per transaction (vs Ethereum $1-50 gas)
  4. ORDERING:    Fair, consensus-timestamped (no MEV, no front-running)
  5. GOVERNANCE:  Hedera Governing Council (Google, IBM, Boeing, etc.)
  6. EVM:         Full EVM equivalence for Solidity smart contracts
  7. NATIVE:      HTS tokens don't require smart contracts (lower cost,
                  higher throughput than ERC-20)
  8. STAKING:     Native HBAR staking with network reward distribution


APPENDIX D: API ENDPOINT REFERENCE
--------------------------------------

  Base URL: https://{project}.supabase.co/functions/v1/make-server-54299934

  Public Endpoints:
    GET  /health                Health check
    GET  /winners               Spin wheel winner history
    GET  /news                  Cached crypto headlines
    GET  /pools                 AMM pool list with stats
    GET  /pool/:id              Individual pool details

  Authenticated Endpoints (require session token):
    POST /challenge             Request auth challenge
    POST /verify                Verify signed challenge
    POST /spin                  Execute spin wheel
    POST /swap                  Execute AMM swap
    POST /pools                 Create new pool
    POST /add-liquidity         Add LP to pool
    POST /remove-liquidity      Remove LP from pool
    POST /dao/proposals         Create proposal
    POST /dao/vote              Cast DAO vote
    POST /dao/comment           Add proposal comment
    POST /chat/send             Send VIP chat message
    GET  /chat/messages         Fetch VIP chat history


APPENDIX E: GLOSSARY
-----------------------

  AMM       Automated Market Maker
  bps       Basis points (1 bps = 0.01%)
  CSPRNG    Cryptographically Secure Pseudo-Random Number Generator
  CSP       Content Security Policy
  DAO       Decentralized Autonomous Organization
  DEX       Decentralized Exchange
  ED25519   Edwards-curve Digital Signature Algorithm (256-bit)
  EVM       Ethereum Virtual Machine
  HCS       Hedera Consensus Service
  HIP-820   Hedera Improvement Proposal for WalletConnect integration
  HSTS      HTTP Strict Transport Security
  HTS       Hedera Token Service
  KV        Key-Value (store)
  LP        Liquidity Provider
  MEV       Maximal Extractable Value
  SMA       Simple Moving Average
  EMA       Exponential Moving Average
  RSI       Relative Strength Index
  MACD      Moving Average Convergence Divergence
  TVL       Total Value Locked
  WHBAR     Wrapped HBAR (HTS equivalent of native HBAR)
  WC        WalletConnect



================================================================================
  19. PITCH DECK SLIDE REFERENCE INDEX
================================================================================

This index maps each pitch deck slide to its corresponding Wrapp Paper
section(s), ensuring investors and partners can cross-reference claims
with full technical backing. Slide numbers reference the current HBAR.h /
Wrappdex investor pitch deck.

  +-------+--------------------------------------+-----------------------------+
  | Slide | Deck Title / Topic                   | Wrapp Paper Section(s)      |
  +-------+--------------------------------------+-----------------------------+
  |   1   | Title / Brand Identity               | Cover Page, S1 Letter       |
  |       | "Wrappdex - Institutional-Grade       | to Traders                  |
  |       |  DEX on Hedera"                       |                             |
  +-------+--------------------------------------+-----------------------------+
  |   2   | The Problem                          | S1 (pain points: slippage,  |
  |       | Fragmented DeFi, high fees,          | congestion, bridge risk),   |
  |       | MEV exploitation, poor UX            | Appendix C (Hedera vs ETH)  |
  +-------+--------------------------------------+-----------------------------+
  |   3   | The Solution                         | S2 Executive Summary,       |
  |       | Single-pane DeFi hub on Hedera       | S3 Platform Overview        |
  +-------+--------------------------------------+-----------------------------+
  |   4   | Market Opportunity                   | S16.6 Projected Revenue,    |
  |       | Hedera TVL growth, DeFi TAM          | S11.2 LP Pool Table ($84M+  |
  |       |                                      | TVL tracked)                |
  +-------+--------------------------------------+-----------------------------+
  |   5   | Product Demo / Screenshots           | S3 (all 8 modules),         |
  |       | Dashboard, Trading, Swap, DeFi       | S4 User Guide               |
  +-------+--------------------------------------+-----------------------------+
  |   6   | How It Works (Swap Flow)             | S9 Swap Execution,          |
  |       | Route discovery -> execution         | S4.2 Executing a Swap       |
  +-------+--------------------------------------+-----------------------------+
  |   7   | AMM / Liquidity Engine               | S7 Smart Liquidity Engine,  |
  |       | Constant-product, KV-backed pools    | S7.2 Math, S7.6 LP Shares   |
  +-------+--------------------------------------+-----------------------------+
  |   8   | Weighted Pool Factory                | S8 Weighted Pool Factory,   |
  |       | Solidity contract, audit notes       | S8.3 Audit Notes (A-01      |
  |       |                                      | through A-12)               |
  +-------+--------------------------------------+-----------------------------+
  |   9   | Oracle Pipeline                      | S6 Oracle Pipeline,         |
  |       | Chainlink -> CoinCap -> CoinGecko    | S6 Provenance Tracking      |
  +-------+--------------------------------------+-----------------------------+
  |  10   | Cross-Chain Bridges                  | S10 Bridge Aggregation,     |
  |       | Squid + HashPort + Stargate          | S10 Comparison Matrix       |
  +-------+--------------------------------------+-----------------------------+
  |  11   | DeFi Ecosystem                       | S11 DeFi Suite,             |
  |       | Pools, Lending (Bonzo), Staking      | S11.1 Bonzo Integration,    |
  |       |                                      | S11.2 Pool Table            |
  +-------+--------------------------------------+-----------------------------+
  |  12   | Governance / DAO                     | S12 HBAR.h DAO,             |
  |       | Proposal system, weighted voting     | S12.2 Voting Power calc,    |
  |       |                                      | S12.5 Spin Wheel            |
  +-------+--------------------------------------+-----------------------------+
  |  13   | Tokenomics                           | S15 HBAR.h Protocol Token,  |
  |       | Token utility, distribution,         | S15.2 Utility Functions,    |
  |       | VIP gating                           | S13 VIP System              |
  +-------+--------------------------------------+-----------------------------+
  |  14   | Revenue Model                        | S16 Revenue Model,          |
  |       | Swap fees, pool creation,            | S16.1 Current Streams,      |
  |       | affiliate, API                       | S16.6 Projections           |
  +-------+--------------------------------------+-----------------------------+
  |  15   | Security                             | S14 Security Architecture,  |
  |       | Auth, rate limiting, CSP,            | S14.1 ED25519 Flow,         |
  |       | wallet safety                        | S14.3 Input Sanitization    |
  +-------+--------------------------------------+-----------------------------+
  |  16   | Tech Stack                           | S5 Architecture,            |
  |       | React + Hedera + Supabase + WC v2    | Appendix A Full Stack Flow  |
  +-------+--------------------------------------+-----------------------------+
  |  17   | Competitive Landscape                | Appendix C Hedera Network   |
  |       | vs Uniswap, vs SaucerSwap,           | Advantages, S2 Key          |
  |       | vs Pangolin                          | Differentiators             |
  +-------+--------------------------------------+-----------------------------+
  |  18   | Growth Strategy / Roadmap            | S16.2-16.5 Growth Pathways, |
  |       | 4-phase expansion plan               | S17 Roadmap                 |
  +-------+--------------------------------------+-----------------------------+
  |  19   | Team & Advisors                      | S20 Team, Advisors &        |
  |       | Founders, engineers, advisors        | Contributors                |
  +-------+--------------------------------------+-----------------------------+
  |  20   | The Ask / Call to Action              | S16.6 Projected Revenue,    |
  |       | Investment terms, use of funds       | S17 Roadmap, S2 Summary     |
  +-------+--------------------------------------+-----------------------------+


19.1  SLIDE-TO-SECTION QUICK REFERENCE (for presentations)
------------------------------------------------------------

  When presenting to investors, use these callouts to anchor each slide
  in the Wrapp Paper:

  "As detailed in Section 7.2 of the Wrapp Paper, our AMM uses the
   constant-product invariant with server-authoritative state..."

  "Section 14 documents our full security architecture, including the
   ED25519 challenge-response flow diagrammed on page..."

  "The revenue projections in Section 16.6 are based on conservative
   $100M TVL assumptions, scaling linearly with volume..."

  This cross-referencing demonstrates technical rigor and gives
  investors a clear path from high-level pitch to deep technical proof.


19.2  DECK VERSIONING
-----------------------

  The pitch deck and Wrapp Paper should maintain version parity. When
  the deck is updated, update this index. When the Wrapp Paper adds a
  section, verify the corresponding slide exists or create one.

  Current Deck Version:    [INSERT DECK VERSION]
  Current Paper Version:   1.1
  Last Sync Date:          February 14, 2026



================================================================================
  20. TEAM, ADVISORS & CONTRIBUTORS
================================================================================

20.1  FOUNDING TEAM
---------------------

  +-------------------------------------------------------------------+
  |                                                                     |
  |  FOUNDER / PROTOCOL ARCHITECT                                      |
  |  Hedera Account: 0.0.518487                                        |
  |                                                                     |
  |  Role:     Designed and built the complete Wrappdex platform --    |
  |            from Solidity smart contracts to React frontend, from    |
  |            ED25519 authentication to Chainlink oracle integration.  |
  |            Sole architect of the Smart Liquidity Engine, Weighted   |
  |            Pool Factory, DAO governance system, and VIP gating      |
  |            mechanism.                                               |
  |                                                                     |
  |  Name:     [FOUNDER NAME]                                          |
  |  Title:    [FOUNDER TITLE -- e.g., CEO & CTO]                     |
  |  Bio:      [2-3 sentence professional bio]                         |
  |  LinkedIn: [URL]                                                    |
  |  Twitter:  [URL]                                                    |
  |  GitHub:   [URL]                                                    |
  |                                                                     |
  +-------------------------------------------------------------------+


  +----- ADDITIONAL TEAM MEMBERS (fill as applicable) ------+
  |                                                          |
  |  [NAME]                                                  |
  |  Title:    [e.g., Lead Smart Contract Engineer]          |
  |  Bio:      [2-3 sentences]                               |
  |  Focus:    [e.g., Solidity, HSuite Integration]          |
  |  LinkedIn: [URL]                                         |
  |                                                          |
  +----------------------------------------------------------+
  |                                                          |
  |  [NAME]                                                  |
  |  Title:    [e.g., Head of Product / Design]              |
  |  Bio:      [2-3 sentences]                               |
  |  Focus:    [e.g., UX, Glass-morphism Design System]      |
  |  LinkedIn: [URL]                                         |
  |                                                          |
  +----------------------------------------------------------+
  |                                                          |
  |  [NAME]                                                  |
  |  Title:    [e.g., Head of Business Development]          |
  |  Bio:      [2-3 sentences]                               |
  |  Focus:    [e.g., Partnerships, Ecosystem Growth]        |
  |  LinkedIn: [URL]                                         |
  |                                                          |
  +----------------------------------------------------------+
  |                                                          |
  |  [NAME]                                                  |
  |  Title:    [e.g., Community Manager]                     |
  |  Bio:      [2-3 sentences]                               |
  |  Focus:    [e.g., DAO Moderation, VIP Engagement]        |
  |  Discord:  [URL]                                         |
  |                                                          |
  +----------------------------------------------------------+


20.2  ADVISORS
----------------

  Advisors provide strategic guidance on technology, regulatory
  compliance, tokenomics, and institutional partnerships. They do not
  have operational control over the protocol.

  +----------------------------------------------------------+
  |                                                          |
  |  [ADVISOR NAME]                                          |
  |  Role:      [e.g., Technical Advisor]                    |
  |  Expertise: [e.g., DeFi Protocol Design, Solidity Audit] |
  |  Bio:       [2-3 sentences]                              |
  |  LinkedIn:  [URL]                                        |
  |                                                          |
  +----------------------------------------------------------+
  |                                                          |
  |  [ADVISOR NAME]                                          |
  |  Role:      [e.g., Tokenomics Advisor]                   |
  |  Expertise: [e.g., Token Design, Market Making]          |
  |  Bio:       [2-3 sentences]                              |
  |  LinkedIn:  [URL]                                        |
  |                                                          |
  +----------------------------------------------------------+
  |                                                          |
  |  [ADVISOR NAME]                                          |
  |  Role:      [e.g., Legal / Regulatory Advisor]           |
  |  Expertise: [e.g., Securities Law, DeFi Compliance]      |
  |  Bio:       [2-3 sentences]                              |
  |  LinkedIn:  [URL]                                        |
  |                                                          |
  +----------------------------------------------------------+
  |                                                          |
  |  [ADVISOR NAME]                                          |
  |  Role:      [e.g., Hedera Ecosystem Advisor]             |
  |  Expertise: [e.g., Governing Council Relations, HTS]     |
  |  Bio:       [2-3 sentences]                              |
  |  LinkedIn:  [URL]                                        |
  |                                                          |
  +----------------------------------------------------------+


20.3  TECHNOLOGY PARTNERS & INTEGRATIONS
------------------------------------------

  These are not advisory relationships -- they are live production
  integrations already functioning in the Wrappdex codebase.

  +----------------------------+------------------------------------------+
  | Partner                    | Integration                              |
  +----------------------------+------------------------------------------+
  | SaucerSwap                 | Primary DEX: swap routing, pool data,    |
  |                            | token prices, LP tracking                |
  +----------------------------+------------------------------------------+
  | Chainlink                  | Decentralized oracle price feeds         |
  |                            | (16 feeds via Ethereum mainnet)          |
  +----------------------------+------------------------------------------+
  | HSuite Network             | SmartNode DEX aggregation, swap          |
  |                            | orchestration, validator network         |
  +----------------------------+------------------------------------------+
  | Bonzo Finance              | Aave V2 lending/borrowing on Hedera      |
  |                            | (6 asset markets)                        |
  +----------------------------+------------------------------------------+
  | HashPort                   | Official Hedera <-> EVM bridge           |
  +----------------------------+------------------------------------------+
  | Squid / Axelar             | Cross-chain swaps (60+ chains)           |
  +----------------------------+------------------------------------------+
  | Stargate / LayerZero       | Omnichain bridge with unified liquidity  |
  +----------------------------+------------------------------------------+
  | ChangeNOW                  | Fiat on-ramp + cross-chain exchange      |
  +----------------------------+------------------------------------------+
  | WalletConnect              | v2 SignClient for HIP-820 wallet comms   |
  +----------------------------+------------------------------------------+
  | Dynamic Labs               | Multi-wallet SDK orchestration           |
  +----------------------------+------------------------------------------+
  | Supabase                   | Edge functions, KV storage, hosting      |
  +----------------------------+------------------------------------------+
  | CoinGecko                  | Market data, token logos, global stats   |
  +----------------------------+------------------------------------------+
  | CoinCap                    | Real-time prices, sparkline history      |
  +----------------------------+------------------------------------------+
  | DexScreener                | HBAR.h live price + price history        |
  +----------------------------+------------------------------------------+
  | Alternative.me             | Fear & Greed Index                       |
  +----------------------------+------------------------------------------+


20.4  OPEN-SOURCE DEPENDENCIES (NOTABLE)
-------------------------------------------

  Wrappdex stands on the shoulders of exceptional open-source projects.
  We acknowledge them here for transparency and proper attribution.

  +----------------------------+----------+-------------------------------+
  | Package                    | Version  | Purpose                       |
  +----------------------------+----------+-------------------------------+
  | React                      | 18.3.1   | UI framework                  |
  | Vite                       | 6.3.5    | Build tool + dev server       |
  | Tailwind CSS               | 4.1.12   | Utility-first CSS             |
  | React Router               | 7.13.0   | Client-side routing           |
  | Motion                     | 12.34+   | Animation library             |
  | Hono                       | 4.6.3    | Edge function framework       |
  | @hashgraph/sdk             | 2.80.0   | Hedera SDK                    |
  | @walletconnect/sign-client | 2.23.4   | WalletConnect v2              |
  | lightweight-charts         | 5.1.0    | TradingView charting          |
  | recharts                   | 2.15.2   | Data visualization            |
  | Radix UI                   | various  | Accessible primitives         |
  | Lucide React               | 0.487.0  | Icon system                   |
  | Sonner                     | 2.0.3    | Toast notifications           |
  | viem                       | 2.45.3   | EVM transaction builder       |
  +----------------------------+----------+-------------------------------+



================================================================================
  21. DESIGN SPECIFICATIONS: INFOGRAPHIC CONVERSION GUIDE
================================================================================

The following ASCII diagrams in this document are marked for conversion
to production-quality infographics for the investor-facing version of
the Wrapp Paper. Each entry includes the section reference, current
format, recommended output format, and design direction.


21.1  CONVERSION MANIFEST
----------------------------

  +-----+-------------------------------+--------+----------+--------------------+
  | ID  | Diagram                       | Sect.  | Priority | Output Format      |
  +-----+-------------------------------+--------+----------+--------------------+
  | D-1 | System Architecture           | S5.1   | P0       | Full-page          |
  |     | (Client -> Server -> Chain)   |        | CRITICAL | infographic        |
  +-----+-------------------------------+--------+----------+--------------------+
  | D-2 | Oracle Pipeline Flow          | S6     | P0       | Flow diagram       |
  |     | (Chainlink -> CoinCap ->      |        | CRITICAL | with source        |
  |     |  CoinGecko -> Fallback)       |        |          | badge colors       |
  +-----+-------------------------------+--------+----------+--------------------+
  | D-3 | LP Pool Anatomy               | S7.6   | P0       | Annotated pool     |
  |     | (Reserve table + share calc)  |        | CRITICAL | diagram with       |
  |     |                               |        |          | math overlay       |
  +-----+-------------------------------+--------+----------+--------------------+
  | D-4 | Wallet Connection Flow        | S4.1   | P1       | Sequence diagram   |
  |     | (WC v2 session proposal)      |        | HIGH     | with brand logos    |
  +-----+-------------------------------+--------+----------+--------------------+
  | D-5 | Swap Route Discovery          | S4.2   | P1       | Animated flow      |
  |     | (HBAR -> WHBAR -> USDC)       |        | HIGH     | for web version    |
  +-----+-------------------------------+--------+----------+--------------------+
  | D-6 | Authentication Flow           | S14.1  | P1       | Sequence diagram   |
  |     | (Client -> Server -> Mirror)  |        | HIGH     | 3-party handshake  |
  +-----+-------------------------------+--------+----------+--------------------+
  | D-7 | Bridge Comparison Matrix      | S10    | P1       | Branded cards      |
  |     | (Squid / HashPort / Stargate) |        | HIGH     | with feature       |
  |     |                               |        |          | comparison         |
  +-----+-------------------------------+--------+----------+--------------------+
  | D-8 | Full Tech Stack Flow          | App.A  | P1       | Multi-layer        |
  |     | (5-layer architecture)        |        | HIGH     | interactive or     |
  |     |                               |        |          | poster-format      |
  +-----+-------------------------------+--------+----------+--------------------+
  | D-9 | Swap Execution Pipeline       | S9.4   | P2       | Linear flow        |
  |     | (User -> Sign -> Execute)     |        | MEDIUM   | with status icons  |
  +-----+-------------------------------+--------+----------+--------------------+
  | D-10| Revenue Model Table           | S16.6  | P2       | Bar chart or       |
  |     | (Revenue stream breakdown)    |        | MEDIUM   | stacked area       |
  +-----+-------------------------------+--------+----------+--------------------+
  | D-11| Token Utility Map             | S15.2  | P2       | Radial diagram     |
  |     | (6 utility functions)         |        | MEDIUM   | with HBAR.h center |
  +-----+-------------------------------+--------+----------+--------------------+
  | D-12| DAO Voting Power Calc         | S12.2  | P3       | Visual formula     |
  |     | (Tokens + NFTs = Votes)       |        | LOW      | with wallet icon   |
  +-----+-------------------------------+--------+----------+--------------------+
  | D-13| Liquidity Pool Table          | S11.2  | P3       | Formatted data     |
  |     | (16 pools with metrics)       |        | LOW      | table with logos   |
  +-----+-------------------------------+--------+----------+--------------------+
  | D-14| Roadmap Timeline              | S17    | P2       | Horizontal         |
  |     | (Q1-Q4 2026)                  |        | MEDIUM   | timeline with      |
  |     |                               |        |          | milestone markers  |
  +-----+-------------------------------+--------+----------+--------------------+
  | D-15| Pitch Deck Cross-Ref Table    | S19    | P3       | Formatted table    |
  |     | (Slide -> Section mapping)    |        | LOW      | for appendix       |
  +-----+-------------------------------+--------+----------+--------------------+


21.2  DESIGN LANGUAGE SPECIFICATIONS
--------------------------------------

  All infographics must adhere to the Wrappdex visual identity:

  PRIMARY PALETTE (Dark Mode -- default for investor materials):
  +-------------------+-------------------+---------------------------+
  | Token             | Hex / Value       | Usage                     |
  +-------------------+-------------------+---------------------------+
  | Background        | #080a12           | Page / canvas background  |
  | Card Surface      | #0d0f1a at 80%    | Glass-morphism panels     |
  | Border            | white at 6%       | Subtle card borders       |
  | Border Hover      | white at 12%      | Interactive hover state   |
  | Primary Text      | #ffffff           | Headlines, values         |
  | Secondary Text    | #94a3b8 (slate-400)| Labels, captions         |
  | Muted Text        | #64748b (slate-500)| Tertiary info            |
  +-------------------+-------------------+---------------------------+

  ACCENT PALETTE (Standard Users):
  +-------------------+-------------------+---------------------------+
  | Accent Primary    | pink-500 -> purple-500 gradient | Buttons,   |
  |                   | (#ec4899 -> #a855f7)            | active tabs |
  | Accent Secondary  | blue/cyan                       | Links, info |
  | Positive          | #16c784                         | Gains, up   |
  | Negative          | #ea3943                         | Losses, down|
  +-------------------+-------------------+---------------------------+

  VIP ACCENT PALETTE (VIP Users / Premium Materials):
  +-------------------+-------------------+---------------------------+
  | VIP Primary       | emerald-500 -> teal-500 gradient | VIP       |
  |                   | (#10b981 -> #14b8a6)              | elements |
  | VIP Glow          | Animated color-shifting            | Background|
  | Crown Shimmer     | Gold with CSS shimmer animation    | Badges   |
  +-------------------+-------------------+---------------------------+

  ORACLE SOURCE BADGES (must be consistent across all diagrams):
  +-------------------+-------------------+
  | Chainlink         | #3b82f6 (blue)    |
  | CoinCap           | #f59e0b (amber)   |
  | CoinGecko         | #22c55e (green)   |
  | Cached/Fallback   | #64748b (slate)   |
  +-------------------+-------------------+

  TYPOGRAPHY:
    Headlines:    Inter, Bold, tracking-tight
    Body:         Inter, Regular
    Code/Data:    JetBrains Mono
    Fluid scale:  Use clamp() values from theme.css

  EFFECTS:
    Glass-morphism:   backdrop-blur-xl with semi-transparent backgrounds
    Card borders:     1px solid white/6% (dark) or gray-200 (light)
    Shadows:          Subtle, cool-toned (no warm drop shadows)
    Charts:           Match TradingView lightweight-charts color scheme
                      (pink/green candles, transparent grid)


21.3  FILE DELIVERABLES PER DIAGRAM
--------------------------------------

  Each converted diagram should be delivered in:

  1. SVG (vector, scalable, web-ready)
  2. PNG @2x (2400px wide minimum for print)
  3. PDF (for Google Docs / investor packet embedding)
  4. Figma Component (for future iteration and team use)

  Naming convention: WRAPP_D{ID}_{short_name}_v{version}.{ext}
  Example: WRAPP_D01_system_architecture_v1.svg


21.4  ANIMATION SPECIFICATIONS (Web Version)
-----------------------------------------------

  For the web-hosted version of the Wrapp Paper (if published as a
  microsite or included in the dApp), the following diagrams should
  include subtle Motion animations:

  D-1  System Architecture:    Fade-in layers from bottom to top
  D-2  Oracle Pipeline:        Sequential highlight along fallback chain
  D-5  Swap Route:             Token icons slide along route arrows
  D-6  Auth Flow:              Messages animate between parties
  D-8  Full Stack:             Expand/collapse layer sections on click
  D-14 Roadmap:                Progress marker animates to current quarter

  Animation library: Motion (same as production app)
  Timing: staggerChildren 0.1s, spring physics (stiffness 300, damping 20)
  Reduced motion: Respect prefers-reduced-motion media query


21.5  PRINT SPECIFICATIONS (Investor Packet)
-----------------------------------------------

  For physical print or PDF investor packets:

  Paper:       US Letter (8.5" x 11") or A4
  Margins:     1" all sides
  Bleed:       0.125" (if full-bleed diagrams)
  Color:       CMYK conversion of all hex values
  Background:  Dark diagrams on dark background (preferred) OR
               Light-adapted versions for print economy
  DPI:         300 minimum for all raster elements
  Fonts:       Embed Inter and JetBrains Mono (OFL licensed)



================================================================================

                          END OF WRAPP PAPER v1.1

                Copyright 2026 HBAR.h Protocol. All rights reserved.

          For questions, contact the HBAR.h team via Discord:
          https://discord.gg/ZFnfRFxQZ

================================================================================
