require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const kafkaProducer = require('../kafka-integration/producer');
const incidentManager = require('./incident-manager');
const geminiHandler = require('./gemini-handler');
const voiceSynthesis = require('./voice-synthesis');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// LLM Monitoring Endpoints
// ============================================

/**
 * POST /api/llm/request
 * Submit a new LLM request for monitoring
 */
app.post('/api/llm/request', async (req, res) => {
  try {
    const { userId, model, prompt, tokenCount, cost, metadata } = req.body;

    if (!prompt || !model) {
      return res.status(400).json({
        error: 'Missing required fields: prompt, model',
      });
    }

    const result = await incidentManager.handleRequest({
      userId,
      model,
      prompt,
      tokenCount,
      cost,
      metadata,
    });

    res.json({
      success: true,
      requestId: result.requestId,
      timestamp: result.timestamp,
    });
  } catch (error) {
    console.error('Request handling error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/llm/response
 * Submit LLM response with analysis
 */
app.post('/api/llm/response', async (req, res) => {
  try {
    const {
      requestId,
      userId,
      model,
      response,
      latencyMs,
      completionTokens,
      totalTokens,
      confidenceScore,
    } = req.body;

    if (!requestId || !response) {
      return res.status(400).json({
        error: 'Missing required fields: requestId, response',
      });
    }

    const result = await incidentManager.handleResponse({
      requestId,
      userId,
      model,
      response,
      latencyMs,
      completionTokens,
      totalTokens,
      confidenceScore,
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Response handling error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Analytics & Metrics Endpoints
// ============================================

/**
 * GET /api/metrics/safety
 * Get current safety metrics and scores
 */
app.get('/api/metrics/safety', (req, res) => {
  try {
    const metrics = incidentManager.getSafetyMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/metrics/cost
 * Get cost analytics
 */
app.get('/api/metrics/cost', (req, res) => {
  try {
    const analytics = incidentManager.getCostAnalytics();
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Incident Management Endpoints
// ============================================

/**
 * GET /api/incidents
 * Get recent incidents
 */
app.get('/api/incidents', (req, res) => {
  try {
    const count = req.query.count || 10;
    const incidents = incidentManager.getRecentIncidents(parseInt(count));
    res.json({ incidents, count: incidents.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/incidents/:id
 * Get specific incident details
 */
app.get('/api/incidents/:id', (req, res) => {
  try {
    const incident = incidentManager.getIncidentDetails(req.params.id);
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }
    res.json(incident);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/incidents/:id/close
 * Close an incident with resolution
 */
app.post('/api/incidents/:id/close', (req, res) => {
  try {
    const { resolution } = req.body;
    const incident = incidentManager.closeIncident(req.params.id, resolution);
    
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }
    
    res.json({ success: true, incident });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Voice & Natural Language Endpoints
// ============================================

/**
 * POST /api/voice/query
 * Query using natural language via Gemini
 */
app.post('/api/voice/query', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Missing query parameter' });
    }

    // Get relevant data for context
    const metrics = incidentManager.getSafetyMetrics();
    const incidents = incidentManager.getRecentIncidents(5);
    const costAnalytics = incidentManager.getCostAnalytics();

    const context = {
      metrics,
      recentIncidents: incidents,
      costAnalytics,
    };

    const response = await geminiHandler.queryDatadog(query, context);

    res.json({
      query,
      response,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Voice query error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/voice/speak
 * Convert response to speech using ElevenLabs
 */
app.post('/api/voice/speak', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Missing text parameter' });
    }

    const audioBuffer = await voiceSynthesis.textToSpeech(text);

    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Length', audioBuffer.length);
    res.send(audioBuffer);
  } catch (error) {
    console.error('Text-to-speech error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/voice/usage
 * Check voice synthesis API usage
 */
app.get('/api/voice/usage', async (req, res) => {
  try {
    const usage = await voiceSynthesis.checkUsage();
    res.json(usage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Analysis Endpoints
// ============================================

/**
 * POST /api/analysis/summarize
 * Summarize recent incidents
 */
app.post('/api/analysis/summarize', async (req, res) => {
  try {
    const incidents = incidentManager.getRecentIncidents(10);
    const summary = await geminiHandler.summarizeIncidents(incidents);

    res.json({
      incidentCount: incidents.length,
      summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Summarization error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analysis/root-cause
 * Analyze root cause of an incident
 */
app.post('/api/analysis/root-cause', async (req, res) => {
  try {
    const { incidentId } = req.body;

    const incident = incidentManager.getIncidentDetails(incidentId);
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    // Get related metrics for context
    const metrics = incidentManager.getSafetyMetrics();
    const costAnalytics = incidentManager.getCostAnalytics();

    const analysis = await geminiHandler.analyzeRootCause(incident, {
      metrics,
      costAnalytics,
    });

    res.json({
      incidentId,
      analysis,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Root cause analysis error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Error Handling
// ============================================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// ============================================
// Server Startup
// ============================================

async function startServer() {
  try {
    // Initialize Kafka producer
    await kafkaProducer.initialize();

    app.listen(PORT, () => {
      console.log(`✅ AI Safety Command Center running on port ${PORT}`);
      console.log(`📊 Dashboard: http://localhost:${PORT}`);
      console.log(`🔧 API: http://localhost:${PORT}/api`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⏹️  Shutting down gracefully...');
  try {
    await kafkaProducer.disconnect();
    console.log('✅ Kafka disconnected');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error.message);
    process.exit(1);
  }
});

startServer();

module.exports = app;
