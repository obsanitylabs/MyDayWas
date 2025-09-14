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

  async encryptData(data: string, walletAddress: string, signer: any): Promise<EncryptionResult> {
    try {
      const timestamp = Date.now();
      const message = `Encrypt diary entry for ${walletAddress} at ${timestamp}`;
      
      // Sign message to create encryption key
      const signature = await signer.signMessage(message);
      
      // Derive encryption key from signature
      const encryptionKey = await this.deriveKeyFromSignature(signature);
      
      // Store key for later decryption
      this.encryptionKeys.set(walletAddress, encryptionKey);
      
      // Encrypt the data
      const encryptedData = await this.symmetricEncrypt(data, encryptionKey);
      
      return {
        encryptedData,
        encryptionKey: encryptionKey.slice(0, 32), // Store partial key for identification
        signature,
        timestamp
      };
    } catch (error) {
      console.error('Encryption failed:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  async decryptData(params: DecryptionParams, walletAddress: string, signer: any): Promise<string> {
    try {
      let encryptionKey = this.encryptionKeys.get(walletAddress);
      
      if (!encryptionKey) {
        // Recreate key from signature if not in memory
        encryptionKey = await this.deriveKeyFromSignature(params.signature);
        this.encryptionKeys.set(walletAddress, encryptionKey);
      }
      
      // Decrypt the data
      return await this.symmetricDecrypt(params.encryptedData, encryptionKey);
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  private async deriveKeyFromSignature(signature: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(signature);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private async symmetricEncrypt(data: string, key: string): Promise<string> {
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

    return decoder.decode(decrypted);
  }

  clearKeys(): void {
    this.encryptionKeys.clear();
  }
}

export const encryptionService = new EncryptionService();