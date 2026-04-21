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
  await test('google/gemini-2.0-flash-lite-preview-02-05:free');
  await test('meta-llama/llama-3.1-8b-instruct:free');
  await test('meta-llama/llama-3.2-3b-instruct:free');
  await test('huggingfaceh4/zephyr-7b-beta:free');
  await test('mistralai/mistral-7b-instruct:free');
})();
