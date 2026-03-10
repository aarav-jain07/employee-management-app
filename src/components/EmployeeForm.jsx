import { useState } from 'react'
import PropTypes from 'prop-types'

const EMPTY_FORM = {
  name: '',
  email: '',
  department: '',
  position: '',
  salary: '',
  joinDate: '',
  phone: '',
  employmentType: 'Full-time',
  status: 'Active',
}

function EmployeeForm({ mode, employee, onSubmit, onCancel }) {
  const [formData, setFormData] = useState(
    mode === 'edit' && employee
      ? { ...employee, salary: String(employee.salary), phone: employee.phone || '', employmentType: employee.employmentType || 'Full-time', status: employee.status || 'Active' }
      : EMPTY_FORM
  )
  const [errors, setErrors] = useState({})

  function validate(data) {
    const errs = {}
    if (!data.name.trim()) errs.name = 'Name is required.'
    if (!data.email.trim()) {
      errs.email = 'Email is required.'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      errs.email = 'Enter a valid email address.'
    }
    if (!data.department.trim()) errs.department = 'Department is required.'
    if (!data.position.trim()) errs.position = 'Position is required.'
    if (data.salary !== '' && isNaN(Number(data.salary))) {
      errs.salary = 'Salary must be a number.'
    }
    if (data.phone && !/^\+?[\d\s\-().]{7,20}$/.test(data.phone)) {
      errs.phone = 'Enter a valid phone number.'
    }
    return errs
  }

  function handleChange(e) {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: undefined }))
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    const errs = validate(formData)
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    onSubmit({
      ...formData,
      salary: formData.salary === '' ? 0 : Number(formData.salary),
    })
  }

  const isEdit = mode === 'edit'

  return (
    <div className="form-container">
      <div className="form-header">
        <h2 className="section-title">{isEdit ? 'Edit Employee' : 'Add New Employee'}</h2>
        <p className="form-subtitle">
          {isEdit ? 'Update the employee details below.' : 'Fill in the details to add a new employee.'}
        </p>
      </div>

      <form className="employee-form" onSubmit={handleSubmit} noValidate>
        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="name" className="form-label">
              Full Name <span className="required">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              className={`form-input${errors.name ? ' input-error' : ''}`}
              value={formData.name}
              onChange={handleChange}
              placeholder="e.g. Jane Doe"
            />
            {errors.name && <span className="error-message">{errors.name}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="email" className="form-label">
              Email Address <span className="required">*</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className={`form-input${errors.email ? ' input-error' : ''}`}
              value={formData.email}
              onChange={handleChange}
              placeholder="e.g. jane@example.com"
            />
            {errors.email && <span className="error-message">{errors.email}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="department" className="form-label">
              Department <span className="required">*</span>
            </label>
            <input
              id="department"
              name="department"
              type="text"
              className={`form-input${errors.department ? ' input-error' : ''}`}
              value={formData.department}
              onChange={handleChange}
              placeholder="e.g. Engineering"
            />
            {errors.department && <span className="error-message">{errors.department}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="position" className="form-label">
              Position <span className="required">*</span>
            </label>
            <input
              id="position"
              name="position"
              type="text"
              className={`form-input${errors.position ? ' input-error' : ''}`}
              value={formData.position}
              onChange={handleChange}
              placeholder="e.g. Senior Developer"
            />
            {errors.position && <span className="error-message">{errors.position}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="salary" className="form-label">Salary (USD)</label>
            <input
              id="salary"
              name="salary"
              type="number"
              min="0"
              className={`form-input${errors.salary ? ' input-error' : ''}`}
              value={formData.salary}
              onChange={handleChange}
              placeholder="e.g. 80000"
            />
            {errors.salary && <span className="error-message">{errors.salary}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="joinDate" className="form-label">Join Date</label>
            <input
              id="joinDate"
              name="joinDate"
              type="date"
              className="form-input"
              value={formData.joinDate}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label htmlFor="phone" className="form-label">Phone Number</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              className={`form-input${errors.phone ? ' input-error' : ''}`}
              value={formData.phone}
              onChange={handleChange}
              placeholder="e.g. 555-123-4567"
            />
            {errors.phone && <span className="error-message">{errors.phone}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="employmentType" className="form-label">Employment Type</label>
            <select
              id="employmentType"
              name="employmentType"
              className="form-input"
              value={formData.employmentType}
              onChange={handleChange}
            >
              <option value="Full-time">Full-time</option>
              <option value="Part-time">Part-time</option>
              <option value="Contract">Contract</option>
              <option value="Intern">Intern</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="status" className="form-label">Status</label>
            <select
              id="status"
              name="status"
              className="form-input"
              value={formData.status}
              onChange={handleChange}
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
              <option value="On Leave">On Leave</option>
            </select>
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {isEdit ? 'Save Changes' : 'Add Employee'}
          </button>
        </div>
      </form>
    </div>
  )
}

EmployeeForm.propTypes = {
  mode: PropTypes.oneOf(['add', 'edit']).isRequired,
  /** Required when mode is 'edit' */
  employee: PropTypes.shape({
    id: PropTypes.number.isRequired,
    name: PropTypes.string,
    email: PropTypes.string,
    department: PropTypes.string,
    position: PropTypes.string,
    salary: PropTypes.number,
    joinDate: PropTypes.string,
    phone: PropTypes.string,
    employmentType: PropTypes.string,
    status: PropTypes.string,
  }),
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
}

export default EmployeeForm
