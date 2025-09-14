import React, { useState } from 'react';
import { X, Wallet, Smartphone } from 'lucide-react';

interface WalletConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (provider: string) => Promise<void>;
  availableProviders: string[];
  isLoading: boolean;
  error?: string;
}

export const WalletConnectModal: React.FC<WalletConnectModalProps> = ({
  isOpen,
  onClose,
  onConnect,
  availableProviders,
  isLoading,
  error
}) => {
  const [selectedProvider, setSelectedProvider] = useState<string>('');

  if (!isOpen) return null;

  const handleConnect = async (provider: string) => {
    setSelectedProvider(provider);
    await onConnect(provider);
    setSelectedProvider('');
  };

  const getProviderInfo = (provider: string) => {
    switch (provider) {
      case 'metamask':
        return {
          name: 'MetaMask',
          description: 'Browser extension wallet',
          icon: <Wallet className="w-8 h-8" />,
          color: 'bg-orange-500'
        };
      case 'walletconnect':
        return {
          name: 'WalletConnect',
          description: 'Mobile wallets & other apps',
          icon: <Smartphone className="w-8 h-8" />,
          color: 'bg-blue-500'
        };
      default:
        return {
          name: provider,
          description: 'Wallet provider',
          icon: <Wallet className="w-8 h-8" />,
          color: 'bg-gray-500'
        };
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm sm:max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 sm:p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Connect Wallet</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X className="w-6 h-6 text-gray-500" />
            </button>
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-xs sm:text-sm">{error}</p>
            </div>
          )}

          <div className="space-y-3">
            {availableProviders.map((provider) => {
              const info = getProviderInfo(provider);
              const isConnecting = isLoading && selectedProvider === provider;

              return (
                <button
                  key={provider}
                  onClick={() => handleConnect(provider)}
                  disabled={isLoading}
                  className="w-full p-3 sm:p-4 border-2 border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-3 sm:space-x-4"
                >
                  <div className={`p-2 sm:p-3 rounded-full text-white ${info.color}`}>
                    {info.icon}
                  </div>
                  <div className="flex-1 text-left">
                    <h3 className="font-semibold text-gray-800 text-sm sm:text-base">{info.name}</h3>
                    <p className="text-xs sm:text-sm text-gray-600">{info.description}</p>
                  </div>
                  {isConnecting && (
                    <div className="animate-spin rounded-full h-5 w-5 sm:h-6 sm:w-6 border-b-2 border-blue-600"></div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-600 text-center">
              Your wallet will be used to encrypt and securely store your emotional diary entries on Japan Smart Chain. 
              We never store your private keys or personal information.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};