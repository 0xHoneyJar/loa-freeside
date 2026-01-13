import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'privacy // ARRAKIS',
  description:
    'Privacy Policy for Arrakis. Learn how we collect, use, and protect your data.',
};

export default function PrivacyPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <section>
        <div className="text-sand-dim text-xs mb-2">// legal / privacy</div>
        <h1 className="text-2xl text-sand-bright">privacy policy</h1>
        <p className="text-sand-dim text-sm mt-2">
          effective: january 1, 2026 | updated: january 6, 2026
        </p>
      </section>

      {/* Content */}
      <div className="space-y-8 text-sm">
        {/* 1. Introduction */}
        <section>
          <h2 className="text-sand-bright mb-3">1. introduction</h2>
          <div className="text-sand space-y-3">
            <p>
              arrakis, a product of <span className="text-spice">The Honey Jar Corp</span> (&quot;company,&quot; &quot;we,&quot; &quot;us,&quot; or
              &quot;our&quot;) respects your privacy and is committed to
              protecting your personal data. this privacy policy explains how we
              collect, use, disclose, and safeguard your information when you
              use our platform, including our website at arrakis.community, discord
              bot, telegram bot, apis, and related services (collectively, the
              &quot;service&quot;).
            </p>
            <p>
              please read this privacy policy carefully. by using the service,
              you consent to the practices described in this policy.
            </p>
          </div>
        </section>

        {/* 2. Information We Collect */}
        <section>
          <h2 className="text-sand-bright mb-3">2. information we collect</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">2.1 information you provide</h3>
              <div className="text-sand-dim space-y-3">
                <div>
                  <p className="text-spice mb-1">account information:</p>
                  <div className="pl-4 space-y-1">
                    <p>
                      <span className="text-sand-dim">+</span> email address
                      (for account registration and communication)
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> username or
                      display name
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> password (stored
                      in hashed form)
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> payment
                      information (processed by third-party processors)
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-spice mb-1">community configuration:</p>
                  <div className="pl-4 space-y-1">
                    <p>
                      <span className="text-sand-dim">+</span> discord server
                      settings and configurations
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> telegram group
                      settings and configurations
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> token contract
                      addresses and chain selections
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> tier thresholds
                      and badge configurations
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> custom theme
                      settings (enterprise)
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">
                2.2 information collected automatically
              </h3>
              <div className="text-sand-dim space-y-3">
                <div>
                  <p className="text-spice mb-1">platform identifiers:</p>
                  <div className="pl-4 space-y-1">
                    <p>
                      <span className="text-sand-dim">+</span> discord user id
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> discord server id
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> telegram user id
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> telegram group id
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-spice mb-1">wallet information:</p>
                  <div className="pl-4 space-y-1">
                    <p>
                      <span className="text-sand-dim">+</span> public wallet
                      addresses you connect to the service
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> publicly
                      available blockchain data (balances, transactions, nft
                      ownership)
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-spice mb-1">usage data:</p>
                  <div className="pl-4 space-y-1">
                    <p>
                      <span className="text-sand-dim">+</span> log data (ip
                      address, browser type, device information)
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> feature usage
                      patterns
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> error logs and
                      diagnostic data
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> timestamps of
                      interactions
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-spice mb-1">
                    cookies and similar technologies:
                  </p>
                  <div className="pl-4 space-y-1">
                    <p>
                      <span className="text-sand-dim">+</span> session cookies
                      for authentication
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> preference cookies
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> analytics cookies
                      (with consent where required)
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">
                2.3 information from third parties
              </h3>
              <div className="text-sand-dim space-y-3">
                <div>
                  <p className="text-spice mb-1">blockchain data:</p>
                  <div className="pl-4 space-y-1">
                    <p>
                      <span className="text-sand-dim">+</span> public blockchain
                      data via rpc providers and our score service
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> token balances,
                      nft ownership, transaction history
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-spice mb-1">platform apis:</p>
                  <div className="pl-4 space-y-1">
                    <p>
                      <span className="text-sand-dim">+</span> discord api
                      (server membership, roles, permissions)
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> telegram api
                      (group membership, user status)
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. How We Use Your Information */}
        <section>
          <h2 className="text-sand-bright mb-3">
            3. how we use your information
          </h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">3.1 to provide the service</h3>
              <div className="text-sand-dim pl-4 space-y-1">
                <p>
                  <span className="text-sand-dim">+</span> verify blockchain
                  asset ownership for token-gating
                </p>
                <p>
                  <span className="text-sand-dim">+</span> calculate conviction
                  scores based on on-chain behavior
                </p>
                <p>
                  <span className="text-sand-dim">+</span> assign and manage
                  tier roles in discord and telegram
                </p>
                <p>
                  <span className="text-sand-dim">+</span> award badges based on
                  activity and achievements
                </p>
                <p>
                  <span className="text-sand-dim">+</span> generate analytics
                  and insights for community operators
                </p>
                <p>
                  <span className="text-sand-dim">+</span> process payments for
                  paid subscriptions
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">3.2 to improve the service</h3>
              <div className="text-sand-dim pl-4 space-y-1">
                <p>
                  <span className="text-sand-dim">+</span> analyze usage
                  patterns to improve features
                </p>
                <p>
                  <span className="text-sand-dim">+</span> debug issues and fix
                  errors
                </p>
                <p>
                  <span className="text-sand-dim">+</span> develop new features
                  and capabilities
                </p>
                <p>
                  <span className="text-sand-dim">+</span> conduct research and
                  analysis
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">3.3 to communicate with you</h3>
              <div className="text-sand-dim pl-4 space-y-1">
                <p>
                  <span className="text-sand-dim">+</span> send service-related
                  notifications
                </p>
                <p>
                  <span className="text-sand-dim">+</span> respond to support
                  requests
                </p>
                <p>
                  <span className="text-sand-dim">+</span> provide important
                  updates about your account
                </p>
                <p>
                  <span className="text-sand-dim">+</span> send marketing
                  communications (with consent, where required)
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">
                3.4 for security and compliance
              </h3>
              <div className="text-sand-dim pl-4 space-y-1">
                <p>
                  <span className="text-sand-dim">+</span> detect and prevent
                  fraud or abuse
                </p>
                <p>
                  <span className="text-sand-dim">+</span> enforce our terms of
                  service
                </p>
                <p>
                  <span className="text-sand-dim">+</span> comply with legal
                  obligations
                </p>
                <p>
                  <span className="text-sand-dim">+</span> respond to legal
                  requests
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 4. Legal Basis for Processing (GDPR) */}
        <section>
          <h2 className="text-sand-bright mb-3">
            4. legal basis for processing (gdpr)
          </h2>
          <div className="text-sand-dim space-y-3">
            <p>
              if you are in the european economic area (eea) or uk, we process
              your personal data based on the following legal grounds:
            </p>

            <div className="border border-sand-dim/30 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-sand-dim/30">
                    <th className="text-left p-3 text-sand-dim">purpose</th>
                    <th className="text-left p-3 text-sand-dim">legal basis</th>
                  </tr>
                </thead>
                <tbody className="text-sand-dim">
                  <tr className="border-b border-sand-dim/10">
                    <td className="p-3">providing the service</td>
                    <td className="p-3">contract performance</td>
                  </tr>
                  <tr className="border-b border-sand-dim/10">
                    <td className="p-3">account management</td>
                    <td className="p-3">contract performance</td>
                  </tr>
                  <tr className="border-b border-sand-dim/10">
                    <td className="p-3">payment processing</td>
                    <td className="p-3">contract performance</td>
                  </tr>
                  <tr className="border-b border-sand-dim/10">
                    <td className="p-3">security and fraud prevention</td>
                    <td className="p-3">legitimate interests</td>
                  </tr>
                  <tr className="border-b border-sand-dim/10">
                    <td className="p-3">service improvement</td>
                    <td className="p-3">legitimate interests</td>
                  </tr>
                  <tr className="border-b border-sand-dim/10">
                    <td className="p-3">marketing communications</td>
                    <td className="p-3">consent</td>
                  </tr>
                  <tr>
                    <td className="p-3">legal compliance</td>
                    <td className="p-3">legal obligation</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* 5. How We Share Your Information */}
        <section>
          <h2 className="text-sand-bright mb-3">
            5. how we share your information
          </h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">5.1 service providers</h3>
              <div className="text-sand-dim space-y-3">
                <p>
                  we share information with third-party service providers who
                  assist in operating the service:
                </p>

                <div className="border border-sand-dim/30 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-sand-dim/30">
                        <th className="text-left p-3 text-sand-dim">
                          provider type
                        </th>
                        <th className="text-left p-3 text-sand-dim">purpose</th>
                        <th className="text-left p-3 text-sand-dim">
                          data shared
                        </th>
                      </tr>
                    </thead>
                    <tbody className="text-sand-dim">
                      <tr className="border-b border-sand-dim/10">
                        <td className="p-3">cloud hosting</td>
                        <td className="p-3">infrastructure</td>
                        <td className="p-3">all service data</td>
                      </tr>
                      <tr className="border-b border-sand-dim/10">
                        <td className="p-3">payment processors</td>
                        <td className="p-3">billing</td>
                        <td className="p-3">payment information</td>
                      </tr>
                      <tr className="border-b border-sand-dim/10">
                        <td className="p-3">analytics providers</td>
                        <td className="p-3">usage analysis</td>
                        <td className="p-3">anonymized usage data</td>
                      </tr>
                      <tr className="border-b border-sand-dim/10">
                        <td className="p-3">rpc providers</td>
                        <td className="p-3">blockchain queries</td>
                        <td className="p-3">wallet addresses</td>
                      </tr>
                      <tr>
                        <td className="p-3">email services</td>
                        <td className="p-3">communications</td>
                        <td className="p-3">email addresses</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">5.2 community visibility</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  certain information is visible within communities you
                  participate in:
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> your tier rank (if
                    configured by community operator)
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> badges you&apos;ve
                    earned
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> conviction score
                    (if displayed by community operator)
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> your
                    discord/telegram username
                  </p>
                </div>
                <p>
                  community operators can see aggregated analytics about their
                  community members.
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">5.3 public blockchain data</h3>
              <p className="text-sand-dim">
                wallet addresses and associated blockchain data are publicly
                available on blockchain networks. our service reads this public
                data but does not make private data public.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">5.4 legal requirements</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  we may disclose information if required by law, court order,
                  or government request, or if we believe disclosure is
                  necessary to:
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> comply with legal
                    obligations
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> protect our rights
                    or property
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> prevent fraud or
                    security issues
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> protect the safety
                    of users or the public
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">5.5 business transfers</h3>
              <p className="text-sand-dim">
                in the event of a merger, acquisition, or sale of assets, your
                information may be transferred to the acquiring entity.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">5.6 with your consent</h3>
              <p className="text-sand-dim">
                we may share information for other purposes with your explicit
                consent.
              </p>
            </div>
          </div>
        </section>

        {/* 6. Data Retention */}
        <section>
          <h2 className="text-sand-bright mb-3">6. data retention</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">6.1 retention periods</h3>
              <div className="border border-sand-dim/30 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-sand-dim/30">
                      <th className="text-left p-3 text-sand-dim">data type</th>
                      <th className="text-left p-3 text-sand-dim">
                        retention period
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-sand-dim">
                    <tr className="border-b border-sand-dim/10">
                      <td className="p-3">account information</td>
                      <td className="p-3">until account deletion + 30 days</td>
                    </tr>
                    <tr className="border-b border-sand-dim/10">
                      <td className="p-3">community configurations</td>
                      <td className="p-3">until community removal + 30 days</td>
                    </tr>
                    <tr className="border-b border-sand-dim/10">
                      <td className="p-3">wallet connections</td>
                      <td className="p-3">until disconnected + 30 days</td>
                    </tr>
                    <tr className="border-b border-sand-dim/10">
                      <td className="p-3">usage logs</td>
                      <td className="p-3">90 days</td>
                    </tr>
                    <tr className="border-b border-sand-dim/10">
                      <td className="p-3">analytics data</td>
                      <td className="p-3">24 months (anonymized)</td>
                    </tr>
                    <tr className="border-b border-sand-dim/10">
                      <td className="p-3">payment records</td>
                      <td className="p-3">7 years (legal requirement)</td>
                    </tr>
                    <tr>
                      <td className="p-3">support communications</td>
                      <td className="p-3">3 years</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">6.2 deletion</h3>
              <div className="text-sand-dim space-y-2">
                <p>when you delete your account or disconnect a wallet:</p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> we remove your
                    personal data within 30 days
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> some data may be
                    retained in backups for up to 90 days
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> anonymized or
                    aggregated data may be retained indefinitely
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> data required for
                    legal compliance is retained as required
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 7. Data Security */}
        <section>
          <h2 className="text-sand-bright mb-3">7. data security</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">7.1 security measures</h3>
              <div className="text-sand-dim space-y-3">
                <p>
                  we implement appropriate technical and organizational measures
                  to protect your data:
                </p>

                <div>
                  <p className="text-spice mb-1">technical measures:</p>
                  <div className="pl-4 space-y-1">
                    <p>
                      <span className="text-sand-dim">+</span> encryption in
                      transit (tls/https)
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> encryption at
                      rest for sensitive data
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> postgresql
                      row-level security (rls) for tenant isolation
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> secure password
                      hashing
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> regular security
                      assessments
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-spice mb-1">organizational measures:</p>
                  <div className="pl-4 space-y-1">
                    <p>
                      <span className="text-sand-dim">+</span> access controls
                      and authentication
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> employee security
                      training
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> incident response
                      procedures
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> vendor security
                      assessments
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">7.2 multi-tenant isolation</h3>
              <p className="text-sand-dim">
                our platform uses row-level security (rls) at the database level
                to ensure complete isolation between communities. your
                community&apos;s data cannot be accessed by other communities.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">7.3 security limitations</h3>
              <p className="text-sand-dim">
                no system is completely secure. while we strive to protect your
                data, we cannot guarantee absolute security. you are responsible
                for maintaining the security of your account credentials and
                wallet private keys.
              </p>
            </div>
          </div>
        </section>

        {/* 8. Your Rights */}
        <section>
          <h2 className="text-sand-bright mb-3">8. your rights</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">8.1 general rights</h3>
              <div className="text-sand-dim space-y-2">
                <p>you have the right to:</p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-spice">access</span> — request a copy
                    of your personal data
                  </p>
                  <p>
                    <span className="text-spice">correction</span> — request
                    correction of inaccurate data
                  </p>
                  <p>
                    <span className="text-spice">deletion</span> — request
                    deletion of your data
                  </p>
                  <p>
                    <span className="text-spice">portability</span> — receive
                    your data in a portable format
                  </p>
                  <p>
                    <span className="text-spice">objection</span> — object to
                    certain processing activities
                  </p>
                  <p>
                    <span className="text-spice">withdrawal</span> — withdraw
                    consent where processing is based on consent
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">8.2 gdpr rights (eea/uk)</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  if you are in the eea or uk, you additionally have the right
                  to:
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> lodge a complaint
                    with a supervisory authority
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> restrict processing
                    in certain circumstances
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> not be subject to
                    automated decision-making with legal effects
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">8.3 ccpa rights (california)</h3>
              <div className="text-sand-dim space-y-2">
                <p>if you are a california resident, you have the right to:</p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> know what personal
                    information we collect
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> request deletion of
                    personal information
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> opt-out of the sale
                    of personal information (we do not sell personal
                    information)
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> non-discrimination
                    for exercising your rights
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">8.4 exercising your rights</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  to exercise your rights, contact us at privacy@0xhoneyjar.xyz. we
                  will respond within the timeframes required by applicable law
                  (typically 30 days).
                </p>
                <p>
                  we may need to verify your identity before processing
                  requests. for wallet-related requests, we may ask you to sign
                  a message to prove wallet ownership.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 9. Cookies and Tracking */}
        <section>
          <h2 className="text-sand-bright mb-3">9. cookies and tracking</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">9.1 types of cookies</h3>
              <div className="border border-sand-dim/30 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-sand-dim/30">
                      <th className="text-left p-3 text-sand-dim">
                        cookie type
                      </th>
                      <th className="text-left p-3 text-sand-dim">purpose</th>
                      <th className="text-left p-3 text-sand-dim">duration</th>
                    </tr>
                  </thead>
                  <tbody className="text-sand-dim">
                    <tr className="border-b border-sand-dim/10">
                      <td className="p-3">essential</td>
                      <td className="p-3">authentication, security</td>
                      <td className="p-3">session</td>
                    </tr>
                    <tr className="border-b border-sand-dim/10">
                      <td className="p-3">functional</td>
                      <td className="p-3">preferences, settings</td>
                      <td className="p-3">1 year</td>
                    </tr>
                    <tr>
                      <td className="p-3">analytics</td>
                      <td className="p-3">usage statistics</td>
                      <td className="p-3">2 years</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">9.2 managing cookies</h3>
              <p className="text-sand-dim">
                you can control cookies through your browser settings. note that
                disabling certain cookies may affect service functionality.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">9.3 do not track</h3>
              <p className="text-sand-dim">
                we currently do not respond to &quot;do not track&quot; browser
                signals, as there is no industry standard for interpretation.
              </p>
            </div>
          </div>
        </section>

        {/* 10. International Data Transfers */}
        <section>
          <h2 className="text-sand-bright mb-3">
            10. international data transfers
          </h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">10.1 transfer locations</h3>
              <p className="text-sand-dim">
                your data may be transferred to and processed in countries
                outside your country of residence, including the united states
                and other countries where our service providers operate.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">10.2 transfer safeguards</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  for transfers from the eea/uk, we use appropriate safeguards
                  including:
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> standard
                    contractual clauses (sccs) approved by the european
                    commission
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> data processing
                    agreements with service providers
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> additional
                    technical measures where appropriate
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 11. Children's Privacy */}
        <section>
          <h2 className="text-sand-bright mb-3">11. children&apos;s privacy</h2>
          <p className="text-sand-dim">
            the service is not intended for users under 18 years of age. we do
            not knowingly collect personal information from children. if we
            learn we have collected information from a child under 18, we will
            delete that information promptly.
          </p>
        </section>

        {/* 12. Third-Party Links and Services */}
        <section>
          <h2 className="text-sand-bright mb-3">
            12. third-party links and services
          </h2>
          <p className="text-sand-dim">
            the service may contain links to third-party websites or integrate
            with third-party services (discord, telegram, blockchain networks).
            this privacy policy does not apply to those third parties. we
            encourage you to review their privacy policies.
          </p>
        </section>

        {/* 13. Specific Data Processing Activities */}
        <section>
          <h2 className="text-sand-bright mb-3">
            13. specific data processing activities
          </h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">13.1 wallet address processing</h3>
              <div className="text-sand-dim space-y-3">
                <div>
                  <p className="text-spice mb-1">what we collect:</p>
                  <p className="pl-4">
                    public wallet addresses you connect to the service.
                  </p>
                </div>

                <div>
                  <p className="text-spice mb-1">how we use it:</p>
                  <div className="pl-4 space-y-1">
                    <p>
                      <span className="text-sand-dim">+</span> verify token/nft
                      ownership for access control
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> calculate
                      conviction scores based on public blockchain data
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> determine tier
                      placement based on holdings and behavior
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-spice mb-1">what we DON&apos;T do:</p>
                  <div className="pl-4 space-y-1">
                    <p>
                      <span className="text-spice">—</span> access your private
                      keys or seed phrases
                    </p>
                    <p>
                      <span className="text-spice">—</span> execute transactions
                      on your behalf
                    </p>
                    <p>
                      <span className="text-spice">—</span> store cryptocurrency
                      or digital assets
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">13.2 conviction scoring</h3>
              <div className="text-sand-dim space-y-3">
                <div>
                  <p className="text-spice mb-1">what we analyze:</p>
                  <div className="pl-4 space-y-1">
                    <p>
                      <span className="text-sand-dim">+</span> holding duration
                      of tokens/nfts
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> trading patterns
                      (accumulation vs distribution)
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> historical
                      transaction data
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> cross-wallet
                      behavior patterns
                    </p>
                  </div>
                </div>

                <p>
                  <span className="text-spice">data sources:</span> publicly
                  available blockchain data only.
                </p>
                <p>
                  <span className="text-spice">purpose:</span> identify
                  high-conviction community members for tiering and engagement
                  features.
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">13.3 discord/telegram data</h3>
              <div className="text-sand-dim space-y-3">
                <div>
                  <p className="text-spice mb-1">what we access:</p>
                  <div className="pl-4 space-y-1">
                    <p>
                      <span className="text-sand-dim">+</span> user ids and
                      usernames
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> server/group
                      membership
                    </p>
                    <p>
                      <span className="text-sand-dim">+</span> role assignments
                      we manage
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-spice mb-1">what we DON&apos;T access:</p>
                  <div className="pl-4 space-y-1">
                    <p>
                      <span className="text-spice">—</span> message content
                      (except bot commands)
                    </p>
                    <p>
                      <span className="text-spice">—</span> direct messages
                    </p>
                    <p>
                      <span className="text-spice">—</span> voice chat data
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 14. Changes to This Policy */}
        <section>
          <h2 className="text-sand-bright mb-3">14. changes to this policy</h2>
          <div className="text-sand-dim space-y-2">
            <p>
              we may update this privacy policy from time to time. we will
              notify you of material changes by:
            </p>
            <div className="pl-4 space-y-1">
              <p>
                <span className="text-sand-dim">+</span> posting the updated
                policy on our website
              </p>
              <p>
                <span className="text-sand-dim">+</span> updating the &quot;last
                updated&quot; date
              </p>
              <p>
                <span className="text-sand-dim">+</span> sending email
                notification for significant changes
              </p>
            </div>
            <p>
              your continued use of the service after changes constitutes
              acceptance of the updated policy.
            </p>
          </div>
        </section>

        {/* 15. Contact Us */}
        <section>
          <h2 className="text-sand-bright mb-3">15. contact us</h2>
          <div className="text-sand-dim space-y-2">
            <p>
              for questions about this privacy policy or to exercise your
              rights, contact us at:
            </p>
            <p className="text-sand mt-2">
              <span className="text-spice">The Honey Jar Corp</span>
              <br />
              d/b/a arrakis
              <br />
              email: privacy@0xhoneyjar.xyz
              <br />
              website: arrakis.community
            </p>
          </div>
        </section>

        {/* Footer */}
        <section className="border-t border-sand-dim/30 pt-6 mt-8">
          <p className="text-sand-dim text-xs">
            last updated: january 6, 2026. see also:{' '}
            <Link
              href="/legal/terms"
              className="text-spice hover:text-spice-bright"
            >
              [terms of service]
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
