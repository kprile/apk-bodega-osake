# APK OSAKE-COD

Repositorio local de trabajo para la aplicacion de pedidos de Osake.

## Estructura

- `pedido-app/`: frontend React + Vite
- `server/`: API Express + SQLite
- `- (modelo) PLANILLA DE PEDIDOS SEMANALES - PRAT.xlsx`: referencia operativa
- `- (modelo) PLANILLA DE PEDIDOS SEMANALES - SM.xlsx`: referencia operativa

## Objetivo funcional

Centralizar:

- proveedores y vendedores
- catalogos con productos, formatos, variedades y tamanos
- tiempos de entrega y condiciones
- creacion de pedidos
- historial general
- generacion de texto para WhatsApp

## Arranque local

```bash
npm install
npm --prefix pedido-app install
npm --prefix server install
npm run dev
```

Frontend: `http://localhost:5173`

API: `http://localhost:4000/api`

## Reset de base local

```bash
npm run db:seed
```
