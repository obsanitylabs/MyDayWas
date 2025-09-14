import { useState, useEffect, useCallback } from 'react';
import { jscService } from '../services/japanSmartChain';
import { walletService } from '../services/walletService';
import { encryptionService } from '../services/encryptionService';
import { localStorageService, LocalDiaryEntry } from '../services/localStorageService';

export interface DiaryEntry {
  id: string;
  date: string;
  content: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  encrypted: boolean;
  transactionHash?: string;
  blockchainStored: boolean;
}

export const useEnhancedJSC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [userAddress, setUserAddress] = useState<string>('');
  const [networkInfo, setNetworkInfo] = useState<{ chainId: number; name: string }>({ chainId: 0, name: 'Unknown' });
  const [balance, setBalance] = useState<string>('0');
  const [error, setError] = useState<string>('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Network status monitoring
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    checkWalletConnection();
    setupEventListeners();
    
    return () => {
      jscService.removeEventListeners();
    };
  }, []);

  const checkWalletConnection = async () => {
    try {
      if (walletService.isConnected()) {
        const address = await walletService.getAddress();
        const signer = await walletService.getSigner();
        
        // Ensure JSC service is properly initialized
        const jscConnected = await jscService.connectWithSigner(signer);
        if (jscConnected) {
          setIsConnected(true);
          setUserAddress(address);
          await updateNetworkInfo();
          await updateBalance();
          await loadEntries(address);
        } else {
          // JSC connection failed, disconnect wallet
          await walletService.disconnectWallet();
          setError('Failed to connect to Japan Smart Chain. Please ensure you are on the correct network.');
        }
      }
    } catch (error) {
      console.error('Failed to check wallet connection:', error);
      setError(`Failed to check wallet connection: ${error?.message || 'Unknown error'}`);
      // Ensure clean state on error
      await walletService.disconnectWallet();
    }
  };

  const setupEventListeners = () => {
    jscService.setupEventListeners(
      (accounts: string[]) => {
        if (accounts.length === 0) {
          handleDisconnect();
        } else {
          setUserAddress(accounts[0]);
          loadEntries(accounts[0]);
          updateBalance();
        }
      },
      (chainId: string) => {
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

  const connectWallet = async (providerName?: string): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    setError('');
    
    try {
      // Connect wallet service
      const walletResult = await walletService.connectWallet(providerName);
      if (!walletResult.success) {
        return { success: false, error: walletResult.error };
      }

      // Connect to JSC
      const signer = await walletService.getSigner();
      const jscConnected = await jscService.connectWithSigner(signer);
      if (!jscConnected) {
        // JSC connection failed, disconnect wallet
        await walletService.disconnectWallet();
        return { success: false, error: 'Failed to connect to Japan Smart Chain' };
      }

      setIsConnected(true);
      const address = walletResult.address!;
      setUserAddress(address);
      
      await updateNetworkInfo();
      await updateBalance();
      await loadEntries(address);
      
      return { success: true };
    } catch (error: any) {
      const errorMessage = error.message || 'Wallet connection failed';
      setError(errorMessage);
      // Ensure clean state on error
      await walletService.disconnectWallet();
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = useCallback(async () => {
    await walletService.disconnectWallet();
    encryptionService.clearKeys();
    setIsConnected(false);
    setUserAddress('');
    setEntries([]);
    setBalance('0');
    setError('');
  }, []);

  const submitEntry = async (content: string, sentiment: 'positive' | 'negative' | 'neutral'): Promise<{ success: boolean; error?: string }> => {
    if (!isConnected) {
      return { success: false, error: 'Wallet not connected' };
    }

    setIsLoading(true);
    setError('');

    try {
      const signer = await walletService.getSigner();
      
      // Create local entry first
      const localEntry: LocalDiaryEntry = {
        id: Date.now().toString(),
        date: new Date().toISOString().split('T')[0],
        content,
        sentiment,
        encrypted: true,
        blockchainStored: false,
        createdAt: Date.now()
      };

      // Save to local storage immediately
      localStorageService.saveEntry(localEntry, userAddress);
      
      // Update UI
      const uiEntry: DiaryEntry = {
        id: localEntry.id,
        date: localEntry.date,
        content: localEntry.content,
        sentiment: localEntry.sentiment,
        encrypted: localEntry.encrypted,
        blockchainStored: localEntry.blockchainStored
      };
      setEntries(prev => [uiEntry, ...prev]);

      // Try to encrypt and store on blockchain if online
      if (isOnline) {
        try {
          const encryptionResult = await encryptionService.encryptData(content, userAddress, signer);
          
          // Store encryption data
          localStorageService.updateEntry(localEntry.id, {
            encryptionData: encryptionResult
          }, userAddress);

          const transactionHash = await jscService.writeEntry(
            encryptionResult.encryptedData,
            sentiment
          );

          // Mark as synced
          localStorageService.markAsSynced(localEntry.id, userAddress, transactionHash);
          
          // Update UI
          setEntries(prev => prev.map(entry => 
            entry.id === localEntry.id 
              ? { ...entry, transactionHash, blockchainStored: true }
              : entry
          ));

          await updateBalance();
        } catch (blockchainError) {
          console.error('Blockchain storage failed:', blockchainError);
          // Entry is still saved locally, will sync later
        }
      }

      return { success: true };
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to submit entry';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  };

  const loadEntries = async (userId: string) => {
    setIsLoading(true);
    setError('');

    try {
      // Load from local storage first
      const localEntries = localStorageService.getEntries(userId);
      
      // Convert to UI format
      const uiEntries: DiaryEntry[] = localEntries.map(entry => ({
        id: entry.id,
        date: entry.date,
        content: entry.content,
        sentiment: entry.sentiment,
        encrypted: entry.encrypted,
        transactionHash: entry.transactionHash,
        blockchainStored: entry.blockchainStored
      }));

      setEntries(uiEntries);

      // Try to sync with blockchain if online
      if (isOnline && jscService.isConnected()) {
        try {
          const jscEntries = await jscService.readEntries(userId);
          const signer = await walletService.getSigner();
          
          // Decrypt and merge blockchain entries
          const decryptedEntries: DiaryEntry[] = await Promise.all(
            jscEntries.map(async (entry) => {
              let decryptedContent = '[Encrypted Entry]';
              
              try {
                // Find local entry with encryption data
                const localEntry = localEntries.find(local => local.transactionHash === entry.transactionHash);
                if (localEntry?.encryptionData) {
                  decryptedContent = await encryptionService.decryptData(
                    {
                      encryptedData: entry.encryptedContent,
                      encryptionKey: localEntry.encryptionData.encryptionKey,
                      signature: localEntry.encryptionData.signature
                    },
                    userId,
                    signer
                  );
                }
              } catch (decryptError) {
                console.warn('Failed to decrypt entry:', decryptError);
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

          // Merge with local entries (blockchain takes precedence)
          const mergedEntries = [...decryptedEntries];
          localEntries.forEach(localEntry => {
            if (!decryptedEntries.find(blockchain => blockchain.transactionHash === localEntry.transactionHash)) {
              mergedEntries.push({
                id: localEntry.id,
                date: localEntry.date,
                content: localEntry.content,
                sentiment: localEntry.sentiment,
                encrypted: localEntry.encrypted,
                transactionHash: localEntry.transactionHash,
                blockchainStored: localEntry.blockchainStored
              });
            }
          });

          // Sort by date (newest first)
          mergedEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          setEntries(mergedEntries);

        } catch (blockchainError) {
          console.warn('Failed to load from blockchain:', blockchainError);
          // Continue with local entries
        }
      }
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to load entries';
      console.error('Failed to load entries:', error);
      
      // Fallback to mock data if everything fails
      setEntries([
        {
          id: '1',
          date: '2025-01-10',
          content: 'Today was challenging but I learned something new about myself...',
          sentiment: 'neutral',
          encrypted: true,
          blockchainStored: false
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const syncPendingEntries = async (): Promise<{ success: boolean; synced: number; error?: string }> => {
    if (!isConnected || !isOnline) {
      return { success: false, synced: 0, error: 'Not connected or offline' };
    }

    try {
      const unsyncedEntries = localStorageService.getUnsyncedEntries(userAddress);
      let syncedCount = 0;

      for (const entry of unsyncedEntries) {
        try {
          if (entry.encryptionData) {
            const transactionHash = await jscService.writeEntry(
              entry.encryptionData.encryptedData,
              entry.sentiment
            );

            localStorageService.markAsSynced(entry.id, userAddress, transactionHash);
            syncedCount++;
          }
        } catch (error) {
          console.error(`Failed to sync entry ${entry.id}:`, error);
        }
      }

      if (syncedCount > 0) {
        await loadEntries(userAddress);
        await updateBalance();
      }

      return { success: true, synced: syncedCount };
    } catch (error: any) {
      return { success: false, synced: 0, error: error.message };
    }
  };

  const getGlobalSentiment = async () => {
    try {
      if (isOnline) {
        return await jscService.getGlobalSentiment();
      } else {
        // Return cached or default data when offline
        return { positive: 64, negative: 25, neutral: 11 };
      }
    } catch (error) {
      console.error('Failed to get global sentiment:', error);
      return { positive: 64, negative: 25, neutral: 11 };
    }
  };

  const getAvailableProviders = () => {
    return walletService.getAvailableProviders();
  };

  const getUnsyncedCount = () => {
    if (!userAddress) return 0;
    return localStorageService.getUnsyncedEntries(userAddress).length;
  };

  return {
    isConnected,
    isLoading,
    entries,
    userAddress,
    networkInfo,
    balance,
    error,
    isOnline,
    connectWallet,
    handleDisconnect,
    submitEntry,
    loadEntries,
    syncPendingEntries,
    getGlobalSentiment,
    getAvailableProviders,
    getUnsyncedCount,
    clearError: () => setError('')
  };
};