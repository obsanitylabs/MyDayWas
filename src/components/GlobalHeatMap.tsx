import React, { useState, useEffect } from 'react';
import { Globe, Calendar, TrendingUp, Award, AlertTriangle, Info } from 'lucide-react';
import { globalAnalyticsService, HeatMapData, HistoricalRecord } from '../services/globalAnalyticsService';

export const GlobalHeatMap: React.FC = () => {
  const [heatMapData, setHeatMapData] = useState<HeatMapData | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [historicalRecords, setHistoricalRecords] = useState<HistoricalRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<HistoricalRecord | null>(null);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });

  useEffect(() => {
    loadData();
  }, [selectedDate]);

  useEffect(() => {
    // Set initial date to today if not set
    if (!selectedDate) {
      setSelectedDate(new Date().toISOString().split('T')[0]);
    }
  }, []);
  const loadData = () => {
    try {
      const heatMap = globalAnalyticsService.getGlobalHeatMap(selectedDate);
      const records = globalAnalyticsService.getHistoricalRecords();
      const range = globalAnalyticsService.getDateRange();
      
      setHeatMapData(heatMap);
      setHistoricalRecords(records);
      setDateRange(range);
    } catch (error) {
      console.error('Failed to load global analytics data:', error);
      // Set fallback data
      setHeatMapData({
        date: selectedDate,
        regions: {}
      });
      setHistoricalRecords([]);
      setDateRange({ start: '', end: '' });
    }
  };

  const getRegionStyle = (regionData: any) => {
    if (!regionData) return { backgroundColor: '#f3f4f6' };
    
    const alpha = Math.max(0.3, regionData.intensity);
    const color = regionData.color;
    
    return {
      backgroundColor: color,
      opacity: alpha,
      border: `2px solid ${color}`,
      borderOpacity: 0.8
    };
  };

  const getRecordIcon = (type: string) => {
    switch (type) {
      case 'best': return <Award className="w-5 h-5 text-green-600" />;
      case 'worst': return <AlertTriangle className="w-5 h-5 text-red-600" />;
      case 'most_volatile': return <TrendingUp className="w-5 h-5 text-orange-600" />;
      case 'most_peaceful': return <Info className="w-5 h-5 text-blue-600" />;
      default: return <Info className="w-5 h-5 text-gray-600" />;
    }
  };

  const getRecordColor = (type: string) => {
    switch (type) {
      case 'best': return 'bg-green-50 border-green-200';
      case 'worst': return 'bg-red-50 border-red-200';
      case 'most_volatile': return 'bg-orange-50 border-orange-200';
      case 'most_peaceful': return 'bg-blue-50 border-blue-200';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="bg-white/90 backdrop-blur-sm rounded-xl p-4 sm:p-6 border border-white/30 shadow-lg inline-block">
          <Globe className="w-12 h-12 text-blue-600 mx-auto mb-4" />
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Global Mental Health Heat Map</h2>
          <p className="text-gray-800 font-semibold text-sm sm:text-base">Real-time emotional landscape of humanity</p>
        </div>
      </div>

      {/* Date Selector */}
      <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg p-4 sm:p-6 border border-white/30">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center">
            <Calendar className="w-6 h-6 text-purple-500 mr-2" />
            Select Date (UTC)
          </h3>
          <div className="text-xs sm:text-sm text-gray-700 font-medium hidden sm:block bg-white/60 px-2 py-1 rounded-lg">
            Available: {dateRange.start} to {dateRange.end}
          </div>
        </div>
        
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          min={dateRange.start}
          max={dateRange.end}
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 font-medium"
        />
      </div>

      {/* Emotion Legend */}
      <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg p-4 sm:p-6 border border-white/30">
        <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-4">Emotion Color Guide</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-4 h-4 sm:w-6 sm:h-6 bg-red-500 rounded-full"></div>
            <span className="text-gray-900 text-sm sm:text-base font-medium">Anger</span>
          </div>
          <div className="flex items-center space-x-3">
            <div className="w-4 h-4 sm:w-6 sm:h-6 bg-yellow-500 rounded-full"></div>
            <span className="text-gray-900 text-sm sm:text-base font-medium">Calm</span>
          </div>
          <div className="flex items-center space-x-3">
            <div className="w-4 h-4 sm:w-6 sm:h-6 bg-green-500 rounded-full"></div>
            <span className="text-gray-900 text-sm sm:text-base font-medium">Harmony</span>
          </div>
          <div className="flex items-center space-x-3">
            <div className="w-4 h-4 sm:w-6 sm:h-6 bg-blue-500 rounded-full"></div>
            <span className="text-gray-900 text-sm sm:text-base font-medium">Happy</span>
          </div>
        </div>
        <p className="text-xs sm:text-sm text-gray-700 mt-3 font-medium bg-white/60 px-2 py-1 rounded-lg inline-block">
          Intensity shown by opacity • Darker = stronger emotion
        </p>
      </div>

      {/* Heat Map */}
      {heatMapData && (
        <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg p-4 sm:p-6 border border-white/30">
          <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-6">
            Global Mood on {new Date(selectedDate).toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {Object.entries(heatMapData.regions).map(([region, data]) => (
              <div
                key={region}
                className="p-3 sm:p-4 rounded-xl border-2 transition-all duration-300 hover:scale-105 cursor-pointer"
                style={getRegionStyle(data)}
              >
                <div className="text-white font-semibold mb-2 drop-shadow-lg text-sm sm:text-base">
                  {region}
                </div>
                <div className="text-white text-xs sm:text-sm drop-shadow">
                  <div>Emotion: {data.dominantEmotion}</div>
                  <div>Sentiment: {data.sentiment.toFixed(2)}</div>
                  <div>Intensity: {Math.round(data.intensity * 100)}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Historical Records */}
      <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg p-4 sm:p-6 border border-white/30">
        <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-6">Historical Records</h3>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {historicalRecords.map((record, index) => (
            <div
              key={index}
              className={`p-3 sm:p-4 rounded-xl border-2 cursor-pointer transition-all duration-300 hover:shadow-md ${getRecordColor(record.type)}`}
              onClick={() => setSelectedRecord(selectedRecord?.date === record.date ? null : record)}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  {getRecordIcon(record.type)}
                  <span className="font-bold text-gray-900 capitalize text-sm sm:text-base">
                    {record.type.replace('_', ' ')}
                  </span>
                </div>
                <span className="text-xs sm:text-sm text-gray-700 font-medium bg-white/60 px-2 py-1 rounded">
                  {new Date(record.date).toLocaleDateString()}
                </span>
              </div>
              
              <p className="text-gray-800 text-xs sm:text-sm mb-2 font-medium">{record.description}</p>
              
              {selectedRecord?.date === record.date && (
                <div className="mt-4 pt-4 border-t border-gray-200 bg-white/60 rounded-lg p-3">
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-bold text-gray-900 mb-1 text-sm">Possible Causes:</h4>
                      <ul className="text-xs sm:text-sm text-gray-800 space-y-1">
                        {record.possibleCauses.map((cause, i) => (
                          <li key={i} className="flex items-start space-x-2">
                            <span className="text-blue-500 mt-0.5">•</span>
                            <span className="font-medium">{cause}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    
                    {record.newsEvents && record.newsEvents.length > 0 && (
                      <div>
                        <h4 className="font-bold text-gray-900 mb-1 text-sm">Related Events:</h4>
                        <ul className="text-xs sm:text-sm text-gray-800 space-y-1">
                          {record.newsEvents.map((event, i) => (
                            <li key={i} className="flex items-start space-x-2">
                              <span className="text-green-500 mt-0.5">•</span>
                              <span className="font-medium">{event}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Privacy Notice */}
      <div className="bg-blue-50/95 backdrop-blur-sm border border-blue-200 rounded-2xl p-4 sm:p-6 shadow-lg">
        <div className="flex items-start space-x-3">
          <Info className="w-6 h-6 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="font-bold text-blue-900 mb-2 text-sm sm:text-base">Privacy Protection Active</h4>
            <p className="text-blue-800 text-xs sm:text-sm font-medium">
              All personal data including names, locations, ages, email addresses, phone numbers, 
              and social media handles are automatically redacted from display while being preserved 
              in encrypted storage. Only aggregated, anonymized emotional data is used for global analytics.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};