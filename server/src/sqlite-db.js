import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { seedData } from './seed-data.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, '../data')
const dbPath = path.join(dataDir, 'osake.sqlite')

fs.mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys = ON')

function stringify(value) {
  return JSON.stringify(value ?? {})
}

function stringifyItems(value) {
  return JSON.stringify(value ?? [])
}

function parseRecord(value) {
  try {
    return value ? JSON.parse(value) : {}
  } catch {
    return {}
  }
}

function parseItems(value) {
  try {
    return value ? JSON.parse(value) : []
  } catch {
    return []
  }
}

function createHttpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function notFound(message) {
  return createHttpError(404, message)
}

function conflict(message) {
  return createHttpError(409, message)
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      extra_fields TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      seller_name TEXT NOT NULL DEFAULT '',
      seller_phone TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      delivery_lead_time TEXT NOT NULL DEFAULT '',
      delivery_days TEXT NOT NULL DEFAULT '',
      payment_terms TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      extra_fields TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      name TEXT NOT NULL,
      variety TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL DEFAULT '',
      format TEXT NOT NULL DEFAULT '',
      unit_price INTEGER NOT NULL DEFAULT 0,
      delivery_override TEXT NOT NULL DEFAULT '',
      minimum_order INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      extra_fields TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      created_by_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pendiente',
      notes TEXT NOT NULL DEFAULT '',
      extra_fields TEXT NOT NULL DEFAULT '{}',
      items TEXT NOT NULL DEFAULT '[]',
      total INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS custom_fields (
      id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      label TEXT NOT NULL,
      field_key TEXT NOT NULL,
      field_type TEXT NOT NULL,
      placeholder TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)
}

function deduplicateCustomFields() {
  const fields = db
    .prepare('SELECT id, entity, field_key, created_at FROM custom_fields ORDER BY created_at ASC, id ASC')
    .all()

  const seen = new Set()
  const duplicates = []

  for (const field of fields) {
    const signature = `${field.entity}:${field.field_key}`
    if (seen.has(signature)) {
      duplicates.push(field.id)
      continue
    }
    seen.add(signature)
  }

  if (!duplicates.length) return

  const removeDuplicate = db.prepare('DELETE FROM custom_fields WHERE id = ?')
  db.exec('BEGIN')
  try {
    for (const id of duplicates) {
      removeDuplicate.run(id)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function resetAndSeedDatabase() {
  initSchema()
  deduplicateCustomFields()
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count
  if (count > 0) return
  seedDatabase()
}

export function seedDatabase() {
  const insertUser = db.prepare(`
    INSERT INTO users (id, name, role, phone, email, extra_fields)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const insertSupplier = db.prepare(`
    INSERT INTO suppliers (
      id, name, seller_name, seller_phone, category, delivery_lead_time,
      delivery_days, payment_terms, notes, extra_fields
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertProduct = db.prepare(`
    INSERT INTO products (
      id, supplier_id, name, variety, size, format, unit_price,
      delivery_override, minimum_order, note, extra_fields
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM orders; DELETE FROM products; DELETE FROM suppliers; DELETE FROM users; DELETE FROM custom_fields;')

    for (const user of seedData.users) {
      insertUser.run(user.id, user.name, user.role, user.phone, user.email, stringify(user.extraFields))
    }

    for (const supplier of seedData.suppliers) {
      insertSupplier.run(
        supplier.id,
        supplier.name,
        supplier.sellerName,
        supplier.sellerPhone,
        supplier.category,
        supplier.deliveryLeadTime,
        supplier.deliveryDays,
        supplier.paymentTerms,
        supplier.notes,
        stringify(supplier.extraFields),
      )

      for (const product of supplier.products) {
        insertProduct.run(
          product.id,
          supplier.id,
          product.name,
          product.variety,
          product.size,
          product.format,
          product.unitPrice,
          product.deliveryOverride,
          product.minimumOrder,
          product.note,
          stringify(product.extraFields),
        )
      }
    }

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function hardResetDatabase() {
  db.exec(`
    DELETE FROM orders;
    DELETE FROM products;
    DELETE FROM suppliers;
    DELETE FROM users;
    DELETE FROM custom_fields;
  `)
  seedDatabase()
}

function mapUser(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    phone: row.phone,
    email: row.email,
    extraFields: parseRecord(row.extra_fields),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapSupplier(row, products = []) {
  return {
    id: row.id,
    name: row.name,
    sellerName: row.seller_name,
    sellerPhone: row.seller_phone,
    category: row.category,
    deliveryLeadTime: row.delivery_lead_time,
    deliveryDays: row.delivery_days,
    paymentTerms: row.payment_terms,
    notes: row.notes,
    extraFields: parseRecord(row.extra_fields),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    products,
  }
}

function mapProduct(row) {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    name: row.name,
    variety: row.variety,
    size: row.size,
    format: row.format,
    unitPrice: row.unit_price,
    deliveryOverride: row.delivery_override,
    minimumOrder: row.minimum_order,
    note: row.note,
    extraFields: parseRecord(row.extra_fields),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapOrder(row) {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    createdById: row.created_by_id,
    status: row.status,
    notes: row.notes,
    extraFields: parseRecord(row.extra_fields),
    items: parseItems(row.items),
    total: row.total,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapCustomField(row) {
  return {
    id: row.field_key,
    label: row.label,
    type: row.field_type,
    placeholder: row.placeholder,
  }
}

export function getBootstrap() {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all().map(mapUser)
  const products = db.prepare('SELECT * FROM products ORDER BY name ASC').all().map(mapProduct)
  const suppliers = db
    .prepare('SELECT * FROM suppliers ORDER BY name ASC')
    .all()
    .map((supplier) =>
      mapSupplier(
        supplier,
        products.filter((product) => product.supplierId === supplier.id),
      ),
    )
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all().map(mapOrder)
  const fields = db.prepare('SELECT * FROM custom_fields ORDER BY created_at ASC').all()

  return {
    users,
    suppliers,
    orders,
    customFields: {
      supplier: fields.filter((field) => field.entity === 'supplier').map(mapCustomField),
      product: fields.filter((field) => field.entity === 'product').map(mapCustomField),
      order: fields.filter((field) => field.entity === 'order').map(mapCustomField),
      user: fields.filter((field) => field.entity === 'user').map(mapCustomField),
    },
  }
}

export function exportBackup() {
  return getBootstrap()
}

export function importBackup(backup) {
  db.exec('BEGIN')
  try {
    db.exec(`
      DELETE FROM orders;
      DELETE FROM products;
      DELETE FROM suppliers;
      DELETE FROM users;
      DELETE FROM custom_fields;
    `)

    const insertUser = db.prepare(`
      INSERT INTO users (id, name, role, phone, email, extra_fields, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertSupplier = db.prepare(`
      INSERT INTO suppliers (
        id, name, seller_name, seller_phone, category, delivery_lead_time,
        delivery_days, payment_terms, notes, extra_fields, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertProduct = db.prepare(`
      INSERT INTO products (
        id, supplier_id, name, variety, size, format, unit_price,
        delivery_override, minimum_order, note, extra_fields, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertOrder = db.prepare(`
      INSERT INTO orders (
        id, supplier_id, created_by_id, status, notes, extra_fields,
        items, total, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertField = db.prepare(`
      INSERT INTO custom_fields (id, entity, label, field_key, field_type, placeholder, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    for (const user of backup.users ?? []) {
      insertUser.run(
        user.id,
        user.name,
        user.role,
        user.phone ?? '',
        user.email ?? '',
        stringify(user.extraFields),
        user.createdAt ?? now(),
        user.updatedAt ?? now(),
      )
    }

    for (const supplier of backup.suppliers ?? []) {
      insertSupplier.run(
        supplier.id,
        supplier.name,
        supplier.sellerName ?? '',
        supplier.sellerPhone ?? '',
        supplier.category ?? '',
        supplier.deliveryLeadTime ?? '',
        supplier.deliveryDays ?? '',
        supplier.paymentTerms ?? '',
        supplier.notes ?? '',
        stringify(supplier.extraFields),
        supplier.createdAt ?? now(),
        supplier.updatedAt ?? now(),
      )

      for (const product of supplier.products ?? []) {
        insertProduct.run(
          product.id,
          supplier.id,
          product.name,
          product.variety ?? '',
          product.size ?? '',
          product.format ?? '',
          product.unitPrice ?? 0,
          product.deliveryOverride ?? '',
          product.minimumOrder ?? 0,
          product.note ?? '',
          stringify(product.extraFields),
          product.createdAt ?? now(),
          product.updatedAt ?? now(),
        )
      }
    }

    for (const order of backup.orders ?? []) {
      insertOrder.run(
        order.id,
        order.supplierId,
        order.createdById,
        order.status ?? 'Pendiente',
        order.notes ?? '',
        stringify(order.extraFields),
        stringifyItems(order.items),
        order.total ?? 0,
        order.createdAt ?? now(),
        order.updatedAt ?? now(),
      )
    }

    for (const [entity, fields] of Object.entries(backup.customFields ?? {})) {
      for (const field of fields ?? []) {
        insertField.run(
          crypto.randomUUID(),
          entity,
          field.label,
          field.id,
          field.type,
          field.placeholder ?? '',
          now(),
        )
      }
    }

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return getBootstrap()
}

function now() {
  return new Date().toISOString()
}

export function createUser(user) {
  db.prepare(`
    INSERT INTO users (id, name, role, phone, email, extra_fields, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(user.id, user.name, user.role, user.phone, user.email, stringify(user.extraFields), now(), now())

  return getBootstrap().users.find((item) => item.id === user.id)
}

export function updateUser(id, user) {
  const result = db.prepare(`
    UPDATE users
    SET name = ?, role = ?, phone = ?, email = ?, extra_fields = ?, updated_at = ?
    WHERE id = ?
  `).run(user.name, user.role, user.phone, user.email, stringify(user.extraFields), now(), id)

  if (!result.changes) {
    throw notFound('Usuario no encontrado')
  }

  return getBootstrap().users.find((item) => item.id === id)
}

export function deleteUser(id) {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id)
  if (!result.changes) {
    throw notFound('Usuario no encontrado')
  }
}

export function createSupplier(supplier) {
  db.prepare(`
    INSERT INTO suppliers (
      id, name, seller_name, seller_phone, category, delivery_lead_time,
      delivery_days, payment_terms, notes, extra_fields, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    supplier.id,
    supplier.name,
    supplier.sellerName,
    supplier.sellerPhone,
    supplier.category,
    supplier.deliveryLeadTime,
    supplier.deliveryDays,
    supplier.paymentTerms,
    supplier.notes,
    stringify(supplier.extraFields),
    now(),
    now(),
  )

  return getBootstrap().suppliers.find((item) => item.id === supplier.id)
}

export function updateSupplier(id, supplier) {
  const result = db.prepare(`
    UPDATE suppliers
    SET name = ?, seller_name = ?, seller_phone = ?, category = ?, delivery_lead_time = ?,
        delivery_days = ?, payment_terms = ?, notes = ?, extra_fields = ?, updated_at = ?
    WHERE id = ?
  `).run(
    supplier.name,
    supplier.sellerName,
    supplier.sellerPhone,
    supplier.category,
    supplier.deliveryLeadTime,
    supplier.deliveryDays,
    supplier.paymentTerms,
    supplier.notes,
    stringify(supplier.extraFields),
    now(),
    id,
  )

  if (!result.changes) {
    throw notFound('Proveedor no encontrado')
  }

  return getBootstrap().suppliers.find((item) => item.id === id)
}

export function deleteSupplier(id) {
  const result = db.prepare('DELETE FROM suppliers WHERE id = ?').run(id)
  if (!result.changes) {
    throw notFound('Proveedor no encontrado')
  }
}

export function createProduct(product) {
  db.prepare(`
    INSERT INTO products (
      id, supplier_id, name, variety, size, format, unit_price,
      delivery_override, minimum_order, note, extra_fields, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    product.id,
    product.supplierId,
    product.name,
    product.variety,
    product.size,
    product.format,
    product.unitPrice,
    product.deliveryOverride,
    product.minimumOrder,
    product.note,
    stringify(product.extraFields),
    now(),
    now(),
  )

  return getBootstrap().suppliers
    .flatMap((supplier) => supplier.products)
    .find((item) => item.id === product.id)
}

export function updateProduct(id, product) {
  const result = db.prepare(`
    UPDATE products
    SET supplier_id = ?, name = ?, variety = ?, size = ?, format = ?, unit_price = ?,
        delivery_override = ?, minimum_order = ?, note = ?, extra_fields = ?, updated_at = ?
    WHERE id = ?
  `).run(
    product.supplierId,
    product.name,
    product.variety,
    product.size,
    product.format,
    product.unitPrice,
    product.deliveryOverride,
    product.minimumOrder,
    product.note,
    stringify(product.extraFields),
    now(),
    id,
  )

  if (!result.changes) {
    throw notFound('Producto no encontrado')
  }

  return getBootstrap().suppliers
    .flatMap((supplier) => supplier.products)
    .find((item) => item.id === id)
}

export function deleteProduct(id) {
  const result = db.prepare('DELETE FROM products WHERE id = ?').run(id)
  if (!result.changes) {
    throw notFound('Producto no encontrado')
  }
}

export function createOrder(order) {
  db.prepare(`
    INSERT INTO orders (
      id, supplier_id, created_by_id, status, notes, extra_fields,
      items, total, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    order.id,
    order.supplierId,
    order.createdById,
    order.status,
    order.notes,
    stringify(order.extraFields),
    stringifyItems(order.items),
    order.total,
    now(),
    now(),
  )

  return getBootstrap().orders.find((item) => item.id === order.id)
}

export function updateOrderStatusById(id, status) {
  const result = db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    now(),
    id,
  )
  if (!result.changes) {
    throw notFound('Pedido no encontrado')
  }
  return getBootstrap().orders.find((item) => item.id === id)
}

export function createCustomField(field) {
  const existing = db
    .prepare('SELECT id FROM custom_fields WHERE entity = ? AND field_key = ? LIMIT 1')
    .get(field.entity, field.key)

  if (existing) {
    throw conflict('Ya existe un campo con esa clave para esa seccion')
  }

  const id = crypto.randomUUID()
  db.prepare(`
    INSERT INTO custom_fields (id, entity, label, field_key, field_type, placeholder, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, field.entity, field.label, field.key, field.fieldType, field.placeholder, now())

  return {
    id: field.key,
    label: field.label,
    type: field.fieldType,
    placeholder: field.placeholder,
  }
}

export function deleteCustomField(entity, key) {
  const result = db.prepare('DELETE FROM custom_fields WHERE entity = ? AND field_key = ?').run(
    entity,
    key,
  )
  if (!result.changes) {
    throw notFound('Campo dinamico no encontrado')
  }
}
