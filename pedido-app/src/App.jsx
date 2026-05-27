import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  createCustomField,
  createOrder,
  createProduct,
  createSupplier,
  createUser,
  deleteCustomField,
  deleteProduct,
  deleteSupplier,
  deleteUser,
  exportBackup,
  getBootstrap,
  importBackup,
  updateOrderStatus,
  updateProduct,
  updateSupplier,
  updateUser,
} from './lib/api'

const ACTIVE_USER_KEY = 'osake-active-user-id'

const tabs = [
  { id: 'overview', label: 'Resumen' },
  { id: 'catalog', label: 'Catalogo' },
  { id: 'orders', label: 'Crear pedido' },
  { id: 'history', label: 'Historial' },
  { id: 'admin', label: 'Admin' },
]

function currency(value) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function formatDate(value) {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function sanitizePhone(phone) {
  return String(phone || '').replace(/[^\d]/g, '')
}

function toNonNegativeInteger(value) {
  if (value === '' || value === null || value === undefined) return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.trunc(parsed))
}

function validateEmail(email) {
  if (!email) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function normalizeFieldKey(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

function fieldDefault(type) {
  return type === 'number' ? 0 : ''
}

function normalizeDynamicValues(fields, values = {}) {
  return fields.reduce((accumulator, field) => {
    accumulator[field.id] =
      values[field.id] !== undefined ? values[field.id] : fieldDefault(field.type)
    return accumulator
  }, {})
}

function prepareEntity(entity, values) {
  return entity.reduce((accumulator, field) => {
    accumulator[field.id] = values[field.id] ?? fieldDefault(field.type)
    return accumulator
  }, {})
}

function sanitizeId(payload) {
  if (payload.id === null || payload.id === undefined || payload.id === '') {
    const { ...rest } = payload
    delete rest.id
    return rest
  }
  return payload
}

function createEmptySupplier(customFields) {
  return {
    id: null,
    name: '',
    sellerName: '',
    sellerPhone: '',
    category: '',
    deliveryLeadTime: '',
    deliveryDays: '',
    paymentTerms: '',
    notes: '',
    extraFields: prepareEntity(customFields.supplier, {}),
  }
}

function createEmptyUser(customFields) {
  return {
    id: null,
    name: '',
    role: 'buyer',
    phone: '',
    email: '',
    extraFields: prepareEntity(customFields.user, {}),
  }
}

function createEmptyProduct(customFields, supplierId = '') {
  return {
    id: null,
    supplierId,
    name: '',
    variety: '',
    size: '',
    format: '',
    unitPrice: '',
    deliveryOverride: '',
    minimumOrder: '',
    note: '',
    extraFields: prepareEntity(customFields.product, {}),
  }
}

function createEmptyOrderDraft(customFields, supplierId = '') {
  return {
    supplierId,
    notes: '',
    lines: [],
    extraFields: prepareEntity(customFields.order, {}),
  }
}

function composeOrderText(order, supplier, user) {
  const header = [
    `Hola ${supplier.sellerName || supplier.name}, te envio el pedido de ${supplier.name}.`,
    `Solicitado por: ${user?.name || 'Usuario interno'}`,
    `Fecha: ${formatDate(order.createdAt)}`,
    `Entrega estimada: ${supplier.deliveryLeadTime || 'Por confirmar'}`,
  ]

  const items = order.items.map((item, index) => {
    const variant = [item.variety, item.size].filter(Boolean).join(' / ')
    return `${index + 1}. ${item.name}${variant ? ` - ${variant}` : ''} x ${item.quantity} (${item.format || 'sin formato'})`
  })

  const extras = Object.entries(order.extraFields || {})
    .filter(([, value]) => value !== '' && value !== 0)
    .map(([key, value]) => `${key}: ${value}`)

  const footer = [
    `Total estimado: ${currency(order.total)}`,
    order.notes ? `Observaciones: ${order.notes}` : null,
    extras.length ? `Campos extra: ${extras.join(' | ')}` : null,
  ].filter(Boolean)

  return [...header, '', 'Detalle pedido:', ...items, '', ...footer].join('\n')
}

function getSupplierById(state, supplierId) {
  return state.suppliers.find((supplier) => supplier.id === supplierId) ?? null
}

function getUserById(state, userId) {
  return state.users.find((user) => user.id === userId) ?? null
}

function initialDataState() {
  return {
    users: [],
    suppliers: [],
    orders: [],
    customFields: {
      supplier: [],
      product: [],
      order: [],
      user: [],
    },
  }
}

function App() {
  const [appState, setAppState] = useState(initialDataState)
  const [activeTab, setActiveTab] = useState('overview')
  const [activeUserId, setActiveUserId] = useState(() => localStorage.getItem(ACTIVE_USER_KEY) ?? '')
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [supplierForm, setSupplierForm] = useState(() =>
    createEmptySupplier(initialDataState().customFields),
  )
  const [productForm, setProductForm] = useState(() =>
    createEmptyProduct(initialDataState().customFields, ''),
  )
  const [userForm, setUserForm] = useState(() => createEmptyUser(initialDataState().customFields))
  const [orderDraft, setOrderDraft] = useState(() =>
    createEmptyOrderDraft(initialDataState().customFields, ''),
  )
  const [fieldForm, setFieldForm] = useState({
    entity: 'supplier',
    label: '',
    key: '',
    type: 'text',
    placeholder: '',
  })
  const [search, setSearch] = useState('')
  const [historyFilter, setHistoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [lastCreatedOrderId, setLastCreatedOrderId] = useState(null)
  const [copyFeedback, setCopyFeedback] = useState('')
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState('')
  const [backupFeedback, setBackupFeedback] = useState('')

  async function refreshData(options = {}) {
    const { preserveSelection = true } = options
    const data = await getBootstrap()
    setAppState(data)

    const fallbackUserId = localStorage.getItem(ACTIVE_USER_KEY) || data.users[0]?.id || ''
    setActiveUserId((current) =>
      data.users.some((user) => user.id === current) ? current : fallbackUserId,
    )

    if (!preserveSelection) {
      const nextSupplierId = data.suppliers[0]?.id ?? ''
      setSelectedSupplierId(nextSupplierId)
      setOrderDraft(createEmptyOrderDraft(data.customFields, nextSupplierId))
      setSupplierForm(createEmptySupplier(data.customFields))
      setProductForm(createEmptyProduct(data.customFields, nextSupplierId))
      setUserForm(createEmptyUser(data.customFields))
      return data
    }

    setSelectedSupplierId((current) =>
      data.suppliers.some((supplier) => supplier.id === current)
        ? current
        : (data.suppliers[0]?.id ?? ''),
    )

    setSupplierForm((current) => ({
      ...current,
      extraFields: normalizeDynamicValues(data.customFields.supplier, current.extraFields),
    }))
    setProductForm((current) => ({
      ...current,
      supplierId:
        data.suppliers.some((supplier) => supplier.id === current.supplierId)
          ? current.supplierId
          : (data.suppliers[0]?.id ?? ''),
      extraFields: normalizeDynamicValues(data.customFields.product, current.extraFields),
    }))
    setUserForm((current) => ({
      ...current,
      extraFields: normalizeDynamicValues(data.customFields.user, current.extraFields),
    }))
    setOrderDraft((current) => ({
      ...current,
      supplierId:
        data.suppliers.some((supplier) => supplier.id === current.supplierId)
          ? current.supplierId
          : (data.suppliers[0]?.id ?? ''),
      extraFields: normalizeDynamicValues(data.customFields.order, current.extraFields),
    }))

    return data
  }

  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        setError('')
        await refreshData({ preserveSelection: false })
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  useEffect(() => {
    if (activeUserId) {
      localStorage.setItem(ACTIVE_USER_KEY, activeUserId)
    }
  }, [activeUserId])

  const activeUser = useMemo(() => getUserById(appState, activeUserId), [appState, activeUserId])
  const isAdmin = activeUser?.role === 'admin'
  const selectedSupplier = useMemo(
    () => getSupplierById(appState, selectedSupplierId),
    [appState, selectedSupplierId],
  )

  const deferredSearch = useDeferredValue(search)
  const filteredProducts = useMemo(() => {
    if (!selectedSupplier) return []
    const source = selectedSupplier.products || []
    if (!deferredSearch.trim()) return source
    const needle = deferredSearch.toLowerCase()
    return source.filter((product) =>
      [product.name, product.variety, product.size, product.format, product.note]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [deferredSearch, selectedSupplier])

  const currentOrderTotal = orderDraft.lines.reduce(
    (total, line) => total + Number(line.unitPrice || 0) * Number(line.quantity || 0),
    0,
  )

  const lastCreatedOrder = appState.orders.find((order) => order.id === lastCreatedOrderId) ?? null
  const latestOrder = appState.orders[0] ?? null
  const messageTargetSupplier = lastCreatedOrder
    ? getSupplierById(appState, lastCreatedOrder.supplierId)
    : selectedSupplier
  const messageText =
    lastCreatedOrder && messageTargetSupplier && activeUser
      ? composeOrderText(lastCreatedOrder, messageTargetSupplier, activeUser)
      : ''

  const visibleOrders = appState.orders.filter((order) => {
    const bySupplier = historyFilter === 'all' || order.supplierId === historyFilter
    const byStatus = statusFilter === 'all' || order.status === statusFilter
    return bySupplier && byStatus
  })

  const totalSuppliers = appState.suppliers.length
  const totalProducts = appState.suppliers.reduce(
    (count, supplier) => count + supplier.products.length,
    0,
  )

  async function runMutation(action) {
    try {
      setMutating(true)
      setError('')
      await action()
      await refreshData()
    } catch (mutationError) {
      setError(mutationError.message)
    } finally {
      setMutating(false)
    }
  }

  function handleSupplierFormChange(event) {
    const { name, value } = event.target
    setSupplierForm((current) => ({ ...current, [name]: value }))
  }

  function handleProductFormChange(event) {
    const { name, value } = event.target
    setProductForm((current) => ({ ...current, [name]: value }))
  }

  function handleUserFormChange(event) {
    const { name, value } = event.target
    setUserForm((current) => ({ ...current, [name]: value }))
  }

  function handleExtraFieldChange(setter, fieldId, value) {
    setter((current) => ({
      ...current,
      extraFields: {
        ...current.extraFields,
        [fieldId]: value,
      },
    }))
  }

  async function saveSupplier() {
    if (!supplierForm.name.trim()) {
      setError('Ingresa el nombre del proveedor')
      return
    }

    const payload = sanitizeId({
      ...supplierForm,
      extraFields: normalizeDynamicValues(appState.customFields.supplier, supplierForm.extraFields),
    })

    await runMutation(async () => {
      if (supplierForm.id) {
        await updateSupplier(supplierForm.id, payload)
      } else {
        await createSupplier(payload)
      }
      setSupplierForm(createEmptySupplier(appState.customFields))
    })
  }

  function editSupplier(supplier) {
    setSupplierForm({
      ...supplier,
      extraFields: normalizeDynamicValues(appState.customFields.supplier, supplier.extraFields),
    })
    setActiveTab('catalog')
  }

  async function removeSupplier(supplierId) {
    await runMutation(async () => {
      await deleteSupplier(supplierId)
      if (selectedSupplierId === supplierId) {
        setSelectedSupplierId('')
        setOrderDraft(createEmptyOrderDraft(appState.customFields, ''))
      }
    })
  }

  async function saveProduct() {
    if (!selectedSupplierId) {
      setError('Selecciona un proveedor antes de crear productos')
      return
    }

    if (!productForm.name.trim()) {
      setError('Ingresa el nombre del producto')
      return
    }

    const unitPrice = toNonNegativeInteger(productForm.unitPrice)
    const minimumOrder = toNonNegativeInteger(productForm.minimumOrder)
    const payload = sanitizeId({
      ...productForm,
      supplierId: selectedSupplierId,
      unitPrice,
      minimumOrder,
      extraFields: normalizeDynamicValues(appState.customFields.product, productForm.extraFields),
    })

    await runMutation(async () => {
      if (productForm.id) {
        await updateProduct(productForm.id, payload)
      } else {
        await createProduct(payload)
      }
      setProductForm(createEmptyProduct(appState.customFields, selectedSupplierId))
    })
  }

  function editProduct(product) {
    setProductForm({
      ...product,
      supplierId: selectedSupplierId,
      extraFields: normalizeDynamicValues(appState.customFields.product, product.extraFields),
    })
    setActiveTab('catalog')
  }

  async function removeProduct(productId) {
    await runMutation(async () => {
      await deleteProduct(productId)
      setOrderDraft((current) => ({
        ...current,
        lines: current.lines.filter((line) => line.productId !== productId),
      }))
    })
  }

  function addLine(product) {
    setOrderDraft((current) => {
      const existing = current.lines.find((line) => line.productId === product.id)
      const lines = existing
        ? current.lines.map((line) =>
            line.productId === product.id
              ? { ...line, quantity: Number(line.quantity || 0) + 1 }
              : line,
          )
        : [
            ...current.lines,
            {
              productId: product.id,
              name: product.name,
              variety: product.variety,
              size: product.size,
              format: product.format,
              unitPrice: Number(product.unitPrice || 0),
              quantity: Math.max(Number(product.minimumOrder || 0), 1),
            },
          ]
      return { ...current, supplierId: selectedSupplierId, lines }
    })
  }

  function updateLineQuantity(productId, quantity) {
    setOrderDraft((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.productId === productId
          ? { ...line, quantity: toNonNegativeInteger(quantity) }
          : line,
      ),
    }))
  }

  function removeLine(productId) {
    setOrderDraft((current) => ({
      ...current,
      lines: current.lines.filter((line) => line.productId !== productId),
    }))
  }

  async function finalizeOrder() {
    if (!selectedSupplier) {
      setError('Selecciona un proveedor para crear el pedido')
      return
    }

    if (!activeUserId) {
      setError('Selecciona un usuario activo antes de guardar el pedido')
      return
    }

    const items = orderDraft.lines
      .map((line) => ({
        ...line,
        quantity: toNonNegativeInteger(line.quantity),
        unitPrice: toNonNegativeInteger(line.unitPrice),
      }))
      .filter((line) => line.quantity > 0)

    if (!items.length) {
      setError('Agrega al menos un producto con cantidad mayor a cero')
      return
    }

    await runMutation(async () => {
      const created = await createOrder({
        supplierId: selectedSupplier.id,
        createdById: activeUserId,
        status: 'Pendiente',
        notes: orderDraft.notes,
        extraFields: normalizeDynamicValues(appState.customFields.order, orderDraft.extraFields),
        items,
        total: currentOrderTotal,
      })
      setLastCreatedOrderId(created.id)
      setOrderDraft(createEmptyOrderDraft(appState.customFields, selectedSupplier.id))
      setCopyFeedback('')
      setActiveTab('history')
    })
  }

  async function copyMessage() {
    if (!messageText) return
    try {
      await navigator.clipboard.writeText(messageText)
      setCopyFeedback('Texto copiado')
      window.setTimeout(() => setCopyFeedback(''), 1800)
    } catch {
      setError('No se pudo copiar el texto en este navegador')
    }
  }

  function openWhatsApp() {
    if (!messageTargetSupplier || !messageText) return
    const phone = sanitizePhone(messageTargetSupplier.sellerPhone)
    if (!phone) {
      setError('El proveedor no tiene WhatsApp registrado')
      return
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(messageText)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function saveUser() {
    if (!userForm.name.trim()) {
      setError('Ingresa el nombre del usuario')
      return
    }

    if (!validateEmail(userForm.email.trim())) {
      setError('Ingresa un correo valido')
      return
    }

    const payload = sanitizeId({
      ...userForm,
      email: userForm.email.trim(),
      extraFields: normalizeDynamicValues(appState.customFields.user, userForm.extraFields),
    })

    await runMutation(async () => {
      if (userForm.id) {
        await updateUser(userForm.id, payload)
      } else {
        await createUser(payload)
      }
      setUserForm(createEmptyUser(appState.customFields))
    })
  }

  function editUser(user) {
    setUserForm({
      ...user,
      extraFields: normalizeDynamicValues(appState.customFields.user, user.extraFields),
    })
    setActiveTab('admin')
  }

  async function removeUser(userId) {
    if (userId === activeUserId) return
    await runMutation(async () => {
      await deleteUser(userId)
    })
  }

  async function addDynamicField() {
    if (!fieldForm.label.trim()) {
      setError('Ingresa la etiqueta del campo dinamico')
      return
    }

    const normalizedKey = normalizeFieldKey(fieldForm.key)
    if (!normalizedKey) {
      setError('La clave solo puede usar letras, numeros y guion bajo')
      return
    }

    if (appState.customFields[fieldForm.entity].some((field) => field.id === normalizedKey)) {
      setError('Ya existe una clave igual en esa seccion')
      return
    }

    await runMutation(async () => {
      await createCustomField({
        entity: fieldForm.entity,
        label: fieldForm.label.trim(),
        key: normalizedKey,
        fieldType: fieldForm.type,
        placeholder: fieldForm.placeholder.trim(),
      })
      setFieldForm({
        entity: 'supplier',
        label: '',
        key: '',
        type: 'text',
        placeholder: '',
      })
    })
  }

  async function removeDynamicField(entity, fieldId) {
    await runMutation(async () => {
      await deleteCustomField(entity, fieldId)
    })
  }

  async function downloadBackup() {
    try {
      setBackupFeedback('')
      const payload = await exportBackup()
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `osake-backup-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      setBackupFeedback('Respaldo exportado')
    } catch (backupError) {
      setError(backupError.message)
    }
  }

  async function handleImportBackup(event) {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      setBackupFeedback('')
      const payload = JSON.parse(await file.text())
      await importBackup(payload)
      await refreshData({ preserveSelection: false })
      setBackupFeedback('Respaldo importado correctamente')
    } catch (backupError) {
      setError(backupError.message || 'No se pudo importar el respaldo')
    } finally {
      event.target.value = ''
    }
  }

  async function changeOrderStatus(orderId, status) {
    await runMutation(async () => {
      await updateOrderStatus(orderId, status)
    })
  }

  if (loading) {
    return <div className="state-screen">Cargando datos del sistema...</div>
  }

  if (error && !appState.users.length && !appState.suppliers.length) {
    return <div className="state-screen">No se pudo cargar la aplicacion: {error}</div>
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Osake Order Studio</p>
          <h1 className="title-small">Sistema de inventario</h1>
        </div>

        <div className="panel compact">
          <label className="label">Usuario activo</label>
          <select value={activeUserId} onChange={(event) => setActiveUserId(event.target.value)}>
            {appState.users.map((user) => (
              <option key={user.id} value={user.id}>
                {`${user.name} - ${user.role === 'admin' ? 'Admin' : 'Compras'}`}
              </option>
            ))}
          </select>
          <div className="pill-row">
            <span className="pill">{totalSuppliers} proveedores</span>
            <span className="pill">{totalProducts} productos</span>
            <span className="pill">{appState.orders.length} pedidos</span>
          </div>
        </div>

        <div className="supplier-list">
          {appState.suppliers.map((supplier) => (
            <button
              key={supplier.id}
              type="button"
              className={`supplier-card ${selectedSupplierId === supplier.id ? 'selected' : ''}`}
              onClick={() => {
                startTransition(() => {
                  setSelectedSupplierId(supplier.id)
                  setOrderDraft((current) => ({ ...current, supplierId: supplier.id }))
                  setProductForm((current) => ({ ...current, supplierId: supplier.id }))
                })
              }}
            >
              <span>{supplier.name}</span>
              <small>{`${supplier.sellerName} - ${supplier.deliveryLeadTime || 'Sin lead time'}`}</small>
            </button>
          ))}
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <nav className="tabs">
            {tabs
              .filter((tab) => isAdmin || tab.id !== 'admin')
              .map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={activeTab === tab.id ? 'active' : ''}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
          </nav>
          {mutating && <span className="pill solid">Guardando...</span>}
        </header>

        {error && <div className="error-banner">{error}</div>}

        {activeTab === 'overview' && (
          <section className="grid two-up">
            <article className="panel home-summary">
              <div className="hero-copy">
                <h2>Resumen del catalogo</h2>
                <div className="summary-metrics">
                  <div className="metric-card">
                    <span className="label">Proveedores</span>
                    <strong>{totalSuppliers}</strong>
                  </div>
                  <div className="metric-card">
                    <span className="label">Productos</span>
                    <strong>{totalProducts}</strong>
                  </div>
                  <div className="metric-card">
                    <span className="label">Pedidos</span>
                    <strong>{appState.orders.length}</strong>
                  </div>
                </div>
              </div>
            </article>

            <article className="panel">
              <h2>Ultimo pedido realizado</h2>
              {latestOrder ? (
                <div className="latest-order">
                  <div className="latest-order-head">
                    <strong>{getSupplierById(appState, latestOrder.supplierId)?.name || 'Proveedor'}</strong>
                    <span className="pill">{latestOrder.status}</span>
                  </div>
                  <p className="muted">
                    {`${getUserById(appState, latestOrder.createdById)?.name || 'Usuario'} - ${formatDate(latestOrder.createdAt)}`}
                  </p>
                  <ul className="clean-list">
                    {latestOrder.items.slice(0, 4).map((item) => (
                      <li key={`${latestOrder.id}-${item.productId}`}>
                        {item.name} x {item.quantity}
                      </li>
                    ))}
                  </ul>
                  <strong>{currency(latestOrder.total)}</strong>
                </div>
              ) : (
                <p className="muted">Todavia no hay pedidos registrados.</p>
              )}
            </article>
          </section>
        )}

        {activeTab === 'catalog' && (
          <section className="grid two-up">
            <article className="panel">
              <div className="section-head">
                <h2>Proveedor / vendedor</h2>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setSupplierForm(createEmptySupplier(appState.customFields))}
                >
                  Nuevo proveedor
                </button>
              </div>
              <div className="form-grid">
                <Field label="Proveedor" name="name" value={supplierForm.name} onChange={handleSupplierFormChange} />
                <Field label="Vendedor" name="sellerName" value={supplierForm.sellerName} onChange={handleSupplierFormChange} />
                <Field label="WhatsApp vendedor" name="sellerPhone" value={supplierForm.sellerPhone} onChange={handleSupplierFormChange} />
                <Field label="Categoria" name="category" value={supplierForm.category} onChange={handleSupplierFormChange} />
                <Field label="Tiempo de entrega" name="deliveryLeadTime" value={supplierForm.deliveryLeadTime} onChange={handleSupplierFormChange} />
                <Field label="Dias de entrega" name="deliveryDays" value={supplierForm.deliveryDays} onChange={handleSupplierFormChange} />
                <Field label="Pago" name="paymentTerms" value={supplierForm.paymentTerms} onChange={handleSupplierFormChange} />
                <TextArea label="Notas" name="notes" value={supplierForm.notes} onChange={handleSupplierFormChange} />
                <DynamicFieldGroup
                  fields={appState.customFields.supplier}
                  values={supplierForm.extraFields}
                  onChange={(fieldId, value) => handleExtraFieldChange(setSupplierForm, fieldId, value)}
                />
              </div>
              <button type="button" className="primary" onClick={saveSupplier}>
                Guardar proveedor
              </button>

              <div className="stack">
                {appState.suppliers.map((supplier) => (
                  <div key={supplier.id} className="list-row">
                    <div>
                      <strong>{supplier.name}</strong>
                      <small>{supplier.sellerName}</small>
                    </div>
                    {isAdmin && (
                      <div className="row-actions">
                        <button type="button" className="ghost" onClick={() => editSupplier(supplier)}>
                          Editar
                        </button>
                        <button type="button" className="ghost danger" onClick={() => removeSupplier(supplier.id)}>
                          Eliminar
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="section-head">
                <div>
                  <h2>Catalogo de {selectedSupplier?.name || 'proveedor'}</h2>
                  <p className="muted">
                    Maneja producto, variedad, tamano, formato, minimo y precio.
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setProductForm(createEmptyProduct(appState.customFields, selectedSupplierId))}
                >
                  Nuevo producto
                </button>
              </div>
              <div className="form-grid">
                <Field label="Producto" name="name" value={productForm.name} onChange={handleProductFormChange} />
                <Field label="Variedad" name="variety" value={productForm.variety} onChange={handleProductFormChange} />
                <Field label="Tamano" name="size" value={productForm.size} onChange={handleProductFormChange} />
                <Field label="Formato" name="format" value={productForm.format} onChange={handleProductFormChange} />
                <Field label="Precio unitario" name="unitPrice" type="number" value={productForm.unitPrice} onChange={handleProductFormChange} />
                <Field label="Minimo" name="minimumOrder" type="number" value={productForm.minimumOrder} onChange={handleProductFormChange} />
                <Field label="Override entrega" name="deliveryOverride" value={productForm.deliveryOverride} onChange={handleProductFormChange} />
                <TextArea label="Nota SKU" name="note" value={productForm.note} onChange={handleProductFormChange} />
                <DynamicFieldGroup
                  fields={appState.customFields.product}
                  values={productForm.extraFields}
                  onChange={(fieldId, value) => handleExtraFieldChange(setProductForm, fieldId, value)}
                />
              </div>
              <button type="button" className="primary" onClick={saveProduct}>
                Guardar producto
              </button>

              <div className="product-stack">
                {selectedSupplier?.products.map((product) => (
                  <div key={product.id} className="product-card">
                    <div>
                      <strong>{product.name}</strong>
                      <p>{[product.variety, product.size, product.format].filter(Boolean).join(' - ')}</p>
                      <small>{currency(product.unitPrice)}</small>
                    </div>
                    {isAdmin && (
                      <div className="row-actions">
                        <button type="button" className="ghost" onClick={() => editProduct(product)}>
                          Editar
                        </button>
                        <button type="button" className="ghost danger" onClick={() => removeProduct(product.id)}>
                          Eliminar
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </article>
          </section>
        )}

        {activeTab === 'orders' && (
          <section className="grid order-layout">
            <article className="panel">
              <div className="section-head">
                <div>
                  <h2>Selecciona productos</h2>
                  <p className="muted">Busca por nombre, variedad, tamano o formato.</p>
                </div>
                <input
                  className="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar producto..."
                />
              </div>

              <div className="catalog-grid">
                {filteredProducts.map((product) => (
                  <button key={product.id} type="button" className="catalog-card" onClick={() => addLine(product)}>
                    <span>{product.name}</span>
                    <small>{[product.variety, product.size].filter(Boolean).join(' - ')}</small>
                    <small>{product.format}</small>
                    <strong>{currency(product.unitPrice)}</strong>
                  </button>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="section-head">
                <div>
                  <h2>Pedido actual</h2>
                  <p className="muted">Vendedor: {selectedSupplier?.sellerName || 'sin seleccionar'}</p>
                </div>
                <span className="pill solid">{currency(currentOrderTotal)}</span>
              </div>

              <div className="stack">
                {orderDraft.lines.map((line) => (
                  <div key={line.productId} className="line-item">
                    <div>
                      <strong>{line.name}</strong>
                      <small>{[line.variety, line.size, line.format].filter(Boolean).join(' - ')}</small>
                    </div>
                    <div className="line-controls">
                      <input
                        type="number"
                        min="0"
                        value={line.quantity}
                        onChange={(event) => updateLineQuantity(line.productId, event.target.value)}
                      />
                      <span>{currency(line.unitPrice * line.quantity)}</span>
                      <button type="button" className="ghost danger" onClick={() => removeLine(line.productId)}>
                        Quitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <TextArea
                label="Observaciones del pedido"
                name="notes"
                value={orderDraft.notes}
                onChange={(event) => setOrderDraft((current) => ({ ...current, notes: event.target.value }))}
              />
              <DynamicFieldGroup
                fields={appState.customFields.order}
                values={orderDraft.extraFields}
                onChange={(fieldId, value) =>
                  setOrderDraft((current) => ({
                    ...current,
                    extraFields: {
                      ...current.extraFields,
                      [fieldId]: value,
                    },
                  }))
                }
              />
              <button type="button" className="primary" onClick={finalizeOrder}>
                Finalizar y guardar en historial
              </button>
            </article>
          </section>
        )}

        {activeTab === 'history' && (
          <section className="grid two-up">
            <article className="panel">
              <div className="section-head">
                <h2>Historial general</h2>
                <div className="filter-row">
                  <select value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)}>
                    <option value="all">Todos los proveedores</option>
                    {appState.suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="all">Todos los estados</option>
                    <option value="Pendiente">Pendiente</option>
                    <option value="Enviado">Enviado</option>
                    <option value="Recibido">Recibido</option>
                  </select>
                </div>
              </div>

              <div className="history-stack">
                {visibleOrders.map((order) => {
                  const supplier = getSupplierById(appState, order.supplierId)
                  const creator = getUserById(appState, order.createdById)
                  return (
                    <div key={order.id} className={`history-card ${lastCreatedOrderId === order.id ? 'accented' : ''}`}>
                      <div className="history-head">
                        <div>
                          <strong>{supplier?.name}</strong>
                          <small>{`${creator?.name || ''} - ${formatDate(order.createdAt)}`}</small>
                        </div>
                        <select value={order.status} onChange={(event) => changeOrderStatus(order.id, event.target.value)}>
                          <option value="Pendiente">Pendiente</option>
                          <option value="Enviado">Enviado</option>
                          <option value="Recibido">Recibido</option>
                        </select>
                      </div>
                      <ul className="clean-list">
                        {order.items.map((item) => (
                          <li key={`${order.id}-${item.productId}`}>
                            {item.name} x {item.quantity}
                          </li>
                        ))}
                      </ul>
                      <strong>{currency(order.total)}</strong>
                    </div>
                  )
                })}
              </div>
            </article>

            <article className="panel">
              <div className="section-head">
                <div>
                  <h2>Texto para WhatsApp</h2>
                  <p className="muted">Se genera desde el ultimo pedido guardado.</p>
                </div>
                <div className="row-actions">
                  <button type="button" className="ghost" onClick={copyMessage}>
                    Copiar texto
                  </button>
                  <button type="button" className="primary" onClick={openWhatsApp}>
                    Abrir WhatsApp
                  </button>
                </div>
              </div>
              <pre className="message-box">{messageText || 'Todavia no has generado un pedido.'}</pre>
              {copyFeedback && <p className="feedback">{copyFeedback}</p>}
            </article>
          </section>
        )}

        {activeTab === 'admin' && isAdmin && (
          <section className="grid two-up">
            <article className="panel">
              <div className="section-head">
                <h2>Usuarios</h2>
                <button type="button" className="ghost" onClick={() => setUserForm(createEmptyUser(appState.customFields))}>
                  Nuevo usuario
                </button>
              </div>
              <div className="form-grid">
                <Field label="Nombre" name="name" value={userForm.name} onChange={handleUserFormChange} />
                <Field label="Telefono" name="phone" value={userForm.phone} onChange={handleUserFormChange} />
                <Field label="Correo" name="email" value={userForm.email} onChange={handleUserFormChange} />
                <label className="field">
                  <span>Rol</span>
                  <select name="role" value={userForm.role} onChange={handleUserFormChange}>
                    <option value="buyer">Compras</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <DynamicFieldGroup
                  fields={appState.customFields.user}
                  values={userForm.extraFields}
                  onChange={(fieldId, value) => handleExtraFieldChange(setUserForm, fieldId, value)}
                />
              </div>
              <button type="button" className="primary" onClick={saveUser}>
                Guardar usuario
              </button>

              <div className="stack">
                {appState.users.map((user) => (
                  <div key={user.id} className="list-row">
                    <div>
                      <strong>{user.name}</strong>
                      <small>{user.role}</small>
                    </div>
                    <div className="row-actions">
                      <button type="button" className="ghost" onClick={() => editUser(user)}>
                        Editar
                      </button>
                      <button type="button" className="ghost danger" disabled={user.id === activeUserId} onClick={() => removeUser(user.id)}>
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="section-head">
                <div>
                  <h2>Campos dinamicos</h2>
                  <p className="muted">Agrega nuevos campos sin tocar el formulario completo.</p>
                </div>
              </div>
              <div className="info-box">
                <p>
                  <strong>Proveedor</strong>: este campo aplica a los datos del proveedor.
                </p>
                <p>
                  <strong>Texto de ayuda</strong>: es el ejemplo que aparece dentro del campo antes de escribir.
                </p>
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>Se aplica a</span>
                  <select value={fieldForm.entity} onChange={(event) => setFieldForm((current) => ({ ...current, entity: event.target.value }))}>
                    <option value="supplier">Proveedor</option>
                    <option value="product">Producto</option>
                    <option value="order">Pedido</option>
                    <option value="user">Usuario</option>
                  </select>
                </label>
                <Field label="Etiqueta" name="label" value={fieldForm.label} onChange={(event) => setFieldForm((current) => ({ ...current, label: event.target.value }))} />
                <Field label="Clave" name="key" value={fieldForm.key} onChange={(event) => setFieldForm((current) => ({ ...current, key: event.target.value }))} />
                <label className="field">
                  <span>Tipo</span>
                  <select value={fieldForm.type} onChange={(event) => setFieldForm((current) => ({ ...current, type: event.target.value }))}>
                    <option value="text">Texto</option>
                    <option value="number">Numero</option>
                    <option value="textarea">Area de texto</option>
                  </select>
                </label>
                <Field label="Texto de ayuda" name="placeholder" value={fieldForm.placeholder} onChange={(event) => setFieldForm((current) => ({ ...current, placeholder: event.target.value }))} />
              </div>
              <button type="button" className="primary" onClick={addDynamicField}>
                Agregar campo
              </button>
              <div className="backup-tools">
                <button type="button" className="ghost" onClick={downloadBackup}>
                  Exportar respaldo
                </button>
                <label className="ghost upload-button">
                  Importar respaldo
                  <input type="file" accept="application/json" onChange={handleImportBackup} />
                </label>
              </div>
              {backupFeedback && <p className="feedback">{backupFeedback}</p>}

              <div className="stack">
                {Object.entries(appState.customFields).map(([entity, fields]) => (
                  <div key={entity} className="fieldset-box">
                    <strong>{entity}</strong>
                    {fields.length === 0 && <small>Sin campos extra</small>}
                    {fields.map((field) => (
                      <div key={field.id} className="list-row">
                        <div>
                          <strong>{field.label}</strong>
                          <small>{`${field.id} - ${field.type}`}</small>
                        </div>
                        <button type="button" className="ghost danger" onClick={() => removeDynamicField(entity, field.id)}>
                          Eliminar
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </article>
          </section>
        )}
      </main>
    </div>
  )
}

function DynamicFieldGroup({ fields, values, onChange }) {
  if (!fields.length) return null

  return (
    <>
      {fields.map((field) =>
        field.type === 'textarea' ? (
          <label className="field field-wide" key={field.id}>
            <span>{field.label}</span>
            <textarea
              rows="3"
              value={values[field.id] ?? ''}
              placeholder={field.placeholder}
              onChange={(event) => onChange(field.id, event.target.value)}
            />
          </label>
        ) : (
          <label className="field" key={field.id}>
            <span>{field.label}</span>
            <input
              type={field.type}
              value={values[field.id] ?? ''}
              placeholder={field.placeholder}
              min={field.type === 'number' ? '0' : undefined}
              onChange={(event) =>
                onChange(
                  field.id,
                  field.type === 'number'
                    ? toNonNegativeInteger(event.target.value)
                    : event.target.value,
                )
              }
            />
          </label>
        ),
      )}
    </>
  )
}

function Field({ label, name, value, onChange, type = 'text' }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} name={name} value={value ?? ''} onChange={onChange} />
    </label>
  )
}

function TextArea({ label, name, value, onChange }) {
  return (
    <label className="field field-wide">
      <span>{label}</span>
      <textarea rows="3" name={name} value={value ?? ''} onChange={onChange} />
    </label>
  )
}

export default App
