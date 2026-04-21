const {OpenAI} = require('openai'); require('dotenv').config();
const openaiApiKey = process.env.OPENROUTER_API_KEY.replace(/\"/g, '');
const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: openaiApiKey });

async function test(modelName) {
  try {
    const r = await openai.chat.completions.create({
      model: modelName,
      messages: [{role: 'user', content: 'hello'}], max_tokens: 10
    });
    console.log(`✅ ${modelName} Works!`);
  } catch (err) {
    console.log(`❌ ${modelName} Failed:`, err.message);
  }
}

(async () => {
  await test('qwen/qwen-2.5-72b-instruct:free');
  await test('deepseek/deepseek-chat:free');
  await test('google/gemini-2.0-flash-exp:free');
  await test('meta-llama/llama-3-8b-instruct:free');
})();
