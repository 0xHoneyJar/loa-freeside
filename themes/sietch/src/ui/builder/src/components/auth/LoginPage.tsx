/**
 * Login Page Component
 *
 * SECURITY: CRIT-3 Frontend Authentication Remediation
 * Simple API key authentication gate for the theme builder.
 *
 * @see grimoires/loa/a2a/audits/2026-01-21/SECURITY-AUDIT-REPORT.md
 */

import { useState, type FormEvent } from 'react';
import { Lock, AlertCircle, Loader2, Shield } from 'lucide-react';

interface LoginPageProps {
  onLogin: (apiKey: string) => Promise<boolean>;
  error: string | null;
  isLoading: boolean;
}

export function LoginPage({ onLogin, error, isLoading }: LoginPageProps) {
  const [apiKey, setApiKey] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!apiKey.trim()) {
      setLocalError('Please enter an API key');
      return;
    }

    const success = await onLogin(apiKey);
    if (!success) {
      setApiKey(''); // Clear on failure
    }
  };

  const displayError = localError || error;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-500/10 rounded-2xl mb-4">
            <Shield className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">Theme Builder</h1>
          <p className="text-slate-400 mt-2">
            Enter your API key to access the editor
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
          {/* Error Display */}
          {displayError && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-400 text-sm">{displayError}</p>
            </div>
          )}

          {/* API Key Input */}
          <div className="mb-6">
            <label
              htmlFor="apiKey"
              className="block text-sm font-medium text-slate-300 mb-2"
            >
              API Key
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="w-5 h-5 text-slate-500" />
              </div>
              <input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key"
                disabled={isLoading}
                className="w-full pl-10 pr-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                autoComplete="current-password"
                autoFocus
              />
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading || !apiKey.trim()}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Verifying...
              </>
            ) : (
              'Access Editor'
            )}
          </button>

          {/* Security Notice */}
          <p className="mt-4 text-xs text-slate-500 text-center">
            Your API key is stored locally and transmitted securely.
            Contact your administrator if you need access.
          </p>
        </form>

        {/* Footer */}
        <p className="text-center text-slate-500 text-sm mt-6">
          Sietch Theme Builder
        </p>
      </div>
    </div>
  );
}
