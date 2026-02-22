/**
 * [C96] Hedera SDK — Static Import Module
 *
 * The @hashgraph/sdk is imported STATICALLY here so Vite bundles it
 * as part of the dependency graph instead of creating a dynamic chunk.
 *
 * PROBLEM: `await import("@hashgraph/sdk")` fails in the Figma Make
 * dev proxy because the dynamically-split chunk URL can't be fetched:
 *   "Failed to fetch dynamically imported module:
 *    https://app-...makeproxy-c.figma.site/node_modules/.vite/deps/@hashgraph_sdk.js"
 *
 * SOLUTION: Single static import, re-export only what we need.
 * All files import from this module instead of doing dynamic imports.
 *
 * This adds to the main bundle but eliminates runtime chunk loading
 * failures that block ALL swap operations.
 */

// Re-export all SDK classes used across the codebase
export {
  ContractExecuteTransaction,
  ContractId,
  Hbar,
  AccountAllowanceApproveTransaction,
  TokenAssociateTransaction,
  AccountId,
  TokenId,
  TransactionId,
  Long,
  ContractFunctionParameters,
  TransferTransaction,
} from "@hashgraph/sdk";