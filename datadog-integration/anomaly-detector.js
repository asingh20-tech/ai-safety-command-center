/**
 * Anomaly Detection Engine
 * Processes LLM responses and requests to detect security/performance issues
 */

// PII patterns
const PII_PATTERNS = {
  EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  PHONE: /(?:\+1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g,
  SSN: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0{4})\d{4}\b/g,
  CREDIT_CARD: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  API_KEY: /(?:api[_-]?key|sk_[a-z0-9]{20,})/gi,
};

// Toxic content keywords (expanded list)
const TOXIC_KEYWORDS = [
  'hate', 'kill', 'harm', 'violence', 'abuse', 'racist', 'sexist',
  'slur', 'threat', 'terror', 'bomb', 'poison', 'explicit content',
];

// Prompt injection patterns
const INJECTION_PATTERNS = [
  /ignore previous|disregard the prompt|forget instructions/i,
  /system override|admin mode|test mode/i,
  /bypass|jailbreak|prompt injection/i,
  /execute command|run code|eval/i,
];

/**
 * Detect PII in text
 */
function detectPII(text) {
  if (!text) return [];
  
  const detected = [];
  
  if (PII_PATTERNS.EMAIL.test(text)) {
    detected.push({ type: 'EMAIL', count: (text.match(PII_PATTERNS.EMAIL) || []).length });
  }
  if (PII_PATTERNS.PHONE.test(text)) {
    detected.push({ type: 'PHONE', count: (text.match(PII_PATTERNS.PHONE) || []).length });
  }
  if (PII_PATTERNS.SSN.test(text)) {
    detected.push({ type: 'SSN', count: (text.match(PII_PATTERNS.SSN) || []).length });
  }
  if (PII_PATTERNS.CREDIT_CARD.test(text)) {
    detected.push({ type: 'CREDIT_CARD', count: (text.match(PII_PATTERNS.CREDIT_CARD) || []).length });
  }
  if (PII_PATTERNS.API_KEY.test(text)) {
    detected.push({ type: 'API_KEY', count: (text.match(PII_PATTERNS.API_KEY) || []).length });
  }
  
  return detected;
}

/**
 * Detect toxic content
 */
function detectToxicContent(text) {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  return TOXIC_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

/**
 * Detect prompt injection attempts
 */
function detectPromptInjection(text) {
  if (!text) return false;
  
  return INJECTION_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Analyze token usage for anomalies
 */
function analyzeTokenUsage(currentTokens, averageTokens) {
  if (!averageTokens) return { isAnomaly: false, reason: 'No baseline' };
  
  const increase = (currentTokens - averageTokens) / averageTokens;
  
  if (increase > 2) {
    return { isAnomaly: true, reason: 'Token usage >200% above average' };
  }
  if (increase > 1.5) {
    return { isAnomaly: true, reason: 'Token usage >150% above average', severity: 'medium' };
  }
  
  return { isAnomaly: false };
}

/**
 * Analyze cost anomaly
 */
function analyzeCostAnomaly(currentCost, avgCost, costThreshold = 50) {
  if (!avgCost) return { isAnomaly: false };
  
  const increase = (currentCost - avgCost) / avgCost;
  
  if (currentCost > costThreshold) {
    return { isAnomaly: true, reason: `Cost ($${currentCost.toFixed(2)}) exceeds threshold ($${costThreshold})` };
  }
  if (increase > 3) {
    return { isAnomaly: true, reason: `Cost spike: >300% increase from baseline` };
  }
  
  return { isAnomaly: false };
}

/**
 * Analyze latency anomaly
 */
function analyzeLatencyAnomaly(latencyMs, avgLatencyMs) {
  if (!avgLatencyMs) return { isAnomaly: false };
  
  const increase = (latencyMs - avgLatencyMs) / avgLatencyMs;
  
  if (latencyMs > 30000) {
    return { isAnomaly: true, reason: 'Request timeout (>30s)' };
  }
  if (increase > 2.5) {
    return { isAnomaly: true, reason: `Latency >250% above average (${latencyMs}ms vs ${avgLatencyMs}ms)` };
  }
  if (increase > 1.5) {
    return { isAnomaly: true, reason: `Latency elevated: ${latencyMs}ms vs ${avgLatencyMs}ms avg`, severity: 'medium' };
  }
  
  return { isAnomaly: false };
}

/**
 * Detect hallucination indicators
 */
function detectHallucination(response, confidenceScore) {
  if (!response) return { isAnomaly: false };
  
  if (confidenceScore < 0.3) {
    return { isAnomaly: true, reason: `Very low confidence score: ${confidenceScore}` };
  }
  
  // Check for contradictory statements
  if (response.includes('I am not sure') && response.includes('The answer is')) {
    return { isAnomaly: true, reason: 'Contradictory statements detected in response' };
  }
  
  return { isAnomaly: false };
}

/**
 * Check for repeated failure pattern
 */
function analyzeErrorPattern(errorCount, timeWindowMinutes = 5) {
  if (errorCount > 10) {
    return { isAnomaly: true, reason: `High error rate: ${errorCount} errors in ${timeWindowMinutes}m` };
  }
  return { isAnomaly: false };
}

/**
 * Main anomaly analysis function
 */
function analyzeMessage(message) {
  const anomalies = [];
  
  // Detect PII leakage
  const piiInRequest = message.prompt ? detectPII(message.prompt) : [];
  const piiInResponse = message.response ? detectPII(message.response) : [];
  
  if (piiInRequest.length > 0) {
    anomalies.push({
      type: 'PII_IN_REQUEST',
      severity: 'critical',
      description: `PII detected in user input: ${piiInRequest.map(p => p.type).join(', ')}`,
      detailedPII: piiInRequest,
    });
  }
  
  if (piiInResponse.length > 0) {
    anomalies.push({
      type: 'PII_LEAKAGE',
      severity: 'critical',
      description: `Model leaked PII: ${piiInResponse.map(p => p.type).join(', ')}`,
      detailedPII: piiInResponse,
    });
  }
  
  // Detect toxic content
  if (message.response && detectToxicContent(message.response)) {
    anomalies.push({
      type: 'TOXIC_CONTENT',
      severity: 'high',
      description: 'Model generated toxic/harmful content',
    });
  }
  
  // Detect prompt injection
  if (message.prompt && detectPromptInjection(message.prompt)) {
    anomalies.push({
      type: 'PROMPT_INJECTION',
      severity: 'critical',
      description: 'Possible prompt injection attack detected in user input',
    });
  }
  
  // Analyze token usage
  if (message.tokenCount !== undefined && message.avgTokenCount !== undefined) {
    const tokenAnomaly = analyzeTokenUsage(message.tokenCount, message.avgTokenCount);
    if (tokenAnomaly.isAnomaly) {
      anomalies.push({
        type: 'TOKEN_ANOMALY',
        severity: tokenAnomaly.severity || 'medium',
        description: tokenAnomaly.reason,
        tokens: message.tokenCount,
        avgTokens: message.avgTokenCount,
      });
    }
  }
  
  // Analyze cost
  if (message.cost !== undefined && message.avgCost !== undefined) {
    const costAnomaly = analyzeCostAnomaly(message.cost, message.avgCost);
    if (costAnomaly.isAnomaly) {
      anomalies.push({
        type: 'COST_ANOMALY',
        severity: 'high',
        description: costAnomaly.reason,
        cost: message.cost,
        avgCost: message.avgCost,
      });
    }
  }
  
  // Analyze latency
  if (message.latencyMs !== undefined && message.avgLatencyMs !== undefined) {
    const latencyAnomaly = analyzeLatencyAnomaly(message.latencyMs, message.avgLatencyMs);
    if (latencyAnomaly.isAnomaly) {
      anomalies.push({
        type: 'PERFORMANCE_DEGRADATION',
        severity: latencyAnomaly.severity || 'high',
        description: latencyAnomaly.reason,
        latencyMs: message.latencyMs,
        avgLatencyMs: message.avgLatencyMs,
      });
    }
  }
  
  // Detect hallucination
  if (message.response && message.confidenceScore !== undefined) {
    const hallucination = detectHallucination(message.response, message.confidenceScore);
    if (hallucination.isAnomaly) {
      anomalies.push({
        type: 'HALLUCINATION',
        severity: 'high',
        description: hallucination.reason,
        confidenceScore: message.confidenceScore,
      });
    }
  }
  
  // Analyze error patterns
  if (message.errorCount !== undefined && message.errorCount > 0) {
    const errorAnomaly = analyzeErrorPattern(message.errorCount);
    if (errorAnomaly.isAnomaly) {
      anomalies.push({
        type: 'ERROR_SPIKE',
        severity: 'high',
        description: errorAnomaly.reason,
        errorCount: message.errorCount,
      });
    }
  }
  
  return anomalies;
}

module.exports = {
  analyzeMessage,
  detectPII,
  detectToxicContent,
  detectPromptInjection,
  analyzeTokenUsage,
  analyzeCostAnomaly,
  analyzeLatencyAnomaly,
  detectHallucination,
};
