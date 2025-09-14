/**
 * Advanced Analytics Service
 * Analyzes diary entries before encryption for insights and patterns
 */

export interface EmotionalMetrics {
  sentiment: {
    score: number; // -1 to 1
    confidence: number; // 0 to 1
    primary: 'positive' | 'negative' | 'neutral';
    secondary?: string; // joy, sadness, anger, fear, etc.
  };
  emotions: {
    joy: number;
    sadness: number;
    anger: number;
    fear: number;
    surprise: number;
    disgust: number;
    trust: number;
    anticipation: number;
  };
  themes: string[];
  keywords: string[];
  readability: {
    fleschScore: number;
    gradeLevel: string;
  };
  wordCount: number;
  complexity: number;
  personalityTraits: {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
  };
}

export interface TrendAnalysis {
  moodTrend: 'improving' | 'declining' | 'stable';
  averageSentiment: number;
  emotionalVolatility: number;
  commonThemes: string[];
  suggestedActions: string[];
  riskFactors: string[];
}

class AnalyticsService {
  private emotionLexicon: Map<string, any> = new Map();
  private themePatterns: RegExp[] = [];

  constructor() {
    this.initializeLexicons();
  }

  private initializeLexicons() {
    // Enhanced emotion lexicon with weights
    const emotions = {
      // Joy/Happiness
      happy: { joy: 0.8, sentiment: 0.7 },
      excited: { joy: 0.9, anticipation: 0.6, sentiment: 0.8 },
      grateful: { joy: 0.7, trust: 0.5, sentiment: 0.8 },
      amazing: { joy: 0.8, surprise: 0.4, sentiment: 0.9 },
      wonderful: { joy: 0.8, sentiment: 0.8 },
      blessed: { joy: 0.7, trust: 0.6, sentiment: 0.8 },
      love: { joy: 0.8, trust: 0.9, sentiment: 0.9 },
      
      // Sadness
      sad: { sadness: 0.8, sentiment: -0.7 },
      depressed: { sadness: 0.9, sentiment: -0.9 },
      lonely: { sadness: 0.7, sentiment: -0.6 },
      disappointed: { sadness: 0.6, sentiment: -0.5 },
      heartbroken: { sadness: 0.9, sentiment: -0.8 },
      
      // Anger
      angry: { anger: 0.8, sentiment: -0.6 },
      frustrated: { anger: 0.7, sentiment: -0.5 },
      furious: { anger: 0.9, sentiment: -0.8 },
      annoyed: { anger: 0.5, sentiment: -0.4 },
      hate: { anger: 0.8, disgust: 0.6, sentiment: -0.9 },
      
      // Fear/Anxiety
      anxious: { fear: 0.7, sentiment: -0.5 },
      worried: { fear: 0.6, sentiment: -0.4 },
      scared: { fear: 0.8, sentiment: -0.6 },
      nervous: { fear: 0.6, sentiment: -0.3 },
      terrified: { fear: 0.9, sentiment: -0.8 },
      
      // Surprise
      surprised: { surprise: 0.8, sentiment: 0.2 },
      shocked: { surprise: 0.9, fear: 0.3, sentiment: -0.2 },
      amazed: { surprise: 0.7, joy: 0.5, sentiment: 0.6 },
      
      // Trust
      confident: { trust: 0.7, sentiment: 0.5 },
      secure: { trust: 0.8, sentiment: 0.6 },
      comfortable: { trust: 0.6, sentiment: 0.4 },
      
      // Anticipation
      hopeful: { anticipation: 0.8, sentiment: 0.6 },
      optimistic: { anticipation: 0.7, sentiment: 0.7 },
      eager: { anticipation: 0.8, joy: 0.4, sentiment: 0.6 }
    };

    Object.entries(emotions).forEach(([word, values]) => {
      this.emotionLexicon.set(word, values);
    });

    // Theme patterns
    this.themePatterns = [
      /work|job|career|office|boss|colleague/gi,
      /family|parent|mother|father|sibling|child/gi,
      /relationship|partner|boyfriend|girlfriend|spouse|marriage/gi,
      /health|sick|doctor|hospital|medicine|pain/gi,
      /money|financial|budget|expensive|cheap|cost/gi,
      /school|study|exam|grade|teacher|student/gi,
      /travel|vacation|trip|journey|adventure/gi,
      /home|house|apartment|room|neighborhood/gi,
      /friend|friendship|social|party|gathering/gi,
      /hobby|interest|passion|creative|art|music/gi
    ];
  }

  analyzeEntry(text: string): EmotionalMetrics {
    const words = this.tokenize(text);
    const emotions = this.analyzeEmotions(words);
    const sentiment = this.analyzeSentiment(words, emotions);
    const themes = this.extractThemes(text);
    const keywords = this.extractKeywords(words);
    const readability = this.analyzeReadability(text);
    const personality = this.analyzePersonality(words, emotions);

    return {
      sentiment,
      emotions,
      themes,
      keywords,
      readability,
      wordCount: words.length,
      complexity: this.calculateComplexity(words),
      personalityTraits: personality
    };
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);
  }

  private analyzeEmotions(words: string[]): EmotionalMetrics['emotions'] {
    const emotions = {
      joy: 0,
      sadness: 0,
      anger: 0,
      fear: 0,
      surprise: 0,
      disgust: 0,
      trust: 0,
      anticipation: 0
    };

    let totalMatches = 0;

    words.forEach(word => {
      const emotionData = this.emotionLexicon.get(word);
      if (emotionData) {
        Object.keys(emotions).forEach(emotion => {
          if (emotionData[emotion]) {
            emotions[emotion] += emotionData[emotion];
            totalMatches++;
          }
        });
      }
    });

    // Normalize by total matches
    if (totalMatches > 0) {
      Object.keys(emotions).forEach(emotion => {
        emotions[emotion] = Math.min(emotions[emotion] / totalMatches, 1);
      });
    }

    return emotions;
  }

  private analyzeSentiment(words: string[], emotions: any): EmotionalMetrics['sentiment'] {
    let sentimentScore = 0;
    let matches = 0;

    words.forEach(word => {
      const emotionData = this.emotionLexicon.get(word);
      if (emotionData && emotionData.sentiment !== undefined) {
        sentimentScore += emotionData.sentiment;
        matches++;
      }
    });

    const avgSentiment = matches > 0 ? sentimentScore / matches : 0;
    const confidence = Math.min(matches / (words.length * 0.1), 1);

    let primary: 'positive' | 'negative' | 'neutral' = 'neutral';
    if (avgSentiment > 0.2) primary = 'positive';
    else if (avgSentiment < -0.2) primary = 'negative';

    // Determine secondary emotion
    const maxEmotion = Object.entries(emotions)
      .reduce((max, [emotion, value]) => value > max.value ? { emotion, value } : max, 
              { emotion: '', value: 0 });

    return {
      score: avgSentiment,
      confidence,
      primary,
      secondary: maxEmotion.value > 0.3 ? maxEmotion.emotion : undefined
    };
  }

  private extractThemes(text: string): string[] {
    const themes: string[] = [];
    const themeNames = [
      'work', 'family', 'relationships', 'health', 'finances', 
      'education', 'travel', 'home', 'social', 'hobbies'
    ];

    this.themePatterns.forEach((pattern, index) => {
      if (pattern.test(text)) {
        themes.push(themeNames[index]);
      }
    });

    return themes;
  }

  private extractKeywords(words: string[]): string[] {
    // Simple TF-IDF-like approach
    const wordFreq = new Map<string, number>();
    
    words.forEach(word => {
      if (word.length > 4) { // Focus on meaningful words
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
    });

    return Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  private analyzeReadability(text: string): EmotionalMetrics['readability'] {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const syllables = words.reduce((total, word) => total + this.countSyllables(word), 0);

    const avgWordsPerSentence = words.length / Math.max(sentences.length, 1);
    const avgSyllablesPerWord = syllables / Math.max(words.length, 1);

    // Flesch Reading Ease Score
    const fleschScore = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);

    let gradeLevel = 'Graduate';
    if (fleschScore >= 90) gradeLevel = '5th grade';
    else if (fleschScore >= 80) gradeLevel = '6th grade';
    else if (fleschScore >= 70) gradeLevel = '7th grade';
    else if (fleschScore >= 60) gradeLevel = '8th-9th grade';
    else if (fleschScore >= 50) gradeLevel = '10th-12th grade';
    else if (fleschScore >= 30) gradeLevel = 'College';

    return { fleschScore: Math.max(0, Math.min(100, fleschScore)), gradeLevel };
  }

  private countSyllables(word: string): number {
    word = word.toLowerCase();
    if (word.length <= 3) return 1;
    
    const vowels = 'aeiouy';
    let syllableCount = 0;
    let previousWasVowel = false;

    for (let i = 0; i < word.length; i++) {
      const isVowel = vowels.includes(word[i]);
      if (isVowel && !previousWasVowel) {
        syllableCount++;
      }
      previousWasVowel = isVowel;
    }

    // Handle silent 'e'
    if (word.endsWith('e')) syllableCount--;
    
    return Math.max(1, syllableCount);
  }

  private calculateComplexity(words: string[]): number {
    const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
    const uniqueWords = new Set(words).size;
    const lexicalDiversity = uniqueWords / words.length;
    
    return (avgWordLength / 10) + lexicalDiversity;
  }

  private analyzePersonality(words: string[], emotions: any): EmotionalMetrics['personalityTraits'] {
    // Simplified personality analysis based on language patterns
    const traits = {
      openness: 0,
      conscientiousness: 0,
      extraversion: 0,
      agreeableness: 0,
      neuroticism: 0
    };

    // Openness: creative, curious, abstract words
    const opennessWords = ['creative', 'imagine', 'art', 'new', 'different', 'explore', 'wonder'];
    traits.openness = this.calculateTraitScore(words, opennessWords);

    // Conscientiousness: organized, planned, disciplined words
    const conscientiousnessWords = ['plan', 'organize', 'schedule', 'goal', 'complete', 'finish', 'work'];
    traits.conscientiousness = this.calculateTraitScore(words, conscientiousnessWords);

    // Extraversion: social, energetic, assertive words
    const extraversionWords = ['party', 'friends', 'social', 'talk', 'meet', 'energy', 'excited'];
    traits.extraversion = this.calculateTraitScore(words, extraversionWords);

    // Agreeableness: cooperative, trusting, helpful words
    const agreeablenessWords = ['help', 'kind', 'care', 'support', 'trust', 'love', 'friend'];
    traits.agreeableness = this.calculateTraitScore(words, agreeablenessWords);

    // Neuroticism: anxious, stressed, emotional instability
    traits.neuroticism = emotions.fear + emotions.sadness + emotions.anger;

    return traits;
  }

  private calculateTraitScore(words: string[], traitWords: string[]): number {
    const matches = words.filter(word => 
      traitWords.some(traitWord => word.includes(traitWord))
    ).length;
    
    return Math.min(matches / (words.length * 0.05), 1);
  }

  analyzeTrends(entries: EmotionalMetrics[]): TrendAnalysis {
    if (entries.length === 0) {
      return {
        moodTrend: 'stable',
        averageSentiment: 0,
        emotionalVolatility: 0,
        commonThemes: [],
        suggestedActions: [],
        riskFactors: []
      };
    }

    const sentiments = entries.map(e => e.sentiment.score);
    const averageSentiment = sentiments.reduce((sum, s) => sum + s, 0) / sentiments.length;
    
    // Calculate trend
    const recentEntries = entries.slice(-5);
    const recentAvg = recentEntries.reduce((sum, e) => sum + e.sentiment.score, 0) / recentEntries.length;
    const olderEntries = entries.slice(0, -5);
    const olderAvg = olderEntries.length > 0 
      ? olderEntries.reduce((sum, e) => sum + e.sentiment.score, 0) / olderEntries.length 
      : recentAvg;

    let moodTrend: 'improving' | 'declining' | 'stable' = 'stable';
    const trendDiff = recentAvg - olderAvg;
    if (trendDiff > 0.1) moodTrend = 'improving';
    else if (trendDiff < -0.1) moodTrend = 'declining';

    // Calculate volatility
    const variance = sentiments.reduce((sum, s) => sum + Math.pow(s - averageSentiment, 2), 0) / sentiments.length;
    const emotionalVolatility = Math.sqrt(variance);

    // Common themes
    const allThemes = entries.flatMap(e => e.themes);
    const themeFreq = new Map<string, number>();
    allThemes.forEach(theme => {
      themeFreq.set(theme, (themeFreq.get(theme) || 0) + 1);
    });
    const commonThemes = Array.from(themeFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([theme]) => theme);

    // Generate suggestions and risk factors
    const suggestedActions = this.generateSuggestions(moodTrend, averageSentiment, commonThemes);
    const riskFactors = this.identifyRiskFactors(entries, emotionalVolatility);

    return {
      moodTrend,
      averageSentiment,
      emotionalVolatility,
      commonThemes,
      suggestedActions,
      riskFactors
    };
  }

  private generateSuggestions(trend: string, avgSentiment: number, themes: string[]): string[] {
    const suggestions: string[] = [];

    if (trend === 'declining') {
      suggestions.push('Consider reaching out to a friend or family member');
      suggestions.push('Try engaging in a physical activity you enjoy');
      suggestions.push('Practice mindfulness or meditation');
    }

    if (avgSentiment < -0.3) {
      suggestions.push('Consider speaking with a mental health professional');
      suggestions.push('Focus on self-care activities');
    }

    if (themes.includes('work')) {
      suggestions.push('Consider work-life balance strategies');
    }

    if (themes.includes('relationships')) {
      suggestions.push('Reflect on communication patterns in relationships');
    }

    return suggestions.slice(0, 3);
  }

  private identifyRiskFactors(entries: EmotionalMetrics[], volatility: number): string[] {
    const riskFactors: string[] = [];

    const recentEntries = entries.slice(-7); // Last week
    const avgNeuroticism = recentEntries.reduce((sum, e) => sum + e.personalityTraits.neuroticism, 0) / recentEntries.length;
    const avgSentiment = recentEntries.reduce((sum, e) => sum + e.sentiment.score, 0) / recentEntries.length;

    if (avgSentiment < -0.5) {
      riskFactors.push('Consistently low mood detected');
    }

    if (volatility > 0.6) {
      riskFactors.push('High emotional volatility');
    }

    if (avgNeuroticism > 0.7) {
      riskFactors.push('Elevated stress and anxiety levels');
    }

    const negativeThemes = recentEntries.flatMap(e => e.themes)
      .filter(theme => ['work', 'health', 'finances'].includes(theme));
    
    if (negativeThemes.length > recentEntries.length * 0.5) {
      riskFactors.push('Recurring stressful life areas');
    }

    return riskFactors;
  }

  generateInsights(metrics: EmotionalMetrics): string[] {
    const insights: string[] = [];

    if (metrics.sentiment.confidence > 0.7) {
      insights.push(`Strong ${metrics.sentiment.primary} sentiment detected with ${Math.round(metrics.sentiment.confidence * 100)}% confidence`);
    }

    if (metrics.emotions.joy > 0.5) {
      insights.push('High levels of joy and happiness expressed');
    }

    if (metrics.emotions.sadness > 0.5) {
      insights.push('Significant sadness detected - consider self-care');
    }

    if (metrics.complexity > 0.7) {
      insights.push('Complex emotional expression - rich vocabulary used');
    }

    if (metrics.themes.length > 2) {
      insights.push(`Multiple life areas mentioned: ${metrics.themes.join(', ')}`);
    }

    return insights;
  }
}

export const analyticsService = new AnalyticsService();