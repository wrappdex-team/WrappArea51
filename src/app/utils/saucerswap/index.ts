/**
 * [C48] SaucerSwap Module Barrel -- Re-exports everything from sub-modules.
 *
 * Backward compatible: `import { ... } from "../utils/saucerswap"` resolves
 * to the monolith saucerswap.ts file (file takes priority over directory),
 * which re-exports from these sub-modules. This barrel is for direct
 * sub-module imports: `import { ... } from "../utils/saucerswap/index"`.
 */

// -- Tokens: types, registry, pure helpers --
export * from "./tokens";

// -- Contracts: addresses, fee tiers, infrastructure endpoints --
export * from "./contracts";

// -- ABI: encode/decode helpers --
export * from "./abi";

// -- Prices: fetching, caching, estimation --
export * from "./prices";

// -- Pools: detection, caching, infrastructure (ssProxy, resolveEvm) --
export * from "./pools";

// -- Routing: path building, multi-hop, pool routes --
export * from "./routing";

// -- Quotes: multi-strategy quote fetching, client estimation --
export * from "./quotes";

// -- Balances: token association, balance checking --
export * from "./balances";

// -- Helpers: pure formatters, URL builders, tx ID formatting --
export * from "./helpers";

// -- Stats: HBAR price, pool data, protocol stats --
export * from "./stats";

// -- Wrapping: HBAR ↔ WHBAR wrap/unwrap --
export * from "./wrapping";

// -- Verification: contract verification, router discovery --
export * from "./verification";

// -- Diagnostics: transaction diagnosis, network health --
export * from "./diagnostics";

// -- Simulation: swap/wrap-unwrap simulation for test mode --
export * from "./simulation";

// -- Swap Engine: execution engine, SwapResult, DryRunResult --
export * from "./swap-engine";

// -- Swap Verification: post-swap verification, balance checks, association --
export * from "./swap-verification";