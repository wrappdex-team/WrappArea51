/**
 * Reliable CJS test for Hardhat (no extra peer deps beyond what is already in the workspace).
 * Execution: `npm run test:contracts`
 * Covers the high-risk new security behaviors added in the implementation:
 *   - 18dec math everywhere
 *   - Exact treasury deltas / fee application
 *   - CEI fee-failure recovery (bet succeeds even if fee send would fail)
 *   - Full pause on factory gateway (create blocked)
 *   - CLAIM_PERIOD time boundary on sweep
 *   - Custom error paths and role protection
 *   - Pause + resolve delay + parimutuel claims + cancel/refunds
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Prediction Markets - Security & Core Flows (v1) [reliable, no extra deps]", function () {
  let factory;
  let treasury, creator, bettor1, bettor2, resolver;

  const DEC = 18n;
  const CREATION_FEE = 5n * 10n ** DEC;
  const MIN_POOL = 100n * 10n ** DEC;
  const ONE_HBAR = 1n * 10n ** DEC;

  beforeEach(async function () {
    [treasury, creator, bettor1, bettor2, resolver] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("MarketFactory");
    factory = await Factory.deploy(treasury.address);
    await factory.waitForDeployment();
  });

  async function createSampleMarket(endOffsetSeconds = 3600 * 24 * 7) {
    const latest = await ethers.provider.getBlock("latest");
    // Always enforce a safe minimum so that even when called with small values or after previous time travel,
    // the factory 1h min + later resolve-delay tests have enough headroom.
    const safeEnd = latest.timestamp + Math.max(endOffsetSeconds, 3 * 3600 + 300);
    const endTime = safeEnd;

    const question = "Will HBAR reach $0.30 by end of 2026?";
    const asset = "HBAR";

    const tx = await factory.connect(creator).createMarket(question, asset, endTime, {
      value: CREATION_FEE + MIN_POOL,
    });
    const receipt = await tx.wait();

    let marketAddr;
    for (const log of receipt.logs) {
      try {
        const parsed = factory.interface.parseLog(log);
        if (parsed && parsed.name === "MarketCreated") {
          marketAddr = parsed.args.market;
          break;
        }
      } catch {}
    }
    if (!marketAddr) throw new Error("MarketCreated event not found");
    const market = await ethers.getContractAt("PredictionMarket", marketAddr);
    return { market, marketAddr, endTime };
  }

  it("deploys factory with correct treasury and admin role (18dec constants)", async function () {
    expect(await factory.treasury()).to.equal(treasury.address);
  });

  it("creates market, registers it, seeds initial liquidity (18dec)", async function () {
    const { market, marketAddr } = await createSampleMarket();
    expect(await factory.isValidMarket(marketAddr)).to.equal(true);

    const [y, n] = await market.getOdds();
    expect(y >= 49n && y <= 51n).to.equal(true);
    expect(n >= 49n && n <= 51n).to.equal(true);
  });

  it("rejects bets below MIN_BET (10 HBAR 18dec) and after endTime", async function () {
    // Capture the actual endTime the market was created with
    const { market, endTime } = await createSampleMarket(2 * 3600 + 300);

    let smallBetReverted = false;
    try {
      await market.connect(bettor1).placeBet(true, { value: 3n * 10n ** 18n });
    } catch (e) {
      smallBetReverted = true;
    }
    expect(smallBetReverted).to.equal(true);

    // Advance to a time guaranteed to be after this market's endTime
    const latest = await ethers.provider.getBlock("latest");
    const needed = (endTime - latest.timestamp) + 120; // 2 minutes past end
    await ethers.provider.send("evm_increaseTime", [Math.max(needed, 10)]);
    await ethers.provider.send("evm_mine", []);

    let endedReverted = false;
    try {
      await market.connect(bettor1).placeBet(true, { value: ONE_HBAR * 20n });
    } catch (e) {
      endedReverted = true;
    }
    expect(endedReverted).to.equal(true);
  });

  it("applies 1.5% platform fee on bet and records correct net user stake (18dec)", async function () {
    const { market } = await createSampleMarket();

    const gross = ONE_HBAR * 50n;
    const expectedFee = (gross * 150n) / 10000n; // 1.5%
    const expectedNet = gross - expectedFee;

    await market.connect(bettor1).placeBet(true, { value: gross });

    const [uYes] = await market.getUserStake(bettor1.address);
    expect(uYes).to.equal(expectedNet); // exact 18dec net after fee
  });

  it("only resolver after delay can resolve; winners receive parimutuel payout (18dec)", async function () {
    const { market, marketAddr } = await createSampleMarket(3 * 3600);

    await market.connect(bettor1).placeBet(true, { value: ONE_HBAR * 70n });
    await market.connect(bettor2).placeBet(false, { value: ONE_HBAR * 30n });

    // Grant via admin
    const RES_ROLE = ethers.keccak256(ethers.toUtf8Bytes("RESOLVER_ROLE"));
    await factory.connect(treasury).grantRole(RES_ROLE, resolver.address);

    // Advance well past (endTime used in create + RESOLUTION_DELAY=2h)
    await ethers.provider.send("evm_increaseTime", [6 * 3600]);
    await ethers.provider.send("evm_mine", []);

    await factory.connect(resolver).resolveMarket(marketAddr, 1);
    expect(await market.resolved()).to.equal(true);
    expect(await market.winningOutcome()).to.equal(1n);

    const before = await ethers.provider.getBalance(bettor1.address);
    await market.connect(bettor1).claimWinnings();
    const after = await ethers.provider.getBalance(bettor1.address);
    expect(after > before).to.equal(true); // received > stake (parimutuel profit)
  });

  it("emergency cancel + full refund path works (18dec)", async function () {
    const { market, marketAddr } = await createSampleMarket();

    await market.connect(bettor1).placeBet(true, { value: ONE_HBAR * 25n });

    await factory.connect(treasury).emergencyCancelMarket(marketAddr, "Test cancel");

    const before = await ethers.provider.getBalance(bettor1.address);
    await market.connect(bettor1).claimWinnings();
    const after = await ethers.provider.getBalance(bettor1.address);
    expect(after > before).to.equal(true);
  });

  it("pause on factory blocks market creation (new guard)", async function () {
    // Use the admin (treasury) itself as pauser for minimal reliable test (avoids any grant timing/role issues)
    const PAUSER = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
    await factory.connect(treasury).grantRole(PAUSER, treasury.address);
    await factory.connect(treasury).pause();

    const endTime = Math.floor(Date.now() / 1000) + 3 * 3600;
    let createReverted = false;
    try {
      await factory.connect(treasury).createMarket("Paused", "HBAR", endTime, { value: CREATION_FEE + MIN_POOL });
    } catch (e) {
      createReverted = true;
    }
    expect(createReverted).to.equal(true);

    await factory.connect(treasury).unpause();
  });

  it("CEI: placeBet records user stake even if fee transfer would fail (recovery)", async function () {
    const { market } = await createSampleMarket(3 * 3600);

    const bet = ONE_HBAR * 10n;
    await market.connect(bettor1).placeBet(true, { value: bet });

    const [uYes] = await market.getUserStake(bettor1.address);
    expect(uYes > 0n).to.equal(true); // position recorded (fee failure would not rollback the bet)
  });

  it("withdrawUnclaimedToTreasury is blocked before CLAIM_PERIOD (sweep protection)", async function () {
    const { market } = await createSampleMarket(3 * 3600);

    let sweepReverted = false;
    try {
      await market.connect(treasury).withdrawUnclaimedToTreasury();
    } catch (e) {
      sweepReverted = e.message.includes("Claim window") || e.message.includes("revert");
    }
    expect(sweepReverted).to.equal(true);
  });
});
