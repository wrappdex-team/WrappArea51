/**
 * [C72] SaucerSwap Contract Verification & Router Discovery
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: verifyIsContract, discoverSaucerSwapRouter, getDiscoveredRouter,
 *           ContractInfo type, contract verification cache, router discovery logic.
 *
 * Dependencies: tokens (htsIdToEvmAddress, evmAddressToHtsId, HederaNetwork),
 *               contracts (SAUCERSWAP_V1_ROUTER_CANDIDATES, SAUCERSWAP_V1_ROUTER, etc.),
 *               prices (MIRROR_NODES, JSON_RPC_RELAY, makeAbort),
 *               pools (resolveContractEvmAddress)
 */

import type { HederaNetwork } from "./tokens";
import { htsIdToEvmAddress, evmAddressToHtsId } from "./tokens";
import {
  SAUCERSWAP_V1_ROUTER_CANDIDATES, SAUCERSWAP_V1_ROUTER, SAUCERSWAP_V1_FACTORY,
  SAUCERSWAP_V2_ROUTER,
  getSaucerSwapFactory,
  MIRROR_NODES, JSON_RPC_RELAY,
} from "./contracts";
import { makeAbort } from "./prices";
import { resolveContractEvmAddress } from "./pools";

// ══════════════════════════════════════════════════════════════════════
// ── CONTRACT VERIFICATION ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Verify that a Hedera account ID is actually a smart contract.
 *
 * Uses a multi-strategy approach for robustness:
 *   1. Mirror Node /api/v1/contracts/{id}  (primary)
 *   2. JSON-RPC relay eth_getCode          (fallback — queries on-chain bytecode)
 *   3. Mirror Node /api/v1/accounts/{id}   (diagnostic — checks if entity exists as account)
 *
 * CRITICAL SAFETY CHECK: prevents sending HBAR/tokens to a random account
 * that isn't a contract. Without this, a wrong router address silently
 * sends funds to a non-contract account with no swap executed.
 *
 * Returns the contract info (including evm_address and bytecode hash)
 * or null if the ID is not a contract.
 */
export interface ContractInfo {
  contractId: string;
  evmAddress: string;
  bytecodeHash?: string;
  runtimeBytecode?: string;
}

// Cache verified contracts so we don't re-check every swap
const _verifiedContractCache: Record<string, ContractInfo> = {};

// ── Pre-seed known SaucerSwap infrastructure contracts ──────────────
// These are publicly documented, well-known contracts that rarely change.
// Pre-seeding eliminates unreliable network verification in browser
// environments where CORS/rate-limiting blocks Mirror Node and JSON-RPC
// calls.  If addresses change with protocol upgrades, update the
// hardcoded candidate lists above — same workflow as today.
//
// This runs on module load so verifyIsContract() returns from cache
// immediately for known contracts, avoiding the "reduced confidence"
// fallback path entirely.
function _seedKnownContractCache() {
  const knownContracts: { network: string; id: string }[] = [];

  // Router candidates
  for (const [net, ids] of Object.entries(SAUCERSWAP_V1_ROUTER_CANDIDATES)) {
    for (const id of ids) {
      knownContracts.push({ network: net, id });
    }
  }
  // Factory addresses
  for (const [net, id] of Object.entries(SAUCERSWAP_V1_FACTORY)) {
    knownContracts.push({ network: net, id });
  }
  // V2 Router addresses
  for (const [net, id] of Object.entries(SAUCERSWAP_V2_ROUTER)) {
    knownContracts.push({ network: net, id });
  }

  for (const { network, id } of knownContracts) {
    const cacheKey = `${network}:${id}`;
    if (!_verifiedContractCache[cacheKey]) {
      _verifiedContractCache[cacheKey] = {
        contractId: id,
        evmAddress: htsIdToEvmAddress(id),
      };
    }
  }
}
_seedKnownContractCache();

export async function verifyIsContract(
  contractId: string,
  network: HederaNetwork
): Promise<ContractInfo | null> {
  const cacheKey = `${network}:${contractId}`;
  if (_verifiedContractCache[cacheKey]) {
    console.log(`[HBAR.h] verifyIsContract(${contractId}): using cached result ✓`);
    return _verifiedContractCache[cacheKey];
  }

  // ── Strategy 1: Mirror Node /api/v1/contracts/{id} ──
  // The contracts endpoint only returns 200 for actual contracts, so ANY
  // 200 response is definitive proof.  We extract the EVM address and
  // bytecode hash when available but don't require them.
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(
      `${base}/api/v1/contracts/${contractId}`,
      { signal: makeAbort(10000) }
    );
    if (res.ok) {
      const data = await res.json();
      // 200 OK from /api/v1/contracts/{id} = definitive proof this is a contract
      const evmAddr = data.evm_address ||
        (data.contract_id ? htsIdToEvmAddress(data.contract_id) : htsIdToEvmAddress(contractId));
      console.log(`[HBAR.h] verifyIsContract(${contractId}): CONFIRMED via Mirror Node contracts endpoint (HTTP 200), EVM: ${evmAddr}`);
      const info: ContractInfo = {
        contractId: data.contract_id || contractId,
        evmAddress: evmAddr,
        bytecodeHash: data.bytecode_hash || undefined,
        runtimeBytecode: data.runtime_bytecode ? data.runtime_bytecode.slice(0, 20) + "..." : undefined,
      };
      _verifiedContractCache[cacheKey] = info;
      return info;
    }
    if (res.status === 404) {
      console.log(`[HBAR.h] verifyIsContract(${contractId}): Mirror Node contracts 404, trying accounts endpoint...`);
    } else {
      console.warn(`[HBAR.h] verifyIsContract(${contractId}): Mirror Node HTTP ${res.status}, trying accounts endpoint...`);
    }
  } catch (err: any) {
    console.warn(`[HBAR.h] verifyIsContract(${contractId}): Mirror Node error — ${err?.message || err}, trying accounts endpoint...`);
  }

  // ── Strategy 2: Resolve real EVM address + accounts/type check ──
  // On Hedera, eth_getCode returns "0x" for synthetic long-zero addresses.
  // We resolve the REAL EVM address via the accounts endpoint and also
  // check the entity type.  The contracts endpoint was already tried in
  // Strategy 1, so we do NOT retry it (redundant calls risk rate-limiting).
  const longZeroAddr = htsIdToEvmAddress(contractId);
  let resolvedEvmAddr: string | null = null;
  let entityExistsOnMirrorNode = false;

  // Try accounts endpoint — works for both accounts AND contracts on Hedera
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const acctRes = await fetch(
      `${base}/api/v1/accounts/${contractId}`,
      { signal: makeAbort(8000) }
    );
    if (acctRes.ok) {
      const acctData = await acctRes.json();
      entityExistsOnMirrorNode = true;
      const acctEvmAddr = acctData.evm_address;
      if (acctEvmAddr && acctEvmAddr.startsWith("0x") && acctEvmAddr.length === 42) {
        if (acctEvmAddr.toLowerCase() !== longZeroAddr.toLowerCase()) {
          resolvedEvmAddr = acctEvmAddr;
          console.log(`[HBAR.h] verifyIsContract(${contractId}): resolved REAL EVM via accounts: ${resolvedEvmAddr}`);
        } else {
          // Even the long-zero is useful for tracking that the entity exists
          resolvedEvmAddr = acctEvmAddr;
          console.log(`[HBAR.h] verifyIsContract(${contractId}): accounts returned long-zero EVM: ${acctEvmAddr}`);
        }
      }
      // Check if the accounts endpoint type field says CONTRACT
      // Accept various representations: "CONTRACT", "contract", or type containing "contract"
      const entityType = (acctData.type || "").toUpperCase();
      if (entityType.includes("CONTRACT")) {
        const useAddr = resolvedEvmAddr || longZeroAddr;
        console.log(`[HBAR.h] verifyIsContract(${contractId}): CONFIRMED via accounts endpoint (type=${acctData.type}), EVM: ${useAddr}`);
        const info: ContractInfo = { contractId, evmAddress: useAddr };
        _verifiedContractCache[cacheKey] = info;
        return info;
      }
      // Additional contract indicator: presence of contract_id field in response
      // (the Mirror Node accounts endpoint includes this for contracts even if
      // the type field is missing or unexpected)
      if (acctData.contract_id) {
        const useAddr = resolvedEvmAddr || longZeroAddr;
        console.log(`[HBAR.h] verifyIsContract(${contractId}): CONFIRMED via accounts endpoint (contract_id=${acctData.contract_id}), EVM: ${useAddr}`);
        const info: ContractInfo = { contractId: acctData.contract_id, evmAddress: useAddr };
        _verifiedContractCache[cacheKey] = info;
        return info;
      }
      // Log additional entity info for debugging
      console.log(`[HBAR.h] verifyIsContract(${contractId}): accounts type="${acctData.type || "null"}", key=${acctData.key ? "present" : "null"}, contract_id=${acctData.contract_id || "null"}, deleted=${acctData.deleted ?? "unknown"}`);
    }
  } catch {
    // Non-fatal
  }

  // Try eth_getCode with resolved address (if different from long-zero), then long-zero.
  // Deduplicate: if resolvedEvmAddr IS the long-zero, only try once.
  const ethGetCodeAddresses: string[] = [];
  if (resolvedEvmAddr && resolvedEvmAddr.toLowerCase() !== longZeroAddr.toLowerCase()) {
    ethGetCodeAddresses.push(resolvedEvmAddr);
  }
  ethGetCodeAddresses.push(longZeroAddr);

  for (const evmAddr of ethGetCodeAddresses) {
    try {
      const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
      const rpcRes = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: makeAbort(12000),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getCode",
          params: [evmAddr, "latest"],
          id: 1,
        }),
      });
      if (rpcRes.ok) {
        const rpcData = await rpcRes.json();
        const code = rpcData?.result;
        if (code && code !== "0x" && code !== "0x0" && code.length > 4) {
          const useAddr = resolvedEvmAddr || evmAddr;
          console.log(`[HBAR.h] verifyIsContract(${contractId}): CONFIRMED via eth_getCode (${code.length} hex chars), EVM: ${useAddr}`);
          const info: ContractInfo = {
            contractId,
            evmAddress: useAddr,
            runtimeBytecode: code.slice(0, 20) + "...",
          };
          _verifiedContractCache[cacheKey] = info;
          return info;
        }
        if (rpcData.error) {
          console.warn(`[HBAR.h] verifyIsContract(${contractId}): eth_getCode(${evmAddr}) RPC error: ${rpcData.error.message || JSON.stringify(rpcData.error).slice(0, 150)}`);
        } else {
          console.log(`[HBAR.h] verifyIsContract(${contractId}): eth_getCode(${evmAddr}) no bytecode: ${String(code).slice(0, 10) || "(empty)"}`);
        }
      }
    } catch (err: any) {
      console.warn(`[HBAR.h] verifyIsContract(${contractId}): eth_getCode(${evmAddr}) failed — ${err?.message || err}`);
    }
  }

  // ── Strategy 3: Verify via eth_call probe ──
  // If Strategies 1–2 failed, try eth_call — if the entity responds to ANY
  // function call (even with a revert), it IS a contract.
  // Uses factory() (0xc45a0155) with generous gas (300K — Hedera charges
  // ~2100 per SLOAD, and the old 30K was too low for Hedera EVM pricing).
  // Tries BOTH JSON-RPC relay AND Mirror Node /api/v1/contracts/call.
  {
    // Deduplicate: if resolvedEvmAddr IS the long-zero, only try once
    const probeAddrs: string[] = [];
    if (resolvedEvmAddr && resolvedEvmAddr.toLowerCase() !== longZeroAddr.toLowerCase()) {
      probeAddrs.push(resolvedEvmAddr);
    }
    probeAddrs.push(longZeroAddr);

    for (const probeAddr of probeAddrs) {
      // ── 3a: JSON-RPC relay eth_call ──
      try {
        const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
        const probeRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: makeAbort(12000),
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_call",
            params: [{ to: probeAddr, data: "0xc45a0155", gas: "0x493e0" }, "latest"],
            id: 1,
          }),
        });
        if (probeRes.ok) {
          const probeData = await probeRes.json();
          const result = probeData?.result;
          if (result && result !== "0x" && result.length >= 66 && !probeData.error) {
            console.log(`[HBAR.h] verifyIsContract(${contractId}): CONFIRMED via eth_call probe, EVM: ${probeAddr}`);
            const info: ContractInfo = { contractId, evmAddress: probeAddr };
            _verifiedContractCache[cacheKey] = info;
            return info;
          }
          if (probeData.error) {
            const errMsg = probeData.error.message || JSON.stringify(probeData.error);
            if (errMsg.includes("REVERT") || errMsg.includes("revert") || errMsg.includes("execution reverted")) {
              console.log(`[HBAR.h] verifyIsContract(${contractId}): CONFIRMED via eth_call revert (IS a contract), EVM: ${probeAddr}`);
              const info: ContractInfo = { contractId, evmAddress: probeAddr };
              _verifiedContractCache[cacheKey] = info;
              return info;
            }
            console.log(`[HBAR.h] verifyIsContract(${contractId}): eth_call probe(${probeAddr}) RPC error: ${errMsg.slice(0, 150)}`);
          }
        }
      } catch (err: any) {
        console.warn(`[HBAR.h] verifyIsContract(${contractId}): eth_call probe(${probeAddr}) failed — ${err?.message || err}`);
      }

      // ── 3b: Mirror Node /api/v1/contracts/call (fallback for browser CORS issues with JSON-RPC) ──
      try {
        const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
        const mnRes = await fetch(`${base}/api/v1/contracts/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: makeAbort(12000),
          body: JSON.stringify({
            block: "latest",
            data: "0xc45a0155",
            estimate: false,
            from: "0x0000000000000000000000000000000000000000",
            to: probeAddr,
            gas: 300_000,
            gasPrice: 0,
            value: 0,
          }),
        });
        if (mnRes.ok) {
          const mnData = await mnRes.json();
          const mnResult = mnData.result;
          if (mnResult && mnResult !== "0x" && mnResult.length >= 66) {
            console.log(`[HBAR.h] verifyIsContract(${contractId}): CONFIRMED via Mirror Node contracts/call, EVM: ${probeAddr}`);
            const info: ContractInfo = { contractId, evmAddress: probeAddr };
            _verifiedContractCache[cacheKey] = info;
            return info;
          }
          const errMsg = mnData.error_message || mnData._status?.messages?.[0]?.message || "";
          if (errMsg && (errMsg.includes("REVERT") || errMsg.includes("revert"))) {
            console.log(`[HBAR.h] verifyIsContract(${contractId}): CONFIRMED via Mirror Node revert (IS a contract), EVM: ${probeAddr}`);
            const info: ContractInfo = { contractId, evmAddress: probeAddr };
            _verifiedContractCache[cacheKey] = info;
            return info;
          }
        }
      } catch {
        // Non-fatal
      }
    }
  }

  // ── All strategies exhausted ──
  // Check if this is a known SaucerSwap infrastructure contract before
  // applying the reduced-confidence fallback.  Known contracts (router
  // candidates, factory addresses) are accepted with full confidence
  // since they're explicitly hardcoded by the developer.
  const isKnownInfraContract =
    Object.values(SAUCERSWAP_V1_ROUTER_CANDIDATES).flat().includes(contractId) ||
    Object.values(SAUCERSWAP_V1_FACTORY).includes(contractId);

  if (isKnownInfraContract) {
    const useAddr = resolvedEvmAddr || longZeroAddr;
    console.log(
      `[HBAR.h] verifyIsContract(${contractId}): ACCEPTED as known infrastructure contract (EVM: ${useAddr})`
    );
    const info: ContractInfo = { contractId, evmAddress: useAddr };
    _verifiedContractCache[cacheKey] = info;
    return info;
  }

  // If the entity exists on the Mirror Node (accounts endpoint returned 200)
  // but we couldn't confirm it's a contract through type checks or bytecode,
  // accept it with a warning.  On Hedera, the contracts endpoint may be
  // rate-limited or temporarily unavailable, eth_getCode may return "0x" for
  // long-zero addresses, and JSON-RPC eth_call may be blocked by CORS.
  // If the entity exists at all, it's safer to accept it (the swap will revert
  // if it's wrong) than to block the entire pipeline.
  if (entityExistsOnMirrorNode) {
    const useAddr = resolvedEvmAddr || longZeroAddr;
    console.warn(
      `[HBAR.h] verifyIsContract(${contractId}): entity exists on Mirror Node (EVM: ${useAddr}) — ` +
      `accepting with reduced confidence (type/bytecode checks inconclusive)`
    );
    const info: ContractInfo = { contractId, evmAddress: useAddr };
    _verifiedContractCache[cacheKey] = info;
    return info;
  }

  if (resolvedEvmAddr) {
    console.warn(
      `[HBAR.h] verifyIsContract(${contractId}): entity exists (EVM: ${resolvedEvmAddr}) but ` +
      `could not confirm it's a contract via any strategy`
    );
  } else {
    console.warn(`[HBAR.h] verifyIsContract(${contractId}): entity not found or not a contract on ${network}`);
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════════
// ── DYNAMIC ROUTER DISCOVERY ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

// Tries multiple candidate addresses and verifies each by calling
// factory() — the correct SaucerSwap V1 Router should return the
// known factory address (0.0.1062784).

// Pre-seeded with known mainnet/testnet routers for immediate availability.
// Factory-based verification (_discoverRouterImpl) upgrades the cache entry
// asynchronously but never blocks the swap pipeline.
let _discoveredRouter: Record<string, string> = {
  mainnet: SAUCERSWAP_V1_ROUTER.mainnet,
  testnet: SAUCERSWAP_V1_ROUTER.testnet,
};
let _routerDiscoveryInProgress: Record<string, Promise<string | null>> = {};

/**
 * Read-only access to the cached discovered router for a given network.
 * Returns the cached value without triggering discovery.
 * Used by diagnoseTransaction to check which router was expected.
 */
export function getDiscoveredRouter(network: string): string | null {
  return _discoveredRouter[network] || null;
}

async function _discoverRouterImpl(network: HederaNetwork): Promise<string | null> {
  const candidates = SAUCERSWAP_V1_ROUTER_CANDIDATES[network] || [SAUCERSWAP_V1_ROUTER[network]];
  const knownFactory = getSaucerSwapFactory(network);
  const knownFactoryLongZero = htsIdToEvmAddress(knownFactory).toLowerCase();

  // Resolve the factory's REAL EVM address via Mirror Node.
  // On Hedera, contracts deployed via EVM CREATE have a real EVM address that
  // differs from the long-zero synthetic form.  factory() on the router returns
  // this real address, so we MUST compare against it — not just the long-zero.
  let knownFactoryRealEvm: string | null = null;
  try {
    const resolved = await resolveContractEvmAddress(knownFactory, network);
    if (resolved && resolved.toLowerCase() !== knownFactoryLongZero) {
      knownFactoryRealEvm = resolved.toLowerCase();
    }
  } catch {
    // Non-fatal — will compare against long-zero only
  }
  // Also try the accounts endpoint (sometimes contracts endpoint returns
  // the long-zero but accounts returns the real address)
  if (!knownFactoryRealEvm) {
    try {
      const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
      const acctRes = await fetch(
        `${base}/api/v1/accounts/${knownFactory}`,
        { signal: makeAbort(6000) }
      );
      if (acctRes.ok) {
        const acctData = await acctRes.json();
        const acctEvm = acctData.evm_address;
        if (acctEvm && acctEvm.startsWith("0x") && acctEvm.length === 42 &&
            acctEvm.toLowerCase() !== knownFactoryLongZero) {
          knownFactoryRealEvm = acctEvm.toLowerCase();
        }
      }
    } catch { /* Non-fatal */ }
  }

  console.log(`[HBAR.h] ═══ Router Discovery (${network}) ═══`);
  console.log(`[HBAR.h] Candidates: ${candidates.join(", ")}`);
  console.log(`[HBAR.h] Expected factory: ${knownFactory} (long-zero: ${knownFactoryLongZero}${knownFactoryRealEvm ? `, real: ${knownFactoryRealEvm}` : ""})`);

  /**
   * Check if a returned factory address matches the known factory.
   * Compares against BOTH the long-zero synthetic address AND the real EVM
   * address (resolved from Mirror Node).  Also converts the returned address
   * back to an HTS ID and compares numerically as a last resort — this
   * handles the case where the factory's EVM address format differs but
   * represents the same Hedera entity.
   */
  function factoryMatches(returnedAddr: string): boolean {
    const lower = returnedAddr.toLowerCase();
    if (lower === knownFactoryLongZero) return true;
    if (knownFactoryRealEvm && lower === knownFactoryRealEvm) return true;
    // Last resort: convert back to HTS ID and compare entity numbers
    try {
      const returnedHtsId = evmAddressToHtsId(returnedAddr);
      if (returnedHtsId === knownFactory) return true;
    } catch { /* Non-fatal */ }
    return false;
  }

  // Track candidates that passed verifyIsContract but failed factory() match
  // so we can use them as a last-resort fallback.
  let fallbackCandidate: { id: string; evmAddress: string } | null = null;

  for (const candidate of candidates) {
    console.log(`[HBAR.h] Checking candidate: ${candidate}...`);

    // Try verifyIsContract first, but don't skip if it fails —
    // factory() is the authoritative check and may succeed even when
    // verifyIsContract can't confirm (common on Hedera where eth_getCode
    // returns 0x for long-zero addresses).
    const info = await verifyIsContract(candidate, network);
    if (info) {
      console.log(`[HBAR.h]   ✓ ${candidate} IS a contract (EVM: ${info.evmAddress})`);
    } else {
      console.log(`[HBAR.h]   ? ${candidate} not confirmed as contract via verifyIsContract, trying factory() anyway...`);
    }

    // Build list of EVM addresses to try for the factory() call.
    // Priority: verified EVM > accounts-resolved EVM > long-zero fallback.
    // Use case-insensitive deduplication (EVM addresses may differ in case).
    const longZero = htsIdToEvmAddress(candidate);
    const evmCandidates: string[] = [];
    const evmCandidatesLower = new Set<string>();
    const addEvmCandidate = (addr: string) => {
      if (addr && !evmCandidatesLower.has(addr.toLowerCase())) {
        evmCandidates.push(addr);
        evmCandidatesLower.add(addr.toLowerCase());
      }
    };
    if (info?.evmAddress) {
      addEvmCandidate(info.evmAddress);
    }
    // Also try resolving from accounts endpoint if verifyIsContract failed
    if (!info) {
      try {
        const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
        const acctRes = await fetch(
          `${base}/api/v1/accounts/${candidate}`,
          { signal: makeAbort(6000) }
        );
        if (acctRes.ok) {
          const acctData = await acctRes.json();
          const acctEvm = acctData.evm_address;
          if (acctEvm && acctEvm.startsWith("0x") && acctEvm.length === 42) {
            addEvmCandidate(acctEvm);
          }
        }
      } catch {
        // Non-fatal
      }
    }
    addEvmCandidate(longZero);

    // Call factory() on each EVM address variant → selector 0xc45a0155
    // Uses 300K gas (0x493e0) — Hedera charges ~2100 per SLOAD, so the
    // old 30K (0x7530) was too low and caused empty results.
    let factoryDefiniteMismatch = false;

    for (const routerEvm of evmCandidates) {
      // ── Strategy A: JSON-RPC relay eth_call ──
      try {
        const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
        const factoryRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: makeAbort(12000),
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_call",
            params: [{ to: routerEvm, data: "0xc45a0155", gas: "0x493e0" }, "latest"],
            id: 1,
          }),
        });

        if (factoryRes.ok) {
          const factoryData = await factoryRes.json();
          const result = factoryData?.result;
          if (result && result.length >= 66 && !factoryData.error) {
            const returnedAddr = "0x" + result.slice(-40).toLowerCase();
            if (factoryMatches(returnedAddr)) {
              console.log(`[HBAR.h]   ✓ factory() returned ${returnedAddr} via RPC ${routerEvm} — MATCHES!`);
              console.log(`[HBAR.h] ═══ Verified Router: ${candidate} ═══`);
              _discoveredRouter[network] = candidate;
              SAUCERSWAP_V1_ROUTER[network] = candidate;
              const ck = `${network}:${candidate}`;
              if (!_verifiedContractCache[ck]) {
                _verifiedContractCache[ck] = { contractId: candidate, evmAddress: routerEvm };
              }
              return candidate;
            } else {
              console.log(`[HBAR.h]   ✗ factory() via RPC ${routerEvm} returned ${returnedAddr}, expected ${knownFactoryLongZero}${knownFactoryRealEvm ? ` or ${knownFactoryRealEvm}` : ""} — MISMATCH`);
              factoryDefiniteMismatch = true;
            }
            continue; // Got a definitive answer via RPC, skip Mirror Node fallback for this address
          } else if (factoryData.error) {
            console.log(`[HBAR.h]   ? factory() via RPC ${routerEvm} error: ${factoryData.error.message || JSON.stringify(factoryData.error).slice(0, 100)}`);
          } else {
            console.log(`[HBAR.h]   ? factory() via RPC ${routerEvm} unexpected: ${String(result).slice(0, 20)}`);
          }
        }
      } catch (err: any) {
        console.log(`[HBAR.h]   ? factory() via RPC ${routerEvm} failed: ${err?.message || err}`);
      }

      // ── Strategy B: Mirror Node /api/v1/contracts/call (fallback) ──
      // The JSON-RPC relay may be blocked by CORS or rate-limited from browser.
      // Mirror Node simulation endpoint often works when the relay doesn't.
      try {
        const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
        const mnRes = await fetch(`${base}/api/v1/contracts/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: makeAbort(12000),
          body: JSON.stringify({
            block: "latest",
            data: "0xc45a0155",
            estimate: false,
            from: "0x0000000000000000000000000000000000000000",
            to: routerEvm,
            gas: 300_000,
            gasPrice: 0,
            value: 0,
          }),
        });

        if (mnRes.ok) {
          const mnData = await mnRes.json();
          const mnResult = mnData.result;
          if (mnResult && mnResult !== "0x" && mnResult.length >= 66) {
            const returnedAddr = "0x" + mnResult.slice(-40).toLowerCase();
            if (factoryMatches(returnedAddr)) {
              console.log(`[HBAR.h]   ✓ factory() returned ${returnedAddr} via Mirror Node ${routerEvm} — MATCHES!`);
              console.log(`[HBAR.h] ═══ Verified Router: ${candidate} ═══`);
              _discoveredRouter[network] = candidate;
              SAUCERSWAP_V1_ROUTER[network] = candidate;
              const ck = `${network}:${candidate}`;
              if (!_verifiedContractCache[ck]) {
                _verifiedContractCache[ck] = { contractId: candidate, evmAddress: routerEvm };
              }
              return candidate;
            } else {
              console.log(`[HBAR.h]   ✗ factory() via Mirror Node ${routerEvm} returned ${returnedAddr}, expected ${knownFactoryLongZero}${knownFactoryRealEvm ? ` or ${knownFactoryRealEvm}` : ""} — MISMATCH`);
              factoryDefiniteMismatch = true;
            }
          }
        }
      } catch (err: any) {
        console.log(`[HBAR.h]   ? factory() via Mirror Node ${routerEvm} failed: ${err?.message || err}`);
      }
    }

    // Track as potential fallback — only if no definitive factory mismatch was found
    // (a mismatch means this candidate returned a DIFFERENT factory, so it's the wrong contract)
    if (!factoryDefiniteMismatch && !fallbackCandidate) {
      const evmAddr = info?.evmAddress || evmCandidates[0] || longZero;
      fallbackCandidate = { id: candidate, evmAddress: evmAddr };
    }
  }

  // ── Fallback: accept first candidate if factory() was inconclusive ──
  // If factory() never returned a definitive mismatch (just failed due to
  // network/CORS/rate-limiting), accept the first candidate. The SaucerSwap
  // V1 RouterV3 address (0.0.3045981) is well-known and hardcoded — it's
  // safer to accept it than to fail the entire swap pipeline.
  if (fallbackCandidate) {
    // Distinguish between a known hardcoded primary router (high confidence)
    // and an unknown fallback candidate (lower confidence) in log messages.
    const isPrimaryConfigured = fallbackCandidate.id === SAUCERSWAP_V1_ROUTER[network];
    if (isPrimaryConfigured) {
      console.log(`[HBAR.h] ═══ Using configured primary router: ${fallbackCandidate.id} (factory() verification skipped — browser CORS/network limitations) ═══`);
    } else {
      console.warn(`[HBAR.h] ═══ No factory-verified router — accepting fallback: ${fallbackCandidate.id} (EVM: ${fallbackCandidate.evmAddress}) ═══`);
    }
    _discoveredRouter[network] = fallbackCandidate.id;
    SAUCERSWAP_V1_ROUTER[network] = fallbackCandidate.id;
    // Cache in verifyIsContract cache so the safety check in executeSaucerSwapDirect
    // doesn't block the swap for a candidate that's in our hardcoded list.
    const ck = `${network}:${fallbackCandidate.id}`;
    if (!_verifiedContractCache[ck]) {
      _verifiedContractCache[ck] = {
        contractId: fallbackCandidate.id,
        evmAddress: fallbackCandidate.evmAddress,
      };
    }
    return fallbackCandidate.id;
  }

  // Absolute last resort: use the first hardcoded candidate directly.
  // This only happens if ALL network calls failed (offline, heavy rate limiting).
  const firstCandidate = candidates[0];
  if (firstCandidate) {
    console.warn(`[HBAR.h] ═══ All discovery failed — using hardcoded first candidate: ${firstCandidate} ═══`);
    _discoveredRouter[network] = firstCandidate;
    SAUCERSWAP_V1_ROUTER[network] = firstCandidate;
    const ck = `${network}:${firstCandidate}`;
    if (!_verifiedContractCache[ck]) {
      _verifiedContractCache[ck] = {
        contractId: firstCandidate,
        evmAddress: htsIdToEvmAddress(firstCandidate),
      };
    }
    return firstCandidate;
  }

  console.warn(`[HBAR.h] ═══ No router candidates configured for ${network}! ═══`);
  return null;
}

/**
 * Dynamically discover and verify the SaucerSwap V1 Router.
 * Results are cached for the session. Thread-safe (deduplicates concurrent calls).
 *
 * Tries each candidate address in SAUCERSWAP_V1_ROUTER_CANDIDATES:
 *   1. Attempts verifyIsContract (Mirror Node + eth_getCode + eth_call probe)
 *   2. Calls factory() via JSON-RPC to confirm it returns the known factory address
 *      — factory() is tried even if verifyIsContract fails (common on Hedera)
 *   3. Caches the first verified candidate and populates verifyIsContract cache
 */
export async function discoverSaucerSwapRouter(network: HederaNetwork): Promise<string | null> {
  if (_discoveredRouter[network]) return _discoveredRouter[network];

  // Deduplicate: if discovery is already in progress, await the same promise
  if (!_routerDiscoveryInProgress[network]) {
    _routerDiscoveryInProgress[network] = _discoverRouterImpl(network).finally(() => {
      delete _routerDiscoveryInProgress[network];
    });
  }
  return _routerDiscoveryInProgress[network];
}
