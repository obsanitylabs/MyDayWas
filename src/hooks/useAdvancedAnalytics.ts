import { useState, useEffect } from 'react';
import { analyticsService, EmotionalMetrics, TrendAnalysis } from '../services/analyticsService';

export interface AnalyticsData {
  currentMetrics: EmotionalMetrics | null;
  trendAnalysis: TrendAnalysis | null;
  insights: string[];
  isAnalyzing: boolean;
}

export const useAdvancedAnalytics = () => {
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData>({
    currentMetrics: null,
    trendAnalysis: null,
    insights: [],
    isAnalyzing: false
  });

  const [entryHistory, setEntryHistory] = useState<EmotionalMetrics[]>([]);

  const analyzeEntry = async (text: string): Promise<EmotionalMetrics> => {
    setAnalyticsData(prev => ({ ...prev, isAnalyzing: true }));

    try {
      if (!text || text.trim().length === 0) {
        throw new Error('No text provided for analysis');
      }
      
      // Simulate processing time for better UX
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const metrics = analyticsService.analyzeEntry(text);
      const insights = analyticsService.generateInsights(metrics);
      
      // Update history
      const newHistory = [...entryHistory, metrics].slice(-30); // Keep last 30 entries
      setEntryHistory(newHistory);
      
      // Generate trend analysis
      const trendAnalysis = analyticsService.analyzeTrends(newHistory);
      
      setAnalyticsData({
        currentMetrics: metrics,
        trendAnalysis,
        insights,
        isAnalyzing: false
      });

      return metrics;
    } catch (error) {
      console.error('Analytics failed:', error);
      setAnalyticsData(prev => ({ ...prev, isAnalyzing: false }));
      throw error;
    }
        insights: [`Analysis failed: ${error?.message || 'Unknown error'}`]
  }

  const getPersonalityInsights = () => {
    if (!analyticsData.currentMetrics) return null;

    const traits = analyticsData.currentMetrics.personalityTraits;
    const insights = [];

    if (traits.openness > 0.6) insights.push('High openness - you\'re creative and curious');
    if (traits.conscientiousness > 0.6) insights.push('High conscientiousness - you\'re organized and goal-oriented');
    if (traits.extraversion > 0.6) insights.push('High extraversion - you\'re social and energetic');
    if (traits.agreeableness > 0.6) insights.push('High agreeableness - you\'re cooperative and trusting');
    if (traits.neuroticism > 0.6) insights.push('Elevated stress levels - consider relaxation techniques');

    return insights;
  };

  const getEmotionalBreakdown = () => {
    if (!analyticsData.currentMetrics) return null;

    const emotions = analyticsData.currentMetrics.emotions;
    return Object.entries(emotions)
      .filter(([_, value]) => value > 0.2)
      .sort((a, b) => b[1] - a[1])
      .map(([emotion, intensity]) => ({
        emotion: emotion.charAt(0).toUpperCase() + emotion.slice(1),
        intensity: Math.round(intensity * 100),
        color: getEmotionColor(emotion)
      }));
  };

  const getMoodTrendDescription = () => {
    if (!analyticsData.trendAnalysis) return 'Not enough data';

    const { moodTrend, averageSentiment } = analyticsData.trendAnalysis;
    
    if (moodTrend === 'improving') {
      return '📈 Your mood has been improving recently';
    } else if (moodTrend === 'declining') {
      return '📉 Your mood has been declining - consider self-care';
    } else {
      return averageSentiment > 0 ? '😊 Your mood has been stable and positive' : '😐 Your mood has been stable';
    }
  };

  const getRiskAssessment = () => {
    if (!analyticsData.trendAnalysis) return { level: 'low', factors: [] };

    const { riskFactors, averageSentiment, emotionalVolatility } = analyticsData.trendAnalysis;
    
    let level: 'low' | 'medium' | 'high' = 'low';
    
    if (riskFactors.length >= 3 || averageSentiment < -0.5) {
      level = 'high';
    } else if (riskFactors.length >= 1 || emotionalVolatility > 0.5) {
      level = 'medium';
    }

    return { level, factors: riskFactors };
  };

  const clearHistory = () => {
    setEntryHistory([]);
    setAnalyticsData({
      currentMetrics: null,
      trendAnalysis: null,
      insights: [],
      isAnalyzing: false
    });
  };

  return {
    analyticsData,
    analyzeEntry,
    getPersonalityInsights,
    getEmotionalBreakdown,
    getMoodTrendDescription,
    getRiskAssessment,
    clearHistory,
    hasData: entryHistory.length > 0
  };
};

function getEmotionColor(emotion: string): string {
  const colors = {
    joy: '#10B981',      // Green
    sadness: '#3B82F6',  // Blue
    anger: '#EF4444',    // Red
    fear: '#8B5CF6',     // Purple
    surprise: '#F59E0B', // Amber
    disgust: '#6B7280',  // Gray
    trust: '#06B6D4',    // Cyan
    anticipation: '#EC4899' // Pink
  };
  
  return colors[emotion] || '#6B7280';
}