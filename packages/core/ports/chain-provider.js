/**
 * Chain Provider Port Interface
 * Sprint S-15: Native Blockchain Reader & Interface
 *
 * Defines the contract for blockchain data access with a two-tier architecture:
 * - Tier 1 (Native Reader): Direct RPC calls for binary checks (always available)
 * - Tier 2 (Score Service): Complex queries via internal gRPC service (may be unavailable)
 *
 * @see SDD §6.1.2 Interface Definitions
 */
/** Default chain configurations */
export const CHAIN_CONFIGS = {
    berachain: {
        chainId: 80094,
        name: 'Berachain',
        symbol: 'BERA',
        rpcUrls: [
            'https://berachain.drpc.org',
            'https://berachain-rpc.publicnode.com',
        ],
        explorerUrl: 'https://beratrail.io',
        decimals: 18,
        isTestnet: false,
    },
    ethereum: {
        chainId: 1,
        name: 'Ethereum',
        symbol: 'ETH',
        rpcUrls: [
            'https://eth.drpc.org',
            'https://ethereum-rpc.publicnode.com',
        ],
        explorerUrl: 'https://etherscan.io',
        decimals: 18,
        isTestnet: false,
    },
    polygon: {
        chainId: 137,
        name: 'Polygon',
        symbol: 'MATIC',
        rpcUrls: [
            'https://polygon.drpc.org',
            'https://polygon-rpc.publicnode.com',
        ],
        explorerUrl: 'https://polygonscan.com',
        decimals: 18,
        isTestnet: false,
    },
    arbitrum: {
        chainId: 42161,
        name: 'Arbitrum One',
        symbol: 'ETH',
        rpcUrls: [
            'https://arbitrum.drpc.org',
            'https://arbitrum-one-rpc.publicnode.com',
        ],
        explorerUrl: 'https://arbiscan.io',
        decimals: 18,
        isTestnet: false,
    },
    base: {
        chainId: 8453,
        name: 'Base',
        symbol: 'ETH',
        rpcUrls: [
            'https://base.drpc.org',
            'https://base-rpc.publicnode.com',
        ],
        explorerUrl: 'https://basescan.org',
        decimals: 18,
        isTestnet: false,
    },
};
//# sourceMappingURL=chain-provider.js.map