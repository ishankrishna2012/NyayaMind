// ============================================================
// Netlify Function: api.js
// All routes from server.js — runs serverless (no dotenv needed,
// Netlify injects environment variables automatically).
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');

// ── Clients ──────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL || 'https://bpeokbocsxijbjnbtivp.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwZW9rYm9jc3hpamJqbmJ0aXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2OTM4MjksImV4cCI6MjA5MjI2OTgyOX0.0hXIn1w7jWjHjE5udsrpyULcKS-24A7kgGk0HUfH7sw';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const openaiApiKey = process.env.OPENAI_API_KEY; // MUST be set in Netlify Environment Variables
const openai = new OpenAI({ apiKey: openaiApiKey || 'dummy-key-to-prevent-crash' });

// ── CORS headers ─────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ── Main handler ─────────────────────────────────────────────
exports.handler = async (event) => {
  // Handle preflight OPTIONS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  // Extract the route from the path
  // Netlify rewrites /api/* → /.netlify/functions/api/:splat
  // event.path will be /.netlify/functions/api/cases etc.
  const rawPath = event.path || '';
  // Strip the function prefix to get the sub-route
  const route = rawPath
    .replace(/^\/.netlify\/functions\/api/, '')  // netlify call
    .replace(/^\/api/, '')                        // direct /api prefix
    || '/';

  const method = event.httpMethod;
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch (_) {}

  // ── GET /cases ─────────────────────────────────────────────
  if (route === '/cases' && method === 'GET') {
    try {
      const { q, type, limit = 200 } = event.queryStringParameters || {};
      let query = supabase.from('cases').select('*').order('views', { ascending: false }).limit(parseInt(limit));
      if (type && type !== 'all') query = query.ilike('type', `%${type}%`);
      if (q) query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%`);
      
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase timeout')), 3000));
      const { data, error } = await Promise.race([query, timeout]);
      if (error) throw error;
      return json(200, { success: true, total: data.length, cases: data });
    } catch (err) {
      try {
        const qdrantUrl = (process.env.QDRANT_URL || 'https://27d551b6-c3b1-43c9-bf03-8551f9648f2f.europe-west3-0.gcp.cloud.qdrant.io').replace(/^["']|["']$/g, '');
        const qdrantKey = (process.env.QDRANT_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIiwic3ViamVjdCI6ImFwaS1rZXk6OGM5ZDhiMWYtYTdmMC00NjRjLTliNjMtZWI3ZGVjYjg2ODk0In0.Bce4VNx_ABmlVEiL5GiDz5eTsZRyHjgE-ATE8-Gmn7g').replace(/^["']|["']$/g, '');
        const collection = (process.env.QDRANT_COLLECTION || 'Court Orders').replace(/^["']|["']$/g, '');
        if (!qdrantUrl || !qdrantKey) throw new Error("Qdrant not configured");
        
        const response = await fetch(`${qdrantUrl}/collections/${collection}/points/scroll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'api-key': qdrantKey },
          body: JSON.stringify({ limit: parseInt(event.queryStringParameters?.limit || 200), with_payload: true })
        });
        const qData = await response.json();
        if (!qData.result || !qData.result.points) throw new Error("Qdrant query failed");
        
        const cases = qData.result.points.map(p => {
           const pl = p.payload || {};
           return {
             id: p.id,
             title: pl.title || pl.case_title || 'Unknown Case',
             court: pl.court || 'Supreme Court',
             year: pl.year || 2024,
             type: pl.type || 'Case Law',
             summary: pl.summary || pl.text || '',
             keywords: pl.tags || pl.keywords || [],
             views: Math.floor(Math.random() * 5000) + 100,
             source: 'qdrant'
           };
        });
        return json(200, { success: true, total: cases.length, cases: cases });
      } catch (fallbackErr) {
        return json(500, { success: false, error: err.message, fallbackError: fallbackErr.message });
      }
    }
  }

  // ── GET /status ─────────────────────────────────────────────
  if (route === '/status' && method === 'GET') {
    try {
      const { count } = await supabase.from('cases').select('*', { count: 'exact', head: true });
      const { data: courtData } = await supabase.from('cases').select('court');
      const courtsCount = courtData ? new Set(courtData.map(c => c.court)).size : 0;
      return json(200, { success: true, total: count, courtsCount, lastUpdated: new Date().toISOString() });
    } catch (err) {
      return json(500, { success: false, error: err.message });
    }
  }

  // ── POST /auth/register ──────────────────────────────────────
  if (route === '/auth/register' && method === 'POST') {
    const { email, name, role, password } = body;
    if (!email || !name || !role) return json(400, { success: false, error: 'Missing required fields' });
    const pwd = password || Math.random().toString(36).slice(-10) + 'Aa1!';
    try {
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email, password: pwd, email_confirm: true, user_metadata: { name, role }
      });
      if (authErr) throw authErr;
      await supabaseAdmin.from('user_profiles').insert({
        id: authData.user.id, name, email, role, language: 'English', lang_code: 'en-IN'
      });
      const { data: session } = await supabaseAdmin.auth.signInWithPassword({ email, password: pwd });
      return json(200, {
        success: true,
        user: { id: authData.user.id, name, email, role },
        token: session?.session?.access_token,
        tempPassword: !password ? pwd : undefined
      });
    } catch (err) {
      return json(400, { success: false, error: err.message });
    }
  }

  // ── POST /auth/login ─────────────────────────────────────────
  if (route === '/auth/login' && method === 'POST') {
    const { email, password } = body;
    if (!email || !password) return json(400, { success: false, error: 'Missing credentials' });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const { data: profile } = await supabase.from('user_profiles').select('*').eq('id', data.user.id).single();
      return json(200, {
        success: true,
        token: data.session.access_token,
        user: profile || { email, name: data.user.user_metadata?.name || email.split('@')[0], role: 'public' }
      });
    } catch (err) {
      return json(401, { success: false, error: 'Invalid credentials' });
    }
  }

  // ── GET /auth/me ─────────────────────────────────────────────
  if (route === '/auth/me' && method === 'GET') {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    if (!token) return json(401, { error: 'No token' });
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) throw error || new Error('Invalid token');
      const { data: profile } = await supabase.from('user_profiles').select('*').eq('id', user.id).single();
      return json(200, { success: true, user: profile });
    } catch {
      return json(401, { success: false, error: 'Unauthorized' });
    }
  }

  // ── POST /chat ────────────────────────────────────────────────
  if (route === '/chat' && method === 'POST') {
    const { message, caseContext } = body;
    if (!message) return json(400, { success: false, error: 'Message required' });
    try {
      let system = 'You are NyayaMind, an expert Indian legal AI assistant. Be concise and accurate.';
      if (caseContext) system += ` The user is asking about: "${caseContext.title}" (${caseContext.court}, ${caseContext.year}). Summary: ${caseContext.summary}`;
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'system', content: system }, { role: 'user', content: message }],
        temperature: 0.7, max_tokens: 500
      });
      return json(200, { success: true, reply: completion.choices[0].message.content });
    } catch (err) {
      return json(500, { success: false, error: 'AI unavailable' });
    }
  }

  // ── POST /ai-search ───────────────────────────────────────────
  if (route === '/ai-search' && method === 'POST') {
    const { query } = body;
    if (!query) return json(400, { success: false, error: 'Query required' });
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Extract core Indian legal keywords from the query. Return ONLY comma-separated keywords. No prose.' },
          { role: 'user', content: query }
        ],
        temperature: 0.2, max_tokens: 60
      });
      return json(200, { success: true, optimized: completion.choices[0].message.content });
    } catch {
      return json(500, { success: false, error: 'Search AI unavailable' });
    }
  }

  // ── POST /tts ─────────────────────────────────────────────────
  if (route === '/tts' && method === 'POST') {
    const { text } = body;
    if (!text) return json(400, { success: false, error: 'Text required' });
    const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'xi-api-key': process.env.ELEVENLABS_API_KEY || 'sk_300d3e020f79917db233a0583a0239a30d734d9705581625',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text.slice(0, 2000),
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      });
      if (!response.ok) throw new Error('ElevenLabs error');
      const audioBuffer = await response.arrayBuffer();
      const base64Audio = Buffer.from(audioBuffer).toString('base64');
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'audio/mpeg' },
        body: base64Audio,
        isBase64Encoded: true
      };
    } catch (err) {
      return json(500, { success: false, error: 'TTS unavailable' });
    }
  }

  // ── 404 ───────────────────────────────────────────────────────
  return json(404, { error: `Route not found: ${method} ${route}` });
};
