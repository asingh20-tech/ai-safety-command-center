require('dotenv').config({ path: '../.env' });
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);

/**
 * Query Datadog using natural language via Gemini
 */
async function queryDatadog(userQuery, datadogContext) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `You are an AI safety expert analyzing LLM monitoring data. 
User asked: "${userQuery}"

Current Datadog Context:
${JSON.stringify(datadogContext, null, 2)}

Provide a concise, actionable answer. If there are safety issues, explain the severity and recommended actions.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('❌ Gemini query failed:', error.message);
    return 'I encountered an error analyzing the data. Please try again.';
  }
}

/**
 * Summarize incidents using Gemini
 */
async function summarizeIncidents(incidents) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `Summarize these LLM safety incidents concisely for an engineer:

${JSON.stringify(incidents, null, 2)}

Provide a 2-3 sentence summary of key issues and recommended actions.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('❌ Incident summarization failed:', error.message);
    return 'Unable to summarize incidents at this time.';
  }
}

/**
 * Generate root cause analysis
 */
async function analyzeRootCause(incident, relatedMetrics) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `As an AI safety expert, analyze the root cause of this incident:

Incident: ${JSON.stringify(incident, null, 2)}

Related Metrics:
${JSON.stringify(relatedMetrics, null, 2)}

Provide:
1. Root cause hypothesis
2. Contributing factors
3. Recommended remediation steps
4. Prevention measures`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('❌ Root cause analysis failed:', error.message);
    return 'Unable to perform analysis at this time.';
  }
}

/**
 * Generate natural language response for voice output
 */
async function generateVoiceResponse(userQuery, analysisData) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `Generate a clear, spoken-friendly response to this engineer query:

Query: "${userQuery}"

Data: ${JSON.stringify(analysisData, null, 2)}

Keep it conversational, concise, and actionable. Suitable for text-to-speech.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('❌ Voice response generation failed:', error.message);
    return 'I could not generate a response. Please try again.';
  }
}

/**
 * Suggest remediation steps
 */
async function suggestRemediation(anomalyType, severity, context) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `As an LLM safety expert, suggest immediate remediation steps for this issue:

Type: ${anomalyType}
Severity: ${severity}
Context: ${JSON.stringify(context, null, 2)}

Provide:
1. Immediate actions (next 5 minutes)
2. Short-term fixes (next 1 hour)
3. Long-term improvements (this week)
4. Monitoring to add`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('❌ Remediation suggestion failed:', error.message);
    return 'Unable to suggest remediation at this time.';
  }
}

module.exports = {
  queryDatadog,
  summarizeIncidents,
  analyzeRootCause,
  generateVoiceResponse,
  suggestRemediation,
};
