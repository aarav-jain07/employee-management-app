import express from 'express'
import cors from 'cors'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_FILE = join(__dirname, 'data.json')
const PORT = process.env.PORT || 3001

// ── Seed data ────────────────────────────────────────────
const SEED = [
  { id: 1, name: 'Alice Johnson', email: 'alice@example.com', department: 'Engineering', position: 'Senior Developer', salary: 95000, joinDate: '2020-03-15', phone: '555-100-0001', employmentType: 'Full-time', status: 'Active' },
  { id: 2, name: 'Bob Smith', email: 'bob@example.com', department: 'Marketing', position: 'Marketing Manager', salary: 75000, joinDate: '2019-07-01', phone: '555-100-0002', employmentType: 'Full-time', status: 'Active' },
  { id: 3, name: 'Carol White', email: 'carol@example.com', department: 'HR', position: 'HR Specialist', salary: 65000, joinDate: '2021-01-10', phone: '555-100-0003', employmentType: 'Part-time', status: 'Active' },
  { id: 4, name: 'David Brown', email: 'david@example.com', department: 'Finance', position: 'Financial Analyst', salary: 80000, joinDate: '2018-11-20', phone: '555-100-0004', employmentType: 'Full-time', status: 'On Leave' },
]

// ── Persistence helpers ───────────────────────────────────
function readData() {
  if (!existsSync(DATA_FILE)) return SEED
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf8'))
  } catch {
    return SEED
  }
}

function writeData(employees) {
  writeFileSync(DATA_FILE, JSON.stringify(employees, null, 2), 'utf8')
}

let employees = readData()

// ── App ───────────────────────────────────────────────────
const app = express()
app.use(cors())
app.use(express.json())

// GET /api/employees — list all employees
app.get('/api/employees', (_req, res) => {
  res.json(employees)
})

// GET /api/employees/:id — get a single employee
app.get('/api/employees/:id', (req, res) => {
  const employee = employees.find(e => e.id === Number(req.params.id))
  if (!employee) return res.status(404).json({ error: 'Employee not found' })
  res.json(employee)
})

// POST /api/employees — create a new employee
app.post('/api/employees', (req, res) => {
  const { name, email, department, position, salary, joinDate, phone, employmentType, status } = req.body

  if (!name || !email || !department || !position) {
    return res.status(400).json({ error: 'name, email, department and position are required' })
  }

  const newEmployee = {
    id: employees.length > 0 ? Math.max(...employees.map(e => e.id)) + 1 : 1,
    name: String(name).trim(),
    email: String(email).trim(),
    department: String(department).trim(),
    position: String(position).trim(),
    salary: salary != null ? Number(salary) : 0,
    joinDate: joinDate ? String(joinDate) : '',
    phone: phone ? String(phone).trim() : '',
    employmentType: employmentType ? String(employmentType).trim() : 'Full-time',
    status: status ? String(status).trim() : 'Active',
  }

  employees.push(newEmployee)
  writeData(employees)
  res.status(201).json(newEmployee)
})

// PUT /api/employees/:id — update an employee
app.put('/api/employees/:id', (req, res) => {
  const idx = employees.findIndex(e => e.id === Number(req.params.id))
  if (idx === -1) return res.status(404).json({ error: 'Employee not found' })

  const { name, email, department, position, salary, joinDate, phone, employmentType, status } = req.body

  if (!name || !email || !department || !position) {
    return res.status(400).json({ error: 'name, email, department and position are required' })
  }

  const updated = {
    ...employees[idx],
    name: String(name).trim(),
    email: String(email).trim(),
    department: String(department).trim(),
    position: String(position).trim(),
    salary: salary != null ? Number(salary) : employees[idx].salary,
    joinDate: joinDate !== undefined ? String(joinDate) : employees[idx].joinDate,
    phone: phone !== undefined ? String(phone).trim() : employees[idx].phone,
    employmentType: employmentType ? String(employmentType).trim() : employees[idx].employmentType,
    status: status ? String(status).trim() : employees[idx].status,
  }

  employees[idx] = updated
  writeData(employees)
  res.json(updated)
})

// DELETE /api/employees/:id — delete an employee
app.delete('/api/employees/:id', (req, res) => {
  const idx = employees.findIndex(e => e.id === Number(req.params.id))
  if (idx === -1) return res.status(404).json({ error: 'Employee not found' })

  employees.splice(idx, 1)
  writeData(employees)
  res.status(204).send()
})

app.listen(PORT, () => {
  console.log(`Employee API running on http://localhost:${PORT}`)
})
