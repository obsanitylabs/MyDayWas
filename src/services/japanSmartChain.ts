/**
 * Japan Smart Chain Integration Service
 * Handles blockchain interactions for emotional diary entries
 */

import { ethers } from 'ethers';

// Japan Smart Chain Configuration
const JSC_CONFIG = {
  chainId: '0x508A28', // 5278000 in decimal (JSC Kaigan Testnet)
  chainName: 'JSC Kaigan Testnet',
  nativeCurrency: {
    name: 'JETH',
    symbol: 'JETH',
    decimals: 18,
  },
  rpcUrls: ['https://rpc.kaigan.jsc.dev/rpc?token=sAoK9rCEuCrO57nL_eh7xfuS6g4SJvPC_7kd-8yRj-c'],
  blockExplorerUrls: ['https://explorer.kaigan.jsc.dev'],
};

// Smart Contract ABI for Emotional Diary
const DIARY_CONTRACT_ABI = [
  {
    "inputs": [
      {"internalType": "string", "name": "_encryptedContent", "type": "string"},
      {"internalType": "uint8", "name": "_sentiment", "type": "uint8"},
      {"internalType": "uint256", "name": "_timestamp", "type": "uint256"}
    ],
    "name": "addEntry",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getUserEntries",
    "outputs": [
      {
        "components": [
          {"internalType": "uint256", "name": "id", "type": "uint256"},
          {"internalType": "address", "name": "user", "type": "address"},
          {"internalType": "string", "name": "encryptedContent", "type": "string"},
          {"internalType": "uint8", "name": "sentiment", "type": "uint8"},
          {"internalType": "uint256", "name": "timestamp", "type": "uint256"}
        ],
        "internalType": "struct EmotionalDiary.DiaryEntry[]",
        "name": "",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "uint256", "name": "_offset", "type": "uint256"},
      {"internalType": "uint256", "name": "_limit", "type": "uint256"}
    ],
    "name": "getUserEntriesPaginated",
    "outputs": [
      {
        "components": [
          {"internalType": "uint256", "name": "id", "type": "uint256"},
          {"internalType": "address", "name": "user", "type": "address"},
          {"internalType": "string", "name": "encryptedContent", "type": "string"},
          {"internalType": "uint8", "name": "sentiment", "type": "uint8"},
          {"internalType": "uint256", "name": "timestamp", "type": "uint256"}
        ],
        "internalType": "struct EmotionalDiary.DiaryEntry[]",
        "name": "",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getUserEntryCount",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getGlobalSentiment",
    "outputs": [
      {"internalType": "uint256", "name": "positive", "type": "uint256"},
      {"internalType": "uint256", "name": "negative", "type": "uint256"},
      {"internalType": "uint256", "name": "neutral", "type": "uint256"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isPaused",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
  }
];

// Deployed EmotionalDiary contract on JSC Kaigan Testnet
const CONTRACT_ADDRESS = "0x23379e41109909f112F7619b17D403D4Cc70d589";

export interface JSCDiaryEntry {
  id: string;
  user: string;
  encryptedContent: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  timestamp: number;
  transactionHash?: string;
}

export class JapanSmartChainService {
  private provider: ethers.BrowserProvider | null = null;
  private signer: ethers.Signer | null = null;
  private contract: ethers.Contract | null = null;
  private userAddress: string = '';

  constructor() {
    this.initializeProvider();
  }

  private async initializeProvider() {
    if (typeof window !== 'undefined' && window.ethereum) {
      try {
        this.provider = new ethers.BrowserProvider(window.ethereum);
      } catch (error) {
        console.error('Failed to initialize provider:', error);
      }
    }
  }

  async connectWallet(): Promise<boolean> {
    try {
      // Provider and signer should already be set by wallet service
      if (!this.provider || !this.signer) {
        throw new Error('Provider or signer not available');
      }

      this.userAddress = await this.signer.getAddress();

      // Initialize contract
      this.contract = new ethers.Contract(CONTRACT_ADDRESS, DIARY_CONTRACT_ABI, this.signer);

      return true;
    } catch (error) {
      console.error('Wallet connection failed:', error);
      // Clear state on failure
      this.provider = null;
      this.signer = null;
      this.contract = null;
      this.userAddress = '';
      return false;
    }
  }

  async connectWithSigner(signer: ethers.Signer): Promise<boolean> {
    try {
      this.signer = signer;
      this.provider = signer.provider as ethers.BrowserProvider;
      
      if (!this.provider) {
        throw new Error('Signer does not have a provider');
      }
      
      this.userAddress = await this.signer.getAddress();

      // Initialize contract
      this.contract = new ethers.Contract(CONTRACT_ADDRESS, DIARY_CONTRACT_ABI, this.signer);

      // Verify we're on the correct network
      const network = await this.provider.getNetwork();
      console.log('Connected to network:', network.chainId, network.name);

      return true;
    } catch (error) {
      console.error('JSC connection with signer failed:', error);
      // Clear state on failure
      this.provider = null;
      this.signer = null;
      this.contract = null;
      this.userAddress = '';
      throw error;
    }
  }

  private async addJSCNetwork(): Promise<void> {
    try {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [JSC_CONFIG],
      });
    } catch (error) {
      console.error('Failed to add JSC network:', error);
      // Check if user rejected the request
      if (error.code === 4001) {
        throw new Error('Please approve adding the Japan Smart Chain network to your wallet to continue. You can try connecting again after approving the network addition.');
      }
      // Network might already be added, continue
    }
  }

  private async switchToJSCNetwork(): Promise<void> {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: JSC_CONFIG.chainId }],
      });
    } catch (error) {
      console.error('Failed to switch to JSC network:', error);
      // Check if user rejected the request
      if (error.code === 4001) {
        throw new Error('Please approve switching to the Japan Smart Chain network in your wallet. You can try connecting again after switching networks.');
      }
      // Check if chain was not added
      if (error.code === 4902) {
        // Chain not added, try to add it first
        await this.addJSCNetwork();
        // Retry switching after adding
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: JSC_CONFIG.chainId }],
          });
        } catch (retryError) {
          if (retryError.code === 4001) {
            throw new Error('Please approve switching to the Japan Smart Chain network in your wallet. You can try connecting again after switching networks.');
          }
          throw retryError;
        }
      } else {
        throw error;
      }
    }
  }

  async writeEntry(encryptedContent: string, sentiment: 'positive' | 'negative' | 'neutral'): Promise<string> {
    if (!this.contract || !this.signer) {
      throw new Error('Wallet not connected or contract not initialized');
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Convert sentiment to enum value
      const sentimentEnum = sentiment === 'positive' ? 0 : sentiment === 'negative' ? 1 : 2;
      
      // Check if contract is paused
      try {
        const isPaused = await this.contract.isPaused();
        if (isPaused) {
          throw new Error('Contract is currently paused. Please try again later.');
        }
      } catch (pauseError) {
        console.warn('Could not check pause status:', pauseError);
      }
      
      // Estimate gas
      let gasEstimate;
      try {
        gasEstimate = await this.contract.addEntry.estimateGas(
          encryptedContent,
          sentimentEnum,
          timestamp
        );
      } catch (estimateError) {
        console.warn('Gas estimation failed, using default:', estimateError);
        gasEstimate = 300000n; // Default gas limit
      }

      // Add 20% buffer to gas estimate
      const gasLimit = gasEstimate * 120n / 100n;

      // Submit transaction
      const tx = await this.contract.addEntry(
        encryptedContent,
        sentimentEnum,
        timestamp,
        { gasLimit }
      );

      // Wait for confirmation
      const receipt = await tx.wait();
      
      if (!receipt || receipt.status !== 1) {
        throw new Error('Transaction failed or was reverted');
      }
      
      return receipt.hash;
    } catch (error) {
      console.error('Failed to write entry to JSC:', error);
      
      // Provide more user-friendly error messages
      if (error.message?.includes('user rejected')) {
        throw new Error('Transaction was cancelled by user');
      } else if (error.message?.includes('insufficient funds')) {
        throw new Error('Insufficient JETH balance for transaction');
      } else if (error.message?.includes('execution reverted')) {
        throw new Error('Transaction failed: ' + (error.reason || 'Contract execution reverted'));
      } else {
        throw new Error('Failed to submit entry: ' + (error.message || 'Unknown error'));
      }
    }
  }

  async readEntries(userAddress?: string): Promise<JSCDiaryEntry[]> {
    if (!this.contract) {
      throw new Error('Contract not initialized');
    }

    try {
      // getUserEntries now only returns entries for msg.sender (the connected wallet)
      const entries = await this.contract.getUserEntries();
      
      return entries.map((entry: any) => ({
        id: entry.id.toString(),
        user: entry.user,
        encryptedContent: entry.encryptedContent,
        sentiment: entry.sentiment === 0 ? 'positive' : entry.sentiment === 1 ? 'negative' : 'neutral',
        timestamp: Number(entry.timestamp) * 1000, // Convert to milliseconds
      }));
    } catch (error) {
      console.error('Failed to read entries from JSC:', error);
      
      // Check if it's a network/connection issue
      if (error.message?.includes('network') || error.message?.includes('connection')) {
        throw new Error('Network connection issue. Please check your internet connection and try again.');
      }
      
      return [];
    }
  }

  async getGlobalSentiment(): Promise<{ positive: number; negative: number; neutral: number }> {
    if (!this.contract) {
      throw new Error('Contract not initialized');
    }

    try {
      const result = await this.contract.getGlobalSentiment();
      
      const total = Number(result.positive) + Number(result.negative) + Number(result.neutral);
      
      if (total === 0) {
        return { positive: 33, negative: 33, neutral: 34 };
      }

      return {
        positive: Math.round((Number(result.positive) / total) * 100),
        negative: Math.round((Number(result.negative) / total) * 100),
        neutral: Math.round((Number(result.neutral) / total) * 100),
      };
    } catch (error) {
      console.error('Failed to get global sentiment from JSC:', error);
      // Return mock data as fallback
      return { positive: 64, negative: 25, neutral: 11 };
    }
  }

  async getBalance(): Promise<string> {
    if (!this.provider || !this.userAddress) {
      return '0';
    }

    try {
      const balance = await this.provider.getBalance(this.userAddress);
      return ethers.formatEther(balance);
    } catch (error) {
      console.error('Failed to get balance:', error);
      return '0';
    }
  }

  async getNetworkInfo(): Promise<{ chainId: number; name: string }> {
    if (!this.provider) {
      return { chainId: 0, name: 'Unknown' };
    }

    try {
      const network = await this.provider.getNetwork();
      return {
        chainId: Number(network.chainId),
        name: network.name || 'JSC Kaigan Testnet',
      };
    } catch (error) {
      console.error('Failed to get network info:', error);
      return { chainId: 0, name: 'Unknown' };
    }
  }

  getUserAddress(): string {
    return this.userAddress;
  }

  isConnected(): boolean {
    return this.signer !== null && this.userAddress !== '';
  }

  // Event listeners for wallet changes
  setupEventListeners(onAccountChange: (accounts: string[]) => void, onChainChange: (chainId: string) => void) {
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', onAccountChange);
      window.ethereum.on('chainChanged', onChainChange);
    }
  }

  removeEventListeners() {
    if (window.ethereum) {
      window.ethereum.removeAllListeners('accountsChanged');
      window.ethereum.removeAllListeners('chainChanged');
    }
  }
}

export const jscService = new JapanSmartChainService();