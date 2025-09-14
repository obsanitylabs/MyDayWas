/**
 * Unified Wallet Service
 * Handles MetaMask, WalletConnect, and other wallet providers
 */

import { ethers } from 'ethers';

export interface WalletProvider {
  name: string;
  provider: any;
  connect: () => Promise<string>;
  disconnect: () => Promise<void>;
  isConnected: () => boolean;
  getAddress: () => Promise<string>;
  getSigner: () => Promise<ethers.Signer>;
}

class WalletService {
  private currentProvider: WalletProvider | null = null;
  private providers: Map<string, WalletProvider> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private async initializeProviders() {
    // MetaMask/Injected Provider
    if (typeof window !== 'undefined' && window.ethereum) {
      const metaMaskProvider: WalletProvider = {
        name: 'MetaMask',
        provider: window.ethereum,
        connect: async () => {
          const accounts = await window.ethereum!.request({ method: 'eth_requestAccounts' });
          if (!accounts || accounts.length === 0) {
            throw new Error('No accounts found. Please unlock your wallet.');
          }
          const provider = new ethers.BrowserProvider(window.ethereum!);
          const signer = await provider.getSigner();
          return await signer.getAddress();
        },
        disconnect: async () => {
          // MetaMask doesn't have a programmatic disconnect
          this.currentProvider = null;
        },
        isConnected: () => {
          return window.ethereum?.selectedAddress !== null && window.ethereum?.selectedAddress !== undefined;
        },
        getAddress: async () => {
          const accounts = await window.ethereum!.request({ method: 'eth_accounts' });
          if (!accounts || accounts.length === 0) {
            throw new Error('No accounts available');
          }
          return accounts[0];
        },
        getSigner: async () => {
          const provider = new ethers.BrowserProvider(window.ethereum!);
          return await provider.getSigner();
        }
      };
      this.providers.set('metamask', metaMaskProvider);
    }

    // WalletConnect Provider - Always initialize
    this.initializeWalletConnect();
  }

  private async initializeWalletConnect() {
    try {
      const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
      
      // Use default project ID if not provided
      const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'a7f416d2c4b4e4b8c8f8e8f8e8f8e8f8';
      
      const walletConnectProvider = await EthereumProvider.init({
        projectId,
        chains: [5278000], // JSC Chain ID
        showQrModal: true,
        metadata: {
          name: 'How Are You Today',
          description: 'Emotional Wellness Platform',
          url: window.location.origin,
          icons: ['https://walletconnect.com/walletconnect-logo.png']
        }
      });

      const wcProvider: WalletProvider = {
        name: 'WalletConnect',
        provider: walletConnectProvider,
        connect: async () => {
          await walletConnectProvider.enable();
          const provider = new ethers.BrowserProvider(walletConnectProvider);
          const signer = await provider.getSigner();
          return await signer.getAddress();
        },
        disconnect: async () => {
          await walletConnectProvider.disconnect();
          this.currentProvider = null;
        },
        isConnected: () => {
          return walletConnectProvider.connected;
        },
        getAddress: async () => {
          return walletConnectProvider.accounts[0];
        },
        getSigner: async () => {
          const provider = new ethers.BrowserProvider(walletConnectProvider);
          return await provider.getSigner();
        }
      };
      this.providers.set('walletconnect', wcProvider);
    } catch (error) {
      console.warn('WalletConnect initialization failed:', error);
      // Still add WalletConnect as an option even if initialization fails
      const fallbackWcProvider: WalletProvider = {
        name: 'WalletConnect',
        provider: null,
        connect: async () => {
          throw new Error('WalletConnect is not available. Please try again or use a different wallet.');
        },
        disconnect: async () => {
          this.currentProvider = null;
        },
        isConnected: () => false,
        getAddress: async () => {
          throw new Error('WalletConnect not connected');
        },
        getSigner: async () => {
          throw new Error('WalletConnect not connected');
        }
      };
      this.providers.set('walletconnect', fallbackWcProvider);
    }
  }

  async connectWallet(providerName?: string): Promise<{ success: boolean; address?: string; error?: string }> {
    try {
      let provider: WalletProvider | undefined;

      if (providerName) {
        provider = this.providers.get(providerName);
      } else {
        // Auto-detect best available provider
        provider = this.providers.get('metamask') || this.providers.get('walletconnect');
      }

      if (!provider) {
        return { success: false, error: 'No wallet provider available' };
      }

      const address = await provider.connect();
      this.currentProvider = provider;
      
      return { success: true, address };
    } catch (error: any) {
      console.error('Wallet connection failed:', error);
      return { success: false, error: error.message || 'Connection failed' };
    }
  }

  async disconnectWallet(): Promise<void> {
    if (this.currentProvider) {
      await this.currentProvider.disconnect();
      this.currentProvider = null;
    }
  }

  getCurrentProvider(): WalletProvider | null {
    return this.currentProvider;
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  isConnected(): boolean {
    return this.currentProvider?.isConnected() || false;
  }

  async getAddress(): Promise<string> {
    if (!this.currentProvider) {
      throw new Error('No wallet connected');
    }
    return await this.currentProvider.getAddress();
  }

  async getSigner(): Promise<ethers.Signer> {
    if (!this.currentProvider) {
      throw new Error('No wallet connected');
    }
    return await this.currentProvider.getSigner();
  }
}

export const walletService = new WalletService();