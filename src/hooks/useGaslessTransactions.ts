import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { gaslessService } from '../services/gaslessService';

export interface GaslessState {
  isAvailable: boolean;
  isLoading: boolean;
  gasPoolBalance: string;
  error: string | null;
}

export const useGaslessTransactions = () => {
  const [gaslessState, setGaslessState] = useState<GaslessState>({
    isAvailable: false,
    isLoading: false,
    gasPoolBalance: '0',
    error: null
  });

  useEffect(() => {
    checkGaslessAvailability();
  }, []);

  const checkGaslessAvailability = async () => {
    setGaslessState(prev => ({ ...prev, isLoading: true }));
    
    try {
      // Initialize gasless service
      const provider = new ethers.BrowserProvider(window.ethereum);
      await gaslessService.initialize(provider, process.env.VITE_RELAYER_PRIVATE_KEY);
      
      const isAvailable = gaslessService.isGaslessAvailable();
      
      setGaslessState(prev => ({
        ...prev,
        isAvailable,
        isLoading: false,
        error: null
      }));
    } catch (error: any) {
      setGaslessState(prev => ({
        ...prev,
        isAvailable: false,
        isLoading: false,
        error: error.message
      }));
    }
  };

  const submitGaslessEntry = async (
    contractAddress: string,
    encryptedContent: string,
    sentiment: number,
    userSigner: ethers.Signer
  ): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    setGaslessState(prev => ({ ...prev, isLoading: true }));

    try {
      // Encode the function call
      const iface = new ethers.Interface([
        "function addEntryGasless(string memory _encryptedContent, uint8 _sentiment, uint256 _timestamp, address _user, uint256 _gasLimit) external returns (uint256)"
      ]);

      const userAddress = await userSigner.getAddress();
      const timestamp = Math.floor(Date.now() / 1000);
      const gasLimit = 200000;

      const data = iface.encodeFunctionData('addEntryGasless', [
        encryptedContent,
        sentiment,
        timestamp,
        userAddress,
        gasLimit
      ]);

      // Create gasless transaction
      const result = await gaslessService.createMetaTransaction(userSigner, {
        to: contractAddress,
        data,
        gas: gasLimit
      });

      setGaslessState(prev => ({ ...prev, isLoading: false }));
      return result;
    } catch (error: any) {
      setGaslessState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message
      }));
      return { success: false, error: error.message };
    }
  };

  const fundGasPool = async (
    contractAddress: string,
    amount: string,
    signer: ethers.Signer
  ): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    setGaslessState(prev => ({ ...prev, isLoading: true }));

    try {
      const result = await gaslessService.fundGasPool(contractAddress, amount, signer);
      setGaslessState(prev => ({ ...prev, isLoading: false }));
      return result;
    } catch (error: any) {
      setGaslessState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message
      }));
      return { success: false, error: error.message };
    }
  };

  const checkGasPoolBalance = async (contractAddress: string, provider: ethers.Provider) => {
    try {
      const contract = new ethers.Contract(contractAddress, [
        "function getGasPoolBalance() external view returns (uint256)"
      ], provider);

      const balance = await contract.getGasPoolBalance();
      const balanceInEth = ethers.formatEther(balance);

      setGaslessState(prev => ({
        ...prev,
        gasPoolBalance: balanceInEth
      }));
    } catch (error) {
      console.error('Failed to check gas pool balance:', error);
    }
  };

  return {
    gaslessState,
    submitGaslessEntry,
    fundGasPool,
    checkGasPoolBalance,
    refreshAvailability: checkGaslessAvailability
  };
};