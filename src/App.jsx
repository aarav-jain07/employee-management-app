import { useState, useEffect, useCallback } from 'react'
import EmployeeList from './components/EmployeeList'
import EmployeeForm from './components/EmployeeForm'
import { fetchEmployees, createEmployee, updateEmployee, deleteEmployee } from './api'
import './App.css'

function App() {
  const [employees, setEmployees] = useState([])
  const [view, setView] = useState('list') // 'list' | 'add' | 'edit'
  const [editingEmployee, setEditingEmployee] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadEmployees = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchEmployees()
      setEmployees(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadEmployees()
  }, [loadEmployees])

  async function handleAddEmployee(data) {
    setError(null)
    try {
      const created = await createEmployee(data)
      setEmployees(prev => [...prev, created])
      setView('list')
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleUpdateEmployee(data) {
    setError(null)
    try {
      const updated = await updateEmployee(editingEmployee.id, data)
      setEmployees(prev => prev.map(emp => (emp.id === updated.id ? updated : emp)))
      setEditingEmployee(null)
      setView('list')
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDeleteEmployee(id) {
    setError(null)
    try {
      await deleteEmployee(id)
      setEmployees(prev => prev.filter(emp => emp.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  function handleEditEmployee(employee) {
    setEditingEmployee(employee)
    setView('edit')
  }

  function handleCancel() {
    setEditingEmployee(null)
    setError(null)
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
        {error && (
          <div className="error-banner" role="alert">
            <strong>Error:</strong> {error}
            <button className="error-dismiss" onClick={() => setError(null)} aria-label="Dismiss">✕</button>
          </div>
        )}

        {view === 'list' && (
          <EmployeeList
            employees={employees}
            loading={loading}
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
