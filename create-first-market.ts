import { Client, PrivateKey, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import dotenv from "dotenv";

dotenv.config();

async function createFirstMarket() {
  const client = Client.forTestnet();
  const operatorKey = PrivateKey.fromStringED25519(process.env.HEDERA_TESTNET_OPERATOR_KEY!);
  client.setOperator(process.env.HEDERA_TESTNET_OPERATOR_ID!, operatorKey);

  const TOPIC_ID = process.env.PREDICTION_MARKETS_MASTER_TOPIC_ID!;

  console.log("🚀 Creating FIRST LIVE Prediction Market on native HCS Topic...");

  const marketData = {
    type: "MARKET_CREATED",
    marketId: "market-" + Date.now(),
    question: "Will HBAR reach $0.15 before July 31, 2026?",
    description: "First native test market on Wrappdex - Pure Hashgraph",
    endTime: Math.floor(Date.now() / 1000) + (86400 * 30), // 30 days
    category: "crypto",
    creator: process.env.HEDERA_TESTNET_OPERATOR_ID!,
    timestamp: Date.now()
  };

  const message = JSON.stringify(marketData);

  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(TOPIC_ID)
    .setMessage(message)
    .execute(client);

  const receipt = await tx.getReceipt(client);

  console.log("✅ FIRST MARKET CREATED SUCCESSFULLY!");
  console.log("Topic ID:", TOPIC_ID);
  console.log("Transaction ID:", receipt.transactionId?.toString());
  console.log("Market ID:", marketData.marketId);
  console.log("\nYou can now view this market in the Prediction Markets tab (refresh the page).");

  client.close();
}

createFirstMarket().catch(console.error);
