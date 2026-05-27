import crypto from 'node:crypto'
import cors from 'cors'
import express from 'express'
import { z } from 'zod'
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
  resetAndSeedDatabase,
  updateOrderStatusById,
  updateProduct,
  updateSupplier,
  updateUser,
} from './sqlite-db.js'

const app = express()
const port = process.env.PORT || 4000

app.use(cors())
app.use(express.json())

const extraFieldSchema = z.record(z.string(), z.union([z.string(), z.number()]))

const userSchema = z.object({
  id: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  name: z.string().min(1),
  role: z.enum(['admin', 'buyer']),
  phone: z.string().default(''),
  email: z.string().default(''),
  extraFields: extraFieldSchema.default({}),
})

const supplierSchema = z.object({
  id: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  name: z.string().min(1),
  sellerName: z.string().default(''),
  sellerPhone: z.string().default(''),
  category: z.string().default(''),
  deliveryLeadTime: z.string().default(''),
  deliveryDays: z.string().default(''),
  paymentTerms: z.string().default(''),
  notes: z.string().default(''),
  extraFields: extraFieldSchema.default({}),
})

const productSchema = z.object({
  id: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  supplierId: z.string(),
  name: z.string().min(1),
  variety: z.string().default(''),
  size: z.string().default(''),
  format: z.string().default(''),
  unitPrice: z.coerce.number().int().nonnegative(),
  deliveryOverride: z.string().default(''),
  minimumOrder: z.coerce.number().int().nonnegative(),
  note: z.string().default(''),
  extraFields: extraFieldSchema.default({}),
})

const orderItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  variety: z.string().default(''),
  size: z.string().default(''),
  format: z.string().default(''),
  unitPrice: z.coerce.number().int().nonnegative(),
  quantity: z.coerce.number().int().positive(),
})

const orderSchema = z.object({
  supplierId: z.string(),
  createdById: z.string(),
  status: z.string().default('Pendiente'),
  notes: z.string().default(''),
  extraFields: extraFieldSchema.default({}),
  items: z.array(orderItemSchema).min(1),
  total: z.coerce.number().int().nonnegative(),
})

const customFieldSchema = z.object({
  entity: z.enum(['supplier', 'product', 'order', 'user']),
  label: z.string().min(1),
  key: z.string().min(1),
  fieldType: z.enum(['text', 'number', 'textarea']),
  placeholder: z.string().default(''),
})

const backupSchema = z.object({
  users: z.array(z.any()).default([]),
  suppliers: z.array(z.any()).default([]),
  orders: z.array(z.any()).default([]),
  customFields: z.record(z.string(), z.array(z.any())).default({}),
})

function parseOrThrow(schema, payload) {
  const result = schema.safeParse(payload)
  if (!result.success) {
    const error = new Error(result.error.issues.map((issue) => issue.message).join(', '))
    error.status = 400
    throw error
  }
  return result.data
}

resetAndSeedDatabase()

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.get('/api/bootstrap', (_request, response) => {
  response.json(getBootstrap())
})

app.get('/api/backup/export', (_request, response) => {
  response.json(exportBackup())
})

app.post('/api/backup/import', (request, response) => {
  const payload = parseOrThrow(backupSchema, request.body)
  response.json(importBackup(payload))
})

app.post('/api/users', (request, response) => {
  const payload = parseOrThrow(userSchema, request.body)
  response.status(201).json(createUser({ ...payload, id: payload.id ?? crypto.randomUUID() }))
})

app.put('/api/users/:id', (request, response) => {
  const payload = parseOrThrow(userSchema, request.body)
  response.json(updateUser(request.params.id, payload))
})

app.delete('/api/users/:id', (request, response) => {
  deleteUser(request.params.id)
  response.status(204).end()
})

app.post('/api/suppliers', (request, response) => {
  const payload = parseOrThrow(supplierSchema, request.body)
  response.status(201).json(createSupplier({ ...payload, id: payload.id ?? crypto.randomUUID() }))
})

app.put('/api/suppliers/:id', (request, response) => {
  const payload = parseOrThrow(supplierSchema, request.body)
  response.json(updateSupplier(request.params.id, payload))
})

app.delete('/api/suppliers/:id', (request, response) => {
  deleteSupplier(request.params.id)
  response.status(204).end()
})

app.post('/api/products', (request, response) => {
  const payload = parseOrThrow(productSchema, request.body)
  response.status(201).json(createProduct({ ...payload, id: payload.id ?? crypto.randomUUID() }))
})

app.put('/api/products/:id', (request, response) => {
  const payload = parseOrThrow(productSchema, request.body)
  response.json(updateProduct(request.params.id, payload))
})

app.delete('/api/products/:id', (request, response) => {
  deleteProduct(request.params.id)
  response.status(204).end()
})

app.post('/api/orders', (request, response) => {
  const payload = parseOrThrow(orderSchema, request.body)
  response.status(201).json(createOrder({ ...payload, id: crypto.randomUUID() }))
})

app.patch('/api/orders/:id/status', (request, response) => {
  const payload = parseOrThrow(z.object({ status: z.string().min(1) }), request.body)
  response.json(updateOrderStatusById(request.params.id, payload.status))
})

app.post('/api/custom-fields', (request, response) => {
  const payload = parseOrThrow(customFieldSchema, request.body)
  response.status(201).json(createCustomField(payload))
})

app.delete('/api/custom-fields/:entity/:key', (request, response) => {
  deleteCustomField(request.params.entity, request.params.key)
  response.status(204).end()
})

app.use((error, _request, response, _next) => {
  response.status(error.status || 500).json({
    message: error.message || 'Unexpected server error',
  })
})

app.listen(port, () => {
  console.log(`Osake API running on http://localhost:${port}`)
})
