import { Client, PrivateKey, TopicMessageSubmitTransaction, TopicMessageQuery } from "@hashgraph/sdk";
import dotenv from "dotenv";

dotenv.config();

async function testTopic() {
  const client = Client.forTestnet();
  const operatorKey = PrivateKey.fromStringED25519(process.env.HEDERA_TESTNET_OPERATOR_KEY!);
  client.setOperator(process.env.HEDERA_TESTNET_OPERATOR_ID!, operatorKey);

  const TOPIC_ID = process.env.PREDICTION_MARKETS_MASTER_TOPIC_ID!;

  console.log("Testing Master Topic:", TOPIC_ID);

  // Send a test message
  const message = `Test market message - ${new Date().toISOString()}`;
  const submitTx = await new TopicMessageSubmitTransaction()
    .setTopicId(TOPIC_ID)
    .setMessage(message)
    .execute(client);

  console.log("✅ Test message submitted successfully!");

  // Wait a moment and query recent messages
  console.log("Waiting 2 seconds to query messages...");
  await new Promise(r => setTimeout(r, 2000));

  console.log("Recent messages:");
  new TopicMessageQuery()
    .setTopicId(TOPIC_ID)
    .setStartTime(0)
    .subscribe(client, (msg) => {
      console.log(`[${new Date(msg.consensusTimestamp.toDate()).toLocaleTimeString()}] ${msg.contents.toString()}`);
    });

  // Keep script alive for 5 seconds to see messages
  setTimeout(() => {
    console.log("\n✅ Topic test complete. You can Ctrl+C now.");
    client.close();
  }, 5000);
}

testTopic().catch(console.error);
