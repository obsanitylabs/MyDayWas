import React from 'react';
import { Brain, TrendingUp, Heart, AlertTriangle, Target, Lightbulb } from 'lucide-react';
import { useAdvancedAnalytics } from '../hooks/useAdvancedAnalytics';

interface AnalyticsPanelProps {
  text: string;
  onAnalyze?: (metrics: any) => void;
}

export const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({ text, onAnalyze }) => {
  const {
    analyticsData,
    analyzeEntry,
    getPersonalityInsights,
    getEmotionalBreakdown,
    getMoodTrendDescription,
    getRiskAssessment,
    hasData
  } = useAdvancedAnalytics();

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    
    try {
      const metrics = await analyzeEntry(text);
      onAnalyze?.(metrics);
    } catch (error) {
      console.error('Analysis failed:', error);
    }
  };

  const emotionalBreakdown = getEmotionalBreakdown();
  const personalityInsights = getPersonalityInsights();
  const riskAssessment = getRiskAssessment();

  if (!analyticsData.currentMetrics && !analyticsData.isAnalyzing) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <div className="text-center">
          <Brain className="w-12 h-12 text-blue-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-800 mb-2">AI-Powered Analytics</h3>
          <p className="text-gray-600 mb-4">
            Get deep insights into your emotional patterns, personality traits, and mental wellness trends.
          </p>
          <button
            onClick={handleAnalyze}
            disabled={!text.trim()}
            className="bg-blue-600 text-white px-6 py-3 rounded-full font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-300"
          >
            Analyze My Entry
          </button>
        </div>
      </div>
    );
  }

  if (analyticsData.isAnalyzing) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">Analyzing Your Entry...</h3>
          <p className="text-gray-600">Processing emotional patterns and insights</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sentiment Overview */}
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-gray-800 flex items-center">
            <Heart className="w-6 h-6 text-red-500 mr-2" />
            Emotional Analysis
          </h3>
          <div className={`px-3 py-1 rounded-full text-sm font-medium ${
            analyticsData.currentMetrics?.sentiment.primary === 'positive' 
              ? 'bg-green-100 text-green-700'
              : analyticsData.currentMetrics?.sentiment.primary === 'negative'
              ? 'bg-red-100 text-red-700'
              : 'bg-gray-100 text-gray-700'
          }`}>
            {analyticsData.currentMetrics?.sentiment.primary}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <div className="text-sm text-gray-600 mb-1">Sentiment Score</div>
            <div className="text-2xl font-bold text-gray-800">
              {analyticsData.currentMetrics?.sentiment.score.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500">
              {analyticsData.currentMetrics?.sentiment.confidence && 
                `${Math.round(analyticsData.currentMetrics.sentiment.confidence * 100)}% confidence`
              }
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">Word Count</div>
            <div className="text-2xl font-bold text-gray-800">
              {analyticsData.currentMetrics?.wordCount}
            </div>
            <div className="text-xs text-gray-500">
              {analyticsData.currentMetrics?.readability.gradeLevel} reading level
            </div>
          </div>
        </div>

        {analyticsData.insights.length > 0 && (
          <div className="bg-blue-50 rounded-lg p-4">
            <h4 className="font-medium text-blue-800 mb-2 flex items-center">
              <Lightbulb className="w-4 h-4 mr-1" />
              Key Insights
            </h4>
            <ul className="space-y-1">
              {analyticsData.insights.map((insight, index) => (
                <li key={index} className="text-sm text-blue-700">• {insight}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Emotional Breakdown */}
      {emotionalBreakdown && emotionalBreakdown.length > 0 && (
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
            <Target className="w-6 h-6 text-purple-500 mr-2" />
            Emotional Breakdown
          </h3>
          <div className="space-y-3">
            {emotionalBreakdown.map(({ emotion, intensity, color }) => (
              <div key={emotion} className="flex items-center justify-between">
                <span className="text-gray-700 font-medium">{emotion}</span>
                <div className="flex items-center space-x-2">
                  <div className="w-24 bg-gray-200 rounded-full h-2">
                    <div
                      className="h-2 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${intensity}%`, 
                        backgroundColor: color 
                      }}
                    ></div>
                  </div>
                  <span className="text-sm text-gray-600 w-8">{intensity}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Personality Insights */}
      {personalityInsights && personalityInsights.length > 0 && (
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
            <Brain className="w-6 h-6 text-indigo-500 mr-2" />
            Personality Insights
          </h3>
          <div className="space-y-2">
            {personalityInsights.map((insight, index) => (
              <div key={index} className="flex items-start space-x-2">
                <div className="w-2 h-2 bg-indigo-500 rounded-full mt-2 flex-shrink-0"></div>
                <p className="text-gray-700">{insight}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trend Analysis */}
      {hasData && (
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
            <TrendingUp className="w-6 h-6 text-green-500 mr-2" />
            Mood Trends
          </h3>
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-gray-700">{getMoodTrendDescription()}</p>
            </div>
            
            {analyticsData.trendAnalysis?.commonThemes && analyticsData.trendAnalysis.commonThemes.length > 0 && (
              <div>
                <h4 className="font-medium text-gray-800 mb-2">Common Themes</h4>
                <div className="flex flex-wrap gap-2">
                  {analyticsData.trendAnalysis.commonThemes.map((theme, index) => (
                    <span key={index} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                      {theme}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {analyticsData.trendAnalysis?.suggestedActions && analyticsData.trendAnalysis.suggestedActions.length > 0 && (
              <div>
                <h4 className="font-medium text-gray-800 mb-2">Suggested Actions</h4>
                <ul className="space-y-1">
                  {analyticsData.trendAnalysis.suggestedActions.map((action, index) => (
                    <li key={index} className="text-sm text-gray-600 flex items-start space-x-2">
                      <span className="text-green-500 mt-0.5">✓</span>
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Risk Assessment */}
      {riskAssessment.level !== 'low' && (
        <div className="bg-white rounded-2xl shadow-lg p-6 border-l-4 border-yellow-400">
          <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
            <AlertTriangle className="w-6 h-6 text-yellow-500 mr-2" />
            Wellness Check
          </h3>
          <div className={`p-4 rounded-lg ${
            riskAssessment.level === 'high' ? 'bg-red-50' : 'bg-yellow-50'
          }`}>
            <p className={`font-medium mb-2 ${
              riskAssessment.level === 'high' ? 'text-red-800' : 'text-yellow-800'
            }`}>
              {riskAssessment.level === 'high' ? 'High Priority' : 'Attention Needed'}
            </p>
            {riskAssessment.factors.length > 0 && (
              <ul className="space-y-1">
                {riskAssessment.factors.map((factor, index) => (
                  <li key={index} className={`text-sm ${
                    riskAssessment.level === 'high' ? 'text-red-700' : 'text-yellow-700'
                  }`}>
                    • {factor}
                  </li>
                ))}
              </ul>
            )}
            <p className={`text-sm mt-3 ${
              riskAssessment.level === 'high' ? 'text-red-700' : 'text-yellow-700'
            }`}>
              Consider reaching out to a mental health professional or trusted friend.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};