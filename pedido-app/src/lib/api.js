const API_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/api`

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || 'Error en la API')
  }

  if (response.status === 204) return null
  return response.json()
}

export function getBootstrap() {
  return request('/bootstrap')
}

export function createUser(payload) {
  return request('/users', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateUser(id, payload) {
  return request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
}

export function deleteUser(id) {
  return request(`/users/${id}`, { method: 'DELETE' })
}

export function createSupplier(payload) {
  return request('/suppliers', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateSupplier(id, payload) {
  return request(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
}

export function deleteSupplier(id) {
  return request(`/suppliers/${id}`, { method: 'DELETE' })
}

export function createProduct(payload) {
  return request('/products', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateProduct(id, payload) {
  return request(`/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
}

export function deleteProduct(id) {
  return request(`/products/${id}`, { method: 'DELETE' })
}

export function createOrder(payload) {
  return request('/orders', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateOrderStatus(id, status) {
  return request(`/orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function createCustomField(payload) {
  return request('/custom-fields', { method: 'POST', body: JSON.stringify(payload) })
}

export function deleteCustomField(entity, key) {
  return request(`/custom-fields/${entity}/${key}`, { method: 'DELETE' })
}
