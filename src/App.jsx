import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Check, X, Clock, Minus, Plus, Trash2, ChevronLeft, ChevronRight, Users, CalendarDays, BookOpen, Loader2, Download, Building2 } from "lucide-react";
import * as XLSX from "xlsx";

const STATUS = {
  present: { key: "present", label: "Present", short: "P", color: "#2F6F5E" },
  absent: { key: "absent", label: "Absent", short: "A", color: "#A13D3D" },
  leave: { key: "leave", label: "Leave", short: "L", color: "#C08A2E" },
  half: { key: "half", label: "Half Day", short: "H", color: "#6B6456" },
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

// Sites that represent the office/HQ rather than a client premises.
// Anything else typed into the "site" field is treated as a client name.
const OFFICE_ALIASES = new Set(["office", "hq", "head office", "main office", ""]);

function isClientSite(site) {
  if (!site) return false;
  return !OFFICE_ALIASES.has(site.trim().toLowerCase());
}

// Excel sheet names: max 31 chars, no \ / ? * [ ]
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
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState({}); // key: empId__YYYY-MM-DD -> {status, site}
  const [tab, setTab] = useState("today");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [registerMonth, setRegisterMonth] = useState(new Date());
  const [newEmpName, setNewEmpName] = useState("");
  const [newEmpRole, setNewEmpRole] = useState("");
  const [siteDrafts, setSiteDrafts] = useState({});
  const [confirmClear, setConfirmClear] = useState(false);
  const [exportNote, setExportNote] = useState("");

  useEffect(() => {
    try {
      const empRaw = localStorage.getItem("adm-employees");
      const attRaw = localStorage.getItem("adm-attendance");
      if (empRaw) setEmployees(JSON.parse(empRaw));
      if (attRaw) setAttendance(JSON.parse(attRaw));
    } catch (e) {
      console.error("Load error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const persistEmployees = useCallback((list) => {
    try {
      localStorage.setItem("adm-employees", JSON.stringify(list));
    } catch (e) {
      console.error("Save error:", e);
      setSaveError(true);
    }
  }, []);

  const persistAttendance = useCallback((map) => {
    try {
      localStorage.setItem("adm-attendance", JSON.stringify(map));
    } catch (e) {
      console.error("Save error:", e);
      setSaveError(true);
    }
  }, []);

  const addEmployee = () => {
    const name = newEmpName.trim();
    if (!name) return;
    const next = [...employees, { id: uid(), name, role: newEmpRole.trim() || "Staff" }];
    setEmployees(next);
    persistEmployees(next);
    setNewEmpName("");
    setNewEmpRole("");
  };

  const removeEmployee = (id) => {
    const next = employees.filter((e) => e.id !== id);
    setEmployees(next);
    persistEmployees(next);
  };

  const setStatus = (empId, dateStr, status, site) => {
    const key = `${empId}__${dateStr}`;
    const next = { ...attendance };
    if (status === null) {
      delete next[key];
    } else {
      next[key] = { status, site: site || next[key]?.site || "" };
    }
    setAttendance(next);
    persistAttendance(next);
  };

  const cycleStatus = (empId, dateStr) => {
    const key = `${empId}__${dateStr}`;
    const current = attendance[key]?.status ?? null;
    const idx = STATUS_CYCLE.indexOf(current);
    const nextStatus = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    setStatus(empId, dateStr, nextStatus);
  };

  const clearAllData = () => {
    setEmployees([]);
    setAttendance({});
    persistEmployees([]);
    persistAttendance({});
    setConfirmClear(false);
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

  // ---------- Excel export: full monthly register ----------
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

    // Legend sheet
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

  // ---------- Excel export: client-wise report ----------
  const exportClientWiseReport = () => {
    const y = registerMonth.getFullYear();
    const m = registerMonth.getMonth();
    const monthName = monthLabel(registerMonth);

    // Build { clientName: [ {date, employee, role} ] }
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

    // Summary sheet: client vs total attendance-days + unique employees
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

    // One sheet per client
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 320, color: "#6B6456", fontFamily: "Inter, sans-serif" }}>
        <Loader2 size={18} style={{ marginRight: 8, animation: "spin 1s linear infinite" }} />
        Opening the register…
      </div>
    );
  }

  return (
    <div className="adm-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@500;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .adm-root { font-family: 'Inter', sans-serif; color: #26231F; background: #FAF7EF; border-radius: 10px; overflow: hidden; border: 1px solid #E4DCC4; max-width: 900px; margin: 0 auto; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .adm-header { background: #1B3A32; color: #F3EFDF; padding: 20px 24px 0 24px; }
        .adm-title-row { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
        .adm-title { font-family: 'Roboto Slab', serif; font-weight: 700; font-size: 20px; letter-spacing: 0.2px; }
        .adm-subtitle { font-size: 12px; color: #B7C9C1; margin-top: 2px; font-family: 'IBM Plex Mono', monospace; }
        .adm-tabs { display: flex; gap: 4px; }
        .adm-tab { display: flex; align-items: center; gap: 6px; padding: 9px 16px; font-size: 13px; font-weight: 500; color: #C7D6CF; background: transparent; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-family: 'Inter', sans-serif; }
        .adm-tab.active { color: #F3EFDF; border-bottom: 2px solid #A9823B; }
        .adm-tab:hover:not(.active) { color: #F3EFDF; }
        .adm-body { padding: 22px 24px 26px 24px; }
        .adm-row-line { border-bottom: 1px solid #E4DCC4; }
        .adm-mono { font-family: 'IBM Plex Mono', monospace; }
        .adm-date-nav { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; }
        .adm-date-btn { background: #F0EBD8; border: 1px solid #E4DCC4; border-radius: 6px; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #1B3A32; }
        .adm-date-btn:hover { background: #E4DCC4; }
        .adm-date-label { font-family: 'Roboto Slab', serif; font-weight: 700; font-size: 16px; color: #1B3A32; min-width: 210px; }
        .emp-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; gap: 12px; }
        .emp-name { font-weight: 600; font-size: 14px; }
        .emp-role { font-size: 11px; color: #8A8371; font-family: 'IBM Plex Mono', monospace; margin-top: 1px; }
        .status-btns { display: flex; gap: 6px; align-items: center; }
        .status-btn { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 6px; border: 1.5px solid #E4DCC4; background: #fff; cursor: pointer; transition: transform 0.08s ease; }
        .status-btn:hover { transform: translateY(-1px); }
        .site-input { font-size: 12px; padding: 6px 8px; border: 1px solid #E4DCC4; border-radius: 5px; font-family: 'Inter', sans-serif; width: 150px; background: #FCFAF3; }
        .empty-state { text-align: center; padding: 40px 20px; color: #8A8371; font-size: 13px; }
        .add-emp-form { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
        .adm-input { padding: 9px 12px; border: 1px solid #E4DCC4; border-radius: 6px; font-size: 13px; font-family: 'Inter', sans-serif; background: #fff; flex: 1; min-width: 140px; }
        .adm-btn-primary { display: flex; align-items: center; gap: 6px; background: #1B3A32; color: #F3EFDF; border: none; padding: 9px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; }
        .adm-btn-primary:hover { background: #244C42; }
        .adm-btn-danger { display: flex; align-items: center; gap: 6px; background: transparent; color: #A13D3D; border: 1px solid #E9C6C6; padding: 8px 14px; border-radius: 6px; font-size: 12px; cursor: pointer; }
        .adm-btn-danger:hover { background: #FBF0F0; }
        .adm-btn-export { display: flex; align-items: center; gap: 6px; background: #F0EBD8; color: #1B3A32; border: 1px solid #D8D0BC; padding: 8px 14px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; }
        .adm-btn-export:hover { background: #E4DCC4; }
        .emp-list-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; }
        table.reg-table { border-collapse: collapse; width: 100%; font-size: 11px; }
        table.reg-table th, table.reg-table td { padding: 4px; text-align: center; }
        table.reg-table th { font-family: 'IBM Plex Mono', monospace; font-weight: 500; color: #8A8371; font-size: 10px; border-bottom: 1.5px solid #D8D0BC; }
        table.reg-table td.emp-col, table.reg-table th.emp-col { text-align: left; position: sticky; left: 0; background: #FAF7EF; padding-right: 10px; min-width: 110px; }
        .reg-cell { width: 22px; height: 22px; border-radius: 4px; margin: 0 auto; display: flex; align-items: center; justify-content: center; font-family: 'IBM Plex Mono', monospace; font-weight: 600; font-size: 10px; cursor: pointer; border: 1px solid #EDE7D6; color: #fff; }
        .reg-cell.empty { background: #FCFAF3; color: #C9C1A9; border: 1px dashed #E4DCC4; }
        .legend { display: flex; gap: 14px; margin-bottom: 14px; flex-wrap: wrap; }
        .legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #6B6456; }
        .legend-swatch { width: 12px; height: 12px; border-radius: 3px; }
        .stat-pct { font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 600; }
        .export-bar { display: flex; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; align-items: center; }
        .export-note { font-size: 11px; color: #2F6F5E; font-family: 'IBM Plex Mono', monospace; }
      `}</style>

      <div className="adm-header">
        <div className="adm-title-row">
          <BookOpen size={20} color="#A9823B" />
          <div>
            <div className="adm-title">Attendance Register</div>
            <div className="adm-subtitle">{employees.length} {employees.length === 1 ? "employee" : "employees"} on file</div>
          </div>
        </div>
        <div className="adm-tabs">
          <button className={`adm-tab ${tab === "today" ? "active" : ""}`} onClick={() => setTab("today")}>
            <CalendarDays size={14} /> Mark Attendance
          </button>
          <button className={`adm-tab ${tab === "register" ? "active" : ""}`} onClick={() => setTab("register")}>
            <BookOpen size={14} /> Monthly Register
          </button>
          <button className={`adm-tab ${tab === "employees" ? "active" : ""}`} onClick={() => setTab("employees")}>
            <Users size={14} /> Employees
          </button>
        </div>
      </div>

      <div className="adm-body">
        {saveError && (
          <div style={{ background: "#FBF0F0", border: "1px solid #E9C6C6", color: "#A13D3D", fontSize: 12, padding: "8px 12px", borderRadius: 6, marginBottom: 14 }}>
            Couldn't save the last change. Your data may not persist — try again.
          </div>
        )}

        {tab === "today" && (
          <div>
            <div className="adm-date-nav">
              <button className="adm-date-btn" onClick={() => setSelectedDate(new Date(selectedDate.getTime() - 86400000))}>
                <ChevronLeft size={15} />
              </button>
              <div className="adm-date-label">
                {selectedDate.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </div>
              <button className="adm-date-btn" onClick={() => setSelectedDate(new Date(selectedDate.getTime() + 86400000))}>
                <ChevronRight size={15} />
              </button>
              <button className="adm-btn-danger" style={{ marginLeft: "auto", color: "#1B3A32", borderColor: "#D8D0BC" }} onClick={() => setSelectedDate(new Date())}>
                Today
              </button>
            </div>

            {employees.length === 0 ? (
              <div className="empty-state">No employees yet. Add your team in the Employees tab first.</div>
            ) : (
              employees.map((emp) => {
                const key = `${emp.id}__${selectedDateStr}`;
                const rec = attendance[key];
                const currentStatus = rec?.status;
                return (
                  <div className="emp-row adm-row-line" key={emp.id}>
                    <div>
                      <div className="emp-name">{emp.name}</div>
                      <div className="emp-role">{emp.role}</div>
                    </div>
                    <div className="status-btns">
                      {currentStatus === "present" && (
                        <input
                          className="site-input"
                          placeholder="Office / client name"
                          value={siteDrafts[key] ?? rec?.site ?? ""}
                          onChange={(e) => setSiteDrafts({ ...siteDrafts, [key]: e.target.value })}
                          onBlur={(e) => setStatus(emp.id, selectedDateStr, "present", e.target.value)}
                        />
                      )}
                      {["present", "absent", "leave", "half"].map((s) => {
                        const meta = STATUS[s];
                        const isActive = currentStatus === s;
                        const Icon = s === "present" ? Check : s === "absent" ? X : s === "leave" ? Minus : Clock;
                        return (
                          <button
                            key={s}
                            className="status-btn"
                            title={meta.label}
                            style={isActive ? { background: meta.color, borderColor: meta.color, color: "#fff" } : { color: meta.color }}
                            onClick={() => setStatus(emp.id, selectedDateStr, isActive ? null : s)}
                          >
                            <Icon size={15} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === "register" && (
          <div>
            <div className="adm-date-nav">
              <button className="adm-date-btn" onClick={() => setRegisterMonth(new Date(registerMonth.getFullYear(), registerMonth.getMonth() - 1, 1))}>
                <ChevronLeft size={15} />
              </button>
              <div className="adm-date-label">{monthLabel(registerMonth)}</div>
              <button className="adm-date-btn" onClick={() => setRegisterMonth(new Date(registerMonth.getFullYear(), registerMonth.getMonth() + 1, 1))}>
                <ChevronRight size={15} />
              </button>
            </div>

            <div className="export-bar">
              <button className="adm-btn-export" onClick={exportMonthlyRegister} disabled={employees.length === 0}>
                <Download size={13} /> Export monthly register (Excel)
              </button>
              <button className="adm-btn-export" onClick={exportClientWiseReport} disabled={employees.length === 0}>
                <Building2 size={13} /> Export client-wise report (Excel)
              </button>
              {exportNote && <span className="export-note">{exportNote}</span>}
            </div>

            <div className="legend">
              {Object.values(STATUS).map((s) => (
                <div className="legend-item" key={s.key}>
                  <span className="legend-swatch" style={{ background: s.color }} />
                  {s.label} ({s.short})
                </div>
              ))}
              <div className="legend-item">Click a cell to cycle status. Attendance % counts half-days as 0.5.</div>
            </div>

            {employees.length === 0 ? (
              <div className="empty-state">No employees yet. Add your team in the Employees tab first.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="reg-table">
                  <thead>
                    <tr>
                      <th className="emp-col">Employee</th>
                      {monthDays.map((d) => <th key={d}>{d}</th>)}
                      <th>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => (
                      <tr key={emp.id}>
                        <td className="emp-col">
                          <div className="emp-name" style={{ fontSize: 12 }}>{emp.name}</div>
                        </td>
                        {monthDays.map((day) => {
                          const ds = fmtDate(new Date(registerMonth.getFullYear(), registerMonth.getMonth(), day));
                          const rec = attendance[`${emp.id}__${ds}`];
                          const meta = rec ? STATUS[rec.status] : null;
                          return (
                            <td key={day}>
                              <div
                                className={`reg-cell ${meta ? "" : "empty"}`}
                                style={meta ? { background: meta.color } : {}}
                                title={meta ? `${meta.label}${rec.site ? " — " + rec.site : ""}` : "Not marked"}
                                onClick={() => cycleStatus(emp.id, ds)}
                              >
                                {meta ? meta.short : ""}
                              </div>
                            </td>
                          );
                        })}
                        <td>
                          <span className="stat-pct" style={{ color: monthStats[emp.id] == null ? "#C9C1A9" : "#1B3A32" }}>
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

        {tab === "employees" && (
          <div>
            <div className="add-emp-form">
              <input
                className="adm-input"
                placeholder="Employee name"
                value={newEmpName}
                onChange={(e) => setNewEmpName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addEmployee()}
              />
              <input
                className="adm-input"
                placeholder="Role (e.g. Audit Associate)"
                value={newEmpRole}
                onChange={(e) => setNewEmpRole(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addEmployee()}
              />
              <button className="adm-btn-primary" onClick={addEmployee}>
                <Plus size={14} /> Add
              </button>
            </div>

            {employees.length === 0 ? (
              <div className="empty-state">No employees yet — add your first one above.</div>
            ) : (
              employees.map((emp) => (
                <div className="emp-list-row adm-row-line" key={emp.id}>
                  <div>
                    <div className="emp-name">{emp.name}</div>
                    <div className="emp-role">{emp.role}</div>
                  </div>
                  <button className="adm-btn-danger" onClick={() => removeEmployee(emp.id)}>
                    <Trash2 size={13} /> Remove
                  </button>
                </div>
              ))
            )}

            <div style={{ marginTop: 30, paddingTop: 18, borderTop: "1px dashed #E4DCC4" }}>
              {!confirmClear ? (
                <button className="adm-btn-danger" onClick={() => setConfirmClear(true)}>
                  <Trash2 size={13} /> Clear all data
                </button>
              ) : (
                <div style={{ fontSize: 12, color: "#A13D3D" }}>
                  This removes every employee and attendance record. This can't be undone.
                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    <button className="adm-btn-danger" onClick={clearAllData}>Yes, clear everything</button>
                    <button className="adm-date-btn" style={{ width: "auto", padding: "0 14px" }} onClick={() => setConfirmClear(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}  
      </div>
    </div>
  );
}