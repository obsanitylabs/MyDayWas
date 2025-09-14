/**
 * Simple and Fast Encryption Service
 * Uses basic XOR encryption with wallet signature for speed and reliability
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
  private keyCache: Map<string, string> = new Map();

  /**
   * Simple XOR encryption - fast and reliable
   */
  async encryptData(data: string, walletAddress: string, signer: any): Promise<EncryptionResult> {
    try {
      console.log('🔐 Starting simple encryption...');
      
      if (!data || !walletAddress || !signer) {
        throw new Error('Missing required parameters');
      }

      const timestamp = Date.now();
      const message = `encrypt-${walletAddress}-${timestamp}`;
      
      console.log('🔐 Getting signature...');
      const signature = await signer.signMessage(message);
      
      if (!signature) {
        throw new Error('Failed to get signature');
      }

      console.log('🔐 Creating encryption key...');
      const key = this.createSimpleKey(signature);
      
      console.log('🔐 Encrypting data...');
      const encryptedData = this.xorEncrypt(data, key);
      
      // Cache the key
      this.keyCache.set(walletAddress, key);
      
      console.log('🔐 Encryption complete!');
      
      return {
        encryptedData,
        encryptionKey: key.substring(0, 16), // Store partial key for identification
        signature,
        timestamp
      };
    } catch (error) {
      console.error('🔐 Encryption failed:', error);
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Simple XOR decryption - fast and reliable
   */
  async decryptData(params: DecryptionParams, walletAddress: string, signer: any): Promise<string> {
    try {
      console.log('🔓 Starting simple decryption...');
      
      if (!params?.encryptedData || !params?.signature || !walletAddress) {
        throw new Error('Missing decryption parameters');
      }

      // Try cached key first
      let key = this.keyCache.get(walletAddress);
      
      if (!key) {
        console.log('🔓 Recreating key from signature...');
        key = this.createSimpleKey(params.signature);
        this.keyCache.set(walletAddress, key);
      }
      
      console.log('🔓 Decrypting data...');
      const decryptedData = this.xorDecrypt(params.encryptedData, key);
      
      console.log('🔓 Decryption complete!');
      return decryptedData;
    } catch (error) {
      console.error('🔓 Decryption failed:', error);
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * Create simple key from signature
   */
  private createSimpleKey(signature: string): string {
    // Simple hash of signature
    let hash = 0;
    for (let i = 0; i < signature.length; i++) {
      const char = signature.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    // Create repeatable key
    const key = Math.abs(hash).toString(16).padStart(8, '0').repeat(4);
    return key.substring(0, 32);
  }

  /**
   * XOR encryption - simple and fast
   */
  private xorEncrypt(data: string, key: string): string {
    let result = '';
    for (let i = 0; i < data.length; i++) {
      const dataChar = data.charCodeAt(i);
      const keyChar = key.charCodeAt(i % key.length);
      const encrypted = dataChar ^ keyChar;
      result += String.fromCharCode(encrypted);
    }
    
    // Convert to base64 for safe storage
    return btoa(result);
  }

  /**
   * XOR decryption - simple and fast
   */
  private xorDecrypt(encryptedData: string, key: string): string {
    try {
      // Decode from base64
      const data = atob(encryptedData);
      
      let result = '';
      for (let i = 0; i < data.length; i++) {
        const dataChar = data.charCodeAt(i);
        const keyChar = key.charCodeAt(i % key.length);
        const decrypted = dataChar ^ keyChar;
        result += String.fromCharCode(decrypted);
      }
      
      return result;
    } catch (error) {
      throw new Error('Invalid encrypted data format');
    }
  }

  /**
   * Clear cached keys
   */
  clearKeys(): void {
    this.keyCache.clear();
  }

  /**
   * Test encryption/decryption
   */
  async testEncryption(testData: string, walletAddress: string, signer: any): Promise<boolean> {
    try {
      console.log('🧪 Testing encryption/decryption...');
      
      // Encrypt
      const encrypted = await this.encryptData(testData, walletAddress, signer);
      console.log('🧪 Encryption test passed');
      
      // Decrypt
      const decrypted = await this.decryptData(encrypted, walletAddress, signer);
      console.log('🧪 Decryption test passed');
      
      // Verify
      const success = decrypted === testData;
      console.log('🧪 Verification:', success ? 'PASSED' : 'FAILED');
      
      return success;
    } catch (error) {
      console.error('🧪 Test failed:', error);
      return false;
    }
  }
}

export const encryptionService = new EncryptionService();