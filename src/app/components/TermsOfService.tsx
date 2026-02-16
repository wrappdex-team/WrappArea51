import { useEffect } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";

export function TermsOfService() {
  const { isDark } = useTheme();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const headingClass = `text-xl md:text-2xl font-bold mt-10 mb-4 ${isDark ? "text-white" : "text-slate-900"}`;
  const subHeadingClass = `text-lg md:text-xl font-semibold mt-8 mb-3 ${isDark ? "text-slate-100" : "text-slate-800"}`;
  const paragraphClass = `text-sm md:text-base leading-relaxed mb-4 ${isDark ? "text-slate-300" : "text-slate-600"}`;
  const listClass = `text-sm md:text-base leading-relaxed mb-4 ml-6 space-y-2 list-disc ${isDark ? "text-slate-300" : "text-slate-600"}`;
  const boldInline = isDark ? "text-white font-semibold" : "text-slate-900 font-semibold";
  const dividerClass = `my-8 border-t ${isDark ? "border-white/[0.06]" : "border-gray-200"}`;

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-8 py-8 md:py-12">
      {/* Back navigation */}
      <Link
        to="/"
        className={`inline-flex items-center gap-2 text-sm mb-8 transition-colors ${
          isDark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900"
        }`}
      >
        <ArrowLeft className="w-4 h-4" />
        Back to WRAPpDEX
      </Link>

      {/* Title block */}
      <div className="mb-10">
        <h1 className={`text-3xl md:text-4xl font-bold mb-3 ${isDark ? "text-white" : "text-slate-900"}`}>
          WRAPpDEX Terms of Service
        </h1>
        <p className={`text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          Last Updated: February 16, 2026
        </p>
        <p className={`text-sm mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          Effective Date: February 16, 2026
        </p>
      </div>

      <div className={dividerClass} />

      {/* Preamble */}
      <p className={paragraphClass}>
        These Terms of Service (the <span className={boldInline}>"Terms"</span>) constitute a legally binding agreement between you
        (<span className={boldInline}>"you,"</span> <span className={boldInline}>"your,"</span> or <span className={boldInline}>"User"</span>) and WRAPpDEX, a
        Decentralized Unincorporated Nonprofit Association organized under the laws of the State of Wyoming pursuant to
        the Wyoming Decentralized Unincorporated Nonprofit Association Act, W.S. &sect; 17-32-101 <em>et seq.</em>
        (<span className={boldInline}>"WRAPpDEX,"</span> <span className={boldInline}>"the Association,"</span> <span className={boldInline}>"we,"</span> <span className={boldInline}>"us,"</span> or <span className={boldInline}>"our"</span>),
        governing your access to and use of the WRAPpDEX decentralized exchange platform, including but not limited to the website,
        web application, application programming interfaces (APIs), smart contracts, and all related tools, features, and services
        (collectively, the <span className={boldInline}>"Platform"</span> or <span className={boldInline}>"Services"</span>).
      </p>

      <p className={paragraphClass}>
        As used in these Terms, <span className={boldInline}>"Digital Asset"</span> means a representation of economic, proprietary,
        or access rights that is stored in a computer-readable format on a distributed ledger or blockchain, including
        but not limited to virtual currencies, utility tokens, governance tokens, stablecoins, and other cryptographic
        tokens, as contemplated by the Wyoming Digital Assets Act (W.S. &sect; 34-29-101 <em>et seq.</em>).
      </p>

      <p className={`${paragraphClass} font-semibold`}>
        PLEASE READ THESE TERMS CAREFULLY. BY ACCESSING OR USING THE PLATFORM, YOU ACKNOWLEDGE THAT YOU HAVE READ,
        UNDERSTOOD, AND AGREE TO BE BOUND BY THESE TERMS IN THEIR ENTIRETY. IF YOU DO NOT AGREE TO THESE TERMS, YOU MUST
        IMMEDIATELY CEASE ALL ACCESS TO AND USE OF THE PLATFORM.
      </p>

      <p className={paragraphClass}>
        These Terms constitute an electronic agreement. By clicking "I agree," connecting a wallet, or otherwise accessing
        or using the Platform, you consent to the formation of this Agreement by electronic means and affirm that this
        electronic agreement carries the same legal force and effect as a written agreement bearing your physical signature,
        in accordance with the Wyoming Uniform Electronic Transactions Act (W.S. &sect; 40-21-101 <em>et seq.</em>) and the
        federal Electronic Signatures in Global and National Commerce Act (15 U.S.C. &sect; 7001 <em>et seq.</em>).
      </p>

      {/* Section 1 */}
      <h2 className={headingClass}>1. Acceptance of Terms</h2>

      <p className={paragraphClass}>
        By connecting a wallet, executing a transaction, or otherwise interacting with the Platform, you expressly consent
        to these Terms, our <Link to="/privacy" className="text-pink-400 hover:text-pink-300 underline underline-offset-2">Privacy Policy</Link>,
        and any supplemental terms, policies, rules, or guidelines that we may publish from time to time (collectively, the <span className={boldInline}>"Agreement"</span>).
        We reserve the right to modify these Terms at any time. Material changes will be posted on the Platform with an updated
        "Last Updated" date. Your continued use of the Platform after such changes constitutes acceptance of the revised Terms.
        If you do not agree to any modification, your sole remedy is to discontinue use of the Platform.
      </p>

      <p className={paragraphClass}>
        If you are using the Platform on behalf of an entity, you represent and warrant that you have the legal authority to bind
        that entity to these Terms, and references to "you" shall include that entity.
      </p>

      {/* Section 2 */}
      <h2 className={headingClass}>2. DUNA Status, Membership, and Limited Liability</h2>

      <h3 className={subHeadingClass}>2.1 Organizational Structure</h3>
      <p className={paragraphClass}>
        WRAPpDEX is organized as a Decentralized Unincorporated Nonprofit Association (<span className={boldInline}>"DUNA"</span>) under
        the Wyoming Decentralized Unincorporated Nonprofit Association Act, W.S. &sect; 17-32-101 <em>et seq.</em> The DUNA is a
        recognized legal entity under Wyoming law, capable of holding property, entering into contracts, and engaging in legal
        proceedings in its own name pursuant to W.S. &sect; 17-32-106. The Association maintains a registered agent in the
        State of Wyoming as required by W.S. &sect; 17-32-110.
      </p>

      <h3 className={subHeadingClass}>2.2 Platform Users Are Not Members</h3>
      <p className={paragraphClass}>
        <span className={boldInline}>Your use of the Platform does not, by itself, make you a "member" of the WRAPpDEX DUNA</span> within
        the meaning of W.S. &sect; 17-32-104. Accessing the Platform, connecting a wallet, executing swaps, providing liquidity,
        holding any Digital Asset (including governance tokens), or participating in on-platform governance votes through the
        DAO interface does not confer DUNA membership, ownership, equity, profit-sharing rights, fiduciary duties owed to you,
        or any other organizational interest in WRAPpDEX. DUNA membership, if any, is governed exclusively by the Association's
        organizational documents and the requirements of Wyoming law.
      </p>

      <h3 className={subHeadingClass}>2.3 Limited Liability of DUNA Members</h3>
      <p className={paragraphClass}>
        Pursuant to W.S. &sect; 17-32-107, a member of a DUNA is not personally liable, solely by reason of being or acting as
        a member, for the debts, obligations, or other liabilities of the Association, whether arising in contract, tort, or
        otherwise. This statutory limited liability protection applies to the members, administrators, and other participants
        of the WRAPpDEX DUNA. Nothing in these Terms alters, waives, or diminishes any statutory liability protections afforded
        under Wyoming law.
      </p>

      <h3 className={subHeadingClass}>2.4 DAO Governance and DUNA Governance</h3>
      <p className={paragraphClass}>
        The Platform includes a DAO governance module that enables certain on-chain and off-chain governance activities
        (e.g., proposal submission, voting). The DAO interface is a tool provided for informational and community engagement
        purposes. The results of on-platform governance votes may inform, but do not automatically bind, the formal governance
        actions of the WRAPpDEX DUNA. Formal DUNA governance is conducted in accordance with the Association's organizational
        documents and applicable provisions of W.S. &sect; 17-32-101 <em>et seq.</em>
      </p>

      {/* Section 3 */}
      <h2 className={headingClass}>3. Eligibility</h2>

      <p className={paragraphClass}>To access and use the Platform, you represent and warrant that:</p>
      <ul className={listClass}>
        <li>You are at least eighteen (18) years of age or the age of legal majority in your jurisdiction, whichever is greater.</li>
        <li>You have full legal capacity and authority to enter into this Agreement and to perform your obligations hereunder.</li>
        <li>You are not a citizen, resident, or organized in, or otherwise subject to the jurisdiction of, any country or territory
          that is the subject of comprehensive economic sanctions (including, without limitation, Cuba, Iran, North Korea, Syria,
          the Crimea, Donetsk, and Luhansk regions of Ukraine, or any other jurisdiction designated by the United States
          Department of the Treasury's Office of Foreign Assets Control ("OFAC"), the European Union, the United Kingdom,
          or the United Nations Security Council).</li>
        <li>You are not identified on, and are not acting on behalf of any person or entity identified on, any sanctions list
          maintained by OFAC (including the Specially Designated Nationals and Blocked Persons List), the EU Consolidated
          Financial Sanctions List, the UK Sanctions List, or any similar list maintained by any governmental authority.</li>
        <li>Your use of the Platform does not violate any applicable law, regulation, or rule in your jurisdiction, including
          but not limited to securities laws, commodities laws, anti-money laundering ("AML") laws, counter-terrorist financing
          ("CTF") regulations, export control laws, and tax reporting obligations.</li>
        <li>You will not use the Platform in connection with any unlawful activity, including but not limited to money laundering,
          terrorist financing, tax evasion, market manipulation, fraud, or the circumvention of sanctions.</li>
        <li>You are solely responsible for determining whether your use of the Platform, and any Digital Asset transaction executed
          through it, complies with all applicable laws in your jurisdiction. WRAPpDEX makes no representation that the Platform
          or any Digital Asset is lawful to access or transact in any particular jurisdiction.</li>
        <li>Your use of the Platform does not confer upon you membership in, or any organizational interest in, the WRAPpDEX DUNA.</li>
      </ul>

      {/* Section 4 */}
      <h2 className={headingClass}>4. Description of the Platform</h2>

      <h3 className={subHeadingClass}>4.1 Nature of the Platform</h3>
      <p className={paragraphClass}>
        WRAPpDEX is a decentralized exchange platform built on the Hedera network that provides Users with a web-based
        interface for interacting with decentralized protocols. The Platform is designed to facilitate, among other activities:
      </p>
      <ul className={listClass}>
        <li>Token swaps via automated market maker (AMM) liquidity pools.</li>
        <li>Provision and withdrawal of liquidity from on-platform pools.</li>
        <li>Participation in decentralized governance through the DAO module.</li>
        <li>Access to market data, price oracles, portfolio tracking, and related informational tools.</li>
        <li>Cross-chain bridge functionality through integrated third-party providers.</li>
      </ul>

      <h3 className={subHeadingClass}>4.2 Protocol and Interface Distinction</h3>
      <p className={paragraphClass}>
        The Platform consists of two conceptually distinct components: (a) the <span className={boldInline}>Interface</span>,
        which is the web-based front-end application (website, web app, and APIs) operated and maintained by WRAPpDEX; and
        (b) the <span className={boldInline}>Protocol</span>, which comprises the autonomous, self-executing smart contracts
        deployed on the Hedera distributed ledger (and, where applicable, other supported networks). Once deployed, Protocol
        smart contracts operate according to their programmed logic without ongoing intervention by WRAPpDEX. WRAPpDEX
        provides the Interface as a convenient means for Users to interact with the Protocol, but the Protocol exists and
        functions independently of the Interface. Users may interact with Protocol smart contracts directly, without using
        the Interface, at their own risk and discretion.
      </p>

      <h3 className={subHeadingClass}>4.3 Development Status and Audit Transparency</h3>
      <p className={`${paragraphClass} font-semibold`}>
        THE PLATFORM IS UNDER ACTIVE DEVELOPMENT AND SHOULD BE CONSIDERED EXPERIMENTAL TECHNOLOGY. Certain features,
        including but not limited to the automated market maker (AMM) and token swap functionality, are in pre-production
        or beta status and have{" "}
        <span className={boldInline}>not yet undergone a formal independent security audit</span>.
        Independent third-party security audits of all smart contracts and core Protocol components are planned and will
        be completed prior to the production launch of AMM and swap features. Audit results will be published transparently
        when available. The absence of a formal audit means the risk of undiscovered critical vulnerabilities is materially
        higher than in audited protocols.
      </p>
      <p className={paragraphClass}>
        By using the Platform in its current state, you expressly acknowledge and accept the elevated risks associated
        with interacting with unaudited, experimental software, including but not limited to the potential for undiscovered
        vulnerabilities, logic errors, or exploitable defects that could result in partial or total loss of your Digital Assets.
        You should not interact with any feature of the Platform with assets you cannot afford to lose entirely.
      </p>

      <h3 className={subHeadingClass}>4.4 Non-Custodial Architecture</h3>
      <p className={paragraphClass}>
        WRAPpDEX is a <span className={boldInline}>non-custodial</span> platform. We do not hold, control, manage, or have
        access to your Digital Assets, private keys, seed phrases, or wallet credentials at any time. All transactions are
        initiated and signed by you through your self-custodial wallet. You bear sole responsibility for the security and
        management of your wallet, private keys, and any assets held therein.
      </p>

      <h3 className={subHeadingClass}>4.5 Token Availability Disclaimer</h3>
      <p className={paragraphClass}>
        The availability or display of any Digital Asset on the Platform does not constitute an endorsement, recommendation,
        solicitation, or determination by WRAPpDEX regarding the legal classification, regulatory status, investment quality,
        safety, value, or suitability of such Digital Asset. WRAPpDEX does not vet, review, audit, or guarantee any token or
        token issuer. Tokens may be created by any third party and may be fraudulent, worthless, illiquid, or subject to
        regulatory action. You are solely responsible for conducting your own due diligence on any Digital Asset before
        transacting.
      </p>

      <h3 className={subHeadingClass}>4.6 Protocol Interactions</h3>
      <p className={paragraphClass}>
        The Platform provides a graphical interface to interact with decentralized protocols deployed on the Hedera distributed
        ledger and, where applicable, other supported networks. WRAPpDEX does not operate, control, or assume responsibility
        for the underlying blockchain protocols, consensus mechanisms, smart contract logic, or token standards. Transactions
        submitted through the Platform are executed on-chain and are irreversible once confirmed by the network.
      </p>

      {/* Section 5 */}
      <h2 className={headingClass}>5. Wallet Connection and Self-Custody</h2>

      <p className={paragraphClass}>
        To use certain features of the Platform, you must connect a compatible self-custodial wallet (e.g., HashPack, MetaMask,
        or other supported wallets). By connecting your wallet, you acknowledge and agree that:
      </p>
      <ul className={listClass}>
        <li>You are the sole owner of and bear full responsibility for the connected wallet and all assets held within it.</li>
        <li>WRAPpDEX has no ability to reverse, cancel, or modify any transaction that has been broadcast to the network.</li>
        <li>You are solely responsible for ensuring the accuracy of all transaction parameters (including recipient addresses,
          token amounts, slippage tolerances, and gas/network fees) before signing and submitting any transaction.</li>
        <li>Loss of access to your wallet (including loss of private keys or seed phrases) may result in permanent, irrecoverable
          loss of your Digital Assets. WRAPpDEX cannot recover lost credentials or assets under any circumstances.</li>
        <li>You will maintain adequate security measures for your wallet, including but not limited to using hardware wallets
          where appropriate, enabling multi-factor authentication, and keeping private keys and seed phrases in secure,
          offline storage.</li>
      </ul>

      {/* Section 6 */}
      <h2 className={headingClass}>6. Assumption of Risk</h2>

      <p className={`${paragraphClass} font-semibold`}>
        BY ACCESSING OR USING THE PLATFORM, YOU EXPRESSLY ACKNOWLEDGE, ACCEPT, AND ASSUME ALL RISKS ASSOCIATED WITH
        YOUR USE OF THE PLATFORM AND ANY TRANSACTIONS EXECUTED THROUGH IT. YOU ACKNOWLEDGE THAT YOU HAVE SUFFICIENT
        KNOWLEDGE AND EXPERIENCE IN FINANCIAL, BUSINESS, AND DIGITAL ASSET MATTERS TO BE CAPABLE OF EVALUATING THE
        MERITS AND RISKS OF USING THE PLATFORM AND TRANSACTING IN DIGITAL ASSETS, AND THAT YOU ARE ABLE TO BEAR THE
        ECONOMIC RISK OF A TOTAL LOSS OF ALL DIGITAL ASSETS INVOLVED IN ANY TRANSACTION.
      </p>
      <p className={paragraphClass}>
        Without limiting the generality of the foregoing, you specifically acknowledge and assume the following risks:
      </p>

      <h3 className={subHeadingClass}>6.1 Market and Volatility Risk</h3>
      <p className={paragraphClass}>
        Digital Assets are inherently volatile. Prices may fluctuate significantly over short periods, and you may experience
        substantial or total loss of value. Price movements are influenced by factors including market sentiment, regulatory
        developments, technological changes, macroeconomic conditions, and liquidity dynamics, many of which are unpredictable
        and beyond your or our control.
      </p>

      <h3 className={subHeadingClass}>6.2 Liquidity Risk</h3>
      <p className={paragraphClass}>
        Liquidity pool depth, trading volume, and market conditions may affect your ability to execute transactions at
        desired prices. Slippage, impermanent loss, and unfavorable execution prices may occur, particularly during periods
        of high volatility or low liquidity. There is no guarantee that sufficient liquidity will be available for any
        particular token pair at any given time.
      </p>

      <h3 className={subHeadingClass}>6.3 Smart Contract and Protocol Risk</h3>
      <p className={paragraphClass}>
        Smart contracts and decentralized protocols may contain undiscovered vulnerabilities, bugs, or exploits. As stated
        in Section 4.3, formal independent security audits of the Platform's smart contracts have not yet been completed
        and are planned prior to production launch. Interactions with smart contracts &mdash; whether audited or unaudited
        &mdash; carry inherent risk, including the potential for partial or total loss of assets. The completion of a
        security audit does not guarantee the absence of vulnerabilities.
      </p>

      <h3 className={subHeadingClass}>6.4 Network and Infrastructure Risk</h3>
      <p className={paragraphClass}>
        The Hedera network and other supported blockchains are decentralized systems subject to congestion, outages,
        forks, consensus failures, and other technical disruptions. Network-level events may delay, alter, or prevent
        the execution of transactions. WRAPpDEX is not responsible for the performance, availability, or reliability
        of any underlying blockchain network. The Hedera network is governed by the Hedera Governing Council, whose
        governance decisions (including changes to fee schedules, consensus mechanisms, or network rules) may materially
        affect the Platform and the value or functionality of Digital Assets transacted therein.
      </p>

      <h3 className={subHeadingClass}>6.5 Regulatory and Legal Risk</h3>
      <p className={paragraphClass}>
        The regulatory landscape for Digital Assets is evolving rapidly and varies by jurisdiction. Changes in law,
        regulation, or enforcement policy &mdash; including but not limited to the classification of Digital Assets as
        securities, commodities, or other regulated instruments &mdash; may adversely affect the value, transferability,
        or legality of Digital Assets or the availability of the Platform. You are solely responsible for understanding
        and complying with all laws and regulations applicable to your use of the Platform in your jurisdiction.
      </p>

      <h3 className={subHeadingClass}>6.6 Oracle and Price Feed Risk</h3>
      <p className={paragraphClass}>
        The Platform relies on third-party oracle services and price feeds for display and informational purposes. Oracle
        data may be delayed, inaccurate, or subject to manipulation. Swap execution uses on-chain reserve ratios, not
        oracle prices; however, displayed estimates, TVL calculations, and portfolio valuations are informational only
        and may not reflect the actual value realizable in a transaction.
      </p>

      <h3 className={subHeadingClass}>6.7 Third-Party and Bridge Risk</h3>
      <p className={paragraphClass}>
        The Platform integrates with third-party services, including cross-chain bridges, fiat on-ramp providers, and
        wallet connectors. WRAPpDEX does not control, audit, or guarantee the security, availability, or performance
        of third-party services. Use of third-party services is subject to their respective terms and conditions, and
        you assume all risk associated with such use.
      </p>

      <h3 className={subHeadingClass}>6.8 Impermanent Loss</h3>
      <p className={paragraphClass}>
        Providing liquidity to automated market maker pools exposes you to impermanent loss (also known as divergence loss),
        which occurs when the relative price of pooled tokens changes from the time of deposit. Depending on the magnitude
        of price divergence and trading fees earned, you may withdraw fewer total assets (in fiat-equivalent terms) than
        you deposited. Impermanent loss is an inherent characteristic of constant-product AMM design and is not a defect
        of the Platform.
      </p>

      <h3 className={subHeadingClass}>6.9 Maximal Extractable Value (MEV) and Transaction Ordering Risk</h3>
      <p className={paragraphClass}>
        Your transactions may be subject to Maximal Extractable Value (MEV) extraction by third-party actors, including
        validators, relay operators, or automated bots. MEV strategies include front-running (executing a transaction
        ahead of yours to profit from the price impact), sandwich attacks (placing transactions before and after yours
        to extract value), and back-running. These activities may result in you receiving a less favorable execution
        price than expected. WRAPpDEX does not control transaction ordering on the underlying blockchain and cannot
        prevent MEV extraction. You should set appropriate slippage tolerances and understand the risks of MEV before
        submitting transactions.
      </p>

      <h3 className={subHeadingClass}>6.10 Fraudulent, Unvetted, or Worthless Token Risk</h3>
      <p className={paragraphClass}>
        The Platform may display or facilitate transactions in tokens created by third parties that WRAPpDEX has not
        reviewed, vetted, or endorsed. Such tokens may be fraudulent, have no intrinsic value, be designed to deceive
        users (commonly known as "rug pulls"), or be subject to regulatory enforcement action. The inclusion or display
        of any token on the Platform is not an endorsement of its legitimacy, value, or legal status. You are solely
        responsible for conducting independent research and due diligence before transacting in any Digital Asset.
      </p>

      <h3 className={subHeadingClass}>6.11 No Insurance Protection</h3>
      <p className={`${paragraphClass} font-semibold`}>
        DIGITAL ASSETS HELD IN YOUR WALLET, DEPOSITED IN LIQUIDITY POOLS, OR OTHERWISE USED IN CONNECTION WITH THE PLATFORM
        ARE NOT INSURED BY THE FEDERAL DEPOSIT INSURANCE CORPORATION (FDIC), THE SECURITIES INVESTOR PROTECTION CORPORATION
        (SIPC), OR ANY OTHER GOVERNMENTAL, QUASI-GOVERNMENTAL, OR PRIVATE INSURANCE SCHEME. IN THE EVENT OF LOSS &mdash;
        WHETHER DUE TO SMART CONTRACT FAILURE, EXPLOIT, MARKET CONDITIONS, REGULATORY ACTION, OR ANY OTHER CAUSE &mdash;
        THERE IS NO PUBLIC OR PRIVATE INSURANCE BACKSTOP TO COMPENSATE YOU.
      </p>

      <h3 className={subHeadingClass}>6.12 Stablecoin and Regulatory Classification Risk</h3>
      <p className={paragraphClass}>
        Certain Digital Assets available on the Platform may include "payment stablecoins" as defined under the Guiding and
        Establishing National Innovation for U.S. Stablecoins Act (<span className={boldInline}>"GENIUS Act"</span>) or similar
        regulatory frameworks. WRAPpDEX is <span className={boldInline}>not</span> an issuer, custodian, redeemer, or reserve
        manager of any stablecoin. WRAPpDEX makes no representation regarding the reserve backing, redemption rights,
        solvency, regulatory compliance, or ongoing viability of any stablecoin issuer. Stablecoins may lose their peg
        to the reference asset, become illiquid, or become subject to regulatory freezing or seizure. Redemption rights,
        if any, exist solely between you and the stablecoin issuer and are governed by the issuer's terms, not these Terms.
        You are solely responsible for understanding the regulatory status and risks of any stablecoin you transact with
        on the Platform.
      </p>

      <h3 className={subHeadingClass}>6.13 Irreversibility of Transactions</h3>
      <p className={paragraphClass}>
        Blockchain transactions are irreversible. Once a transaction is confirmed on-chain, it cannot be reversed, cancelled,
        or refunded by WRAPpDEX or any other party. If you send Digital Assets to an incorrect address, interact with a
        malicious smart contract, or execute a transaction on unfavorable terms, you may permanently and irrecoverably lose
        your assets. WRAPpDEX has no ability to reverse or remedy any on-chain transaction.
      </p>

      {/* Section 7 */}
      <h2 className={headingClass}>7. No Financial, Investment, or Legal Advice; No Fiduciary Duty</h2>

      <p className={paragraphClass}>
        Nothing on the Platform constitutes, or is intended to constitute, financial advice, investment advice, tax advice,
        legal advice, or any other professional advice. All information provided on the Platform, including token prices,
        market data, analytics, historical performance, TVL figures, and APY/APR estimates, is provided for informational
        purposes only and should not be relied upon as the basis for any financial decision.
      </p>
      <p className={paragraphClass}>
        You should consult your own financial, legal, and tax advisors before engaging in any Digital Asset transaction.
        WRAPpDEX does not recommend, endorse, or express an opinion on the merits of any particular token, protocol, or
        investment strategy.
      </p>
      <p className={`${paragraphClass} font-semibold`}>
        WRAPPDEX DOES NOT OWE ANY FIDUCIARY DUTY TO YOU. To the fullest extent permitted by applicable law, neither
        WRAPpDEX, its administrators, nor any DUNA member owes you any duty of care, duty of loyalty, or other fiduciary
        obligation solely by reason of your use of the Platform. Your relationship with WRAPpDEX is limited to the
        contractual terms set forth in this Agreement.
      </p>

      {/* Section 8 */}
      <h2 className={headingClass}>8. Tax Obligations</h2>

      <p className={paragraphClass}>
        You are solely responsible for determining, reporting, and paying any and all taxes (including but not limited to
        income tax, capital gains tax, value-added tax, goods and services tax, withholding tax, and any other tax imposed
        by any jurisdiction) that may apply to transactions you execute through the Platform. WRAPpDEX does not provide
        tax advice, does not calculate or withhold taxes on your behalf, and does not issue tax forms (such as IRS Form
        1099 or equivalent) to Users.
      </p>
      <p className={paragraphClass}>
        You acknowledge that the tax treatment of Digital Asset transactions varies by jurisdiction and is subject to change.
        You are strongly encouraged to consult a qualified tax professional regarding your specific tax obligations.
        WRAPpDEX shall not be liable for any tax obligations arising from your use of the Platform.
      </p>

      {/* Section 9 */}
      <h2 className={headingClass}>9. Regulatory Status Disclaimers</h2>

      <h3 className={subHeadingClass}>9.1 Not a Money Services Business or Money Transmitter</h3>
      <p className={paragraphClass}>
        WRAPpDEX is a non-custodial software protocol and user interface. WRAPpDEX does not hold, transmit, exchange,
        or otherwise control user funds at any point during any transaction. WRAPpDEX does not constitute a "money services
        business" (MSB) or "money transmitter" as defined by the Bank Secrecy Act (31 U.S.C. &sect; 5311 <em>et seq.</em>),
        FinCEN regulations (31 C.F.R. &sect; 1010 <em>et seq.</em>), or any state money transmission statute. In accordance
        with Wyoming's statutory exemption for non-custodial virtual currency activities (W.S. &sect; 40-22-104(a)(vii)),
        WRAPpDEX does not maintain state money transmitter licenses.
      </p>

      <h3 className={subHeadingClass}>9.2 Not a Securities Exchange, Broker-Dealer, or Investment Adviser</h3>
      <p className={paragraphClass}>
        WRAPpDEX is not registered as, and does not operate as, a national securities exchange, alternative trading system
        (ATS), broker-dealer, investment adviser, or transfer agent under the Securities Exchange Act of 1934, the Investment
        Advisers Act of 1940, or any comparable state or foreign law. Digital Assets available on the Platform have not been
        registered under the Securities Act of 1933 or any state securities law. Nothing on the Platform constitutes an offer
        to sell, a solicitation of an offer to buy, or a recommendation of any security.
      </p>

      <h3 className={subHeadingClass}>9.3 Not a Commodity Exchange or Derivatives Platform</h3>
      <p className={paragraphClass}>
        WRAPpDEX is not registered as, and does not operate as, a designated contract market (DCM), swap execution facility
        (SEF), derivatives clearing organization (DCO), or commodity pool operator (CPO) under the Commodity Exchange Act
        (7 U.S.C. &sect; 1 <em>et seq.</em>) or regulations of the Commodity Futures Trading Commission (CFTC). Nothing on the
        Platform constitutes an offer of or a transaction in commodity futures, options, swaps, or other derivatives.
      </p>

      <h3 className={subHeadingClass}>9.4 Not a Stablecoin Issuer</h3>
      <p className={paragraphClass}>
        WRAPpDEX is not a permitted payment stablecoin issuer as defined under the GENIUS Act or any comparable federal or
        state regulatory framework. WRAPpDEX does not issue, mint, redeem, manage reserves for, or guarantee the value of
        any stablecoin. Any stablecoin accessible through the Platform is issued by a third party, and any rights or
        obligations related to such stablecoin exist solely between you and the issuer.
      </p>

      {/* Section 10 */}
      <h2 className={headingClass}>10. Fees</h2>

      <h3 className={subHeadingClass}>10.1 Protocol Fees</h3>
      <p className={paragraphClass}>
        The Platform may charge a protocol fee on transactions executed through the AMM or other Platform features. The
        applicable fee structure will be displayed within the Platform interface at the time of transaction. Fee rates are
        subject to change at the discretion of WRAPpDEX or through DUNA governance processes, with or without prior notice.
        Protocol fees are non-refundable once a transaction has been confirmed on-chain.
      </p>

      <h3 className={subHeadingClass}>10.2 Network Fees</h3>
      <p className={paragraphClass}>
        All on-chain transactions require payment of network transaction fees (commonly referred to as "gas fees" or
        "network fees") directly to the Hedera network or applicable blockchain. These fees are not collected by, and
        are entirely outside the control of, WRAPpDEX. Network fees may vary based on network congestion and other factors.
      </p>

      {/* Section 11 */}
      <h2 className={headingClass}>11. Prohibited Conduct</h2>

      <p className={paragraphClass}>You agree not to, and shall not permit any third party to:</p>
      <ul className={listClass}>
        <li>Use the Platform for any unlawful purpose, including but not limited to money laundering, terrorist financing,
          sanctions evasion, tax evasion, fraud, or market manipulation.</li>
        <li>Engage in wash trading, spoofing, layering, front-running, or any form of market manipulation or deceptive
          trading practice.</li>
        <li>Attempt to exploit, attack, or interfere with the Platform, its smart contracts, infrastructure, or other
          users, including through denial-of-service attacks, injection attacks, phishing, social engineering, or any
          other malicious activity.</li>
        <li>Circumvent, disable, or interfere with any security, access control, or rate-limiting mechanisms of the Platform.</li>
        <li>Use bots, scrapers, crawlers, or automated tools to access the Platform in a manner that exceeds reasonable
          use or imposes disproportionate load on our infrastructure, except through officially documented APIs.</li>
        <li>Reverse engineer, decompile, disassemble, or otherwise attempt to derive the source code of the Platform,
          except to the extent permitted by applicable open-source licenses.</li>
        <li>Impersonate any person or entity, or falsely represent your affiliation with any person or entity, including
          falsely claiming membership in the WRAPpDEX DUNA.</li>
        <li>Use the Platform from any jurisdiction where such use is prohibited by applicable law.</li>
        <li>Upload, transmit, or distribute any content that is unlawful, defamatory, obscene, harassing, or otherwise
          objectionable through any community or governance feature of the Platform.</li>
        <li>Use the Platform in violation of any applicable export control or trade sanctions laws, including the U.S.
          Export Administration Regulations (EAR) or any comparable international trade restrictions.</li>
        <li>Create, deploy, or promote fraudulent, deceptive, or misleading tokens or liquidity pools through the Platform.</li>
        <li>Facilitate, assist, or encourage any third party in engaging in any of the foregoing prohibited activities.</li>
      </ul>

      {/* Section 12 */}
      <h2 className={headingClass}>12. Intellectual Property</h2>

      <h3 className={subHeadingClass}>12.1 Ownership</h3>
      <p className={paragraphClass}>
        The WRAPpDEX name, logo, brand elements, user interface designs, proprietary algorithms, documentation, and all
        other intellectual property associated with the Platform (collectively, <span className={boldInline}>"WRAPpDEX IP"</span>) are
        the exclusive property of WRAPpDEX and its licensors. These Terms do not grant you any right, title, or interest
        in the WRAPpDEX IP except for the limited license to use the Platform in accordance with these Terms.
      </p>

      <h3 className={subHeadingClass}>12.2 Limited License</h3>
      <p className={paragraphClass}>
        Subject to your compliance with these Terms, we grant you a limited, non-exclusive, non-transferable, non-sublicensable,
        revocable license to access and use the Platform for your personal, non-commercial use. This license does not include
        the right to copy, reproduce, distribute, modify, create derivative works of, publicly display, publicly perform,
        republish, or otherwise exploit any WRAPpDEX IP without our prior written consent. Notwithstanding the foregoing,
        to the extent any component of the Platform is released under an open-source license, such component is governed by
        the terms of its applicable open-source license, which shall prevail over this Section 12.2 solely with respect to
        that component.
      </p>

      <h3 className={subHeadingClass}>12.3 Feedback</h3>
      <p className={paragraphClass}>
        If you provide us with any feedback, suggestions, or ideas regarding the Platform (<span className={boldInline}>"Feedback"</span>),
        you hereby assign to us all rights in and to such Feedback and agree that we shall be free to use, disclose,
        reproduce, license, and otherwise exploit the Feedback in any manner, without obligation or compensation to you.
      </p>

      {/* Section 13 */}
      <h2 className={headingClass}>13. Disclaimer of Warranties</h2>

      <p className={`${paragraphClass} font-semibold`}>
        THE PLATFORM AND ALL SERVICES, CONTENT, DATA, AND MATERIALS PROVIDED THEREON ARE PROVIDED ON AN "AS IS" AND
        "AS AVAILABLE" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. TO THE FULLEST EXTENT
        PERMITTED BY APPLICABLE LAW, WRAPPDEX EXPRESSLY DISCLAIMS ALL WARRANTIES, WHETHER EXPRESS, IMPLIED, STATUTORY,
        OR OTHERWISE, INCLUDING BUT NOT LIMITED TO:
      </p>
      <ul className={listClass}>
        <li>IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.</li>
        <li>WARRANTIES REGARDING THE ACCURACY, RELIABILITY, COMPLETENESS, TIMELINESS, OR AVAILABILITY OF THE PLATFORM
          OR ANY INFORMATION, CONTENT, OR DATA PROVIDED THEREON.</li>
        <li>WARRANTIES THAT THE PLATFORM WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR FREE FROM VIRUSES, MALWARE,
          OR OTHER HARMFUL COMPONENTS.</li>
        <li>WARRANTIES REGARDING THE PERFORMANCE, VALUE, OR OUTCOME OF ANY TRANSACTION EXECUTED THROUGH THE PLATFORM.</li>
        <li>WARRANTIES REGARDING THE SECURITY, FUNCTIONALITY, OR RELIABILITY OF ANY THIRD-PARTY SERVICE, PROTOCOL,
          OR SMART CONTRACT ACCESSED THROUGH THE PLATFORM.</li>
        <li>WARRANTIES THAT THE PLATFORM OR ITS SMART CONTRACTS HAVE BEEN FORMALLY AUDITED, OR THAT ANY FUTURE AUDIT
          WILL IDENTIFY ALL POTENTIAL VULNERABILITIES OR DEFECTS.</li>
        <li>WARRANTIES REGARDING THE REGULATORY STATUS, LEGAL CLASSIFICATION, OR COMPLIANCE OF ANY DIGITAL ASSET
          AVAILABLE ON THE PLATFORM.</li>
        <li>WARRANTIES THAT THE PLATFORM WILL CONTINUE TO BE AVAILABLE OR THAT ANY FEATURE WILL BE MAINTAINED INDEFINITELY.</li>
      </ul>

      {/* Section 14 */}
      <h2 className={headingClass}>14. Limitation of Liability</h2>

      <p className={`${paragraphClass} font-semibold`}>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL WRAPPDEX, ITS DUNA MEMBERS, ADMINISTRATORS,
        AFFILIATES, OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, CONTRACTORS, LICENSORS, OR SERVICE PROVIDERS (COLLECTIVELY,
        THE <span className={boldInline}>"WRAPPDEX PARTIES"</span>) BE LIABLE TO YOU OR ANY THIRD PARTY FOR ANY OF THE FOLLOWING,
        WHETHER BASED ON WARRANTY, CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY, OR ANY OTHER LEGAL THEORY,
        AND WHETHER OR NOT THE WRAPPDEX PARTIES HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES:
      </p>
      <ul className={listClass}>
        <li>ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES.</li>
        <li>ANY LOSS OF PROFITS, REVENUE, BUSINESS OPPORTUNITIES, GOODWILL, OR DATA.</li>
        <li>ANY LOSS OR DEPRECIATION IN VALUE OF DIGITAL ASSETS, REGARDLESS OF CAUSE.</li>
        <li>ANY DAMAGES ARISING FROM UNAUTHORIZED ACCESS TO OR ALTERATION OF YOUR WALLET, TRANSACTIONS, OR DATA.</li>
        <li>ANY DAMAGES ARISING FROM THE ACTS OR OMISSIONS OF THIRD-PARTY SERVICE PROVIDERS, INCLUDING WALLET PROVIDERS,
          BRIDGE OPERATORS, ORACLE SERVICES, STABLECOIN ISSUERS, AND BLOCKCHAIN NETWORKS.</li>
        <li>ANY DAMAGES ARISING FROM SMART CONTRACT VULNERABILITIES, EXPLOITS, OR FAILURES, WHETHER IN AUDITED OR
          UNAUDITED CODE.</li>
        <li>ANY DAMAGES ARISING FROM YOUR FAILURE TO MAINTAIN THE SECURITY OF YOUR WALLET OR CREDENTIALS.</li>
        <li>ANY DAMAGES ARISING FROM REGULATORY ACTIONS, CHANGES IN LAW, OR ENFORCEMENT PROCEEDINGS IN ANY JURISDICTION.</li>
        <li>ANY DAMAGES ARISING FROM MEV EXTRACTION, FRONT-RUNNING, SANDWICH ATTACKS, OR OTHER TRANSACTION ORDERING
          MANIPULATION BY THIRD PARTIES.</li>
        <li>ANY DAMAGES ARISING FROM THE DE-PEGGING, DEVALUATION, OR FAILURE OF ANY STABLECOIN OR OTHER DIGITAL ASSET.</li>
      </ul>
      <p className={`${paragraphClass} font-semibold`}>
        IN NO EVENT SHALL THE AGGREGATE LIABILITY OF THE WRAPPDEX PARTIES FOR ALL CLAIMS ARISING OUT OF OR RELATING
        TO THESE TERMS OR YOUR USE OF THE PLATFORM EXCEED ONE HUNDRED U.S. DOLLARS ($100.00). THIS LIMITATION APPLIES
        REGARDLESS OF WHETHER WRAPPDEX HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES AND NOTWITHSTANDING THE
        FAILURE OF ANY AGREED OR OTHER REMEDY OF ITS ESSENTIAL PURPOSE.
      </p>
      <p className={paragraphClass}>
        Some jurisdictions do not allow the exclusion or limitation of certain warranties or liabilities. In such jurisdictions,
        the limitations set forth above shall apply to the fullest extent permitted by applicable law.
      </p>

      {/* Section 15 */}
      <h2 className={headingClass}>15. Indemnification</h2>

      <p className={paragraphClass}>
        You agree to indemnify, defend, and hold harmless the WRAPpDEX Parties from and against any and all claims,
        demands, actions, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees and
        court costs) arising out of or relating to:
      </p>
      <ul className={listClass}>
        <li>Your access to or use of the Platform.</li>
        <li>Your violation of these Terms or any applicable law or regulation.</li>
        <li>Your violation of any rights of any third party, including intellectual property rights.</li>
        <li>Any transaction you execute through the Platform.</li>
        <li>Your negligence, willful misconduct, or fraud.</li>
        <li>Any content you submit, post, or transmit through the Platform, including through governance or community features.</li>
        <li>Any claim that your use of the Platform caused damage to a third party.</li>
        <li>Your failure to comply with applicable tax, sanctions, export control, or other regulatory obligations.</li>
        <li>Any claim by a governmental authority that your activity on the Platform constitutes unregistered securities
          transactions, unlicensed money transmission, or other regulated activity.</li>
      </ul>
      <p className={paragraphClass}>
        This indemnification obligation shall survive the termination of these Terms and your cessation of use of the Platform.
      </p>

      {/* Section 16 */}
      <h2 className={headingClass}>16. Dispute Resolution and Arbitration</h2>

      <h3 className={subHeadingClass}>16.1 Informal Resolution</h3>
      <p className={paragraphClass}>
        Before initiating any formal dispute resolution proceeding, you agree to first contact WRAPpDEX through the
        channels listed in Section 22 and attempt to resolve the Dispute informally for a period of at least thirty (30)
        days. Most concerns can be resolved through good-faith communication.
      </p>

      <h3 className={subHeadingClass}>16.2 Mandatory Binding Arbitration</h3>
      <p className={paragraphClass}>
        If a Dispute cannot be resolved informally, any dispute, claim, or controversy arising out of or relating to these
        Terms, the Platform, or any transaction executed through the Platform (each, a <span className={boldInline}>"Dispute"</span>) shall
        be resolved exclusively through final and binding arbitration administered by the American Arbitration Association
        (<span className={boldInline}>"AAA"</span>) in accordance with its then-current Commercial Arbitration Rules. The arbitration
        shall be conducted in the English language by a single arbitrator with demonstrated expertise in blockchain technology
        or digital asset law. The seat of arbitration shall be Cheyenne, Wyoming, United States, provided that proceedings
        may be conducted remotely to the extent permitted by the AAA rules. The arbitrator's decision shall be final and
        binding and may be entered as a judgment in any court of competent jurisdiction, including any Wyoming state or
        federal court.
      </p>

      <h3 className={subHeadingClass}>16.3 Arbitration Fees</h3>
      <p className={paragraphClass}>
        Payment of AAA filing, administration, and arbitrator fees shall be governed by the AAA's rules. If you are an
        individual (not an entity) and your claim does not exceed $10,000, WRAPpDEX will reimburse your filing fee and
        pay the arbitrator's fees, provided the arbitrator does not determine your claim is frivolous. For claims above
        $10,000, the AAA's applicable fee schedule shall govern. Each party shall bear its own attorneys' fees and costs,
        except that the arbitrator may award reasonable attorneys' fees and costs to the prevailing party as permitted by
        applicable law.
      </p>

      <h3 className={subHeadingClass}>16.4 Class Action and Jury Trial Waiver</h3>
      <p className={`${paragraphClass} font-semibold`}>
        TO THE FULLEST EXTENT PERMITTED BY LAW, YOU AND WRAPPDEX EACH WAIVE THE RIGHT TO A JURY TRIAL AND THE RIGHT
        TO PARTICIPATE IN A CLASS ACTION, COLLECTIVE ACTION, PRIVATE ATTORNEY GENERAL ACTION, OR ANY OTHER REPRESENTATIVE
        PROCEEDING. ALL DISPUTES SHALL BE RESOLVED ON AN INDIVIDUAL BASIS ONLY. YOU MAY NOT BRING CLAIMS AS A PLAINTIFF
        OR CLASS MEMBER IN ANY PURPORTED CLASS, COLLECTIVE, OR REPRESENTATIVE ACTION.
      </p>

      <h3 className={subHeadingClass}>16.5 Exceptions</h3>
      <p className={paragraphClass}>
        Notwithstanding the foregoing, either party may seek injunctive or other equitable relief in any court of competent
        jurisdiction to prevent the actual or threatened infringement, misappropriation, or violation of intellectual
        property rights or confidential information. Additionally, claims within the jurisdiction of small claims court
        in Laramie County, Wyoming may be brought in such court.
      </p>

      <h3 className={subHeadingClass}>16.6 Statute of Limitations</h3>
      <p className={paragraphClass}>
        To the extent permitted by Wyoming law, any Dispute must be commenced within one (1) year after the date the
        cause of action accrues. Any Dispute filed after this period shall be permanently barred.
      </p>

      {/* Section 17 */}
      <h2 className={headingClass}>17. Governing Law and Jurisdiction</h2>

      <p className={paragraphClass}>
        These Terms and any Dispute arising hereunder shall be governed by and construed in accordance with the laws of
        the <span className={boldInline}>State of Wyoming, United States of America</span>, without regard to its conflict-of-law
        principles. The following Wyoming statutes are specifically incorporated by reference to the extent applicable:
      </p>
      <ul className={listClass}>
        <li>The Wyoming Decentralized Unincorporated Nonprofit Association Act (W.S. &sect; 17-32-101 <em>et seq.</em>),
          governing the organizational status, governance, and member liability protections of WRAPpDEX.</li>
        <li>The Wyoming Digital Assets Act (W.S. &sect; 34-29-101 <em>et seq.</em>), governing the classification and
          treatment of Digital Assets as property under Wyoming law.</li>
        <li>The Wyoming Money Transmitter Act (W.S. &sect; 40-22-101 <em>et seq.</em>), including the exemption for
          non-custodial virtual currency activities at W.S. &sect; 40-22-104(a)(vii).</li>
      </ul>
      <p className={paragraphClass}>
        To the extent that any legal proceeding is permitted outside of arbitration, the parties consent to the exclusive
        personal jurisdiction and venue of the state and federal courts located in Laramie County, Wyoming. You hereby
        waive any objection to such jurisdiction and venue, including any objection based on <em>forum non conveniens</em>.
      </p>

      {/* Section 18 */}
      <h2 className={headingClass}>18. Modification and Termination</h2>

      <h3 className={subHeadingClass}>18.1 Modification</h3>
      <p className={paragraphClass}>
        We reserve the right to modify, amend, or update these Terms at any time in our sole discretion or through DUNA
        governance processes. We will provide notice of material changes by updating the "Last Updated" date at the top of
        these Terms and, where practicable, by posting a notice on the Platform. Your continued use of the Platform
        following such changes constitutes your acceptance of the modified Terms. If you do not agree to any modification,
        you must immediately cease use of the Platform.
      </p>

      <h3 className={subHeadingClass}>18.2 Discontinuation of Service</h3>
      <p className={paragraphClass}>
        WRAPpDEX may discontinue, modify, or suspend the Platform (or any part thereof) at any time, with or without notice.
        Access to the Platform is not guaranteed. You acknowledge that the Platform may become permanently unavailable,
        and that Protocol smart contracts, once deployed on-chain, may continue to function independently of the Interface.
      </p>

      <h3 className={subHeadingClass}>18.3 Termination and Suspension</h3>
      <p className={paragraphClass}>
        We reserve the right to suspend, restrict, or terminate your access to the Platform at any time, with or without
        cause, and with or without notice, including but not limited to circumstances where we reasonably believe that
        your use violates these Terms, applicable law, or poses a risk to the Platform, its users, or any third party.
        Upon termination, all licenses and rights granted to you under these Terms shall immediately cease. Termination
        shall not affect any rights or obligations that accrued prior to the effective date of termination.
      </p>

      <h3 className={subHeadingClass}>18.4 Survival</h3>
      <p className={paragraphClass}>
        The following provisions shall survive termination of these Terms: Sections 2 (DUNA Status), 6 (Assumption of Risk),
        7 (No Financial Advice; No Fiduciary Duty), 8 (Tax Obligations), 9 (Regulatory Status Disclaimers),
        12 (Intellectual Property), 13 (Disclaimer of Warranties), 14 (Limitation of Liability), 15 (Indemnification),
        16 (Dispute Resolution), 17 (Governing Law), and this Section 18.4.
      </p>

      {/* Section 19 */}
      <h2 className={headingClass}>19. General Provisions</h2>

      <h3 className={subHeadingClass}>19.1 Entire Agreement</h3>
      <p className={paragraphClass}>
        These Terms, together with the Privacy Policy and any supplemental terms published on the Platform, constitute
        the entire agreement between you and WRAPpDEX with respect to the subject matter hereof, and supersede all prior
        or contemporaneous communications, representations, or agreements, whether oral or written.
      </p>

      <h3 className={subHeadingClass}>19.2 Severability</h3>
      <p className={paragraphClass}>
        If any provision of these Terms is held to be invalid, illegal, or unenforceable by a court of competent
        jurisdiction or arbitrator, such provision shall be modified to the minimum extent necessary to make it valid and
        enforceable, or if modification is not possible, shall be severed from these Terms. The invalidity or unenforceability
        of any provision shall not affect the validity or enforceability of any other provision. In particular, if the class
        action waiver in Section 16.4 is found unenforceable, the entirety of the arbitration provision in Section 16 shall
        be void and Disputes shall be resolved in the courts specified in Section 17.
      </p>

      <h3 className={subHeadingClass}>19.3 Waiver</h3>
      <p className={paragraphClass}>
        No failure or delay by WRAPpDEX in exercising any right, power, or privilege under these Terms shall operate as
        a waiver thereof. No single or partial exercise of any right, power, or privilege shall preclude any other or
        further exercise thereof or the exercise of any other right, power, or privilege.
      </p>

      <h3 className={subHeadingClass}>19.4 Assignment</h3>
      <p className={paragraphClass}>
        You may not assign or transfer any of your rights or obligations under these Terms without our prior written
        consent. WRAPpDEX may assign or transfer its rights and obligations under these Terms without restriction,
        including in connection with a merger, reorganization, or transfer of substantially all of the Association's
        assets. Any purported assignment in violation of this section shall be null and void.
      </p>

      <h3 className={subHeadingClass}>19.5 Force Majeure</h3>
      <p className={paragraphClass}>
        WRAPpDEX shall not be liable for any delay or failure in performance resulting from causes beyond our reasonable
        control, including but not limited to acts of God, natural disasters, war, terrorism, epidemics, pandemics,
        government actions or regulatory changes, network failures, blockchain congestion or outages, cyberattacks,
        power failures, failures of third-party service providers, or changes in the consensus rules of any supported
        blockchain network.
      </p>

      <h3 className={subHeadingClass}>19.6 No Third-Party Beneficiaries</h3>
      <p className={paragraphClass}>
        These Terms do not create any third-party beneficiary rights in any person or entity, except that the WRAPpDEX
        Parties (including DUNA members and administrators) are intended third-party beneficiaries of the indemnification,
        limitation of liability, and disclaimer of warranty provisions.
      </p>

      <h3 className={subHeadingClass}>19.7 Relationship of the Parties</h3>
      <p className={paragraphClass}>
        Nothing in these Terms shall be construed to create a partnership, joint venture, agency, fiduciary relationship,
        or employment relationship between you and WRAPpDEX. Neither party has the authority to bind the other or to
        incur any obligation on the other's behalf. Your use of the Platform does not create any fiduciary duty owed by
        WRAPpDEX, its administrators, or its DUNA members to you.
      </p>

      <h3 className={subHeadingClass}>19.8 Notices</h3>
      <p className={paragraphClass}>
        We may provide notices to you by posting updates on the Platform, through in-app notifications, or via any
        contact information you have provided to us. You may contact us at the address provided in Section 22 below.
        Notices shall be deemed received upon posting to the Platform.
      </p>

      <h3 className={subHeadingClass}>19.9 Headings</h3>
      <p className={paragraphClass}>
        Section headings are for convenience of reference only and shall not affect the interpretation of these Terms.
      </p>

      {/* Section 20 */}
      <h2 className={headingClass}>20. Export Compliance</h2>

      <p className={paragraphClass}>
        You represent and warrant that your use of the Platform complies with all applicable export control and trade
        sanctions laws, including the U.S. Export Administration Regulations (15 C.F.R. Parts 730-774), the International
        Traffic in Arms Regulations (22 C.F.R. Parts 120-130), and all applicable sanctions programs administered by OFAC.
        You shall not directly or indirectly export, re-export, or transfer any technical data, software, or services
        obtained from the Platform to any jurisdiction or person prohibited under applicable export control or sanctions laws.
      </p>

      {/* Section 21 */}
      <h2 className={headingClass}>21. Compliance with Local Laws</h2>

      <p className={paragraphClass}>
        The Platform is accessible globally via the internet. WRAPpDEX makes no representation that the Platform, its
        content, or the Digital Assets accessible through it are appropriate, lawful, or available for use in any particular
        jurisdiction. You access the Platform on your own initiative and are solely responsible for compliance with all
        applicable local, state, national, and international laws, regulations, and rules, including but not limited to laws
        governing Digital Asset transactions, securities, taxation, data privacy, and consumer protection. If your use of
        the Platform is prohibited by the laws of your jurisdiction, you are not authorized to use the Platform.
      </p>

      {/* Section 22 */}
      <h2 className={headingClass}>22. Contact Information</h2>

      <p className={paragraphClass}>
        If you have any questions, concerns, or complaints regarding these Terms or the Platform, please contact us through
        our official community channels:
      </p>
      <ul className={listClass}>
        <li>
          <span className={boldInline}>Discord:</span>{" "}
          <a href="https://discord.gg/tRSZZ9rUJ" target="_blank" rel="noopener noreferrer" className="text-pink-400 hover:text-pink-300 underline underline-offset-2">
            discord.gg/tRSZZ9rUJ
          </a>
        </li>
        <li>
          <span className={boldInline}>X (formerly Twitter):</span>{" "}
          <a href="https://x.com/WRAPpDEX" target="_blank" rel="noopener noreferrer" className="text-pink-400 hover:text-pink-300 underline underline-offset-2">
            @WRAPpDEX
          </a>
        </li>
      </ul>

      <div className={dividerClass} />

      <p className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"} text-center pb-8`}>
        &copy; 2026 WRAPpDEX. A Wyoming Decentralized Unincorporated Nonprofit Association. All rights reserved.
      </p>
    </div>
  );
}
