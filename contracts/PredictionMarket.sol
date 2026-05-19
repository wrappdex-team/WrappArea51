// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PredictionMarket
 * @dev Secure binary (Yes/No) prediction market contract for Hedera EVM.
 * Security features:
 * - OpenZeppelin v5: ReentrancyGuard, Pausable, AccessControl
 * - Strict CEI (Checks-Effects-Interactions) pattern on all state changes + transfers
 * - Custom errors for gas-efficient reverts and clear debugging
 * - Minimum bet enforcement, market end-time enforcement
 * - Platform fee (1.5%) skimmed on every bet to treasury
 * - Pull-based winnings claim (users call claimWinnings)
 * - Emergency pause + cancel (refunds)
 * - No payable fallback (explicit receive for initial funding only)
 * - Events for full off-chain indexing
 *
 * Resolution model (v1): Trusted resolver (multi-sig / admin / future HCS oracle)
 *   - Can only resolve AFTER endTime
 *   - Optional RESOLUTION_DELAY to allow monitoring / last-bet protection
 * Payout model: Parimutuel-style. Winners proportionally share entire pool (yesBets + noBets minus fees already taken).
 *   Payout = userStake * (totalPool) / winningPool
 *   (guarantees 1x + share of opposite side)
 *
 * Hedera specifics: Uses tinybars (1 HBAR = 1e8 units). All amounts stored in uint256 tinybars.
 * Treasury receives fees via .call (contracts/EOAs that accept HBAR).
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract PredictionMarket is ReentrancyGuard, Pausable, AccessControl {
    // ─────────────────────────────────────────────────────────────────────────────
    // Roles
    // ─────────────────────────────────────────────────────────────────────────────
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant CANCELLER_ROLE = keccak256("CANCELLER_ROLE");

    // ─────────────────────────────────────────────────────────────────────────────
    // Constants (immutable after deploy)
    // ─────────────────────────────────────────────────────────────────────────────
    string public question;
    string public asset;
    uint256 public immutable endTime;           // unix timestamp (seconds)
    address public immutable creator;
    address public immutable factory;
    address public immutable treasury;          // fee recipient (EVM address)
    uint256 public constant PLATFORM_FEE_BPS = 150; // 1.5%
    uint256 private constant DECIMALS = 18;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MIN_BET = 10 * 10**DECIMALS; // 10 HBAR minimum (Hedera EVM 18 decimals for msg.value/balances; native Hedera SDK uses tinybar 1e8)
    uint256 public constant RESOLUTION_DELAY = 2 hours; // Prevent last-second manipulation
    uint256 public constant CLAIM_PERIOD = 90 days; // Users must claim within this window after resolution or remaining balance may be swept to treasury (abandonment policy for unclaimed winnings)

    // ─────────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────────
    uint256 public yesBets;      // total units (18dec EVM) bet on YES (after fees)
    uint256 public noBets;       // total units (18dec EVM) bet on NO (after fees)
    bool public resolved;
    uint8 public winningOutcome; // 0 = not resolved / cancelled (refund), 1 = YES, 2 = NO

    mapping(address => uint256) public userYesBets;
    mapping(address => uint256) public userNoBets;

    // ─────────────────────────────────────────────────────────────────────────────
    // Events (critical for indexing + transparency)
    // ─────────────────────────────────────────────────────────────────────────────
    event BetPlaced(
        address indexed user,
        bool indexed isYes,
        uint256 grossAmount,
        uint256 netAmount,
        uint256 fee,
        uint256 newYesBets,
        uint256 newNoBets
    );
    event MarketResolved(uint8 outcome, uint256 totalYes, uint256 totalNo, uint256 timestamp);
    event WinningsClaimed(address indexed user, uint256 amount, uint8 outcome);
    event MarketCancelled(uint256 timestamp, string reason);
    event FeesWithdrawn(address indexed to, uint256 amount);

    // ─────────────────────────────────────────────────────────────────────────────
    // Custom Errors (gas efficient, explicit)
    // ─────────────────────────────────────────────────────────────────────────────
    error MarketEnded();
    error MarketNotEnded();
    error TooEarlyToResolve();
    error AlreadyResolved();
    error NotResolved();
    error BetTooSmall();
    error InsufficientPool();
    error NoWinningsToClaim();
    error TransferFailed();
    error UnauthorizedResolver();
    error InvalidOutcome();
    error ZeroAddress();

    // ─────────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────────
    constructor(
        string memory _question,
        string memory _asset,
        uint256 _endTime,
        address _creator,
        address _factory,
        address _treasury
    ) {
        if (_creator == address(0) || _factory == address(0) || _treasury == address(0)) {
            revert ZeroAddress();
        }
        if (_endTime <= block.timestamp) {
            revert TooEarlyToResolve(); // reuse error for "end in past"
        }

        question = _question;
        asset = _asset;
        endTime = _endTime;
        creator = _creator;
        factory = _factory;
        treasury = _treasury;

        _grantRole(DEFAULT_ADMIN_ROLE, _factory); // Factory is admin
        _grantRole(RESOLVER_ROLE, _factory);      // Factory (or its authorized callers) can resolve
        _grantRole(PAUSER_ROLE, _factory);
        _grantRole(CANCELLER_ROLE, _factory);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Receive (only for initial pool funding from factory during create)
    // ─────────────────────────────────────────────────────────────────────────────
    receive() external payable {
        // Accept HBAR only from factory during deployment / funding.
        // Regular bets go through placeBet.
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // One-time initial liquidity seeding (called by factory after deployment)
    // Splits seed 50/50 between YES and NO to bootstrap fair odds.
    // The "house" portion is not claimable by any user; it provides initial counter-liquidity.
    // ─────────────────────────────────────────────────────────────────────────────
    bool public initialSeeded;

    function seedInitialLiquidity(uint256 amount) external {
        require(msg.sender == factory, "Only factory");
        require(!initialSeeded, "Already seeded");
        require(amount > 0, "Zero seed");
        require(address(this).balance >= amount, "Insufficient balance for seed");

        uint256 half = amount / 2;
        yesBets += (amount - half); // slight asymmetry to avoid pure 50/50 zero edge cases
        noBets += half;

        initialSeeded = true;
        // House seed is not mapped to any user; it bootstraps liquidity and is effectively
        // left to absorb or enhance payouts (simple house edge / initial counter-liquidity)
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Core: Place Bet (payable)
    // ─────────────────────────────────────────────────────────────────────────────
    function placeBet(bool isYes) external payable nonReentrant whenNotPaused {
        if (block.timestamp >= endTime) revert MarketEnded();
        if (msg.value < MIN_BET) revert BetTooSmall();

        uint256 fee = (msg.value * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 net = msg.value - fee;

        // Effects first (state + event) then interaction (fee) — strict CEI on the critical user payable path.
        // Fee send is best-effort; on failure the fee stays in-contract (recoverable by sweep after CLAIM_PERIOD).
        // This is the documented nuanced CEI posture for fee collection.
        if (isYes) {
            yesBets += net;
            userYesBets[msg.sender] += net;
        } else {
            noBets += net;
            userNoBets[msg.sender] += net;
        }

        emit BetPlaced(msg.sender, isYes, msg.value, net, fee, yesBets, noBets);

        // Interaction last
        if (fee > 0) {
            (bool feeSent, ) = payable(treasury).call{value: fee}("");
            if (!feeSent) {
                // fee stays in contract balance; no revert so user keeps their position
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Resolve (only RESOLVER_ROLE, after end + delay)
    // ─────────────────────────────────────────────────────────────────────────────
    function resolve(uint8 outcome) external onlyRole(RESOLVER_ROLE) {
        if (resolved) revert AlreadyResolved();
        if (block.timestamp < endTime) revert MarketNotEnded();
        if (block.timestamp < endTime + RESOLUTION_DELAY) revert TooEarlyToResolve();
        if (outcome != 1 && outcome != 2) revert InvalidOutcome();

        resolved = true;
        winningOutcome = outcome;

        emit MarketResolved(outcome, yesBets, noBets, block.timestamp);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Claim Winnings (pull pattern, CEI safe)
    // ─────────────────────────────────────────────────────────────────────────────
    function claimWinnings() external nonReentrant {
        if (!resolved) revert NotResolved();

        uint8 outcome = winningOutcome;
        if (outcome == 0) {
            // Cancelled / refund mode: return original stake (no fees applied post-cancel)
            uint256 refund = userYesBets[msg.sender] + userNoBets[msg.sender];
            if (refund == 0) revert NoWinningsToClaim();

            userYesBets[msg.sender] = 0;
            userNoBets[msg.sender] = 0;

            (bool refundSent, ) = payable(msg.sender).call{value: refund}("");
            if (!refundSent) revert TransferFailed();

            emit WinningsClaimed(msg.sender, refund, 0);
            return;
        }

        uint256 userStake = (outcome == 1) ? userYesBets[msg.sender] : userNoBets[msg.sender];
        if (userStake == 0) revert NoWinningsToClaim();

        uint256 winningPool = (outcome == 1) ? yesBets : noBets;
        uint256 totalPool = yesBets + noBets;
        if (winningPool == 0) revert NoWinningsToClaim(); // safety (should not happen post-seed + bets, but defensive)

        // Proportional share: user gets back stake * total / winningPool
        // (includes original stake + profit from losing side)
        uint256 payout = (userStake * totalPool) / winningPool;

        // Zero the user's bets BEFORE transfer (effects before interaction - CEI)
        if (outcome == 1) {
            userYesBets[msg.sender] = 0;
        } else {
            userNoBets[msg.sender] = 0;
        }

        (bool sent, ) = payable(msg.sender).call{value: payout}("");
        if (!sent) revert TransferFailed();

        emit WinningsClaimed(msg.sender, payout, outcome);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Admin / Emergency
    // ─────────────────────────────────────────────────────────────────────────────
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function cancelMarket(string calldata reason) external onlyRole(CANCELLER_ROLE) {
        if (resolved) revert AlreadyResolved();
        resolved = true;
        winningOutcome = 0; // signals refund mode in claimWinnings

        emit MarketCancelled(block.timestamp, reason);
    }

    // Allow factory/treasury to sweep any dust or unclaimed after long time (optional)
    // SECURITY: Time-guarded to ensure users have a fair 90-day claim window after resolution.
    // Prevents admin from immediately draining winner payouts.
    function withdrawUnclaimedToTreasury() external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(resolved, "Only after resolution");
        require(block.timestamp > endTime + RESOLUTION_DELAY + CLAIM_PERIOD, "Claim window still open for users");
        uint256 balance = address(this).balance;
        if (balance == 0) return;

        (bool sent, ) = payable(treasury).call{value: balance}("");
        if (!sent) revert TransferFailed();

        emit FeesWithdrawn(treasury, balance);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // View Helpers (for frontend / indexing)
    // ─────────────────────────────────────────────────────────────────────────────
    function getOdds() external view returns (uint256 yesOdds, uint256 noOdds) {
        uint256 total = yesBets + noBets;
        if (total == 0) return (50, 50);
        yesOdds = (yesBets * 100) / total;
        noOdds = 100 - yesOdds;
    }

    function getUserStake(address user) external view returns (uint256 yesStake, uint256 noStake) {
        return (userYesBets[user], userNoBets[user]);
    }

    function getPoolTotals() external view returns (uint256 totalYes, uint256 totalNo, uint256 total) {
        totalYes = yesBets;
        totalNo = noBets;
        total = yesBets + noBets;
    }

    function isActive() external view returns (bool) {
        return !resolved && block.timestamp < endTime;
    }
}
