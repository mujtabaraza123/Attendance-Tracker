import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2, Download, Building2, CheckCheck, Loader2, ArrowRight, LogOut, X, AlertCircle, User, Users, Calendar, Shield, MapPin, CheckCircle2, Clock, FileSpreadsheet } from "lucide-react";
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
const ADMIN_EMAILS = [
  "bscs25059@itu.edu.pk",
  "anwartariqco@gmail.com",
  "no.auth.verify@gmail.com",
  "razamujtaba714@gmail.com"
];

function isEmailAdmin(email) {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase().trim());
}

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
  const [viewMode,   setViewMode]   = useState(() => {
    try {
      const r = localStorage.getItem("adm-user");
      const u = r ? JSON.parse(r) : null;
      return isEmailAdmin(u?.email) ? "team" : "my";
    } catch {
      return "my";
    }
  });
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

  // Helper for safe JSON fetching
  const safeFetchJson = async (url, options) => {
    const res = await fetch(url, options);
    const contentType = res.headers.get("content-type") || "";
    let data = null;
    if (contentType.includes("application/json")) {
      try {
        data = await res.json();
      } catch {}
    }
    if (data && typeof data === "object") {
      if (!data.success && data.error) {
        throw new Error(data.error);
      }
      return data;
    }
    if (!res.ok) {
      throw new Error(`Server error (${res.status}). Please verify backend service.`);
    }
    return { success: true };
  };

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
      const data = await safeFetchJson("/api/login", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ email, password })
      });
      if (!data.success) {
        setAuthError(data.error || "Login failed.");
        return;
      }
      setCurrentUser(data.user);
      localStorage.setItem("adm-user", JSON.stringify(data.user));
      if (isEmailAdmin(data.user.email)) {
        setViewMode("team");
      }
    } catch (err) {
      setAuthError(err.message || "Something went wrong. Please try again.");
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

    // Check if email already registered in loaded list
    if (employees.some(emp => emp.email && emp.email.toLowerCase().trim() === email.toLowerCase())) {
      return setAuthError("An account with this email already exists. Please log in.");
    }

    setAuthError(""); setAuthSuccess(""); setAuthLoading(true);
    try {
      const data = await safeFetchJson("/api/send-otp", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ email, name })
      });
      if (!data.success) throw new Error(data.error||"Failed to send verification code");
      setAuthStep("verify");
      setCooldown(60);
    } catch (err) { setAuthError(err.message || "Failed to send code.");
    } finally { setAuthLoading(false); }
  };

  // SIGNUP — verify OTP
  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    if (otp.replace(/\D/g,"").length < 6) return setAuthError("Enter the 6-digit code.");
    setAuthError(""); setAuthSuccess(""); setAuthLoading(true);
    try {
      const data = await safeFetchJson("/api/verify-otp", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ email: signupEmail.trim(), otp: otp.trim() })
      });
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
    } catch (err) { setAuthError(err.message || "Verification error.");
    } finally { setAuthLoading(false); }
  };

  // FORGOT PASSWORD — send reset code
  const handleSendResetOtp = async (e) => {
    e?.preventDefault();
    const email = forgotEmail.trim();
    if (!email || !email.includes("@")) return setAuthError("Please enter a valid email.");
    setAuthError(""); setAuthSuccess(""); setAuthLoading(true);
    try {
      const data = await safeFetchJson("/api/send-reset-otp", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ email })
      });
      if (!data.success) throw new Error(data.error || "Failed to send reset code.");
      setForgotStep("verify");
      setCooldown(60);
    } catch (err) { setAuthError(err.message || "Failed to send reset code.");
    } finally { setAuthLoading(false); }
  };

  // FORGOT PASSWORD — verify code & update password
  const handleResetPassword = async (e) => {
    e?.preventDefault();
    if (forgotOtp.replace(/\D/g,"").length < 6) return setAuthError("Enter the 6-digit code.");
    if (!forgotNewPassword.trim()) return setAuthError("Please enter a new password.");
    setAuthError(""); setAuthSuccess(""); setAuthLoading(true);
    try {
      const data = await safeFetchJson("/api/reset-password", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          email: forgotEmail.trim(),
          otp: forgotOtp.trim(),
          newPassword: forgotNewPassword.trim()
        })
      });
      if (!data.success) throw new Error(data.error || "Reset failed.");

      setAuthSuccess("Password updated successfully! Please login with your new password.");
      setAuthTab("login"); setForgotStep("form");
      setForgotEmail(""); setForgotOtp(""); setForgotNewPassword("");
    } catch (err) { setAuthError(err.message || "Reset failed.");
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

  const handleInputFocus = (e) => {
    const el = e.target;
    setTimeout(() => {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 250);
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
    const cleanEmail = newEmail.trim().toLowerCase();
    if (cleanEmail && employees.some(e => e.email && e.email.toLowerCase().trim() === cleanEmail)) {
      setAppErr("An employee with this email already exists.");
      return;
    }
    const emp = { id:uid(), name:newName.trim(), email:newEmail.trim(), role:newRole };
    setEmployees(prev=>[...prev,emp]);
    setNewName(""); setNewEmail("");
    try {
      const res = await fetch("/api/employees",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(emp)});
      const data = await res.json();
      if (!data.success) {
        setAppErr(data.error || "Failed to save employee.");
      }
      fetchData(false);
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

  // ── Computed Logged-In User Data ─────────────────────────────────────────────
  const myEmployee = useMemo(() => {
    if (!currentUser) return null;
    return employees.find(e =>
      (currentUser.id && e.id === currentUser.id) ||
      (currentUser.email && e.email && e.email.toLowerCase().trim() === currentUser.email.toLowerCase().trim())
    ) || currentUser;
  }, [employees, currentUser]);

  const myEmpId = myEmployee?.id || currentUser?.id;

  const isAuthor = useMemo(() => {
    if (!currentUser) return false;
    return isEmailAdmin(currentUser.email);
  }, [currentUser]);

  const isAdminOrManager = useMemo(() => {
    if (!currentUser) return false;
    const r = (currentUser.role || "").toLowerCase().trim();
    return isEmailAdmin(currentUser.email) || ["partner", "manager", "admin"].includes(r);
  }, [currentUser]);

  const selDateStr = fmtDate(selDate);

  // My Personal Today record
  const myTodayKey = `${myEmpId}__${selDateStr}`;
  const myTodayRec = attendance[myTodayKey];
  const myTodayStatus = myTodayRec?.status ?? null;
  const myTodaySite = myTodayRec?.site || "";

  // Team Today Stats (for managers/admins)
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

  // Personal monthly summary
  const myMonthSummary = useMemo(() => {
    if (!myEmpId) return { present: 0, absent: 0, leave: 0, half: 0, marked: 0, pct: null };
    const y = regMonth.getFullYear(), m = regMonth.getMonth();
    let present = 0, absent = 0, leave = 0, half = 0, marked = 0;
    monthDays.forEach(day => {
      const ds = fmtDate(new Date(y, m, day));
      const r = attendance[`${myEmpId}__${ds}`];
      if (r) {
        marked++;
        if (r.status === "present") present++;
        else if (r.status === "absent") absent++;
        else if (r.status === "leave") leave++;
        else if (r.status === "half") half++;
      }
    });
    const effectivePresent = present + (half * 0.5);
    const pct = marked > 0 ? Math.round((effectivePresent / marked) * 100) : null;
    return { present, absent, leave, half, marked, pct };
  }, [attendance, myEmpId, monthDays, regMonth]);

  // Personal all-time summary
  const myAllTimeSummary = useMemo(() => {
    if (!myEmpId) return { totalMarked: 0, presentDays: 0, pct: 0 };
    let totalMarked = 0, presentScore = 0;
    Object.keys(attendance).forEach(key => {
      if (key.startsWith(`${myEmpId}__`)) {
        const r = attendance[key];
        if (r) {
          totalMarked++;
          if (r.status === "present") presentScore += 1;
          else if (r.status === "half") presentScore += 0.5;
        }
      }
    });
    const pct = totalMarked > 0 ? Math.round((presentScore / totalMarked) * 100) : 0;
    return { totalMarked, presentDays: presentScore, pct };
  }, [attendance, myEmpId]);

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

  // Personal Monthly Export
  const exportMyMonthly = () => {
    if (!myEmployee) return;
    const y = regMonth.getFullYear(), m = regMonth.getMonth(), mn = monthLabel(regMonth);
    const header = ["Date", "Day", "Status", "Site / Location"];
    const rows = monthDays.map(day => {
      const d = new Date(y, m, day);
      const ds = fmtDate(d);
      const r = attendance[`${myEmpId}__${ds}`];
      const dayName = d.toLocaleDateString("en-US", { weekday: "short" });
      const statusLabel = r ? (STATUS[r.status]?.label || r.status) : "Unmarked";
      const site = r?.site || "";
      return [ds, dayName, statusLabel, site];
    });

    const pct = myMonthSummary.pct;
    const summaryRows = [
      [`Personal Attendance Report — ${myEmployee.name}`],
      [`Role: ${myEmployee.role || "Staff"}`, `Email: ${myEmployee.email || currentUser?.email || "N/A"}`],
      [`Month: ${mn}`, `Present %: ${pct == null ? "N/A" : `${pct}%`}`],
      [],
      header,
      ...rows
    ];

    const ws = XLSX.utils.aoa_to_sheet(summaryRows);
    ws["!cols"] = [{ wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "My Attendance");
    XLSX.writeFile(wb, `Attendance_${(myEmployee.name || "User").replace(/\s+/g, "_")}_${mn.replace(/\s+/g, "_")}.xlsx`);
    setExportNote("Downloaded personal report!");
    setTimeout(() => setExportNote(""), 3000);
  };

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
                <input className="finput" type="email" placeholder="you@firm.com" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} onFocus={handleInputFocus} required />
              </div>
              <div className="fld">
                <label>Password</label>
                <input className="finput" type="password" placeholder="Enter your password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} onFocus={handleInputFocus} required />
                <div style={{textAlign:"right",marginTop:2}}>
                  <button type="button" className="link-btn" style={{fontSize:11}} onClick={()=>switchTab("forgot")}>Forgot password?</button>
                </div>
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
                <input className="finput" type="email" placeholder="you@firm.com" value={forgotEmail} onChange={e=>setForgotEmail(e.target.value)} onFocus={handleInputFocus} required />
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
                  onFocus={handleInputFocus}
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
                  onFocus={handleInputFocus}
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
                <input className="finput" placeholder="Your full name" value={signupName} onChange={e=>setSignupName(e.target.value)} onFocus={handleInputFocus} required />
              </div>
              <div className="fld">
                <label>Email</label>
                <input className="finput" type="email" placeholder="you@firm.com" value={signupEmail} onChange={e=>setSignupEmail(e.target.value)} onFocus={handleInputFocus} required />
              </div>
              <div className="fld">
                <label>Password</label>
                <input className="finput" type="password" placeholder="Create a password" value={signupPassword} onChange={e=>setSignupPassword(e.target.value)} onFocus={handleInputFocus} required />
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
                  onFocus={handleInputFocus}
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
            <span className="hdr-uname">{myEmployee?.name || currentUser.name}</span>
            {isAuthor ? (
              <span className="my-role-badge" style={{ fontSize: 10, padding: "2px 8px", background: "#0f172a", color: "#ffffff", border: "1px solid #0f172a", fontWeight: 800 }}>
                Author
              </span>
            ) : (
              <span className="my-role-badge" style={{ fontSize: 10, padding: "1px 6px" }}>{myEmployee?.role || currentUser.role || "Staff"}</span>
            )}
            <button className="hdr-logout" onClick={handleLogout} title="Sign out"><LogOut size={14}/></button>
          </div>
        </div>
        <nav className="nav">
          <button className={`nb ${tab==="today"?"on":""}`} onClick={()=>setTab("today")}>Today</button>
          <button className={`nb ${tab==="register"?"on":""}`} onClick={()=>setTab("register")}>Register</button>
          <button className={`nb ${tab==="profile"?"on":""}`} onClick={()=>setTab("profile")}>My Details</button>
          {isAdminOrManager && (
            <button className={`nb ${tab==="team"?"on":""}`} onClick={()=>setTab("team")}>Team</button>
          )}
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

        {/* ── TODAY TAB ── */}
        {tab==="today" && (
          <>
            {/* Date nav & Controls */}
            <div className="row-between mb-12">
              <div className="date-nav">
                <button className="icon-btn" onClick={()=>setSelDate(new Date(selDate.getTime()-86400000))} title="Previous Day"><ChevronLeft size={15}/></button>
                <span className="date-str">{selDate.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"})}</span>
                <button className="icon-btn" onClick={()=>setSelDate(new Date(selDate.getTime()+86400000))} title="Next Day"><ChevronRight size={15}/></button>
              </div>
              <div className="row-gap">
                {isAdminOrManager && (
                  <div className="view-toggle">
                    <button className={`view-toggle-btn ${viewMode==="my"?"on":""}`} onClick={()=>setViewMode("my")}>My Attendance</button>
                    <button className={`view-toggle-btn ${viewMode==="team"?"on":""}`} onClick={()=>setViewMode("team")}>Team View</button>
                  </div>
                )}
                <button className="sm-btn" onClick={()=>setSelDate(new Date())}>Today</button>
              </div>
            </div>

            {/* MY ATTENDANCE VIEW (Default for all users) */}
            {(viewMode === "my" || !isAdminOrManager) ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {/* Hero Attendance Card */}
                <div className="my-hero-card">
                  <div className="my-user-banner">
                    <div className="my-avatar-lg">
                      {(myEmployee?.name || currentUser?.name || "U").charAt(0).toUpperCase()}
                    </div>
                    <div className="my-user-info">
                      <div className="my-user-name">{myEmployee?.name || currentUser?.name}</div>
                      <div className="my-user-sub">
                        <span className="my-role-badge">{myEmployee?.role || currentUser?.role || "Staff"}</span>
                        {currentUser?.email && <span className="my-user-email">{currentUser.email}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="my-status-box">
                    <div className="my-status-header">
                      <span className="my-status-title">Status for {selDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      {myTodayStatus ? (
                        <span
                          className="my-status-badge"
                          style={{
                            background: `${STATUS[myTodayStatus].color}15`,
                            color: STATUS[myTodayStatus].color,
                            border: `1px solid ${STATUS[myTodayStatus].color}40`
                          }}
                        >
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS[myTodayStatus].color, display: "inline-block" }} />
                          {STATUS[myTodayStatus].label} {myTodaySite ? `(${myTodaySite})` : ""}
                        </span>
                      ) : (
                        <span className="my-status-badge" style={{ background: "#f1f5f9", color: "#64748b", border: "1px solid #cbd5e1" }}>
                          Not marked
                        </span>
                      )}
                    </div>

                    {/* Quick status buttons */}
                    <div className="status-btns">
                      {["present", "absent", "leave", "half"].map(s => {
                        const meta = STATUS[s];
                        const active = myTodayStatus === s;
                        return (
                          <button
                            key={s}
                            className={`sbtn ${active ? "sbtn-on" : ""}`}
                            style={active ? { background: meta.color, borderColor: meta.color, color: "#fff", fontWeight: 700 } : {}}
                            onClick={() => setStatus(myEmpId, selDateStr, active ? null : s)}
                          >
                            {meta.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Location selector if Present */}
                    {myTodayStatus === "present" && (
                      <div className="site-row" style={{ marginTop: 4 }}>
                        <input
                          className="site-in"
                          placeholder="Specific location or client name (optional)"
                          value={siteDrafts[myTodayKey] ?? myTodayRec?.site ?? ""}
                          onChange={e => setSiteDrafts({ ...siteDrafts, [myTodayKey]: e.target.value })}
                          onBlur={e => setStatus(myEmpId, selDateStr, "present", e.target.value)}
                        />
                        <div className="site-chips">
                          {["Office / HQ", "Client Site", "Work From Home"].map(opt => (
                            <button
                              key={opt}
                              className="schip"
                              style={myTodaySite === opt ? { background: "var(--c)", color: "var(--wh)", borderColor: "var(--c)" } : {}}
                              onClick={() => {
                                setSiteDrafts({ ...siteDrafts, [myTodayKey]: opt });
                                setStatus(myEmpId, selDateStr, "present", opt);
                              }}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Monthly Quick-Stats Widget */}
                <div className="stat-strip">
                  <div className="row-between">
                    <span className="block-title" style={{ margin: 0 }}>
                      {monthLabel(regMonth)} Summary
                    </span>
                    <span className="spill marked">
                      <span className="spill-count">{myMonthSummary.pct == null ? "—" : `${myMonthSummary.pct}%`}</span> Attendance Rate
                    </span>
                  </div>

                  <div className="stat-bar">
                    <div style={{ width: `${(myMonthSummary.present / (myMonthSummary.marked || 1)) * 100}%`, background: "#16a34a" }} />
                    <div style={{ width: `${(myMonthSummary.absent / (myMonthSummary.marked || 1)) * 100}%`, background: "#1e293b" }} />
                    <div style={{ width: `${(myMonthSummary.leave / (myMonthSummary.marked || 1)) * 100}%`, background: "#92400e" }} />
                    <div style={{ width: `${(myMonthSummary.half / (myMonthSummary.marked || 1)) * 100}%`, background: "#4f46e5" }} />
                  </div>

                  <div className="my-metrics-grid">
                    <div className="my-metric-tile">
                      <span className="my-metric-val" style={{ color: "#16a34a" }}>{myMonthSummary.present}</span>
                      <span className="my-metric-lbl">Present</span>
                    </div>
                    <div className="my-metric-tile">
                      <span className="my-metric-val" style={{ color: "#1e293b" }}>{myMonthSummary.absent}</span>
                      <span className="my-metric-lbl">Absent</span>
                    </div>
                    <div className="my-metric-tile">
                      <span className="my-metric-val" style={{ color: "#92400e" }}>{myMonthSummary.leave}</span>
                      <span className="my-metric-lbl">Leave</span>
                    </div>
                    <div className="my-metric-tile">
                      <span className="my-metric-val" style={{ color: "#4f46e5" }}>{myMonthSummary.half}</span>
                      <span className="my-metric-lbl">Half Day</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* TEAM VIEW (Only for Admin/Manager) */
              <>
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
                  <div className="empty">No employees found.</div>
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
                            <div className="emp-name">{emp.name} {emp.id === myEmpId ? "(You)" : ""}</div>
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
          </>
        )}

        {/* ── REGISTER TAB ── */}
        {tab==="register" && (
          <div className="register-view">
            <div className="row-between mb-12">
              <div className="date-nav">
                <button className="icon-btn" onClick={()=>setRegMonth(new Date(regMonth.getFullYear(),regMonth.getMonth()-1,1))} title="Previous Month"><ChevronLeft size={15}/></button>
                <span className="date-str">{monthLabel(regMonth)}</span>
                <button className="icon-btn" onClick={()=>setRegMonth(new Date(regMonth.getFullYear(),regMonth.getMonth()+1,1))} title="Next Month"><ChevronRight size={15}/></button>
              </div>

              <div className="row-gap">
                {isAdminOrManager && (
                  <div className="view-toggle">
                    <button className={`view-toggle-btn ${viewMode==="my"?"on":""}`} onClick={()=>setViewMode("my")}>My Register</button>
                    <button className={`view-toggle-btn ${viewMode==="team"?"on":""}`} onClick={()=>setViewMode("team")}>Team Register</button>
                  </div>
                )}
                <button className="sm-btn" onClick={viewMode==="my" || !isAdminOrManager ? exportMyMonthly : exportMonthly}>
                  <Download size={12}/> {viewMode==="my" || !isAdminOrManager ? "Download My Report" : "Monthly Export"}
                </button>
                {isAdminOrManager && viewMode==="team" && (
                  <button className="sm-btn" onClick={exportClient} disabled={!employees.length}>
                    <Building2 size={12}/> Client Report
                  </button>
                )}
                {exportNote && <span className="export-ok">{exportNote}</span>}
              </div>
            </div>

            <div className="legend mb-12">
              {Object.values(STATUS).map(s=>(
                <span key={s.key} className="leg-item"><span className="leg-dot" style={{background:s.color}}/>{s.label} ({s.short})</span>
              ))}
            </div>

            {/* Table */}
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
                  {(viewMode==="my" || !isAdminOrManager ? [myEmployee || currentUser] : employees).filter(Boolean).map(emp=>(
                    <tr key={emp.id}>
                      <td className="sticky-col">
                        <div className="reg-name">{emp.name} {emp.id === myEmpId ? "(You)" : ""}</div>
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
                              title={meta?`${meta.label}${r.site?" — "+r.site:""}`:"Click to change"}
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
          </div>
        )}

        {/* ── MY DETAILS TAB ── */}
        {tab==="profile" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="profile-card">
              <div className="profile-hdr">
                <div className="profile-avatar">
                  {(myEmployee?.name || currentUser?.name || "U").charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="profile-title">{myEmployee?.name || currentUser?.name}</div>
                  <div className="profile-subtitle">{currentUser?.email || myEmployee?.email || "Personal Profile"}</div>
                </div>
              </div>

              <div className="profile-details-grid">
                <div className="profile-field">
                  <span className="profile-field-lbl">Full Name</span>
                  <span className="profile-field-val">{myEmployee?.name || currentUser?.name}</span>
                </div>
                <div className="profile-field">
                  <span className="profile-field-lbl">Email Address</span>
                  <span className="profile-field-val">{currentUser?.email || myEmployee?.email || "—"}</span>
                </div>
                <div className="profile-field">
                  <span className="profile-field-lbl">Designation / Role</span>
                  <span className="profile-field-val">{myEmployee?.role || currentUser?.role || "Staff"}</span>
                </div>
                <div className="profile-field">
                  <span className="profile-field-lbl">Account ID</span>
                  <span className="profile-field-val" style={{ fontFamily: "monospace", fontSize: 12 }}>{myEmpId || "—"}</span>
                </div>
                <div className="profile-field">
                  <span className="profile-field-lbl">This Month Attendance</span>
                  <span className="profile-field-val" style={{ color: "#16a34a", fontWeight: 700 }}>
                    {myMonthSummary.pct == null ? "No records yet" : `${myMonthSummary.pct}% (${myMonthSummary.present} days present)`}
                  </span>
                </div>
                <div className="profile-field">
                  <span className="profile-field-lbl">All-Time Attendance Rate</span>
                  <span className="profile-field-val" style={{ fontWeight: 700 }}>
                    {myAllTimeSummary.pct}% ({myAllTimeSummary.totalMarked} days recorded)
                  </span>
                </div>
              </div>

              {isAuthor && (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "11px 14px", display: "flex", alignItems: "center", gap: 10, fontSize: 12, fontWeight: 600, color: "#166534" }}>
                  <Shield size={16} color="#16a34a" />
                  <span>Author / Super Admin: Full administrative control, access to all employee attendance, team register, and management actions.</span>
                </div>
              )}

              <div className="row-between" style={{ marginTop: 8, paddingTop: 14, borderTop: "1px solid var(--bd)" }}>
                <span className="spill green">
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a", display: "inline-block" }} />
                  Account Active
                </span>
                <button className="sm-btn red" onClick={handleLogout}>
                  <LogOut size={12}/> Sign Out
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── TEAM TAB (Admins/Managers Only) ── */}
        {tab==="team" && isAdminOrManager && (
          <>
            <div className="block mb-16">
              <p className="block-title">Add Team Member</p>
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

            <div className="block-title" style={{ marginBottom: 8 }}>Team Directory ({employees.length})</div>
            {employees.length===0 ? (
              <div className="empty">No employees yet.</div>
            ) : (
              employees.map(emp=>(
                <div className="emp-row" key={emp.id} style={{alignItems:"center"}}>
                  <div className="emp-left" style={{flex:1}}>
                    <div className="emp-av">{emp.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <div className="emp-name">{emp.name} {emp.id === myEmpId ? "(You)" : ""}</div>
                      <div className="emp-role">{emp.role}{emp.email?` · ${emp.email}`:""}</div>
                    </div>
                  </div>
                  <button className="del-btn" onClick={()=>removeEmployee(emp.id)} title="Remove employee"><Trash2 size={13}/></button>
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