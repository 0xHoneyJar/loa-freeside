import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'refund policy // ARRAKIS',
  description:
    'Refund Policy for Arrakis, the engagement intelligence platform for Web3 communities.',
};

export default function RefundPolicyPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <section>
        <div className="text-sand-dim text-xs mb-2">// legal / refund</div>
        <h1 className="text-2xl text-sand-bright">refund policy</h1>
        <p className="text-sand-dim text-sm mt-2">
          effective: january 6, 2026 | updated: january 6, 2026
        </p>
      </section>

      {/* Content */}
      <div className="space-y-8 text-sm">
        {/* Introduction */}
        <section>
          <h2 className="text-sand-bright mb-3">overview</h2>
          <div className="text-sand space-y-3">
            <p>
              this refund policy applies to all purchases made through{' '}
              <span className="text-spice">arrakis</span>, a product of{' '}
              <span className="text-spice">The Honey Jar Corp</span>. we want you
              to be satisfied with our service, and we have designed our refund
              policy to be fair and transparent.
            </p>
            <p>
              by purchasing a subscription or any paid features, you agree to
              the terms outlined in this refund policy.
            </p>
          </div>
        </section>

        {/* Subscription Plans */}
        <section>
          <h2 className="text-sand-bright mb-3">1. subscription refunds</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">1.1 monthly subscriptions</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  monthly subscription plans are billed in advance on a monthly
                  basis.
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-spice">—</span> no refunds are provided
                    for partial months of service
                  </p>
                  <p>
                    <span className="text-spice">—</span> you may cancel at any
                    time to prevent future billing
                  </p>
                  <p>
                    <span className="text-spice">—</span> service continues until
                    the end of the current billing period
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">1.2 annual subscriptions</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  annual subscription plans are billed in advance for a full
                  year at a discounted rate.
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span>{' '}
                    <span className="text-spice">30-day money-back guarantee</span>{' '}
                    — full refund available within 30 days of initial purchase
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span>{' '}
                    <span className="text-spice">pro-rated refunds</span> —
                    available within 30 days of purchase for unused months
                  </p>
                  <p>
                    <span className="text-spice">—</span> no refunds after 30
                    days from purchase date
                  </p>
                  <p>
                    <span className="text-spice">—</span> cancellation stops
                    auto-renewal; service continues until period ends
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Plan Changes */}
        <section>
          <h2 className="text-sand-bright mb-3">2. plan changes</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">2.1 upgrades</h3>
              <div className="text-sand-dim space-y-2">
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> upgrades take effect
                    immediately
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> you will be charged
                    the prorated difference for the current billing period
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> subsequent billing
                    cycles reflect the new plan price
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">2.2 downgrades</h3>
              <div className="text-sand-dim space-y-2">
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> downgrades take
                    effect at the start of the next billing cycle
                  </p>
                  <p>
                    <span className="text-spice">—</span> no refunds or credits
                    are provided for the remaining time on the higher-tier plan
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> you retain access to
                    premium features until the current period ends
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Cancellation */}
        <section>
          <h2 className="text-sand-bright mb-3">3. cancellation</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">3.1 how to cancel</h3>
              <div className="text-sand-dim space-y-2">
                <p>you can cancel your subscription at any time by:</p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> accessing your
                    account settings in the arrakis dashboard
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> contacting our
                    support team at{' '}
                    <a
                      href="mailto:support@0xhoneyjar.xyz"
                      className="text-spice hover:text-spice-bright"
                    >
                      support@0xhoneyjar.xyz
                    </a>
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">3.2 effect of cancellation</h3>
              <div className="text-sand-dim space-y-2">
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> your subscription
                    will not renew at the end of the current billing period
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> you retain full
                    access to paid features until the end of the period
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> your account reverts
                    to the free tier (explorer) after the period ends
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> your data is
                    retained according to our{' '}
                    <Link
                      href="/legal/privacy"
                      className="text-spice hover:text-spice-bright"
                    >
                      privacy policy
                    </Link>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Exceptional Circumstances */}
        <section>
          <h2 className="text-sand-bright mb-3">4. exceptional circumstances</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">4.1 service issues</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  we may issue refunds or credits at our discretion for:
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> extended service
                    outages that significantly impact your use
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> billing errors or
                    duplicate charges
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> technical issues
                    preventing access to paid features
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">4.2 account termination by us</h3>
              <div className="text-sand-dim space-y-2">
                <p>
                  if we terminate your account for violation of our{' '}
                  <Link
                    href="/legal/terms"
                    className="text-spice hover:text-spice-bright"
                  >
                    terms of service
                  </Link>
                  :
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-spice">—</span> no refund will be
                    provided
                  </p>
                </div>
                <p className="mt-2">
                  if we terminate your account for reasons unrelated to terms
                  violations:
                </p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> a pro-rated refund
                    may be issued for unused service
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Refund Process */}
        <section>
          <h2 className="text-sand-bright mb-3">5. refund process</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sand mb-2">5.1 requesting a refund</h3>
              <div className="text-sand-dim space-y-2">
                <p>to request a refund:</p>
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">1.</span> email{' '}
                    <a
                      href="mailto:support@0xhoneyjar.xyz"
                      className="text-spice hover:text-spice-bright"
                    >
                      support@0xhoneyjar.xyz
                    </a>{' '}
                    with the subject line &quot;Refund Request&quot;
                  </p>
                  <p>
                    <span className="text-sand-dim">2.</span> include your
                    account email and the reason for your request
                  </p>
                  <p>
                    <span className="text-sand-dim">3.</span> we will respond
                    within 3 business days
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sand mb-2">5.2 refund timeline</h3>
              <div className="text-sand-dim space-y-2">
                <div className="pl-4 space-y-1">
                  <p>
                    <span className="text-sand-dim">+</span> approved refunds are
                    processed within 5-10 business days
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> refunds are issued
                    to the original payment method
                  </p>
                  <p>
                    <span className="text-sand-dim">+</span> bank processing
                    times may vary (typically 3-5 additional business days)
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* One-Time Purchases */}
        <section>
          <h2 className="text-sand-bright mb-3">6. one-time purchases</h2>
          <div className="text-sand-dim space-y-2">
            <p>
              for any one-time purchases (such as boost packs, badge credits, or
              other add-ons):
            </p>
            <div className="pl-4 space-y-1">
              <p>
                <span className="text-spice">—</span> one-time purchases are
                non-refundable once the digital goods have been delivered
              </p>
              <p>
                <span className="text-sand-dim">+</span> if you experience
                technical issues preventing delivery, contact support for
                assistance
              </p>
            </div>
          </div>
        </section>

        {/* Currency */}
        <section>
          <h2 className="text-sand-bright mb-3">7. currency and taxes</h2>
          <div className="text-sand-dim space-y-2">
            <div className="pl-4 space-y-1">
              <p>
                <span className="text-sand-dim">+</span> all refunds are issued
                in the original currency of purchase (USD)
              </p>
              <p>
                <span className="text-spice">—</span> taxes paid on the original
                purchase may not be refundable depending on local laws
              </p>
              <p>
                <span className="text-spice">—</span> exchange rate differences
                are not compensated
              </p>
            </div>
          </div>
        </section>

        {/* Contact */}
        <section>
          <h2 className="text-sand-bright mb-3">8. contact us</h2>
          <div className="text-sand-dim space-y-2">
            <p>
              if you have questions about this refund policy or need assistance:
            </p>
            <p className="text-sand mt-2">
              <span className="text-spice">The Honey Jar Corp</span>
              <br />
              d/b/a arrakis
              <br />
              email:{' '}
              <a
                href="mailto:support@0xhoneyjar.xyz"
                className="text-spice hover:text-spice-bright"
              >
                support@0xhoneyjar.xyz
              </a>
              <br />
              website: arrakis.community
            </p>
          </div>
        </section>

        {/* Policy Summary */}
        <section className="border border-spice/30 p-4">
          <h2 className="text-sand-bright mb-3">quick reference</h2>
          <div className="text-sand-dim text-xs space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-spice">monthly plans</span>
              </div>
              <div>no refunds for partial months</div>
              <div>
                <span className="text-spice">annual plans</span>
              </div>
              <div>pro-rated refund within 30 days</div>
              <div>
                <span className="text-spice">downgrades</span>
              </div>
              <div>effective next billing cycle</div>
              <div>
                <span className="text-spice">one-time purchases</span>
              </div>
              <div>non-refundable once delivered</div>
              <div>
                <span className="text-spice">refund timeline</span>
              </div>
              <div>5-10 business days after approval</div>
            </div>
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
            {' | '}
            <Link
              href="/legal/privacy"
              className="text-spice hover:text-spice-bright"
            >
              [privacy policy]
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
