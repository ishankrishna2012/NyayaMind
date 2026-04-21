require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize clients
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const IK_API_KEY = process.env.INDIAN_KANOON_API_KEY;

app.use(cors());
app.use(express.json());

// Serve static files from current directory
app.use(express.static(path.join(__dirname)));

let fetchStatus = { fetching: false, pagesLoaded: 0, totalFetched: 0, error: null };

// ─────────────────────────────────────────────────────────
// API: GET /api/cases
// ─────────────────────────────────────────────────────────
app.get('/api/cases', async (req, res) => {
  const { q, type, limit } = req.query;
  const numLimit = parseInt(limit) || 100;

  try {
    let query = supabase.from('cases').select('*').order('views', { ascending: false }).limit(numLimit);

    if (type && type !== 'all') {
      query = query.ilike('type', `%${type}%`);
    }

    if (q) {
      // Basic text search if query is provided
      query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%,court.ilike.%${q}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({
      success: true,
      total: data.length,
      cases: data,
      fetchStatus
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// API: GET /api/status
// ─────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  try {
    const { count, error } = await supabase.from('cases').select('*', { count: 'exact', head: true });
    res.json({
      success: true,
      total: count,
      fetchStatus
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// API: POST /api/chat
// Chat with AI about a specific case
// ─────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, caseContext } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  try {
    let systemPrompt = "You are NyayaMind, an expert Indian legal AI assistant.";
    if (caseContext) {
      systemPrompt += ` The user is asking about the following case: Title: ${caseContext.title}. Court: ${caseContext.court}. Year: ${caseContext.year}. Summary: ${caseContext.summary}. Please provide accurate legal insights regarding this specific case.`;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    const reply = completion.choices[0].message.content;
    res.json({ success: true, reply });
  } catch (err) {
    console.error("OpenAI Error:", err);
    res.status(500).json({ success: false, error: "Failed to generate AI response." });
  }
});

// ─────────────────────────────────────────────────────────
// API: POST /api/ai-search
// AI Optimized Search Query formulation
// ─────────────────────────────────────────────────────────
app.post('/api/ai-search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a legal search optimizer. Extract the core legal concepts, keywords, and statutes from the user's natural language query. Return ONLY a comma-separated list of highly relevant Indian legal keywords optimized for database search. No conversational text." },
        { role: "user", content: query }
      ],
      temperature: 0.3,
      max_tokens: 50
    });

    const optimizedKeywords = completion.choices[0].message.content;
    res.json({ success: true, original: query, optimized: optimizedKeywords });
  } catch (err) {
    console.error("OpenAI Error:", err);
    res.status(500).json({ success: false, error: "Failed to optimize search." });
  }
});

// ─────────────────────────────────────────────────────────
// API: POST /api/tts
// Convert text to speech using ElevenLabs
// ─────────────────────────────────────────────────────────
app.post('/api/tts', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text is required' });

  try {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5
        }
      })
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API responded with ${response.status}`);
    }

    res.set({
      'Content-Type': 'audio/mpeg',
      'Transfer-Encoding': 'chunked'
    });

    // Native fetch Response body in Node 18+ is a WebReadableStream
    // We can stream it using stream.Readable.fromWeb
    const { Readable } = require('stream');
    Readable.fromWeb(response.body).pipe(res);

  } catch (err) {
    console.error("ElevenLabs Error:", err);
    res.status(500).json({ success: false, error: "Failed to generate speech." });
  }
});

// ─────────────────────────────────────────────────────────
// INDIAN KANOON API FETCH TO SUPABASE
// ─────────────────────────────────────────────────────────
function fetchKanoonPage(query, pagenum) {
  return new Promise((resolve, reject) => {
    const postData = `formInput=${encodeURIComponent(query)}&pagenum=${pagenum}`;
    const options = {
      hostname: 'api.indiankanoon.org',
      port: 443,
      path: '/search/',
      method: 'POST',
      headers: {
        'Authorization': `Token ${IK_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function mapKanoonDoc(doc) {
  return {
    id: `ik_${doc.tid}`,
    title: doc.title || 'Untitled',
    court: doc.docsource || 'Indian Court',
    year: doc.publishdate ? parseInt(doc.publishdate.split('-').pop()) : null,
    type: 'Case Law',
    summary: doc.headline ? doc.headline.replace(/<[^>]+>/g, '') : 'No summary available.',
    tags: [],
    views: doc.numcitedby || 0,
    source: 'indiankanoon'
  };
}

async function backgroundFetch() {
  if (fetchStatus.fetching) return;
  fetchStatus.fetching = true;
  fetchStatus.error = null;

  const queries = [
    'supreme court constitutional law',
    'fundamental rights india',
    'criminal law high court'
  ];

  for (const query of queries) {
    for (let page = 0; page <= 1; page++) { // Reduced pages for faster dev cycle
      try {
        await new Promise(r => setTimeout(r, 2000));
        const result = await fetchKanoonPage(query, page);
        if (result && result.docs && Array.isArray(result.docs)) {
          const mapped = result.docs.map(mapKanoonDoc);
          
          // Upsert to Supabase
          const { error } = await supabase.from('cases').upsert(mapped, { onConflict: 'id', ignoreDuplicates: true });
          if (!error) {
            fetchStatus.totalFetched += mapped.length;
            console.log(`[IK] Pushed ${mapped.length} cases to Supabase from "${query}" (page ${page})`);
          } else {
            console.error('[IK] Supabase Upsert Error:', error.message);
          }
          fetchStatus.pagesLoaded++;
        }
      } catch (err) {
        console.error(`[IK] Error fetching page ${page} for "${query}":`, err.message);
        fetchStatus.error = err.message;
      }
    }
  }
  fetchStatus.fetching = false;
  console.log(`[IK] Background fetch cycle complete.`);
}

// ─────────────────────────────────────────────────────────
// START SERVER OR EXPORT FOR SERVERLESS
// ─────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production' && !process.env.NETLIFY) {
  app.listen(PORT, () => {
    console.log(`\n✅ NyayaMind backend running at http://localhost:${PORT}`);
    console.log(`🚀 API Endpoints: /api/cases, /api/status, /api/chat, /api/ai-search, /api/tts`);
    
    // Start background fetch from Kanoon to Supabase every hour
    backgroundFetch();
    setInterval(backgroundFetch, 60 * 60 * 1000); 
  });
}

module.exports = app;
