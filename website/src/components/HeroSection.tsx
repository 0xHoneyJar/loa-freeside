'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { HeroFeatures } from './HeroFeatures';

// Emil Kowalski-style snappy animations
const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.16, 1, 0.3, 1] as const, // ease-out-expo
    },
  },
};

const imageItem = {
  hidden: { opacity: 0, y: 30, scale: 0.95 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.6,
      ease: [0.16, 1, 0.3, 1],
      delay: 0.4,
    },
  },
};

export function HeroSection() {
  return (
    <section className="relative min-h-[75vh] flex flex-col pt-16">
      {/* Content */}
      <div className="relative z-10 mx-auto max-w-4xl px-6 flex-1 flex items-center justify-center">
        <motion.div
          className="flex flex-col justify-center items-center text-center"
          variants={container}
          initial="hidden"
          animate="show"
        >
          <motion.p
            className="text-sand-dim text-xs font-mono mb-4 uppercase tracking-wider"
            variants={item}
          >
            from the #1 dune team
          </motion.p>

          <motion.h1
            className="font-display text-4xl lg:text-5xl text-sand-bright mb-6"
            variants={item}
          >
            Token gates miss conviction.
          </motion.h1>

          <motion.p
            className="text-sand text-base mb-8 max-w-lg mx-auto"
            variants={item}
          >
            Dune-powered analytics that surface your diamond hands — delivered as Discord roles.
          </motion.p>

          <motion.div
            className="flex flex-wrap gap-4 justify-center"
            variants={item}
          >
            <Link
              href="https://discord.gg/thehoneyjar"
              className="px-5 py-2.5 bg-spice text-black font-mono text-sm uppercase tracking-wider transition-colors duration-150 flex items-center gap-2"
            >
              Add to Discord
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/>
              </svg>
            </Link>
            <Link
              href="/demo"
              className="px-5 py-2.5 border border-sand-dim/40 text-sand font-mono text-sm uppercase tracking-wider hover:border-sand hover:text-sand-bright transition-colors duration-150"
            >
              View Demo
            </Link>
          </motion.div>

          {/* Campaign CTA */}
          <motion.div
            className="mt-8 pt-6 border-t border-sand-dim/20"
            variants={item}
          >
            <a
              href="https://app.arrakis.community/losers"
              className="inline-flex items-center gap-3 text-sand hover:text-spice transition-colors duration-150 group"
            >
              <span className="text-xs font-mono uppercase tracking-wider">New</span>
              <span className="text-sm">Losers of Berachain</span>
              <span className="text-spice group-hover:translate-x-1 transition-transform duration-150">→</span>
            </a>
          </motion.div>
        </motion.div>
      </div>

      {/* Interactive hero image + features strip */}
      <HeroFeatures />
    </section>
  );
}
