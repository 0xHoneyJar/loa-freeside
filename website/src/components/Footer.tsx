'use client';

import { ScrambleLink } from './TextScramble';

export function Footer() {
  return (
    <footer className="mt-24">
      <div className="text-sand-dim text-xs overflow-hidden">
        {'─'.repeat(80)}
      </div>

      <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
        <div>
          <div className="text-sand-dim mb-3">// product</div>
          <div className="space-y-2">
            <ScrambleLink href="/features" className="block text-sand hover:text-sand-bright">
              features
            </ScrambleLink>
            <ScrambleLink href="/pricing" className="block text-sand hover:text-sand-bright">
              pricing
            </ScrambleLink>
            <ScrambleLink href="https://docs.arrakis.community" className="block text-sand hover:text-sand-bright" external>
              docs
            </ScrambleLink>
          </div>
        </div>

        <div>
          <div className="text-sand-dim mb-3">// use-cases</div>
          <div className="space-y-2">
            <ScrambleLink href="/use-cases/daos" className="block text-sand hover:text-sand-bright">
              daos
            </ScrambleLink>
            <ScrambleLink href="/use-cases/nft-projects" className="block text-sand hover:text-sand-bright">
              nft-projects
            </ScrambleLink>
            <ScrambleLink href="/use-cases/defi-protocols" className="block text-sand hover:text-sand-bright">
              defi-protocols
            </ScrambleLink>
          </div>
        </div>

        <div>
          <div className="text-sand-dim mb-3">// compare</div>
          <div className="space-y-2">
            <ScrambleLink href="/compare/vs-collabland" className="block text-sand hover:text-sand-bright">
              vs-collabland
            </ScrambleLink>
            <ScrambleLink href="/compare/vs-guild" className="block text-sand hover:text-sand-bright">
              vs-guild
            </ScrambleLink>
            <ScrambleLink href="/compare/vs-matrica" className="block text-sand hover:text-sand-bright">
              vs-matrica
            </ScrambleLink>
          </div>
        </div>

        <div>
          <div className="text-sand-dim mb-3">// links</div>
          <div className="space-y-2">
            <ScrambleLink
              href="https://dune.com/discover/creators/top-teams"
              className="block text-sand hover:text-sand-bright"
              external
            >
              dune
            </ScrambleLink>
            <ScrambleLink
              href="https://github.com/0xHoneyJar/arrakis"
              className="block text-sand hover:text-sand-bright"
              external
            >
              github
            </ScrambleLink>
            <ScrambleLink
              href="https://discord.gg/thehoneyjar"
              className="block text-sand hover:text-sand-bright"
              external
            >
              discord
            </ScrambleLink>
          </div>
        </div>
      </div>

      <div className="mt-12 flex flex-col md:flex-row md:items-center md:justify-between gap-4 text-sm">
        <div className="text-sand-dim">
          <span className="text-spice">&gt;</span> ARRAKIS // engagement intelligence for web3
        </div>
        <div className="flex gap-6 text-sand-dim">
          <ScrambleLink href="/legal/terms" className="hover:text-sand">
            terms
          </ScrambleLink>
          <ScrambleLink href="/legal/privacy" className="hover:text-sand">
            privacy
          </ScrambleLink>
          <ScrambleLink href="/legal/refund" className="hover:text-sand">
            refunds
          </ScrambleLink>
          <span>&copy; {new Date().getFullYear()}</span>
        </div>
      </div>

      <div className="mt-8 text-sand-dim/50 text-xs space-y-1">
        <div>{`/* the spice must flow */`}</div>
        <div>
          built with{' '}
          <ScrambleLink
            href="https://github.com/0xHoneyJar/loa"
            className="text-sand-dim/70 hover:text-sand-dim underline"
            external
          >
            loa
          </ScrambleLink>
          {' '}by{' '}
          <ScrambleLink
            href="https://0xHoneyJar.xyz"
            className="text-sand-dim/70 hover:text-sand-dim underline"
            external
          >
            thj
          </ScrambleLink>
          {' '}• design inspired by{' '}
          <ScrambleLink
            href="https://github.com/ertdfgcvb/play.core"
            className="text-sand-dim/70 hover:text-sand-dim underline"
            external
          >
            play.core
          </ScrambleLink>
        </div>
        <div>
          contact:{' '}
          <ScrambleLink
            href="mailto:henlo@0xhoneyjar.xyz"
            className="text-sand-dim/70 hover:text-sand-dim underline"
          >
            henlo@0xhoneyjar.xyz
          </ScrambleLink>
        </div>
      </div>
    </footer>
  );
}
