'use client';

import { useCallback } from 'react';

// Dynamic Labs imports - may not be available if SDK not configured
let useDynamicContext: () => {
  primaryWallet: { address: string } | null;
  user: unknown;
  setShowAuthFlow: ((show: boolean) => void) | undefined;
  handleLogOut: (() => Promise<void>) | undefined;
  isAuthenticated: boolean;
};

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dynamic = require('@dynamic-labs/sdk-react-core');
  useDynamicContext = dynamic.useDynamicContext;
} catch {
  // SDK not available
}

// Wagmi imports
let useAccount: () => { address: string | undefined; isConnected: boolean };
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const wagmi = require('wagmi');
  useAccount = wagmi.useAccount;
} catch {
  // Wagmi not available
}

/**
 * Hook to get wallet connection state
 * Combines Dynamic Labs and Wagmi state with graceful fallbacks
 */
export function useWallet() {
  // Try to get Dynamic Labs state
  let dynamicState = {
    primaryWallet: null as { address: string } | null,
    user: null as unknown,
    setShowAuthFlow: undefined as ((show: boolean) => void) | undefined,
    handleLogOut: undefined as (() => Promise<void>) | undefined,
    isAuthenticated: false,
  };

  try {
    if (useDynamicContext) {
      dynamicState = useDynamicContext();
    }
  } catch {
    // Dynamic context not available (not wrapped in provider)
  }

  // Try to get Wagmi state
  let wagmiState = {
    address: undefined as string | undefined,
    isConnected: false,
  };

  try {
    if (useAccount) {
      wagmiState = useAccount();
    }
  } catch {
    // Wagmi context not available
  }

  // Prefer Dynamic wallet address, fall back to Wagmi
  const address = dynamicState.primaryWallet?.address ?? wagmiState.address ?? null;
  const isConnected = dynamicState.isAuthenticated || wagmiState.isConnected;

  // Truncate address for display
  const truncatedAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  // Open the wallet connect modal
  const connect = useCallback(() => {
    if (dynamicState.setShowAuthFlow) {
      dynamicState.setShowAuthFlow(true);
    } else {
      console.warn('Wallet connection not available - Dynamic SDK not configured');
    }
  }, [dynamicState]);

  // Disconnect wallet
  const disconnect = useCallback(async () => {
    if (dynamicState.handleLogOut) {
      await dynamicState.handleLogOut();
    }
  }, [dynamicState]);

  return {
    // State
    address,
    truncatedAddress,
    isConnected,
    user: dynamicState.user,
    primaryWallet: dynamicState.primaryWallet,

    // Actions
    connect,
    disconnect,
  };
}
