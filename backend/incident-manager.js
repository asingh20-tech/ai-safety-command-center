const kafkaProducer = require('../kafka-integration/producer');
const anomalyDetector = require('../datadog-integration/anomaly-detector');
const { v4: uuidv4 } = require('uuid');

// Store for tracking metrics (in production, use a real database)
const metrics = {
  requests: [],
  responses: [],
  incidents: [],
};

/**
 * Handle incoming LLM request
 */
async function handleRequest(requestData) {
  try {
    const requestId = uuidv4();
    const timestamp = new Date().toISOString();

    const payload = {
      requestId,
      userId: requestData.userId || 'anonymous',
      model: requestData.model || 'unknown',
      prompt: requestData.prompt,
      timestamp,
      tokenCount: requestData.tokenCount,
      cost: requestData.cost || 0,
      metadata: requestData.metadata || {},
    };

    // Publish to Kafka
    await kafkaProducer.publishRequest(payload);

    // Store for metrics
    metrics.requests.push(payload);

    console.log(`✅ Request published: ${requestId}`);
    return { requestId, timestamp };
  } catch (error) {
    console.error('❌ Failed to handle request:', error.message);
    throw error;
  }
}

/**
 * Handle LLM response
 */
async function handleResponse(responseData) {
  try {
    const timestamp = new Date().toISOString();

    const payload = {
      requestId: responseData.requestId,
      response: responseData.response,
      model: responseData.model || 'unknown',
      latencyMs: responseData.latencyMs,
      completionTokens: responseData.completionTokens,
      totalTokens: responseData.totalTokens,
      confidenceScore: responseData.confidenceScore,
      timestamp,
    };

    // Publish to Kafka
    await kafkaProducer.publishResponse(payload);

    // Store metrics
    metrics.responses.push(payload);

    // Analyze for anomalies
    const analysisPayload = {
      ...responseData,
      ...getAverageMetrics('responses'),
    };

    const anomalies = anomalyDetector.analyzeMessage(analysisPayload);

    // Publish detected anomalies
    for (const anomaly of anomalies) {
      await publishAnomaly({
        ...anomaly,
        requestId: responseData.requestId,
        userId: responseData.userId,
      });
    }

    console.log(`✅ Response handled: ${responseData.requestId}`);
    return { success: true, anomalyCount: anomalies.length };
  } catch (error) {
    console.error('❌ Failed to handle response:', error.message);
    throw error;
  }
}

/**
 * Publish anomaly to Kafka
 */
async function publishAnomaly(anomalyData) {
  try {
    // Determine if this should trigger an alert
    const shouldAlert = ['critical', 'high'].includes(anomalyData.severity);

    if (shouldAlert) {
      // Publish to alerts topic
      await kafkaProducer.publishAlert({
        alertType: anomalyData.type,
        message: anomalyData.description,
        severity: anomalyData.severity,
        requestId: anomalyData.requestId,
        userId: anomalyData.userId,
        impactDescription: getAlertImpact(anomalyData.type),
        priority: anomalyData.severity === 'critical' ? 'urgent' : 'high',
      });

      // Track incident
      const incident = {
        id: uuidv4(),
        type: anomalyData.type,
        severity: anomalyData.severity,
        requestId: anomalyData.requestId,
        userId: anomalyData.userId,
        description: anomalyData.description,
        timestamp: new Date().toISOString(),
        status: 'open',
      };

      metrics.incidents.push(incident);
      console.log(`🚨 INCIDENT CREATED: ${incident.type} (${incident.id})`);

      return incident;
    }

    // Publish as regular anomaly
    await kafkaProducer.publishAnomaly(anomalyData);
    console.log(`⚠️  Anomaly detected: ${anomalyData.type}`);

    return null;
  } catch (error) {
    console.error('❌ Failed to publish anomaly:', error.message);
    throw error;
  }
}

/**
 * Get average metrics for comparison
 */
function getAverageMetrics(type) {
  if (type === 'responses' && metrics.responses.length > 0) {
    const latencies = metrics.responses
      .filter(r => r.latencyMs)
      .map(r => r.latencyMs);
    
    return {
      avgLatencyMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b) / latencies.length : 0,
    };
  }

  return {};
}

/**
 * Get impact description for alert type
 */
function getAlertImpact(alertType) {
  const impacts = {
    PII_LEAKAGE: 'Sensitive user data may have been exposed in model response',
    PROMPT_INJECTION: 'Potential security breach attempt detected',
    TOXIC_CONTENT: 'Model generated harmful or offensive content',
    COST_ANOMALY: 'Unexpected spike in API costs detected',
    PERFORMANCE_DEGRADATION: 'Service response times significantly degraded',
    HALLUCINATION: 'Model generated potentially false or misleading information',
    ERROR_SPIKE: 'Unusual number of errors detected',
    TOKEN_ANOMALY: 'Token usage abnormally high',
  };

  return impacts[alertType] || 'Anomaly detected in LLM behavior';
}

/**
 * Get recent incidents
 */
function getRecentIncidents(count = 10) {
  return metrics.incidents
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, count);
}

/**
 * Get incident details
 */
function getIncidentDetails(incidentId) {
  return metrics.incidents.find(i => i.id === incidentId);
}

/**
 * Close incident
 */
function closeIncident(incidentId, resolution) {
  const incident = metrics.incidents.find(i => i.id === incidentId);
  if (incident) {
    incident.status = 'closed';
    incident.resolution = resolution;
    incident.closedAt = new Date().toISOString();
    return incident;
  }
  return null;
}

/**
 * Get safety metrics
 */
function getSafetyMetrics() {
  const totalRequests = metrics.requests.length;
  const totalIncidents = metrics.incidents.length;
  const openIncidents = metrics.incidents.filter(i => i.status === 'open').length;
  
  const safetyScore = totalRequests > 0 
    ? Math.max(0, 100 - (totalIncidents / totalRequests) * 100)
    : 100;

  const byCriticalSeverity = metrics.incidents.filter(i => i.severity === 'critical').length;
  const byHighSeverity = metrics.incidents.filter(i => i.severity === 'high').length;

  return {
    totalRequests,
    totalIncidents,
    openIncidents,
    safetyScore: Math.round(safetyScore),
    criticalIncidents: byCriticalSeverity,
    highIncidents: byHighSeverity,
    mttr: calculateMTTR(), // Mean Time to Repair
  };
}

/**
 * Calculate Mean Time to Repair
 */
function calculateMTTR() {
  const closedIncidents = metrics.incidents.filter(i => i.status === 'closed' && i.closedAt);
  
  if (closedIncidents.length === 0) return 0;

  const repairs = closedIncidents.map(i => {
    const created = new Date(i.timestamp);
    const closed = new Date(i.closedAt);
    return (closed - created) / 60000; // Convert to minutes
  });

  return Math.round(repairs.reduce((a, b) => a + b) / repairs.length);
}

/**
 * Get cost analytics
 */
function getCostAnalytics() {
  const totalCost = metrics.requests.reduce((sum, req) => sum + (req.cost || 0), 0);
  const avgCostPerRequest = metrics.requests.length > 0 ? totalCost / metrics.requests.length : 0;
  
  // Group by user
  const costByUser = {};
  metrics.requests.forEach(req => {
    const userId = req.userId || 'anonymous';
    costByUser[userId] = (costByUser[userId] || 0) + (req.cost || 0);
  });

  // Group by model
  const costByModel = {};
  metrics.requests.forEach(req => {
    const model = req.model || 'unknown';
    costByModel[model] = (costByModel[model] || 0) + (req.cost || 0);
  });

  return {
    totalCost: parseFloat(totalCost.toFixed(2)),
    avgCostPerRequest: parseFloat(avgCostPerRequest.toFixed(4)),
    costByUser,
    costByModel,
  };
}

module.exports = {
  handleRequest,
  handleResponse,
  publishAnomaly,
  getRecentIncidents,
  getIncidentDetails,
  closeIncident,
  getSafetyMetrics,
  getCostAnalytics,
};
