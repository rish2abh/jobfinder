/**
 * Step 1: Sanity check — confirm Gemini API connectivity and basic function calling.
 *
 * Run: npx ts-node -r tsconfig-paths/register src/scripts/test-gemini.ts
 */
import axios from 'axios';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../.env') });

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_ORCHESTRATOR_MODEL || 'gemini-2.5-flash';

if (!API_KEY) {
  console.error('❌ GEMINI_API_KEY is not set in .env');
  process.exit(1);
}

async function main() {
  console.log(`\n🔑 API Key: ${API_KEY!.slice(0, 8)}...`);
  console.log(`🤖 Model: ${MODEL}`);
  console.log('─'.repeat(50));

  // Test 1: Basic text generation
  console.log('\n📝 Test 1: Basic text generation...');
  try {
    const resp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        contents: [{ role: 'user', parts: [{ text: 'Say "hello" in JSON format: {"greeting":"hello"}' }] }],
        generationConfig: { maxOutputTokens: 100 },
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 },
    );

    const candidate = resp.data?.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;
    const usage = resp.data?.usageMetadata;
    console.log(`  ✅ Response: ${text?.slice(0, 100)}`);
    console.log(`  📊 Tokens: prompt=${usage?.promptTokenCount}, completion=${usage?.candidatesTokenCount}`);
  } catch (err: any) {
    console.error(`  ❌ Failed: ${err?.response?.data?.error?.message ?? err.message}`);
    process.exit(1);
  }

  // Test 2: Function calling
  console.log('\n🔧 Test 2: Function calling...');
  try {
    const tools = [{
      functionDeclarations: [{
        name: 'get_weather',
        description: 'Get weather for a city',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name' },
          },
          required: ['city'],
        },
      }],
    }];

    const resp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        contents: [{ role: 'user', parts: [{ text: 'What is the weather in Tokyo?' }] }],
        tools,
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: { maxOutputTokens: 200 },
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 },
    );

    const candidate = resp.data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const functionCall = parts.find((p: any) => p.functionCall);
    const usage = resp.data?.usageMetadata;

    if (functionCall) {
      console.log(`  ✅ Function called: ${functionCall.functionCall.name}`);
      console.log(`  📦 Args: ${JSON.stringify(functionCall.functionCall.args)}`);
    } else {
      const textPart = parts.find((p: any) => p.text);
      console.log(`  ⚠️  No function call — got text instead: ${textPart?.text?.slice(0, 80)}`);
    }
    console.log(`  📊 Tokens: prompt=${usage?.promptTokenCount}, completion=${usage?.candidatesTokenCount}`);
  } catch (err: any) {
    console.error(`  ❌ Failed: ${err?.response?.data?.error?.message ?? err.message}`);
    process.exit(1);
  }

  // Test 3: Multi-turn with function response
  console.log('\n🔄 Test 3: Multi-turn with function response...');
  try {
    const tools = [{
      functionDeclarations: [{
        name: 'search_jobs',
        description: 'Search for jobs',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['search'] },
            skills: { type: 'array', items: { type: 'string' } },
          },
          required: ['action'],
        },
      }],
    }];

    const messages: Array<{ role: string; parts: any[] }> = [
      { role: 'user', parts: [{ text: 'Find React developer jobs for me' }] },
    ];

    // First call — expect function call
    const resp1 = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        systemInstruction: { parts: [{ text: 'You are a job search assistant. Use available tools.' }] },
        contents: messages,
        tools,
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: { maxOutputTokens: 500 },
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 },
    );

    const candidate1 = resp1.data?.candidates?.[0];
    const parts1 = candidate1?.content?.parts || [];
    const fc = parts1.find((p: any) => p.functionCall);

    if (!fc) {
      console.log('  ⚠️  No function call on first turn — model responded with text directly');
    } else {
      console.log(`  ✅ First turn: called ${fc.functionCall.name}(${JSON.stringify(fc.functionCall.args)})`);

      // Second call — feed the function response back
      messages.push({ role: 'model', parts: [{ functionCall: fc.functionCall }] });
      messages.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: fc.functionCall.name,
            response: { jobs: [{ title: 'React Dev', company: 'Acme', score: 92 }], total: 1 },
          },
        }] as any,
      });

      const resp2 = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
        {
          systemInstruction: { parts: [{ text: 'You are a job search assistant. Summarize results concisely.' }] },
          contents: messages,
          tools,
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          generationConfig: { maxOutputTokens: 500 },
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 30000 },
      );

      const candidate2 = resp2.data?.candidates?.[0];
      const text2 = candidate2?.content?.parts?.find((p: any) => p.text)?.text;
      console.log(`  ✅ Second turn (final response): ${text2?.slice(0, 120)}`);
    }
  } catch (err: any) {
    console.error(`  ❌ Failed: ${err?.response?.data?.error?.message ?? err.message}`);
    process.exit(1);
  }

  console.log('\n' + '─'.repeat(50));
  console.log('✅ All Gemini tests passed!\n');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
