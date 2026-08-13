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
  AlertCircle 
} from "lucide-react";
import * as XLSX from "xlsx";
import "./App.css";

const STATUS = {
  present: { key: "present", label: "Present", short: "P", color: "#0f766e" },
  absent: { key: "absent", label: "Absent", short: "A", color: "#334155" },
  leave: { key: "leave", label: "Leave", short: "L", color: "#b45309" },
  half: { key: "half", label: "Half Day", short: "H", color: "#64748b" },
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

    try {
      const res = await fetch("/api/all-data");
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();
      
      if (data.success) {
        setEmployees(data.employees || []);
        setAttendance(data.attendance || {});
        
        try {
          localStorage.setItem("adm-employees", JSON.stringify(data.employees || []));
          localStorage.setItem("adm-attendance", JSON.stringify(data.attendance || {}));
        } catch (e) {}
      } else {
        throw new Error(data.error || "Failed to fetch");
      }
    } catch (err) {
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
      setSaveErrorMessage("Failed to save employee.");
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
        <Loader2 size={28} style={{ animation: "spin 1s linear infinite", marginBottom: 12, color: "#0f172a" }} />
        <span style={{ fontSize: 14, color: "#64748b", fontWeight: 600 }}>Opening Attendance Register...</span>
      </div>
    );
  }

  return (
    <div className="app-container">
      
      {/* Sticky Full-Width Header */}
      <header className="top-header">
        <div className="header-inner">
          <div className="header-brand">
            <h1>Attendance Register</h1>
            <span className="emp-counter-badge">
              {employees.length} {employees.length === 1 ? "Employee" : "Employees"}
            </span>
          </div>

          {/* Segmented Navigation Bar */}
          <nav className="segmented-nav">
            <button className={`nav-pill ${tab === "today" ? "active" : ""}`} onClick={() => setTab("today")}>
              <CalendarDays size={16} /> Mark Attendance
            </button>
            <button className={`nav-pill ${tab === "register" ? "active" : ""}`} onClick={() => setTab("register")}>
              <BookOpen size={16} /> Monthly Register
            </button>
            <button className={`nav-pill ${tab === "employees" ? "active" : ""}`} onClick={() => setTab("employees")}>
              <Users size={16} /> Employees
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-content" key={tab}>
        {saveError && (
          <div style={{ background: "#ffffff", border: "1px solid #cbd5e1", color: "#334155", padding: "12px 16px", borderRadius: 12, marginBottom: 20, fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <AlertCircle size={16} />
              <span>{saveErrorMessage}</span>
            </div>
            <button onClick={() => setSaveError(false)} style={{ background: "none", border: "none", cursor: "pointer", fontWeight: "bold", color: "#334155" }}>✕</button>
          </div>
        )}

        {/* Tab 1: Mark Attendance */}
        {tab === "today" && (
          <div>
            <div className="date-bar">
              <div className="date-selector">
                <button className="icon-btn" onClick={() => setSelectedDate(new Date(selectedDate.getTime() - 86400000))}>
                  <ChevronLeft size={18} />
                </button>
                <span className="date-text">
                  {selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                </span>
                <button className="icon-btn" onClick={() => setSelectedDate(new Date(selectedDate.getTime() + 86400000))}>
                  <ChevronRight size={18} />
                </button>
              </div>

              <button className="today-btn" onClick={() => setSelectedDate(new Date())}>
                Today
              </button>
            </div>

            {/* Quick Add Employee Card if no employees */}
            {employees.length === 0 ? (
              <div className="add-emp-card" style={{ textAlign: "center", padding: "36px 20px" }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "#0f172a" }}>No Employees Added Yet</div>
                <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>Add your first team member to start taking attendance</div>

                <div className="add-emp-grid" style={{ maxWidth: 600, margin: "0 auto" }}>
                  <input
                    className="input-box"
                    placeholder="Employee name (e.g. Hassan)"
                    value={newEmpName}
                    onChange={(e) => setNewEmpName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addEmployee()}
                  />
                  <input
                    className="input-box"
                    placeholder="Role (e.g. Staff)"
                    value={newEmpRole}
                    onChange={(e) => setNewEmpRole(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addEmployee()}
                  />
                  <button className="primary-add-btn" onClick={addEmployee}>
                    <Plus size={18} /> Add Employee
                  </button>
                </div>
              </div>
            ) : (
              employees.map((emp) => {
                const key = `${emp.id}__${selectedDateStr}`;
                const rec = attendance[key];
                const currentStatus = rec?.status;
                const initial = emp.name ? emp.name.charAt(0).toUpperCase() : "?";

                return (
                  <div className="emp-item-card" key={emp.id}>
                    <div className="emp-avatar-group">
                      <div className="emp-avatar">{initial}</div>
                      <div>
                        <div className="emp-name-text">{emp.name}</div>
                        <div className="emp-role-text">{emp.role}</div>
                      </div>
                    </div>

                    <div className="emp-item-right">
                      {currentStatus === "present" && (
                        <input
                          className="site-field"
                          placeholder="Office / Client site"
                          value={siteDrafts[key] ?? rec?.site ?? ""}
                          onChange={(e) => setSiteDrafts({ ...siteDrafts, [key]: e.target.value })}
                          onBlur={(e) => setStatus(emp.id, selectedDateStr, "present", e.target.value)}
                        />
                      )}

                      <div className="status-pill-group">
                        {["present", "absent", "leave", "half"].map((s) => {
                          const meta = STATUS[s];
                          const isActive = currentStatus === s;
                          return (
                            <button
                              key={s}
                              className={`status-pill ${isActive ? `active-${meta.short}` : ""}`}
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
            <div className="date-bar">
              <div className="date-selector">
                <button className="icon-btn" onClick={() => setRegisterMonth(new Date(registerMonth.getFullYear(), registerMonth.getMonth() - 1, 1))}>
                  <ChevronLeft size={18} />
                </button>
                <span className="date-text">{monthLabel(registerMonth)}</span>
                <button className="icon-btn" onClick={() => setRegisterMonth(new Date(registerMonth.getFullYear(), registerMonth.getMonth() + 1, 1))}>
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            <div className="export-row">
              <button className="export-btn" onClick={exportMonthlyRegister} disabled={employees.length === 0}>
                <Download size={16} /> Export Monthly Register (Excel)
              </button>
              <button className="export-btn" onClick={exportClientWiseReport} disabled={employees.length === 0}>
                <Building2 size={16} /> Export Client Report (Excel)
              </button>
              {exportNote && <span style={{ fontSize: 13, color: "#0f766e", fontWeight: 700, alignSelf: "center" }}>{exportNote}</span>}
            </div>

            <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap", fontSize: 13, color: "#64748b" }}>
              {Object.values(STATUS).map((s) => (
                <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 4, background: s.color }} />
                  <span>{s.label} ({s.short})</span>
                </div>
              ))}
            </div>

            {employees.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 0", color: "#64748b", fontSize: 14 }}>
                No employees registered.
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="reg-grid">
                  <thead>
                    <tr>
                      <th className="sticky-name">Employee</th>
                      {monthDays.map((d) => <th key={d}>{d}</th>)}
                      <th>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => (
                      <tr key={emp.id}>
                        <td className="sticky-name">
                          <div style={{ fontWeight: 700, color: "#0f172a" }}>{emp.name}</div>
                        </td>
                        {monthDays.map((day) => {
                          const ds = fmtDate(new Date(registerMonth.getFullYear(), registerMonth.getMonth(), day));
                          const rec = attendance[`${emp.id}__${ds}`];
                          const meta = rec ? STATUS[rec.status] : null;

                          return (
                            <td key={day}>
                              <div
                                className={`grid-cell-badge ${meta ? `cell-${meta.short}` : "cell-empty"}`}
                                title={meta ? `${meta.label}${rec.site ? " — " + rec.site : ""}` : "Not marked"}
                                onClick={() => cycleStatus(emp.id, ds)}
                              >
                                {meta ? meta.short : ""}
                              </div>
                            </td>
                          );
                        })}
                        <td>
                          <span style={{ fontWeight: 700, color: monthStats[emp.id] == null ? "#94a3b8" : "#0f172a" }}>
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
            {/* Dedicated Prominent Add Employee Card */}
            <div className="add-emp-card">
              <div className="add-emp-title">+ Add New Employee</div>
              <div className="add-emp-grid">
                <input
                  className="input-box"
                  placeholder="Employee name (e.g. Hassan)"
                  value={newEmpName}
                  onChange={(e) => setNewEmpName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addEmployee()}
                />
                <input
                  className="input-box"
                  placeholder="Role (e.g. Audit Associate)"
                  value={newEmpRole}
                  onChange={(e) => setNewEmpRole(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addEmployee()}
                />
                <button className="primary-add-btn" onClick={addEmployee}>
                  <Plus size={18} /> Add Employee
                </button>
              </div>
            </div>

            {/* Employees List */}
            {employees.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#64748b", fontSize: 14 }}>
                No employees added yet. Use the form above to add your first employee.
              </div>
            ) : (
              employees.map((emp) => {
                const initial = emp.name ? emp.name.charAt(0).toUpperCase() : "?";
                return (
                  <div className="emp-item-card" key={emp.id}>
                    <div className="emp-avatar-group">
                      <div className="emp-avatar">{initial}</div>
                      <div>
                        <div className="emp-name-text">{emp.name}</div>
                        <div className="emp-role-text">{emp.role}</div>
                      </div>
                    </div>

                    <button className="remove-btn" onClick={() => removeEmployee(emp.id)}>
                      <Trash2 size={14} /> Remove
                    </button>
                  </div>
                );
              })
            )}

            <div style={{ marginTop: 40, paddingTop: 20, borderTop: "1px solid #e2e8f0" }}>
              {!confirmClear ? (
                <button className="remove-btn" onClick={() => setConfirmClear(true)}>
                  <Trash2 size={14} /> Clear all data
                </button>
              ) : (
                <div style={{ fontSize: 13, color: "#334155" }}>
                  This permanently removes all employees and attendance logs.
                  <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                    <button className="remove-btn" style={{ background: "#334155", color: "#fff", borderColor: "#334155" }} onClick={clearAllData}>Confirm Clear</button>
                    <button className="today-btn" onClick={() => setConfirmClear(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}