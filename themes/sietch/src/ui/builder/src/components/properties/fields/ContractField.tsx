import { useState } from 'react';
import { clsx } from 'clsx';
import { Link, Check, AlertCircle } from 'lucide-react';

interface ContractFieldProps {
  label: string;
  value: string | null;
  onChange: (contractId: string | null) => void;
  error?: string;
  disabled?: boolean;
}

// Mock contracts for MVP - would be fetched from API in production
const mockContracts = [
  { id: 'contract_1', name: 'Bera Bears NFT', address: '0x1234...5678', chain: 'Berachain' },
  { id: 'contract_2', name: 'Community Token', address: '0xabcd...efgh', chain: 'Ethereum' },
  { id: 'contract_3', name: 'Governance DAO', address: '0x9876...5432', chain: 'Arbitrum' },
];

export function ContractField({
  label,
  value,
  onChange,
  error,
  disabled = false,
}: ContractFieldProps) {
  const [showSelector, setShowSelector] = useState(false);
  const selectedContract = mockContracts.find(c => c.id === value);

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">{label}</label>

      {selectedContract ? (
        <div className={clsx(
          'p-3 rounded-lg border',
          error ? 'border-red-300 bg-red-50' : 'border-surface-200 bg-surface-50'
        )}>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Link size={14} className="text-primary-500" />
                <span className="font-medium text-sm">{selectedContract.name}</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-surface-500">
                <span>{selectedContract.address}</span>
                <span className="px-1.5 py-0.5 bg-surface-200 rounded">
                  {selectedContract.chain}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => !disabled && setShowSelector(true)}
              disabled={disabled}
              className="text-xs text-primary-500 hover:text-primary-600 disabled:opacity-50"
            >
              Change
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => !disabled && setShowSelector(true)}
          disabled={disabled}
          className={clsx(
            'w-full p-3 rounded-lg border-2 border-dashed text-center transition-colors',
            error
              ? 'border-red-300 bg-red-50 text-red-600'
              : 'border-surface-300 hover:border-primary-400 hover:bg-primary-50 text-surface-500',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          <Link size={20} className="mx-auto mb-1" />
          <span className="text-sm">Select a contract</span>
        </button>
      )}

      {/* Contract Selector Modal */}
      {showSelector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="p-4 border-b border-surface-200">
              <h3 className="text-lg font-semibold">Select Contract</h3>
              <p className="text-sm text-surface-500 mt-1">
                Choose a contract binding for this component
              </p>
            </div>
            <div className="p-4 max-h-80 overflow-y-auto space-y-2">
              {mockContracts.map((contract) => (
                <button
                  key={contract.id}
                  type="button"
                  onClick={() => {
                    onChange(contract.id);
                    setShowSelector(false);
                  }}
                  className={clsx(
                    'w-full p-3 rounded-lg border text-left transition-colors',
                    value === contract.id
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-surface-200 hover:border-surface-300 hover:bg-surface-50'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Link size={14} className="text-primary-500" />
                      <span className="font-medium text-sm">{contract.name}</span>
                    </div>
                    {value === contract.id && (
                      <Check size={16} className="text-primary-500" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-surface-500 ml-5">
                    <span>{contract.address}</span>
                    <span className="px-1.5 py-0.5 bg-surface-200 rounded">
                      {contract.chain}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <div className="p-4 border-t border-surface-200 flex justify-between">
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setShowSelector(false);
                }}
                className="px-4 py-2 text-sm text-surface-600 hover:bg-surface-100 rounded-lg"
              >
                Clear Selection
              </button>
              <button
                type="button"
                onClick={() => setShowSelector(false)}
                className="px-4 py-2 text-sm bg-surface-100 hover:bg-surface-200 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-500">
          <AlertCircle size={12} />
          {error}
        </div>
      )}
    </div>
  );
}
