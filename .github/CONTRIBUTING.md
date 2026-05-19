# Contributing to WRAPpDEX

Thank you for your interest in contributing to WRAPpDEX — the institutional-grade DEX and Prediction Markets platform on Hedera!

We welcome contributions from developers, designers, security researchers, and community members who share our vision of fast, secure, and transparent decentralized finance on Hedera.

## Code of Conduct

By participating, you agree to uphold our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

## How Can I Contribute?

### Reporting Bugs
- Use the **Bug Report** issue template.
- Include clear reproduction steps, environment (browser, network), and expected vs actual behavior.
- For security vulnerabilities, **do not** create a public issue — see [SECURITY.md](SECURITY.md).

### Suggesting Features
- Use the **Feature Request** template.
- Explain the problem you're trying to solve and why it benefits the Hedera DeFi ecosystem (especially around Prediction Markets or trading UX).

### Code Contributions
1. Fork the repository
2. Create a feature branch from `main`: `git checkout -b feat/your-feature`
3. Make your changes
4. Ensure the build passes: `npm run build`
5. Submit a Pull Request with a clear description

### Areas Where We Especially Need Help
- Prediction Markets enhancements (oracle integration, multi-outcome, resolution disputes)
- Advanced charting & order book improvements
- Security reviews and gas optimizations on contracts
- Documentation & educational content
- Mobile / PWA experience
- Bridge route expansions

## Development Setup

```bash
git clone https://github.com/<your-fork>/wrapparea51.git
cd wrapparea51
npm install
npm run dev
```

For Prediction Markets contracts (requires funded Hedera EVM testnet key):

```bash
cp .env.example .env
# Fill HEDERA_EVM_PRIVATE_KEY
npx hardhat compile
npx hardhat test contracts/test/PredictionMarket.test.cjs
```

See `contracts/README.md` for deployment.

## Pull Request Guidelines

- Keep PRs focused (one feature / fix per PR)
- Update relevant documentation
- Add tests where reasonable (especially for contracts)
- Follow existing code style and naming
- Link any related issues

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for helping make decentralized finance on Hedera faster, safer, and more accessible.**