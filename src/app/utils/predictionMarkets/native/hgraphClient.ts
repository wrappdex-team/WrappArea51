/**
 * HGraph MCP Client for WrappArea51 Prediction Markets
 * 
 * Primary source of truth for HCS topic messages on Testnet.
 * Fixed: topicId is String! (HGraph schema requirement).
 */

// Using Vite's import.meta.env with explicit typing for reliability across workspaces
const HGRAPH_API_KEY = (import.meta as any).env?.VITE_HGRAPH_API_KEY || "sk_prod_bdc6459b669dd01dfed5e4af9d28eabf5b20dd25";

const HGRAPH_TESTNET_URL = "https://testnet.hedera.api.hgraph.io/v1/graphql";

interface HGraphResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

export async function queryHGraph<T>(
  query: string, 
  variables: Record<string, any> = {}
): Promise<T | null> {
  try {
    const response = await fetch(HGRAPH_TESTNET_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': HGRAPH_API_KEY,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      console.error('[HGraph] HTTP error', response.status);
      return null;
    }

    const json: HGraphResponse<T> = await response.json();

    if (json.errors) {
      console.error('[HGraph] GraphQL errors:', json.errors);
      return null;
    }

    return json.data;
  } catch (error) {
    console.error('[HGraph] Query failed:', error);
    return null;
  }
}

export async function getTopicMessages(topicId: string, limit = 50) {
  const query = `
    query GetTopicMessages($topicId: String!, $limit: Int) {
      topic_message(
        where: { topic_id: { _eq: $topicId } }
        order_by: { consensus_timestamp: desc }
        limit: $limit
      ) {
        consensus_timestamp
        message
        payer_account_id
      }
    }
  `;

  return queryHGraph(query, { topicId, limit });
}

/**
 * Reliable topic messages for UI claimables/history.
 * Tries HGraph then falls back to Hedera Mirror Node REST (raw consensus, same as HashScan).
 * Ensures players always see their PLACE_BET records and win/loss even during indexer lag.
 */
export async function getTopicMessagesReliable(topicId: string, limit = 1000) {
  const numeric = topicId.split('.').pop();
  const mirror = 'https://testnet.mirror.hedera.com';
  const results: any[] = [];
  const seen = new Set<string>();

  // Try HGraph first
  try {
    const hg = await getTopicMessages(topicId, limit);
    const arr = hg?.topic_message || [];
    for (const m of arr) {
      const key = m.consensus_timestamp || JSON.stringify(m).slice(0, 60);
      if (!seen.has(key)) { seen.add(key); results.push(m); }
    }
  } catch {}

  // Mirror REST fallback / union (base64 message)
  // Use order=desc so that when HGraph lags we still get the *most recent* messages
  // (critical for live fast game volume tracking from bets by any wallet).
  try {
    const url = `${mirror}/api/v1/topics/${numeric}/messages?limit=${Math.min(limit, 2000)}&order=desc`;
    const r = await fetch(url);
    if (r.ok) {
      const data = await r.json();
      for (const m of data.messages || []) {
        const key = m.consensus_timestamp || m.sequence_number;
        if (!seen.has(String(key))) {
          seen.add(String(key));
          // Normalize shape expected by callers: { message, consensus_timestamp, ... }
          results.push({
            message: m.message, // base64
            consensus_timestamp: m.consensus_timestamp,
            payer_account_id: m.payer_account_id,
          });
        }
      }
    }
  } catch (e) {
    // non-fatal
  }

  return { topic_message: results };
}