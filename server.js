import express from 'express';
import cors from 'cors';
import pkg from 'pg';
import nodemailer from 'nodemailer';
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

// In-memory OTP store: { email: { otp, expiresAt } }
const otpStore = new Map();

// Nodemailer transporter using Gmail App Password
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'no.auth.verify@gmail.com',
    pass: 'yzgl ngmr mqvt rccf',
  },
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
        email TEXT DEFAULT '',
        role TEXT NOT NULL DEFAULT 'Staff',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    // Add email column if it doesn't exist (migration)
    await client.query(`
      ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
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

// POST /api/send-otp — send OTP to email
app.post('/api/send-otp', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  otpStore.set(email.toLowerCase().trim(), { otp, expiresAt });

  try {
    await transporter.sendMail({
      from: '"Attendance Tracker" <no.auth.verify@gmail.com>',
      to: email,
      subject: `Your Verification Code — ${otp}`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:420px;margin:0 auto;padding:28px 16px;background:#f8fafc;"><div style="background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e2e8f0;"><p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;">Attendance Tracker</p><p style="margin:0 0 16px;font-size:13px;color:#64748b;">Hi ${name || 'there'}, your verification code is:</p><div style="background:#f1f5f9;border-radius:8px;padding:12px 16px;font-size:26px;font-weight:800;letter-spacing:6px;color:#0f172a;font-family:monospace;display:inline-block;">${otp}</div><p style="margin:14px 0 0;font-size:11px;color:#94a3b8;">Expires in 10 minutes. Ignore if you didn't request this.</p></div></div>`,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Error sending OTP email:', err.message);
    res.status(500).json({ success: false, error: 'Failed to send email: ' + err.message });
  }
});

// POST /api/verify-otp — verify OTP code
app.post('/api/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ success: false, error: 'Email and OTP required' });

  const key = email.toLowerCase().trim();
  const record = otpStore.get(key);

  if (!record) return res.json({ success: false, error: 'No OTP found for this email' });
  if (Date.now() > record.expiresAt) {
    otpStore.delete(key);
    return res.json({ success: false, error: 'OTP has expired. Please request a new one.' });
  }
  if (record.otp !== String(otp).trim()) {
    return res.json({ success: false, error: 'Incorrect code. Please try again.' });
  }

  otpStore.delete(key);
  res.json({ success: true });
});

// GET all employees, roles, and attendance records
app.get('/api/all-data', async (req, res) => {
  try {
    const empRes = await pool.query(`SELECT id, name, email, role FROM public.employees ORDER BY created_at ASC;`);
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
  const { id, name, email, role } = req.body;
  if (!id || !name) return res.status(400).json({ error: "Missing id or name" });

  try {
    await pool.query(
      `INSERT INTO public.employees (id, name, email, role) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role;`,
      [id, name, email || '', role || 'Staff']
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
