/**
 * Global Analytics Service
 * Handles global mental health data aggregation, heat mapping, and historical analysis
 */

export interface GlobalMoodData {
  date: string; // YYYY-MM-DD format
  utcTimestamp: number;
  totalEntries: number;
  averageSentiment: number;
  emotionalBreakdown: {
    anger: number;    // Red
    calm: number;     // Yellow  
    harmony: number;  // Green
    happy: number;    // Blue
  };
  volatility: number;
  regions: {
    [region: string]: {
      sentiment: number;
      entries: number;
      dominantEmotion: 'anger' | 'calm' | 'harmony' | 'happy';
    };
  };
}

export interface HistoricalRecord {
  type: 'best' | 'worst' | 'most_volatile' | 'most_peaceful';
  date: string;
  score: number;
  description: string;
  possibleCauses: string[];
  newsEvents?: string[];
}

export interface HeatMapData {
  date: string;
  regions: {
    [region: string]: {
      color: string; // hex color
      intensity: number; // 0-1
      dominantEmotion: string;
      sentiment: number;
    };
  };
}

class GlobalAnalyticsService {
  private moodHistory: Map<string, GlobalMoodData> = new Map();
  private records: HistoricalRecord[] = [];
  private newsEventPatterns: Map<string, string[]> = new Map();

  constructor() {
    this.initializeNewsPatterns();
    this.loadMockHistoricalData();
  }

  private initializeNewsPatterns() {
    // Common news event patterns that affect global mood
    this.newsEventPatterns.set('positive', [
      'New Year celebrations',
      'Holiday season',
      'Major sports victory',
      'Scientific breakthrough',
      'Peace agreement',
      'Economic recovery',
      'Successful space mission',
      'Medical breakthrough',
      'Environmental protection success',
      'International cooperation'
    ]);

    this.newsEventPatterns.set('negative', [
      'Natural disaster',
      'Economic crisis',
      'Political unrest',
      'War outbreak',
      'Terrorist attack',
      'Pandemic outbreak',
      'Market crash',
      'Climate disaster',
      'Mass shooting',
      'International conflict'
    ]);

    this.newsEventPatterns.set('neutral', [
      'Election results',
      'Policy changes',
      'Technology updates',
      'Cultural events',
      'Sports events',
      'Award ceremonies',
      'Product launches',
      'Conference announcements'
    ]);
  }

  private loadMockHistoricalData() {
    // Generate mock historical data for the past 30 days
    const today = new Date();
    
    for (let i = 30; i >= 0; i--) {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - i);
      date.setUTCHours(0, 0, 0, 0); // Start at UTC 0
      
      const dateStr = date.toISOString().split('T')[0];
      
      // Generate realistic mood data with some patterns
      const isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
      const isMonday = date.getUTCDay() === 1;
      const isNewYear = dateStr === '2025-01-01';
      const isChristmas = dateStr === '2024-12-25';
      
      let baseSentiment = 0.1; // Slightly positive baseline
      if (isNewYear) baseSentiment = 0.8; // Very positive
      else if (isChristmas) baseSentiment = 0.7;
      else if (isWeekend) baseSentiment = 0.3;
      else if (isMonday) baseSentiment = -0.2; // Monday blues
      
      // Add some randomness
      baseSentiment += (Math.random() - 0.5) * 0.4;
      baseSentiment = Math.max(-1, Math.min(1, baseSentiment));
      
      const moodData: GlobalMoodData = {
        date: dateStr,
        utcTimestamp: date.getTime(),
        totalEntries: Math.floor(Math.random() * 10000) + 5000,
        averageSentiment: baseSentiment,
        emotionalBreakdown: this.generateEmotionalBreakdown(baseSentiment),
        volatility: Math.random() * 0.5 + 0.1,
        regions: this.generateRegionalData(baseSentiment)
      };
      
      this.moodHistory.set(dateStr, moodData);
    }
    
    this.updateHistoricalRecords();
  }

  private generateEmotionalBreakdown(sentiment: number): GlobalMoodData['emotionalBreakdown'] {
    // Convert sentiment to emotional breakdown
    const base = 0.25; // 25% baseline for each emotion
    
    if (sentiment > 0.5) {
      // Very positive - more happy and harmony
      return {
        anger: Math.max(0.05, base - 0.15),
        calm: base,
        harmony: base + 0.2,
        happy: base + 0.25
      };
    } else if (sentiment > 0) {
      // Positive - balanced with slight happiness
      return {
        anger: Math.max(0.1, base - 0.1),
        calm: base + 0.1,
        harmony: base + 0.05,
        happy: base + 0.15
      };
    } else if (sentiment > -0.5) {
      // Slightly negative - more calm, less happy
      return {
        anger: base + 0.1,
        calm: base + 0.15,
        harmony: Math.max(0.1, base - 0.05),
        happy: Math.max(0.05, base - 0.2)
      };
    } else {
      // Very negative - more anger, less harmony/happy
      return {
        anger: base + 0.3,
        calm: base,
        harmony: Math.max(0.05, base - 0.15),
        happy: Math.max(0.05, base - 0.25)
      };
    }
  }

  private generateRegionalData(baseSentiment: number): GlobalMoodData['regions'] {
    const regions = [
      'North America', 'South America', 'Europe', 'Asia', 'Africa', 
      'Oceania', 'Middle East', 'Eastern Europe', 'Southeast Asia'
    ];
    
    const regionData: GlobalMoodData['regions'] = {};
    
    regions.forEach(region => {
      // Add regional variation
      const regionalVariation = (Math.random() - 0.5) * 0.6;
      const regionalSentiment = Math.max(-1, Math.min(1, baseSentiment + regionalVariation));
      
      const breakdown = this.generateEmotionalBreakdown(regionalSentiment);
      const dominantEmotion = this.getDominantEmotion(breakdown);
      
      regionData[region] = {
        sentiment: regionalSentiment,
        entries: Math.floor(Math.random() * 2000) + 500,
        dominantEmotion
      };
    });
    
    return regionData;
  }

  private getDominantEmotion(breakdown: GlobalMoodData['emotionalBreakdown']): 'anger' | 'calm' | 'harmony' | 'happy' {
    const emotions = Object.entries(breakdown) as [keyof GlobalMoodData['emotionalBreakdown'], number][];
    return emotions.reduce((max, [emotion, value]) => 
      value > breakdown[max] ? emotion : max, 'calm' as keyof GlobalMoodData['emotionalBreakdown']
    );
  }

  private updateHistoricalRecords() {
    const allData = Array.from(this.moodHistory.values());
    
    // Find records
    const bestDay = allData.reduce((max, day) => 
      day.averageSentiment > max.averageSentiment ? day : max
    );
    
    const worstDay = allData.reduce((min, day) => 
      day.averageSentiment < min.averageSentiment ? day : min
    );
    
    const mostVolatile = allData.reduce((max, day) => 
      day.volatility > max.volatility ? day : max
    );
    
    const mostPeaceful = allData.reduce((min, day) => 
      day.volatility < min.volatility ? day : min
    );
    
    this.records = [
      {
        type: 'best',
        date: bestDay.date,
        score: bestDay.averageSentiment,
        description: `Humanity's happiest day with ${bestDay.averageSentiment.toFixed(2)} average sentiment`,
        possibleCauses: this.inferCauses(bestDay.date, 'positive'),
        newsEvents: this.getNewsEvents(bestDay.date, 'positive')
      },
      {
        type: 'worst',
        date: worstDay.date,
        score: worstDay.averageSentiment,
        description: `Most challenging day with ${worstDay.averageSentiment.toFixed(2)} average sentiment`,
        possibleCauses: this.inferCauses(worstDay.date, 'negative'),
        newsEvents: this.getNewsEvents(worstDay.date, 'negative')
      },
      {
        type: 'most_volatile',
        date: mostVolatile.date,
        score: mostVolatile.volatility,
        description: `Highest emotional volatility at ${mostVolatile.volatility.toFixed(2)}`,
        possibleCauses: this.inferCauses(mostVolatile.date, 'volatile'),
        newsEvents: this.getNewsEvents(mostVolatile.date, 'neutral')
      },
      {
        type: 'most_peaceful',
        date: mostPeaceful.date,
        score: mostPeaceful.volatility,
        description: `Most emotionally stable day with ${mostPeaceful.volatility.toFixed(2)} volatility`,
        possibleCauses: this.inferCauses(mostPeaceful.date, 'peaceful'),
        newsEvents: this.getNewsEvents(mostPeaceful.date, 'positive')
      }
    ];
  }

  private inferCauses(date: string, type: string): string[] {
    const dateObj = new Date(date);
    const causes: string[] = [];
    
    // Check for special dates
    if (date === '2025-01-01') {
      causes.push('New Year\'s Day celebrations', 'Fresh start mentality', 'Global optimism');
    } else if (date === '2024-12-25') {
      causes.push('Christmas celebrations', 'Family gatherings', 'Holiday spirit');
    } else if (dateObj.getUTCDay() === 1) {
      causes.push('Monday blues effect', 'Return to work stress');
    } else if (dateObj.getUTCDay() === 0 || dateObj.getUTCDay() === 6) {
      causes.push('Weekend relaxation', 'Leisure time', 'Social activities');
    }
    
    // Add type-specific causes
    if (type === 'positive') {
      causes.push('Positive global events', 'Community support', 'Achievement celebrations');
    } else if (type === 'negative') {
      causes.push('Global challenges', 'Economic concerns', 'Social tensions');
    } else if (type === 'volatile') {
      causes.push('Mixed global events', 'Uncertainty', 'Rapid news cycles');
    } else if (type === 'peaceful') {
      causes.push('Stable conditions', 'Positive news balance', 'Community harmony');
    }
    
    return causes.slice(0, 3); // Limit to 3 causes
  }

  private getNewsEvents(date: string, type: string): string[] {
    const events = this.newsEventPatterns.get(type) || [];
    // Randomly select 1-2 events
    const selectedEvents = events.sort(() => 0.5 - Math.random()).slice(0, Math.floor(Math.random() * 2) + 1);
    return selectedEvents;
  }

  getGlobalHeatMap(date?: string): HeatMapData {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const moodData = this.moodHistory.get(targetDate);
    
    if (!moodData) {
      return {
        date: targetDate,
        regions: {}
      };
    }
    
    const heatMapData: HeatMapData = {
      date: targetDate,
      regions: {}
    };
    
    Object.entries(moodData.regions).forEach(([region, data]) => {
      const color = this.getEmotionColor(data.dominantEmotion);
      const intensity = Math.abs(data.sentiment);
      
      heatMapData.regions[region] = {
        color,
        intensity,
        dominantEmotion: data.dominantEmotion,
        sentiment: data.sentiment
      };
    });
    
    return heatMapData;
  }

  private getEmotionColor(emotion: 'anger' | 'calm' | 'harmony' | 'happy'): string {
    const colors = {
      anger: '#EF4444',    // Red
      calm: '#F59E0B',     // Yellow
      harmony: '#10B981',  // Green
      happy: '#3B82F6'     // Blue
    };
    return colors[emotion];
  }

  getHistoricalRecords(): HistoricalRecord[] {
    return this.records;
  }

  getMoodDataByDate(date: string): GlobalMoodData | null {
    return this.moodHistory.get(date) || null;
  }

  getDateRange(): { start: string; end: string } {
    const dates = Array.from(this.moodHistory.keys()).sort();
    return {
      start: dates[0] || '',
      end: dates[dates.length - 1] || ''
    };
  }

  searchByDescription(query: string): HistoricalRecord[] {
    const lowerQuery = query.toLowerCase();
    return this.records.filter(record => 
      record.description.toLowerCase().includes(lowerQuery) ||
      record.possibleCauses.some(cause => cause.toLowerCase().includes(lowerQuery)) ||
      (record.newsEvents && record.newsEvents.some(event => event.toLowerCase().includes(lowerQuery)))
    );
  }

  // Privacy protection - redact personal information
  redactPersonalData(text: string): string {
    let redacted = text;
    
    // Email addresses
    redacted = redacted.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL_REDACTED]');
    
    // Phone numbers (various formats)
    redacted = redacted.replace(/(\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g, '[PHONE_REDACTED]');
    
    // Social media handles
    redacted = redacted.replace(/@[A-Za-z0-9_]+/g, '[HANDLE_REDACTED]');
    
    // Names (common patterns - this is basic, could be enhanced)
    redacted = redacted.replace(/\b(Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+/g, '[NAME_REDACTED]');
    
    // Specific locations (addresses)
    redacted = redacted.replace(/\b\d+\s+[A-Za-z\s]+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl)\b/gi, '[ADDRESS_REDACTED]');
    
    // Ages
    redacted = redacted.replace(/\b(I am|I'm|age|aged)\s+\d{1,2}(\s+years?\s+old)?\b/gi, '[AGE_REDACTED]');
    
    // Credit card numbers
    redacted = redacted.replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD_REDACTED]');
    
    // SSN
    redacted = redacted.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN_REDACTED]');
    
    return redacted;
  }

  addMoodData(date: string, sentiment: number, emotions: any, region?: string) {
    const utcDate = new Date(date);
    utcDate.setUTCHours(0, 0, 0, 0);
    const dateStr = utcDate.toISOString().split('T')[0];
    
    let moodData = this.moodHistory.get(dateStr);
    
    if (!moodData) {
      moodData = {
        date: dateStr,
        utcTimestamp: utcDate.getTime(),
        totalEntries: 0,
        averageSentiment: 0,
        emotionalBreakdown: { anger: 0, calm: 0, harmony: 0, happy: 0 },
        volatility: 0,
        regions: {}
      };
    }
    
    // Update with new data
    const totalEntries = moodData.totalEntries + 1;
    const newAverage = (moodData.averageSentiment * moodData.totalEntries + sentiment) / totalEntries;
    
    moodData.totalEntries = totalEntries;
    moodData.averageSentiment = newAverage;
    moodData.emotionalBreakdown = this.generateEmotionalBreakdown(newAverage);
    
    this.moodHistory.set(dateStr, moodData);
    this.updateHistoricalRecords();
  }
}

export const globalAnalyticsService = new GlobalAnalyticsService();