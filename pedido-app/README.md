# Pedido App Osake

Aplicacion web para gestionar proveedores, catalogos, pedidos, usuarios y salida de mensajes para WhatsApp.

## Lo que incluye esta version

- Proveedores con vendedor, telefono, categoria, tiempos de entrega y notas.
- Catalogo por proveedor con producto, variedad, tamano, formato, precio y minimo.
- Usuarios con roles `admin` y `buyer`.
- Historial general de pedidos guardado en navegador.
- Generacion de texto listo para copiar o enviar por WhatsApp.
- Campos dinamicos administrables para proveedor, producto, pedido y usuario.

## Arranque local

```bash
npm install
npm run dev
```

Por defecto consume la API en `http://localhost:4000/api`.

## Build de produccion

```bash
npm run build
```

## Siguiente paso recomendado para produccion real

Esta base ya tiene el modelo funcional del negocio y ya consume un backend real. Para una puesta en produccion completa conviene agregar o reforzar:

- autenticacion real
- despliegue del backend
- auditoria de cambios
- permisos por usuario
- backup y exportacion
