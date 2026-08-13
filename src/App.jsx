import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2, Download, Building2, CheckCheck, Loader2, ArrowRight, LogOut, X, AlertCircle } from "lucide-react";
import * as XLSX from "xlsx";
import "./App.css";

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS = {
  present: { key:"present", label:"Present", short:"P", color:"#16a34a" },
  absent:  { key:"absent",  label:"Absent",  short:"A", color:"#1e293b" },
  leave:   { key:"leave",   label:"Leave",   short:"L", color:"#92400e" },
  half:    { key:"half",    label:"Half Day", short:"H", color:"#4f46e5" },
};
const STATUS_CYCLE = ["present","absent","leave","half",null];
const DEFAULT_ROLES = ["Audit Associate","Senior Associate","Assistant Manager","Manager","Partner","Trainee","Staff"];

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function monthLabel(d) {
  return d.toLocaleDateString("en-US",{month:"long",year:"numeric"});
}
function uid() { return Math.random().toString(36).slice(2,10); }
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

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  // ── Session ─────────────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState(() => {
    try { const r = localStorage.getItem("adm-user"); return r ? JSON.parse(r) : null; } catch { return null; }
  });

  // ── Auth UI state ────────────────────────────────────────────────────────────
  const [authTab, setAuthTab] = useState("login"); // "login" | "signup"
  const [authStep, setAuthStep] = useState("form"); // "form" | "verify"

  // Login fields
  const [loginEmail,    setLoginEmail]    = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Signup fields
  const [signupName,     setSignupName]     = useState("");
  const [signupEmail,    setSignupEmail]    = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupRole,     setSignupRole]     = useState(DEFAULT_ROLES[0]);
  const [otp, setOtp] = useState("");

  // Forgot password fields
  const [forgotEmail,       setForgotEmail]       = useState("");
  const [forgotOtp,         setForgotOtp]         = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotStep,        setForgotStep]        = useState("form"); // "form" | "verify"

  const [authLoading, setAuthLoading] = useState(false);
  const [authError,   setAuthError]   = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [cooldown,    setCooldown]    = useState(0);

  // ── App data ─────────────────────────────────────────────────────────────────
  const [loading,    setLoading]    = useState(true);
  const [employees,  setEmployees]  = useState([]);
  const [rolesList,  setRolesList]  = useState(DEFAULT_ROLES);
  const [attendance, setAttendance] = useState({});
  const [tab,        setTab]        = useState("today");
  const [selDate,    setSelDate]    = useState(new Date());
  const [regMonth,   setRegMonth]   = useState(new Date());
  const [filterSt,   setFilterSt]   = useState("all");
  const [siteDrafts, setSiteDrafts] = useState({});
  const [exportNote, setExportNote] = useState("");
  const [appErr,     setAppErr]     = useState("");

  // Add employee form
  const [newName,  setNewName]  = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole,  setNewRole]  = useState(DEFAULT_ROLES[0]);
  const [confirmClear, setConfirmClear] = useState(false);

  // ── Cooldown timer ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // ── Fetch data ───────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (init = false) => {
    if (init) setLoading(true);
    try {
      const res = await fetch("/api/all-data");
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.success) {
        setEmployees(data.employees || []);
        setAttendance(data.attendance || {});
        if (data.roles?.length > 0) {
          setRolesList(Array.from(new Set([...DEFAULT_ROLES, ...data.roles.map(r=>r.title)])));
        }
        try {
          localStorage.setItem("adm-employees", JSON.stringify(data.employees || []));
          localStorage.setItem("adm-attendance", JSON.stringify(data.attendance || {}));
        } catch {}
      }
    } catch {
      if (init) {
        try {
          const e = localStorage.getItem("adm-employees");
          const a = localStorage.getItem("adm-attendance");
          if (e) setEmployees(JSON.parse(e));
          if (a) setAttendance(JSON.parse(a));
        } catch {}
      }
    } finally { if (init) setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData(true);
    const iv = setInterval(() => fetchData(false), 3000);
    const onFocus = () => fetchData(false);
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, [fetchData]);

  // ── Auth handlers ────────────────────────────────────────────────────────────

  // LOGIN — check email & password via DB
  const handleLogin = async (e) => {
    e?.preventDefault();
    const email    = loginEmail.trim();
    const password = loginPassword.trim();
    if (!email || !email.includes("@")) return setAuthError("Please enter a valid email.");
    if (!password) return setAuthError("Please enter your password.");
    setAuthError(""); setAuthSuccess(""); setAuthLoading(true);
    try {
      const res  = await fetch("/api/login", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!data.success) {
        setAuthError(data.error || "Login failed.");
        return;
      }
      setCurrentUser(data.user);
      localStorage.setItem("adm-user", JSON.stringify(data.user));
    } catch {
      setAuthError("Something went wrong. Please try again.");
    } finally { setAuthLoading(false); }
  };

  // SIGNUP — send OTP
  const handleSendOtp = async (e) => {
    e?.preventDefault();
    const name     = signupName.trim();
    const email    = signupEmail.trim();
    const password = signupPassword.trim();
    if (!name)  return setAuthError("Please enter your name.");
    if (!email || !email.includes("@")) return setAuthError("Please enter a valid email.");
    if (!password) return setAuthError("Please create a password.");
    setAuthError(""); setAuthSuccess(""); setAuthLoading(true);
    try {
      const res  = await fetch("/api/send-otp", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ email, name })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error||"Failed to send");
      setAuthStep("verify");
      setCooldown(60);
    } catch (err) { setAuthError(err.message);
    } finally { setAuthLoading(false); }
  };

  // SIGNUP — verify OTP
  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    if (otp.replace(/\D/g,"").length < 6) return setAuthError("Enter the 6-digit code.");
    setAuthError(""); setAuthSuccess(""); setAuthLoading(true);
    try {
      const res  = await fetch("/api/verify-otp", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ email: signupEmail.trim(), otp: otp.trim() })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error||"Verification failed");

      const user = {
        id: uid(),
        name: signupName.trim(),
        email: signupEmail.trim(),
        password: signupPassword.trim(),
        role: signupRole
      };
      setEmployees(prev=>[...prev,user]);
      await fetch("/api/employees", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify(user)
      }).catch(()=>{});

      setCurrentUser(user);
      localStorage.setItem("adm-user", JSON.stringify(user));
    } catch (err) { setAuthError(err.message);
    } finally { setAuthLoading(false); }
  };

  // FORGOT PASSWORD — send reset code
  const handleSendResetOtp = async (e) => {
    e?.preventDefault();
    const email = forgotEmail.trim();
    if (!email || !email.includes("@")) return setAuthError("Please enter a valid email.");
    setAuthError(""); setAuthSuccess(""); setAuthLoading(true);
    try {
      const res  = await fetch("/api/send-reset-otp", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to send reset code.");
      setForgotStep("verify");
      setCooldown(60);
    } catch (err) { setAuthError(err.message);
    } finally { setAuthLoading(false); }
  };

  // FORGOT PASSWORD — verify code & update password
  const handleResetPassword = async (e) => {
    e?.preventDefault();
    if (forgotOtp.replace(/\D/g,"").length < 6) return setAuthError("Enter the 6-digit code.");
    if (!forgotNewPassword.trim()) return setAuthError("Please enter a new password.");
    setAuthError(""); setAuthSuccess(""); setAuthLoading(true);
    try {
      const res  = await fetch("/api/reset-password", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          email: forgotEmail.trim(),
          otp: forgotOtp.trim(),
          newPassword: forgotNewPassword.trim()
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Reset failed.");

      setAuthSuccess("Password updated successfully! Please login with your new password.");
      setAuthTab("login"); setForgotStep("form");
      setForgotEmail(""); setForgotOtp(""); setForgotNewPassword("");
    } catch (err) { setAuthError(err.message);
    } finally { setAuthLoading(false); }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setAuthTab("login"); setAuthStep("form"); setForgotStep("form");
    setLoginEmail(""); setLoginPassword("");
    setSignupName(""); setSignupEmail(""); setSignupPassword(""); setSignupRole(DEFAULT_ROLES[0]);
    setForgotEmail(""); setForgotOtp(""); setForgotNewPassword("");
    setOtp(""); setAuthError(""); setAuthSuccess("");
    localStorage.removeItem("adm-user");
  };

  const switchTab = (t) => {
    setAuthTab(t); setAuthStep("form"); setForgotStep("form");
    setAuthError(""); setAuthSuccess(""); setOtp("");
    setForgotEmail(""); setForgotOtp(""); setForgotNewPassword("");
  };

  // ── Attendance ───────────────────────────────────────────────────────────────
  const setStatus = async (empId, dateStr, status, site) => {
    const key  = `${empId}__${dateStr}`;
    const next = { ...attendance };
    const curSite = site !== undefined ? site : (next[key]?.site || "");
    if (status === null) delete next[key];
    else next[key] = { status, site: curSite };
    setAttendance(next);
    try {
      const res  = await fetch("/api/attendance", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ id:key, empId, dateStr, status, site:curSite })
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error);
      fetchData(false);
    } catch (err) { setAppErr("Sync error: "+err.message); }
  };

  const cycleStatus = (empId, dateStr) => {
    const key = `${empId}__${dateStr}`;
    const cur = attendance[key]?.status ?? null;
    setStatus(empId, dateStr, STATUS_CYCLE[(STATUS_CYCLE.indexOf(cur)+1)%STATUS_CYCLE.length]);
  };

  const markAllPresent = async () => {
    const dateStr = fmtDate(selDate);
    const next    = { ...attendance };
    employees.forEach(emp => { next[`${emp.id}__${dateStr}`] = { status:"present", site: next[`${emp.id}__${dateStr}`]?.site||"" }; });
    setAttendance(next);
    try { await fetch("/api/mark-all-present",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({dateStr})}); fetchData(false); } catch {}
  };

  // ── Employees ────────────────────────────────────────────────────────────────
  const addEmployee = async () => {
    if (!newName.trim()) return;
    const emp = { id:uid(), name:newName.trim(), email:newEmail.trim(), role:newRole };
    setEmployees(prev=>[...prev,emp]);
    setNewName(""); setNewEmail("");
    try { await fetch("/api/employees",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(emp)}); fetchData(false);
    } catch { setAppErr("Failed to save employee."); }
  };

  const removeEmployee = async (id) => {
    setEmployees(prev=>prev.filter(e=>e.id!==id));
    try { await fetch(`/api/employees/${id}`,{method:"DELETE"}); fetchData(false); } catch {}
  };

  const clearAll = async () => {
    setEmployees([]); setAttendance({}); setConfirmClear(false);
    try { await fetch("/api/clear-all",{method:"POST"}); fetchData(false); } catch {}
  };

  // ── Computed ─────────────────────────────────────────────────────────────────
  const selDateStr = fmtDate(selDate);

  const todayStats = useMemo(() => {
    let present=0, absent=0, leave=0, half=0, marked=0;
    employees.forEach(emp => {
      const r = attendance[`${emp.id}__${selDateStr}`];
      if (r) { marked++; if(r.status==="present")present++; else if(r.status==="absent")absent++; else if(r.status==="leave")leave++; else if(r.status==="half")half++; }
    });
    const total = employees.length;
    return { present,absent,leave,half,marked,total, pct: total>0?Math.round((marked/total)*100):0 };
  }, [attendance, employees, selDateStr]);

  const filteredEmps = useMemo(() => {
    if (filterSt==="all") return employees;
    return employees.filter(emp => {
      const r = attendance[`${emp.id}__${selDateStr}`];
      if (filterSt==="unmarked") return !r;
      return r?.status === filterSt;
    });
  }, [employees, attendance, selDateStr, filterSt]);

  const monthDays = useMemo(() => {
    const cnt = new Date(regMonth.getFullYear(), regMonth.getMonth()+1, 0).getDate();
    return Array.from({length:cnt},(_,i)=>i+1);
  }, [regMonth]);

  const monthStats = useMemo(() => {
    const y=regMonth.getFullYear(), m=regMonth.getMonth(), stats={};
    employees.forEach(emp => {
      let present=0, marked=0;
      monthDays.forEach(day => {
        const r = attendance[`${emp.id}__${fmtDate(new Date(y,m,day))}`];
        if (r) { marked++; present += r.status==="present"?1:r.status==="half"?0.5:0; }
      });
      stats[emp.id] = marked ? Math.round((present/marked)*100) : null;
    });
    return stats;
  }, [attendance, employees, monthDays, regMonth]);

  // ── Exports ──────────────────────────────────────────────────────────────────
  const exportMonthly = () => {
    const y=regMonth.getFullYear(), m=regMonth.getMonth(), mn=monthLabel(regMonth);
    const header = ["Employee","Role",...monthDays.map(d=>String(d)),"Present %"];
    const rows = employees.map(emp => {
      const cells = monthDays.map(day => { const r=attendance[`${emp.id}__${fmtDate(new Date(y,m,day))}`]; return r?STATUS[r.status].short:""; });
      const pct = monthStats[emp.id];
      return [emp.name, emp.role, ...cells, pct==null?"": `${pct}%`];
    });
    const ws = XLSX.utils.aoa_to_sheet([[`Attendance — ${mn}`],[],header,...rows]);
    ws["!cols"] = [{wch:22},{wch:16},...monthDays.map(()=>({wch:4})),{wch:10}];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Register");
    XLSX.writeFile(wb,`Attendance_${mn.replace(" ","_")}.xlsx`);
    setExportNote("Downloaded!"); setTimeout(()=>setExportNote(""),3000);
  };

  const exportClient = () => {
    const y=regMonth.getFullYear(), m=regMonth.getMonth(), mn=monthLabel(regMonth);
    const byClient={};
    employees.forEach(emp => {
      monthDays.forEach(day => {
        const ds=fmtDate(new Date(y,m,day)), r=attendance[`${emp.id}__${ds}`];
        if(r?.status==="present"&&isClientSite(r.site)) {
          const cl=r.site.trim();
          if(!byClient[cl]) byClient[cl]=[];
          byClient[cl].push({date:ds,employee:emp.name,role:emp.role});
        }
      });
    });
    const clients = Object.keys(byClient).sort();
    if(!clients.length) { setExportNote("No client-site data found."); setTimeout(()=>setExportNote(""),3000); return; }
    const wb=XLSX.utils.book_new(), used=new Set();
    const ws0=XLSX.utils.aoa_to_sheet([[`Client Report — ${mn}`],[],["Client","Days","Employees"],...clients.map(c=>{const e=byClient[c];return[c,e.length,new Set(e.map(x=>x.employee)).size];})]);
    XLSX.utils.book_append_sheet(wb,ws0,safeSheetName("Summary",used));
    clients.forEach(cl=>{
      const rows=byClient[cl].sort((a,b)=>a.date.localeCompare(b.date));
      const ws=XLSX.utils.aoa_to_sheet([[cl],[],["Date","Employee","Role"],...rows.map(e=>[e.date,e.employee,e.role])]);
      XLSX.utils.book_append_sheet(wb,ws,safeSheetName(cl,used));
    });
    XLSX.writeFile(wb,`Client_${mn.replace(" ","_")}.xlsx`);
    setExportNote(`Downloaded (${clients.length} clients)`); setTimeout(()=>setExportNote(""),3000);
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading && !currentUser) {
    return (
      <div className="splash">
        <img src="/Logo.png" alt="" className="splash-logo" />
        <Loader2 size={16} className="spin" />
      </div>
    );
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────
  if (!currentUser) {
    return (
      <div className="auth-page">
        <div className="auth-box">

          {/* Logo */}
          <div className="auth-logo-row">
            <img src="/Logo.png" alt="Logo" className="auth-logo" />
            <span className="auth-app-name">Attendance Tracker</span>
          </div>

          {/* Tab slider */}
          <div className="auth-tabs">
            <button className={`auth-tab ${authTab==="login"?"on":""}`} onClick={()=>switchTab("login")}>Login</button>
            <button className={`auth-tab ${authTab==="signup"?"on":""}`} onClick={()=>switchTab("signup")}>Sign Up</button>
          </div>

          {authError   && <p className="auth-err">{authError}</p>}
          {authSuccess && <p className="auth-note">{authSuccess}</p>}

          {/* ── LOGIN ── */}
          {authTab === "login" && (
            <form className="auth-form" onSubmit={handleLogin}>
              <div className="fld">
                <label>Email</label>
                <input className="finput" type="email" placeholder="you@firm.com" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} required />
              </div>
              <div className="fld">
                <div className="row-between">
                  <label>Password</label>
                  <button type="button" className="link-btn" style={{fontSize:11}} onClick={()=>switchTab("forgot")}>Forgot password?</button>
                </div>
                <input className="finput" type="password" placeholder="Enter your password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} required />
              </div>
              <button className="auth-submit" type="submit" disabled={authLoading}>
                {authLoading ? <Loader2 size={14} className="spin"/> : "Login"}
              </button>
              <p className="auth-switch">Don't have an account? <button type="button" onClick={()=>switchTab("signup")}>Sign up</button></p>
            </form>
          )}

          {/* ── FORGOT PASSWORD — STEP 1 ── */}
          {authTab === "forgot" && forgotStep === "form" && (
            <form className="auth-form" onSubmit={handleSendResetOtp}>
              <p className="verify-hint">Enter your email address to receive a 6-digit password reset code.</p>
              <div className="fld">
                <label>Email</label>
                <input className="finput" type="email" placeholder="you@firm.com" value={forgotEmail} onChange={e=>setForgotEmail(e.target.value)} required />
              </div>
              <button className="auth-submit" type="submit" disabled={authLoading}>
                {authLoading ? <Loader2 size={14} className="spin"/> : "Send Reset Code"}
              </button>
              <p className="auth-switch">Remember your password? <button type="button" onClick={()=>switchTab("login")}>Login</button></p>
            </form>
          )}

          {/* ── FORGOT PASSWORD — STEP 2 ── */}
          {authTab === "forgot" && forgotStep === "verify" && (
            <form className="auth-form" onSubmit={handleResetPassword}>
              <p className="verify-hint">Enter the code sent to <strong>{forgotEmail}</strong> and your new password.</p>
              <div className="fld">
                <label>Verification Code</label>
                <input
                  className="finput code-input"
                  type="text" inputMode="numeric"
                  placeholder="Enter 6-digit code"
                  maxLength={6}
                  value={forgotOtp}
                  onChange={e=>setForgotOtp(e.target.value.replace(/\D/g,"").slice(0,6))}
                  autoFocus
                />
              </div>
              <div className="fld">
                <label>New Password</label>
                <input
                  className="finput"
                  type="password"
                  placeholder="Enter new password"
                  value={forgotNewPassword}
                  onChange={e=>setForgotNewPassword(e.target.value)}
                  required
                />
              </div>
              <button className="auth-submit" type="submit" disabled={authLoading || forgotOtp.replace(/\D/g,"").length < 6 || !forgotNewPassword.trim()}>
                {authLoading ? <Loader2 size={14} className="spin"/> : "Update Password"}
              </button>
              <div className="verify-actions">
                <button type="button" className="link-btn" onClick={()=>{setForgotStep("form");setForgotOtp("");setForgotNewPassword("");setAuthError("");}}>Back</button>
                <button type="button" className="link-btn" disabled={cooldown>0} onClick={handleSendResetOtp}>
                  {cooldown>0 ? `Resend in ${cooldown}s` : "Resend"}
                </button>
              </div>
            </form>
          )}

          {/* ── SIGN UP — FORM ── */}
          {authTab === "signup" && authStep === "form" && (
            <form className="auth-form" onSubmit={handleSendOtp}>
              <div className="fld">
                <label>Name</label>
                <input className="finput" placeholder="Your full name" value={signupName} onChange={e=>setSignupName(e.target.value)} required />
              </div>
              <div className="fld">
                <label>Email</label>
                <input className="finput" type="email" placeholder="you@firm.com" value={signupEmail} onChange={e=>setSignupEmail(e.target.value)} required />
              </div>
              <div className="fld">
                <label>Password</label>
                <input className="finput" type="password" placeholder="Create a password" value={signupPassword} onChange={e=>setSignupPassword(e.target.value)} required />
              </div>
              <div className="fld">
                <label>Role</label>
                <div className="role-pills">
                  {rolesList.map(r=>(
                    <button key={r} type="button" className={`role-pill ${signupRole===r?"on":""}`} onClick={()=>setSignupRole(r)}>{r}</button>
                  ))}
                </div>
              </div>
              <button className="auth-submit" type="submit" disabled={authLoading}>
                {authLoading ? <Loader2 size={14} className="spin"/> : "Send Verification Code"}
              </button>
              <p className="auth-switch">Already have an account? <button type="button" onClick={()=>switchTab("login")}>Login</button></p>
            </form>
          )}

          {/* ── SIGN UP — VERIFY ── */}
          {authTab === "signup" && authStep === "verify" && (
            <form className="auth-form" onSubmit={handleVerifyOtp}>
              <p className="verify-hint">Enter the code sent to <strong>{signupEmail}</strong></p>
              <div className="fld">
                <label>Verification Code</label>
                <input
                  className="finput code-input"
                  type="text" inputMode="numeric"
                  placeholder="Enter 6-digit code"
                  maxLength={6}
                  value={otp}
                  onChange={e=>setOtp(e.target.value.replace(/\D/g,"").slice(0,6))}
                  autoFocus
                />
              </div>
              <button className="auth-submit" type="submit" disabled={authLoading || otp.replace(/\D/g,"").length < 6}>
                {authLoading ? <Loader2 size={14} className="spin"/> : "Verify"}
              </button>
              <div className="verify-actions">
                <button type="button" className="link-btn" onClick={()=>{setAuthStep("form");setOtp("");setAuthError("");}}>Back</button>
                <button type="button" className="link-btn" disabled={cooldown>0} onClick={handleSendOtp}>
                  {cooldown>0 ? `Resend in ${cooldown}s` : "Resend"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ── Main App ─────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="hdr">
        <div className="hdr-in">
          <div className="hdr-brand">
            <img src="/Logo.png" alt="Logo" className="hdr-logo" />
            <span className="hdr-title">Attendance Tracker</span>
          </div>
          <div className="hdr-user">
            <span className="hdr-uname">{currentUser.name}</span>
            <button className="hdr-logout" onClick={handleLogout} title="Sign out"><LogOut size={14}/></button>
          </div>
        </div>
        <nav className="nav">
          <button className={`nb ${tab==="today"?"on":""}`} onClick={()=>setTab("today")}>Today</button>
          <button className={`nb ${tab==="register"?"on":""}`} onClick={()=>setTab("register")}>Register</button>
          <button className={`nb ${tab==="employees"?"on":""}`} onClick={()=>setTab("employees")}>Employees</button>
        </nav>
      </header>

      {/* Main */}
      <main className="main">
        {appErr && (
          <div className="err-bar">
            <AlertCircle size={13}/><span>{appErr}</span>
            <button onClick={()=>setAppErr("")}><X size={12}/></button>
          </div>
        )}

        {/* TODAY */}
        {tab==="today" && (
          <>
            {/* Date nav */}
            <div className="row-between mb-12">
              <div className="date-nav">
                <button className="icon-btn" onClick={()=>setSelDate(new Date(selDate.getTime()-86400000))}><ChevronLeft size={15}/></button>
                <span className="date-str">{selDate.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</span>
                <button className="icon-btn" onClick={()=>setSelDate(new Date(selDate.getTime()+86400000))}><ChevronRight size={15}/></button>
              </div>
              <button className="sm-btn" onClick={()=>setSelDate(new Date())}>Today</button>
            </div>

            {/* Stats strip */}
            {employees.length > 0 && (
              <div className="stat-strip mb-12">
                <div className="stat-bar">
                  <div style={{width:`${(todayStats.present/(todayStats.total||1))*100}%`,background:"#16a34a"}}/>
                  <div style={{width:`${(todayStats.absent/(todayStats.total||1))*100}%`,background:"#1e293b"}}/>
                  <div style={{width:`${(todayStats.leave/(todayStats.total||1))*100}%`,background:"#92400e"}}/>
                  <div style={{width:`${(todayStats.half/(todayStats.total||1))*100}%`,background:"#4f46e5"}}/>
                </div>
                <div className="stat-pills-row">
                  <span className="spill green"><span className="spill-count">{todayStats.present}</span> Present</span>
                  <span className="spill dark"><span className="spill-count">{todayStats.absent}</span> Absent</span>
                  <span className="spill amber"><span className="spill-count">{todayStats.leave}</span> Leave</span>
                  <span className="spill indigo"><span className="spill-count">{todayStats.half}</span> Half Day</span>
                  <span className="spill marked ml-auto"><span className="spill-count">{todayStats.pct}%</span> Marked</span>
                </div>
                <div className="row-between">
                  <button className="sm-btn green" onClick={markAllPresent}><CheckCheck size={12}/> Mark All Present</button>
                  <div className="filter-row">
                    {["all","unmarked","present","absent"].map(f=>(
                      <button key={f} className={`fpill ${filterSt===f?"on":""}`} onClick={()=>setFilterSt(f)}>
                        {f.charAt(0).toUpperCase()+f.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {employees.length === 0 ? (
              <div className="empty">No employees added. Go to the Employees tab.</div>
            ) : (
              filteredEmps.map(emp => {
                const key = `${emp.id}__${selDateStr}`;
                const rec = attendance[key];
                const cur = rec?.status;
                return (
                  <div className="emp-row" key={emp.id}>
                    <div className="emp-left">
                      <div className="emp-av">{emp.name.charAt(0).toUpperCase()}</div>
                      <div>
                        <div className="emp-name">{emp.name}</div>
                        <div className="emp-role">{emp.role}</div>
                      </div>
                    </div>
                    <div className="status-btns">
                      {["present","absent","leave","half"].map(s=>{
                        const meta=STATUS[s], active=cur===s;
                        return (
                          <button key={s}
                            className={`sbtn ${active?"sbtn-on":""}`}
                            style={active?{background:meta.color,borderColor:meta.color,color:"#fff"}:{}}
                            onClick={()=>setStatus(emp.id,selDateStr,active?null:s)}>
                            {meta.label}
                          </button>
                        );
                      })}
                    </div>
                    {cur==="present" && (
                      <div className="site-row">
                        <input className="site-in" placeholder="Location (optional)"
                          value={siteDrafts[key]??rec?.site??""}
                          onChange={e=>setSiteDrafts({...siteDrafts,[key]:e.target.value})}
                          onBlur={e=>setStatus(emp.id,selDateStr,"present",e.target.value)}
                        />
                        <div className="site-chips">
                          {["Office / HQ","Client Site","Work From Home"].map(opt=>(
                            <button key={opt} className="schip"
                              onClick={()=>{setSiteDrafts({...siteDrafts,[key]:opt});setStatus(emp.id,selDateStr,"present",opt);}}>
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

        {/* REGISTER */}
        {tab==="register" && (
          <div className="register-view">
            <div className="row-between mb-12">
              <div className="date-nav">
                <button className="icon-btn" onClick={()=>setRegMonth(new Date(regMonth.getFullYear(),regMonth.getMonth()-1,1))}><ChevronLeft size={15}/></button>
                <span className="date-str">{monthLabel(regMonth)}</span>
                <button className="icon-btn" onClick={()=>setRegMonth(new Date(regMonth.getFullYear(),regMonth.getMonth()+1,1))}><ChevronRight size={15}/></button>
              </div>
            </div>
            <div className="row-gap mb-12">
              <button className="sm-btn" onClick={exportMonthly} disabled={!employees.length}><Download size={12}/> Monthly</button>
              <button className="sm-btn" onClick={exportClient}  disabled={!employees.length}><Building2 size={12}/> Client Report</button>
              {exportNote && <span className="export-ok">{exportNote}</span>}
            </div>
            <div className="legend mb-12">
              {Object.values(STATUS).map(s=>(
                <span key={s.key} className="leg-item"><span className="leg-dot" style={{background:s.color}}/>{s.label} ({s.short})</span>
              ))}
            </div>
            {employees.length===0 ? (
              <div className="empty">No employees yet.</div>
            ) : (
              <div className="table-wrap">
                <table className="reg-tbl">
                  <thead>
                    <tr>
                      <th className="sticky-col">Employee</th>
                      {monthDays.map(d=><th key={d}>{d}</th>)}
                      <th>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map(emp=>(
                      <tr key={emp.id}>
                        <td className="sticky-col">
                          <div className="reg-name">{emp.name}</div>
                          <div className="reg-role">{emp.role}</div>
                        </td>
                        {monthDays.map(day=>{
                          const ds=fmtDate(new Date(regMonth.getFullYear(),regMonth.getMonth(),day));
                          const r=attendance[`${emp.id}__${ds}`];
                          const meta=r?STATUS[r.status]:null;
                          return (
                            <td key={day}>
                              <div className="cell"
                                style={meta?{background:meta.color,color:"#fff",borderColor:meta.color}:{}}
                                title={meta?`${meta.label}${r.site?" — "+r.site:""}`:"Not marked"}
                                onClick={()=>cycleStatus(emp.id,ds)}>
                                {meta?meta.short:""}
                              </div>
                            </td>
                          );
                        })}
                        <td><span className="pct">{monthStats[emp.id]==null?"—":`${monthStats[emp.id]}%`}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* EMPLOYEES */}
        {tab==="employees" && (
          <>
            <div className="block mb-16">
              <p className="block-title">Add Employee</p>
              <div className="add-form">
                <input className="finput" placeholder="Full name" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addEmployee()} />
                <input className="finput" placeholder="Email (optional)" value={newEmail} onChange={e=>setNewEmail(e.target.value)} />
                <div className="fld">
                  <label>Role</label>
                  <div className="role-pills">
                    {rolesList.map(r=>(
                      <button key={r} type="button" className={`role-pill ${newRole===r?"on":""}`} onClick={()=>setNewRole(r)}>{r}</button>
                    ))}
                  </div>
                </div>
                <button className="auth-submit" onClick={addEmployee} disabled={!newName.trim()}>
                  <Plus size={14}/> Add Employee
                </button>
              </div>
            </div>

            {employees.length===0 ? (
              <div className="empty">No employees yet.</div>
            ) : (
              employees.map(emp=>(
                <div className="emp-row" key={emp.id} style={{alignItems:"center"}}>
                  <div className="emp-left" style={{flex:1}}>
                    <div className="emp-av">{emp.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <div className="emp-name">{emp.name}</div>
                      <div className="emp-role">{emp.role}{emp.email?` · ${emp.email}`:""}</div>
                    </div>
                  </div>
                  <button className="del-btn" onClick={()=>removeEmployee(emp.id)}><Trash2 size={13}/></button>
                </div>
              ))
            )}

            <div className="danger-zone">
              {!confirmClear ? (
                <button className="link-btn red" onClick={()=>setConfirmClear(true)}>Clear all data</button>
              ) : (
                <div>
                  <p className="danger-txt">This permanently deletes all employees and attendance records.</p>
                  <div className="row-gap" style={{marginTop:8}}>
                    <button className="sm-btn red" onClick={clearAll}>Confirm Delete</button>
                    <button className="link-btn"   onClick={()=>setConfirmClear(false)}>Cancel</button>
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