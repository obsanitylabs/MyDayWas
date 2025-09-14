/**
 * Legacy encryption service - replaced by encryptionService.ts
 * Keeping for backward compatibility
 */

export interface EncryptionResult {
  encryptedData: string;
  publicKey: string;
  signature: string;
}

export class LegacyWalletEncryption {
  private wallet: any = null;

  async connectWallet(): Promise<boolean> {
    try {
      // Check for various wallet types
      if (typeof window !== 'undefined') {
        // Koinos wallet
        if ((window as any).koinos) {
          this.wallet = (window as any).koinos;
          await this.wallet.connect();
          return true;
        }
        
        // MetaMask (for testing)
        if ((window as any).ethereum) {
          this.wallet = (window as any).ethereum;
          await this.wallet.request({ method: 'eth_requestAccounts' });
          return true;
        }
      }
      
      throw new Error('No compatible wallet found');
    } catch (error) {
      console.error('Wallet connection failed:', error);
      return false;
    }
  }

  async encryptData(data: string): Promise<EncryptionResult> {
    if (!this.wallet) {
      throw new Error('Wallet not connected');
    }

    try {
      // Get user's public key
      const accounts = await this.wallet.request({ method: 'eth_accounts' });
      const userAddress = accounts[0];
      
      // Create a message to sign for key derivation
      const message = `Encrypt diary entry: ${Date.now()}`;
      const signature = await this.wallet.request({
        method: 'personal_sign',
        params: [message, userAddress]
      });

      // Use signature as encryption key (simplified approach)
      const encryptedData = await this.symmetricEncrypt(data, signature);
      
      return {
        encryptedData,
        publicKey: userAddress,
        signature
      };
    } catch (error) {
      console.error('Encryption failed:', error);
      throw error;
    }
  }

  async decryptData(encryptedData: string, signature: string): Promise<string> {
    if (!this.wallet) {
      throw new Error('Wallet not connected');
    }

    try {
      // Decrypt using the signature as key
      return await this.symmetricDecrypt(encryptedData, signature);
    } catch (error) {
      console.error('Decryption failed:', error);
      throw error;
    }
  }

  private async symmetricEncrypt(data: string, key: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    
    // Generate a key from the signature
    const keyBuffer = encoder.encode(key.slice(0, 32));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    // Encrypt the data
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      dataBuffer
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    // Return as base64
    return btoa(String.fromCharCode(...combined));
  }

  private async symmetricDecrypt(encryptedData: string, key: string): Promise<string> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    // Decode from base64
    const combined = new Uint8Array(
      atob(encryptedData).split('').map(char => char.charCodeAt(0))
    );

    // Extract IV and encrypted data
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    // Generate key from signature
    const keyBuffer = encoder.encode(key.slice(0, 32));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encrypted
    );

    return decoder.decode(decrypted);
  }

  async getUserAddress(): Promise<string> {
    if (!this.wallet) {
      throw new Error('Wallet not connected');
    }

    const accounts = await this.wallet.request({ method: 'eth_accounts' });
    return accounts[0];
  }

  isConnected(): boolean {
    return this.wallet !== null;
  }
}

export const walletEncryption = new LegacyWalletEncryption();