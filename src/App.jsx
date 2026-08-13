import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  CalendarDays, BookOpen, Users, ChevronLeft, ChevronRight,
  Plus, Trash2, Download, Building2, CheckCheck, AlertCircle,
  Loader2, ArrowRight, Mail, User, Briefcase, LogOut, X
} from "lucide-react";
import * as XLSX from "xlsx";
import "./App.css";

// ── helpers ───────────────────────────────────────────────────────────────────
const STATUS = {
  present: { key: "present", label: "Present", short: "P", color: "#16a34a" },
  absent:  { key: "absent",  label: "Absent",  short: "A", color: "#334155" },
  leave:   { key: "leave",   label: "Leave",   short: "L", color: "#d97706" },
  half:    { key: "half",    label: "Half Day", short: "H", color: "#6366f1" },
};
const STATUS_CYCLE = ["present", "absent", "leave", "half", null];

const DEFAULT_ROLES = [
  "Audit Associate", "Senior Associate", "Assistant Manager",
  "Manager", "Partner", "Trainee", "Staff"
];

const ROLE_ICONS = {
  "Audit Associate": "🔍", "Senior Associate": "⭐", "Assistant Manager": "📋",
  "Manager": "💼", "Partner": "🤝", "Trainee": "📚", "Staff": "👤"
};

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function monthLabel(d) {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function uid() { return Math.random().toString(36).slice(2, 10); }
function isClientSite(site) {
  if (!site) return false;
  return !["office","hq","head office","main office",""].includes(site.trim().toLowerCase());
}
function safeSheetName(name, used) {
  let base = String(name).replace(/[\\/?*[\]]/g,"-").slice(0,31).trim()||"Sheet";
  let c = base, n = 2;
  while (used.has(c.toLowerCase())) { const s=` (${n})`; c=base.slice(0,31-s.length)+s; n++; }
  used.add(c.toLowerCase()); return c;
}

// ── OTP Input Component (6 individual boxes) ─────────────────────────────────
function OtpInput({ value, onChange }) {
  const inputs = useRef([]);
  const digits = value.split("").concat(Array(6).fill("")).slice(0, 6);

  const handleChange = (i, e) => {
    const v = e.target.value.replace(/\D/g, "").slice(-1);
    const next = [...digits]; next[i] = v;
    onChange(next.join(""));
    if (v && i < 5) inputs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i, e) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus();
      const next = [...digits]; next[i - 1] = "";
      onChange(next.join(""));
    }
    if (e.key === "ArrowLeft" && i > 0) inputs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < 5) inputs.current[i + 1]?.focus();
  };

  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g,"").slice(0,6);
    if (pasted) { onChange(pasted.padEnd(6,"").slice(0,6)); inputs.current[Math.min(pasted.length,5)]?.focus(); }
    e.preventDefault();
  };

  return (
    <div className="otp-grid">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={el => inputs.current[i] = el}
          className={`otp-box ${d ? "otp-filled" : ""}`}
          type="text" inputMode="numeric" maxLength={1}
          value={d}
          onChange={e => handleChange(i, e)}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={handlePaste}
        />
      ))}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  // Auth state
  const [currentUser, setCurrentUser] = useState(() => {
    try { const r = localStorage.getItem("adm-user"); return r ? JSON.parse(r) : null; } catch { return null; }
  });

  // Login form state
  const [loginStep, setLoginStep] = useState("form"); // "form" | "verify"
  const [loginName, setLoginName] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginRole, setLoginRole] = useState(DEFAULT_ROLES[0]);
  const [otp, setOtp] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginSuccess, setLoginSuccess] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  // App data state
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [rolesList, setRolesList] = useState(DEFAULT_ROLES);
  const [attendance, setAttendance] = useState({});
  const [tab, setTab] = useState("today");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [registerMonth, setRegisterMonth] = useState(new Date());
  const [filterStatus, setFilterStatus] = useState("all");
  const [siteDrafts, setSiteDrafts] = useState({});
  const [exportNote, setExportNote] = useState("");
  const [appError, setAppError] = useState("");

  // Add employee form
  const [newEmpName, setNewEmpName] = useState("");
  const [newEmpEmail, setNewEmpEmail] = useState("");
  const [newEmpRole, setNewEmpRole] = useState(DEFAULT_ROLES[0]);
  const [confirmClear, setConfirmClear] = useState(false);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // Fetch data
  const fetchData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const res = await fetch("/api/all-data");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setEmployees(data.employees || []);
        setAttendance(data.attendance || {});
        if (data.roles?.length > 0) {
          const titles = data.roles.map(r => r.title);
          setRolesList(Array.from(new Set([...DEFAULT_ROLES, ...titles])));
        }
        try {
          localStorage.setItem("adm-employees", JSON.stringify(data.employees || []));
          localStorage.setItem("adm-attendance", JSON.stringify(data.attendance || {}));
        } catch {}
      }
    } catch {
      if (isInitial) {
        try {
          const e = localStorage.getItem("adm-employees");
          const a = localStorage.getItem("adm-attendance");
          if (e) setEmployees(JSON.parse(e));
          if (a) setAttendance(JSON.parse(a));
        } catch {}
      }
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(true);
    const iv = setInterval(() => fetchData(false), 3000);
    const onFocus = () => fetchData(false);
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, [fetchData]);

  // ── Login handlers ──────────────────────────────────────────────────────────
  const handleSendOtp = async (e) => {
    e?.preventDefault();
    if (!loginName.trim()) return setLoginError("Please enter your full name.");
    if (!loginEmail.trim() || !loginEmail.includes("@")) return setLoginError("Please enter a valid email address.");
    setLoginError(""); setLoginLoading(true);

    try {
      const res = await fetch("/api/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail.trim(), name: loginName.trim() })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to send email");
      setLoginStep("verify");
      setLoginSuccess(`Code sent to ${loginEmail}`);
      setResendCooldown(60);
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    if (otp.replace(/\D/g,"").length < 6) return setLoginError("Please enter the full 6-digit code.");
    setLoginError(""); setLoginLoading(true);

    try {
      const res = await fetch("/api/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail.trim(), otp: otp.trim() })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Verification failed");

      // Check if employee exists by email, else create
      const existing = employees.find(emp => emp.email?.toLowerCase() === loginEmail.toLowerCase().trim());
      let userObj;
      if (existing) {
        userObj = existing;
      } else {
        userObj = { id: uid(), name: loginName.trim(), email: loginEmail.trim(), role: loginRole };
        setEmployees(prev => [...prev, userObj]);
        try {
          await fetch("/api/employees", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(userObj)
          });
        } catch {}
      }

      setCurrentUser(userObj);
      try { localStorage.setItem("adm-user", JSON.stringify(userObj)); } catch {}
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setLoginStep("form"); setLoginName(""); setLoginEmail(""); setLoginRole(DEFAULT_ROLES[0]);
    setOtp(""); setLoginError(""); setLoginSuccess("");
    try { localStorage.removeItem("adm-user"); } catch {}
  };

  // ── Attendance handlers ─────────────────────────────────────────────────────
  const setStatus = async (empId, dateStr, status, site) => {
    const key = `${empId}__${dateStr}`;
    const next = { ...attendance };
    const curSite = site !== undefined ? site : (next[key]?.site || "");
    if (status === null) delete next[key];
    else next[key] = { status, site: curSite };
    setAttendance(next);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: key, empId, dateStr, status, site: curSite })
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error);
      fetchData(false);
    } catch (err) { setAppError("Sync error: " + err.message); }
  };

  const cycleStatus = (empId, dateStr) => {
    const key = `${empId}__${dateStr}`;
    const cur = attendance[key]?.status ?? null;
    const idx = STATUS_CYCLE.indexOf(cur);
    setStatus(empId, dateStr, STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]);
  };

  const markAllPresent = async () => {
    const dateStr = fmtDate(selectedDate);
    const next = { ...attendance };
    employees.forEach(emp => { next[`${emp.id}__${dateStr}`] = { status: "present", site: next[`${emp.id}__${dateStr}`]?.site || "" }; });
    setAttendance(next);
    try {
      await fetch("/api/mark-all-present", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dateStr }) });
      fetchData(false);
    } catch {}
  };

  // ── Employee handlers ───────────────────────────────────────────────────────
  const addEmployee = async () => {
    if (!newEmpName.trim()) return;
    const emp = { id: uid(), name: newEmpName.trim(), email: newEmpEmail.trim(), role: newEmpRole };
    setEmployees(prev => [...prev, emp]);
    setNewEmpName(""); setNewEmpEmail("");
    try {
      await fetch("/api/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(emp) });
      fetchData(false);
    } catch (err) { setAppError("Failed to save employee."); }
  };

  const removeEmployee = async (id) => {
    setEmployees(prev => prev.filter(e => e.id !== id));
    try {
      await fetch(`/api/employees/${id}`, { method: "DELETE" });
      fetchData(false);
    } catch {}
  };

  const clearAll = async () => {
    setEmployees([]); setAttendance({}); setConfirmClear(false);
    try { await fetch("/api/clear-all", { method: "POST" }); fetchData(false); } catch {}
  };

  // ── Computed values ─────────────────────────────────────────────────────────
  const selectedDateStr = fmtDate(selectedDate);

  const todayStats = useMemo(() => {
    let present = 0, absent = 0, leave = 0, half = 0, marked = 0;
    employees.forEach(emp => {
      const r = attendance[`${emp.id}__${selectedDateStr}`];
      if (r) { marked++; if (r.status==="present") present++; else if (r.status==="absent") absent++; else if (r.status==="leave") leave++; else if (r.status==="half") half++; }
    });
    const total = employees.length;
    return { present, absent, leave, half, marked, total, pct: total > 0 ? Math.round((marked/total)*100) : 0 };
  }, [attendance, employees, selectedDateStr]);

  const filteredEmployees = useMemo(() => {
    if (filterStatus === "all") return employees;
    return employees.filter(emp => {
      const r = attendance[`${emp.id}__${selectedDateStr}`];
      if (filterStatus === "unmarked") return !r;
      return r?.status === filterStatus;
    });
  }, [employees, attendance, selectedDateStr, filterStatus]);

  const monthDays = useMemo(() => {
    const count = new Date(registerMonth.getFullYear(), registerMonth.getMonth() + 1, 0).getDate();
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [registerMonth]);

  const monthStats = useMemo(() => {
    const y = registerMonth.getFullYear(), m = registerMonth.getMonth();
    const stats = {};
    employees.forEach(emp => {
      let present = 0, marked = 0;
      monthDays.forEach(day => {
        const r = attendance[`${emp.id}__${fmtDate(new Date(y,m,day))}`];
        if (r) { marked++; present += r.status==="present" ? 1 : r.status==="half" ? 0.5 : 0; }
      });
      stats[emp.id] = marked ? Math.round((present/marked)*100) : null;
    });
    return stats;
  }, [attendance, employees, monthDays, registerMonth]);

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportMonthly = () => {
    const y = registerMonth.getFullYear(), m = registerMonth.getMonth();
    const mn = monthLabel(registerMonth);
    const header = ["Employee","Role",...monthDays.map(d=>String(d)),"Present %"];
    const rows = employees.map(emp => {
      const cells = monthDays.map(day => { const r = attendance[`${emp.id}__${fmtDate(new Date(y,m,day))}`]; return r ? STATUS[r.status].short : ""; });
      const pct = monthStats[emp.id];
      return [emp.name, emp.role, ...cells, pct==null ? "" : `${pct}%`];
    });
    const ws = XLSX.utils.aoa_to_sheet([[`Attendance Register — ${mn}`],[],header,...rows]);
    ws["!cols"] = [{wch:22},{wch:16},...monthDays.map(()=>({wch:4})),{wch:10}];
    ws["!merges"] = [{s:{r:0,c:0},e:{r:0,c:header.length-1}}];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Register");
    XLSX.writeFile(wb,`Attendance_${mn.replace(" ","_")}.xlsx`);
    setExportNote("Downloaded!"); setTimeout(()=>setExportNote(""),3000);
  };

  const exportClientReport = () => {
    const y = registerMonth.getFullYear(), m = registerMonth.getMonth();
    const mn = monthLabel(registerMonth);
    const byClient = {};
    employees.forEach(emp => {
      monthDays.forEach(day => {
        const ds = fmtDate(new Date(y,m,day));
        const r = attendance[`${emp.id}__${ds}`];
        if (r?.status==="present" && isClientSite(r.site)) {
          const cl = r.site.trim();
          if (!byClient[cl]) byClient[cl] = [];
          byClient[cl].push({date:ds,employee:emp.name,role:emp.role});
        }
      });
    });
    const clients = Object.keys(byClient).sort();
    if (!clients.length) { setExportNote("No client-site attendance found."); setTimeout(()=>setExportNote(""),3000); return; }
    const wb = XLSX.utils.book_new(); const used = new Set();
    const sumRows = clients.map(c=>{ const e=byClient[c]; return [c,e.length,new Set(e.map(x=>x.employee)).size]; });
    const ws0 = XLSX.utils.aoa_to_sheet([[`Client Report — ${mn}`],[],["Client","Days","Employees"],...sumRows]);
    ws0["!cols"] = [{wch:26},{wch:12},{wch:14}]; XLSX.utils.book_append_sheet(wb,ws0,safeSheetName("Summary",used));
    clients.forEach(cl => {
      const rows = byClient[cl].sort((a,b)=>a.date.localeCompare(b.date));
      const ws = XLSX.utils.aoa_to_sheet([[cl],[],["Date","Employee","Role"],...rows.map(e=>[e.date,e.employee,e.role])]);
      ws["!cols"] = [{wch:14},{wch:22},{wch:16}]; XLSX.utils.book_append_sheet(wb,ws,safeSheetName(cl,used));
    });
    XLSX.writeFile(wb,`Client_Report_${mn.replace(" ","_")}.xlsx`);
    setExportNote(`Downloaded (${clients.length} clients)`); setTimeout(()=>setExportNote(""),3000);
  };

  // ── Loading splash ─────────────────────────────────────────────────────────
  if (loading && !currentUser) {
    return (
      <div className="splash">
        <div className="splash-inner">
          <img src="/Logo.png" alt="Logo" className="splash-logo" />
          <Loader2 size={20} className="spinner" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  // ── Login / Verify Screen ──────────────────────────────────────────────────
  if (!currentUser) {
    return (
      <div className="auth-wrapper">
        {/* Left panel (decorative) */}
        <div className="auth-left">
          <img src="/Logo.png" alt="Logo" className="auth-brand-logo" />
          <h1 className="auth-brand-name">Attendance<br/>Tracker</h1>
          <p className="auth-brand-sub">Simple. Fast. Reliable.</p>
          <div className="auth-dots">
            <span/><span/><span/>
          </div>
        </div>

        {/* Right panel (form) */}
        <div className="auth-right">
          <div className="auth-card">
            {loginStep === "form" ? (
              <>
                <div className="auth-header">
                  <h2>Welcome 👋</h2>
                  <p>Enter your details to continue</p>
                </div>

                {loginError && <div className="auth-alert error">{loginError}</div>}

                <form onSubmit={handleSendOtp} className="auth-form">
                  {/* Name */}
                  <div className="field-group">
                    <label>Full Name</label>
                    <div className="input-wrapper">
                      <User size={16} className="input-icon" />
                      <input
                        className="field-input"
                        placeholder="e.g. Hassan Ahmed"
                        value={loginName}
                        onChange={e => setLoginName(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  {/* Email */}
                  <div className="field-group">
                    <label>Email Address</label>
                    <div className="input-wrapper">
                      <Mail size={16} className="input-icon" />
                      <input
                        className="field-input"
                        type="email"
                        placeholder="e.g. hassan@company.com"
                        value={loginEmail}
                        onChange={e => setLoginEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  {/* Role Grid */}
                  <div className="field-group">
                    <label>Select Your Role</label>
                    <div className="role-grid">
                      {rolesList.map(r => (
                        <button
                          key={r}
                          type="button"
                          className={`role-tile ${loginRole === r ? "active" : ""}`}
                          onClick={() => setLoginRole(r)}
                        >
                          <span className="role-icon">{ROLE_ICONS[r] || "👤"}</span>
                          <span className="role-label">{r}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button type="submit" className="btn-primary" disabled={loginLoading}>
                    {loginLoading ? <Loader2 size={16} className="spinner" /> : <><span>Send Verification Code</span> <ArrowRight size={16} /></>}
                  </button>
                </form>
              </>
            ) : (
              <>
                <div className="auth-header">
                  <h2>Check your inbox ✉️</h2>
                  <p>We sent a 6-digit code to<br/><strong>{loginEmail}</strong></p>
                </div>

                {loginError && <div className="auth-alert error">{loginError}</div>}
                {loginSuccess && <div className="auth-alert success">{loginSuccess}</div>}

                <form onSubmit={handleVerifyOtp} className="auth-form">
                  <OtpInput value={otp} onChange={setOtp} />

                  <button type="submit" className="btn-primary" disabled={loginLoading || otp.replace(/\D/g,"").length < 6}>
                    {loginLoading ? <Loader2 size={16} className="spinner" /> : <><span>Verify & Continue</span> <ArrowRight size={16} /></>}
                  </button>

                  <div className="otp-footer">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => { setLoginStep("form"); setOtp(""); setLoginError(""); setLoginSuccess(""); }}
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={resendCooldown > 0}
                      onClick={handleSendOtp}
                    >
                      {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend Code"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main Dashboard ─────────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* Top Bar */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-left">
            <img src="/Logo.png" alt="Logo" className="topbar-logo" />
            <span className="topbar-title">Attendance Tracker</span>
          </div>
          <div className="topbar-right">
            <div className="user-pill">
              <div className="user-avatar">{currentUser.name.charAt(0).toUpperCase()}</div>
              <div className="user-info">
                <span className="user-name">{currentUser.name}</span>
                <span className="user-role">{currentUser.role}</span>
              </div>
              <button className="logout-btn" onClick={handleLogout} title="Sign out">
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="nav-bar">
          <button className={`nav-btn ${tab==="today"?"active":""}`} onClick={()=>setTab("today")}>
            <CalendarDays size={15} /> Today
          </button>
          <button className={`nav-btn ${tab==="register"?"active":""}`} onClick={()=>setTab("register")}>
            <BookOpen size={15} /> Register
          </button>
          <button className={`nav-btn ${tab==="employees"?"active":""}`} onClick={()=>setTab("employees")}>
            <Users size={15} /> Employees
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="content">
        {appError && (
          <div className="app-alert">
            <AlertCircle size={15} />
            <span>{appError}</span>
            <button onClick={()=>setAppError("")}><X size={13}/></button>
          </div>
        )}

        {/* ── TODAY TAB ─────────────────────────────────────────────────── */}
        {tab === "today" && (
          <>
            {/* Date selector */}
            <div className="card date-nav">
              <button className="icon-btn" onClick={()=>setSelectedDate(new Date(selectedDate.getTime()-86400000))}><ChevronLeft size={16}/></button>
              <div className="date-center">
                <span className="date-main">{selectedDate.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</span>
                <span className="date-year">{selectedDate.getFullYear()}</span>
              </div>
              <button className="icon-btn" onClick={()=>setSelectedDate(new Date(selectedDate.getTime()+86400000))}><ChevronRight size={16}/></button>
              <button className="chip-btn" onClick={()=>setSelectedDate(new Date())}>Today</button>
            </div>

            {/* Stats */}
            {employees.length > 0 && (
              <div className="card stats-card">
                <div className="stats-row">
                  <div className="stat-item">
                    <span className="stat-num" style={{color:"#16a34a"}}>{todayStats.present}</span>
                    <span className="stat-lbl">Present</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-num" style={{color:"#334155"}}>{todayStats.absent}</span>
                    <span className="stat-lbl">Absent</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-num" style={{color:"#d97706"}}>{todayStats.leave}</span>
                    <span className="stat-lbl">Leave</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-num" style={{color:"#6366f1"}}>{todayStats.half}</span>
                    <span className="stat-lbl">Half</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-num">{todayStats.pct}%</span>
                    <span className="stat-lbl">Marked</span>
                  </div>
                </div>
                <div className="progress-track">
                  <div className="progress-seg" style={{width:`${(todayStats.present/(todayStats.total||1))*100}%`,background:"#16a34a"}}/>
                  <div className="progress-seg" style={{width:`${(todayStats.absent/(todayStats.total||1))*100}%`,background:"#334155"}}/>
                  <div className="progress-seg" style={{width:`${(todayStats.leave/(todayStats.total||1))*100}%`,background:"#d97706"}}/>
                  <div className="progress-seg" style={{width:`${(todayStats.half/(todayStats.total||1))*100}%`,background:"#6366f1"}}/>
                </div>
                <div className="stats-actions">
                  <button className="btn-mark-all" onClick={markAllPresent}><CheckCheck size={14}/> Mark All Present</button>
                  <div className="filter-pills">
                    {["all","unmarked","present","absent","leave"].map(f=>(
                      <button key={f} className={`filter-pill ${filterStatus===f?"active":""}`} onClick={()=>setFilterStatus(f)}>
                        {f.charAt(0).toUpperCase()+f.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Employee cards */}
            {employees.length === 0 ? (
              <div className="card empty-state">
                <div className="empty-icon">👥</div>
                <h3>No employees yet</h3>
                <p>Go to the Employees tab to add your team</p>
              </div>
            ) : (
              filteredEmployees.map(emp => {
                const key = `${emp.id}__${selectedDateStr}`;
                const rec = attendance[key];
                const cur = rec?.status;
                return (
                  <div className="card emp-card" key={emp.id}>
                    <div className="emp-top">
                      <div className="emp-av">{emp.name.charAt(0).toUpperCase()}</div>
                      <div className="emp-meta">
                        <span className="emp-name">{emp.name}</span>
                        <span className="emp-role-tag">{emp.role}</span>
                      </div>
                    </div>
                    <div className="status-row">
                      {["present","absent","leave","half"].map(s => {
                        const meta = STATUS[s];
                        const active = cur === s;
                        return (
                          <button
                            key={s}
                            className={`status-btn ${active ? "status-active" : ""}`}
                            style={active ? { background: meta.color, borderColor: meta.color, color: "#fff" } : {}}
                            onClick={() => setStatus(emp.id, selectedDateStr, active ? null : s)}
                          >
                            {meta.label}
                          </button>
                        );
                      })}
                    </div>
                    {cur === "present" && (
                      <div className="site-row">
                        <input
                          className="site-input"
                          placeholder="Location (optional)"
                          value={siteDrafts[key] ?? rec?.site ?? ""}
                          onChange={e => setSiteDrafts({...siteDrafts,[key]:e.target.value})}
                          onBlur={e => setStatus(emp.id, selectedDateStr, "present", e.target.value)}
                        />
                        <div className="site-chips">
                          {["Office / HQ","Client Site","Work From Home"].map(opt => (
                            <button key={opt} className="site-chip"
                              onClick={() => { setSiteDrafts({...siteDrafts,[key]:opt}); setStatus(emp.id,selectedDateStr,"present",opt); }}>
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ── REGISTER TAB ──────────────────────────────────────────────── */}
        {tab === "register" && (
          <>
            <div className="card date-nav">
              <button className="icon-btn" onClick={()=>setRegisterMonth(new Date(registerMonth.getFullYear(),registerMonth.getMonth()-1,1))}><ChevronLeft size={16}/></button>
              <div className="date-center">
                <span className="date-main">{monthLabel(registerMonth)}</span>
              </div>
              <button className="icon-btn" onClick={()=>setRegisterMonth(new Date(registerMonth.getFullYear(),registerMonth.getMonth()+1,1))}><ChevronRight size={16}/></button>
            </div>

            <div className="export-row">
              <button className="btn-outline" onClick={exportMonthly} disabled={!employees.length}><Download size={14}/> Monthly Excel</button>
              <button className="btn-outline" onClick={exportClientReport} disabled={!employees.length}><Building2 size={14}/> Client Report</button>
              {exportNote && <span className="export-note">{exportNote}</span>}
            </div>

            <div className="legend-row">
              {Object.values(STATUS).map(s => (
                <div key={s.key} className="legend-item">
                  <span className="legend-dot" style={{background:s.color}}/>
                  <span>{s.label} ({s.short})</span>
                </div>
              ))}
            </div>

            {employees.length === 0 ? (
              <div className="card empty-state"><div className="empty-icon">📊</div><h3>No data yet</h3><p>Add employees to see the register</p></div>
            ) : (
              <div className="card" style={{padding:0,overflow:"hidden"}}>
                <div className="table-scroll">
                  <table className="reg-table">
                    <thead>
                      <tr>
                        <th className="col-sticky">Employee</th>
                        {monthDays.map(d=><th key={d}>{d}</th>)}
                        <th>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map(emp => (
                        <tr key={emp.id}>
                          <td className="col-sticky">
                            <div className="reg-name">{emp.name}</div>
                            <div className="reg-role">{emp.role}</div>
                          </td>
                          {monthDays.map(day => {
                            const ds = fmtDate(new Date(registerMonth.getFullYear(),registerMonth.getMonth(),day));
                            const r = attendance[`${emp.id}__${ds}`];
                            const meta = r ? STATUS[r.status] : null;
                            return (
                              <td key={day}>
                                <div
                                  className="cell-badge"
                                  style={meta ? {background:meta.color,color:"#fff",borderColor:meta.color} : {}}
                                  title={meta ? `${meta.label}${r.site?" — "+r.site:""}` : "Not marked"}
                                  onClick={() => cycleStatus(emp.id, ds)}
                                >{meta ? meta.short : ""}</div>
                              </td>
                            );
                          })}
                          <td><span className="pct-badge">{monthStats[emp.id]==null?"—":`${monthStats[emp.id]}%`}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── EMPLOYEES TAB ─────────────────────────────────────────────── */}
        {tab === "employees" && (
          <>
            <div className="card">
              <h3 className="section-title">Add New Employee</h3>
              <div className="add-form">
                <input className="field-input" placeholder="Full name" value={newEmpName} onChange={e=>setNewEmpName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addEmployee()} />
                <input className="field-input" placeholder="Email (optional)" value={newEmpEmail} onChange={e=>setNewEmpEmail(e.target.value)} />
                <div className="field-group" style={{marginBottom:0}}>
                  <label style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px",color:"#64748b",marginBottom:6,display:"block"}}>Role</label>
                  <div className="role-grid compact">
                    {rolesList.map(r => (
                      <button key={r} type="button"
                        className={`role-tile ${newEmpRole===r?"active":""}`}
                        onClick={()=>setNewEmpRole(r)}>
                        <span className="role-icon">{ROLE_ICONS[r]||"👤"}</span>
                        <span className="role-label">{r}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <button className="btn-primary" onClick={addEmployee} disabled={!newEmpName.trim()}>
                  <Plus size={16}/> Add Employee
                </button>
              </div>
            </div>

            {employees.length === 0 ? (
              <div className="card empty-state"><div className="empty-icon">👥</div><h3>No employees yet</h3><p>Add your first team member above</p></div>
            ) : (
              employees.map(emp => (
                <div className="card emp-card" key={emp.id} style={{flexDirection:"row",alignItems:"center",gap:12}}>
                  <div className="emp-av">{emp.name.charAt(0).toUpperCase()}</div>
                  <div className="emp-meta" style={{flex:1}}>
                    <span className="emp-name">{emp.name}</span>
                    <span className="emp-role-tag">{emp.role}{emp.email&&<> · {emp.email}</>}</span>
                  </div>
                  <button className="btn-danger" onClick={()=>removeEmployee(emp.id)}><Trash2 size={14}/></button>
                </div>
              ))
            )}

            <div style={{marginTop:32,paddingTop:20,borderTop:"1px solid #f1f5f9"}}>
              {!confirmClear ? (
                <button className="btn-ghost-danger" onClick={()=>setConfirmClear(true)}><Trash2 size={13}/> Clear all data</button>
              ) : (
                <div className="confirm-clear">
                  <p>This will permanently delete all employees and attendance records.</p>
                  <div style={{display:"flex",gap:8,marginTop:10}}>
                    <button className="btn-danger" onClick={clearAll}>Confirm</button>
                    <button className="btn-ghost" onClick={()=>setConfirmClear(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}