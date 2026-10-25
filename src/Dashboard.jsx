
import React, { useCallback, useEffect, useState } from "react";
import "./App.css";

const API = "http://localhost:5000/api";

const MENU = [
  { section: "WORKSPACE", items: ["Dashboard", "Employees", "Attendance", "Leave Management", "Payroll"] },
  { section: "ORGANIZATION", items: ["Departments", "Designations", "Announcements", "Reports"] },
  { section: "SYSTEM", items: ["AI Assistant", "Audit Log", "Settings"] },
];

const EMPTY_EMPLOYEE = {
  name: "",
  email: "",
  password: "",
  employeeCode: "",
  departmentId: "",
  designationId: "",
  phone: "",
  address: "",
  joinDate: new Date().toISOString().slice(0, 10),
  basicSalary: "",
};

const DESCRIPTIONS = {
  Dashboard: "Your organization's workforce at a glance.",
  Employees: "Manage employee records and profiles.",
  Attendance: "Track daily check-in, check-out and attendance.",
  "Leave Management": "Review requests, balances and leave history.",
  Payroll: "Prepare monthly payroll and payslips.",
  Departments: "Create and manage your organization's departments.",
  Designations: "Create and manage job titles and designations.",
  Announcements: "Share updates with your organization.",
  Reports: "Review workforce trends and performance.",
  "AI Assistant": "Ask questions about your authorized HR data.",
  "Audit Log": "Review recorded system activities.",
  Settings: "Configure your company workspace.",
};

const today = () => new Date().toISOString().slice(0, 10);

function Dashboard() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [currentUser, setCurrentUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [stats, setStats] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [leaveBalances, setLeaveBalances] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_EMPLOYEE);
  const [recordName, setRecordName] = useState("");
  const [recordDescription, setRecordDescription] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attendanceActionLoading, setAttendanceActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [leaveForm, setLeaveForm] = useState({
    leaveTypeId: "",
    startDate: today(),
    endDate: today(),
    reason: "",
  });

  const isAdmin = currentUser?.role === "Admin";
  const canManagePeople = ["Admin", "HR"].includes(currentUser?.role);

  const apiRequest = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionStorage.getItem("hcm_token") || ""}`,
        ...(options.headers || {}),
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status}).`);
    }

    return data;
  }, []);

  const loadOrganization = useCallback(async () => {
    const data = await apiRequest("/company");
    setCompany(data.company || null);
    setDepartments(data.departments || []);
    setDesignations(data.designations || []);
    setLeaveTypes(data.leaveTypes || []);
  }, [apiRequest]);

  const loadEmployees = useCallback(async () => {
    const data = await apiRequest("/employees");
    setEmployees(Array.isArray(data) ? data : []);
  }, [apiRequest]);

  const loadPageData = useCallback(async (page) => {
    setLoading(true);
    setError("");

    try {
      if (page === "Dashboard") {
        const data = await apiRequest("/dashboard");
        setStats(data);
        await loadOrganization();
      } else if (page === "Employees") {
        await Promise.all([loadEmployees(), loadOrganization()]);
      } else if (page === "Departments" || page === "Designations") {
        await loadOrganization();
      } else if (page === "Attendance") {
        const rows = await apiRequest("/attendance");
        setAttendance(Array.isArray(rows) ? rows : []);
      } else if (page === "Leave Management") {
        const requests = await apiRequest("/leave");
        setLeaves(Array.isArray(requests) ? requests : []);

        if (currentUser?.role === "Employee") {
          const [organization, balances] = await Promise.all([
            apiRequest("/company"),
            apiRequest("/leave/balance"),
          ]);

          setLeaveTypes(organization.leaveTypes || []);
          setLeaveBalances(Array.isArray(balances) ? balances : []);
        } else {
          await loadOrganization();
        }
      } else if (page === "Payroll") {
        setPayroll(await apiRequest("/payroll"));
      } else if (page === "Announcements") {
        setAnnouncements(await apiRequest("/announcements"));
      } else if (page === "Audit Log") {
        setAuditLogs(await apiRequest("/audit"));
      } else if (page === "Settings") {
        await loadOrganization();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiRequest, loadEmployees, loadOrganization, currentUser]);

  useEffect(() => {
    try {
      setCurrentUser(JSON.parse(sessionStorage.getItem("hcm_user") || "null"));
    } catch {
      setCurrentUser(null);
    }
  }, []);

  useEffect(() => {
    loadPageData(activePage);
  }, [activePage, loadPageData]);

  function navigate(page) {
    setActivePage(page);
    setShowForm(false);
    setRecordName("");
    setRecordDescription("");
    setError("");
    setSuccess("");
    setSearch("");
  }

  function updateEmployeeForm(event) {
    const { name, value } = event.target;
    setForm((old) => ({ ...old, [name]: value }));
  }

  function openEmployeeForm() {
    setError("");
    setSuccess("");
    setForm(EMPTY_EMPLOYEE);
    setShowForm(true);
  }

  async function registerEmployee(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (form.password.length < 10) {
      setError("Temporary password kam az kam 10 characters ka hona chahiye.");
      return;
    }

    setSaving(true);

    try {
      const result = await apiRequest("/employees", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          departmentId: form.departmentId ? Number(form.departmentId) : null,
          designationId: form.designationId ? Number(form.designationId) : null,
          basicSalary: Number(form.basicSalary),
        }),
      });

      setSuccess(`Employee successfully registered. Employee ID: ${result.id}`);
      setShowForm(false);
      setForm(EMPTY_EMPLOYEE);
      await Promise.all([loadEmployees(), loadOrganization()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function createOrganizationRecord(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const name = recordName.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }

    setSaving(true);

    try {
      const endpoint = activePage === "Departments" ? "/departments" : "/designations";

      await apiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify({ name }),
      });

      setSuccess(`${activePage === "Departments" ? "Department" : "Designation"} "${name}" created successfully.`);
      setRecordName("");
      setRecordDescription("");
      await loadOrganization();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateCompany(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);

    const formData = new FormData(event.currentTarget);
    const payload = {
      name: String(formData.get("companyName") || "").trim(),
      officeStart: String(formData.get("officeStart") || "09:00"),
      graceMinutes: Number(formData.get("graceMinutes")),
    };

    try {
      await apiRequest("/company", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setSuccess("Company settings saved.");
      await loadOrganization();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function runPayroll(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);

    const month = new FormData(event.currentTarget).get("month");

    try {
      const result = await apiRequest("/payroll/run", {
        method: "POST",
        body: JSON.stringify({ month }),
      });
      setSuccess(`Payroll draft generated for ${month}. Records: ${result.count}.`);
      setPayroll(result.payroll || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function finalizePayroll(month) {
    if (!window.confirm(`Finalize and lock payroll for ${month}?`)) return;
    setError("");
    setSuccess("");

    try {
      const result = await apiRequest(`/payroll/${month}/finalize`, { method: "POST" });
      setSuccess(result.message);
      await loadPageData("Payroll");
    } catch (err) {
      setError(err.message);
    }
  }

  async function reviewLeave(id, status) {
    const comment = window.prompt("Optional review comment:", "") || "";
    setError("");
    setSuccess("");

    try {
      await apiRequest(`/leave/${id}/review`, {
        method: "PATCH",
        body: JSON.stringify({ status, comment }),
      });

      setSuccess(`Leave request ${status.toLowerCase()}.`);
      setLeaves(await apiRequest("/leave"));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAttendanceAction(action) {
    setError("");
    setSuccess("");
    setAttendanceActionLoading(true);

    try {
      const result = await apiRequest(`/attendance/${action}`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      setSuccess(
        result.message ||
        (action === "check-in" ? "Check-in successful." : "Check-out successful.")
      );

      const rows = await apiRequest("/attendance");
      setAttendance(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setAttendanceActionLoading(false);
    }
  }

  async function submitLeaveRequest(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!leaveForm.leaveTypeId) {
      setError("Please select a leave type.");
      return;
    }

    if (leaveForm.endDate < leaveForm.startDate) {
      setError("End date cannot be before start date.");
      return;
    }

    setSaving(true);

    try {
      const result = await apiRequest("/leave", {
        method: "POST",
        body: JSON.stringify({
          leaveTypeId: Number(leaveForm.leaveTypeId),
          startDate: leaveForm.startDate,
          endDate: leaveForm.endDate,
          reason: leaveForm.reason.trim(),
        }),
      });

      setSuccess(
        `Leave request submitted successfully. Requested days: ${result.days ?? "—"}.`
      );

      setLeaveForm({
        leaveTypeId: "",
        startDate: today(),
        endDate: today(),
        reason: "",
      });

      const [requests, balances] = await Promise.all([
        apiRequest("/leave"),
        apiRequest("/leave/balance"),
      ]);

      setLeaves(Array.isArray(requests) ? requests : []);
      setLeaveBalances(Array.isArray(balances) ? balances : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function createAnnouncement(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);

    const formData = new FormData(event.currentTarget);

    try {
      await apiRequest("/announcements", {
        method: "POST",
        body: JSON.stringify({
          title: formData.get("title"),
          body: formData.get("body"),
        }),
      });
      setSuccess("Announcement published.");
      event.currentTarget.reset();
      setAnnouncements(await apiRequest("/announcements"));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const filteredEmployees = employees.filter((employee) =>
    [
      employee.name,
      employee.email,
      employee.employee_code,
      employee.department,
      employee.designation,
    ].some((value) => String(value || "").toLowerCase().includes(search.toLowerCase()))
  );

  const filteredDepartments = departments.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  const filteredDesignations = designations.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  const todayAttendance = attendance.find((row) => row.work_date === today());

  
const statCards = [
  {
    label: "Total Employees",
    value: stats?.stats?.totalEmployees ?? stats?.headcount ?? "—",
    icon: "♙",
    color: "blue",
  },
  {
    label: "Present Today",
    value: stats?.stats?.presentToday ?? stats?.presentToday ?? "—",
    icon: "◷",
    color: "green",
  },
  {
    label: "Pending Leaves",
    value: stats?.stats?.pendingLeaves ?? stats?.pendingLeaves ?? "—",
    icon: "▤",
    color: "orange",
  },
  {
    label: "Monthly Payroll",
    value: stats
      ? Number(
          stats?.stats?.finalizedPayrollNet ??
          stats?.finalizedPayrollNet ??
          stats?.payrollCost ??
          0
        ).toLocaleString()
      : "—",
    icon: "＄",
    color: "purple",
  },
];


  function renderOrganizationPage(kind) {
    const isDepartment = kind === "Departments";
    const items = isDepartment ? filteredDepartments : filteredDesignations;

    return (
      <section className="panel module-panel">
        <div className="panel-heading">
          <div>
            <h2>{kind}</h2>
            <p>{isDepartment
              ? "Create departments such as Engineering, HR, Finance or Operations."
              : "Create job titles such as Software Engineer, HR Manager or Accountant."}</p>
          </div>
          <span className="neutral-pill">{items.length} records</span>
        </div>

        {canManagePeople ? (
          <form className="employee-form" onSubmit={createOrganizationRecord}>
            <div className="employee-form-heading">
              <div>
                <h3>Create {isDepartment ? "department" : "designation"}</h3>
                <p>Records are saved to your company's database.</p>
              </div>
            </div>
            <div className="employee-form-grid">
              <div className="employee-field">
                <label htmlFor="organization-name">{isDepartment ? "Department name *" : "Designation name *"}</label>
                <input
                  id="organization-name"
                  value={recordName}
                  onChange={(event) => setRecordName(event.target.value)}
                  placeholder={isDepartment ? "e.g. Human Resources" : "e.g. HR Manager"}
                  maxLength={100}
                  required
                />
              </div>
            </div>
            <button className="button button-primary employee-submit" disabled={saving}>
              {saving ? "Saving..." : `＋ Create ${isDepartment ? "department" : "designation"}`}
            </button>
          </form>
        ) : (
          <p className="employee-message">Only Admin or HR can view and manage these records. Creating records requires Admin access.</p>
        )}

        <div className="employee-list-toolbar">
          <div>
            <h3>{isDepartment ? "Department directory" : "Designation directory"}</h3>
            <p>{items.length} saved {isDepartment ? "department(s)" : "designation(s)"}</p>
          </div>
          <input
            className="employee-search"
            placeholder={`Search ${kind.toLowerCase()}...`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={`Search ${kind.toLowerCase()}`}
          />
        </div>

        {items.length === 0 ? (
          <div className="module-placeholder">
            <div className="placeholder-icon">{isDepartment ? "▦" : "◇"}</div>
            <h3>No {kind.toLowerCase()} yet</h3>
            <p>Create your first record using the form above. It will then be available in employee registration.</p>
          </div>
        ) : (
          <div className="employee-table-wrap">
            <table className="employee-table">
              <thead><tr><th>ID</th><th>Name</th><th>Usage</th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>#{item.id}</td>
                    <td><strong>{item.name}</strong></td>
                    <td><span className="employee-status">Available for employees</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <button className="button button-secondary employee-refresh" onClick={loadOrganization} disabled={loading}>
          ↻ Refresh {kind.toLowerCase()}
        </button>
      </section>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">H</div>
          <div>
            <div className="brand-name">HCM <span>Lite</span></div>
            <div className="brand-subtitle">PEOPLE MANAGEMENT</div>
          </div>
        </div>

        <div className="workspace-label">WORKSPACE</div>
        <div className="company-switcher">
          <div className="company-avatar">C</div>
          <div className="company-info">
            <strong>{company?.name || "Nexora HR Solutions"}</strong>
            <span>Organization workspace</span>
          </div>
          <span className="switch-arrow">⌄</span>
        </div>

        <nav className="navigation">
          {MENU.map((group) => (
            <div className="nav-group" key={group.section}>
              <div className="nav-heading">{group.section}</div>
              {group.items.map((item) => (
                <button
                  key={item}
                  className={`nav-item ${activePage === item ? "active" : ""}`}
                  onClick={() => navigate(item)}
                >
                  <span className="nav-dot">
                    {item === "Dashboard" ? "⌂" :
                      item === "Employees" ? "♙" :
                      item === "Attendance" ? "◷" :
                      item === "Leave Management" ? "▤" :
                      item === "Payroll" ? "＄" : "◇"}
                  </span>
                  <span>{item}</span>
                  {item === "Leave Management" && stats?.pendingLeaves > 0 &&
                    <span className="nav-count">{stats.pendingLeaves}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">✦</div>
            <strong>Need a hand?</strong>
            <p>Your workforce workspace, all in one place.</p>
          </div>
          <div className="user-profile">
            <div className="user-avatar">{(currentUser?.name || "A").charAt(0).toUpperCase()}</div>
            <div className="user-details">
              <strong>{currentUser?.name || "Administrator"}</strong>
              <span>{currentUser?.role || "Account"}</span>
            </div>
            <span className="more-icon">•••</span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> <strong>{activePage}</strong></div>
          <div className="topbar-actions">
            <span className="today-label">{company?.name || "Human Capital Management"}</span>
            <div className="topbar-avatar">{(currentUser?.name || "A").charAt(0).toUpperCase()}</div>
          </div>
        </header>

        <div className="page-content">
          <div className="welcome-row">
            <div>
              <div className="eyebrow">{new Date().toLocaleDateString("en-US", {
                weekday: "long", year: "numeric", month: "long", day: "numeric",
              }).toUpperCase()}</div>
              <h1>{activePage === "Dashboard" ? `Good day, ${currentUser?.name || "Administrator"}` : activePage}</h1>
              <p className="page-description">{DESCRIPTIONS[activePage]}</p>
            </div>
            <div className="welcome-actions">
              <button className="button button-secondary" onClick={() => navigate("Reports")}>View reports ↗</button>
              {canManagePeople && (
                <button className="button button-primary" onClick={() => {
                  navigate("Employees");
                  setForm(EMPTY_EMPLOYEE);
                  setShowForm(true);
                }}>＋ Add employee</button>
              )}
            </div>
          </div>

          {error && <div className="employee-message employee-error" role="alert">{error}</div>}
          {success && <div className="employee-message employee-success" role="status">{success}</div>}

          {activePage === "Dashboard" && (
            <>
              <div className="stat-grid">
                {statCards.map((stat) => (
                  <div className="stat-card" key={stat.label}>
                    <div className="stat-card-top">
                      <span>{stat.label}</span>
                      <span className={`stat-icon ${stat.color}`}>{stat.icon}</span>
                    </div>
                    <div className="stat-value">{stat.value}</div>
                    <div className="stat-caption"><span className="status-dot" />Live database metrics</div>
                  </div>
                ))}
              </div>

              <div className="dashboard-grid">
                <section className="panel overview-panel">
                  <div className="panel-heading">
                    <div><h2>Workforce overview</h2><p>Employee distribution by department</p></div>
                    <button className="text-button" onClick={() => navigate("Departments")}>Manage departments ↗</button>
                  </div>
                  {stats?.departments?.length ? (
                    <div className="simple-list">
                      {stats.departments.map((d) => (
                        <div className="simple-list-row" key={d.name}>
                          <span>{d.name}</span><strong>{d.headcount}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-chart">
                      <div className="chart-illustration">▥</div>
                      <strong>Your workforce data will appear here</strong>
                      <p>Create departments and register employees to view workforce distribution.</p>
                      <button className="button button-primary" onClick={() => navigate("Departments")}>Create department →</button>
                    </div>
                  )}
                </section>

                <section className="panel activity-panel">
                  <div className="panel-heading"><div><h2>Quick actions</h2><p>Common HR tasks</p></div></div>
                  {[
                    ["♙", "Register employee", "Create an employee record", "Employees", "blue"],
                    ["▦", "Create department", "Organize your teams", "Departments", "green"],
                    ["◇", "Create designation", "Set up job titles", "Designations", "purple"],
                    ["◷", "Attendance board", "Review attendance", "Attendance", "orange"],
                  ].map(([icon, title, desc, page, color]) => (
                    <button className="quick-action" key={title} onClick={() => {
                      navigate(page);
                      if (page === "Employees") {
                        setForm(EMPTY_EMPLOYEE);
                        setShowForm(true);
                      }
                    }}>
                      <span className={`quick-icon ${color}`}>{icon}</span>
                      <span><strong>{title}</strong><small>{desc}</small></span><b>→</b>
                    </button>
                  ))}
                </section>
              </div>
            </>
          )}

          {activePage === "Employees" && (
            <section className="panel module-panel">
              <div className="panel-heading">
                <div><h2>Employee directory</h2><p>Manage employee accounts and saved records.</p></div>
                {canManagePeople && !showForm && (
                  <button className="button button-primary" onClick={openEmployeeForm}>＋ Register employee</button>
                )}
              </div>

              {showForm && canManagePeople && (
                <form className="employee-form" onSubmit={registerEmployee}>
                  <div className="employee-form-heading">
                    <div><h3>Register a new employee</h3><p>A login account will also be created.</p></div>
                    <button type="button" className="button button-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                  </div>
                  <div className="employee-form-grid">
                    <div className="employee-field"><label>Full name *</label><input name="name" value={form.name} onChange={updateEmployeeForm} required /></div>
                    <div className="employee-field"><label>Email address *</label><input type="email" name="email" value={form.email} onChange={updateEmployeeForm} required /></div>
                    <div className="employee-field"><label>Employee code *</label><input name="employeeCode" value={form.employeeCode} onChange={updateEmployeeForm} placeholder="EMP-002" required /></div>
                    <div className="employee-field"><label>Temporary password *</label><input type="password" name="password" value={form.password} onChange={updateEmployeeForm} minLength={10} required /><small>At least 10 characters.</small></div>
                    <div className="employee-field"><label>Department</label><select name="departmentId" value={form.departmentId} onChange={updateEmployeeForm}><option value="">Select department</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
                    <div className="employee-field"><label>Designation</label><select name="designationId" value={form.designationId} onChange={updateEmployeeForm}><option value="">Select designation</option>{designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
                    <div className="employee-field"><label>Joining date *</label><input type="date" name="joinDate" value={form.joinDate} onChange={updateEmployeeForm} required /></div>
                    <div className="employee-field"><label>Monthly basic salary *</label><input type="number" name="basicSalary" min="1" step="0.01" value={form.basicSalary} onChange={updateEmployeeForm} required /></div>
                    <div className="employee-field"><label>Phone</label><input name="phone" value={form.phone} onChange={updateEmployeeForm} /></div>
                    <div className="employee-field"><label>Address</label><input name="address" value={form.address} onChange={updateEmployeeForm} /></div>
                  </div>
                  <button className="button button-primary employee-submit" type="submit" disabled={saving}>{saving ? "Saving..." : "Create employee account"}</button>
                </form>
              )}

              <div className="employee-list-toolbar">
                <div><h3>Saved employees</h3><p>{employees.length} employee(s)</p></div>
                <input className="employee-search" placeholder="Search name, email, code..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>

              {loading ? <div className="module-placeholder"><h3>Loading employees...</h3></div> :
                filteredEmployees.length === 0 ? <div className="module-placeholder"><h3>No matching employees</h3><p>Register an employee or change your search.</p></div> :
                <div className="employee-table-wrap"><table className="employee-table">
                  <thead><tr><th>Employee</th><th>Code</th><th>Department</th><th>Designation</th><th>Joining date</th><th>Status</th></tr></thead>
                  <tbody>{filteredEmployees.map((e) => <tr key={e.id}>
                    <td><strong>{e.name}</strong><small>{e.email}</small></td><td>{e.employee_code}</td><td>{e.department || "—"}</td><td>{e.designation || "—"}</td><td>{e.join_date}</td><td><span className="employee-status">{e.status}</span></td>
                  </tr>)}</tbody>
                </table></div>
              }
              <button className="button button-secondary employee-refresh" onClick={loadEmployees} disabled={loading}>↻ Refresh directory</button>
            </section>
          )}

          {activePage === "Departments" && renderOrganizationPage("Departments")}
          {activePage === "Designations" && renderOrganizationPage("Designations")}

          {activePage === "Attendance" && (
            <section className="panel module-panel">
              <div className="panel-heading">
                <div>
                  <h2>Attendance records</h2>
                  <p>Attendance recorded by employee check-in and check-out.</p>
                </div>
              </div>

              {currentUser?.role === "Employee" && (
                <div className="employee-form">
                  <div className="employee-form-heading">
                    <div>
                      <h3>My attendance today</h3>
                      <p>{today()}</p>
                    </div>
                    <span className="employee-status">
                      {todayAttendance?.status || "Not checked in"}
                    </span>
                  </div>

                  <div className="welcome-actions">
                    {!todayAttendance ? (
                      <button
                        type="button"
                        className="button button-primary"
                        disabled={attendanceActionLoading || loading}
                        onClick={() => handleAttendanceAction("check-in")}
                      >
                        {attendanceActionLoading ? "Please wait..." : "✓ Check In"}
                      </button>
                    ) : !todayAttendance.check_out ? (
                      <button
                        type="button"
                        className="button button-primary"
                        disabled={attendanceActionLoading || loading}
                        onClick={() => handleAttendanceAction("check-out")}
                      >
                        {attendanceActionLoading ? "Please wait..." : "↗ Check Out"}
                      </button>
                    ) : (
                      <span className="employee-status">Attendance completed for today</span>
                    )}
                  </div>

                  {todayAttendance && (
                    <p>
                      Check-in: {todayAttendance.check_in || "—"}
                      {" · "}
                      Check-out: {todayAttendance.check_out || "Not checked out"}
                    </p>
                  )}
                </div>
              )}

              <DataTable loading={loading} rows={attendance} columns={[
                ["employee_name", "Employee"],
                ["employee_code", "Code"],
                ["work_date", "Date"],
                ["check_in", "Check in"],
                ["check_out", "Check out"],
                ["status", "Status"],
              ]} />
            </section>
          )}

          {activePage === "Leave Management" && (
            <section className="panel module-panel">
              <div className="panel-heading">
                <div>
                  <h2>Leave Management</h2>
                  <p>Review requests, balances and leave history.</p>
                </div>
              </div>

              {currentUser?.role === "Employee" && (
                <>
                  <form className="employee-form" onSubmit={submitLeaveRequest}>
                    <div className="employee-form-heading">
                      <div>
                        <h3>Apply for leave</h3>
                        <p>Submit your leave request for review.</p>
                      </div>
                    </div>

                    <div className="employee-form-grid">
                      <div className="employee-field">
                        <label htmlFor="leave-type">Leave type *</label>
                        <select
                          id="leave-type"
                          value={leaveForm.leaveTypeId}
                          onChange={(event) => setLeaveForm((old) => ({
                            ...old,
                            leaveTypeId: event.target.value,
                          }))}
                          required
                        >
                          <option value="">Select leave type</option>
                          {leaveTypes.map((type) => (
                            <option key={type.id} value={type.id}>{type.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="employee-field">
                        <label htmlFor="leave-start">Start date *</label>
                        <input
                          id="leave-start"
                          type="date"
                          value={leaveForm.startDate}
                          onChange={(event) => setLeaveForm((old) => ({
                            ...old,
                            startDate: event.target.value,
                            endDate: old.endDate < event.target.value
                              ? event.target.value
                              : old.endDate,
                          }))}
                          required
                        />
                      </div>

                      <div className="employee-field">
                        <label htmlFor="leave-end">End date *</label>
                        <input
                          id="leave-end"
                          type="date"
                          min={leaveForm.startDate}
                          value={leaveForm.endDate}
                          onChange={(event) => setLeaveForm((old) => ({
                            ...old,
                            endDate: event.target.value,
                          }))}
                          required
                        />
                      </div>

                      <div className="employee-field">
                        <label htmlFor="leave-reason">Reason *</label>
                        <textarea
                          id="leave-reason"
                          rows="3"
                          maxLength={1000}
                          value={leaveForm.reason}
                          onChange={(event) => setLeaveForm((old) => ({
                            ...old,
                            reason: event.target.value,
                          }))}
                          placeholder="Enter the reason for your leave"
                          required
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="button button-primary employee-submit"
                      disabled={saving || loading}
                    >
                      {saving ? "Submitting..." : "＋ Submit leave request"}
                    </button>
                  </form>

                  <div className="panel-heading">
                    <div>
                      <h2>My leave balance</h2>
                      <p>Your available leave quota.</p>
                    </div>
                  </div>

                  {leaveBalances.length > 0 ? (
                    <div className="stat-grid">
                      {leaveBalances.map((balance) => (
                        <div className="stat-card" key={balance.id}>
                          <div className="stat-card-top">
                            <span>{balance.name}</span>
                          </div>
                          <div className="stat-value">{balance.remaining ?? 0}</div>
                          <div className="stat-caption">
                            Remaining of {balance.quota ?? 0} days
                            {" · "}
                            Used: {balance.used ?? 0}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="module-placeholder">
                      <h3>No leave balance information</h3>
                      <p>Check that leave types and quotas are configured for your company.</p>
                    </div>
                  )}
                </>
              )}

              <div className="employee-list-toolbar">
                <div>
                  <h3>{currentUser?.role === "Employee" ? "My leave requests" : "Employee leave requests"}</h3>
                  <p>{leaves.length} request(s)</p>
                </div>
              </div>

              <DataTable loading={loading} rows={leaves} columns={[
                ["employee_name", "Employee"],
                ["leave_type", "Type"],
                ["start_date", "Start"],
                ["end_date", "End"],
                ["days", "Days"],
                ["status", "Status"],
              ]} />

              {canManagePeople && leaves.filter((leave) => leave.status === "Pending").map((leave) => (
                <div className="review-row" key={leave.id}>
                  <span>Request #{leave.id} — {leave.employee_name}: {leave.reason}</span>
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => reviewLeave(leave.id, "Approved")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => reviewLeave(leave.id, "Rejected")}
                  >
                    Reject
                  </button>
                </div>
              ))}
            </section>
          )}

          {activePage === "Payroll" && (
            <section className="panel module-panel">
              <div className="panel-heading"><div><h2>Payroll</h2><p>Generate payroll drafts. Only Admin can finalize them.</p></div></div>
              {canManagePeople && (
                <form className="employee-form" onSubmit={runPayroll}>
                  <div className="employee-form-grid">
                    <div className="employee-field"><label>Payroll month *</label><input type="month" name="month" defaultValue={new Date().toISOString().slice(0, 7)} required /></div>
                  </div>
                  <button className="button button-primary employee-submit" disabled={saving}>{saving ? "Generating..." : "Run payroll draft"}</button>
                </form>
              )}
              <DataTable loading={loading} rows={payroll} columns={[
                ["name", "Employee"], ["employee_code", "Code"], ["payroll_month", "Month"], ["basic", "Basic"], ["gross", "Gross"], ["deductions", "Deductions"], ["net", "Net"], ["status", "Status"],
              ]} />
              {isAdmin && [...new Set(payroll.filter((p) => p.status === "Draft").map((p) => p.payroll_month))].map((month) => (
                <button className="button button-primary" key={month} onClick={() => finalizePayroll(month)}>Finalize payroll {month}</button>
              ))}
            </section>
          )}

          {activePage === "Announcements" && (
            <section className="panel module-panel">
              <div className="panel-heading"><div><h2>Announcements</h2><p>Organization-wide updates.</p></div></div>
              {canManagePeople && <form className="employee-form" onSubmit={createAnnouncement}>
                <div className="employee-form-grid">
                  <div className="employee-field"><label>Title *</label><input name="title" required /></div>
                  <div className="employee-field"><label>Message *</label><textarea name="body" rows="3" required /></div>
                </div>
                <button className="button button-primary employee-submit" disabled={saving}>{saving ? "Publishing..." : "Publish announcement"}</button>
              </form>}
              {announcements.map((a) => <article className="announcement-card" key={a.id}><h3>{a.title}</h3><p>{a.body}</p><small>{a.author} · {a.created_at}</small></article>)}
              {!loading && announcements.length === 0 && <div className="module-placeholder"><h3>No announcements yet</h3></div>}
            </section>
          )}

          {activePage === "Audit Log" && (
            <section className="panel module-panel">
              <div className="panel-heading"><div><h2>Audit log</h2><p>Recorded system actions. Admin access only.</p></div></div>
              <DataTable loading={loading} rows={auditLogs} columns={[
                ["created_at", "Time"], ["actor_name", "User"], ["action", "Action"], ["entity", "Entity"], ["entity_id", "Record ID"],
              ]} />
            </section>
          )}

          {activePage === "Settings" && (
            <section className="panel module-panel">
              <div className="panel-heading"><div><h2>Company settings</h2><p>Configure organization details and attendance rules.</p></div></div>
              {isAdmin ? <form className="employee-form" onSubmit={updateCompany}>
                <div className="employee-form-grid">
                  <div className="employee-field"><label>Company name *</label><input name="companyName" defaultValue={company?.name || ""} required /></div>
                  <div className="employee-field"><label>Office start time *</label><input name="officeStart" type="time" defaultValue={company?.office_start || "09:00"} required /></div>
                  <div className="employee-field"><label>Grace period (minutes) *</label><input name="graceMinutes" type="number" min="0" max="180" defaultValue={company?.grace_minutes ?? 15} required /></div>
                </div>
                <button className="button button-primary employee-submit" disabled={saving}>{saving ? "Saving..." : "Save settings"}</button>
              </form> : <p>Company settings are available to Admin only.</p>}
              <button className="button button-secondary employee-refresh" onClick={() => navigate("Departments")}>Manage departments</button>
              <button className="button button-secondary employee-refresh" onClick={() => navigate("Designations")}>Manage designations</button>
            </section>
          )}

          {activePage === "Reports" && (
            <section className="panel module-panel">
              <div className="panel-heading"><div><h2>Reports</h2><p>Current workforce summary from the database.</p></div></div>
              <div className="stat-grid">
                <div className="stat-card"><div className="stat-card-top">Active workforce</div><div className="stat-value">{stats?.headcount ?? employees.length}</div></div>
                <div className="stat-card"><div className="stat-card-top">Departments</div><div className="stat-value">{departments.length}</div></div>
                <div className="stat-card"><div className="stat-card-top">Designations</div><div className="stat-value">{designations.length}</div></div>
                <div className="stat-card"><div className="stat-card-top">Pending leave</div><div className="stat-value">{stats?.pendingLeaves ?? "—"}</div></div>
              </div>
              <button className="button button-secondary employee-refresh" onClick={() => loadPageData("Dashboard")}>↻ Refresh metrics</button>
            </section>
          )}

          {activePage === "AI Assistant" && (
            <section className="panel module-panel">
              <div className="panel-heading"><div><h2>AI Assistant</h2><p>HR data assistant</p></div></div>
              <div className="module-placeholder"><h3>AI integration not configured</h3><p>The backend currently has no LLM provider endpoint or API key configured. This screen does not pretend to provide live AI responses.</p></div>
            </section>
          )}

          <footer className="footer"><span>HCM Lite · Human Capital Management</span><span>Secure workforce workspace</span></footer>
        </div>
      </main>
    </div>
  );
}

function DataTable({ rows = [], columns = [], loading }) {
  if (loading) return <div className="module-placeholder"><h3>Loading records...</h3></div>;
  if (!rows.length) return <div className="module-placeholder"><h3>No records found</h3><p>Records will appear here when available.</p></div>;

  function display(value) {
    if (value == null || value === "") return "—";
    if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString();
    return String(value);
  }

  return (
    <div className="employee-table-wrap">
      <table className="employee-table">
        <thead><tr>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => (
          <tr key={row.id ?? index}>
            {columns.map(([key]) => <td key={key}>{display(row[key])}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default Dashboard;
