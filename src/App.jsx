import { useState, useEffect } from 'react'
import EmployeeList from './components/EmployeeList'
import EmployeeForm from './components/EmployeeForm'
import './App.css'

const SEED_DATA = [
  { id: 1, name: 'Alice Johnson', email: 'alice@example.com', department: 'Engineering', position: 'Senior Developer', salary: 95000, joinDate: '2020-03-15' },
  { id: 2, name: 'Bob Smith', email: 'bob@example.com', department: 'Marketing', position: 'Marketing Manager', salary: 75000, joinDate: '2019-07-01' },
  { id: 3, name: 'Carol White', email: 'carol@example.com', department: 'HR', position: 'HR Specialist', salary: 65000, joinDate: '2021-01-10' },
  { id: 4, name: 'David Brown', email: 'david@example.com', department: 'Finance', position: 'Financial Analyst', salary: 80000, joinDate: '2018-11-20' },
]

function loadEmployees() {
  try {
    const stored = localStorage.getItem('employees')
    if (stored) return JSON.parse(stored)
  } catch {
    // ignore parse errors
  }
  return SEED_DATA
}

function App() {
  const [employees, setEmployees] = useState(loadEmployees)
  const [view, setView] = useState('list') // 'list' | 'add' | 'edit'
  const [editingEmployee, setEditingEmployee] = useState(null)

  useEffect(() => {
    localStorage.setItem('employees', JSON.stringify(employees))
  }, [employees])

  function handleAddEmployee(data) {
    const newEmployee = { ...data, id: Date.now() }
    setEmployees(prev => [...prev, newEmployee])
    setView('list')
  }

  function handleUpdateEmployee(data) {
    setEmployees(prev =>
      prev.map(emp => (emp.id === editingEmployee.id ? { ...data, id: emp.id } : emp))
    )
    setEditingEmployee(null)
    setView('list')
  }

  function handleDeleteEmployee(id) {
    setEmployees(prev => prev.filter(emp => emp.id !== id))
  }

  function handleEditEmployee(employee) {
    setEditingEmployee(employee)
    setView('edit')
  }

  function handleCancel() {
    setEditingEmployee(null)
    setView('list')
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-content">
          <h1 className="app-title">Employee Management</h1>
          <p className="app-subtitle">Manage your workforce efficiently</p>
        </div>
      </header>

      <main className="app-main">
        {view === 'list' && (
          <EmployeeList
            employees={employees}
            onAdd={() => setView('add')}
            onEdit={handleEditEmployee}
            onDelete={handleDeleteEmployee}
          />
        )}
        {view === 'add' && (
          <EmployeeForm
            mode="add"
            onSubmit={handleAddEmployee}
            onCancel={handleCancel}
          />
        )}
        {view === 'edit' && (
          <EmployeeForm
            mode="edit"
            employee={editingEmployee}
            onSubmit={handleUpdateEmployee}
            onCancel={handleCancel}
          />
        )}
      </main>
    </div>
  )
}

export default App
