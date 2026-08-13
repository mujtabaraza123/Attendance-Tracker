import express from 'express';
import cors from 'cors';
import pkg from 'pg';
import { fileURLToPath } from 'url';

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST || 'aws-0-ap-southeast-1.pooler.supabase.com',
  port: parseInt(process.env.DB_PORT || '6543'),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.tdnbheftrtcwnhejyvgc',
  password: process.env.DB_PASSWORD || 'Hammad519..',
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

// Ensure tables exist on startup
async function initDb() {
  let client;
  try {
    client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.roles (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.employees (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'Staff',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.attendance (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        date TEXT NOT NULL,
        status TEXT NOT NULL,
        site TEXT DEFAULT '',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Insert default roles if empty
    const roleCount = await client.query(`SELECT COUNT(*) FROM public.roles;`);
    if (parseInt(roleCount.rows[0].count) === 0) {
      const defaultRoles = [
        "Audit Associate",
        "Senior Associate",
        "Assistant Manager",
        "Manager",
        "Partner",
        "Trainee",
        "Staff"
      ];
      for (const role of defaultRoles) {
        const id = role.toLowerCase().replace(/[^a-z0-9]/g, '_');
        await client.query(
          `INSERT INTO public.roles (id, title) VALUES ($1, $2) ON CONFLICT DO NOTHING;`,
          [id, role]
        );
      }
    }
  } catch (err) {
    console.error("Database initialization error:", err.message);
  } finally {
    if (client) client.release();
  }
}

initDb();

// GET all employees, roles, and attendance records
app.get('/api/all-data', async (req, res) => {
  try {
    const empRes = await pool.query(`SELECT id, name, role FROM public.employees ORDER BY created_at ASC;`);
    const roleRes = await pool.query(`SELECT id, title FROM public.roles ORDER BY title ASC;`);
    const attRes = await pool.query(`SELECT id, employee_id, date, status, site FROM public.attendance;`);
    
    const attendanceMap = {};
    attRes.rows.forEach(r => {
      attendanceMap[r.id] = { status: r.status, site: r.site || '' };
    });

    res.json({
      success: true,
      employees: empRes.rows,
      roles: roleRes.rows,
      attendance: attendanceMap
    });
  } catch (err) {
    console.error("Error fetching all-data:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST add employee
app.post('/api/employees', async (req, res) => {
  const { id, name, role } = req.body;
  if (!id || !name) return res.status(400).json({ error: "Missing id or name" });

  try {
    await pool.query(
      `INSERT INTO public.employees (id, name, role) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role;`,
      [id, name, role || 'Staff']
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Error adding employee:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST add role
app.post('/api/roles', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "Missing role title" });
  const id = title.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');

  try {
    await pool.query(
      `INSERT INTO public.roles (id, title) VALUES ($1, $2) ON CONFLICT (title) DO NOTHING;`,
      [id, title.trim()]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Error adding role:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE employee
app.delete('/api/employees/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM public.attendance WHERE employee_id = $1;`, [id]);
    await pool.query(`DELETE FROM public.employees WHERE id = $1;`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Error removing employee:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST update single attendance record
app.post('/api/attendance', async (req, res) => {
  const { id, empId, dateStr, status, site } = req.body;
  if (!id || !empId || !dateStr) return res.status(400).json({ error: "Missing required parameters" });

  try {
    if (status === null) {
      await pool.query(`DELETE FROM public.attendance WHERE id = $1;`, [id]);
    } else {
      await pool.query(
        `INSERT INTO public.attendance (id, employee_id, date, status, site, updated_at) 
         VALUES ($1, $2, $3, $4, $5, NOW()) 
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, site = EXCLUDED.site, updated_at = NOW();`,
        [id, empId, dateStr, status, site || '']
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Error updating attendance:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST mark all present for a date
app.post('/api/mark-all-present', async (req, res) => {
  const { dateStr } = req.body;
  if (!dateStr) return res.status(400).json({ error: "Missing dateStr" });

  try {
    const empRes = await pool.query(`SELECT id FROM public.employees;`);
    for (const emp of empRes.rows) {
      const key = `${emp.id}__${dateStr}`;
      await pool.query(
        `INSERT INTO public.attendance (id, employee_id, date, status, updated_at)
         VALUES ($1, $2, $3, 'present', NOW())
         ON CONFLICT (id) DO UPDATE SET status = 'present', updated_at = NOW();`,
        [key, emp.id, dateStr]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Error marking all present:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST clear all data
app.post('/api/clear-all', async (req, res) => {
  try {
    await pool.query(`TRUNCATE TABLE public.attendance, public.employees;`);
    res.json({ success: true });
  } catch (err) {
    console.error("Error clearing all data:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Standalone execution check
const nodePath = fileURLToPath(import.meta.url);
if (process.argv[1] === nodePath || process.env.RUN_STANDALONE === 'true') {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Supabase Sync Express Server running on port ${PORT}`);
  });
}

export { app, pool };
