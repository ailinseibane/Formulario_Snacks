# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Local preview

Start the dev server (Python, port 3456) via the launch config:

```
python -m http.server 3456 --directory .
```

Or use the Claude Code preview tool with the `snack-fan-preview` configuration in `.claude/launch.json`. The form loads at `http://localhost:3456/index.html`.

**Important:** the form fetches products from the live Apps Script URL on load. In local preview, products won't render without a real network call to the deployed script. Use `preview_eval` to inject mock data if needed.

## Architecture

This is a static frontend + Google Apps Script backend. There is no build step.

```
index.html             ← Wholesale order form (client-facing)
ventasnackfan.html     ← Print-ready sales remito, fed entirely by URL params
snackfanlistaprecios.html ← Price list (standalone)
css/style.css          ← All styles for index.html (brand: yellow #FFE500, red #CC1100)
js/script.js           ← All JS for index.html
apps-script/Code.gs    ← Google Apps Script: REST API + Sheets writer + email
```

### Data flow

1. `index.html` loads → `script.js` calls `GET ?action=productos` → Apps Script reads `items` tab and `Categories` tab, returns products with `cantidades[]` per category.
2. User submits → `POST` to Apps Script → writes 1 row to `Transactions` + N rows to `inventory` (one per product) + sends notification email.
3. AppSheet opens `ventasnackfan.html?param=value&...` to show the remito — no server call, everything is in the URL.

### Google Sheets (ID: `1rY3gZy06vpngQtY4S7jp36FjDwmc0224Yy5YnUhAgqo`)

| Tab | Purpose |
|---|---|
| `items` | Product catalog. `Mostrar_Formulario=TRUE` to show in form. Columns: `Codigo`, `Nombre`, `Categoría`, `Precio`, `% venta mayorista`, `Mostrar_Formulario` |
| `Categories` | Quantity options per category. Columns: `ID`, `Category`, `Icon`, `Activa?`, `Unidades` (comma-separated, e.g. `1,6,12,24`) |
| `Transactions` | One row per order. Col 19 = `Tipo de entrega` (added manually by owner) |
| `inventory` | One row per product line. Linked to Transactions via `RefID` |
| `Datos mail` | Email recipients. Row with `Notificacion nuevo envio` in col A → comma-separated emails in col B |

### Apps Script key functions

- `getProductos()` — builds `catMap` from `Categories` tab (keyed by `Category` column, not the ID column), then maps `items` rows adding `cantidades[]`. Fallback: `[0,1,6,12,24,48,72,96]`.
- `grabarPedido(data)` — writes Transactions + inventory, then calls `enviarMailPedido`.
- `enviarMailPedido(codigo, fechahora, data, productos)` — reads recipients from `Datos mail`, sends branded HTML email. Wrapped in try/catch so email failure never blocks order saving.
- `getDestinatarios(detalle)` — looks up email list from `Datos mail` tab by row label.
- `testMail()` — run manually from Apps Script editor to trigger Gmail authorization prompt.
- `testCategorias()` — diagnostic: logs category name/units mapping and categories found in `items`.

### ventasnackfan.html URL parameters

AppSheet builds the URL with these params:

| Param | Content |
|---|---|
| `codigo` | Order UniqueID (e.g. `SF-20260517-001`) |
| `fecha`, `cliente`, `estado`, `domicilio`, `telefono`, `observaciones`, `total` | Order header fields |
| `tipo_entrega`, `forma_pago`, `vendedor` | New fields added this session |
| `codigos`, `descripciones`, `cantidades`, `preciosUnitarios`, `descuentos`, `preciosFinales` | Comma-separated arrays, one value per product line |

## Deploying Apps Script changes

After editing `Code.gs`, paste the full file content into [script.google.com](https://script.google.com), then:
**Desplegar → Administrar implementaciones → lápiz (editar) → Nueva versión → Implementar**

The deployed URL is already set in `js/script.js` — it does not change between versions.

## Brand

- Colors: yellow `#FFE500` (backgrounds), red `#CC1100` (text, accents, buttons)
- Logo URL: `https://acdn-us.mitiendanube.com/stores/005/821/939/themes/common/logo-1951200950-1739356298-6be1913107e967b9582522cb6ccf771a1739356298.png?0`
- Print styles in `ventasnackfan.html` use `print-color-adjust: exact` to preserve brand colors in grayscale-friendly tones.
