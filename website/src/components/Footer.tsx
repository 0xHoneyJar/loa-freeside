import Link from 'next/link';

export function Footer() {
  return (
    <footer className="mt-48">
      {/* Motto CTA */}
      <div className="mx-auto max-w-4xl px-6 pb-16 relative">
        <div className="relative z-10">
          <h2 className="font-display text-2xl lg:text-3xl text-sand-bright mb-8">
            The chain knows. Now you will too.
          </h2>
          <div className="flex items-center gap-3">
            <Link
              href="https://discord.gg/thehoneyjar"
              className="px-5 py-2.5 bg-spice text-black font-mono text-sm uppercase tracking-wider hover:bg-spice-bright transition-colors duration-150 whitespace-nowrap"
            >
              Get Started
            </Link>
            <Link
              href="/demo"
              className="px-5 py-2.5 border border-sand-dim text-sand font-mono text-sm uppercase tracking-wider hover:border-sand-bright hover:text-sand-bright transition-colors duration-150 whitespace-nowrap"
            >
              View Demo
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-sand-dim/20 relative">
        {/* Fremen navigator character - positioned to be cut off by footer below */}
        <div
          className="absolute right-6 lg:right-[calc(50%-29rem)] -top-64 w-72 h-80 hidden lg:block pointer-events-none z-0"
          style={{
            backgroundImage: 'url(/images/fremen-navigator.png)',
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'bottom right'
          }}
        />
        <div className="mx-auto max-w-4xl px-6 py-16">
          {/* Main footer content */}
        <div className="grid grid-cols-2 lg:grid-cols-12 gap-12">
          {/* Logo + Social */}
          <div className="col-span-2 lg:col-span-4">
            <Link href="/" className="font-display text-2xl text-sand-bright hover:text-spice transition-colors duration-150">
              Arrakis
            </Link>
            <p className="mt-4 text-sand-dim text-sm max-w-xs">
              Dune-powered community intelligence for Discord. Built on Collab.Land.
            </p>
            {/* Social icons */}
            <div className="flex items-center gap-4 mt-6">
              <Link
                href="https://x.com/0xHoneyJar"
                target="_blank"
                className="text-sand-dim hover:text-sand-bright transition-colors duration-150"
                aria-label="X (Twitter)"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </Link>
              <Link
                href="https://github.com/0xHoneyJar/arrakis"
                target="_blank"
                className="text-sand-dim hover:text-sand-bright transition-colors duration-150"
                aria-label="GitHub"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
              </Link>
              <Link
                href="https://discord.gg/thehoneyjar"
                target="_blank"
                className="text-sand-dim hover:text-sand-bright transition-colors duration-150"
                aria-label="Discord"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
                </svg>
              </Link>
            </div>
          </div>

          {/* Product */}
          <div className="lg:col-span-2">
            <div className="text-sand-bright text-sm font-medium mb-4">Product</div>
            <div className="space-y-3">
              <Link href="#features" className="block text-sand-dim text-sm hover:text-sand-bright transition-colors duration-150">
                Features
              </Link>
              <Link href="/pricing" className="block text-sand-dim text-sm hover:text-sand-bright transition-colors duration-150">
                Pricing
              </Link>
              <Link href="/demo" className="block text-sand-dim text-sm hover:text-sand-bright transition-colors duration-150">
                Demo
              </Link>
            </div>
          </div>

          {/* Resources */}
          <div className="lg:col-span-2">
            <div className="text-sand-bright text-sm font-medium mb-4">Resources</div>
            <div className="space-y-3">
              <Link
                href="https://docs.arrakis.community"
                target="_blank"
                className="block text-sand-dim text-sm hover:text-sand-bright transition-colors duration-150"
              >
                Docs
              </Link>
              <Link
                href="https://dune.com/discover/creators/top-teams"
                target="_blank"
                className="block text-sand-dim text-sm hover:text-sand-bright transition-colors duration-150"
              >
                Dune Team
              </Link>
              <Link
                href="https://collab.land"
                target="_blank"
                className="block text-sand-dim text-sm hover:text-sand-bright transition-colors duration-150"
              >
                Collab.Land
              </Link>
            </div>
          </div>

          {/* Company */}
          <div className="lg:col-span-2">
            <div className="text-sand-bright text-sm font-medium mb-4">Company</div>
            <div className="space-y-3">
              <Link
                href="https://0xHoneyJar.xyz"
                target="_blank"
                className="block text-sand-dim text-sm hover:text-sand-bright transition-colors duration-150"
              >
                The Honey Jar
              </Link>
              <Link
                href="mailto:henlo@0xhoneyjar.xyz"
                className="block text-sand-dim text-sm hover:text-sand-bright transition-colors duration-150"
              >
                Contact
              </Link>
            </div>
          </div>

          {/* Legal */}
          <div className="lg:col-span-2">
            <div className="text-sand-bright text-sm font-medium mb-4">Legal</div>
            <div className="space-y-3">
              <Link href="/legal/privacy" className="block text-sand-dim text-sm hover:text-sand-bright transition-colors duration-150">
                Privacy
              </Link>
              <Link href="/legal/terms" className="block text-sand-dim text-sm hover:text-sand-bright transition-colors duration-150">
                Terms
              </Link>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-16 pt-8 border-t border-sand-dim/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-sand-dim text-xs">
            &copy; {new Date().getFullYear()} The Honey Jar. All rights reserved.
          </p>
          <p className="text-sand-dim/50 text-xs font-mono">
            the spice must flow
          </p>
        </div>
        </div>
      </div>
    </footer>
  );
}
