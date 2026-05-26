import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import './App.css'
import { seedState } from './data/seed'

const STORAGE_KEY = 'osake-order-studio-v1'

const tabs = [
  { id: 'overview', label: 'Resumen' },
  { id: 'catalog', label: 'Catalogo' },
  { id: 'orders', label: 'Crear pedido' },
  { id: 'history', label: 'Historial' },
  { id: 'admin', label: 'Admin' },
]

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

function cloneSeed() {
  return JSON.parse(JSON.stringify(seedState))
}

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : cloneSeed()
  } catch {
    return cloneSeed()
  }
}

function saveState(state) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function getSupplierById(state, supplierId) {
  return state.suppliers.find((supplier) => supplier.id === supplierId) ?? null
}

function getUserById(state, userId) {
  return state.users.find((user) => user.id === userId) ?? null
}

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

function createEmptyOrderDraft(customFields) {
  return {
    supplierId: '',
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

function App() {
  const [bootState] = useState(() => loadState())
  const [appState, setAppState] = useState(bootState)
  const [activeTab, setActiveTab] = useState('overview')
  const [activeUserId, setActiveUserId] = useState(bootState.activeUserId)
  const [selectedSupplierId, setSelectedSupplierId] = useState(bootState.suppliers[0]?.id ?? '')
  const [supplierForm, setSupplierForm] = useState(() =>
    createEmptySupplier(bootState.customFields),
  )
  const [productForm, setProductForm] = useState(() =>
    createEmptyProduct(bootState.customFields, bootState.suppliers[0]?.id ?? ''),
  )
  const [userForm, setUserForm] = useState(() => createEmptyUser(bootState.customFields))
  const [orderDraft, setOrderDraft] = useState(() => ({
    ...createEmptyOrderDraft(bootState.customFields),
    supplierId: bootState.suppliers[0]?.id ?? '',
  }))
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

  useEffect(() => {
    saveState({ ...appState, activeUserId })
  }, [activeUserId, appState])

  const activeUser = useMemo(() => getUserById(appState, activeUserId), [appState, activeUserId])
  const isAdmin = activeUser?.role === 'admin'
  const selectedSupplier =
    appState.suppliers.find((supplier) => supplier.id === selectedSupplierId) ?? null

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
  const messageTargetSupplier = lastCreatedOrder
    ? getSupplierById(appState, lastCreatedOrder.supplierId)
    : selectedSupplier
  const messageText =
    lastCreatedOrder && messageTargetSupplier && activeUser
      ? composeOrderText(lastCreatedOrder, messageTargetSupplier, activeUser)
      : ''

  function updateState(updater) {
    setAppState((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      saveState({ ...next, activeUserId })
      return next
    })
  }

  function syncFormsWithCustomFields(nextState) {
    setSupplierForm((current) => ({
      ...current,
      extraFields: normalizeDynamicValues(nextState.customFields.supplier, current.extraFields),
    }))
    setProductForm((current) => ({
      ...current,
      extraFields: normalizeDynamicValues(nextState.customFields.product, current.extraFields),
    }))
    setUserForm((current) => ({
      ...current,
      extraFields: normalizeDynamicValues(nextState.customFields.user, current.extraFields),
    }))
    setOrderDraft((current) => ({
      ...current,
      extraFields: normalizeDynamicValues(nextState.customFields.order, current.extraFields),
    }))
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

  function saveSupplier() {
    if (!supplierForm.name.trim()) return
    const payload = {
      ...supplierForm,
      id: supplierForm.id || uid('supplier'),
      products:
        supplierForm.id && selectedSupplier?.id === supplierForm.id
          ? selectedSupplier.products
          : [],
    }

    updateState((current) => {
      const exists = current.suppliers.some((supplier) => supplier.id === payload.id)
      const suppliers = exists
        ? current.suppliers.map((supplier) =>
            supplier.id === payload.id ? { ...supplier, ...payload, products: supplier.products } : supplier,
          )
        : [...current.suppliers, payload]

      return { ...current, suppliers }
    })

    setSelectedSupplierId(payload.id)
    setSupplierForm(createEmptySupplier(appState.customFields))
  }

  function editSupplier(supplier) {
    setSupplierForm({
      ...supplier,
      extraFields: normalizeDynamicValues(appState.customFields.supplier, supplier.extraFields),
    })
    setActiveTab('catalog')
  }

  function deleteSupplier(supplierId) {
    const fallbackSupplier =
      appState.suppliers.find((supplier) => supplier.id !== supplierId)?.id ?? ''

    updateState((current) => ({
      ...current,
      suppliers: current.suppliers.filter((supplier) => supplier.id !== supplierId),
      orders: current.orders.filter((order) => order.supplierId !== supplierId),
    }))
    if (selectedSupplierId === supplierId) setSelectedSupplierId(fallbackSupplier)
    setOrderDraft((current) => ({
      ...current,
      supplierId: current.supplierId === supplierId ? fallbackSupplier : current.supplierId,
    }))
  }

  function saveProduct() {
    if (!selectedSupplierId || !productForm.name.trim()) return
    const payload = {
      ...productForm,
      supplierId: selectedSupplierId,
      id: productForm.id || uid('product'),
      unitPrice: Number(productForm.unitPrice || 0),
      minimumOrder: Number(productForm.minimumOrder || 0),
    }

    updateState((current) => ({
      ...current,
      suppliers: current.suppliers.map((supplier) => {
        if (supplier.id !== selectedSupplierId) return supplier
        const exists = supplier.products.some((product) => product.id === payload.id)
        const products = exists
          ? supplier.products.map((product) => (product.id === payload.id ? payload : product))
          : [...supplier.products, payload]
        return { ...supplier, products }
      }),
    }))

    setProductForm(createEmptyProduct(appState.customFields, selectedSupplierId))
  }

  function editProduct(product) {
    setProductForm({
      ...product,
      supplierId: selectedSupplierId,
      extraFields: normalizeDynamicValues(appState.customFields.product, product.extraFields),
    })
    setActiveTab('catalog')
  }

  function deleteProduct(productId) {
    updateState((current) => ({
      ...current,
      suppliers: current.suppliers.map((supplier) =>
        supplier.id === selectedSupplierId
          ? {
              ...supplier,
              products: supplier.products.filter((product) => product.id !== productId),
            }
          : supplier,
      ),
    }))
    setOrderDraft((current) => ({
      ...current,
      lines: current.lines.filter((line) => line.productId !== productId),
    }))
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
        line.productId === productId ? { ...line, quantity: Number(quantity || 0) } : line,
      ),
    }))
  }

  function removeLine(productId) {
    setOrderDraft((current) => ({
      ...current,
      lines: current.lines.filter((line) => line.productId !== productId),
    }))
  }

  function finalizeOrder() {
    if (!selectedSupplier || !orderDraft.lines.length) return
    const createdAt = new Date().toISOString()
    const order = {
      id: uid('order'),
      supplierId: selectedSupplier.id,
      createdById: activeUserId,
      createdAt,
      status: 'Pendiente',
      notes: orderDraft.notes,
      extraFields: orderDraft.extraFields,
      items: orderDraft.lines.filter((line) => Number(line.quantity) > 0),
      total: currentOrderTotal,
    }

    updateState((current) => ({
      ...current,
      orders: [order, ...current.orders],
    }))

    setLastCreatedOrderId(order.id)
    setOrderDraft(createEmptyOrderDraft(appState.customFields))
    setCopyFeedback('')
    setActiveTab('history')
  }

  async function copyMessage() {
    if (!messageText) return
    await navigator.clipboard.writeText(messageText)
    setCopyFeedback('Texto copiado')
    window.setTimeout(() => setCopyFeedback(''), 1800)
  }

  function openWhatsApp() {
    if (!messageTargetSupplier || !messageText) return
    const phone = sanitizePhone(messageTargetSupplier.sellerPhone)
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(messageText)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function saveUser() {
    if (!userForm.name.trim()) return
    const payload = {
      ...userForm,
      id: userForm.id || uid('user'),
    }

    updateState((current) => {
      const exists = current.users.some((user) => user.id === payload.id)
      const users = exists
        ? current.users.map((user) => (user.id === payload.id ? payload : user))
        : [...current.users, payload]
      return { ...current, users }
    })

    setUserForm(createEmptyUser(appState.customFields))
  }

  function editUser(user) {
    setUserForm({
      ...user,
      extraFields: normalizeDynamicValues(appState.customFields.user, user.extraFields),
    })
    setActiveTab('admin')
  }

  function deleteUser(userId) {
    if (userId === activeUserId) return
    updateState((current) => ({
      ...current,
      users: current.users.filter((user) => user.id !== userId),
    }))
  }

  function addCustomField() {
    if (!fieldForm.label.trim() || !fieldForm.key.trim()) return
    const field = {
      id: fieldForm.key.trim().toLowerCase().replace(/\s+/g, '_'),
      label: fieldForm.label.trim(),
      type: fieldForm.type,
      placeholder: fieldForm.placeholder.trim(),
    }

    updateState((current) => {
      const nextState = {
        ...current,
        customFields: {
          ...current.customFields,
          [fieldForm.entity]: [...current.customFields[fieldForm.entity], field],
        },
      }

      nextState.suppliers = nextState.suppliers.map((supplier) => ({
        ...supplier,
        extraFields:
          fieldForm.entity === 'supplier'
            ? normalizeDynamicValues(nextState.customFields.supplier, supplier.extraFields)
            : supplier.extraFields,
        products: supplier.products.map((product) => ({
          ...product,
          extraFields:
            fieldForm.entity === 'product'
              ? normalizeDynamicValues(nextState.customFields.product, product.extraFields)
              : product.extraFields,
        })),
      }))

      nextState.users = nextState.users.map((user) => ({
        ...user,
        extraFields:
          fieldForm.entity === 'user'
            ? normalizeDynamicValues(nextState.customFields.user, user.extraFields)
            : user.extraFields,
      }))

      nextState.orders = nextState.orders.map((order) => ({
        ...order,
        extraFields:
          fieldForm.entity === 'order'
            ? normalizeDynamicValues(nextState.customFields.order, order.extraFields)
            : order.extraFields,
      }))

      syncFormsWithCustomFields(nextState)
      return nextState
    })

    setFieldForm({
      entity: 'supplier',
      label: '',
      key: '',
      type: 'text',
      placeholder: '',
    })
  }

  function removeCustomField(entity, fieldId) {
    updateState((current) => {
      const nextState = {
        ...current,
        customFields: {
          ...current.customFields,
          [entity]: current.customFields[entity].filter((field) => field.id !== fieldId),
        },
      }

      const stripField = (values = {}) =>
        Object.fromEntries(Object.entries(values).filter(([key]) => key !== fieldId))

      if (entity === 'supplier') {
        nextState.suppliers = nextState.suppliers.map((supplier) => ({
          ...supplier,
          extraFields: stripField(supplier.extraFields),
        }))
      }
      if (entity === 'product') {
        nextState.suppliers = nextState.suppliers.map((supplier) => ({
          ...supplier,
          products: supplier.products.map((product) => ({
            ...product,
            extraFields: stripField(product.extraFields),
          })),
        }))
      }
      if (entity === 'user') {
        nextState.users = nextState.users.map((user) => ({
          ...user,
          extraFields: stripField(user.extraFields),
        }))
      }
      if (entity === 'order') {
        nextState.orders = nextState.orders.map((order) => ({
          ...order,
          extraFields: stripField(order.extraFields),
        }))
      }

      syncFormsWithCustomFields(nextState)
      return nextState
    })
  }

  function updateOrderStatus(orderId, status) {
    updateState((current) => ({
      ...current,
      orders: current.orders.map((order) => (order.id === orderId ? { ...order, status } : order)),
    }))
  }

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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Osake Order Studio</p>
          <h1>Pedidos, catalogos y vendedores en una sola vista.</h1>
          <p className="lead">
            Tomando como referencia tus planillas, la app centraliza proveedores,
            formatos, tiempos de entrega, historial y salida directa a WhatsApp.
          </p>
        </div>

        <div className="panel compact">
          <label className="label">Usuario activo</label>
          <select value={activeUserId} onChange={(event) => setActiveUserId(event.target.value)}>
            {appState.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · {user.role === 'admin' ? 'Admin' : 'Compras'}
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
                })
              }}
            >
              <span>{supplier.name}</span>
              <small>
                {supplier.sellerName} · {supplier.deliveryLeadTime || 'Sin lead time'}
              </small>
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
        </header>

        {activeTab === 'overview' && (
          <section className="grid two-up">
            <article className="panel hero-panel">
              <div className="hero-copy">
                <h2>Analisis rapido de tus archivos</h2>
                <ul className="clean-list">
                  <li>Las planillas mezclan itinerario semanal, catalogo por proveedor y recepcion.</li>
                  <li>Ya existe la logica de lead time, vendedor/contacto, formato y precio por item.</li>
                  <li>La nueva app separa esos datos para poder escalar sin romper el flujo.</li>
                </ul>
              </div>
              {selectedSupplier && (
                <div className="supplier-highlight">
                  <p className="label">Proveedor seleccionado</p>
                  <h3>{selectedSupplier.name}</h3>
                  <p>{selectedSupplier.sellerName}</p>
                  <dl>
                    <div>
                      <dt>Entrega</dt>
                      <dd>{selectedSupplier.deliveryLeadTime || 'Por definir'}</dd>
                    </div>
                    <div>
                      <dt>Dias</dt>
                      <dd>{selectedSupplier.deliveryDays || 'Sin calendario'}</dd>
                    </div>
                    <div>
                      <dt>Catalogo</dt>
                      <dd>{selectedSupplier.products.length} items</dd>
                    </div>
                  </dl>
                </div>
              )}
            </article>

            <article className="panel">
              <h2>Estado de produccion recomendado</h2>
              <ul className="clean-list">
                <li>Usuarios con rol `admin` y `compras` ya separados en interfaz.</li>
                <li>Historial general persistido en `localStorage` para no perder pedidos de prueba.</li>
                <li>Campos dinamicos para crecer sin reescribir todo el formulario cada vez.</li>
                <li>Base preparada para luego conectar backend, login real y base de datos.</li>
              </ul>
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
                <Field
                  label="Vendedor"
                  name="sellerName"
                  value={supplierForm.sellerName}
                  onChange={handleSupplierFormChange}
                />
                <Field
                  label="WhatsApp vendedor"
                  name="sellerPhone"
                  value={supplierForm.sellerPhone}
                  onChange={handleSupplierFormChange}
                />
                <Field
                  label="Categoria"
                  name="category"
                  value={supplierForm.category}
                  onChange={handleSupplierFormChange}
                />
                <Field
                  label="Tiempo de entrega"
                  name="deliveryLeadTime"
                  value={supplierForm.deliveryLeadTime}
                  onChange={handleSupplierFormChange}
                />
                <Field
                  label="Dias de entrega"
                  name="deliveryDays"
                  value={supplierForm.deliveryDays}
                  onChange={handleSupplierFormChange}
                />
                <Field
                  label="Pago"
                  name="paymentTerms"
                  value={supplierForm.paymentTerms}
                  onChange={handleSupplierFormChange}
                />
                <TextArea
                  label="Notas"
                  name="notes"
                  value={supplierForm.notes}
                  onChange={handleSupplierFormChange}
                />
                <DynamicFieldGroup
                  fields={appState.customFields.supplier}
                  values={supplierForm.extraFields}
                  onChange={(fieldId, value) =>
                    handleExtraFieldChange(setSupplierForm, fieldId, value)
                  }
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
                        <button
                          type="button"
                          className="ghost danger"
                          onClick={() => deleteSupplier(supplier.id)}
                        >
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
                <Field
                  label="Variedad"
                  name="variety"
                  value={productForm.variety}
                  onChange={handleProductFormChange}
                />
                <Field label="Tamano" name="size" value={productForm.size} onChange={handleProductFormChange} />
                <Field
                  label="Formato"
                  name="format"
                  value={productForm.format}
                  onChange={handleProductFormChange}
                />
                <Field
                  label="Precio unitario"
                  name="unitPrice"
                  type="number"
                  value={productForm.unitPrice}
                  onChange={handleProductFormChange}
                />
                <Field
                  label="Minimo"
                  name="minimumOrder"
                  type="number"
                  value={productForm.minimumOrder}
                  onChange={handleProductFormChange}
                />
                <Field
                  label="Override entrega"
                  name="deliveryOverride"
                  value={productForm.deliveryOverride}
                  onChange={handleProductFormChange}
                />
                <TextArea label="Nota SKU" name="note" value={productForm.note} onChange={handleProductFormChange} />
                <DynamicFieldGroup
                  fields={appState.customFields.product}
                  values={productForm.extraFields}
                  onChange={(fieldId, value) =>
                    handleExtraFieldChange(setProductForm, fieldId, value)
                  }
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
                      <p>
                        {[product.variety, product.size, product.format].filter(Boolean).join(' · ')}
                      </p>
                      <small>{currency(product.unitPrice)}</small>
                    </div>
                    {isAdmin && (
                      <div className="row-actions">
                        <button type="button" className="ghost" onClick={() => editProduct(product)}>
                          Editar
                        </button>
                        <button
                          type="button"
                          className="ghost danger"
                          onClick={() => deleteProduct(product.id)}
                        >
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
                  <p className="muted">
                    Busca por nombre, variedad, tamano o formato.
                  </p>
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
                  <button
                    key={product.id}
                    type="button"
                    className="catalog-card"
                    onClick={() => addLine(product)}
                  >
                    <span>{product.name}</span>
                    <small>{[product.variety, product.size].filter(Boolean).join(' · ')}</small>
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
                  <p className="muted">
                    Vendedor: {selectedSupplier?.sellerName || 'sin seleccionar'}
                  </p>
                </div>
                <span className="pill solid">{currency(currentOrderTotal)}</span>
              </div>

              <div className="stack">
                {orderDraft.lines.map((line) => (
                  <div key={line.productId} className="line-item">
                    <div>
                      <strong>{line.name}</strong>
                      <small>{[line.variety, line.size, line.format].filter(Boolean).join(' · ')}</small>
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
                onChange={(event) =>
                  setOrderDraft((current) => ({ ...current, notes: event.target.value }))
                }
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
                    <div
                      key={order.id}
                      className={`history-card ${lastCreatedOrderId === order.id ? 'accented' : ''}`}
                    >
                      <div className="history-head">
                        <div>
                          <strong>{supplier?.name}</strong>
                          <small>
                            {creator?.name} · {formatDate(order.createdAt)}
                          </small>
                        </div>
                        <select
                          value={order.status}
                          onChange={(event) => updateOrderStatus(order.id, event.target.value)}
                        >
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
                  <p className="muted">
                    Se genera desde el ultimo pedido guardado.
                  </p>
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
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setUserForm(createEmptyUser(appState.customFields))}
                >
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
                  onChange={(fieldId, value) =>
                    handleExtraFieldChange(setUserForm, fieldId, value)
                  }
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
                      <button
                        type="button"
                        className="ghost danger"
                        disabled={user.id === activeUserId}
                        onClick={() => deleteUser(user.id)}
                      >
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
                  <p className="muted">
                    Agrega nuevos campos sin tocar el formulario completo.
                  </p>
                </div>
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>Entidad</span>
                  <select
                    value={fieldForm.entity}
                    onChange={(event) =>
                      setFieldForm((current) => ({ ...current, entity: event.target.value }))
                    }
                  >
                    <option value="supplier">Proveedor</option>
                    <option value="product">Producto</option>
                    <option value="order">Pedido</option>
                    <option value="user">Usuario</option>
                  </select>
                </label>
                <Field
                  label="Etiqueta"
                  name="label"
                  value={fieldForm.label}
                  onChange={(event) =>
                    setFieldForm((current) => ({ ...current, label: event.target.value }))
                  }
                />
                <Field
                  label="Clave"
                  name="key"
                  value={fieldForm.key}
                  onChange={(event) =>
                    setFieldForm((current) => ({ ...current, key: event.target.value }))
                  }
                />
                <label className="field">
                  <span>Tipo</span>
                  <select
                    value={fieldForm.type}
                    onChange={(event) =>
                      setFieldForm((current) => ({ ...current, type: event.target.value }))
                    }
                  >
                    <option value="text">Texto</option>
                    <option value="number">Numero</option>
                    <option value="textarea">Area de texto</option>
                  </select>
                </label>
                <Field
                  label="Placeholder"
                  name="placeholder"
                  value={fieldForm.placeholder}
                  onChange={(event) =>
                    setFieldForm((current) => ({
                      ...current,
                      placeholder: event.target.value,
                    }))
                  }
                />
              </div>
              <button type="button" className="primary" onClick={addCustomField}>
                Agregar campo
              </button>

              <div className="stack">
                {Object.entries(appState.customFields).map(([entity, fields]) => (
                  <div key={entity} className="fieldset-box">
                    <strong>{entity}</strong>
                    {fields.length === 0 && <small>Sin campos extra</small>}
                    {fields.map((field) => (
                      <div key={field.id} className="list-row">
                        <div>
                          <strong>{field.label}</strong>
                          <small>
                            {field.id} · {field.type}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="ghost danger"
                          onClick={() => removeCustomField(entity, field.id)}
                        >
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
              onChange={(event) => onChange(field.id, event.target.value)}
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
      <input type={type} name={name} value={value} onChange={onChange} />
    </label>
  )
}

function TextArea({ label, name, value, onChange }) {
  return (
    <label className="field field-wide">
      <span>{label}</span>
      <textarea rows="3" name={name} value={value} onChange={onChange} />
    </label>
  )
}

export default App
