/**
 * Local Storage Service
 * Handles offline data persistence and synchronization
 */

export interface LocalDiaryEntry {
  id: string;
  date: string;
  content: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  encrypted: boolean;
  transactionHash?: string;
  blockchainStored: boolean;
  encryptionData?: {
    encryptedContent: string;
    encryptionKey: string;
    signature: string;
    timestamp: number;
  };
  createdAt: number;
  syncedAt?: number;
}

class LocalStorageService {
  private readonly ENTRIES_KEY = 'diary_entries';
  private readonly USER_KEY = 'user_data';
  private readonly SYNC_KEY = 'sync_status';

  saveEntry(entry: LocalDiaryEntry, userAddress: string): void {
    try {
      if (!entry || !userAddress) {
        throw new Error('Invalid entry or user address');
      }
      
      const entries = this.getEntries(userAddress);
      entries.unshift(entry);
      
      const storageKey = `${this.ENTRIES_KEY}_${userAddress}`;
      localStorage.setItem(storageKey, JSON.stringify(entries));
      
      this.updateSyncStatus(userAddress, { lastSave: Date.now() });
    } catch (error) {
      console.error('Failed to save entry to local storage:', error);
      // Don't throw here to prevent breaking the app
    }
  }

  getEntries(userAddress: string): LocalDiaryEntry[] {
    try {
      const storageKey = `${this.ENTRIES_KEY}_${userAddress}`;
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to load entries from local storage:', error);
      return [];
    }
  }

  updateEntry(entryId: string, updates: Partial<LocalDiaryEntry>, userAddress: string): void {
    try {
      const entries = this.getEntries(userAddress);
      const index = entries.findIndex(entry => entry.id === entryId);
      
      if (index !== -1) {
        entries[index] = { ...entries[index], ...updates };
        const storageKey = `${this.ENTRIES_KEY}_${userAddress}`;
        localStorage.setItem(storageKey, JSON.stringify(entries));
      }
    } catch (error) {
      console.error('Failed to update entry in local storage:', error);
    }
  }

  deleteEntry(entryId: string, userAddress: string): void {
    try {
      const entries = this.getEntries(userAddress);
      const filtered = entries.filter(entry => entry.id !== entryId);
      
      const storageKey = `${this.ENTRIES_KEY}_${userAddress}`;
      localStorage.setItem(storageKey, JSON.stringify(filtered));
    } catch (error) {
      console.error('Failed to delete entry from local storage:', error);
    }
  }

  saveUserData(userAddress: string, data: any): void {
    try {
      const storageKey = `${this.USER_KEY}_${userAddress}`;
      localStorage.setItem(storageKey, JSON.stringify({
        ...data,
        lastUpdated: Date.now()
      }));
    } catch (error) {
      console.error('Failed to save user data:', error);
    }
  }

  getUserData(userAddress: string): any {
    try {
      const storageKey = `${this.USER_KEY}_${userAddress}`;
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      console.error('Failed to load user data:', error);
      return null;
    }
  }

  updateSyncStatus(userAddress: string, status: any): void {
    try {
      const storageKey = `${this.SYNC_KEY}_${userAddress}`;
      const current = this.getSyncStatus(userAddress);
      localStorage.setItem(storageKey, JSON.stringify({
        ...current,
        ...status,
        lastUpdated: Date.now()
      }));
    } catch (error) {
      console.error('Failed to update sync status:', error);
    }
  }

  getSyncStatus(userAddress: string): any {
    try {
      const storageKey = `${this.SYNC_KEY}_${userAddress}`;
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : { lastSync: 0, pendingSync: [] };
    } catch (error) {
      console.error('Failed to load sync status:', error);
      return { lastSync: 0, pendingSync: [] };
    }
  }

  getUnsyncedEntries(userAddress: string): LocalDiaryEntry[] {
    const entries = this.getEntries(userAddress);
    return entries.filter(entry => !entry.blockchainStored);
  }

  markAsSynced(entryId: string, userAddress: string, transactionHash: string): void {
    this.updateEntry(entryId, {
      blockchainStored: true,
      transactionHash,
      syncedAt: Date.now()
    }, userAddress);
  }

  clearUserData(userAddress: string): void {
    try {
      localStorage.removeItem(`${this.ENTRIES_KEY}_${userAddress}`);
      localStorage.removeItem(`${this.USER_KEY}_${userAddress}`);
      localStorage.removeItem(`${this.SYNC_KEY}_${userAddress}`);
    } catch (error) {
      console.error('Failed to clear user data:', error);
    }
  }

  getStorageUsage(): { used: number; available: number } {
    try {
      let used = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key);
          if (value) {
            used += key.length + value.length;
          }
        }
      }
      
      // Estimate available space (5MB typical limit)
      const available = Math.max(0, 5 * 1024 * 1024 - used);
      
      return { used, available };
    } catch (error) {
      console.error('Failed to calculate storage usage:', error);
      return { used: 0, available: 0 };
    }
  }
}

export const localStorageService = new LocalStorageService();