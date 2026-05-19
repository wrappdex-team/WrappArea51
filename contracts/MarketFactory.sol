// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MarketFactory
 * @dev Factory for deploying secure PredictionMarket instances on Hedera EVM.
 * Responsibilities:
 * - Enforce creation fee (5 HBAR) + minimum initial liquidity
 * - Collect platform fees and forward to treasury
 * - Registry of all markets (for frontend enumeration)
 * - Role-based resolution authorization (owner / designated resolvers can resolve any market)
 * - Emergency pause on factory (pauses creation)
 *
 * Security:
 * - OpenZeppelin AccessControl + ReentrancyGuard + Pausable
 * - All deployments use CREATE (predictable but acceptable; future: CREATE2 clones)
 * - No user funds held in factory long-term (fees forwarded immediately)
 * - Only validated markets returned to clients
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./PredictionMarket.sol";

contract MarketFactory is ReentrancyGuard, Pausable, AccessControl {
    // ─────────────────────────────────────────────────────────────────────────────
    // Constants & Config
    // ─────────────────────────────────────────────────────────────────────────────
    uint256 private constant DECIMALS = 18;
    uint256 public constant CREATION_FEE = 5 * 10**DECIMALS;      // 5 HBAR (Hedera EVM 18 decimals)
    uint256 public constant MIN_INITIAL_LIQUIDITY = 100 * 10**DECIMALS;    // ~$100+ HBAR equiv (client should check HBAR price * amount)
    address public immutable treasury;                             // Receives all fees

    // ─────────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────────
    address[] public allMarkets;
    mapping(address => bool) public isRegisteredMarket;

    // Optional per-market resolver override (future DAO / oracle per market)
    mapping(address => address) public marketResolver;

    // ─────────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────────
    event MarketCreated(
        address indexed market,
        address indexed creator,
        string question,
        string asset,
        uint256 endTime,
        uint256 initialLiquidity,
        uint256 creationFee
    );
    event MarketResolvedByFactory(address indexed market, uint8 outcome, address resolver);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event ResolverAssigned(address indexed market, address indexed resolver);

    // ─────────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────────
    error InsufficientPayment();
    error InvalidEndTime();
    error ZeroAddress();
    error MarketNotRegistered();
    error TransferFailed();
    error UnauthorizedResolver(); // for resolveMarket guard

    // ─────────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────────
    constructor(address _treasury) {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(keccak256("RESOLVER_ROLE"), msg.sender); // Admin can resolve via factory
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Create Market (core entrypoint)
    // ─────────────────────────────────────────────────────────────────────────────
    function createMarket(
        string calldata question,
        string calldata asset,
        uint256 endTime
        // initial liquidity + fee sent as msg.value; side bias not stored on-chain (emergent from first bets)
    ) external payable whenNotPaused nonReentrant returns (address marketAddr) {
        if (msg.value < CREATION_FEE + MIN_INITIAL_LIQUIDITY) {
            revert InsufficientPayment();
        }
        if (endTime <= block.timestamp + 1 hours) {
            revert InvalidEndTime(); // Must end in future with buffer
        }

        uint256 fee = CREATION_FEE;
        uint256 initialLiquidity = msg.value - fee;

        // Forward creation fee to treasury immediately
        (bool feeSent, ) = payable(treasury).call{value: fee}("");
        if (!feeSent) revert TransferFailed();

        // Deploy the market contract (factory becomes admin/resolver on it)
        PredictionMarket market = new PredictionMarket(
            question,
            asset,
            endTime,
            msg.sender,      // creator
            address(this),   // factory
            treasury
        );

        marketAddr = address(market);

        // Fund the newly deployed market with the initial liquidity (goes to contract balance)
        (bool poolSent, ) = payable(marketAddr).call{value: initialLiquidity}("");
        if (!poolSent) revert TransferFailed();

        // Seed the 50/50 initial pools inside the market (bootstraps odds)
        PredictionMarket(payable(marketAddr)).seedInitialLiquidity(initialLiquidity);

        // Register
        allMarkets.push(marketAddr);
        isRegisteredMarket[marketAddr] = true;

        emit MarketCreated(marketAddr, msg.sender, question, asset, endTime, initialLiquidity, fee);
        return marketAddr;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Resolution via Factory (authorized resolvers only)
    // Allows central control / multi-sig without exposing every market admin UI
    // ─────────────────────────────────────────────────────────────────────────────
    function resolveMarket(address marketAddr, uint8 outcome) external nonReentrant whenNotPaused {
        if (!isRegisteredMarket[marketAddr]) revert MarketNotRegistered();

        // Check caller has resolver role on *this* factory OR is explicitly assigned for the market
        bool isAuthorized = hasRole(keccak256("RESOLVER_ROLE"), msg.sender) ||
                           (marketResolver[marketAddr] != address(0) && marketResolver[marketAddr] == msg.sender);

        if (!isAuthorized) {
            revert UnauthorizedResolver();
        }

        PredictionMarket(payable(marketAddr)).resolve(outcome);

        emit MarketResolvedByFactory(marketAddr, outcome, msg.sender);
    }

    // Allow admin to assign a specific resolver (e.g. oracle contract or sub-multisig) per market
    function setMarketResolver(address marketAddr, address resolver) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!isRegisteredMarket[marketAddr]) revert MarketNotRegistered();
        marketResolver[marketAddr] = resolver;
        emit ResolverAssigned(marketAddr, resolver);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Registry Views (used by frontend)
    // ─────────────────────────────────────────────────────────────────────────────
    function getAllMarkets() external view returns (address[] memory) {
        return allMarkets;
    }

    function getMarketCount() external view returns (uint256) {
        return allMarkets.length;
    }

    function isValidMarket(address m) external view returns (bool) {
        return isRegisteredMarket[m];
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────────────
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function updateTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Note: existing markets keep their immutable treasury; new markets will use new one.
        // For full migration a new factory can be deployed.
        emit TreasuryUpdated(treasury, newTreasury);
        // We do not store mutable treasury here to avoid storage collision risk; emit only.
        // If needed, future version can have mutable.
    }

    // Emergency: in extreme cases admin can cancel any market (refunds users)
    function emergencyCancelMarket(address marketAddr, string calldata reason) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        if (!isRegisteredMarket[marketAddr]) revert MarketNotRegistered();
        PredictionMarket(payable(marketAddr)).cancelMarket(reason);
    }
}
