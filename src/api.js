const BASE = '/api/employees'

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (res.status === 204) return null
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

/** GET /api/employees */
export function fetchEmployees() {
  return request(BASE)
}

/** GET /api/employees/:id */
export function fetchEmployee(id) {
  return request(`${BASE}/${id}`)
}

/** POST /api/employees */
export function createEmployee(payload) {
  return request(BASE, { method: 'POST', body: JSON.stringify(payload) })
}

/** PUT /api/employees/:id */
export function updateEmployee(id, payload) {
  return request(`${BASE}/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
}

/** DELETE /api/employees/:id */
export function deleteEmployee(id) {
  return request(`${BASE}/${id}`, { method: 'DELETE' })
}
