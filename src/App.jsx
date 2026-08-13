import React, { useState, useEffect, useMemo, useCallback } from "react";
import { 
  Check, 
  X, 
  Clock, 
  Minus, 
  Plus, 
  Trash2, 
  ChevronLeft, 
  ChevronRight, 
  Users, 
  CalendarDays, 
  BookOpen, 
  Loader2, 
  Download, 
  Building2, 
  RefreshCw, 
  AlertCircle 
} from "lucide-react";
import * as XLSX from "xlsx";
import "./App.css";

const STATUS = {
  present: { key: "present", label: "Present", short: "P", color: "#166534" },
  absent: { key: "absent", label: "Absent", short: "A", color: "#991b1b" },
  leave: { key: "leave", label: "Leave", short: "L", color: "#854d0e" },
  half: { key: "half", label: "Half Day", short: "H", color: "#475569" },
};
const STATUS_CYCLE = ["present", "absent", "leave", "half", null];

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthLabel(d) {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const OFFICE_ALIASES = new Set(["office", "hq", "head office", "main office", ""]);

function isClientSite(site) {
  if (!site) return false;
  return !OFFICE_ALIASES.has(site.trim().toLowerCase());
}

function safeSheetName(name, usedNames) {
  let base = String(name).replace(/[\\/?*[\]]/g, "-").slice(0, 31).trim() || "Sheet";
  let candidate = base;
  let n = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
    n += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

export default function AttendanceTracker() {
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [dbConnected, setDbConnected] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [saveErrorMessage, setSaveErrorMessage] = useState("");
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [tab, setTab] = useState("today");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [registerMonth, setRegisterMonth] = useState(new Date());
  const [newEmpName, setNewEmpName] = useState("");
  const [newEmpRole, setNewEmpRole] = useState("");
  const [siteDrafts, setSiteDrafts] = useState({});
  const [confirmClear, setConfirmClear] = useState(false);
  const [exportNote, setExportNote] = useState("");

  const fetchData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    else setIsSyncing(true);

    try {
      const res = await fetch("/api/all-data");
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();
      
      if (data.success) {
        setEmployees(data.employees || []);
        setAttendance(data.attendance || {});
        setDbConnected(true);
        
        try {
          localStorage.setItem("adm-employees", JSON.stringify(data.employees || []));
          localStorage.setItem("adm-attendance", JSON.stringify(data.attendance || {}));
        } catch (e) {}
      } else {
        throw new Error(data.error || "Failed to fetch");
      }
    } catch (err) {
      console.warn("Sync error, fallback to local cache:", err.message);
      setDbConnected(false);
      
      if (isInitial) {
        try {
          const empRaw = localStorage.getItem("adm-employees");
          const attRaw = localStorage.getItem("adm-attendance");
          if (empRaw) setEmployees(JSON.parse(empRaw));
          if (attRaw) setAttendance(JSON.parse(attRaw));
        } catch (e) {}
      }
    } finally {
      if (isInitial) setLoading(false);
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    fetchData(true);
    const interval = setInterval(() => fetchData(false), 3000);
    const handleFocus = () => fetchData(false);
    window.addEventListener("focus", handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [fetchData]);

  const addEmployee = async () => {
    const name = newEmpName.trim();
    if (!name) return;
    const newEmp = { id: uid(), name, role: newEmpRole.trim() || "Staff" };
    
    setEmployees((prev) => [...prev, newEmp]);
    setNewEmpName("");
    setNewEmpRole("");

    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newEmp)
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      fetchData(false);
    } catch (e) {
      setSaveError(true);
      setSaveErrorMessage("Failed to save employee to database.");
    }
  };

  const removeEmployee = async (id) => {
    setEmployees((prev) => prev.filter((e) => e.id !== id));

    try {
      const res = await fetch(`/api/employees/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      fetchData(false);
    } catch (e) {
      setSaveError(true);
      setSaveErrorMessage("Failed to remove employee.");
    }
  };

  const setStatus = async (empId, dateStr, status, site) => {
    const key = `${empId}__${dateStr}`;
    const nextAtt = { ...attendance };
    const currentSite = site !== undefined ? site : (nextAtt[key]?.site || "");

    if (status === null) {
      delete nextAtt[key];
    } else {
      nextAtt[key] = { status, site: currentSite };
    }

    setAttendance(nextAtt);

    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: key, empId, dateStr, status, site: currentSite })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      fetchData(false);
    } catch (e) {
      setSaveError(true);
      setSaveErrorMessage("Failed to sync attendance.");
    }
  };

  const cycleStatus = (empId, dateStr) => {
    const key = `${empId}__${dateStr}`;
    const current = attendance[key]?.status ?? null;
    const idx = STATUS_CYCLE.indexOf(current);
    const nextStatus = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    setStatus(empId, dateStr, nextStatus);
  };

  const clearAllData = async () => {
    setEmployees([]);
    setAttendance({});
    setConfirmClear(false);

    try {
      const res = await fetch("/api/clear-all", { method: "POST" });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      fetchData(false);
    } catch (e) {
      setSaveError(true);
      setSaveErrorMessage("Failed to clear database.");
    }
  };

  const selectedDateStr = fmtDate(selectedDate);

  const monthDays = useMemo(() => {
    const y = registerMonth.getFullYear();
    const m = registerMonth.getMonth();
    const count = new Date(y, m + 1, 0).getDate();
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [registerMonth]);

  const monthStats = useMemo(() => {
    const y = registerMonth.getFullYear();
    const m = registerMonth.getMonth();
    const stats = {};
    employees.forEach((emp) => {
      let present = 0, marked = 0;
      monthDays.forEach((day) => {
        const ds = fmtDate(new Date(y, m, day));
        const rec = attendance[`${emp.id}__${ds}`];
        if (rec) {
          marked += 1;
          if (rec.status === "present" || rec.status === "half") present += rec.status === "half" ? 0.5 : 1;
        }
      });
      stats[emp.id] = marked ? Math.round((present / marked) * 100) : null;
    });
    return stats;
  }, [attendance, employees, monthDays, registerMonth]);

  const exportMonthlyRegister = () => {
    const y = registerMonth.getFullYear();
    const m = registerMonth.getMonth();
    const monthName = monthLabel(registerMonth);

    const header = ["Employee", "Role", ...monthDays.map((d) => String(d)), "Present %"];
    const rows = employees.map((emp) => {
      const cells = monthDays.map((day) => {
        const ds = fmtDate(new Date(y, m, day));
        const rec = attendance[`${emp.id}__${ds}`];
        return rec ? STATUS[rec.status].short : "";
      });
      const pct = monthStats[emp.id];
      return [emp.name, emp.role, ...cells, pct == null ? "" : `${pct}%`];
    });

    const wsData = [
      [`Monthly Attendance Register — ${monthName}`],
      [],
      header,
      ...rows,
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [{ wch: 22 }, { wch: 16 }, ...monthDays.map(() => ({ wch: 4 })), { wch: 10 }];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }];

    const legendData = [
      ["Code", "Meaning"],
      ...Object.values(STATUS).map((s) => [s.short, s.label]),
    ];
    const wsLegend = XLSX.utils.aoa_to_sheet(legendData);
    wsLegend["!cols"] = [{ wch: 8 }, { wch: 16 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Register");
    XLSX.utils.book_append_sheet(wb, wsLegend, "Legend");

    const fname = `Attendance_Register_${monthName.replace(" ", "_")}.xlsx`;
    XLSX.writeFile(wb, fname);
    setExportNote(`Downloaded ${fname}`);
    setTimeout(() => setExportNote(""), 4000);
  };

  const exportClientWiseReport = () => {
    const y = registerMonth.getFullYear();
    const m = registerMonth.getMonth();
    const monthName = monthLabel(registerMonth);

    const byClient = {};
    employees.forEach((emp) => {
      monthDays.forEach((day) => {
        const ds = fmtDate(new Date(y, m, day));
        const rec = attendance[`${emp.id}__${ds}`];
        if (rec && rec.status === "present" && isClientSite(rec.site)) {
          const client = rec.site.trim();
          if (!byClient[client]) byClient[client] = [];
          byClient[client].push({ date: ds, employee: emp.name, role: emp.role });
        }
      });
    });

    const clientNames = Object.keys(byClient).sort((a, b) => a.localeCompare(b));

    if (clientNames.length === 0) {
      setExportNote("No client-site attendance found for this month.");
      setTimeout(() => setExportNote(""), 4000);
      return;
    }

    const wb = XLSX.utils.book_new();
    const usedNames = new Set();

    const summaryRows = clientNames.map((c) => {
      const entries = byClient[c];
      const uniqueEmps = new Set(entries.map((e) => e.employee));
      return [c, entries.length, uniqueEmps.size];
    });
    const wsSummary = XLSX.utils.aoa_to_sheet([
      [`Client-wise Attendance Summary — ${monthName}`],
      [],
      ["Client", "Total Attendance-Days", "Employees Involved"],
      ...summaryRows,
    ]);
    wsSummary["!cols"] = [{ wch: 26 }, { wch: 20 }, { wch: 18 }];
    wsSummary["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
    XLSX.utils.book_append_sheet(wb, wsSummary, safeSheetName("Summary", usedNames));

    clientNames.forEach((client) => {
      const entries = byClient[client].sort((a, b) => a.date.localeCompare(b.date) || a.employee.localeCompare(b.employee));
      const wsData = [
        [client],
        [],
        ["Date", "Employee", "Role"],
        ...entries.map((e) => [e.date, e.employee, e.role]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws["!cols"] = [{ wch: 14 }, { wch: 22 }, { wch: 16 }];
      ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName(client, usedNames));
    });

    const fname = `Client_Wise_Report_${monthName.replace(" ", "_")}.xlsx`;
    XLSX.writeFile(wb, fname);
    setExportNote(`Downloaded ${fname} (${clientNames.length} client${clientNames.length === 1 ? "" : "s"})`);
    setTimeout(() => setExportNote(""), 4000);
  };

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <Loader2 size={24} style={{ animation: "spin 1s linear infinite", marginBottom: 10, color: "#0f172a" }} />
        <span style={{ fontSize: 14, color: "#64748b" }}>Loading register...</span>
      </div>
    );
  }

  return (
    <div className="app-wrapper">
      <div className="app-card">
        
        {/* Header */}
        <div className="app-header">
          <div className="header-top">
            <div className="header-title-group">
              <h1>Attendance Register</h1>
              <p>{employees.length} {employees.length === 1 ? "employee" : "employees"}</p>
            </div>

            <div className="sync-badge">
              <span className={`status-dot ${dbConnected ? "" : "offline"}`} />
              <span>{dbConnected ? "Connected" : "Offline"}</span>
              {isSyncing ? (
                <RefreshCw size={11} style={{ animation: "spin 1s linear infinite", marginLeft: 4 }} />
              ) : (
                <button 
                  onClick={() => fetchData(false)} 
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginLeft: 4, display: "flex", color: "#64748b" }}
                >
                  <RefreshCw size={11} />
                </button>
              )}
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="nav-tabs">
            <button className={`nav-tab ${tab === "today" ? "active" : ""}`} onClick={() => setTab("today")}>
              <CalendarDays size={15} /> Mark Attendance
            </button>
            <button className={`nav-tab ${tab === "register" ? "active" : ""}`} onClick={() => setTab("register")}>
              <BookOpen size={15} /> Monthly Register
            </button>
            <button className={`nav-tab ${tab === "employees" ? "active" : ""}`} onClick={() => setTab("employees")}>
              <Users size={15} /> Employees
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="app-body">
          {saveError && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", padding: "10px 14px", borderRadius: 6, marginBottom: 16, fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AlertCircle size={15} />
                <span>{saveErrorMessage}</span>
              </div>
              <button onClick={() => setSaveError(false)} style={{ background: "none", border: "none", cursor: "pointer", fontWeight: "bold", color: "#991b1b" }}>✕</button>
            </div>
          )}

          {/* Tab 1: Mark Attendance */}
          {tab === "today" && (
            <div>
              <div className="date-nav">
                <div className="date-controls">
                  <button className="btn-icon" onClick={() => setSelectedDate(new Date(selectedDate.getTime() - 86400000))}>
                    <ChevronLeft size={16} />
                  </button>
                  <span className="date-heading">
                    {selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                  </span>
                  <button className="btn-icon" onClick={() => setSelectedDate(new Date(selectedDate.getTime() + 86400000))}>
                    <ChevronRight size={16} />
                  </button>
                </div>

                <button className="btn-secondary" onClick={() => setSelectedDate(new Date())}>
                  Today
                </button>
              </div>

              {employees.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#64748b", fontSize: 14 }}>
                  No employees found. Add employees in the Employees tab.
                </div>
              ) : (
                employees.map((emp) => {
                  const key = `${emp.id}__${selectedDateStr}`;
                  const rec = attendance[key];
                  const currentStatus = rec?.status;

                  return (
                    <div className="emp-card" key={emp.id}>
                      <div className="emp-info">
                        <div className="emp-info-name">{emp.name}</div>
                        <div className="emp-info-role">{emp.role}</div>
                      </div>

                      <div className="emp-actions">
                        {currentStatus === "present" && (
                          <input
                            className="site-input-field"
                            placeholder="Office / Client site"
                            value={siteDrafts[key] ?? rec?.site ?? ""}
                            onChange={(e) => setSiteDrafts({ ...siteDrafts, [key]: e.target.value })}
                            onBlur={(e) => setStatus(emp.id, selectedDateStr, "present", e.target.value)}
                          />
                        )}

                        <div className="status-button-group">
                          {["present", "absent", "leave", "half"].map((s) => {
                            const meta = STATUS[s];
                            const isActive = currentStatus === s;
                            return (
                              <button
                                key={s}
                                className={`status-btn-item ${isActive ? `active-${meta.short}` : ""}`}
                                title={meta.label}
                                onClick={() => setStatus(emp.id, selectedDateStr, isActive ? null : s)}
                              >
                                {meta.short}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Tab 2: Monthly Register */}
          {tab === "register" && (
            <div>
              <div className="date-nav">
                <div className="date-controls">
                  <button className="btn-icon" onClick={() => setRegisterMonth(new Date(registerMonth.getFullYear(), registerMonth.getMonth() - 1, 1))}>
                    <ChevronLeft size={16} />
                  </button>
                  <span className="date-heading">{monthLabel(registerMonth)}</span>
                  <button className="btn-icon" onClick={() => setRegisterMonth(new Date(registerMonth.getFullYear(), registerMonth.getMonth() + 1, 1))}>
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>

              <div className="export-actions">
                <button className="btn-secondary" onClick={exportMonthlyRegister} disabled={employees.length === 0}>
                  <Download size={14} /> Export Register (Excel)
                </button>
                <button className="btn-secondary" onClick={exportClientWiseReport} disabled={employees.length === 0}>
                  <Building2 size={14} /> Export Client Report (Excel)
                </button>
                {exportNote && <span style={{ fontSize: 12, color: "#166534", alignSelf: "center" }}>{exportNote}</span>}
              </div>

              <div className="legend-bar">
                {Object.values(STATUS).map((s) => (
                  <div className="legend-tag" key={s.key}>
                    <span className="legend-box" style={{ background: s.color }} />
                    <span>{s.label} ({s.short})</span>
                  </div>
                ))}
              </div>

              {employees.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#64748b", fontSize: 14 }}>
                  No employees found.
                </div>
              ) : (
                <div className="table-scroll-container">
                  <table className="register-table">
                    <thead>
                      <tr>
                        <th className="emp-head">Employee</th>
                        {monthDays.map((d) => <th key={d}>{d}</th>)}
                        <th>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((emp) => (
                        <tr key={emp.id}>
                          <td className="emp-cell">
                            <div style={{ fontWeight: 600, color: "#0f172a" }}>{emp.name}</div>
                          </td>
                          {monthDays.map((day) => {
                            const ds = fmtDate(new Date(registerMonth.getFullYear(), registerMonth.getMonth(), day));
                            const rec = attendance[`${emp.id}__${ds}`];
                            const meta = rec ? STATUS[rec.status] : null;

                            return (
                              <td key={day}>
                                <div
                                  className={`table-cell-badge ${meta ? `cell-${meta.short}` : "cell-empty"}`}
                                  title={meta ? `${meta.label}${rec.site ? " — " + rec.site : ""}` : "Not marked"}
                                  onClick={() => cycleStatus(emp.id, ds)}
                                >
                                  {meta ? meta.short : ""}
                                </div>
                              </td>
                            );
                          })}
                          <td>
                            <span style={{ fontWeight: 600, color: monthStats[emp.id] == null ? "#94a3b8" : "#0f172a" }}>
                              {monthStats[emp.id] == null ? "—" : `${monthStats[emp.id]}%`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Employees */}
          {tab === "employees" && (
            <div>
              <div className="add-form">
                <input
                  className="text-input"
                  placeholder="Employee name"
                  value={newEmpName}
                  onChange={(e) => setNewEmpName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addEmployee()}
                />
                <input
                  className="text-input"
                  placeholder="Role (e.g. Associate)"
                  value={newEmpRole}
                  onChange={(e) => setNewEmpRole(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addEmployee()}
                />
                <button className="btn-primary" onClick={addEmployee}>
                  <Plus size={15} /> Add Employee
                </button>
              </div>

              {employees.length === 0 ? (
                <div style={{ textAlign: "center", padding: "30px 0", color: "#64748b", fontSize: 14 }}>
                  No employees yet. Add your first employee above.
                </div>
              ) : (
                employees.map((emp) => (
                  <div className="emp-card" key={emp.id}>
                    <div>
                      <div className="emp-info-name">{emp.name}</div>
                      <div className="emp-info-role">{emp.role}</div>
                    </div>
                    <button className="btn-danger" onClick={() => removeEmployee(emp.id)}>
                      <Trash2 size={14} /> Remove
                    </button>
                  </div>
                ))
              )}

              <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid #e2e8f0" }}>
                {!confirmClear ? (
                  <button className="btn-danger" onClick={() => setConfirmClear(true)}>
                    <Trash2 size={14} /> Clear all data
                  </button>
                ) : (
                  <div style={{ fontSize: 13, color: "#991b1b" }}>
                    This permanently deletes all employees and attendance logs from Supabase.
                    <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
                      <button className="btn-danger" onClick={clearAllData}>Confirm Clear</button>
                      <button className="btn-secondary" onClick={() => setConfirmClear(false)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}