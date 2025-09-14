/**
 * Enhanced Encryption Service
 * Handles wallet-based encryption/decryption with proper key management
 */

export interface EncryptionResult {
  encryptedData: string;
  encryptionKey: string;
  signature: string;
  timestamp: number;
}

export interface DecryptionParams {
  encryptedData: string;
  encryptionKey: string;
  signature: string;
}

class EncryptionService {
  private encryptionKeys: Map<string, string> = new Map();
  private isInitialized: boolean = false;

  private async initialize() {
    if (this.isInitialized) return;
    
    // Check if Web Crypto API is available
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('Web Crypto API not available. Please use a modern browser with HTTPS.');
    }
    
    this.isInitialized = true;
  }

  async encryptData(data: string, walletAddress: string, signer: any): Promise<EncryptionResult> {
    await this.initialize();
    
    if (!data || typeof data !== 'string') {
      throw new Error('Invalid data: must be a non-empty string');
    }
    
    if (!walletAddress || typeof walletAddress !== 'string') {
      throw new Error('Invalid wallet address: must be a non-empty string');
    }
    
    if (!signer || typeof signer.signMessage !== 'function') {
      throw new Error('Invalid signer: must have signMessage method');
    }

    try {
      const timestamp = Date.now();
      const message = `Encrypt diary entry for ${walletAddress} at ${timestamp}`;
      
      console.log('Encryption: Starting encryption process...');
      console.log('Encryption: Wallet address:', walletAddress);
      console.log('Encryption: Data length:', data.length);
      
      // Sign message to create encryption key
      const signature = await signer.signMessage(message);
      
      if (!signature || typeof signature !== 'string') {
        throw new Error('Failed to get signature from wallet');
      }
      
      console.log('Encryption: Got signature, length:', signature.length);
      
      // Derive encryption key from signature
      const encryptionKey = await this.deriveKeyFromSignature(signature);
      console.log('Encryption: Derived key, length:', encryptionKey.length);
      
      // Store key for later decryption
      this.encryptionKeys.set(walletAddress, encryptionKey);
      
      // Encrypt the data
      const encryptedData = await this.symmetricEncrypt(data, encryptionKey);
      console.log('Encryption: Encrypted data, length:', encryptedData.length);
      
      return {
        encryptedData,
        encryptionKey: encryptionKey.slice(0, 32), // Store partial key for identification
        signature,
        timestamp
      };
    } catch (error) {
      console.error('Encryption failed:', error);
      
      // Provide specific error messages
      if (error.message?.includes('User denied')) {
        throw new Error('Encryption cancelled: Please approve the signature request in your wallet');
      } else if (error.message?.includes('network')) {
        throw new Error('Network error during encryption: Please check your connection');
      } else if (error.code === 4001) {
        throw new Error('Encryption cancelled: User rejected the signature request');
      } else {
        throw new Error(`Encryption failed: ${error.message || 'Unknown error'}`);
      }
    }
  }

  async decryptData(params: DecryptionParams, walletAddress: string, signer: any): Promise<string> {
    await this.initialize();
    
    if (!params || !params.encryptedData || !params.signature) {
      throw new Error('Invalid decryption parameters: missing encrypted data or signature');
    }
    
    if (!walletAddress || typeof walletAddress !== 'string') {
      throw new Error('Invalid wallet address for decryption');
    }

    try {
      console.log('Decryption: Starting decryption process...');
      console.log('Decryption: Wallet address:', walletAddress);
      console.log('Decryption: Encrypted data length:', params.encryptedData.length);
      
      let encryptionKey = this.encryptionKeys.get(walletAddress);
      
      if (!encryptionKey) {
        console.log('Decryption: Key not in memory, deriving from signature...');
        // Recreate key from signature if not in memory
        encryptionKey = await this.deriveKeyFromSignature(params.signature);
        this.encryptionKeys.set(walletAddress, encryptionKey);
      }
      
      // Decrypt the data
      const decryptedData = await this.symmetricDecrypt(params.encryptedData, encryptionKey);
      console.log('Decryption: Successfully decrypted, length:', decryptedData.length);
      
      return decryptedData;
    } catch (error) {
      console.error('Decryption failed:', error);
      
      if (error.message?.includes('decrypt')) {
        throw new Error('Decryption failed: Invalid encryption key or corrupted data');
      } else {
        throw new Error(`Decryption failed: ${error.message || 'Unknown error'}`);
      }
    }
  }

  private async deriveKeyFromSignature(signature: string): Promise<string> {
    if (!signature || typeof signature !== 'string') {
      throw new Error('Invalid signature for key derivation');
    }
    
    try {
      console.log('Key derivation: Processing signature...');
      
      const encoder = new TextEncoder();
      const data = encoder.encode(signature);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const key = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      console.log('Key derivation: Generated key length:', key.length);
      return key;
    } catch (error) {
      console.error('Key derivation failed:', error);
      throw new Error(`Key derivation failed: ${error.message}`);
    }
  }

  private async symmetricEncrypt(data: string, key: string): Promise<string> {
    if (!data || typeof data !== 'string') {
      throw new Error('Invalid data for encryption');
    }
    
    if (!key || typeof key !== 'string' || key.length < 32) {
      throw new Error('Invalid encryption key: must be at least 32 characters');
    }

    try {
      console.log('Symmetric encryption: Starting...');
      
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(data);
      
      // Use first 32 chars of key
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
      const result = btoa(String.fromCharCode(...combined));
      console.log('Symmetric encryption: Success, result length:', result.length);
      return result;
    } catch (error) {
      console.error('Symmetric encryption failed:', error);
      throw new Error(`Symmetric encryption failed: ${error.message}`);
    }
  }

  private async symmetricDecrypt(encryptedData: string, key: string): Promise<string> {
    if (!encryptedData || typeof encryptedData !== 'string') {
      throw new Error('Invalid encrypted data for decryption');
    }
    
    if (!key || typeof key !== 'string' || key.length < 32) {
      throw new Error('Invalid decryption key: must be at least 32 characters');
    }

    try {
      console.log('Symmetric decryption: Starting...');
      
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      
      // Decode from base64
      let combined;
      try {
        combined = new Uint8Array(
          atob(encryptedData).split('').map(char => char.charCodeAt(0))
        );
      } catch (error) {
        throw new Error('Invalid base64 encrypted data');
      }

      if (combined.length < 12) {
        throw new Error('Encrypted data too short - missing IV');
      }

      // Extract IV and encrypted data
      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);

      // Generate key
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

      const result = decoder.decode(decrypted);
      console.log('Symmetric decryption: Success, result length:', result.length);
      return result;
    } catch (error) {
      console.error('Symmetric decryption failed:', error);
      
      if (error.name === 'OperationError') {
        throw new Error('Decryption failed: Wrong key or corrupted data');
      } else {
        throw new Error(`Symmetric decryption failed: ${error.message}`);
      }
    }
  }

  clearKeys(): void {
    this.encryptionKeys.clear();
  }
}

export const encryptionService = new EncryptionService();