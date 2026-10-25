const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("ERROR: server/.env mein kam az kam 32-character JWT_SECRET set karo.");
  process.exit(1);
}

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:3000" }));
app.use(express.json({ limit: "1mb" }));

const db = new Database(path.join(__dirname, "hcm-lite.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  office_start TEXT NOT NULL DEFAULT '09:00',
  grace_minutes INTEGER NOT NULL DEFAULT 15,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS designations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Admin','HR','Employee')),
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE REFERENCES users(id),
  employee_code TEXT NOT NULL UNIQUE,
  department_id INTEGER REFERENCES departments(id),
  designation_id INTEGER REFERENCES designations(id),
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  join_date TEXT NOT NULL,
  basic_salary REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  work_date TEXT NOT NULL,
  check_in TEXT NOT NULL,
  check_out TEXT,
  status TEXT NOT NULL DEFAULT 'Present',
  UNIQUE(employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS leave_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  annual_quota REAL
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days REAL NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  reviewer_id INTEGER REFERENCES users(id),
  review_comment TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payroll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  payroll_month TEXT NOT NULL,
  basic REAL NOT NULL,
  gross REAL NOT NULL,
  deductions REAL NOT NULL,
  net REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft',
  finalized_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(employee_id, payroll_month)
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const countUsers = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
if (countUsers === 0) {
  db.prepare("INSERT OR IGNORE INTO leave_types (name, annual_quota) VALUES (?, ?)").run("Annual", 14);
  db.prepare("INSERT OR IGNORE INTO leave_types (name, annual_quota) VALUES (?, ?)").run("Sick", 8);
  db.prepare("INSERT OR IGNORE INTO leave_types (name, annual_quota) VALUES (?, ?)").run("Casual", 10);
  db.prepare("INSERT OR IGNORE INTO leave_types (name, annual_quota) VALUES (?, ?)").run("Unpaid", null);
}

function audit(actorId, action, entity, entityId = null, details = {}) {
  db.prepare(`
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(actorId || null, action, entity, entityId == null ? null : String(entityId), JSON.stringify(details));
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function getKarachiDateTime() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  const workDate = `${values.year}-${values.month}-${values.day}`;
  const currentMinutes =
    Number(values.hour) * 60 + Number(values.minute);

  const weekdays = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };

  return {
    now,
    workDate,
    currentMinutes,
    weekday: weekdays[values.weekday],
  };
}


function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Login required." });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare(
      "SELECT id, name, email, role, active, must_change_password FROM users WHERE id = ?"
    ).get(payload.id);

    if (!user || !user.active) return res.status(401).json({ error: "Account unavailable." });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

function roles(...allowed) {
  return (req, res, next) => {
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission for this action." });
    }
    next();
  };
}

function getEmployeeForUser(userId) {
  return db.prepare("SELECT * FROM employees WHERE user_id = ?").get(userId);
}

function employeeScope(req, res, next) {
  if (req.user.role === "Employee") {
    const employee = getEmployeeForUser(req.user.id);
    if (!employee) return res.status(403).json({ error: "Employee profile not configured." });
    req.employee = employee;
  }
  next();
}

function workingDays(start, end) {
  let total = 0;
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);

  while (cursor <= last) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) total++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return total;
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "HCM Lite API", time: new Date().toISOString() });
});

app.get("/api/setup/status", (req, res) => {
  const company = db.prepare("SELECT name FROM company WHERE id = 1").get();
  res.json({ setupComplete: Boolean(company), companyName: company?.name || null });
});

app.post("/api/setup", async (req, res) => {
  try {
    if (db.prepare("SELECT id FROM company WHERE id = 1").get()) {
      return res.status(409).json({ error: "Company setup has already been completed." });
    }

    const { companyName, adminName, email, password } = req.body;
    if (![companyName, adminName, email, password].every(v => typeof v === "string" && v.trim())) {
      return res.status(400).json({ error: "Company name, admin name, email and password are required." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (password.length < 10) {
      return res.status(400).json({ error: "Password must be at least 10 characters." });
    }

    const hash = await bcrypt.hash(password, 12);
    const setup = db.transaction(() => {
      db.prepare("INSERT INTO company (id, name) VALUES (1, ?)").run(companyName.trim());
      const result = db.prepare(`
        INSERT INTO users (name, email, password_hash, role)
        VALUES (?, ?, ?, 'Admin')
      `).run(adminName.trim(), email.trim().toLowerCase(), hash);

      audit(result.lastInsertRowid, "COMPANY_SETUP", "company", 1, { companyName: companyName.trim() });
      return Number(result.lastInsertRowid);
    });

    const adminId = setup();
    const token = jwt.sign({ id: adminId }, JWT_SECRET, { expiresIn: "8h" });
    res.status(201).json({
      message: "Company and first Admin created.",
      token,
      user: { id: adminId, name: adminName.trim(), email: email.trim().toLowerCase(), role: "Admin" }
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "That email is already registered." });
    }
    console.error(error);
    res.status(500).json({ error: "Setup failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase());
    if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "8h" });
    audit(user.id, "LOGIN", "user", user.id);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mustChangePassword: Boolean(user.must_change_password)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Login failed." });
  }
});

app.get("/api/me", auth, (req, res) => {
  const employee = getEmployeeForUser(req.user.id);
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      mustChangePassword: Boolean(req.user.must_change_password)
    },
    employee: employee || null,
    company: db.prepare("SELECT * FROM company WHERE id = 1").get() || null
  });
});

app.post("/api/auth/change-password", auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);

    if (!currentPassword || typeof newPassword !== "string" || newPassword.length < 10) {
      return res.status(400).json({ error: "Provide your current password and a new password of at least 10 characters." });
    }
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(400).json({ error: "Current password is incorrect." });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?")
      .run(hash, req.user.id);
    audit(req.user.id, "CHANGE_PASSWORD", "user", req.user.id);
    res.json({ message: "Password changed successfully. Please log in again." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not change password." });
  }
});

app.get("/api/company", auth, (req, res) => {
  res.json({
    company: db.prepare("SELECT * FROM company WHERE id = 1").get(),
    departments: db.prepare("SELECT * FROM departments ORDER BY name").all(),
    designations: db.prepare("SELECT * FROM designations ORDER BY name").all(),
    leaveTypes: db.prepare("SELECT * FROM leave_types ORDER BY id").all()
  });
});

app.get("/api/dashboard", auth, employeeScope, (req, res) => {
  try {
    const role = req.user.role;

    if (role === "Employee") {
      const employeeId = req.employee.id;
      const today = getKarachiDateTime().workDate;

      const attendanceToday = db.prepare(`
        SELECT * FROM attendance
        WHERE employee_id = ? AND work_date = ?
      `).get(employeeId, today) || null;

      const leaveSummary = db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) AS approved
        FROM leave_requests
        WHERE employee_id = ?
      `).get(employeeId);

      const latestLeaves = db.prepare(`
        SELECT l.*, lt.name AS leave_type
        FROM leave_requests l
        JOIN leave_types lt ON lt.id = l.leave_type_id
        WHERE l.employee_id = ?
        ORDER BY l.created_at DESC
        LIMIT 5
      `).all(employeeId);

      const payroll = db.prepare(`
        SELECT payroll_month, basic, gross, deductions, net, status
        FROM payroll
        WHERE employee_id = ? AND status = 'Finalized'
        ORDER BY payroll_month DESC
        LIMIT 3
      `).all(employeeId);

      return res.json({
        role,
        employee: req.employee,
        attendanceToday,
        leaveSummary,
        latestLeaves,
        payroll
      });
    }

    const employeeCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM employees e
      JOIN users u ON u.id = e.user_id
      WHERE e.status = 'Active' AND u.active = 1
    `).get().count;

    const today = getKarachiDateTime().workDate;

    const attendanceToday = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN status = 'Late' THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN status = 'Half Day' THEN 1 ELSE 0 END) AS halfDay
      FROM attendance
      WHERE work_date = ?
    `).get(today);

    const pendingLeaves = db.prepare(`
      SELECT COUNT(*) AS count
      FROM leave_requests
      WHERE status = 'Pending'
    `).get().count;

    const payrollSummary = db.prepare(`
      SELECT
        COUNT(*) AS count,
        COALESCE(SUM(net), 0) AS totalNet
      FROM payroll
      WHERE status = 'Finalized'
    `).get();

    const recentEmployees = db.prepare(`
      SELECT e.id, e.employee_code, e.join_date, e.status,
             u.name, u.email,
             d.name AS department,
             g.name AS designation
      FROM employees e
      JOIN users u ON u.id = e.user_id
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN designations g ON g.id = e.designation_id
      ORDER BY e.id DESC
      LIMIT 5
    `).all();

    const recentLeaves = db.prepare(`
      SELECT l.id, l.start_date, l.end_date, l.days, l.status,
             l.reason, u.name AS employee_name, lt.name AS leave_type
      FROM leave_requests l
      JOIN employees e ON e.id = l.employee_id
      JOIN users u ON u.id = e.user_id
      JOIN leave_types lt ON lt.id = l.leave_type_id
      WHERE l.status = 'Pending'
      ORDER BY l.created_at DESC
      LIMIT 5
    `).all();

    return res.json({
      role,
      stats: {
        totalEmployees: employeeCount,
        presentToday: attendanceToday.present || 0,
        lateToday: attendanceToday.late || 0,
        halfDayToday: attendanceToday.halfDay || 0,
        pendingLeaves,
        finalizedPayrollCount: payrollSummary.count,
        finalizedPayrollNet: payrollSummary.totalNet
      },
      recentEmployees,
      recentLeaves
    });
  } catch (error) {
    console.error("Dashboard endpoint failed:", error);
    return res.status(500).json({
      error: "Could not load dashboard data."
    });
  }
});

app.put("/api/company", auth, roles("Admin"), (req, res) => {
  const { name, officeStart, graceMinutes } = req.body;
  if (typeof name !== "string" || !name.trim() ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(officeStart || "") ||
      !Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 180) {
    return res.status(400).json({ error: "Provide a company name, valid office start time and grace minutes (0–180)." });
  }
  db.prepare("UPDATE company SET name = ?, office_start = ?, grace_minutes = ? WHERE id = 1")
    .run(name.trim(), officeStart, graceMinutes);
  audit(req.user.id, "UPDATE_COMPANY", "company", 1);
  res.json({ message: "Company settings updated." });
});

app.post("/api/departments", auth, roles("Admin"), (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "Department name is required." });
  try {
    const result = db.prepare("INSERT INTO departments (name) VALUES (?)").run(name);
    audit(req.user.id, "CREATE_DEPARTMENT", "department", result.lastInsertRowid);
    res.status(201).json({ id: Number(result.lastInsertRowid), name });
  } catch (error) {
    res.status(409).json({ error: "Department already exists." });
  }
});

app.post("/api/designations", auth, roles("Admin"), (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "Designation name is required." });
  try {
    const result = db.prepare("INSERT INTO designations (name) VALUES (?)").run(name);
    audit(req.user.id, "CREATE_DESIGNATION", "designation", result.lastInsertRowid);
    res.status(201).json({ id: Number(result.lastInsertRowid), name });
  } catch {
    res.status(409).json({ error: "Designation already exists." });
  }
});

app.post("/api/leave-types", auth, roles("Admin"), (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const quota = req.body.annualQuota;
  if (!name || !(quota === null || (Number.isFinite(quota) && quota >= 0))) {
    return res.status(400).json({ error: "Provide a leave type name and a non-negative quota or null for unlimited." });
  }
  try {
    const result = db.prepare("INSERT INTO leave_types (name, annual_quota) VALUES (?, ?)").run(name, quota);
    audit(req.user.id, "CREATE_LEAVE_TYPE", "leave_type", result.lastInsertRowid);
    res.status(201).json({ id: Number(result.lastInsertRowid), name, annualQuota: quota });
  } catch {
    res.status(409).json({ error: "Leave type already exists." });
  }
});

app.post("/api/users", auth, roles("Admin"), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (![name, email, password].every(v => typeof v === "string" && v.trim()) ||
        !["HR", "Employee"].includes(role) || password.length < 10 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: "Provide valid name/email, a password of at least 10 characters and role HR or Employee." });
    }
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare(`
      INSERT INTO users (name, email, password_hash, role, must_change_password)
      VALUES (?, ?, ?, ?, 1)
    `).run(name.trim(), email.trim().toLowerCase(), hash, role);
    audit(req.user.id, "CREATE_USER", "user", result.lastInsertRowid, { role });
    res.status(201).json({ id: Number(result.lastInsertRowid), name: name.trim(), email: email.trim().toLowerCase(), role });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "Email already registered." });
    console.error(error);
    res.status(500).json({ error: "Could not create user." });
  }
});

app.get("/api/employees", auth, employeeScope, (req, res) => {
  if (req.user.role === "Employee") {
    return res.json(db.prepare(`
      SELECT e.id, e.employee_code, e.phone, e.address, e.join_date, e.status,
             e.basic_salary, u.name, u.email, d.name AS department, g.name AS designation
      FROM employees e
      JOIN users u ON u.id = e.user_id
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN designations g ON g.id = e.designation_id
      WHERE e.id = ?
    `).all(req.employee.id));
  }

  const rows = db.prepare(`
    SELECT e.id, e.employee_code, e.phone, e.address, e.join_date, e.status,
           e.basic_salary, u.name, u.email, u.active AS user_active,
           d.name AS department, g.name AS designation
    FROM employees e
    JOIN users u ON u.id = e.user_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN designations g ON g.id = e.designation_id
    ORDER BY u.name
  `).all();

  if (req.user.role === "HR") return res.json(rows);
  res.json(rows);
});

app.post("/api/employees", auth, roles("Admin", "HR"), async (req, res) => {
  try {
    const { name, email, password, employeeCode, departmentId, designationId, phone, address, joinDate, basicSalary } = req.body;
    if (![name, email, password, employeeCode, joinDate].every(v => typeof v === "string" && v.trim()) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        password.length < 10 || !validDate(joinDate) ||
        !Number.isFinite(basicSalary) || basicSalary <= 0) {
      return res.status(400).json({ error: "Check name, email, password (10+ characters), employee code, ISO join date and positive basic salary." });
    }
    if (departmentId && !db.prepare("SELECT id FROM departments WHERE id = ?").get(departmentId)) {
      return res.status(400).json({ error: "Invalid department." });
    }
    if (designationId && !db.prepare("SELECT id FROM designations WHERE id = ?").get(designationId)) {
      return res.status(400).json({ error: "Invalid designation." });
    }

    const hash = await bcrypt.hash(password, 12);
    const create = db.transaction(() => {
      const user = db.prepare(`
        INSERT INTO users (name, email, password_hash, role, must_change_password)
        VALUES (?, ?, ?, 'Employee', 1)
      `).run(name.trim(), email.trim().toLowerCase(), hash);

      const employee = db.prepare(`
        INSERT INTO employees
          (user_id, employee_code, department_id, designation_id, phone, address, join_date, basic_salary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        user.lastInsertRowid, employeeCode.trim(), departmentId || null, designationId || null,
        phone || "", address || "", joinDate, basicSalary
      );

      audit(req.user.id, "CREATE_EMPLOYEE", "employee", employee.lastInsertRowid, { employeeCode: employeeCode.trim() });
      return Number(employee.lastInsertRowid);
    });

    res.status(201).json({ id: create(), message: "Employee and login created." });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Email or employee code already exists." });
    }
    console.error(error);
    res.status(500).json({ error: "Could not create employee." });
  }
});

app.put("/api/employees/:id/profile", auth, employeeScope, (req, res) => {
  const id = Number(req.params.id);
  const { phone, address } = req.body;
  if (req.user.role === "Employee" && id !== req.employee.id) {
    return res.status(403).json({ error: "You can only update your own contact details." });
  }
  if (req.user.role !== "Employee" && !["Admin", "HR"].includes(req.user.role)) {
    return res.status(403).json({ error: "Not allowed." });
  }
  const employee = db.prepare("SELECT id FROM employees WHERE id = ?").get(id);
  if (!employee) return res.status(404).json({ error: "Employee not found." });

  db.prepare("UPDATE employees SET phone = ?, address = ? WHERE id = ?")
    .run(typeof phone === "string" ? phone : "", typeof address === "string" ? address : "", id);
  audit(req.user.id, "UPDATE_EMPLOYEE_CONTACT", "employee", id);
  res.json({ message: "Contact details updated." });
});
app.post("/api/attendance/check-in", auth, employeeScope, (req, res) => {
  if (req.user.role !== "Employee") {
    return res.status(403).json({
      error: "Only employees can check in here."
    });
  }

  const { now, workDate, currentMinutes, weekday } =
    getKarachiDateTime();

  // Sunday is the weekly off day. Saturday is allowed.
  if (weekday === 0) {
    return res.status(422).json({
      error: "Sunday is a weekly off. Check-in is allowed Monday to Saturday."
    });
  }

  const company = db.prepare(
    "SELECT office_start, grace_minutes FROM company WHERE id = 1"
  ).get();

  if (!company) {
    return res.status(400).json({
      error: "Company setup is incomplete."
    });
  }

  const [hours, minutes] = company.office_start.split(":").map(Number);
  const threshold = hours * 60 + minutes + company.grace_minutes;
  const status = currentMinutes > threshold ? "Late" : "Present";

  try {
    const result = db.prepare(`
      INSERT INTO attendance (employee_id, work_date, check_in, status)
      VALUES (?, ?, ?, ?)
    `).run(
      req.employee.id,
      workDate,
      now.toISOString(),
      status
    );

    audit(
      req.user.id,
      "CHECK_IN",
      "attendance",
      result.lastInsertRowid,
      { workDate, status }
    );

    return res.status(201).json({
      message: "Check-in recorded.",
      status,
      workDate,
      checkIn: now.toISOString()
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({
        error: "You have already checked in today."
      });
    }

    console.error(error);
    return res.status(500).json({
      error: "Check-in failed."
    });
  }
});

app.post("/api/attendance/check-out", auth, employeeScope, (req, res) => {      return res.json({
    message: "Check-out recorded.",
    workDate,
    hoursWorked: Number(hoursWorked.toFixed(2)),
    status
  });
});

app.get("/api/attendance", auth, employeeScope, (req, res) => {

  const { now, workDate, weekday } = getKarachiDateTime();

  // Sunday is the weekly off day. Saturday is allowed.
  if (weekday === 0) {
    return res.status(422).json({
      error: "Sunday is a weekly off. Check-out is not available."
    });
  }

  const row = db.prepare(`
    SELECT * FROM attendance
    WHERE employee_id = ? AND work_date = ?
  `).get(req.employee.id, workDate);

  if (!row) {
    return res.status(409).json({
      error: "Check in before checking out."
    });
  }

  if (row.check_out) {
    return res.status(409).json({
      error: "You have already checked out."
    });
  }

  const hoursWorked =
    (now.getTime() - new Date(row.check_in).getTime()) / 3600000;

  const status = hoursWorked < 5 ? "Half Day" : row.status;

  db.prepare(`
    UPDATE attendance
    SET check_out = ?, status = ?
    WHERE id = ?
  `).run(now.toISOString(), status, row.id);

  audit(
    req.user.id,
    "CHECK_OUT",
    "attendance",
    row.id,
    { hoursWorked, status }
  );

  return res.json({
    message: "Check-out recorded.",
    workDate,
    hoursWorked: Number(hoursWorked.toFixed(2)),
    status
  });
});

app.get("/api/attendance", auth, employeeScope, (req, res) => {
  const { from, to } = req.query;
  if ((from && !validDate(from)) || (to && !validDate(to))) {
    return res.status(400).json({ error: "Dates must use YYYY-MM-DD." });
  }

  let sql = `
    SELECT a.*, u.name AS employee_name, e.employee_code
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    JOIN users u ON u.id = e.user_id
    WHERE 1=1
  `;
  const params = [];
  if (req.user.role === "Employee") {
    sql += " AND a.employee_id = ?";
    params.push(req.employee.id);
  }
  if (from) { sql += " AND a.work_date >= ?"; params.push(from); }
  if (to) { sql += " AND a.work_date <= ?"; params.push(to); }
  sql += " ORDER BY a.work_date DESC, u.name";
  res.json(db.prepare(sql).all(...params));
});

app.get("/api/leave", auth, employeeScope, (req, res) => {
  let sql = `
    SELECT l.*, lt.name AS leave_type, u.name AS employee_name
    FROM leave_requests l
    JOIN leave_types lt ON lt.id = l.leave_type_id
    JOIN employees e ON e.id = l.employee_id
    JOIN users u ON u.id = e.user_id
  `;
  const params = [];
  if (req.user.role === "Employee") {
    sql += " WHERE l.employee_id = ?";
    params.push(req.employee.id);
  }
  sql += " ORDER BY l.created_at DESC";
  res.json(db.prepare(sql).all(...params));
});

app.get("/api/leave/balance", auth, employeeScope, (req, res) => {
  if (req.user.role !== "Employee") return res.status(400).json({ error: "This endpoint is for employee leave balances." });
  const year = Number(getKarachiDateTime().workDate.slice(0, 4));
  const types = db.prepare("SELECT * FROM leave_types ORDER BY id").all();

  const balances = types.map(type => {
    const used = db.prepare(`
      SELECT COALESCE(SUM(days), 0) AS days
      FROM leave_requests
      WHERE employee_id = ? AND leave_type_id = ?
        AND status IN ('Approved','Pending')
        AND start_date LIKE ?
    `).get(req.employee.id, type.id, `${year}%`).days;
    return { id: type.id, name: type.name, quota: type.annual_quota, used, remaining: type.annual_quota == null ? null : Math.max(0, type.annual_quota - used) };
  });
  res.json(balances);
});

app.post("/api/leave", auth, employeeScope, (req, res) => {
  if (req.user.role !== "Employee") return res.status(403).json({ error: "Only employees can submit their own leave requests." });
  const { leaveTypeId, startDate, endDate, reason } = req.body;

  if (!validDate(startDate) || !validDate(endDate) || endDate < startDate ||
      !reason || typeof reason !== "string") {
    return res.status(400).json({ error: "Provide valid start/end dates and a reason." });
  }
  const type = db.prepare("SELECT * FROM leave_types WHERE id = ?").get(leaveTypeId);
  if (!type) return res.status(400).json({ error: "Invalid leave type." });

  const days = workingDays(startDate, endDate);
  if (days < 1) return res.status(422).json({ error: "Leave must include at least one working day." });

  const overlap = db.prepare(`
    SELECT id FROM leave_requests
    WHERE employee_id = ? AND status IN ('Pending','Approved')
      AND start_date <= ? AND end_date >= ?
  `).get(req.employee.id, endDate, startDate);
  if (overlap) return res.status(422).json({ error: "This leave overlaps another pending or approved request." });

  if (type.annual_quota != null) {
    const used = db.prepare(`
      SELECT COALESCE(SUM(days), 0) AS days FROM leave_requests
      WHERE employee_id = ? AND leave_type_id = ? AND status = 'Approved'
        AND start_date LIKE ?
    `).get(req.employee.id, type.id, `${startDate.slice(0, 4)}%`).days;
    if (used + days > type.annual_quota) return res.status(422).json({ error: "Insufficient leave balance." });
  }

  const result = db.prepare(`
    INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.employee.id, type.id, startDate, endDate, days, reason.trim());
  audit(req.user.id, "APPLY_LEAVE", "leave_request", result.lastInsertRowid, { days, type: type.name });
  res.status(201).json({ id: Number(result.lastInsertRowid), status: "Pending", days });
});

app.patch("/api/leave/:id/review", auth, roles("Admin", "HR"), (req, res) => {
  const id = Number(req.params.id);
  const { status, comment = "" } = req.body;
  if (!["Approved", "Rejected"].includes(status)) {
    return res.status(400).json({ error: "Status must be Approved or Rejected." });
  }
  const leave = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id);
  if (!leave) return res.status(404).json({ error: "Leave request not found." });
  if (leave.status !== "Pending") return res.status(409).json({ error: "Only pending requests can be reviewed." });

  if (status === "Approved") {
    const overlap = db.prepare(`
      SELECT id FROM leave_requests WHERE employee_id = ? AND status = 'Approved'
        AND start_date <= ? AND end_date >= ?
    `).get(leave.employee_id, leave.end_date, leave.start_date);
    if (overlap) return res.status(422).json({ error: "This request overlaps approved leave." });
  }

  db.prepare(`
    UPDATE leave_requests SET status = ?, reviewer_id = ?, review_comment = ? WHERE id = ?
  `).run(status, req.user.id, String(comment).slice(0, 1000), id);
  audit(req.user.id, "REVIEW_LEAVE", "leave_request", id, { status, comment });
  res.json({ message: `Leave ${status.toLowerCase()}.` });
});

app.post("/api/payroll/run", auth, roles("Admin", "HR"), (req, res) => {
  const month = req.body.month;
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ error: "Month must use YYYY-MM format." });
  }

  const employees = db.prepare(`
    SELECT e.*, u.name FROM employees e
    JOIN users u ON u.id = e.user_id
    WHERE e.status = 'Active' AND u.active = 1
  `).all();

  const createRun = db.transaction(() => {
    const results = [];
    for (const employee of employees) {
      const existing = db.prepare("SELECT status FROM payroll WHERE employee_id = ? AND payroll_month = ?")
        .get(employee.id, month);
      if (existing?.status === "Finalized") continue;

      const basic = employee.basic_salary;
      const gross = basic * 1.5;
      const [year, mon] = month.split("-").map(Number);
      const daysInMonth = new Date(year, mon, 0).getDate();
      const working = workingDays(`${month}-01`, `${month}-${String(daysInMonth).padStart(2, "0")}`);
      const attendanceRows = db.prepare(`
        SELECT status FROM attendance WHERE employee_id = ? AND work_date LIKE ?
      `).all(employee.id, `${month}%`);

      const absentDays = attendanceRows.filter(r => r.status === "Absent").length;
      const halfDays = attendanceRows.filter(r => r.status === "Half Day").length;
      const unpaidDays = db.prepare(`
        SELECT COALESCE(SUM(days),0) AS days FROM leave_requests
        WHERE employee_id = ? AND status = 'Approved' AND leave_type_id =
          (SELECT id FROM leave_types WHERE name = 'Unpaid')
          AND start_date LIKE ?
      `).get(employee.id, `${month}%`).days;

      const perDay = working > 0 ? gross / working : 0;
      const deductions = Math.min(gross, (absentDays + unpaidDays + halfDays * 0.5) * perDay);
      const net = Math.max(0, gross - deductions);

      db.prepare(`
        INSERT INTO payroll (employee_id, payroll_month, basic, gross, deductions, net, status)
        VALUES (?, ?, ?, ?, ?, ?, 'Draft')
        ON CONFLICT(employee_id, payroll_month) DO UPDATE SET
          basic=excluded.basic, gross=excluded.gross, deductions=excluded.deductions, net=excluded.net
        WHERE payroll.status = 'Draft'
      `).run(employee.id, month, basic, gross, deductions, net);

      results.push({ employeeId: employee.id, name: employee.name, month, basic, gross, deductions, net, status: "Draft" });
    }
    audit(req.user.id, "RUN_PAYROLL", "payroll", month, { count: results.length });
    return results;
  });

  try {
    res.json({ month, count: createRun().length, payroll: db.prepare(`
      SELECT p.*, u.name, e.employee_code FROM payroll p
      JOIN employees e ON e.id = p.employee_id JOIN users u ON u.id = e.user_id
      WHERE p.payroll_month = ? ORDER BY u.name
    `).all(month) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Payroll run failed." });
  }
});

app.get("/api/payroll", auth, employeeScope, (req, res) => {
  let sql = `
    SELECT p.*, u.name, e.employee_code FROM payroll p
    JOIN employees e ON e.id = p.employee_id
    JOIN users u ON u.id = e.user_id
  `;
  const params = [];
  if (req.user.role === "Employee") {
    sql += " WHERE p.employee_id = ? AND p.status = 'Finalized'";
    params.push(req.employee.id);
  }
  sql += " ORDER BY p.payroll_month DESC, u.name";
  res.json(db.prepare(sql).all(...params));
});

app.post("/api/payroll/:month/finalize", auth, roles("Admin"), (req, res) => {
  const month = req.params.month;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: "Month must use YYYY-MM." });

  const result = db.prepare("UPDATE payroll SET status = 'Finalized', finalized_by = ? WHERE payroll_month = ? AND status = 'Draft'")
    .run(req.user.id, month);
  audit(req.user.id, "FINALIZE_PAYROLL", "payroll", month, { count: result.changes });
  res.json({ message: "Payroll finalized and locked.", finalizedCount: result.changes });
});

app.post("/api/announcements", auth, roles("Admin", "HR"), (req, res) => {
  const { title, body } = req.body;
  if (typeof title !== "string" || !title.trim() || typeof body !== "string" || !body.trim()) {
    return res.status(400).json({ error: "Title and announcement body are required." });
  }
  const result = db.prepare("INSERT INTO announcements (title, body, created_by) VALUES (?, ?, ?)")
    .run(title.trim(), body.trim(), req.user.id);
  audit(req.user.id, "CREATE_ANNOUNCEMENT", "announcement", result.lastInsertRowid);
  res.status(201).json({ id: Number(result.lastInsertRowid), title: title.trim(), body: body.trim() });
});

app.get("/api/announcements", auth, (req, res) => {
  res.json(db.prepare(`
    SELECT a.*, u.name AS author
    FROM announcements a
    JOIN users u ON u.id = a.created_by
    ORDER BY a.created_at DESC
  `).all());
});

app.get("/api/audit", auth, roles("Admin"), (req, res) => {
  res.json(db.prepare(`
    SELECT a.*, u.name AS actor_name, u.email AS actor_email
    FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.id DESC LIMIT 500
  `).all());
});

app.use((req, res) => {
  console.log("404 API REQUEST:", req.method, req.originalUrl);
  return res.status(404).json({
    error: "API endpoint not found.",
    method: req.method,
    path: req.originalUrl,
  });
});
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, () => {
  console.log(`HCM Lite API running at http://localhost:${PORT}`);
});