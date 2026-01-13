'use client';

import Web3Provider from '@/components/providers/Web3Provider';
import { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return <Web3Provider>{children}</Web3Provider>;
}
