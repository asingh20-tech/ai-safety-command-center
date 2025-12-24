require('dotenv').config({ path: '../.env' });
const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'llm-producer',
  brokers: [process.env.CONFLUENT_BOOTSTRAP_SERVER],
  ssl: true,
  sasl: {
    mechanism: 'plain',
    username: process.env.CONFLUENT_API_KEY,
    password: process.env.CONFLUENT_API_SECRET,
  },
});

const producer = kafka.producer();

// Topic configurations
const TOPICS = {
  LLM_REQUESTS: 'llm-requests',
  LLM_RESPONSES: 'llm-responses',
  LLM_ANOMALIES: 'llm-anomalies',
  LLM_ALERTS: 'llm-alerts',
};

/**
 * Initialize producer and create topics
 */
async function initialize() {
  try {
    await producer.connect();
    console.log('✅ Kafka Producer Connected');
    
    // Create topics if they don't exist
    const admin = kafka.admin();
    await admin.connect();
    
    const topics = Object.values(TOPICS);
    await admin.createTopics({
      topics: topics.map(topic => ({
        topic,
        numPartitions: 3,
        replicationFactor: 1,
      })),
      validateOnly: false,
      timeout: 30000,
    }).catch(err => {
      // Topics may already exist, which is fine
      if (!err.message.includes('already exists')) {
        console.error('Topic creation error:', err.message);
      }
    });
    
    await admin.disconnect();
    console.log('✅ Topics ready:', Object.keys(TOPICS));
  } catch (error) {
    console.error('❌ Producer initialization failed:', error.message);
    throw error;
  }
}

/**
 * Publish LLM request to Kafka
 */
async function publishRequest(requestData) {
  try {
    await producer.send({
      topic: TOPICS.LLM_REQUESTS,
      messages: [
        {
          key: requestData.userId || 'unknown',
          value: JSON.stringify({
            ...requestData,
            timestamp: new Date().toISOString(),
            type: 'request',
          }),
        },
      ],
    });
  } catch (error) {
    console.error('❌ Failed to publish request:', error.message);
    throw error;
  }
}

/**
 * Publish LLM response to Kafka
 */
async function publishResponse(responseData) {
  try {
    await producer.send({
      topic: TOPICS.LLM_RESPONSES,
      messages: [
        {
          key: responseData.requestId,
          value: JSON.stringify({
            ...responseData,
            timestamp: new Date().toISOString(),
            type: 'response',
          }),
        },
      ],
    });
  } catch (error) {
    console.error('❌ Failed to publish response:', error.message);
    throw error;
  }
}

/**
 * Publish detected anomaly to Kafka
 */
async function publishAnomaly(anomalyData) {
  try {
    await producer.send({
      topic: TOPICS.LLM_ANOMALIES,
      messages: [
        {
          key: anomalyData.type,
          value: JSON.stringify({
            ...anomalyData,
            timestamp: new Date().toISOString(),
            severity: anomalyData.severity || 'medium',
          }),
        },
      ],
    });
  } catch (error) {
    console.error('❌ Failed to publish anomaly:', error.message);
    throw error;
  }
}

/**
 * Publish critical alert to Kafka
 */
async function publishAlert(alertData) {
  try {
    await producer.send({
      topic: TOPICS.LLM_ALERTS,
      messages: [
        {
          key: alertData.alertType,
          value: JSON.stringify({
            ...alertData,
            timestamp: new Date().toISOString(),
            priority: alertData.priority || 'high',
          }),
        },
      ],
    });
  } catch (error) {
    console.error('❌ Failed to publish alert:', error.message);
    throw error;
  }
}

/**
 * Disconnect producer
 */
async function disconnect() {
  try {
    await producer.disconnect();
    console.log('✅ Producer disconnected');
  } catch (error) {
    console.error('❌ Error disconnecting producer:', error.message);
  }
}

module.exports = {
  initialize,
  publishRequest,
  publishResponse,
  publishAnomaly,
  publishAlert,
  disconnect,
  TOPICS,
};
