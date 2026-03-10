import PropTypes from 'prop-types'

function EmployeeList({ employees, loading, onAdd, onEdit, onDelete }) {
  function handleDelete(employee) {
    if (window.confirm(`Are you sure you want to delete ${employee.name}?`)) {
      onDelete(employee.id)
    }
  }

  function formatSalary(salary) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(salary)
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—'
    const [year, month, day] = dateStr.split('-')
    return `${month}/${day}/${year}`
  }

  return (
    <div className="employee-list">
      <div className="list-header">
        <div className="list-header-left">
          <h2 className="section-title">Employees</h2>
          <span className="employee-count">{employees.length} {employees.length === 1 ? 'employee' : 'employees'}</span>
        </div>
        <button className="btn btn-primary" onClick={onAdd}>
          + Add Employee
        </button>
      </div>

      {loading ? (
        <div className="loading-state" aria-live="polite">Loading employees…</div>
      ) : employees.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-text">No employees found.</p>
          <button className="btn btn-primary" onClick={onAdd}>Add your first employee</button>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="employee-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Department</th>
                <th>Position</th>
                <th>Salary</th>
                <th>Join Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(employee => (
                <tr key={employee.id}>
                  <td data-label="Name">
                    <span className="employee-name">{employee.name}</span>
                  </td>
                  <td data-label="Email">
                    <a href={`mailto:${employee.email}`} className="email-link">{employee.email}</a>
                  </td>
                  <td data-label="Department">
                    <span className="department-badge">{employee.department}</span>
                  </td>
                  <td data-label="Position">{employee.position}</td>
                  <td data-label="Salary">{formatSalary(employee.salary)}</td>
                  <td data-label="Join Date">{formatDate(employee.joinDate)}</td>
                  <td data-label="Actions" className="actions-cell">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => onEdit(employee)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDelete(employee)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

EmployeeList.propTypes = {
  employees: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number.isRequired,
      name: PropTypes.string.isRequired,
      email: PropTypes.string.isRequired,
      department: PropTypes.string.isRequired,
      position: PropTypes.string.isRequired,
      salary: PropTypes.number,
      joinDate: PropTypes.string,
    })
  ).isRequired,
  loading: PropTypes.bool,
  onAdd: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
}

export default EmployeeList
