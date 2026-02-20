import { useEffect } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";

export function PrivacyPolicy() {
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
        to="/markets"
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
          WRAPpDEX Privacy Policy
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
        This Privacy Policy (the <span className={boldInline}>"Policy"</span>) describes how WRAPpDEX, a Decentralized
        Unincorporated Nonprofit Association organized under the laws of the State of Wyoming pursuant to W.S. &sect; 17-32-101{" "}
        <em>et seq.</em>
        (<span className={boldInline}>"WRAPpDEX,"</span> <span className={boldInline}>"the Association,"</span> <span className={boldInline}>"we,"</span> <span className={boldInline}>"us,"</span> or <span className={boldInline}>"our"</span>)
        collects, uses, shares, and protects information in connection with your access to and use of the WRAPpDEX
        decentralized exchange platform, including the website, web application, APIs, and all related services
        (collectively, the <span className={boldInline}>"Platform"</span>).
      </p>
      <p className={paragraphClass}>
        By accessing or using the Platform, you acknowledge that you have read, understood, and agree to be bound
        by this Policy. If you do not agree to this Policy, you must not access or use the Platform. This Policy
        should be read in conjunction with our{" "}
        <Link to="/terms" className="text-pink-400 hover:text-pink-300 underline underline-offset-2">Terms of Service</Link>.
      </p>

      {/* Section 1 */}
      <h2 className={headingClass}>1. Our Privacy Commitment</h2>

      <p className={paragraphClass}>
        WRAPpDEX is built on principles of decentralization and user sovereignty. We are committed to minimizing
        data collection and respecting your privacy. As a non-custodial platform, we do not require account
        registration, email addresses, phone numbers, government-issued identification, or any other personally
        identifiable information to use the core features of the Platform.
      </p>
      <p className={paragraphClass}>
        WRAPpDEX is organized as a Wyoming DUNA and operates under the laws of the State of Wyoming. As of the
        effective date of this Policy, Wyoming does not maintain a comprehensive consumer data privacy statute
        comparable to the California Consumer Privacy Act (CCPA) or the European Union General Data Protection
        Regulation (GDPR). Nevertheless, WRAPpDEX voluntarily adopts privacy-protective practices that meet or
        exceed the standards set by leading privacy frameworks, because we believe that privacy is a fundamental
        right that should not depend on jurisdictional requirements alone.
      </p>

      {/* Section 2 */}
      <h2 className={headingClass}>2. Legal Basis for Processing</h2>

      <p className={paragraphClass}>
        Depending on your jurisdiction and the nature of the data involved, our processing of information is based
        on one or more of the following legal grounds:
      </p>
      <ul className={listClass}>
        <li>
          <span className={boldInline}>Contractual Necessity:</span> Processing required to provide you with the
          Platform and fulfill our obligations under the{" "}
          <Link to="/terms" className="text-pink-400 hover:text-pink-300 underline underline-offset-2">Terms of Service</Link>,
          including session authentication, transaction facilitation, and account data display.
        </li>
        <li>
          <span className={boldInline}>Legitimate Interest:</span> Processing necessary for the purposes of our
          legitimate interests, provided those interests are not overridden by your rights and freedoms. This
          includes security monitoring, abuse prevention, rate limiting, analytics for service improvement,
          and the maintenance of Platform integrity.
        </li>
        <li>
          <span className={boldInline}>Legal Obligation:</span> Processing required to comply with applicable laws,
          regulations, or enforceable governmental requests, including sanctions screening and responses to
          lawful legal process.
        </li>
        <li>
          <span className={boldInline}>Consent:</span> Where required by applicable law, we will obtain your consent
          before processing data for purposes not covered by the grounds above. You may withdraw consent at any
          time, though withdrawal will not affect the lawfulness of processing that occurred prior to withdrawal.
        </li>
      </ul>

      {/* Section 3 */}
      <h2 className={headingClass}>3. Information We Collect</h2>

      <h3 className={subHeadingClass}>3.1 Information You Provide Directly</h3>
      <p className={paragraphClass}>
        The Platform is designed to operate without traditional user accounts. However, in certain limited
        circumstances, you may voluntarily provide information:
      </p>
      <ul className={listClass}>
        <li>
          <span className={boldInline}>Wallet Addresses:</span> When you connect a self-custodial wallet (e.g., HashPack, MetaMask)
          to the Platform, your public wallet address is transmitted to our servers for the purpose of facilitating
          transactions, authenticating sessions, and displaying account-specific data (such as token balances and
          transaction history). Wallet addresses are pseudonymous identifiers inherent to blockchain technology
          and are publicly visible on the applicable blockchain.
        </li>
        <li>
          <span className={boldInline}>Governance Participation:</span> If you participate in DAO governance features, your
          wallet address and voting activity may be recorded in association with proposals, votes, and comments
          you submit. This data is used for on-platform governance functionality and does not automatically
          constitute a record of formal DUNA governance (see Section 3.3).
        </li>
        <li>
          <span className={boldInline}>Community Communications:</span> If you contact us through our Discord, X (Twitter),
          or other community channels, we may receive and retain the content of your communications, your social
          media handle, and any information you voluntarily provide.
        </li>
      </ul>

      <h3 className={subHeadingClass}>3.2 Information Collected Automatically</h3>
      <p className={paragraphClass}>
        When you access the Platform, certain technical information may be collected automatically:
      </p>
      <ul className={listClass}>
        <li>
          <span className={boldInline}>Device and Browser Information:</span> Browser type and version, operating system,
          device type, screen resolution, and language preferences.
        </li>
        <li>
          <span className={boldInline}>Network Information:</span> IP address (which may be used for rate limiting,
          abuse prevention, and geographic restriction enforcement), referral URLs, and internet service provider
          information. IP addresses used for rate limiting are retained only for the duration of the rate limiting
          window (typically seconds to minutes) and are automatically purged. IP addresses associated with security
          events may be retained for up to ninety (90) days.
        </li>
        <li>
          <span className={boldInline}>Usage Data:</span> Pages visited, features used, interactions with the Platform,
          session duration, and timestamp data. This information is collected in aggregate and is used solely for
          performance monitoring, error diagnosis, and service improvement.
        </li>
        <li>
          <span className={boldInline}>Transaction Metadata:</span> When you execute transactions through the Platform,
          metadata such as transaction timestamps, token pair identifiers, pool identifiers, and anonymized trade
          activity may be logged for operational purposes (e.g., recent activity feeds). Individual swap histories
          are associated with wallet addresses but are accessible only to the authenticated wallet holder.
        </li>
      </ul>

      <h3 className={subHeadingClass}>3.3 DAO Governance Data and DUNA Records</h3>
      <p className={paragraphClass}>
        The Platform's DAO governance module records on-platform votes, proposals, and related governance activity.
        This data is operational Platform data used to display governance results and facilitate community engagement.
        It is <span className={boldInline}>distinct from</span> formal DUNA organizational records, which are maintained
        separately by the Association in accordance with Wyoming law. Participation in on-platform governance votes
        does not confer DUNA membership, and on-platform governance data is not treated as a DUNA membership registry.
      </p>

      <h3 className={subHeadingClass}>3.4 Blockchain Data</h3>
      <p className={paragraphClass}>
        When you execute transactions through the Platform, those transactions are recorded on the Hedera distributed ledger
        (or other applicable blockchain). On-chain data &mdash; including wallet addresses, transaction amounts, token
        identifiers, and timestamps &mdash; is publicly visible, permanent, and immutable. This data is not collected or
        controlled by WRAPpDEX; it is a fundamental characteristic of blockchain technology. You should carefully consider
        the permanent, public nature of blockchain records before executing any transaction.
      </p>

      <h3 className={subHeadingClass}>3.5 Information We Do NOT Collect</h3>
      <p className={paragraphClass}>
        WRAPpDEX does not collect, store, or have access to:
      </p>
      <ul className={listClass}>
        <li>Private keys, seed phrases, recovery phrases, or wallet passwords.</li>
        <li>Government-issued identification documents (passport, driver's license, national ID).</li>
        <li>Social Security numbers, tax identification numbers, or equivalent government identifiers.</li>
        <li>Payment card numbers, bank account details, or other traditional financial account information.</li>
        <li>Biometric data (fingerprints, facial recognition, voice prints).</li>
        <li>Precise geolocation data (GPS coordinates).</li>
        <li>Email addresses or phone numbers (unless voluntarily provided through community channels).</li>
        <li>Information about the reserve backing, redemption status, or regulatory compliance of any third-party
          stablecoin or Digital Asset that you transact with on the Platform.</li>
      </ul>
      <p className={paragraphClass}>
        Where fiat on-ramp or off-ramp services are available through the Platform, such services are operated
        by third-party providers. Any personal or financial information you provide to those third-party providers
        is subject to their respective privacy policies, and WRAPpDEX does not receive, store, or process such information.
      </p>

      {/* Section 4 */}
      <h2 className={headingClass}>4. How We Use Information</h2>

      <p className={paragraphClass}>We use the information we collect for the following purposes:</p>
      <ul className={listClass}>
        <li>
          <span className={boldInline}>Platform Operation:</span> To provide, maintain, and improve the Platform's
          functionality, including transaction processing, session authentication, and display of account-specific data.
        </li>
        <li>
          <span className={boldInline}>Security and Abuse Prevention:</span> To detect, prevent, and respond to fraud,
          abuse, security incidents, and technical issues, including rate limiting, IP-based access restrictions, and
          sanctions compliance screening.
        </li>
        <li>
          <span className={boldInline}>Service Improvement:</span> To analyze aggregate usage patterns and trends for
          the purpose of improving user experience, optimizing performance, and developing new features.
        </li>
        <li>
          <span className={boldInline}>Legal Compliance:</span> To comply with applicable laws, regulations, legal
          processes, or enforceable governmental requests, including sanctions screening obligations.
        </li>
        <li>
          <span className={boldInline}>Communication:</span> To respond to inquiries, support requests, or reports
          submitted through community channels.
        </li>
        <li>
          <span className={boldInline}>Safety and Rights Protection:</span> To protect the safety, rights, or property
          of WRAPpDEX, its DUNA members, Platform users, or the public, as required or permitted by law.
        </li>
      </ul>
      <p className={paragraphClass}>
        We do <span className={boldInline}>not</span> use information collected through the Platform for targeted advertising,
        user profiling for commercial purposes, or sale to data brokers.
      </p>

      {/* Section 5 */}
      <h2 className={headingClass}>5. How We Share Information</h2>

      <p className={paragraphClass}>
        We do not sell, rent, or trade your personal information to third parties for marketing or advertising
        purposes. We will never sell your data. We may share information in the following limited circumstances:
      </p>
      <ul className={listClass}>
        <li>
          <span className={boldInline}>Blockchain Transparency:</span> Transactions executed through the Platform
          are recorded on the Hedera distributed ledger (or other applicable blockchain), which is publicly visible
          and immutable. Wallet addresses and transaction data recorded on-chain are inherently public and are not
          within our control. You should carefully consider the public nature of blockchain data before executing
          any transaction.
        </li>
        <li>
          <span className={boldInline}>Third-Party Service Providers:</span> We may share limited technical information
          with third-party service providers who assist us in operating the Platform (e.g., hosting providers, analytics
          services, oracle providers), subject to contractual obligations to protect the confidentiality and security
          of such information. We require all such providers to process data only as instructed and to implement
          appropriate security measures.
        </li>
        <li>
          <span className={boldInline}>Legal Obligations and Law Enforcement:</span> We may disclose information if
          required to do so by law, regulation, subpoena, court order, or other legal process, or if we reasonably
          believe that disclosure is necessary to: (a) comply with applicable law or legal process; (b) protect our
          rights, property, or safety, or that of our users or the public; (c) investigate potential violations of
          the Terms of Service or applicable law; or (d) respond to a valid governmental request. Where permitted by law,
          we will endeavor to provide you with prior notice of such disclosure. Where prior notice is prohibited by
          law or court order, we will provide notice as soon as the prohibition is lifted.
        </li>
        <li>
          <span className={boldInline}>Business Transfers:</span> In the event of a merger, acquisition, reorganization,
          dissolution, or similar event involving the WRAPpDEX DUNA, information may be transferred to the successor
          entity, subject to this Policy and applicable law. We will provide notice of any such transfer and, where
          feasible, offer you the opportunity to opt out.
        </li>
        <li>
          <span className={boldInline}>With Your Consent:</span> We may share information with third parties when you
          have given us explicit consent to do so.
        </li>
      </ul>

      {/* Section 6 */}
      <h2 className={headingClass}>6. Cookies and Tracking Technologies</h2>

      <h3 className={subHeadingClass}>6.1 Local Storage</h3>
      <p className={paragraphClass}>
        The Platform uses browser local storage and session storage to maintain your preferences (such as theme
        selection, sound settings, and VIP preferences), session state, and cached data necessary for the Platform
        to function. This data is stored locally on your device and is not transmitted to our servers unless
        required for Platform functionality.
      </p>

      <h3 className={subHeadingClass}>6.2 Essential Cookies</h3>
      <p className={paragraphClass}>
        The Platform may use essential cookies that are strictly necessary for the operation of the Platform,
        including session management and security features. These cookies do not track your browsing activity
        across other websites.
      </p>

      <h3 className={subHeadingClass}>6.3 Analytics</h3>
      <p className={paragraphClass}>
        We may use privacy-respecting analytics tools to collect aggregate, anonymized usage data for the sole
        purpose of understanding how users interact with the Platform and improving our services. We do not use
        invasive third-party advertising trackers, pixel tags, or cross-site tracking technologies. We do not
        build advertising profiles or sell analytics data to third parties.
      </p>

      {/* Section 7 */}
      <h2 className={headingClass}>7. Data Retention</h2>

      <p className={paragraphClass}>
        We retain information only for as long as reasonably necessary to fulfill the purposes described in this
        Policy, unless a longer retention period is required or permitted by law. Specifically:
      </p>
      <ul className={listClass}>
        <li>
          <span className={boldInline}>Session Data:</span> Authentication session data is retained for the duration
          of the session and for a limited period thereafter (typically no more than 24 hours) for security purposes.
        </li>
        <li>
          <span className={boldInline}>Transaction Logs:</span> On-platform transaction metadata (swap logs, liquidity
          events) may be retained for operational and diagnostic purposes for up to twenty-four (24) months. On-chain
          transaction data is permanent and immutable by nature and is outside our control.
        </li>
        <li>
          <span className={boldInline}>Rate Limiting Data:</span> IP-based rate limiting data is retained only for
          the duration of the rate limiting window (typically seconds to minutes) and is automatically purged.
        </li>
        <li>
          <span className={boldInline}>Security Event Data:</span> Data associated with suspected security incidents,
          abuse, or violations of the Terms of Service may be retained for up to ninety (90) days, or longer if
          required for ongoing investigation or legal proceedings.
        </li>
        <li>
          <span className={boldInline}>Aggregated Data:</span> Anonymized, aggregated usage data that cannot be used
          to identify any individual may be retained indefinitely for analytics and service improvement purposes.
        </li>
        <li>
          <span className={boldInline}>Legal Hold Data:</span> If we are subject to a legal hold, litigation, regulatory
          investigation, or similar legal obligation, relevant data may be retained beyond the periods described above
          for the duration of such obligation.
        </li>
      </ul>

      {/* Section 8 */}
      <h2 className={headingClass}>8. Data Security</h2>

      <p className={paragraphClass}>
        We implement reasonable administrative, technical, and physical security measures to protect the information
        we collect and maintain. These measures include, but are not limited to:
      </p>
      <ul className={listClass}>
        <li>Encryption of data in transit using TLS/SSL.</li>
        <li>Server-side access controls, authentication, and authorization mechanisms.</li>
        <li>Rate limiting and abuse prevention systems.</li>
        <li>Periodic internal security reviews and code assessments. Formal independent security audits of Platform
          smart contracts are planned and will be completed prior to the production launch of AMM and swap features;
          audit results will be published transparently when available.</li>
        <li>Principle of least privilege for internal access to systems and data.</li>
        <li>Monitoring for unauthorized access attempts and anomalous activity.</li>
      </ul>
      <p className={paragraphClass}>
        However, no method of transmission over the internet or method of electronic storage is completely secure.
        While we strive to use commercially reasonable means to protect your information, we cannot guarantee absolute
        security. You acknowledge that you use the Platform at your own risk.
      </p>

      {/* Section 9 */}
      <h2 className={headingClass}>9. Data Breach Notification</h2>

      <p className={paragraphClass}>
        In the event of a data breach that we reasonably believe has resulted in unauthorized access to, or
        acquisition of, personal information that creates a material risk of identity theft or other tangible harm,
        we will:
      </p>
      <ul className={listClass}>
        <li>Promptly investigate the nature and scope of the breach.</li>
        <li>Take reasonable steps to contain the breach and mitigate potential harm.</li>
        <li>Notify affected Users through available communication channels (including in-app notifications and
          our official Discord and X accounts) without unreasonable delay and, in any event, within the timeframes
          required by applicable law.</li>
        <li>Where required by applicable law, notify relevant regulatory authorities and law enforcement.</li>
        <li>Provide a description of the incident, the types of data involved, the measures taken in response, and
          recommendations for steps Users can take to protect themselves.</li>
      </ul>
      <p className={paragraphClass}>
        Due to the non-custodial, pseudonymous nature of the Platform, the personal information at risk in any
        breach is inherently limited compared to traditional financial platforms. We do not hold private keys,
        financial account numbers, or government identification, which significantly reduces the scope of potential harm.
      </p>

      {/* Section 10 */}
      <h2 className={headingClass}>10. Your Rights and Choices</h2>

      <h3 className={subHeadingClass}>10.1 Wallet Disconnection</h3>
      <p className={paragraphClass}>
        You may disconnect your wallet from the Platform at any time through the wallet menu in the Platform interface.
        Disconnecting your wallet will end your active session and prevent further association of your wallet address
        with Platform activity. Note that on-chain transactions are permanent and cannot be deleted.
      </p>

      <h3 className={subHeadingClass}>10.2 Local Storage</h3>
      <p className={paragraphClass}>
        You may clear browser local storage and cookies at any time through your browser settings. Doing so will
        remove locally stored preferences and session data but will not affect any data stored on our servers or
        on the blockchain.
      </p>

      <h3 className={subHeadingClass}>10.3 Data Subject Rights (Where Applicable)</h3>
      <p className={paragraphClass}>
        Depending on your jurisdiction, you may have certain rights with respect to your personal information. Where
        applicable law grants such rights, we will honor them to the extent technically feasible and legally required.
        These rights may include:
      </p>
      <ul className={listClass}>
        <li><span className={boldInline}>Right of Access:</span> The right to request a copy of the personal information we hold about you.</li>
        <li><span className={boldInline}>Right to Rectification:</span> The right to request correction of inaccurate personal information.</li>
        <li><span className={boldInline}>Right to Erasure:</span> The right to request deletion of your personal information, subject to our legal obligations and legitimate interests.</li>
        <li><span className={boldInline}>Right to Restriction:</span> The right to request that we restrict processing of your personal information in certain circumstances.</li>
        <li><span className={boldInline}>Right to Data Portability:</span> The right to receive your personal information in a structured, machine-readable format.</li>
        <li><span className={boldInline}>Right to Object:</span> The right to object to processing based on legitimate interest.</li>
        <li><span className={boldInline}>Right to Withdraw Consent:</span> Where processing is based on consent, you may withdraw consent at any time without affecting the lawfulness of prior processing.</li>
        <li><span className={boldInline}>Right to Lodge a Complaint:</span> If you believe your privacy rights have been violated, you may have the right to lodge a complaint with a supervisory authority in your jurisdiction.</li>
      </ul>
      <p className={paragraphClass}>
        Due to the pseudonymous and decentralized nature of the Platform, our ability to identify and associate data with
        specific individuals is inherently limited. To exercise any data subject rights, please contact us through the
        channels listed in Section 15, and we will respond within the timeframes required by applicable law (generally
        thirty (30) days, subject to extension where permitted). We may require verification of your identity (e.g.,
        wallet signature) before processing such requests. We will not charge a fee for processing reasonable requests,
        except where permitted by applicable law for manifestly unfounded or excessive requests.
      </p>

      <h3 className={subHeadingClass}>10.4 Do Not Track</h3>
      <p className={paragraphClass}>
        The Platform does not currently respond to "Do Not Track" browser signals, as there is no universally
        accepted standard for how such signals should be interpreted by online services. However, our data
        collection practices are already minimal and privacy-respecting by design.
      </p>

      <h3 className={subHeadingClass}>10.5 Right to Non-Discrimination</h3>
      <p className={paragraphClass}>
        We will not discriminate against you for exercising any of your privacy rights. Exercising your rights will not
        result in denial of service, degraded service quality, or any other adverse treatment.
      </p>

      {/* Section 11 */}
      <h2 className={headingClass}>11. Children's Privacy</h2>

      <p className={paragraphClass}>
        The Platform is not directed to, and we do not knowingly collect personal information from, individuals
        under the age of eighteen (18) or the age of legal majority in their jurisdiction, whichever is greater.
        If we become aware that we have collected personal information from a minor, we will take reasonable steps
        to delete such information promptly. If you believe that a minor has provided us with personal information,
        please contact us through the channels listed in Section 15.
      </p>

      {/* Section 12 */}
      <h2 className={headingClass}>12. International Users and Cross-Border Data Transfers</h2>

      <p className={paragraphClass}>
        WRAPpDEX is organized under the laws of the State of Wyoming, United States, and our primary infrastructure
        is hosted within the United States. If you access the Platform from outside the United States, please be
        aware that information may be transferred to, stored in, and processed in the United States and other
        jurisdictions where our service providers maintain facilities.
      </p>
      <p className={paragraphClass}>
        The data protection and privacy laws of these jurisdictions may differ from those of your country of
        residence. By using the Platform, you consent to the transfer, storage, and processing of your information
        in the United States and other applicable jurisdictions, in accordance with this Policy. Where required by
        applicable law (such as the GDPR), we will implement appropriate safeguards for cross-border data transfers,
        which may include Standard Contractual Clauses approved by the European Commission or reliance on adequacy
        decisions, as applicable.
      </p>

      {/* Section 13 */}
      <h2 className={headingClass}>13. Changes to This Policy</h2>

      <p className={paragraphClass}>
        We reserve the right to modify this Policy at any time, including through DUNA governance processes. If we
        make material changes, we will update the "Last Updated" date at the top of this Policy and, where
        practicable, provide notice through the Platform (e.g., via in-app notification or banner). Your continued
        use of the Platform after any changes to this Policy constitutes your acceptance of the revised Policy.
        We encourage you to review this Policy periodically. If you do not agree to a revised Policy, your sole
        remedy is to discontinue use of the Platform.
      </p>

      {/* Section 14 */}
      <h2 className={headingClass}>14. Governing Law</h2>

      <p className={paragraphClass}>
        This Policy shall be governed by and construed in accordance with the laws of the{" "}
        <span className={boldInline}>State of Wyoming, United States of America</span>, without regard to its
        conflict-of-law principles. Any disputes arising out of or relating to this Policy are subject to the
        dispute resolution provisions set forth in our{" "}
        <Link to="/terms" className="text-pink-400 hover:text-pink-300 underline underline-offset-2">Terms of Service</Link>.
      </p>

      {/* Section 15 */}
      <h2 className={headingClass}>15. Contact Information</h2>

      <p className={paragraphClass}>
        If you have any questions, concerns, or requests regarding this Privacy Policy, our data practices, or
        wish to exercise your data subject rights, please contact us through our official community channels:
      </p>
      <ul className={listClass}>
        <li>
          <span className={boldInline}>Discord:</span>{" "}
          <a href="https://discord.gg/ZFnfRFxQZ" target="_blank" rel="noopener noreferrer" className="text-pink-400 hover:text-pink-300 underline underline-offset-2">
            discord.gg/ZFnfRFxQZ
          </a>
        </li>
        <li>
          <span className={boldInline}>X (formerly Twitter):</span>{" "}
          <a href="https://x.com/WRAPpDEX" target="_blank" rel="noopener noreferrer" className="text-pink-400 hover:text-pink-300 underline underline-offset-2">
            @WRAPpDEX
          </a>
        </li>
      </ul>
      <p className={paragraphClass}>
        We will endeavor to respond to all privacy-related inquiries within thirty (30) days of receipt. For requests
        subject to specific statutory response deadlines, we will comply with the applicable timeframes.
      </p>

      <div className={dividerClass} />

      <p className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"} text-center pb-8`}>
        &copy; 2026 WRAPpDEX. A Wyoming Decentralized Unincorporated Nonprofit Association. All rights reserved.
      </p>
    </div>
  );
}