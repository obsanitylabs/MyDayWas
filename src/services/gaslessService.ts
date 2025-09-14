/**
 * Gasless Transaction Service
 * Handles meta-transactions and gas sponsorship for users
 */

import { ethers } from 'ethers';

// Minimal Forwarder ABI for ERC-2771 meta-transactions
const FORWARDER_ABI = [
  {
    "inputs": [
      {
        "components": [
          {"internalType": "address", "name": "from", "type": "address"},
          {"internalType": "address", "name": "to", "type": "address"},
          {"internalType": "uint256", "name": "value", "type": "uint256"},
          {"internalType": "uint256", "name": "gas", "type": "uint256"},
          {"internalType": "uint256", "name": "nonce", "type": "uint256"},
          {"internalType": "bytes", "name": "data", "type": "bytes"}
        ],
        "internalType": "struct MinimalForwarder.ForwardRequest",
        "name": "req",
        "type": "tuple"
      },
      {"internalType": "bytes", "name": "signature", "type": "bytes"}
    ],
    "name": "execute",
    "outputs": [
      {"internalType": "bool", "name": "", "type": "bool"},
      {"internalType": "bytes", "name": "", "type": "bytes"}
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "from", "type": "address"}],
    "name": "getNonce",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
];

// Gas Relay Server Configuration
const GAS_RELAY_CONFIG = {
  serverUrl: 'https://gas-relay.your-domain.com', // Your gas relay server
  apiKey: import.meta.env.VITE_GAS_RELAY_API_KEY || '',
  forwarderAddress: '0x9399BB24DBB5C4b782C70c2969F58716Ebbd6a3b' // JSC Kaigan Testnet MinimalForwarder
};

export interface GaslessTransactionRequest {
  to: string;
  data: string;
  value?: string;
  gas?: number;
}

export interface MetaTransactionData {
  from: string;
  to: string;
  value: number;
  gas: number;
  nonce: number;
  data: string;
}

class GaslessService {
  private forwarderContract: ethers.Contract | null = null;
  private provider: ethers.Provider | null = null;
  private relayerSigner: ethers.Signer | null = null;

  async initialize(provider: ethers.Provider, relayerPrivateKey?: string) {
    this.provider = provider;
    
    if (relayerPrivateKey) {
      this.relayerSigner = new ethers.Wallet(relayerPrivateKey, provider);
    }
    
    this.forwarderContract = new ethers.Contract(
      GAS_RELAY_CONFIG.forwarderAddress,
      FORWARDER_ABI,
      this.relayerSigner || provider
    );
  }

  /**
   * Create a meta-transaction for gasless execution
   */
  async createMetaTransaction(
    userSigner: ethers.Signer,
    request: GaslessTransactionRequest
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      if (!this.forwarderContract || !this.provider) {
        throw new Error('Gasless service not initialized');
      }

      const userAddress = await userSigner.getAddress();
      
      // Get nonce for the user
      const nonce = await this.forwarderContract.getNonce(userAddress);
      
      // Prepare meta-transaction data
      const metaTx: MetaTransactionData = {
        from: userAddress,
        to: request.to,
        value: parseInt(request.value || '0'),
        gas: request.gas || 200000,
        nonce: nonce.toNumber(),
        data: request.data
      };

      // Create EIP-712 signature
      const signature = await this.signMetaTransaction(userSigner, metaTx);
      
      // Send to relay server or execute directly
      if (this.relayerSigner) {
        // Execute directly with our relayer
        const tx = await this.forwarderContract.execute(metaTx, signature);
        const receipt = await tx.wait();
        
        return { success: true, txHash: receipt.hash };
      } else {
        // Send to relay server
        return await this.sendToRelayServer(metaTx, signature);
      }
    } catch (error: any) {
      console.error('Meta-transaction failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sign meta-transaction using EIP-712
   */
  private async signMetaTransaction(
    signer: ethers.Signer,
    metaTx: MetaTransactionData
  ): Promise<string> {
    const domain = {
      name: 'MinimalForwarder',
      version: '0.0.1',
      chainId: await signer.getChainId(),
      verifyingContract: '0x9399BB24DBB5C4b782C70c2969F58716Ebbd6a3b'
    };

    const types = {
      ForwardRequest: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'gas', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'data', type: 'bytes' }
      ]
    };

    return await signer.signTypedData(domain, types, metaTx);
  }

  /**
   * Send meta-transaction to relay server
   */
  private async sendToRelayServer(
    metaTx: MetaTransactionData,
    signature: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const response = await fetch(`${GAS_RELAY_CONFIG.serverUrl}/relay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GAS_RELAY_CONFIG.apiKey}`
        },
        body: JSON.stringify({
          metaTx,
          signature
        })
      });

      const result = await response.json();
      
      if (response.ok) {
        return { success: true, txHash: result.txHash };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if gasless transactions are available
   */
  isGaslessAvailable(): boolean {
    return this.forwarderContract !== null && (
      this.relayerSigner !== null || 
      GAS_RELAY_CONFIG.apiKey !== ''
    );
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(request: GaslessTransactionRequest): Promise<number> {
    if (!this.provider) {
      throw new Error('Provider not available');
    }

    try {
      const gasEstimate = await this.provider.estimateGas({
        to: request.to,
        data: request.data,
        value: request.value || '0'
      });

      // Add 20% buffer for meta-transaction overhead
      return Math.ceil(gasEstimate.toNumber() * 1.2);
    } catch (error) {
      console.error('Gas estimation failed:', error);
      return 200000; // Default fallback
    }
  }

  /**
   * Fund the gas pool (for contract owner)
   */
  async fundGasPool(
    contractAddress: string,
    amount: string,
    signer: ethers.Signer
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      // This would call the fundGasPool function on your contract
      const contract = new ethers.Contract(contractAddress, [
        "function fundGasPool() external payable"
      ], signer);

      const tx = await contract.fundGasPool({ value: amount });
      const receipt = await tx.wait();

      return { success: true, txHash: receipt.hash };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

export const gaslessService = new GaslessService();