require('dotenv').config({ path: '../.env' });
const { Kafka } = require('kafkajs');
const axios = require('axios');

const kafka = new Kafka({
  clientId: 'llm-consumer',
  brokers: [process.env.CONFLUENT_BOOTSTRAP_SERVER],
  ssl: true,
  sasl: {
    mechanism: 'plain',
    username: process.env.CONFLUENT_API_KEY,
    password: process.env.CONFLUENT_API_SECRET,
  },
});

const consumer = kafka.consumer({ groupId: 'datadog-consumer-group' });

const DATADOG_API = process.env.DATADOG_SITE
  ? `https://api.${process.env.DATADOG_SITE}`
  : 'https://api.us5.datadoghq.com';

const datadogAxios = axios.create({
  baseURL: DATADOG_API,
  headers: {
    'DD-API-KEY': process.env.DATADOG_API_KEY,
    'DD-APPLICATION-KEY': process.env.DATADOG_APP_KEY,
  },
});

/**
 * Initialize consumer
 */
async function initialize() {
  try {
    await consumer.connect();
    console.log('✅ Kafka Consumer Connected');
    
    // Subscribe to all relevant topics
    await consumer.subscribe({
      topics: [
        'llm-requests',
        'llm-responses',
        'llm-anomalies',
        'llm-alerts',
      ],
      fromBeginning: true,
    });
    
    console.log('✅ Subscribed to topics');
  } catch (error) {
    console.error('❌ Consumer initialization failed:', error.message);
    throw error;
  }
}

/**
 * Send metric to Datadog
 */
async function sendMetricToDatadog(metricName, value, tags = {}) {
  try {
    const payload = {
      series: [
        {
          metric: `llm_monitoring.${metricName}`,
          points: [[Math.floor(Date.now() / 1000), value]],
          type: 'gauge',
          tags: Object.entries(tags).map(([k, v]) => `${k}:${v}`),
        },
      ],
    };

    await datadogAxios.post('/api/v1/series', payload);
  } catch (error) {
    console.error(`❌ Failed to send metric ${metricName}:`, error.message);
  }
}

/**
 * Send event to Datadog
 */
async function sendEventToDatadog(eventData) {
  try {
    const payload = {
      title: eventData.title,
      text: eventData.description,
      tags: eventData.tags || [],
      alert_type: eventData.severity || 'info',
      priority: eventData.priority,
    };

    await datadogAxios.post('/api/v1/events', payload);
  } catch (error) {
    console.error('❌ Failed to send event to Datadog:', error.message);
  }
}

/**
 * Process LLM request message
 */
async function processRequest(message) {
  try {
    const data = JSON.parse(message.value.toString());
    
    // Send metrics to Datadog
    await sendMetricToDatadog('request_count', 1, {
      user_id: data.userId,
      model: data.model,
    });

    if (data.tokenCount) {
      await sendMetricToDatadog('token_usage', data.tokenCount, {
        model: data.model,
      });
    }

    if (data.cost) {
      await sendMetricToDatadog('request_cost', data.cost, {
        model: data.model,
      });
    }

    // Send event for tracking
    if (data.priority === 'high') {
      await sendEventToDatadog({
        title: 'High Priority LLM Request',
        description: `Request from ${data.userId}: ${data.prompt?.substring(0, 100)}...`,
        tags: [`user:${data.userId}`, `model:${data.model}`],
        priority: 'normal',
      });
    }
  } catch (error) {
    console.error('❌ Error processing request:', error.message);
  }
}

/**
 * Process LLM response message
 */
async function processResponse(message) {
  try {
    const data = JSON.parse(message.value.toString());
    
    // Send metrics
    await sendMetricToDatadog('response_latency_ms', data.latencyMs, {
      model: data.model,
      status: data.status,
    });

    if (data.completionTokens) {
      await sendMetricToDatadog('completion_tokens', data.completionTokens, {
        model: data.model,
      });
    }

    // Check for confidence/hallucination signals
    if (data.confidenceScore !== undefined && data.confidenceScore < 0.5) {
      await sendEventToDatadog({
        title: 'Low Confidence Response Detected',
        description: `Response confidence: ${data.confidenceScore}. Possible hallucination risk.`,
        tags: ['anomaly:confidence', `model:${data.model}`],
        severity: 'warning',
        priority: 'normal',
      });
    }
  } catch (error) {
    console.error('❌ Error processing response:', error.message);
  }
}

/**
 * Process anomaly message
 */
async function processAnomaly(message) {
  try {
    const data = JSON.parse(message.value.toString());
    
    // Send metrics
    await sendMetricToDatadog('anomaly_detected', 1, {
      anomaly_type: data.type,
      severity: data.severity,
    });

    // Create critical event in Datadog
    await sendEventToDatadog({
      title: `Security Alert: ${data.type}`,
      description: data.description || `Anomaly detected: ${data.type}`,
      tags: [
        `anomaly:${data.type}`,
        `severity:${data.severity}`,
        `user:${data.userId}`,
      ],
      severity: data.severity === 'critical' ? 'error' : 'warning',
      priority: data.severity === 'critical' ? 'urgent' : 'normal',
    });
  } catch (error) {
    console.error('❌ Error processing anomaly:', error.message);
  }
}

/**
 * Process alert message
 */
async function processAlert(message) {
  try {
    const data = JSON.parse(message.value.toString());
    
    // Send critical event
    await sendEventToDatadog({
      title: `🚨 CRITICAL: ${data.alertType}`,
      description: `${data.message}. Impact: ${data.impactDescription}`,
      tags: [
        `alert:${data.alertType}`,
        `priority:${data.priority}`,
      ],
      severity: 'error',
      priority: 'urgent',
    });

    // Send metric for alert tracking
    await sendMetricToDatadog('critical_alert_count', 1, {
      alert_type: data.alertType,
    });
  } catch (error) {
    console.error('❌ Error processing alert:', error.message);
  }
}

/**
 * Start consuming messages
 */
async function startConsuming() {
  try {
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        console.log(`📨 Message from ${topic} [${partition}]`);
        
        switch (topic) {
          case 'llm-requests':
            await processRequest(message);
            break;
          case 'llm-responses':
            await processResponse(message);
            break;
          case 'llm-anomalies':
            await processAnomaly(message);
            break;
          case 'llm-alerts':
            await processAlert(message);
            break;
          default:
            console.log('Unknown topic:', topic);
        }
      },
    });
    console.log('✅ Consumer running...');
  } catch (error) {
    console.error('❌ Consumer error:', error.message);
  }
}

/**
 * Disconnect consumer
 */
async function disconnect() {
  try {
    await consumer.disconnect();
    console.log('✅ Consumer disconnected');
  } catch (error) {
    console.error('❌ Error disconnecting consumer:', error.message);
  }
}

module.exports = {
  initialize,
  startConsuming,
  disconnect,
  sendMetricToDatadog,
  sendEventToDatadog,
};
