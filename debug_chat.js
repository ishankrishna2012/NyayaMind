require('dotenv').config();

const { OpenAI } = require('openai');

let apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
if (apiKey) apiKey = apiKey.replace(/"/g, '');

console.log('Key present:', !!apiKey);
console.log('Key prefix:', apiKey ? apiKey.substring(0, 15) + '...' : 'NONE');

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: apiKey || 'dummy',
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "NyayaMind"
  }
});

openai.chat.completions.create({
  model: 'openrouter/free',
  messages: [{ role: 'user', content: 'hello' }],
  max_tokens: 20
}).then(r => {
  console.log('SUCCESS:', r.choices[0].message.content);
}).catch(err => {
  console.error('ERROR status:', err.status);
  console.error('ERROR message:', err.message);
  console.error('ERROR details:', JSON.stringify(err.error, null, 2));
});
