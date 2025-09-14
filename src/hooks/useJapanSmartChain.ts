import { useState, useEffect } from 'react';
import { jscService, JSCDiaryEntry } from '../services/japanSmartChain';
import { walletEncryption } from '../services/encryption';

export interface DiaryEntry {
  id: string;
  date: string;
  content: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  encrypted: boolean;
  transactionHash?: string;
  blockchainStored: boolean;
}

export const useJapanSmartChain = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [userAddress, setUserAddress] = useState<string>('');
  const [networkInfo, setNetworkInfo] = useState<{ chainId: number; name: string }>({ chainId: 0, name: 'Unknown' });
  const [balance, setBalance] = useState<string>('0');

  useEffect(() => {
    checkWalletConnection();
    setupEventListeners();
    
    return () => {
      jscService.removeEventListeners();
    };
  }, []);

  const checkWalletConnection = async () => {
    try {
      if (jscService.isConnected()) {
        setIsConnected(true);
        const address = jscService.getUserAddress();
        setUserAddress(address);
        await updateNetworkInfo();
        await updateBalance();
        await loadEntries(address);
      }
    } catch (error) {
      console.error('Failed to check wallet connection:', error);
    }
  };

  const setupEventListeners = () => {
    jscService.setupEventListeners(
      (accounts: string[]) => {
        if (accounts.length === 0) {
          // User disconnected wallet
          setIsConnected(false);
          setUserAddress('');
          setEntries([]);
          setBalance('0');
        } else {
          // User switched accounts
          setUserAddress(accounts[0]);
          loadEntries(accounts[0]);
          updateBalance();
        }
      },
      (chainId: string) => {
        // User switched networks
        updateNetworkInfo();
        updateBalance();
      }
    );
  };

  const updateNetworkInfo = async () => {
    try {
      const info = await jscService.getNetworkInfo();
      setNetworkInfo(info);
    } catch (error) {
      console.error('Failed to update network info:', error);
    }
  };

  const updateBalance = async () => {
    try {
      const bal = await jscService.getBalance();
      setBalance(bal);
    } catch (error) {
      console.error('Failed to update balance:', error);
    }
  };

  const connectWallet = async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      // Connect wallet for encryption
      const walletConnected = await walletEncryption.connectWallet();
      
      // Connect to Japan Smart Chain
      const jscConnected = await jscService.connectWallet();
      
      if (walletConnected && jscConnected) {
        setIsConnected(true);
        const address = jscService.getUserAddress();
        setUserAddress(address);
        await updateNetworkInfo();
        await updateBalance();
        await loadEntries(address);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Wallet connection failed:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const submitEntry = async (content: string, sentiment: 'positive' | 'negative' | 'neutral'): Promise<boolean> => {
    if (!isConnected) {
      throw new Error('Wallet not connected');
    }

    setIsLoading(true);
    try {
      // Encrypt the content using wallet
      const encryptionResult = await walletEncryption.encryptData(content);
      
      // Write encrypted data to Japan Smart Chain
      const transactionHash = await jscService.writeEntry(
        encryptionResult.encryptedData,
        sentiment
      );

      // Add to local state
      const newEntry: DiaryEntry = {
        id: Date.now().toString(),
        date: new Date().toISOString().split('T')[0],
        content,
        sentiment,
        encrypted: true,
        transactionHash,
        blockchainStored: true
      };

      setEntries(prev => [newEntry, ...prev]);
      
      // Update balance after transaction
      await updateBalance();
      
      return true;
    } catch (error) {
      console.error('Failed to submit entry:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const loadEntries = async (userId: string) => {
    setIsLoading(true);
    try {
      const jscEntries = await jscService.readEntries(userId);
      
      // Convert JSC entries to DiaryEntry format
      const formattedEntries: DiaryEntry[] = await Promise.all(
        jscEntries.map(async (entry: JSCDiaryEntry) => {
          let decryptedContent = entry.encryptedContent;
          
          // Try to decrypt if we have the wallet connected
          try {
            if (walletEncryption.isConnected()) {
              // Note: We'd need the original signature to decrypt
              // For now, we'll show encrypted content
              decryptedContent = `[Encrypted Entry - ${entry.sentiment}]`;
            }
          } catch (error) {
            console.warn('Failed to decrypt entry:', error);
          }

          return {
            id: entry.id,
            date: new Date(entry.timestamp).toISOString().split('T')[0],
            content: decryptedContent,
            sentiment: entry.sentiment,
            encrypted: true,
            transactionHash: entry.transactionHash,
            blockchainStored: true
          };
        })
      );

      setEntries(formattedEntries);
    } catch (error) {
      console.error('Failed to load entries:', error);
      // Fallback to mock data if blockchain fails
      setEntries([
        {
          id: '1',
          date: '2025-01-10',
          content: 'Today was challenging but I learned something new about myself...',
          sentiment: 'neutral',
          encrypted: true,
          blockchainStored: false
        },
        {
          id: '2',
          date: '2025-01-09',
          content: 'Feeling grateful for the small moments of joy in my day...',
          sentiment: 'positive',
          encrypted: true,
          blockchainStored: false
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const getGlobalSentiment = async () => {
    try {
      return await jscService.getGlobalSentiment();
    } catch (error) {
      console.error('Failed to get global sentiment:', error);
      return { positive: 64, negative: 25, neutral: 11 };
    }
  };

  return {
    isConnected,
    isLoading,
    entries,
    userAddress,
    networkInfo,
    balance,
    connectWallet,
    submitEntry,
    loadEntries,
    getGlobalSentiment
  };
};