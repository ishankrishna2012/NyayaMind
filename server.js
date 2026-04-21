require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Supabase clients ────────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL || 'https://bpeokbocsxijbjnbtivp.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwZW9rYm9jc3hpamJqbmJ0aXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2OTM4MjksImV4cCI6MjA5MjI2OTgyOX0.0hXIn1w7jWjHjE5udsrpyULcKS-24A7kgGk0HUfH7sw';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
const openaiApiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
const openai = new OpenAI({ 
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: openaiApiKey || 'dummy-key-to-prevent-crash',
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "NyayaMind"
  }
});

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP off for inline scripts in index.html
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname)));

// Rate limiters
const apiLimiter    = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, message: { error: 'Too many requests' } });
const authLimiter   = rateLimit({ windowMs: 15 * 60 * 1000, max: 20,  message: { error: 'Too many auth attempts' } });
const aiLimiter     = rateLimit({ windowMs: 60 * 1000,       max: 15,  message: { error: 'AI rate limit hit' } });

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/chat', aiLimiter);
app.use('/api/ai-search', aiLimiter);
app.use('/api/tts', aiLimiter);

// ─── Helpers ─────────────────────────────────────────────────────────────────
let fetchStatus = { fetching: false, pagesLoaded: 0, totalFetched: 0, error: null };

function handleValidationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ error: errors.array()[0].msg }); return true; }
  return false;
}

// ─── GET /api/cases ───────────────────────────────────────────────────────────
app.get('/api/cases', async (req, res) => {
  const { q, type, limit = 200 } = req.query;
  try {
    let query = supabase.from('cases').select('*').order('views', { ascending: false }).limit(parseInt(limit));
    if (type && type !== 'all') query = query.ilike('type', `%${type}%`);
    if (q) query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%`);
    
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase timeout')), 3000));
    const { data, error } = await Promise.race([query, timeout]);
    if (error) throw error;
    res.json({ success: true, total: data.length, cases: data, fetchStatus });
  } catch (err) {
    try {
      const qdrantUrl = (process.env.QDRANT_URL || '').replace(/^["']|["']$/g, '');
      const qdrantKey = (process.env.QDRANT_API_KEY || '').replace(/^["']|["']$/g, '');
      const collection = (process.env.QDRANT_COLLECTION || 'Court Orders').replace(/^["']|["']$/g, '');
      if (!qdrantUrl || !qdrantKey) throw new Error("Qdrant not configured");
      
      const response = await fetch(`${qdrantUrl}/collections/${collection}/points/scroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': qdrantKey },
        body: JSON.stringify({ limit: parseInt(limit) || 200, with_payload: true })
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
      res.json({ success: true, total: cases.length, cases: cases, fetchStatus });
    } catch (fallbackErr) {
      res.status(500).json({ success: false, error: err.message, fallbackError: fallbackErr.message });
    }
  }
});

// ─── GET /api/status (live stats) ─────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  try {
    const { count } = await supabase.from('cases').select('*', { count: 'exact', head: true });
    const { data: courtData } = await supabase.from('cases').select('court');
    const courtsCount = courtData ? new Set(courtData.map(c => c.court)).size : 0;
    res.json({ success: true, total: count, courtsCount, fetchStatus, lastUpdated: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/auth/register ──────────────────────────────────────────────────
app.post('/api/auth/register',
  body('email').isEmail().normalizeEmail(),
  body('name').trim().isLength({ min: 2, max: 80 }),
  body('role').isIn(['public', 'professional']),
  async (req, res) => {
    if (handleValidationErrors(req, res)) return;
    const { email, name, role, password } = req.body;
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
      res.json({ success: true, user: { id: authData.user.id, name, email, role }, token: session?.session?.access_token, tempPassword: !password ? pwd : undefined });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
app.post('/api/auth/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    if (handleValidationErrors(req, res)) return;
    const { email, password } = req.body;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const { data: profile } = await supabase.from('user_profiles').select('*').eq('id', data.user.id).single();
      res.json({ success: true, token: data.session.access_token, user: profile || { email, name: data.user.user_metadata?.name || email.split('@')[0], role: 'public' } });
    } catch (err) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
  }
);

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
app.get('/api/auth/me', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) throw error || new Error('Invalid token');
    const { data: profile } = await supabase.from('user_profiles').select('*').eq('id', user.id).single();
    res.json({ success: true, user: profile });
  } catch {
    res.status(401).json({ success: false, error: 'Unauthorized' });
  }
});

// ─── POST /api/chat ───────────────────────────────────────────────────────────
app.post('/api/chat',
  body('message').trim().isLength({ min: 1, max: 2000 }),
  async (req, res) => {
    if (handleValidationErrors(req, res)) return;
    const { message, caseContext } = req.body;
    try {
      let system = 'You are NyayaMind, an expert Indian legal AI assistant. Be concise and accurate.';
      if (caseContext) system += ` The user is asking about: "${caseContext.title}" (${caseContext.court}, ${caseContext.year}). Summary: ${caseContext.summary}`;
      const completion = await openai.chat.completions.create({
        model: process.env.AI_MODEL || 'openrouter/free', messages: [{ role: 'system', content: system }, { role: 'user', content: message }],
        temperature: 0.7, max_tokens: 500
      });
      res.json({ success: true, reply: completion.choices[0].message.content });
    } catch (err) {
      res.status(500).json({ success: false, error: 'AI unavailable' });
    }
  }
);

// ─── POST /api/ai-search ──────────────────────────────────────────────────────
app.post('/api/ai-search',
  body('query').trim().isLength({ min: 1, max: 500 }),
  async (req, res) => {
    if (handleValidationErrors(req, res)) return;
    try {
      const completion = await openai.chat.completions.create({
        model: process.env.AI_MODEL || 'openrouter/free', messages: [
          { role: 'system', content: 'Extract core Indian legal keywords from the query. Return ONLY comma-separated keywords. No prose.' },
          { role: 'user', content: req.body.query }
        ], temperature: 0.2, max_tokens: 60
      });
      res.json({ success: true, optimized: completion.choices[0].message.content });
    } catch {
      res.status(500).json({ success: false, error: 'Search AI unavailable' });
    }
  }
);

// ─── POST /api/tts ────────────────────────────────────────────────────────────
app.post('/api/tts', body('text').trim().isLength({ min: 1, max: 3000 }), async (req, res) => {
  if (handleValidationErrors(req, res)) return;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: { 'Accept': 'audio/mpeg', 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: req.body.text.slice(0, 2000), model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
    });
    if (!response.ok) throw new Error('ElevenLabs error');
    res.setHeader('Content-Type', 'audio/mpeg');
    const reader = response.body.getReader();
    const pump = async () => { const { done, value } = await reader.read(); if (done) { res.end(); return; } res.write(value); pump(); };
    pump();
  } catch (err) {
    res.status(500).json({ success: false, error: 'TTS unavailable' });
  }
});

// ─── Background: fetch from Indian Kanoon ────────────────────────────────────
const IK_KEY = process.env.INDIAN_KANOON_API_KEY;
const IK_QUERIES = ['Supreme Court constitutional law', 'High Court fundamental rights', 'Supreme Court criminal law', 'India property law case', 'PIL environment India'];

async function backgroundFetch() {
  if (fetchStatus.fetching || !IK_KEY) return;
  fetchStatus.fetching = true;
  for (const q of IK_QUERIES) {
    try {
      const url = `https://api.indiankanoon.org/search/?formInput=${encodeURIComponent(q)}&pagenum=0`;
      const resp = await fetch(url, { headers: { Authorization: `Token ${IK_KEY}` } });
      if (!resp.ok) continue;
      const json = await resp.json();
      const docs = (json.docs || []).slice(0, 10).map((d, i) => ({
        id: `ik_${d.tid || Date.now() + i}`, title: d.title || 'Untitled', court: d.docsource || 'Unknown',
        year: parseInt(d.publishdate?.split('-')[0]) || 2020, type: 'Case Law',
        summary: (d.headline || d.title || '').replace(/<[^>]*>/g, '').slice(0, 500),
        tags: q.split(' ').filter(w => w.length > 3), views: Math.floor(Math.random() * 5000) + 100, source: 'indiankanoon'
      }));
      if (docs.length) { await supabaseAdmin.from('cases').upsert(docs, { onConflict: 'id' }); fetchStatus.totalFetched += docs.length; }
      fetchStatus.pagesLoaded++;
      await new Promise(r => setTimeout(r, 2000)); // polite delay
    } catch (e) { fetchStatus.error = e.message; }
  }
  fetchStatus.fetching = false;
}

// ─── Start server ─────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production' && !process.env.NETLIFY) {
  app.listen(PORT, () => {
    console.log(`✅ NyayaMind running at http://localhost:${PORT}`);
    console.log(`🔒 Security: helmet + rate-limiting active`);
    backgroundFetch();
    setInterval(backgroundFetch, 60 * 60 * 1000);
  });
}
module.exports = app;
