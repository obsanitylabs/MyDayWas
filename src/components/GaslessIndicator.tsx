import React from 'react';
import { Fuel, Zap, AlertCircle } from 'lucide-react';

interface GaslessIndicatorProps {
  isAvailable: boolean;
  gasPoolBalance: string;
  isLoading: boolean;
  error?: string | null;
}

export const GaslessIndicator: React.FC<GaslessIndicatorProps> = ({
  isAvailable,
  gasPoolBalance,
  isLoading,
  error
}) => {
  if (isLoading) {
    return (
      <div className="flex items-center space-x-2 text-gray-500">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
        <span className="text-sm">Checking gas sponsorship...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center space-x-2 text-red-600">
        <AlertCircle className="w-4 h-4" />
        <span className="text-sm">Gas sponsorship unavailable</span>
      </div>
    );
  }

  if (!isAvailable) {
    return (
      <div className="flex items-center space-x-2 text-yellow-600">
        <Fuel className="w-4 h-4" />
        <span className="text-sm">Standard gas fees apply</span>
      </div>
    );
  }

  const poolBalance = parseFloat(gasPoolBalance);
  const isLowBalance = poolBalance < 0.1; // Less than 0.1 JETH

  return (
    <div className={`flex items-center space-x-2 ${
      isLowBalance ? 'text-yellow-600' : 'text-green-600'
    }`}>
      <Zap className="w-4 h-4" />
      <span className="text-sm">
        {isLowBalance ? 'Low gas pool' : 'Gas-free transactions'} 
        {poolBalance > 0 && ` (${poolBalance.toFixed(4)} JETH)`}
      </span>
    </div>
  );
};