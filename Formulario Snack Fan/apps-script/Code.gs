// ============================================================
//  SNACK FAN — Formulario Mayorista
//  Google Apps Script · Web App
//
//  SETUP:
//  1. Pegar este código en script.google.com (nuevo proyecto)
//  2. Completar los IDs de hoja a continuación
//  3. Desplegar > Nueva implementación > Web App
//     · Ejecutar como: Yo
//     · Acceso: Cualquier persona
//  4. Copiar la URL del despliegue → pegarla en js/script.js
// ============================================================

const PRODUCTOS_SHEET_ID  = '1rY3gZy06vpngQtY4S7jp36FjDwmc0224Yy5YnUhAgqo';
const PRODUCTOS_TAB_NAME  = 'items';
const PEDIDOS_SHEET_ID    = '1s_OWyR_Cp7dvLFpUtuBLDpUe1g__w8pOrXAZ08CPY-w';
const PEDIDOS_TAB_NAME    = 'Pedidos';

// Nombres exactos de las columnas en la hoja de productos
const COL_CODIGO          = 'Codigo';
const COL_NOMBRE          = 'Nombre';
const COL_CATEGORIA       = 'Categoría';
const COL_MOSTRAR         = 'Mostrar_Formulario';
const COL_PRECIO          = 'Precio';
const COL_PCT_MAYORISTA   = '% venta mayorista';

// ── GET: devuelve lista de productos activos ──────────────────
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;

  if (action === 'productos') {
    return responder(getProductos());
  }

  return responder({ ok: true, msg: 'Snack Fan API' });
}

// ── POST: recibe y graba un pedido ────────────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const codigo  = grabarPedido(payload);
    return responder({ success: true, codigo: codigo });
  } catch (err) {
    return responder({ success: false, error: err.message }, true);
  }
}

// ── Lee los productos con Mostrar_Formulario = TRUE ───────────
function getProductos() {
  const sheet  = SpreadsheetApp.openById(PRODUCTOS_SHEET_ID)
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
      // Precio: Sheets devuelve número si la celda es numérica
      const precioRaw  = r[idx.precio];
      const precio     = typeof precioRaw === 'number'
        ? precioRaw
        : parseFloat(String(precioRaw).replace(',', '.').replace(/[^\d.]/g, '')) || 0;

      // % venta mayorista: Sheets guarda porcentajes como decimal (35% → 0.35)
      const pctRaw     = r[idx.pctMayorista];
      const pct        = typeof pctRaw === 'number'
        ? pctRaw
        : parseFloat(String(pctRaw).replace('%', '').replace(',', '.').trim()) / 100 || 0;

      const precioMay  = precio > 0 ? Math.round(precio * (1 + pct)) : null;

      return {
        codigo:           String(r[idx.codigo]).trim(),
        nombre:           String(r[idx.nombre]).trim(),
        categoria:        String(r[idx.categoria]).trim(),
        precio_mayorista: precioMay,
      };
    });
}

// ── Escribe una fila por producto en la hoja Pedidos ─────────
function grabarPedido(data) {
  const ss    = SpreadsheetApp.openById(PEDIDOS_SHEET_ID);
  let sheet   = ss.getSheetByName(PEDIDOS_TAB_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(PEDIDOS_TAB_NAME);
    sheet.appendRow([
      'Codigo_Pedido', 'Fecha', 'Nombre_Cliente', 'Telefono',
      'Direccion', 'Observaciones',
      'Codigo_Producto', 'Producto', 'Categoria', 'Cantidad'
    ]);
    sheet.setFrozenRows(1);
  }

  const codigo = generarCodigo(sheet);
  const fecha  = Utilities.formatDate(
    new Date(),
    'America/Argentina/Buenos_Aires',
    'dd/MM/yyyy HH:mm'
  );

  const productosConCantidad = data.productos.filter(p => Number(p.cantidad) > 0);
  if (productosConCantidad.length === 0) {
    throw new Error('El pedido no tiene productos con cantidad mayor a 0.');
  }

  productosConCantidad.forEach(p => {
    sheet.appendRow([
      codigo,
      fecha,
      data.nombre    || '',
      data.telefono  || '',
      data.direccion || '',
      data.observaciones || '',
      p.codigo   || '',
      p.nombre   || '',
      p.categoria || '',
      Number(p.cantidad),
    ]);
  });

  return codigo;
}

// ── Genera código SF-YYYYMMDD-NNN único ──────────────────────
function generarCodigo(sheet) {
  const hoy    = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyyMMdd');
  const prefijo = 'SF-' + hoy + '-';
  const lastRow = sheet.getLastRow();

  let max = 0;
  if (lastRow > 1) {
    const codigos = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    codigos.forEach(c => {
      if (String(c).startsWith(prefijo)) {
        const n = parseInt(String(c).split('-')[2], 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
  }

  return prefijo + String(max + 1).padStart(3, '0');
}

// ── Diagnóstico: ejecutar desde el editor de Apps Script ─────
// Ir a Ejecutar > testPrecio y revisar los logs (Ver > Registros)
function testPrecio() {
  const sheet   = SpreadsheetApp.openById(PRODUCTOS_SHEET_ID).getSheetByName(PRODUCTOS_TAB_NAME);
  const [headers, ...rows] = sheet.getDataRange().getValues();

  Logger.log('Encabezados: ' + JSON.stringify(headers));
  Logger.log('Índice Precio: '         + headers.indexOf(COL_PRECIO));
  Logger.log('Índice % mayorista: '    + headers.indexOf(COL_PCT_MAYORISTA));
  Logger.log('Índice Mostrar: '        + headers.indexOf(COL_MOSTRAR));

  const activos = rows.filter(r => r[headers.indexOf(COL_MOSTRAR)] === true);
  Logger.log('Productos con Mostrar_Formulario=TRUE: ' + activos.length);

  activos.slice(0, 5).forEach(r => {
    const nombre    = r[headers.indexOf(COL_NOMBRE)];
    const precioRaw = r[headers.indexOf(COL_PRECIO)];
    const pctRaw    = r[headers.indexOf(COL_PCT_MAYORISTA)];
    Logger.log('--');
    Logger.log('Nombre: '          + nombre);
    Logger.log('Precio raw: '      + precioRaw + ' (tipo: ' + typeof precioRaw + ')');
    Logger.log('% mayorista raw: ' + pctRaw    + ' (tipo: ' + typeof pctRaw + ')');
  });
}

// ── Helper: respuesta JSON con headers CORS ───────────────────
function responder(obj, esError) {
  const output = ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}
