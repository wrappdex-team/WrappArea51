# Security Policy

## Supported Versions

We actively maintain the latest version of the WRAPpDEX frontend and smart contracts.

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| Older   | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, send an email to **security@wrappdex.io** with the subject line: `[SECURITY] <Brief Description>`.

Include as much detail as possible:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to provide a timeline for remediation.

## Scope

In scope:
- Smart contract vulnerabilities in `contracts/` (PredictionMarket.sol, MarketFactory.sol, etc.)
- Frontend authentication / wallet connection issues
- Cross-site scripting, injection, or data exposure in the production site
- Misconfigurations that could lead to fund loss or unauthorized resolution of markets

Out of scope:
- Issues in third-party dependencies (report upstream)
- Social engineering or physical attacks
- Denial of service against public Hedera nodes

## Bug Bounty / Recognition

We currently do not run a formal bug bounty program, but we publicly credit researchers who responsibly disclose valid issues (with permission).

## Best Practices We Follow

- OpenZeppelin v5 contracts with ReentrancyGuard, AccessControl, and Pausable
- Pull-based payouts and timelocked resolution
- 18-decimal standardization for Hedera EVM
- Removal of heavy third-party wallet SDKs (native HashPack + WalletConnect only)
- Strict Content-Security-Policy and referrer policies in production

Thank you for helping keep WRAPpDEX and the Hedera DeFi ecosystem secure.