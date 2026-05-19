/**
 * Deployment script for WRAPPDEX Prediction Market Engine on Hedera EVM.
 *
 * Usage:
 *   npx hardhat run contracts/scripts/deploy-prediction-markets.ts --network hederaTestnet
 *
 * Security:
 * - Requires HEDERA_EVM_PRIVATE_KEY in .env (deployer must be funded with HBAR on EVM side)
 * - Treasury defaults to deployer unless PREDICTION_TREASURY_ADDRESS set
 * - After deploy, transfer admin roles to a secure multisig / DAO contract
 * - Verify contracts on HashScan / Sourcify if supported
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying Prediction Markets with account:", deployer.address);
  console.log("Account balance (HBAR):", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  const treasuryAddr = process.env.PREDICTION_TREASURY_ADDRESS || deployer.address;
  console.log("Treasury (fee recipient):", treasuryAddr);

  // 1. Deploy Factory
  const Factory = await ethers.getContractFactory("MarketFactory");
  const factory = await Factory.deploy(treasuryAddr);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("MarketFactory deployed to:", factoryAddr);

  // 2. Optionally seed 3-4 demo markets for immediate UX (testnet only recommended)
  const isTestnet = (await ethers.provider.getNetwork()).chainId === 296n;
  if (isTestnet && process.env.SEED_DEMO_MARKETS !== "false") {
    console.log("Seeding demo markets on testnet...");

    const now = Math.floor(Date.now() / 1000);
    const samples = [
      {
        q: "Will BTC reach $95,000 by June 30?",
        a: "BTC",
        end: now + 86400 * 23, // ~23 days
        liq: ethers.parseEther("1200"),
      },
      {
        q: "Will ETH close above $3,200 this week?",
        a: "ETH",
        end: now + 86400 * 5,
        liq: ethers.parseEther("850"),
      },
      {
        q: "Will HBAR hit $0.15 before July?",
        a: "HBAR",
        end: now + 86400 * 12,
        liq: ethers.parseEther("600"),
      },
    ];

    for (const s of samples) {
      const fee = ethers.parseEther("5");
      const tx = await factory.createMarket(s.q, s.a, s.end, { value: fee + s.liq });
      const rc = await tx.wait();
      console.log(`  Created: ${s.a} - ${s.q}  (tx: ${rc?.hash?.slice(0, 10)}...)`);
    }
  }

  // 3. Output addresses for frontend config
  const out = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    factory: factoryAddr,
    treasury: treasuryAddr,
    deployedAt: new Date().toISOString(),
    note: "Update src/app/utils/predictionMarkets.ts with these addresses. Grant RESOLVER_ROLE to a secure account after deploy.",
  };

  const outPath = path.join(__dirname, "../deployment.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("\nDeployment metadata written to contracts/deployment.json");
  console.log("Add to your .env (frontend + scripts):");
  console.log(`PREDICTION_MARKET_FACTORY_ADDRESS_TESTNET=${factoryAddr}`);
  console.log("Next steps: npx hardhat verify --network hederaTestnet (if verifier available)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
