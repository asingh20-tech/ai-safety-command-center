require('dotenv').config({ path: '../.env' });

console.log('🔍 Verifying Setup...\n');

const key = process.env.GOOGLE_AI_API_KEY;

if (key && key.startsWith('AIza')) {
  console.log('✅ Google AI Key: ' + key.substring(0, 20) + '...');
  console.log('✅ Key length: ' + key.length + ' characters');
} else {
  console.log('❌ Google AI Key: NOT SET or INVALID');
}

console.log('\n💡 Next: Get Confluent, Datadog, and ElevenLabs keys!');
