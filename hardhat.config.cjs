require("dotenv").config();
require("@nomicfoundation/hardhat-ethers"); // Explicit, lightweight plugin for reliable ethers.getSigners / getContractFactory in test runner (no heavy peer deps needed)

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 1337,
    },
    hederaTestnet: {
      url: process.env.HEDERA_TESTNET_RPC || "https://testnet.hashio.io/api",
      chainId: 296,
      accounts: process.env.HEDERA_EVM_PRIVATE_KEY ? [process.env.HEDERA_EVM_PRIVATE_KEY] : [],
      timeout: 120000,
    },
    hederaMainnet: {
      url: process.env.HEDERA_MAINNET_RPC || "https://mainnet.hashio.io/api",
      chainId: 295,
      accounts: process.env.HEDERA_EVM_PRIVATE_KEY ? [process.env.HEDERA_EVM_PRIVATE_KEY] : [],
      timeout: 120000,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./contracts/test",
    cache: "./contracts/cache",
    artifacts: "./contracts/artifacts",
  },
};
