require('dotenv').config({ path: '../.env' });
const axios = require('axios');

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

const elevenlabsAxios = axios.create({
  baseURL: ELEVENLABS_API,
  headers: {
    'xi-api-key': process.env.ELEVENLABS_API_KEY,
  },
});

/**
 * Convert text to speech using ElevenLabs
 * Returns audio buffer
 */
async function textToSpeech(text, voiceId = null) {
  try {
    const voice = voiceId || process.env.ELEVENLABS_VOICE_ID;
    
    if (!voice) {
      throw new Error('Voice ID not configured');
    }

    const response = await elevenlabsAxios.post(
      `/text-to-speech/${voice}`,
      {
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      },
      {
        responseType: 'arraybuffer',
      }
    );

    return response.data;
  } catch (error) {
    console.error('❌ Text-to-speech conversion failed:', error.message);
    throw error;
  }
}

/**
 * Get available voices
 */
async function getAvailableVoices() {
  try {
    const response = await elevenlabsAxios.get('/voices');
    return response.data.voices;
  } catch (error) {
    console.error('❌ Failed to fetch voices:', error.message);
    throw error;
  }
}

/**
 * Check API usage
 */
async function checkUsage() {
  try {
    const response = await elevenlabsAxios.get('/user/subscription');
    return {
      characterCount: response.data.character_count,
      characterLimit: response.data.character_limit,
      charsUsed: response.data.character_count,
      percentUsed: (response.data.character_count / response.data.character_limit) * 100,
    };
  } catch (error) {
    console.error('❌ Failed to check usage:', error.message);
    throw error;
  }
}

module.exports = {
  textToSpeech,
  getAvailableVoices,
  checkUsage,
};
