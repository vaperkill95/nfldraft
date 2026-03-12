const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Railway provides DATABASE_URL automatically
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── Create table on startup ──────────────────────────────────────────────────
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS draft_guide (
      key   TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('✅ DB ready');
}
init().catch(err => {
  console.error('DB init failed:', err.message);
  process.exit(1);
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok', time: new Date() }));

// ── GET all data (guide polls this) ──────────────────────────────────────────
// Returns the full appData object, plus updated_at so client can detect changes
app.get('/data', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT value, updated_at FROM draft_guide WHERE key = 'appData'`
    );
    if (result.rows.length === 0) {
      return res.json({ data: null, updated_at: null });
    }
    res.json({
      data: result.rows[0].value,
      updated_at: result.rows[0].updated_at
    });
  } catch (err) {
    console.error('GET /data error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET just the updated_at timestamp (lightweight poll to detect changes) ───
app.get('/ping', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT updated_at FROM draft_guide WHERE key = 'appData'`
    );
    res.json({
      updated_at: result.rows[0]?.updated_at || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST save data (admin calls this on every save) ───────────────────────────
app.post('/data', async (req, res) => {
  const { data, secret } = req.body;

  // Simple write secret — set ADMIN_SECRET env var in Railway, add to admin HTML
  if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!data) return res.status(400).json({ error: 'No data provided' });

  try {
    await pool.query(`
      INSERT INTO draft_guide (key, value, updated_at)
      VALUES ('appData', $1, NOW())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            updated_at = NOW()
    `, [data]);
    res.json({ ok: true, updated_at: new Date() });
  } catch (err) {
    console.error('POST /data error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Draft Guide API running on port ${PORT}`));
