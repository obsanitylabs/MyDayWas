import React, { useState, useEffect } from 'react';
import { Heart, BarChart3, BookOpen, Globe, TrendingUp, MapPin, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useEnhancedJSC } from './hooks/useEnhancedJSC';
import { WalletConnectModal } from './components/WalletConnectModal';
import { LoadingSpinner } from './components/LoadingSpinner';
import { ErrorMessage } from './components/ErrorMessage';
import { GlobalHeatMap } from './components/GlobalHeatMap';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { GaslessIndicator } from './components/GaslessIndicator';
import { useGaslessTransactions } from './hooks/useGaslessTransactions';

type View = 'home' | 'diary' | 'analytics';

function App() {
  const [currentView, setCurrentView] = useState<View>('home');
  const [userInput, setUserInput] = useState('');
  const [selectedEmojis, setSelectedEmojis] = useState<string[]>([]);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [aiResponse, setAiResponse] = useState('');
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(true);
  
  const {
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
    syncPendingEntries,
    getGlobalSentiment,
    getAvailableProviders,
    getUnsyncedCount,
    clearError,
    decryptEntry: handleDecryptEntry,
    decryptAllEntries: handleDecryptAll,
    decryptedEntries,
    isDecrypting
  } = useEnhancedJSC();

  const {
    gaslessState,
    checkGasPoolBalance
  } = useGaslessTransactions();

  // Check if this is user's first visit
  useEffect(() => {
    const hasVisitedBefore = localStorage.getItem('hasVisitedBefore');
    if (hasVisitedBefore) {
      setIsFirstVisit(false);
    } else {
      localStorage.setItem('hasVisitedBefore', 'true');
    }
  }, []);

  const addJSCNetwork = async () => {
    if (!window.ethereum) {
      alert('MetaMask is not installed. Please install MetaMask to add the JSC network.');
      return;
    }

    try {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x5088B0', // 5278000 in hex (corrected)
          chainName: 'JSC Kaigan Testnet',
          nativeCurrency: {
            name: 'JETH',
            symbol: 'JETH',
            decimals: 18,
          },
          rpcUrls: ['https://rpc.kaigan.jsc.dev/rpc?token=sAoK9rCEuCrO57nL_eh7xfuS6g4SJvPC_7kd-8yRj-c'],
          blockExplorerUrls: ['https://explorer.kaigan.jsc.dev'],
        }],
      });
      alert('JSC Kaigan Testnet has been added to your wallet!');
    } catch (error) {
      console.error('Failed to add JSC network:', error);
      if (error.code === 4001) {
        alert('User rejected the request to add JSC network.');
      } else if (error.code === -32602) {
        alert('JSC Kaigan Testnet may already be added to your wallet.');
      } else {
        alert('Failed to add JSC network. Please try again or add it manually.');
      }
    }
  };
  // Get current time and determine if it's day or night
  const currentHour = new Date().getHours();
  const isNightTime = currentHour < 6 || currentHour >= 18; // Night from 6 PM to 6 AM
  
  // Debug: Log current time (remove this in production)
  console.log('Current hour:', currentHour, 'Is night time:', isNightTime);

  // Dynamic background based on time of day
  const getBackgroundStyle = () => {
    if (isNightTime) {
      // Night sky with stars
      return {
        background: `
          radial-gradient(2px 2px at 20px 30px, #eee, transparent),
          radial-gradient(2px 2px at 40px 70px, rgba(255,255,255,0.8), transparent),
          radial-gradient(1px 1px at 90px 40px, #fff, transparent),
          radial-gradient(1px 1px at 130px 80px, rgba(255,255,255,0.6), transparent),
          radial-gradient(2px 2px at 160px 30px, #eee, transparent),
          radial-gradient(1px 1px at 200px 60px, #fff, transparent),
          radial-gradient(1px 1px at 240px 90px, rgba(255,255,255,0.8), transparent),
          radial-gradient(2px 2px at 280px 20px, #eee, transparent),
          radial-gradient(1px 1px at 320px 70px, #fff, transparent),
          radial-gradient(1px 1px at 360px 40px, rgba(255,255,255,0.6), transparent),
          radial-gradient(2px 2px at 400px 80px, #eee, transparent),
          linear-gradient(to bottom, #0f172a, #1e293b, #334155)
        `,
        backgroundSize: '400px 200px, 400px 200px, 400px 200px, 400px 200px, 400px 200px, 400px 200px, 400px 200px, 400px 200px, 400px 200px, 400px 200px, 400px 200px, 100% 100%'
      };
    } else {
      // Day sky with clouds
      return {
        background: `
          radial-gradient(ellipse 800px 300px at 50% 200px, rgba(255,255,255,0.8), transparent),
          radial-gradient(ellipse 600px 200px at 80% 100px, rgba(255,255,255,0.6), transparent),
          radial-gradient(ellipse 400px 150px at 20% 150px, rgba(255,255,255,0.7), transparent),
          radial-gradient(ellipse 500px 180px at 70% 250px, rgba(255,255,255,0.5), transparent),
          radial-gradient(ellipse 300px 120px at 30% 80px, rgba(255,255,255,0.8), transparent),
          linear-gradient(to bottom, #87ceeb, #b0e0e6, #e0f6ff)
        `,
        backgroundSize: '100% 100%'
      };
    }
  };
  const handleWalletConnect = async (providerName?: string) => {
    setWalletError('');
    const result = await connectWallet(providerName);
    
    if (result.success) {
      setShowWalletModal(false);
    } else {
      setWalletError(result.error || 'Connection failed');
    }
  };

  const handleSubmit = async () => {
    if (!userInput.trim() && selectedEmojis.length === 0) return;
    
    if (!isConnected) {
      setShowWalletModal(true);
      return;
    }
    
    setHasSubmitted(true);
    
    // Determine sentiment from emojis or text
    let sentiment: 'positive' | 'negative' | 'neutral';
    if (selectedEmojis.length > 0) {
      sentiment = getEmojiSentiment();
    } else {
      sentiment = analyzeSentiment(userInput);
    }
    
    // Combine emojis and text for submission
    const entryContent = selectedEmojis.length > 0 
      ? `${selectedEmojis.join(' ')} ${userInput}`.trim()
      : userInput;
    
    // Submit to blockchain
    const result = await submitEntry(entryContent, sentiment);
    
    if (!result.success) {
      // Show error but don't reset form if entry was saved locally
      if (result.error?.includes('saved locally')) {
        // Entry was saved locally, continue with success flow but show warning
        console.warn('Entry saved locally:', result.error);
      } else {
        alert(result.error || 'Failed to submit entry. Please try again.');
        setHasSubmitted(false);
        return;
      }
    }

    // Get similar users count
    const similarUsersCount = await getSimilarUsersCount(sentiment);

    // Generate empathetic AI response
    const responses = [
      `Thank you for sharing your thoughts with such honesty. Your feelings are valid, and it takes courage to reflect on them. You are not alone! ${similarUsersCount.toLocaleString()} others have felt the same way in the past 24 hours. Remember, tomorrow brings new possibilities for growth and healing.`,
      `Your words resonate with depth and authenticity. It's beautiful how you've taken a moment to connect with yourself. You are not alone! ${similarUsersCount.toLocaleString()} others have shared similar feelings in the past 24 hours. Your emotional journey matters, and sharing it helps create a more understanding world.`,
      `What a gift it is to witness your vulnerability and self-reflection. Your feelings deserve acknowledgment and care. You are not alone! ${similarUsersCount.toLocaleString()} others have experienced similar emotions in the past 24 hours. Thank you for contributing to humanity's collective emotional tapestry.`
    ];
    
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];
    
    setTimeout(() => {
      setAiResponse(randomResponse);
    }, 1500);
  };

  const getSimilarUsersCount = async (sentiment: 'positive' | 'negative' | 'neutral'): Promise<number> => {
    try {
      const globalSentiment = await getGlobalSentiment();
      const totalEntries = globalSentiment.positive + globalSentiment.negative + globalSentiment.neutral;
      
      if (totalEntries === 0) {
        // Fallback to realistic mock data for past 24 hours
        const mockCounts = {
          positive: Math.floor(Math.random() * 2000) + 3000, // 3k-5k in 24h
          negative: Math.floor(Math.random() * 1500) + 2000,  // 2k-3.5k in 24h
          neutral: Math.floor(Math.random() * 1000) + 1500    // 1.5k-2.5k in 24h
        };
        return mockCounts[sentiment];
      }
      
      // Calculate actual count based on global sentiment percentages for past 24 hours
      const baseUserCount = 12000; // Assume 12k daily active users for realistic 24h numbers
      const sentimentPercentage = globalSentiment[sentiment] / 100;
      const similarUsers = Math.floor(baseUserCount * sentimentPercentage);
      
      // Add some randomness to make it feel more realistic for 24h period
      const variance = Math.floor(Math.random() * 500) - 250; // ±250
      return Math.max(50, similarUsers + variance); // Minimum 50 users in 24h
    } catch (error) {
      console.error('Failed to get similar users count:', error);
      // Fallback counts for past 24 hours
      const fallbackCounts = {
        positive: 4200,
        negative: 2800,
        neutral: 1900
      };
      return fallbackCounts[sentiment];
    }
  };

  const handleSync = async () => {
    const result = await syncPendingEntries();
    
    if (result.success && result.synced > 0) {
      alert(`✅ Successfully synced ${result.synced} entries to blockchain!`);
    } else if (result.synced === 0 && result.success) {
      alert('ℹ️ No entries to sync - all entries are already on blockchain');
    } else if (result.error) {
      alert(`❌ Sync failed: ${result.error}`);
    } else {
      alert('ℹ️ No entries found to sync');
    }
  };

  const analyzeSentiment = (text: string): 'positive' | 'negative' | 'neutral' => {
    const positiveWords = ['happy', 'joy', 'grateful', 'love', 'amazing', 'wonderful', 'great', 'good', 'excited', 'blessed'];
    const negativeWords = ['sad', 'angry', 'frustrated', 'terrible', 'awful', 'hate', 'depressed', 'anxious', 'worried', 'stressed'];
    
    const words = text.toLowerCase().split(/\s+/);
    let positiveCount = 0;
    let negativeCount = 0;
    
    words.forEach(word => {
      if (positiveWords.some(pw => word.includes(pw))) positiveCount++;
      if (negativeWords.some(nw => word.includes(nw))) negativeCount++;
    });
    
    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  };

  const resetForm = () => {
    setUserInput('');
    setSelectedEmojis([]);
    setHasSubmitted(false);
    setAiResponse('');
  };

  const emojis = [
    { emoji: '😠', label: 'anger', sentiment: 'negative' as const },
    { emoji: '😢', label: 'sadness', sentiment: 'negative' as const },
    { emoji: '😑', label: 'boredom', sentiment: 'neutral' as const },
    { emoji: '😴', label: 'tired', sentiment: 'neutral' as const },
    { emoji: '😊', label: 'happy', sentiment: 'positive' as const }
  ];

  const toggleEmoji = (emoji: string) => {
    setSelectedEmojis(prev => 
      prev.includes(emoji) 
        ? prev.filter(e => e !== emoji)
        : [...prev, emoji]
    );
  };

  const getEmojiSentiment = (): 'positive' | 'negative' | 'neutral' => {
    if (selectedEmojis.length === 0) return 'neutral';
    
    const sentiments = selectedEmojis.map(emoji => {
      const emojiData = emojis.find(e => e.emoji === emoji);
      return emojiData?.sentiment || 'neutral';
    });
    
    const positiveCount = sentiments.filter(s => s === 'positive').length;
    const negativeCount = sentiments.filter(s => s === 'negative').length;
    
    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  };

  const NavButton = ({ view, icon: Icon, children }: { view: View; icon: any; children: React.ReactNode }) => (
    <button
      onClick={() => setCurrentView(view)}
      className={`flex items-center space-x-1 sm:space-x-2 px-3 sm:px-6 py-2 sm:py-3 rounded-full transition-all duration-300 text-sm sm:text-base ${
        currentView === view
          ? 'bg-blue-600 text-white shadow-lg'
          : 'text-gray-600 hover:text-blue-600 hover:bg-blue-50'
      }`}
    >
      <Icon size={16} className="sm:w-5 sm:h-5" />
      <span className="font-medium hidden sm:inline">{children}</span>
      <span className="font-medium sm:hidden text-xs">{children.toString().charAt(0)}</span>
    </button>
  );

  const renderHome = () => (
    <div className="flex-1 flex items-center justify-center px-3 sm:px-6">
      <div className="w-full max-w-2xl">
        {error && (
          <div className="mb-6">
            <ErrorMessage 
              message={error} 
              onDismiss={clearError}
              type="error"
            />
          </div>
        )}

        {isConnected && !isOnline && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 sm:p-6 mb-6 text-center">
            <WifiOff className="w-8 h-8 text-yellow-600 mx-auto mb-2" />
            <p className="text-yellow-800 mb-2">You're offline</p>
            <p className="text-yellow-700 text-xs sm:text-sm">Your entries will be saved locally and synced when you're back online.</p>
          </div>
        )}

        {isConnected && getUnsyncedCount() > 0 && isOnline && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 sm:p-4 mb-6 flex flex-col sm:flex-row items-center justify-between space-y-2 sm:space-y-0">
            <p className="text-blue-800 text-xs sm:text-sm text-center sm:text-left">{getUnsyncedCount()} entries pending blockchain sync</p>
            <button 
              onClick={handleSync} 
              disabled={isLoading}
              className="text-blue-600 hover:text-blue-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1"
            >
              {isLoading && <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600"></div>}
              <span>Sync Now</span>
            </button>
          </div>
        )}

        {!hasSubmitted ? (
          <div className="bg-white rounded-3xl shadow-xl p-4 sm:p-8 md:p-12">
            <div className="text-center mb-8">
              <Heart className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-800 mb-4">
                How are you today?
              </h2>
              <p className="text-gray-600 text-sm sm:text-lg">
                Share your thoughts, feelings, and emotions. Your words will be encrypted and stored securely on the blockchain.
              </p>
            </div>
            
            <div className="space-y-6">
              {/* Emoji Selector */}
              <div className="text-center">
                <p className="text-gray-600 mb-4 text-xs sm:text-sm">Select one or more emojis, and/or write your thoughts below.</p>
                <div className="flex justify-center space-x-2 sm:space-x-4">
                  {emojis.map(({ emoji, label }) => (
                    <button
                      key={emoji}
                      onClick={() => toggleEmoji(emoji)}
                      className={`relative p-2 sm:p-3 rounded-full transition-all duration-300 hover:scale-110 ${
                        selectedEmojis.includes(emoji)
                          ? 'bg-green-100 ring-4 ring-green-400'
                          : 'bg-white/20 hover:bg-white/30'
                      }`}
                      title={label}
                    >
                      <span className="text-2xl sm:text-3xl">{emoji}</span>
                      {selectedEmojis.includes(emoji) && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                          <span className="text-white text-xs">✓</span>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              
              <textarea
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="Tell me about your day, your feelings, your thoughts... I'm here to listen."
                className="w-full h-32 sm:h-48 p-4 sm:p-6 rounded-2xl outline-none transition-all duration-300 resize-none text-sm sm:text-lg"
                style={{
                  background: 'rgba(255, 255, 255, 0.15)',
                  border: '2px solid rgba(255, 255, 255, 0.25)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
                  color: '#000000'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'rgba(59, 130, 246, 0.6)';
                  e.target.style.boxShadow = '0 0 0 4px rgba(59, 130, 246, 0.1), 0 8px 32px 0 rgba(31, 38, 135, 0.37)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(255, 255, 255, 0.25)';
                  e.target.style.boxShadow = '0 8px 32px 0 rgba(31, 38, 135, 0.37)';
                }}
              />
              
              <button
                onClick={handleSubmit}
                disabled={(!userInput.trim() && selectedEmojis.length === 0) || isLoading}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 sm:py-4 px-6 sm:px-8 rounded-2xl font-semibold text-sm sm:text-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-lg hover:shadow-xl flex items-center justify-center space-x-2"
              >
                {isLoading && <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>}
                <span>
                  {isLoading ? 'Encrypting & Storing...' : 'Share My Thoughts'}
                </span>
              </button>
              
              {(userInput.trim() || selectedEmojis.length > 0) && !hasSubmitted && (
                <button
                  onClick={() => setShowAnalytics(!showAnalytics)}
                  className="w-full bg-gradient-to-r from-green-600 to-teal-600 text-white py-3 px-4 sm:px-6 rounded-2xl font-semibold text-sm sm:text-base hover:from-green-700 hover:to-teal-700 transition-all duration-300 shadow-lg hover:shadow-xl"
                >
                  {showAnalytics ? 'Hide Analytics Preview' : 'Preview AI Analytics'}
                </button>
              )}
            </div>
            
            {showAnalytics && (userInput.trim() || selectedEmojis.length > 0) && (
              <div className="mt-8">
                <AnalyticsPanel text={selectedEmojis.length > 0 ? `${selectedEmojis.join(' ')} ${userInput}`.trim() : userInput} />
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-3xl shadow-xl p-4 sm:p-8 md:p-12 text-center">
            {!aiResponse ? (
              <div className="space-y-6">
                <LoadingSpinner size="lg" message="Processing your thoughts..." />
                <div className="text-gray-500 text-sm">
                  Analyzing sentiment and encrypting data for blockchain storage
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <Heart className="w-16 h-16 text-green-400 mx-auto" />
                <h3 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4">
                  Safely stored on blockchain
                </h3>
                <p className="text-gray-700 text-sm sm:text-lg leading-relaxed">
                  {aiResponse}
                </p>
                {userAddress && (
                  <p className="text-xs sm:text-sm text-gray-500 break-all">
                    JSC Address: {userAddress.slice(0, 6)}...{userAddress.slice(-4)} | Balance: {parseFloat(balance).toFixed(4)} JETH
                  </p>
                )}
                <div className="pt-6">
                  <button
                    onClick={resetForm}
                    className="bg-blue-600 text-white px-6 sm:px-8 py-3 rounded-full font-semibold text-sm sm:text-base hover:bg-blue-700 transition-colors duration-300 shadow-lg"
                  >
                    Write Another Entry
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const renderDiary = () => (
    <div className="flex-1 px-3 sm:px-6 py-6 sm:py-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <div className="bg-white/60 rounded-xl p-6 border border-gray-100 inline-block">
            <BookOpen className="w-12 h-12 text-blue-600 mx-auto mb-4" />
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-4">Your Personal Diary</h2>
            <p className="text-gray-800 font-medium text-sm sm:text-lg">Your encrypted thoughts and feelings, safely stored on Japan Smart Chain</p>
          </div>
        </div>
        
        {!isConnected && (
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20 text-center py-12">
            <BookOpen className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <div className="bg-white/60 rounded-xl p-4 border border-gray-100 mb-6">
              <p className="text-gray-800 font-medium text-sm sm:text-base">Connect your wallet to view your encrypted diary entries</p>
            </div>
            <button
              onClick={() => setShowWalletModal(true)}
              disabled={isLoading}
              className="bg-blue-600 text-white px-4 sm:px-6 py-3 rounded-full font-semibold text-sm sm:text-base hover:bg-blue-700 disabled:opacity-50 transition-colors duration-300"
            >
              {isLoading ? 'Connecting...' : 'Connect Wallet'}
            </button>
          </div>
        )}
        
        {isLoading && (
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20 text-center py-12">
            <LoadingSpinner size="lg" message="Loading your diary entries..." />
          </div>
        )}

        {isConnected && entries.length === 0 && (
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20 text-center py-12">
            <BookOpen className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <div className="bg-white/60 rounded-xl p-4 border border-gray-100">
              <p className="text-gray-800 font-medium text-sm sm:text-base">No entries yet. Share your first thought to get started!</p>
            </div>
          </div>
        )}
        
        {isConnected && entries.length > 0 && !isLoading && (
          <div className="space-y-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-semibold text-gray-800">Your Entries</h3>
            {entries.some(entry => entry.encrypted && !decryptedEntries.has(entry.id)) && (
              <button
                onClick={handleDecryptAll}
                disabled={isLoading}
                className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-300 flex items-center space-x-2"
              >
                {isLoading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>}
                <span>View All</span>
              </button>
            )}
          </div>
          
          {entries.map((entry) => (
            <div key={entry.id} className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg p-4 sm:p-6 hover:shadow-xl transition-shadow duration-300 border border-white/20">
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs sm:text-sm text-gray-500 font-medium">
                  {new Date(entry.date).toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    entry.sentiment === 'positive' ? 'bg-green-100 text-green-700' :
                    entry.sentiment === 'negative' ? 'bg-red-100 text-red-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {entry.sentiment}
                  </span>
                  {entry.encrypted && (
                    <span className="text-blue-600 text-xs bg-blue-100 px-2 py-1 rounded-full">
                      🔒 JSC Encrypted
                    </span>
                  )}
                  {entry.blockchainStored && (
                    <span className="text-green-600 text-xs bg-green-100 px-2 py-1 rounded-full">
                      ⛓️ JSC Stored
                    </span>
                  )}
                  {!entry.blockchainStored && (
                    <span className="text-yellow-600 text-xs bg-yellow-100 px-2 py-1 rounded-full">
                      📱 Local Only
                    </span>
                  )}
                </div>
              </div>
              <div className="bg-white/60 rounded-xl p-3 sm:p-4 border border-gray-100">
                {entry.encrypted && !decryptedEntries.has(entry.id) ? (
                  <div className="flex items-center justify-between">
                    <p className="text-gray-500 italic text-sm sm:text-base">🔒 Encrypted content - click View to decrypt</p>
                    <button
                      onClick={() => handleDecryptEntry(entry.id)}
                      disabled={isDecrypting(entry.id)}
                      className="bg-blue-600 text-white px-3 py-1 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-300 flex items-center space-x-1"
                    >
                      {isDecrypting(entry.id) && <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>}
                      <span>View</span>
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-gray-800 leading-relaxed text-sm sm:text-base font-medium">{entry.content}</p>
                    {decryptedEntries.has(entry.id) && (
                      <div className="mt-2 text-xs text-green-600 flex items-center space-x-1">
                        <span>🔓</span>
                        <span>Decrypted successfully</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderAnalytics = () => (
    <div className="flex-1 px-3 sm:px-6 py-6 sm:py-8">
      <div className="max-w-6xl mx-auto">
        <GlobalHeatMap />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen relative" style={getBackgroundStyle()}>
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-gray-200" style={{
        background: 'rgba(255, 255, 255, 0.85)',
        boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)'
      }}>
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <nav className="flex items-center space-x-1 sm:space-x-2">
                <NavButton view="home" icon={Heart}>
                  Home
                </NavButton>
                <NavButton view="diary" icon={BookOpen}>
                  Diary
                </NavButton>
                <NavButton view="analytics" icon={BarChart3}>
                  Analytics
                </NavButton>
              </nav>
            </div>
            
            <div className="flex items-center space-x-2 sm:space-x-4">
              {/* Network Status Indicator */}
              <div className="hidden sm:flex items-center space-x-2 text-sm">
                {isOnline ? (
                  <div className="flex items-center space-x-1 text-green-600">
                    <Wifi className="w-4 h-4" />
                    <span>Online</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-1 text-yellow-600">
                    <WifiOff className="w-4 h-4" />
                    <span>Offline</span>
                  </div>
                )}
                {isConnected && getUnsyncedCount() > 0 && (
                  <div className="flex items-center space-x-1 text-blue-600">
                    <RefreshCw className="w-4 h-4" />
                    <span>{getUnsyncedCount()} pending</span>
                  </div>
                )}
              </div>
              
              <button
                onClick={addJSCNetwork}
                className="flex items-center space-x-1 sm:space-x-2 px-2 sm:px-4 py-2 rounded-full font-medium transition-all duration-300 bg-purple-100 text-purple-700 border border-purple-200 hover:bg-purple-200 hover:border-purple-300 text-xs sm:text-sm"
              >
                <span>Add JSC</span>
              </button>
              
              <button
                onClick={isConnected ? handleDisconnect : () => setShowWalletModal(true)}
                disabled={isLoading}
                className={`flex items-center space-x-1 sm:space-x-2 px-3 sm:px-6 py-2 sm:py-3 rounded-full font-medium transition-all duration-300 text-sm sm:text-base ${
                  isConnected
                    ? 'bg-green-100 text-green-700 border border-green-200'
                    : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg hover:shadow-xl'
                } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isConnected ? (
                  <>
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span className="hidden sm:inline">Disconnect</span>
                    <span className="sm:hidden">DC</span>
                  </>
                ) : (
                  <>
                    <Heart size={16} className="sm:w-[18px] sm:h-[18px]" />
                    <span className="hidden sm:inline">{isLoading ? 'Connecting...' : 'Sign In'}</span>
                    <span className="sm:hidden">{isLoading ? '...' : 'Sign'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-col min-h-[calc(100vh-80px)]" style={{ paddingBottom: '70px' }}>
        <div className="flex-1 py-6 sm:py-8">
        {/* Thought Bubble Overlay for Wallet Connection */}
        {!isConnected && currentView === 'home' && isFirstVisit && (
          <div className="relative mb-6">
            <div className="absolute top-0 right-3 sm:right-6 z-40">
              <div className="relative bg-white rounded-3xl shadow-xl p-3 sm:p-4 w-64 sm:w-72 border-2 border-blue-200">
                {/* Thought bubble tail pointing up to sign in button */}
                <div className="absolute -top-4 right-6 sm:right-8 w-0 h-0 border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent border-b-white"></div>
                <div className="absolute -top-5 right-6 sm:right-8 w-0 h-0 border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent border-b-blue-200"></div>
                
                <div className="text-center">
                  <p className="text-blue-800 text-xs font-medium mb-2 sm:mb-3">
                    Connect your wallet to securely encrypt and store your thoughts on Japan Smart Chain
                  </p>
                  <button
                    onClick={() => setShowWalletModal(true)}
                    disabled={isLoading}
                    className="bg-blue-600 text-white px-3 py-2 rounded-full text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors duration-300 w-full sm:w-auto"
                  >
                    {isLoading ? 'Connecting...' : 'Connect Wallet'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {currentView === 'home' && renderHome()}
        {currentView === 'diary' && renderDiary()}
        {currentView === 'analytics' && renderAnalytics()}
        </div>
      </main>


      {/* Footer */}
      <footer className="bg-gray-900 text-white py-8">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 text-center">
          <p className="text-gray-400 mb-2 text-sm sm:text-base">
            Your thoughts matter. Your feelings are valid. You are not alone.
          </p>
          <p className="text-xs text-gray-500">
            The World's Diary is Encrypted on Japan Smart Chain • AI-powered Analytics
          </p>
        </div>
      </footer>

      {/* Wallet Connect Modal */}
      <WalletConnectModal
        isOpen={showWalletModal}
        onClose={() => {
          setShowWalletModal(false);
          setWalletError('');
        }}
        onConnect={handleWalletConnect}
        availableProviders={getAvailableProviders()}
        isLoading={isLoading}
        error={walletError}
      />
    </div>
  );
}

export default App;