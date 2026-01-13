import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'terms // ARRAKIS',
  description:
    'Terms of Service for Arrakis, the engagement intelligence platform for Web3 communities.',
};

export default function TermsPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <section>
        <div className="text-sand-dim text-xs mb-2">// legal / terms</div>
        <h1 className="text-2xl text-sand-bright">terms of service</h1>
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
              welcome to arrakis, a product of <span className="text-spice">The Honey Jar Corp</span> (&quot;company,&quot; &quot;we,&quot;
              &quot;us,&quot; or &quot;our&quot;). these terms of service
              (&quot;terms&quot;) govern your access to and use of the arrakis
              platform, including our website at arrakis.community, discord bot,
              telegram bot, apis, and related services (collectively, the
              &quot;service&quot;).
            </p>
            <p>
              by accessing or using the service, you agree to be bound by these
              terms. if you do not agree to these terms, do not use the service.
            </p>
            <p>
              if you are using the service on behalf of an organization, you
              represent and warrant that you have the authority to bind that
              organization to these terms.
            </p>
          </div>
        </section>

        {/* 2. Definitions */}
        <section>
          <h2 className="text-sand-bright mb-3">2. definitions</h2>
          <div className="text-sand space-y-2">
            <p>
              <span className="text-spice">&quot;account&quot;</span> — the
              account you create to access the service.
            </p>
            <p>
              <span className="text-spice">&quot;community&quot;</span> — a
              discord server or telegram group managed using the service.
            </p>
            <p>
              <span className="text-spice">&quot;content&quot;</span> — any
              data, text, graphics, or other materials uploaded, downloaded, or
              appearing on the service.
            </p>
            <p>
              <span className="text-spice">&quot;user&quot;</span> — any
              individual who accesses or uses the service.
            </p>
            <p>
              <span className="text-spice">&quot;community operator&quot;</span>{' '}
              — a user who manages a community using the service.
            </p>
            <p>
              <span className="text-spice">&quot;community member&quot;</span> —
              a user who participates in a community managed by the service.
            </p>
            <p>
              <span className="text-spice">&quot;wallet address&quot;</span> — a
              blockchain address connected to the service.
            </p>
          </div>
        </section>

        {/* 3. Eligibility */}
        <section>
          <h2 className="text-sand-bright mb-3">3. eligibility</h2>
          <div className="text-sand space-y-3">
            <p>to use the service, you must:</p>
            <div className="pl-4 space-y-1">
              <p>
                <span className="text-sand-dim">+</span> be at least 18 years of
                age, or the age of legal majority in your jurisdiction
              </p>
              <p>
                <span className="text-sand-dim">+</span> have the legal capacity
                to enter into these terms
              </p>
              <p>
                <span className="text-sand-dim">+</span> not be prohibited from
                using the service under applicable laws
              </p>
            </div>
            <p>
              by using the service, you represent and warrant that you meet
              these eligibility requirements.
            </p>
          </div>
        </section>

        {/* 4. Account Registration */}
        <section>
          <h2 className="text-sand-bright mb-3">4. account registration</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">4.1 account creation</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  to access certain features of the service, you must create an
                  account. you agree to:
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> provide accurate,
                    current, and complete information
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> maintain and
                    promptly update your account information
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> maintain the
                    security of your account credentials
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> accept
                    responsibility for all activities under your account
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> notify us
                    immediately of any unauthorized use
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">4.2 wallet connection</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  the service requires connecting cryptocurrency wallet
                  addresses to verify blockchain asset ownership. by connecting
                  a wallet, you:
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> confirm you control
                    the connected wallet address
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> authorize us to
                    read publicly available blockchain data
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> understand that
                    wallet connections are for verification purposes only
                  </p>
                </div>
                <p className="text-spice">
                  we do not have access to your private keys, seed phrases, or
                  the ability to execute transactions on your behalf.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Service Description */}
        <section>
          <h2 className="text-sand-bright mb-3">5. service description</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">5.1 platform overview</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  arrakis is an engagement intelligence platform for web3
                  communities that provides:
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> token-gating and
                    access control for discord and telegram
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> conviction scoring
                    based on on-chain behavior analysis
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> tiered progression
                    systems for community engagement
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> badge and
                    gamification features
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> analytics and
                    insights for community operators
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">5.2 service tiers</h3>
              <div className="text-sand-dim space-y-2">
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-spice">explorer (free)</span> — basic
                    token-gating and features
                  </p>
                  <p>
                    <span className="text-spice">sietch (premium)</span> —
                    advanced features including conviction scoring
                  </p>
                  <p>
                    <span className="text-spice">naib council (enterprise)</span>{' '}
                    — custom features for larger organizations
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">
                5.3 discord and telegram integration
              </h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  the service operates through discord and telegram bots. by
                  adding our bots to your server or group, you:
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> grant the bot
                    necessary permissions to function
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> accept
                    responsibility for compliance with platform terms
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> understand
                    functionality depends on third-party availability
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 6. Acceptable Use */}
        <section>
          <h2 className="text-sand-bright mb-3">6. acceptable use</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">6.1 permitted uses</h3>
              <div className="text-sand-dim pl-4 space-y-1">
                <p>
                  <span className="text-sand-dim">+</span> manage token-gated
                  access to your community
                </p>
                <p>
                  <span className="text-sand-dim">+</span> implement tiered
                  member experiences
                </p>
                <p>
                  <span className="text-sand-dim">+</span> analyze community
                  engagement and holder behavior
                </p>
                <p>
                  <span className="text-sand-dim">+</span> distribute badges and
                  recognition to community members
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">6.2 prohibited uses</h3>
              <div className="text-sand-dim space-y-2">
                <p>you agree NOT to use the service to:</p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-spice">—</span> violate any applicable
                    law, regulation, or third-party rights
                  </p>
                  <p>
                    <span className="text-spice">—</span> engage in fraud, money
                    laundering, or other financial crimes
                  </p>
                  <p>
                    <span className="text-spice">—</span> harass, abuse, or harm
                    other users
                  </p>
                  <p>
                    <span className="text-spice">—</span> distribute malware or
                    engage in hacking activities
                  </p>
                  <p>
                    <span className="text-spice">—</span> circumvent security
                    features or access controls
                  </p>
                  <p>
                    <span className="text-spice">—</span> scrape, data mine, or
                    extract data beyond intended use
                  </p>
                  <p>
                    <span className="text-spice">—</span> resell, sublicense, or
                    redistribute without authorization
                  </p>
                  <p>
                    <span className="text-spice">—</span> interfere with the
                    proper functioning of the service
                  </p>
                  <p>
                    <span className="text-spice">—</span> use for illegal
                    gambling or securities offerings
                  </p>
                  <p>
                    <span className="text-spice">—</span> impersonate another
                    person or entity
                  </p>
                  <p>
                    <span className="text-spice">—</span> manipulate conviction
                    scores or tier rankings fraudulently
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">
                6.3 community operator responsibilities
              </h3>
              <div className="text-sand-dim space-y-2">
                <p>if you are a community operator, you additionally agree to:</p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> comply with discord
                    and telegram terms of service
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> inform your members
                    about the use of arrakis
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> not use the service
                    to discriminate against protected classes
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> take responsibility
                    for content and conduct within your community
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> maintain appropriate
                    moderation of your community
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 7. Payment Terms */}
        <section>
          <h2 className="text-sand-bright mb-3">7. payment terms</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">7.1 fees</h3>
              <p className="text-sand-dim">
                paid tiers require payment of fees as described on our pricing
                page. by subscribing to a paid tier, you agree to pay all
                applicable fees.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">7.2 billing</h3>
              <div className="text-sand-dim pl-4 space-y-1">
                <p>
                  <span className="text-spice">monthly plans</span> — billed
                  monthly in advance
                </p>
                <p>
                  <span className="text-spice">annual plans</span> — billed
                  annually in advance at the discounted rate
                </p>
                <p>
                  <span className="text-spice">payment methods</span> — credit
                  card or other accepted methods
                </p>
                <p>
                  <span className="text-spice">currency</span> — all fees are in
                  usd unless otherwise specified
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">7.3 automatic renewal</h3>
              <p className="text-sand-dim">
                subscriptions automatically renew at the end of each billing
                period unless cancelled. you may cancel at any time through your
                account settings.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">7.4 refunds</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  for complete details about our refund policy, please see our{' '}
                  <Link href="/legal/refund" className="text-spice hover:text-spice-bright">
                    [refund policy]
                  </Link>
                  . summary:
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-spice">monthly plans</span> — no refunds
                    for partial months
                  </p>
                  <p>
                    <span className="text-spice">annual plans</span> — pro-rated
                    refund available within 30 days of purchase
                  </p>
                  <p>
                    <span className="text-spice">downgrades</span> — take effect
                    at the next billing cycle
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">7.5 price changes</h3>
              <p className="text-sand-dim">
                we may change our prices with 30 days&apos; notice. continued
                use after a price change constitutes acceptance of the new
                pricing.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">7.6 taxes</h3>
              <p className="text-sand-dim">
                you are responsible for all applicable taxes. stated prices do
                not include taxes unless explicitly noted.
              </p>
            </div>
          </div>
        </section>

        {/* 8. Intellectual Property */}
        <section>
          <h2 className="text-sand-bright mb-3">8. intellectual property</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">8.1 our intellectual property</h3>
              <p className="text-sand-dim">
                the service, including its design, features, and content, is
                owned by arrakis and protected by intellectual property laws.
                you receive a limited, non-exclusive, non-transferable license
                to use the service in accordance with these terms.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">8.2 your content</h3>
              <p className="text-sand-dim">
                you retain ownership of content you submit to the service. by
                submitting content, you grant us a worldwide, non-exclusive,
                royalty-free license to use, store, and process that content to
                provide the service.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">8.3 feedback</h3>
              <p className="text-sand-dim">
                if you provide feedback or suggestions about the service, you
                grant us the right to use that feedback without obligation to
                you.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">8.4 trademarks</h3>
              <p className="text-sand-dim">
                &quot;arrakis,&quot; our logo, and related marks are trademarks
                of the company. you may not use our trademarks without prior
                written permission.
              </p>
            </div>
          </div>
        </section>

        {/* 9. Data and Privacy */}
        <section>
          <h2 className="text-sand-bright mb-3">9. data and privacy</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">9.1 privacy policy</h3>
              <p className="text-sand-dim">
                our collection and use of personal information is governed by
                our{' '}
                <Link href="/legal/privacy" className="text-spice hover:text-spice-bright">
                  [privacy policy]
                </Link>
                , which is incorporated into these terms by reference.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">9.2 data processing</h3>
              <div className="text-sand-dim space-y-2">
                <p>by using the service, you acknowledge that we process:</p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> wallet addresses and
                    associated public blockchain data
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> discord and telegram
                    user identifiers
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> community
                    configuration and settings
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> usage analytics and
                    logs
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">9.3 data security</h3>
              <p className="text-sand-dim">
                we implement reasonable security measures to protect your data,
                including row-level security for multi-tenant isolation.
                however, no system is completely secure, and we cannot guarantee
                absolute security.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">9.4 data retention</h3>
              <p className="text-sand-dim">
                we retain data as described in our privacy policy. you may
                request data deletion subject to legal retention requirements.
              </p>
            </div>
          </div>
        </section>

        {/* 10. Third-Party Services */}
        <section>
          <h2 className="text-sand-bright mb-3">10. third-party services</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">10.1 integrations</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  the service integrates with third-party platforms including:
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> discord
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> telegram
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> blockchain networks
                    and rpc providers
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> payment processors
                  </p>
                </div>
                <p>
                  your use of these integrations is subject to their respective
                  terms of service.
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">10.2 blockchain data</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  the service reads publicly available blockchain data. we are
                  not responsible for:
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-spice">—</span> accuracy of blockchain
                    data
                  </p>
                  <p>
                    <span className="text-spice">—</span> blockchain network
                    availability or performance
                  </p>
                  <p>
                    <span className="text-spice">—</span> gas fees or transaction
                    costs
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">10.3 links</h3>
              <p className="text-sand-dim">
                the service may contain links to third-party websites. we are
                not responsible for the content or practices of linked sites.
              </p>
            </div>
          </div>
        </section>

        {/* 11. Disclaimers */}
        <section>
          <h2 className="text-sand-bright mb-3">11. disclaimers</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">11.1 &quot;as is&quot; service</h3>
              <div className="border border-spice/50 p-4">
                <p className="text-sand-dim text-xs">
                  THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS
                  AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
                  IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF
                  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
                  NON-INFRINGEMENT.
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">11.2 no financial advice</h3>
              <p className="text-sand-dim">
                the service provides analytics and insights about community
                engagement and blockchain holdings. this is NOT financial,
                investment, legal, or tax advice. you should consult appropriate
                professionals before making financial decisions.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">11.3 blockchain risks</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  you acknowledge the inherent risks of blockchain technology:
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-spice">—</span> price volatility of
                    digital assets
                  </p>
                  <p>
                    <span className="text-spice">—</span> regulatory uncertainty
                  </p>
                  <p>
                    <span className="text-spice">—</span> smart contract
                    vulnerabilities
                  </p>
                  <p>
                    <span className="text-spice">—</span> network congestion and
                    failures
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">11.4 service availability</h3>
              <p className="text-sand-dim">
                we do not guarantee uninterrupted or error-free service. we may
                modify, suspend, or discontinue features at any time.
              </p>
            </div>
          </div>
        </section>

        {/* 12. Limitation of Liability */}
        <section>
          <h2 className="text-sand-bright mb-3">12. limitation of liability</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">12.1 exclusion of damages</h3>
              <div className="border border-spice/50 p-4">
                <p className="text-sand-dim text-xs">
                  TO THE MAXIMUM EXTENT PERMITTED BY LAW, ARRAKIS SHALL NOT BE
                  LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL,
                  OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF
                  PROFITS, DATA, OR GOODWILL.
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">12.2 liability cap</h3>
              <div className="border border-spice/50 p-4">
                <p className="text-sand-dim text-xs">
                  OUR TOTAL LIABILITY FOR ANY CLAIMS ARISING FROM THESE TERMS OR
                  THE SERVICE SHALL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU
                  PAID US IN THE 12 MONTHS PRECEDING THE CLAIM, OR (B) $100.
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">12.3 exceptions</h3>
              <p className="text-sand-dim">
                some jurisdictions do not allow the exclusion or limitation of
                certain damages. in such jurisdictions, our liability is limited
                to the maximum extent permitted by law.
              </p>
            </div>
          </div>
        </section>

        {/* 13. Indemnification */}
        <section>
          <h2 className="text-sand-bright mb-3">13. indemnification</h2>
          <div className="text-sand-dim space-y-2">
            <p>
              you agree to indemnify, defend, and hold harmless arrakis and its
              officers, directors, employees, and agents from any claims,
              damages, losses, or expenses (including reasonable attorneys&apos;
              fees) arising from:
            </p>
            <div className="pl-4 space-y-1">
              <p>
                <span className="text-sand-dim">+</span> your use of the service
              </p>
              <p>
                <span className="text-sand-dim">+</span> your violation of these
                terms
              </p>
              <p>
                <span className="text-sand-dim">+</span> your violation of any
                third-party rights
              </p>
              <p>
                <span className="text-sand-dim">+</span> your content or
                community activities
              </p>
            </div>
          </div>
        </section>

        {/* 14. Termination */}
        <section>
          <h2 className="text-sand-bright mb-3">14. termination</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">14.1 termination by you</h3>
              <p className="text-sand-dim">
                you may terminate your account at any time through account
                settings or by contacting us. termination does not entitle you
                to a refund except as specified in section 7.4.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">14.2 termination by us</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  we may suspend or terminate your access to the service at any
                  time, with or without cause, with or without notice. grounds
                  for termination include:
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-spice">—</span> violation of these
                    terms
                  </p>
                  <p>
                    <span className="text-spice">—</span> fraudulent, abusive, or
                    illegal activity
                  </p>
                  <p>
                    <span className="text-spice">—</span> non-payment of fees
                  </p>
                  <p>
                    <span className="text-spice">—</span> extended inactivity
                  </p>
                  <p>
                    <span className="text-spice">—</span> requests by law
                    enforcement
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">14.3 effect of termination</h3>
              <div className="text-sand-dim space-y-2">
                <p>upon termination:</p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> your right to use
                    the service ceases immediately
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> we may delete your
                    account and associated data
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> provisions that by
                    their nature should survive will survive (including sections
                    8, 11, 12, 13, and 15)
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 15. Dispute Resolution */}
        <section>
          <h2 className="text-sand-bright mb-3">15. dispute resolution</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">15.1 governing law</h3>
              <p className="text-sand-dim">
                these terms are governed by the laws of the state of delaware,
                united states, without regard to conflict of law principles.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">15.2 arbitration</h3>
              <p className="text-sand-dim">
                any disputes arising from these terms or the service shall be
                resolved through binding arbitration in accordance with the
                rules of the american arbitration association. the arbitration
                shall take place in delaware, and the language shall be english.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">15.3 class action waiver</h3>
              <p className="text-sand-dim">
                you agree to resolve disputes on an individual basis and waive
                the right to participate in class actions or class arbitrations.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">15.4 exceptions</h3>
              <p className="text-sand-dim">
                notwithstanding the above, either party may seek injunctive
                relief in any court of competent jurisdiction.
              </p>
            </div>
          </div>
        </section>

        {/* 16. General Provisions */}
        <section>
          <h2 className="text-sand-bright mb-3">16. general provisions</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">16.1 entire agreement</h3>
              <p className="text-sand-dim">
                these terms, together with our privacy policy, constitute the
                entire agreement between you and arrakis regarding the service.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">16.2 severability</h3>
              <p className="text-sand-dim">
                if any provision of these terms is found unenforceable, the
                remaining provisions will continue in effect.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">16.3 waiver</h3>
              <p className="text-sand-dim">
                our failure to enforce any provision of these terms does not
                constitute a waiver of that provision.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">16.4 assignment</h3>
              <p className="text-sand-dim">
                you may not assign these terms without our consent. we may
                assign these terms without restriction.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">16.5 notices</h3>
              <p className="text-sand-dim">
                we may provide notices through the service, email, or other
                reasonable means. you may contact us at legal@0xhoneyjar.xyz.
              </p>
            </div>

            <div>
              <h3 className="text-sand mb-2">16.6 force majeure</h3>
              <p className="text-sand-dim">
                we are not liable for failures or delays resulting from
                circumstances beyond our reasonable control.
              </p>
            </div>
          </div>
        </section>

        {/* 17. Changes to Terms */}
        <section>
          <h2 className="text-sand-bright mb-3">17. changes to terms</h2>
          <p className="text-sand-dim">
            we may modify these terms at any time. we will notify you of
            material changes through the service or by email. continued use of
            the service after changes constitutes acceptance of the modified
            terms.
          </p>
        </section>

        {/* 18. Contact Information */}
        <section>
          <h2 className="text-sand-bright mb-3">18. contact information</h2>
          <div className="text-sand-dim space-y-1">
            <p>for questions about these terms, contact us at:</p>
            <p className="text-sand mt-2">
              <span className="text-spice">The Honey Jar Corp</span>
              <br />
              d/b/a arrakis
              <br />
              email: legal@0xhoneyjar.xyz
              <br />
              website: arrakis.community
            </p>
          </div>
        </section>

        {/* Footer */}
        <section className="border-t border-sand-dim/30 pt-6 mt-8">
          <p className="text-sand-dim text-xs">
            last updated: january 6, 2026. see also:{' '}
            <Link href="/legal/privacy" className="text-spice hover:text-spice-bright">
              [privacy policy]
            </Link>
            {' | '}
            <Link href="/legal/refund" className="text-spice hover:text-spice-bright">
              [refund policy]
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
