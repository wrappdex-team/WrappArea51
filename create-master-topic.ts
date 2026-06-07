import { Client, PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import dotenv from "dotenv";

dotenv.config();

async function createMasterTopic() {
  const client = Client.forTestnet();
  
  const operatorKey = PrivateKey.fromStringED25519(process.env.HEDERA_TESTNET_OPERATOR_KEY!);
  client.setOperator(process.env.HEDERA_TESTNET_OPERATOR_ID!, operatorKey);

  console.log("🔨 Creating Master HCS Topic for Wrappdex Prediction Markets...");

  // Create the topic
  const tx = await new TopicCreateTransaction()
    .setTopicMemo("Wrappdex Prediction Markets - Master Topic v1")
    .setAdminKey(operatorKey.publicKey)
    .setSubmitKey(operatorKey.publicKey)
    .freezeWith(client);

  const signedTx = await tx.sign(operatorKey);
  
  // FIXED: Proper modern SDK pattern
  const txResponse = await signedTx.execute(client);
  const receipt = await txResponse.getReceipt(client);

  const topicId = receipt.topicId!.toString();
  
  console.log("✅ Master HCS Topic Created Successfully!");
  console.log(`Topic ID: ${topicId}`);
  console.log(`\nAdd this line to your .env file:`);
  console.log(`PREDICTION_MARKETS_MASTER_TOPIC_ID=${topicId}`);

  // Send welcome message
  await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage("🚀 Wrappdex Prediction Markets Master Topic Initialized - Native Hashgraph Engine v1")
    .execute(client);

  console.log("✅ Welcome message sent to topic.");
  client.close();
}

createMasterTopic().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
