/**
 * NyayaMind Backend Server
 * - Serves 30 hardcoded landmark Indian cases instantly
 * - In the background, fetches more cases from Indian Kanoon API
 * - Exposes /api/cases for the frontend
 */

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const IK_API_KEY = '86dca0f62885fc28b1ebf14af1f1a5d29328ea57';
const IK_API_HOST = 'api.indiankanoon.org';

// ─────────────────────────────────────────────────────────
// 30 HARDCODED LANDMARK INDIAN CASES
// ─────────────────────────────────────────────────────────
const HARDCODED_CASES = [
  {
    id: 'hc_001', title: 'Kesavananda Bharati v. State of Kerala',
    court: 'Supreme Court', year: 1973, type: 'Constitutional Law',
    summary: 'Established the Basic Structure Doctrine — Parliament cannot amend the Constitution so as to destroy its basic structure. One of the most significant judgments in Indian constitutional history.',
    tags: ['basic structure', 'constitutional amendment', 'fundamental rights', 'parliament'],
    views: 98420, source: 'hardcoded'
  },
  {
    id: 'hc_002', title: 'Maneka Gandhi v. Union of India',
    court: 'Supreme Court', year: 1978, type: 'Constitutional Law',
    summary: 'Expanded the scope of Article 21 (Right to Life and Liberty). Held that procedure established by law must be fair, just, and reasonable — not merely a formality.',
    tags: ['article 21', 'right to life', 'personal liberty', 'due process'],
    views: 87300, source: 'hardcoded'
  },
  {
    id: 'hc_003', title: 'Vishaka v. State of Rajasthan',
    court: 'Supreme Court', year: 1997, type: 'Civil Law',
    summary: 'Laid down the Vishaka Guidelines for prevention of sexual harassment at the workplace. Led to the enactment of POSH Act 2013.',
    tags: ['sexual harassment', 'workplace', 'women rights', 'guidelines'],
    views: 79800, source: 'hardcoded'
  },
  {
    id: 'hc_004', title: 'Navtej Singh Johar v. Union of India',
    court: 'Supreme Court', year: 2018, type: 'Constitutional Law',
    summary: 'Decriminalised consensual same-sex relations by reading down Section 377 of IPC. A landmark ruling for LGBTQ+ rights in India.',
    tags: ['section 377', 'lgbtq', 'decriminalisation', 'fundamental rights'],
    views: 95200, source: 'hardcoded'
  },
  {
    id: 'hc_005', title: 'Justice K.S. Puttaswamy v. Union of India',
    court: 'Supreme Court', year: 2017, type: 'Constitutional Law',
    summary: 'Unanimously declared Privacy as a Fundamental Right under Article 21. Has wide implications for data protection and Aadhaar.',
    tags: ['right to privacy', 'aadhaar', 'data protection', 'article 21'],
    views: 91500, source: 'hardcoded'
  },
  {
    id: 'hc_006', title: 'Shayara Bano v. Union of India (Triple Talaq)',
    court: 'Supreme Court', year: 2017, type: 'Civil Law',
    summary: 'Declared instant Triple Talaq (talaq-e-biddat) unconstitutional as it violates the fundamental rights of Muslim women.',
    tags: ['triple talaq', 'muslim women', 'personal law', 'gender equality'],
    views: 88600, source: 'hardcoded'
  },
  {
    id: 'hc_007', title: 'M. Siddiq v. Mahant Suresh Das (Ayodhya)',
    court: 'Supreme Court', year: 2019, type: 'Civil Law',
    summary: 'The Supreme Court settled the decades-long Ayodhya land dispute, awarding the disputed land for construction of a Hindu temple and an alternate 5-acre plot for a mosque.',
    tags: ['ayodhya', 'land dispute', 'religious property', 'ram mandir'],
    views: 112000, source: 'hardcoded'
  },
  {
    id: 'hc_008', title: 'Indra Sawhney v. Union of India (Mandal Commission)',
    court: 'Supreme Court', year: 1992, type: 'Constitutional Law',
    summary: 'Upheld 27% OBC reservations but capped total reservations at 50% and excluded the "creamy layer" from OBC benefits.',
    tags: ['reservations', 'obc', 'mandal', 'social justice', 'creamy layer'],
    views: 76400, source: 'hardcoded'
  },
  {
    id: 'hc_009', title: 'S.R. Bommai v. Union of India',
    court: 'Supreme Court', year: 1994, type: 'Constitutional Law',
    summary: 'Curtailed the arbitrary use of Article 356 (President\'s Rule). Held that the majority of a state government must be tested on the floor of the House.',
    tags: ['presidents rule', 'article 356', 'federalism', 'state government'],
    views: 68200, source: 'hardcoded'
  },
  {
    id: 'hc_010', title: 'M.C. Mehta v. Union of India (Taj Trapezium)',
    court: 'Supreme Court', year: 1997, type: 'Civil Law',
    summary: 'Environmental case protecting the Taj Mahal from air pollution. Industries near Agra were ordered to shift to natural gas or relocate.',
    tags: ['environment', 'taj mahal', 'pollution', 'industry', 'agra'],
    views: 72100, source: 'hardcoded'
  },
  {
    id: 'hc_011', title: 'Shreya Singhal v. Union of India',
    court: 'Supreme Court', year: 2015, type: 'Constitutional Law',
    summary: 'Struck down Section 66A of the IT Act which penalised online speech deemed "offensive". A landmark ruling for freedom of expression on the internet.',
    tags: ['section 66a', 'internet freedom', 'free speech', 'it act'],
    views: 84300, source: 'hardcoded'
  },
  {
    id: 'hc_012', title: 'National Legal Services Authority v. Union of India',
    court: 'Supreme Court', year: 2014, type: 'Constitutional Law',
    summary: 'Recognised transgender persons as a third gender and directed the government to treat them as minorities for reservations in education and jobs.',
    tags: ['transgender', 'third gender', 'nalsa', 'fundamental rights'],
    views: 77900, source: 'hardcoded'
  },
  {
    id: 'hc_013', title: 'D.K. Basu v. State of West Bengal',
    court: 'Supreme Court', year: 1997, type: 'Criminal Law',
    summary: 'Laid down binding guidelines to prevent custodial deaths and torture. Arrests must follow strict procedural requirements to protect detainees\' rights.',
    tags: ['custodial death', 'police brutality', 'arrest guidelines', 'article 21'],
    views: 65800, source: 'hardcoded'
  },
  {
    id: 'hc_014', title: 'Hussainara Khatoon v. State of Bihar',
    court: 'Supreme Court', year: 1979, type: 'Criminal Law',
    summary: 'Recognised the right to a speedy trial as a fundamental right under Article 21. Led to release of thousands of undertrial prisoners in Bihar.',
    tags: ['speedy trial', 'undertrial prisoners', 'bail', 'article 21'],
    views: 58700, source: 'hardcoded'
  },
  {
    id: 'hc_015', title: 'Bachan Singh v. State of Punjab',
    court: 'Supreme Court', year: 1980, type: 'Criminal Law',
    summary: 'Upheld the constitutional validity of the death penalty but restricted it to the "rarest of rare" cases, requiring special reasons in writing.',
    tags: ['death penalty', 'rarest of rare', 'capital punishment', 'sentencing'],
    views: 71200, source: 'hardcoded'
  },
  {
    id: 'hc_016', title: 'Olga Tellis v. Bombay Municipal Corporation',
    court: 'Supreme Court', year: 1985, type: 'Civil Law',
    summary: 'Held that the right to livelihood is part of the right to life under Article 21. Pavement dwellers cannot be evicted without an alternative.',
    tags: ['right to livelihood', 'eviction', 'pavement dwellers', 'article 21'],
    views: 54300, source: 'hardcoded'
  },
  {
    id: 'hc_017', title: 'Aruna Shanbaug v. Union of India',
    court: 'Supreme Court', year: 2011, type: 'Civil Law',
    summary: 'Addressed euthanasia and the right to die with dignity. Passive euthanasia was allowed under strict guidelines, while active euthanasia remained illegal.',
    tags: ['euthanasia', 'right to die', 'passive euthanasia', 'dignity'],
    views: 62400, source: 'hardcoded'
  },
  {
    id: 'hc_018', title: 'Common Cause v. Union of India (Living Will)',
    court: 'Supreme Court', year: 2018, type: 'Civil Law',
    summary: 'Recognised the right to die with dignity as a fundamental right and upheld the validity of living wills (advance medical directives).',
    tags: ['right to die', 'living will', 'dignity', 'passive euthanasia'],
    views: 59800, source: 'hardcoded'
  },
  {
    id: 'hc_019', title: 'Indian Young Lawyers Association v. State of Kerala (Sabarimala)',
    court: 'Supreme Court', year: 2018, type: 'Constitutional Law',
    summary: 'Allowed women of all ages to enter the Sabarimala temple, ruling that excluding women of menstruating age was unconstitutional and discriminatory.',
    tags: ['sabarimala', 'women entry', 'temple', 'religion', 'equality'],
    views: 89100, source: 'hardcoded'
  },
  {
    id: 'hc_020', title: 'Lily Thomas v. Union of India',
    court: 'Supreme Court', year: 2013, type: 'Constitutional Law',
    summary: 'Struck down Section 8(4) of the Representation of the People Act. Convicted MPs and MLAs are disqualified immediately upon conviction.',
    tags: ['disqualification', 'elected representatives', 'conviction', 'rpa'],
    views: 63200, source: 'hardcoded'
  },
  {
    id: 'hc_021', title: 'Centre for PIL v. Union of India (2G Spectrum)',
    court: 'Supreme Court', year: 2012, type: 'Civil Law',
    summary: 'Cancelled 122 telecom licences allocated during the 2G spectrum scam. Held that natural resources cannot be distributed arbitrarily by the government.',
    tags: ['2g scam', 'spectrum', 'natural resources', 'corruption', 'pil'],
    views: 81700, source: 'hardcoded'
  },
  {
    id: 'hc_022', title: 'Subramanian Swamy v. Union of India (Defamation)',
    court: 'Supreme Court', year: 2016, type: 'Criminal Law',
    summary: 'Upheld the constitutional validity of criminal defamation under Sections 499-500 of IPC. Free speech does not include the right to defame.',
    tags: ['defamation', 'free speech', 'ipc 499', 'criminal law'],
    views: 57400, source: 'hardcoded'
  },
  {
    id: 'hc_023', title: 'M.C. Mehta v. Union of India (Ganga Pollution)',
    court: 'Supreme Court', year: 1988, type: 'Civil Law',
    summary: 'Ordered closure of tanneries polluting the Ganga river in Kanpur. Established the absolute liability principle for hazardous industries.',
    tags: ['ganga pollution', 'environment', 'tanneries', 'absolute liability'],
    views: 48900, source: 'hardcoded'
  },
  {
    id: 'hc_024', title: 'ADM Jabalpur v. Shivkant Shukla (Habeas Corpus)',
    court: 'Supreme Court', year: 1976, type: 'Constitutional Law',
    summary: 'The infamous Emergency-era judgment which held that the right to habeas corpus can be suspended during a national Emergency. Later expressly overruled.',
    tags: ['emergency', 'habeas corpus', 'fundamental rights', 'suspension'],
    views: 61300, source: 'hardcoded'
  },
  {
    id: 'hc_025', title: 'Manohar Lal Sharma v. Principal Secretary (Coal Scam)',
    court: 'Supreme Court', year: 2014, type: 'Criminal Law',
    summary: 'Cancelled 214 coal block allocations made since 1993, declaring the entire allocation process illegal and arbitrary. One of India\'s largest scams.',
    tags: ['coal scam', 'coal blocks', 'allocation', 'corruption', 'natural resources'],
    views: 74500, source: 'hardcoded'
  },
  {
    id: 'hc_026', title: 'Mohd. Ahmed Khan v. Shah Bano Begum',
    court: 'Supreme Court', year: 1985, type: 'Civil Law',
    summary: 'Ruled that a Muslim woman is entitled to maintenance from her husband beyond the iddat period under Section 125 CrPC. Led to the controversial Muslim Women Act 1986.',
    tags: ['shah bano', 'maintenance', 'muslim personal law', 'crpc 125'],
    views: 69800, source: 'hardcoded'
  },
  {
    id: 'hc_027', title: 'Arnesh Kumar v. State of Bihar',
    court: 'Supreme Court', year: 2014, type: 'Criminal Law',
    summary: 'Issued strict guidelines to prevent automatic arrests in cases under Section 498A IPC (dowry harassment). Police cannot arrest without application of mind.',
    tags: ['498a', 'dowry', 'arrest', 'misuse', 'guidelines'],
    views: 66100, source: 'hardcoded'
  },
  {
    id: 'hc_028', title: 'State of Madras v. Champakam Dorairajan',
    court: 'Supreme Court', year: 1951, type: 'Constitutional Law',
    summary: 'The first major constitutional amendment case. Led to the First Constitutional Amendment, adding Article 15(4) to allow reservations for backward classes.',
    tags: ['reservations', 'backward classes', 'article 15', 'first amendment'],
    views: 44200, source: 'hardcoded'
  },
  {
    id: 'hc_029', title: 'P.A. Inamdar v. State of Maharashtra',
    court: 'Supreme Court', year: 2005, type: 'Constitutional Law',
    summary: 'Ruled that the government cannot impose its reservation policy on private unaided educational institutions for admissions.',
    tags: ['private colleges', 'reservations', 'education', 'minority institutions'],
    views: 42800, source: 'hardcoded'
  },
  {
    id: 'hc_030', title: 'Selvi v. State of Karnataka (Narco Analysis)',
    court: 'Supreme Court', year: 2010, type: 'Criminal Law',
    summary: 'Held that narco analysis, brain mapping, and polygraph tests cannot be administered without the consent of the accused, as they violate the right against self-incrimination.',
    tags: ['narco analysis', 'brain mapping', 'self-incrimination', 'article 20'],
    views: 55600, source: 'hardcoded'
  }
];

// ─────────────────────────────────────────────────────────
// LIVE CACHE — grows as API results arrive in background
// ─────────────────────────────────────────────────────────
let liveCache = [];
let fetchStatus = { fetching: false, pagesLoaded: 0, totalFetched: 0, error: null };

// ─────────────────────────────────────────────────────────
// INDIAN KANOON API FETCH
// ─────────────────────────────────────────────────────────
function fetchKanoonPage(query, pagenum) {
  return new Promise((resolve, reject) => {
    const postData = `formInput=${encodeURIComponent(query)}&pagenum=${pagenum}`;
    const options = {
      hostname: IK_API_HOST,
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
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error('JSON parse error: ' + data.substring(0, 200)));
        }
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
    source: 'indiankanoon',
    tid: doc.tid
  };
}

async function backgroundFetch() {
  if (fetchStatus.fetching) return;
  fetchStatus.fetching = true;
  fetchStatus.error = null;

  const queries = [
    'supreme court constitutional law',
    'fundamental rights india',
    'criminal law high court',
    'civil litigation property rights',
    'environmental law pil india'
  ];

  for (const query of queries) {
    for (let page = 0; page <= 3; page++) {
      try {
        await new Promise(r => setTimeout(r, 1500)); // polite delay
        const result = await fetchKanoonPage(query, page);
        if (result && result.docs && Array.isArray(result.docs)) {
          const mapped = result.docs.map(mapKanoonDoc);
          // Deduplicate by id
          const existingIds = new Set([...HARDCODED_CASES, ...liveCache].map(c => c.id));
          const fresh = mapped.filter(c => !existingIds.has(c.id));
          liveCache.push(...fresh);
          fetchStatus.totalFetched += fresh.length;
          fetchStatus.pagesLoaded++;
          console.log(`[IK] Fetched page ${page} for "${query}" — +${fresh.length} cases (total live: ${liveCache.length})`);
        }
      } catch (err) {
        console.error(`[IK] Error fetching page ${page} for "${query}":`, err.message);
        fetchStatus.error = err.message;
      }
    }
  }
  fetchStatus.fetching = false;
  console.log(`[IK] Background fetch complete. Total live cases: ${liveCache.length}`);
}

// ─────────────────────────────────────────────────────────
// MIME TYPES FOR STATIC FILE SERVING
// ─────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.css': 'text/css',
  '.js': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.webp': 'image/webp'
};

// ─────────────────────────────────────────────────────────
// HTTP SERVER
// ─────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── API: GET /api/cases ──────────────────────────────
  if (pathname === '/api/cases' && req.method === 'GET') {
    const q = (parsedUrl.query.q || '').toLowerCase().trim();
    const type = parsedUrl.query.type || 'all';
    const limit = parseInt(parsedUrl.query.limit) || 100;

    let all = [...HARDCODED_CASES, ...liveCache];

    if (q) {
      all = all.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q) ||
        c.tags.some(t => t.includes(q)) ||
        c.court.toLowerCase().includes(q)
      );
    }
    if (type !== 'all') {
      all = all.filter(c => c.type.toLowerCase().includes(type.toLowerCase()) ||
        c.court.toLowerCase().includes(type.toLowerCase()));
    }

    // Sort by views descending
    all.sort((a, b) => (b.views || 0) - (a.views || 0));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      total: all.length,
      hardcoded: HARDCODED_CASES.length,
      live: liveCache.length,
      fetchStatus,
      cases: all.slice(0, limit)
    }));
    return;
  }

  // ── API: GET /api/status ─────────────────────────────
  if (pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      hardcoded: HARDCODED_CASES.length,
      live: liveCache.length,
      total: HARDCODED_CASES.length + liveCache.length,
      fetchStatus
    }));
    return;
  }

  // ── STATIC FILES ─────────────────────────────────────
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n✅ NyayaMind backend running at http://localhost:${PORT}`);
  console.log(`📚 Serving ${HARDCODED_CASES.length} hardcoded landmark cases instantly`);
  console.log(`🔄 Starting background fetch from Indian Kanoon API...\n`);
  // Start background fetch after a short delay
  setTimeout(backgroundFetch, 2000);
});
