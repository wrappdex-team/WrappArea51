================================================================================

                         W R A P P   P A P E R

               Wrappdex: The Institutional-Grade DEX on Hedera

                              Version 2.0
                          February 16,2026

================================================================================


                    "Trade smarter. Not harder. On Hedera."


================================================================================
  TABLE OF CONTENTS
================================================================================

  1.  Letter to Traders
  2.  Executive Summary
  3.  Platform Overview
  4.  How to Use Wrappdex
  5.  Architecture & Technical Stack
  6.  Oracle Pipeline
  7.  The Wrappdex AMM: Smart Liquidity Engine
  8.  Weighted Pool Factory
  9.  Swap Execution
  10. Cross-Chain Bridges
  11. DeFi Suite
  12. Governance: The HBAR.h DAO
  13. VIP System
  14. Security
  15. Tokenomics: HBAR.h
  16. Revenue Model & Growth
  17. Roadmap
  18. Why Hedera
  19. Team, Advisors & Partners
  20. Glossary



================================================================================
  1. LETTER TO TRADERS
================================================================================

To every trader who has been burned by slippage on a chain that promised
speed but delivered congestion. To every DeFi user who watched a bridge eat
their funds while "processing." To every professional who wanted
institutional-grade tools but got a toy wrapped in a gradient.

This is Wrappdex.

Built on Hedera -- the only public ledger that delivers 10,000+
transactions per second with mathematically provable finality in ~2
seconds. Not "eventually." Not "probably." Finality. The kind banks
require. The kind traders deserve.

Wrappdex is not another fork of Uniswap with a new logo. It is a
vertically integrated trading platform that combines:

  - A native AMM with constant-product pricing and server-authoritative
    state -- eliminating front-running by design
  - Live Chainlink oracle feeds with multi-source fallback
  - Multi-hop swap routing through SaucerSwap with route visualization
  - Professional charting with 9 timeframes, 6 technical indicators,
    and persistent drawing tools
  - Cross-chain bridging via Squid (Axelar), HashPort, and Stargate
    (LayerZero)
  - Lending and borrowing powered by Bonzo Finance (Aave V2 on Hedera)
  - A token-weighted governance DAO with on-chain voting verification
  - Cryptographic wallet-based authentication -- no passwords, no
    cookies, just proof of ownership

Every price you see is real. Every swap route is computed from live pool
data. Every vote in the DAO is weighted against Mirror Node-verified token
balances.

We built this for traders who read code. For investors who audit contracts.
For the community that will govern it.

Welcome to the future of trading on Hedera.

                                              -- The HBAR.h Team



================================================================================
  2. EXECUTIVE SUMMARY
================================================================================

Wrappdex is a decentralized exchange and comprehensive DeFi platform built
natively on Hedera. It serves as a single access point for token swapping,
professional trading, liquidity provision, lending/borrowing, cross-chain
bridging, fiat on-ramp, and community governance.

Key Differentiators:

  1. HEDERA-NATIVE PERFORMANCE
     Sub-cent transaction fees, ~2-second finality, 10,000+ TPS.
     No MEV. No front-running. Hashgraph consensus provides fair ordering.

  2. MULTI-SOURCE ORACLE INTEGRITY
     Prices sourced from Chainlink decentralized oracles (primary),
     CoinCap (secondary), and CoinGecko (tertiary). Every price displays
     its source badge so users always know data provenance.

  3. CUSTOM AMM WITH DETERMINISTIC EXECUTION
     The Smart Liquidity Engine uses constant-product (x * y = k) pricing
     with server-authoritative state. Swap execution is deterministic and
     atomic -- front-running is structurally impossible.

  4. INSTITUTIONAL SECURITY MODEL
     Cryptographic challenge-response authentication, short-lived sessions,
     rate limiting, input hardening, CSP headers, and HSTS enforcement.

  5. TOKEN-GATED VIP SYSTEM
     Holders of 100M+ HBAR.h tokens or VIP NFTs unlock premium features
     including the trading terminal, VIP chat, emerald theme, and more.

Protocol Token:   HBAR.h  (HTS Token ID: 0.0.9356476, 8 decimals)
VIP NFT:          0.0.10146181
Treasury:         0.0.9695738
Founder Account:  0.0.518487



================================================================================
  3. PLATFORM OVERVIEW
================================================================================

Wrappdex is organized into 8 primary modules accessible via top navigation
(desktop) or bottom tab bar (mobile).

  +------------------------------------------------------------------+
  |   Markets | Trade | Swap | Buy/Sell | Wallet | DeFi | DAO        |
  |   (+ Bridges, Audit via "More" on mobile)                        |
  +------------------------------------------------------------------+


3.1  MARKETS (Dashboard)
-------------------------
  - Global crypto market cap, 24h volume, BTC/ETH dominance
  - BTC, HBAR, and HBAR.h ticker cards with 7-day sparkline charts
  - Fear & Greed Index gauge, RSI gauge, BTC Dominance bar
  - Top 20 market overview with expandable candlestick charts
  - Site Activity feed with live trade logging
  - Oracle source badges on every price
  - Real-time news ticker

3.2  TRADE (VIP Terminal)
--------------------------
  - Full candlestick charting (TradingView lightweight-charts)
  - 9 timeframes: 1m, 5m, 30m, 1H, 4H, 1D, 1W, 1M, All
  - Indicators: SMA(20), SMA(50), EMA(12), RSI(14), MACD, Bollinger Bands
  - Drawing tools: trendlines, horizontals, rays, Fibonacci retracements
    (all persisted across sessions)
  - Watchlist with favorites
  - CEX-style trade panel via HSuite SmartNode aggregation
  - VIP Chat room for premium members
  - SaucerSwap pool routes with inline swap initiation

3.3  SWAP
----------
  - Native SaucerSwap integration (direct API, not iframe)
  - 10+ supported tokens including HBAR, WHBAR, USDC, USDT, WBTC, WETH,
    SAUCE, LINK, KARATE, PACK, HST, HBARX, DOVU
  - Multi-hop route visualization with pool fee display
  - HBAR/WHBAR wrap/unwrap (1:1, zero fee)
  - Configurable slippage: 0.1%, 0.5%, 1.0%, 3.0%, or custom
  - Auto-refreshing quotes (30-second cycle)
  - Swap history with transaction receipts
  - 1inch cross-chain widget integration

3.4  BUY / SELL
----------------
  - Fiat on-ramp via ChangeNOW partner integration
  - 100+ supported cryptocurrencies
  - Direct HBAR purchases with credit card
  - Privacy-consent gating before third-party redirect

3.5  WALLET
------------
  - Dual wallet support: HashPack (Hedera) + MetaMask (EVM)
  - Portfolio pie chart with color-coded asset allocation
  - HBAR balance + HTS token balances + LP token tracking
  - HBAR.h live USD pricing from DexScreener/SaucerSwap
  - Transaction history from Hedera Mirror Node
  - DAO voting power and VIP status display

3.6  DeFi
----------
  - LIQUIDITY POOLS: 16 SaucerSwap pools with TVL, volume, APR, fee tier,
    and utilization metrics
  - LEND & BORROW: Bonzo Finance integration (Aave V2 on Hedera) with
    supply/withdraw/borrow/repay flows and health factor monitoring.
    Supported assets: HBAR, USDC, WBTC, WETH, LINK, BONZO
  - STAKING: Pool roster with backend plugin architecture ready for
    production staking contracts

3.7  DAO
---------
  - Proposal creation with 8 categories and configurable voting duration
  - Token-weighted voting verified against Mirror Node balances
  - Threaded comments on proposals
  - Admin system with founder + dynamic admin list
  - Prize Spin Wheel for VIP engagement

3.8  BRIDGES
-------------
  - SQUID (Axelar): Cross-chain swaps across 60+ chains
  - HASHPORT: Official Hedera bridge to Ethereum/EVM chains
  - STARGATE (LayerZero): Omnichain bridge with unified liquidity



================================================================================
  4. HOW TO USE WRAPPDEX
================================================================================

4.1  CONNECTING YOUR WALLET
-----------------------------

  1. Click the wallet icon in the navigation header.
  2. Select your wallet provider:
     - HashPack (recommended for Hedera)
     - MetaMask (for EVM chains)
     - Dynamic (email, social, or 300+ wallets)
  3. Approve the connection in your wallet.
  4. Your address, HBAR balance, and token holdings appear in the header.

  HashPack connects via WalletConnect v2 (HIP-820 compliant).
  MetaMask uses native browser extension injection.


4.2  EXECUTING A SWAP
-----------------------

  1. Navigate to the "Swap" tab.
  2. Select input token (top) and output token (bottom).
  3. Enter the amount to swap.
  4. Review the quote: estimated output, price impact, route visualization,
     fee breakdown, and minimum output after slippage.
  5. Adjust slippage tolerance if needed (gear icon).
  6. Click "Swap" and approve the transaction in your wallet.
  7. Success overlay displays the transaction receipt with a link to
     HashScan for on-chain verification.

  For HBAR/WHBAR pairs, the swap is a direct 1:1 wrap/unwrap (zero fee).
  For all other pairs, the router finds optimal paths through available
  SaucerSwap V1 liquidity pools.


4.3  PROVIDING LIQUIDITY
--------------------------

  1. Navigate to DeFi > Pools or the Smart Liquidity section.
  2. Select a pool pair (e.g., WBTC/USDC).
  3. Enter the amount of Token A. Token B auto-calculates based on the
     current pool ratio.
  4. Review: your share percentage, estimated LP tokens, pool TVL.
  5. Approve and deposit.
  6. To withdraw, select your position and specify the percentage to
     remove. Both tokens return proportionally.


4.4  VOTING IN THE DAO
------------------------

  Eligibility: Hold 100M+ HBAR.h tokens OR 1+ VIP NFT.

  1. Navigate to the "DAO" tab.
  2. Browse active proposals or create a new one.
  3. Cast your vote (For / Against). Voting power is verified
     server-side from Mirror Node balances:

     Token Votes:  1 per 100M HBAR.h  (max 10)
     NFT Votes:    1 per 3 VIP NFTs   (max 1)
     Maximum:      11 votes per wallet

  4. Add comments to discuss proposals.
  5. Proposals resolve automatically when voting duration expires.


4.5  USING THE TRADING TERMINAL (VIP)
----------------------------------------

  Prerequisite: VIP status (100M+ HBAR.h or 1+ VIP NFT).

  1. Navigate to "Trade."
  2. Select a trading pair (20+ pairs available).
  3. Choose your timeframe (1m to All Time).
  4. Add indicators: SMA, EMA, RSI, MACD, Bollinger Bands.
  5. Use drawing tools for trendlines, horizontals, rays, and Fibonacci
     retracements. All drawings persist across sessions.
  6. Execute swaps directly from the integrated trade panel.
  7. Access VIP Chat to communicate with other VIP holders.



================================================================================
  5. ARCHITECTURE & TECHNICAL STACK
================================================================================

5.1  SYSTEM OVERVIEW
----------------------

  +-------------------------------------------------------------------+
  |                        CLIENT (Browser)                            |
  |  React 18  +  Vite  +  Tailwind CSS v4  +  React Router v7        |
  |  TradingView Charts  +  Radix UI  +  Motion Animations            |
  +-------------------------------------------------------------------+
              |         |         |         |         |
              v         v         v         v         v
  +--------+ +--------+ +------+ +-------+ +--------+
  |Chainlink| |CoinCap | |Sauce-| |Mirror | |Dynamic |
  | Oracle  | |  API   | |rSwap | | Node  | | Labs   |
  +--------+ +--------+ +------+ +-------+ +--------+
                                     |
                                     v
  +-------------------------------------------------------------------+
  |                    EDGE FUNCTION SERVER (Hono)                     |
  |                    Supabase Edge Functions                         |
  |                                                                    |
  |  Modules: Auth | AMM | DAO | Chat | News | Pools                  |
  |  Security: Rate limiting, input hardening, CSP, HSTS              |
  +-------------------------------------------------------------------+
              |         |         |
              v         v         v
  +--------+ +--------+ +--------+
  | Hedera | | Supabase| | HSuite |
  |Mainnet | |   KV    | | Smart  |
  |(HCS/HTS)| | Store   | | Nodes  |
  +--------+ +--------+ +--------+


5.2  FRONTEND
---------------

  Framework:        React 18 (Single Page Application)
  Build Tool:       Vite 6 with React plugin
  CSS:              Tailwind CSS v4 with custom theme tokens
  Routing:          React Router v7 (Data mode with lazy-loaded routes)
  State:            React Context (Wallet, Theme, Signing) + localStorage
  Charts:           TradingView lightweight-charts v5
  Animations:       Motion (spring physics, AnimatePresence)
  UI Primitives:    Radix UI (accessible tooltip, dialog, sheet, etc.)
  Wallet Connect:   @walletconnect/sign-client v2
  Hedera SDK:       @hashgraph/sdk v2

  All route components are lazy-loaded with automatic retry on chunk-load
  failures.


5.3  BACKEND
--------------

  Runtime:          Deno (Supabase Edge Functions)
  Framework:        Hono (lightweight, edge-optimized)
  Storage:          Supabase KV Store (all persistent state)
  Authentication:   Cryptographic challenge-response with session tokens
  Security:         Multi-layer rate limiting, input validation, hardened
                    HTTP headers



================================================================================
  6. ORACLE PIPELINE
================================================================================

Wrappdex implements a three-tier oracle fallback chain to ensure price data
is always available and trustworthy.


  TIER 1: CHAINLINK (Primary)
  ----------------------------
  Decentralized oracle feeds from Chainlink aggregator contracts on
  Ethereum. 16 price feeds covering all major assets. Batched for
  efficiency with a 30-second cache TTL.

  TIER 2: COINCAP (Secondary)
  ----------------------------
  Activated when Chainlink is unreachable or stale. Provides real-time
  prices, 24h change data, and 7-day history for sparkline charts.

  TIER 3: COINGECKO (Tertiary)
  ----------------------------
  Final fallback. Provides price, market cap, volume, and 24h change.


  PROVENANCE TRACKING
  --------------------
  Every price in the UI carries a source badge:

    [Blue]    Chainlink  -- decentralized, on-chain
    [Amber]   CoinCap    -- centralized, real-time
    [Green]   CoinGecko  -- centralized, rate-limited
    [Gray]    Cached     -- last known price

  Users can assess data quality at a glance. The 24h change field
  separately tracks its own source, since change data may come from
  a different tier than the spot price.


  Pipeline Flow:

  Chainlink --success--> Use Price
      |fail
  CoinCap ---success--> Use Price
      |fail
  CoinGecko --success--> Use Price
      |fail
  Cached Fallback (last known price, gray badge)



================================================================================
  7. THE WRAPPDEX AMM: SMART LIQUIDITY ENGINE
================================================================================

7.1  OVERVIEW
--------------

The Smart Liquidity Engine is Wrappdex's custom Automated Market Maker.
All pool state is persisted server-side. The client fetches live pool data,
requests server-computed swap quotes, and executes swaps that atomically
update reserves.

This architecture eliminates front-running: swap execution is
deterministic, atomic, and ordered by the server -- not by block producers.


7.2  CONSTANT-PRODUCT INVARIANT
---------------------------------

Each pool maintains the classic x * y = k invariant:

    Reserve_A * Reserve_B = k

When a trader swaps dx of Token A for dy of Token B:

    dy = (Reserve_B * dx * (10000 - feeBps))
         / (Reserve_A * 10000 + dx * (10000 - feeBps))

The fee (in basis points) is deducted from the input amount before the
invariant calculation, ensuring LPs earn fees proportional to volume.


7.3  TOKEN WHITELIST (Tier 1)
-------------------------------

  +---------+------------------+----------+-------------------+
  | Symbol  | HTS Token ID     | Decimals | Bridge            |
  +---------+------------------+----------+-------------------+
  | WBTC    | 0.0.1055483      | 8        | HashPort          |
  | WETH    | 0.0.541564       | 18       | HashPort          |
  | USDC    | 0.0.456858       | 6        | Native            |
  | USDT    | 0.0.4291336      | 6        | Native            |
  | LINK    | 0.0.1055495      | 8        | HashPort          |
  +---------+------------------+----------+-------------------+


7.4  SWAP QUOTES & SLIPPAGE PROTECTION
-----------------------------------------

Each swap quote includes: pool routing, input/output amounts at chain
precision, price impact (basis points), fee amount in USD, effective
exchange rate, and minimum output after slippage.

Slippage protection:
    minAmountOut = amountOut * (1 - slippageBps / 10000)

If execution price deviates beyond this threshold, the server rejects
the swap and reserves are not modified.


7.5  LP POSITION MANAGEMENT
------------------------------

When adding liquidity:
  - Both tokens must be deposited proportional to current reserves
  - LP shares minted = min(dx/Reserve_A, dy/Reserve_B) * lpTotalSupply

When removing liquidity:
  - Specify share percentage to withdraw (1-100%)
  - Both tokens returned proportionally
  - LP shares burned

  Example:

  +------------------------------------------------------------+
  |  User deposits: 0.1 WBTC + 9,784.50 USDC                  |
  |  Pool reserves: 2.5 WBTC + 244,612 USDC                    |
  |  LP total supply: 1,000,000 shares                          |
  |                                                              |
  |  Share ratio = min(0.1/2.5, 9784.5/244612) = 0.04 (4%)     |
  |  LP shares minted = 0.04 * 1,000,000 = 40,000 shares       |
  +------------------------------------------------------------+

Impermanent Loss:
  As with all constant-product AMMs, LPs face impermanent loss when
  token prices diverge. Wrappdex displays this risk in the UI and
  provides oracle-priced TVL calculations for informed decision-making.



================================================================================
  8. WEIGHTED POOL FACTORY
================================================================================

8.1  OVERVIEW
--------------

Beyond standard constant-product pools, Wrappdex supports user-created
weighted multi-token pools via a Solidity smart contract deployed on
Hedera's EVM equivalence layer.


8.2  CONTRACT SPECIFICATION
-----------------------------

  Contract:       HBARhWeightedPoolFactory
  Solidity:       ^0.8.19
  Safety:         ReentrancyGuard, Pausable, SafeERC20
  Max Tokens:     2-10 per pool
  Weight Sum:     10,000 bps (100%), minimum 100 bps (1%) per token

  Fee Structure:
    VIP holders:   FREE pool creation
    Non-VIP:       $50 equivalent in HBAR.h to treasury

  Treasury address is immutable in the contract -- prevents admin
  fee redirection.


8.3  SECURITY NOTES
---------------------

  - ReentrancyGuard on createPool prevents reentrancy via malicious
    token transfer callbacks
  - Pausable provides emergency stop capability
  - SafeERC20 handles non-standard ERC20 return values
  - On-chain weight validation enforces sum == 10,000 bps
  - Only whitelisted tokens allowed in pools
  - Fees go directly to treasury EOA (no intermediate escrow)
  - Immutable treasury address
  - Events emitted for all state changes (full off-chain indexing)


8.4  WEIGHTED POOL MATHEMATICS
---------------------------------

For a pool with n tokens, each with weight w_i and reserve R_i:

  Invariant:  PRODUCT(R_i ^ w_i) = k

  Swap output for input dx of token i, receiving dy of token j:

  dy = R_j * (1 - (R_i / (R_i + dx * (1 - fee)))^(w_i / w_j))

This generalizes constant-product to arbitrary weight distributions,
enabling portfolio-like pools (e.g., 80/20 HBAR/USDC).



================================================================================
  9. SWAP EXECUTION
================================================================================

Wrappdex supports multiple execution venues:


9.1  SAUCERSWAP V1 (Primary)
-------------------------------

The primary swap path routes through SaucerSwap, the largest DEX on
Hedera by TVL. Includes multi-hop routing, automatic path finding, and
resilient API connectivity. All transactions are signed via HashPack
using WalletConnect v2.


9.2  HSUITE SMARTNODE AGGREGATION
------------------------------------

For VIP terminal swaps, Wrappdex integrates HSuite's decentralized
SmartNode network for aggregation across SaucerSwap, Pangolin, and
HeliSwap. SmartNodes compare quotes across venues and execute through
the best available path.


9.3  WRAP / UNWRAP (Zero Fee)
-------------------------------

HBAR <-> WHBAR conversions are direct 1:1 wrap/unwrap operations with
zero fees. The platform detects these pairs automatically and bypasses
AMM routing.


9.4  SMART LIQUIDITY ENGINE (Native AMM)
-------------------------------------------

For pools created through the Wrappdex Pool Factory, swaps execute
against the server-authoritative constant-product engine (Section 7).


  Execution Flow:

  Select Tokens -> Enter Amount -> Route Discovery -> Quote
  -> Slippage Check -> Build Transaction -> Wallet Sign
  -> On-Chain Execution -> Confirmation -> Success



================================================================================
  10. CROSS-CHAIN BRIDGES
================================================================================

Wrappdex aggregates three bridge protocols:

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
  |(LayerZero)|         | messaging    | unified liquidity       |
  +----------+----------+--------------+-------------------------+

Each bridge is presented in a dedicated widget with consistent styling
and feature badges matching the bridge's brand identity.



================================================================================
  11. DeFi SUITE
================================================================================

11.1  BONZO FINANCE (Lending / Borrowing)
-------------------------------------------

  Protocol:   Bonzo Finance (Aave V2 fork on Hedera Mainnet)

  Supported Markets:
    +--------+-------------------+
    | Asset  | HTS Token ID      |
    +--------+-------------------+
    | HBAR   | native            |
    | USDC   | 0.0.456858        |
    | WBTC   | 0.0.1055483       |
    | WETH   | 0.0.541564        |
    | LINK   | 0.0.1055495       |
    | BONZO  | (Bonzo native)    |
    +--------+-------------------+

  Features:
    - Supply/withdraw and borrow/repay flows
    - Real-time APY display
    - Health factor gauge with liquidation warning
    - Deep-links to Bonzo's native lending app


11.2  LIQUIDITY POOLS
-----------------------

16 SaucerSwap pools tracked with live metrics including TVL, 24h volume,
APR, and fee tier. Coverage spans major pairs (WHBAR/USDC, WHBAR/WETH,
WHBAR/WBTC), stablecoins (USDC/USDT), ecosystem tokens (SAUCE, LINK,
KARATE, PACK, HST, HBARX, DOVU), and the protocol pair (WHBAR/HBAR.h).


11.3  STAKING
--------------

Backend plugin architecture with structurally defined pools matching
the liquidity pool token roster. Metric fields are nullable by design --
they display "Pending" badges until production staking contracts are live.



================================================================================
  12. GOVERNANCE: THE HBAR.h DAO
================================================================================

12.1  OVERVIEW
----------------

All governance state is server-side. The client is a rendering layer --
it cannot fabricate votes or modify proposals without passing
authentication and eligibility checks.

Authoritative source of truth: Hedera Mirror Node.
Every vote triggers a server-side balance verification.


12.2  ELIGIBILITY & VOTING POWER
-----------------------------------

  Gate Threshold:     100,000,000 HBAR.h tokens (decimals-adjusted)
  Alternative Gate:   1+ VIP NFT (Token ID: 0.0.10146181)
  Either qualifies -- both are NOT required.

  Voting Power:

    Token Votes = floor(balance / 100,000,000)    [max 10]
    NFT Votes   = floor(VIP_NFT_count / 3)        [max 1]
    Total Votes = Token Votes + NFT Votes          [max 11]

  Large holders have meaningful influence but cannot dominate. The NFT
  vote adds a "skin in the game" dimension beyond pure token holdings.


12.3  PROPOSAL LIFECYCLE
--------------------------

  1. CREATION:    Admin or eligible user submits proposal with title,
                  description, category, and duration (3-14 days).
  2. ACTIVE:      Community votes (For/Against) during the voting window.
  3. RESOLUTION:  Auto-resolves as Passed or Rejected when duration expires.

  Categories: Fees, Staking, Listing, Tokenomics, Features, Partnership,
              Governance, Other


12.4  ADMIN SYSTEM
-------------------

  Founder:           0.0.518487 (hardcoded, always admin)
  Dynamic Admins:    Server-managed list, modifiable by founder
  Admin Privileges:  Create/edit/delete proposals, manage admin list
  Authentication:    Session token required for all mutations


12.5  PRIZE SPIN WHEEL
------------------------

VIP engagement feature integrated into the DAO page. Outcomes are
determined server-side using cryptographically secure randomness.
24-hour cooldown enforced server-side. Winners receive HBAR.h token
ticket IDs generated on the server.



================================================================================
  13. VIP SYSTEM
================================================================================

13.1  ELIGIBILITY
------------------

Two paths to VIP status (either qualifies):

  Path A:  Hold >= 100,000,000 HBAR.h tokens
           (Token ID: 0.0.9356476, 8 decimals)

  Path B:  Hold >= 1 VIP NFT
           (Token ID: 0.0.10146181)

Verification is multi-layered: fast cached check from wallet state,
then authoritative verification via Hedera Mirror Node.


13.2  VIP FEATURES
-------------------

  1. EMERALD THEME
     Green-to-teal gradient replaces the default pink/purple accent
     across all UI elements. Toggled from the VIP Panel.

  2. PREMIUM SOUND FX
     Cash register on trades, sparkle confirmations, premium interaction
     sounds. Integrated with the 4-level volume system.

  3. IRIDESCENT GLOW
     Animated color-shifting background and card borders for a distinct
     visual identity during VIP sessions.

  4. TRADING TERMINAL
     Full CEX-style charting and trading at /trade (Section 3.2).

  5. VIP CHAT
     Emerald glass-morphism chat room for premium members.

  6. PRIZE SPIN WHEEL
     VIP-only access on the DAO page (Section 12.5).

  All VIP cosmetic features are individually toggleable. Gate enforcement
  is always server-side.



================================================================================
  14. SECURITY
================================================================================

14.1  AUTHENTICATION
----------------------

Wrappdex uses a cryptographic challenge-response protocol where the
private key never leaves the wallet:

  1. Client requests a challenge from the server.
  2. Server generates a cryptographically secure nonce.
  3. Client presents the challenge to the wallet for signing.
  4. Wallet signs with the user's private key.
  5. Client sends the signature to the server.
  6. Server verifies the signature against the account's public key
     (retrieved from Hedera Mirror Node).
  7. Server issues a short-lived session token.
  8. All authenticated requests include the session token.


  Flow:

  Client                    Server                    Mirror Node
    |                         |                           |
    |-- Request Challenge --->|                           |
    |                         |-- Generate nonce          |
    |<-- { challenge } -------|                           |
    |                         |                           |
    |-- [Wallet Signs] ------>|                           |
    |                         |                           |
    |-- Submit Signature ---->|                           |
    |                         |-- Fetch public key ------>|
    |                         |<-- { key } --------------|
    |                         |-- Verify + issue session  |
    |<-- { sessionToken } ----|                           |


14.2  INFRASTRUCTURE SECURITY
-------------------------------

  - Multi-layer rate limiting on all endpoints
  - Comprehensive input validation and sanitization
  - Content Security Policy (CSP) with strict allowlists
  - HTTP Strict Transport Security (HSTS)
  - X-Frame-Options: DENY (prevents clickjacking)
  - Restrictive Permissions-Policy
  - No cookies -- authentication via token headers only
  - Service role keys are server-only and never exposed to clients


14.3  WALLET SECURITY
-----------------------

  - WalletConnect v2 with session validation on every signing operation
  - Visual signing overlay with countdown and abort control
  - WalletConnect Health Report available on the Audit page
  - Stale session detection with automatic recovery



================================================================================
  15. TOKENOMICS: HBAR.h
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


15.2  TOKEN UTILITY
---------------------

  1. GOVERNANCE WEIGHT
     100M tokens = 1 DAO vote (max 10 per wallet). Verified on-chain.

  2. VIP ACCESS GATE
     100M+ tokens unlock the premium feature suite.

  3. POOL CREATION FEE
     Non-VIP users pay $50 in HBAR.h to create weighted pools.
     VIP holders create pools for free.

  4. PROTOCOL FEE SINK
     Pool creation fees flow to the treasury (0.0.9695738).

  5. LIQUIDITY PAIRING
     WHBAR/HBAR.h is a primary SaucerSwap V1 pool with dedicated
     liquidity for direct market access.

  6. VIP NFT ALTERNATIVE
     VIP NFT holders (0.0.10146181) receive equivalent access,
     creating a secondary demand vector and collector market.


15.3  DISTRIBUTION PHILOSOPHY
--------------------------------

HBAR.h is designed around sustained engagement, not speculative
accumulation. The 100M threshold creates meaningful commitment, while
the 10-vote cap per wallet prevents plutocratic governance capture.

The dual-path qualification (tokens OR NFTs) lets participants choose
their commitment level:
  - Token holders demonstrate ongoing economic alignment
  - NFT holders demonstrate community participation

Neither path is privileged -- both receive identical VIP benefits and
both contribute to governance.



================================================================================
  16. REVENUE MODEL & GROWTH
================================================================================

16.1  REVENUE STREAMS
-----------------------

  +-------------------------------+------------------------------------------+
  | Stream                        | Mechanism                                |
  +-------------------------------+------------------------------------------+
  | Pool Creation Fees            | $50 in HBAR.h per weighted pool          |
  |                               | (non-VIP) -> treasury                    |
  +-------------------------------+------------------------------------------+
  | AMM Swap Fee (0.25%)          | Full 25 bps stays in pool reserves.      |
  |                               | Protocol's 5 bps (0.05%) is tracked      |
  |                               | per pool and extractable by DAO.         |
  |                               | Until extraction, LPs earn full 0.25%.   |
  +-------------------------------+------------------------------------------+
  | Flat Micro-Fee                | $0.0007 per swap (in HBAR, additive)     |
  |                               | 50% LP bonus + 50% treasury              |
  +-------------------------------+------------------------------------------+
  | Fiat On-Ramp Affiliate        | ChangeNOW partner referral revenue       |
  +-------------------------------+------------------------------------------+


16.2  GROWTH PHASES
---------------------

  PHASE 1 -- LIQUIDITY DEPTH
  Achieve $100M+ TVL. Incentivize LP provision, deepen the WHBAR/HBAR.h
  pool as a flywheel, expand token whitelist via DAO governance.
  Full 0.25% swap fee benefits LPs. Protocol's 0.05% share tracked in
  per-pool accumulators; extraction deferred to maximize early LP yield.

  PHASE 2 -- PROTOCOL REVENUE
  Activate protocol fee extraction (admin/DAO endpoint). Scale via DAO
  governance: adjust protocol fee share (5 bps -> 8 bps -> 10 bps as
  volume grows). Launch premium API for institutional traders.

  PHASE 3 -- ECOSYSTEM EXPANSION
  HSuite SmartNode deep integration for cross-DEX aggregation. Native
  staking contracts. HBAR.h lending market on Bonzo. Additional bridge
  integrations. Mobile-optimized PWA.

  PHASE 4 -- INSTITUTIONAL ADOPTION
  SOC 2 compliance. Multi-sig treasury. Formal smart contract audit.
  Institutional API with SLA guarantees. EURC and PAXG pool expansion.
  Regulatory-compliant fiat on/off-ramp partnerships.


16.3  REVENUE PROJECTIONS
----------------------------

  Assumptions: $100M TVL, $5M daily volume, 5 bps protocol fee
  (tracked per pool, extractable by DAO).

  NOTE: Protocol swap fee revenue requires extraction from pool reserves
  via the admin /pools/protocol-fees/extract endpoint. Until extracted,
  the 0.05% share accrues inside pool reserves and benefits LPs.

  +-----------------------------+-------------------+
  | Source                      | Annual Revenue    |
  +-----------------------------+-------------------+
  | Protocol Swap Fees          | $912,500          |
  | Pool Creation Fees          | $6,000            |
  | Fiat On-Ramp Affiliate      | ~$50,000          |
  | Premium API (Phase 3)       | ~$200,000         |
  +-----------------------------+-------------------+
  | TOTAL (conservative)        | ~$1,168,500       |
  +-----------------------------+-------------------+

  At $500M TVL and $25M daily volume (Phase 4 target), annual protocol
  revenue exceeds $5M.



================================================================================
  17. ROADMAP
================================================================================

  Q1 2026 (Current)
  -----------------
  [x] Production AMM with persistent state
  [x] Multi-source oracle pipeline (Chainlink + CoinCap + CoinGecko)
  [x] SaucerSwap swap integration with route visualization
  [x] Cryptographic challenge-response authentication
  [x] DAO with weighted voting and proposal management
  [x] VIP token-gated system with NFT alternative
  [x] Cross-chain bridges (Squid, HashPort, Stargate)
  [x] Bonzo Finance lending/borrowing integration
  [x] Professional charting with 6 indicators + drawing tools
  [x] Mobile-optimized responsive design
  [x] Service health monitoring

  Q2 2026
  --------
  [ ] Formal smart contract audit
  [ ] HSuite SmartNode production integration
  [ ] Native staking contracts
  [ ] HBAR.h lending market on Bonzo Finance
  [ ] Advanced order types (limit orders)
  [ ] Portfolio analytics with P&L tracking

  Q3 2026
  --------
  [ ] Institutional API with WebSocket feeds
  [ ] Multi-sig treasury management
  [ ] Additional bridge integrations
  [ ] Automated yield strategies (auto-compound, rebalance)
  [ ] Mobile app (shared component library)

  Q4 2026
  --------
  [ ] Regulatory compliance framework
  [ ] Enterprise partnerships
  [ ] Cross-chain liquidity aggregation



================================================================================
  18. WHY HEDERA
================================================================================

  1. THROUGHPUT:  10,000+ TPS (vs Ethereum ~15 TPS)
  2. FINALITY:    ~2 seconds, mathematically provable (aBFT hashgraph consensus)
  3. FEES:        ~$0.0001 per transaction
  4. ORDERING:    Fair, consensus-timestamped (no MEV, no front-running)
  5. GOVERNANCE:  Hedera Governing Council (Google, IBM, Boeing, etc.)
  6. EVM:         Full EVM equivalence for Solidity smart contracts
  7. NATIVE:      HTS tokens are cheaper and faster than ERC-20
  8. STAKING:     Native HBAR staking with network reward distribution



================================================================================
  19. TEAM, ADVISORS & PARTNERS
================================================================================

19.1  FOUNDING TEAM
---------------------

  +-------------------------------------------------------------------+
  |  FOUNDER / PROTOCOL ARCHITECT                                      |
  |  Hedera Account: 0.0.518487                                        |
  |                                                                     |
  |  Designed and built the complete Wrappdex platform -- from Solidity |
  |  smart contracts to the React frontend, from cryptographic auth to  |
  |  oracle integration. Sole architect of the AMM, Pool Factory, DAO,  |
  |  and VIP system.                                                    |
  |                                                                     |
  |  Name:     ———                                                     |
  |  Title:    ———                                                     |
  |  Bio:      ———                                                     |
  |  LinkedIn: ———                                                     |
  |  Twitter:  ———                                                     |
  +-------------------------------------------------------------------+

  +-------------------------------------------------------------------+
  |  NATALIE -- Chief Marketing Officer                                |
  |                                                                     |
  |  Leads brand strategy, growth marketing, and market positioning    |
  |  for Wrappdex and the HBAR.h ecosystem.                            |
  |                                                                     |
  |  LinkedIn: ———                                                     |
  |  Twitter:  ———                                                     |
  +-------------------------------------------------------------------+

  +-------------------------------------------------------------------+
  |  CARLOS -- Community Manager & Brand Ambassador                    |
  |                                                                     |
  |  Drives community engagement, moderates governance channels, and   |
  |  represents the HBAR.h brand across the Hedera ecosystem.          |
  |                                                                     |
  |  LinkedIn: ———                                                     |
  |  Twitter:  ———                                                     |
  +-------------------------------------------------------------------+


19.2  ADVISORS
----------------

  Advisors provide strategic guidance on technology, regulatory
  compliance, tokenomics, and partnerships. They do not have operational
  control over the protocol.

  +-------------------------------------------------------------------+
  |  EMRAK -- Team Advisor                                             |
  |                                                                     |
  |  Provides strategic advisory on protocol direction, ecosystem       |
  |  development, and partnership opportunities.                        |
  |                                                                     |
  |  LinkedIn: ———                                                     |
  |  Twitter:  ———                                                     |
  +-------------------------------------------------------------------+


19.3  TECHNOLOGY PARTNERS
---------------------------

Live production integrations in the Wrappdex codebase:

  +----------------------------+------------------------------------------+
  | Partner                    | Integration                              |
  +----------------------------+------------------------------------------+
  | SaucerSwap                 | Primary DEX: swap routing, pool data,    |
  |                            | token prices, LP tracking                |
  +----------------------------+------------------------------------------+
  | Chainlink                  | Decentralized oracle price feeds         |
  +----------------------------+------------------------------------------+
  | HSuite Network             | SmartNode DEX aggregation                |
  +----------------------------+------------------------------------------+
  | Bonzo Finance              | Aave V2 lending/borrowing on Hedera      |
  +----------------------------+------------------------------------------+
  | HashPort                   | Official Hedera <-> EVM bridge           |
  +----------------------------+------------------------------------------+
  | Squid / Axelar             | Cross-chain swaps (60+ chains)           |
  +----------------------------+------------------------------------------+
  | Stargate / LayerZero       | Omnichain bridge                         |
  +----------------------------+------------------------------------------+
  | ChangeNOW                  | Fiat on-ramp + cross-chain exchange      |
  +----------------------------+------------------------------------------+
  | WalletConnect              | v2 SignClient for wallet communication   |
  +----------------------------+------------------------------------------+
  | Dynamic Labs               | Multi-wallet SDK                         |
  +----------------------------+------------------------------------------+



================================================================================
  20. GLOSSARY
================================================================================

  AMM       Automated Market Maker
  bps       Basis points (1 bps = 0.01%)
  CSP       Content Security Policy
  DAO       Decentralized Autonomous Organization
  DEX       Decentralized Exchange
  EVM       Ethereum Virtual Machine
  HIP-820   Hedera Improvement Proposal for WalletConnect integration
  HSTS      HTTP Strict Transport Security
  HTS       Hedera Token Service
  LP        Liquidity Provider
  MEV       Maximal Extractable Value
  SMA       Simple Moving Average
  EMA       Exponential Moving Average
  RSI       Relative Strength Index
  MACD      Moving Average Convergence Divergence
  TVL       Total Value Locked
  WHBAR     Wrapped HBAR (HTS equivalent of native HBAR)



================================================================================

                         END OF WRAPP PAPER v2.0

               Copyright 2026 HBAR.h Protocol. All rights reserved.

         For questions, contact the HBAR.h team via Discord:
         https://discord.gg/ZFnfRFxQZ

================================================================================