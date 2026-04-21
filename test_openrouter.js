const {OpenAI} = require('openai'); require('dotenv').config(); 
const openaiApiKey = process.env.OPENROUTER_API_KEY.replace(/\"/g, '');
const openai = new OpenAI({ 
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: openaiApiKey,
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "NyayaMind"
  }
});
openai.chat.completions.create({
  model: 'google/gemma-2-9b-it:free', 
  messages: [{role: 'user', content: 'hello'}], 
  max_tokens: 10
}).then(r => console.log(r.choices[0].message)).catch(console.error)
