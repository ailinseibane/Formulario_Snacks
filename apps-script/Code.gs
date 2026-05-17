// ============================================================
//  SNACK FAN — Formulario Mayorista
//  Google Apps Script · Web App
//
//  SETUP:
//  1. Pegar este código en script.google.com (nuevo proyecto)
//  2. Desplegar > Nueva implementación > Web App
//     · Ejecutar como: Yo
//     · Acceso: Cualquier persona
//  3. Copiar la URL del despliegue → pegarla en js/script.js
// ============================================================

// Hoja principal de AppSheet (productos + transactions + inventory)
const APPSHEET_SHEET_ID  = '1rY3gZy06vpngQtY4S7jp36FjDwmc0224Yy5YnUhAgqo';
const PRODUCTOS_TAB_NAME = 'items';
const TRANSACTIONS_TAB   = 'Transactions';
const INVENTORY_TAB      = 'inventory';

// Nombres exactos de las columnas en la hoja de productos
const COL_CODIGO        = 'Codigo';
const COL_NOMBRE        = 'Nombre';
const COL_CATEGORIA     = 'Categoría';
const COL_MOSTRAR       = 'Mostrar_Formulario';
const COL_PRECIO        = 'Precio';
const COL_PCT_MAYORISTA = '% venta mayorista';

// ── GET: devuelve lista de productos activos ──────────────────
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action === 'productos') return responder(getProductos());
  return responder({ ok: true, msg: 'Snack Fan API' });
}

// ── POST: recibe y graba un pedido ────────────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const codigo  = grabarPedido(payload);
    return responder({ success: true, codigo: codigo });
  } catch (err) {
    return responder({ success: false, error: err.message });
  }
}

// ── Lee los productos con Mostrar_Formulario = TRUE ───────────
function getProductos() {
  const sheet = SpreadsheetApp.openById(APPSHEET_SHEET_ID)
                              .getSheetByName(PRODUCTOS_TAB_NAME);
  const [headers, ...rows] = sheet.getDataRange().getValues();

  const idx = {
    codigo:       headers.indexOf(COL_CODIGO),
    nombre:       headers.indexOf(COL_NOMBRE),
    categoria:    headers.indexOf(COL_CATEGORIA),
    mostrar:      headers.indexOf(COL_MOSTRAR),
    precio:       headers.indexOf(COL_PRECIO),
    pctMayorista: headers.indexOf(COL_PCT_MAYORISTA),
  };

  return rows
    .filter(r => r[idx.mostrar] === true)
    .map(r => {
      const precioRaw = r[idx.precio];
      const precio    = typeof precioRaw === 'number'
        ? precioRaw
        : parseFloat(String(precioRaw).replace(',', '.').replace(/[^\d.]/g, '')) || 0;

      const pctRaw = r[idx.pctMayorista];
      const pct    = typeof pctRaw === 'number'
        ? pctRaw
        : parseFloat(String(pctRaw).replace('%', '').replace(',', '.').trim()) / 100 || 0;

      const precioMay = precio > 0 ? Math.round(precio * (1 + pct)) : null;

      return {
        codigo:           String(r[idx.codigo]).trim(),
        nombre:           String(r[idx.nombre]).trim(),
        categoria:        String(r[idx.categoria]).trim(),
        precio_mayorista: precioMay,
      };
    });
}

// ── Escribe 1 fila en Transactions + N filas en inventory ─────
function grabarPedido(data) {
  const ss           = SpreadsheetApp.openById(APPSHEET_SHEET_ID);
  const sheetTx      = ss.getSheetByName(TRANSACTIONS_TAB);
  const sheetInv     = ss.getSheetByName(INVENTORY_TAB);

  if (!sheetTx)  throw new Error('No se encontró la pestaña "' + TRANSACTIONS_TAB + '"');
  if (!sheetInv) throw new Error('No se encontró la pestaña "' + INVENTORY_TAB + '"');

  const productosConCantidad = data.productos.filter(p => Number(p.cantidad) > 0);
  if (productosConCantidad.length === 0) {
    throw new Error('El pedido no tiene productos con cantidad mayor a 0.');
  }

  const codigo = generarCodigo(sheetTx);
  const fecha  = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy');
  const fechahora = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy HH:mm');

  // Total del pedido
  const total = productosConCantidad.reduce((sum, p) => {
    return sum + (Number(p.precio_mayorista) || 0) * Number(p.cantidad);
  }, 0);

  // Observaciones enriquecidas con datos de contacto
  const obs = [
    data.observaciones || '',
    data.telefono  ? 'Tel: ' + data.telefono   : '',
    data.direccion ? 'Dir: ' + data.direccion  : '',
  ].filter(Boolean).join(' | ');

  // ── 1 fila en Transactions ────────────────────────────────
  // Orden de columnas: UniqueID, Fecha, Proveedor/Cliente, Tipo de transaccion,
  // Precio, Estado, Observaciones, Crear pdf?, Version, Link, Vendedor,
  // Comisión vendedor (%), Comisión vendedor ($), Flete, Duplicar, Fechahora,
  // Link generado, Imagen generada
  sheetTx.appendRow([
    codigo,           // UniqueID
    fecha,            // Fecha
    data.nombre,      // Proveedor/Cliente
    'VENTA',          // Tipo de transaccion
    'MAYORISTA',      // Precio
    'NUEVO PEDIDO',   // Estado
    obs,              // Observaciones
    '',               // Crear pdf?
    '',               // Version
    '',               // Link
    '',               // Vendedor
    '',               // Comisión vendedor (%)
    '',               // Comisión vendedor ($)
    '',               // Flete
    '',               // Duplicar
    fechahora,        // Fechahora
    '',               // Link generado
    '',               // Imagen generada
  ]);

  // ── N filas en inventory ──────────────────────────────────
  // Orden de columnas: UniqueID, RefID, Proveedor/Cliente, Codigo,
  // Tipo de movimiento, Fecha, Cantidad, Precio lista, % descuento,
  // Precio unitario, Detalle producto, Categoría, Precio de compra,
  // Precio total, Lote
  productosConCantidad.forEach(p => {
    const precioUnit  = Number(p.precio_mayorista) || 0;
    const precioTotal = precioUnit * Number(p.cantidad);

    sheetInv.appendRow([
      generarUUID(),    // UniqueID
      codigo,           // RefID → referencia a Transactions
      data.nombre,      // Proveedor/Cliente
      p.codigo,         // Codigo
      'VENTA',          // Tipo de movimiento
      fecha,            // Fecha
      Number(p.cantidad), // Cantidad
      precioUnit,       // Precio lista
      '',               // % descuento
      precioUnit,       // Precio unitario
      p.nombre,         // Detalle producto
      p.categoria,      // Categoría
      '',               // Precio de compra (solo para compras)
      precioTotal,      // Precio total
      'Sin lote',       // Lote
    ]);
  });

  return codigo;
}

// ── Genera código SF-YYYYMMDD-NNN buscando en Transactions ───
function generarCodigo(sheetTx) {
  const hoy    = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyyMMdd');
  const prefijo = 'SF-' + hoy + '-';
  const lastRow = sheetTx.getLastRow();

  let max = 0;
  if (lastRow > 1) {
    const ids = sheetTx.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    ids.forEach(id => {
      if (String(id).startsWith(prefijo)) {
        const n = parseInt(String(id).split('-')[2], 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
  }

  return prefijo + String(max + 1).padStart(3, '0');
}

// ── Genera un ID único corto estilo hex (ej: "a3f9c21b") ─────
function generarUUID() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 8);
}

// ── Diagnóstico: ejecutar desde el editor de Apps Script ─────
function testPrecio() {
  const sheet = SpreadsheetApp.openById(APPSHEET_SHEET_ID).getSheetByName(PRODUCTOS_TAB_NAME);
  const [headers, ...rows] = sheet.getDataRange().getValues();

  Logger.log('Encabezados: ' + JSON.stringify(headers));
  Logger.log('Índice Precio: '      + headers.indexOf(COL_PRECIO));
  Logger.log('Índice % mayorista: ' + headers.indexOf(COL_PCT_MAYORISTA));
  Logger.log('Índice Mostrar: '     + headers.indexOf(COL_MOSTRAR));

  const activos = rows.filter(r => r[headers.indexOf(COL_MOSTRAR)] === true);
  Logger.log('Productos con Mostrar_Formulario=TRUE: ' + activos.length);

  activos.slice(0, 5).forEach(r => {
    Logger.log('--');
    Logger.log('Nombre: '          + r[headers.indexOf(COL_NOMBRE)]);
    Logger.log('Precio raw: '      + r[headers.indexOf(COL_PRECIO)]    + ' (tipo: ' + typeof r[headers.indexOf(COL_PRECIO)] + ')');
    Logger.log('% mayorista raw: ' + r[headers.indexOf(COL_PCT_MAYORISTA)] + ' (tipo: ' + typeof r[headers.indexOf(COL_PCT_MAYORISTA)] + ')');
  });
}

// ── Helper: respuesta JSON ────────────────────────────────────
function responder(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
