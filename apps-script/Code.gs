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
const CATEGORIES_TAB     = 'Categories';
const COL_UNIDADES       = 'Unidades';

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
  const ss = SpreadsheetApp.openById(APPSHEET_SHEET_ID);

  // Mapa categoría → array de cantidades
  const catMap = {};
  const sheetCat = ss.getSheetByName(CATEGORIES_TAB);
  if (sheetCat) {
    const [catHeaders, ...catRows] = sheetCat.getDataRange().getValues();
    const idxNombre = catHeaders.indexOf('Category');
    const idxU      = catHeaders.indexOf(COL_UNIDADES);
    if (idxU >= 0 && idxNombre >= 0) {
      catRows.forEach(r => {
        const nombre = String(r[idxNombre]).trim();
        if (!nombre) return;
        const nums = String(r[idxU]).split(',')
          .map(n => parseInt(n.trim(), 10))
          .filter(n => !isNaN(n));
        if (!nums.includes(0)) nums.unshift(0);
        catMap[nombre] = nums;
      });
    }
  }

  const CANTIDADES_DEFAULT = [0, 1, 6, 12, 24, 48, 72, 96];

  const sheet = ss.getSheetByName(PRODUCTOS_TAB_NAME);
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

      const categoria = String(r[idx.categoria]).trim();
      return {
        codigo:           String(r[idx.codigo]).trim(),
        nombre:           String(r[idx.nombre]).trim(),
        categoria:        categoria,
        precio_mayorista: precioMay,
        cantidades:       catMap[categoria] || CANTIDADES_DEFAULT,
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

  const codigo    = generarCodigo(sheetTx);
  const fechahora = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy HH:mm');
  const fecha     = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy');

  // Observaciones enriquecidas con datos de contacto
  const obs = [
    data.observaciones || '',
    data.telefono  ? 'Tel: ' + data.telefono  : '',
    data.direccion ? 'Dir: ' + data.direccion : '',
  ].filter(Boolean).join(' | ');

  // ── 1 fila en Transactions ────────────────────────────────
  // Orden de columnas: UniqueID, Fecha, Proveedor/Cliente, Tipo de transaccion,
  // Precio, Estado, Observaciones, Crear pdf?, Version, Link, Vendedor,
  // Comisión vendedor (%), Comisión vendedor ($), Flete, Duplicar, Fechahora,
  // Link generado, Imagen generada, Tipo de entrega
  sheetTx.appendRow([
    codigo,                    // UniqueID
    fechahora,                 // Fecha
    data.nombre,               // Proveedor/Cliente
    'VENTA',                   // Tipo de transaccion
    'MAYORISTA',               // Precio
    'NUEVO PEDIDO',            // Estado
    obs,                       // Observaciones
    '',                        // Crear pdf?
    '',                        // Version
    '',                        // Link
    '',                        // Vendedor
    '',                        // Comisión vendedor (%)
    '',                        // Comisión vendedor ($)
    '',                        // Flete
    '',                        // Duplicar
    fechahora,                 // Fechahora
    '',                        // Link generado
    '',                        // Imagen generada
    data.tipo_entrega || '',   // Tipo de entrega
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
      generarUUID(),      // UniqueID
      codigo,             // RefID → referencia a Transactions
      data.nombre,        // Proveedor/Cliente
      p.codigo,           // Codigo
      'VENTA',            // Tipo de movimiento
      fechahora,          // Fecha
      Number(p.cantidad), // Cantidad
      precioUnit,         // Precio lista
      0,                  // % descuento
      precioUnit,         // Precio unitario
      p.nombre,           // Detalle producto
      p.categoria,        // Categoría
      '',                 // Precio de compra (solo para compras)
      precioTotal,        // Precio total
      'Sin lote',         // Lote
    ]);
  });

  enviarMailPedido(codigo, fechahora, data, productosConCantidad);

  return codigo;
}

// ── Lee destinatarios desde la pestaña "Datos mail" ──────────
function getDestinatarios(detalle) {
  const sheet = SpreadsheetApp.openById(APPSHEET_SHEET_ID).getSheetByName('Datos mail');
  if (!sheet) return '';
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === detalle) return String(rows[i][1]).trim();
  }
  return '';
}

// ── Envía notificación de nuevo pedido por mail ───────────────
function enviarMailPedido(codigo, fechahora, data, productos) {
  try {
    const DESTINATARIOS = getDestinatarios('Notificacion nuevo envio');
    if (!DESTINATARIOS) { Logger.log('Sin destinatarios configurados en "Datos mail".'); return; }

    if (!productos || !Array.isArray(productos)) {
      productos = (data.productos || []).filter(p => Number(p.cantidad) > 0);
    }

    const total = productos.reduce((s, p) => s + (Number(p.precio_mayorista) || 0) * Number(p.cantidad), 0);

    const filasProductos = productos.map(p => {
      const subtotal = (Number(p.precio_mayorista) || 0) * Number(p.cantidad);
      return `
        <tr>
          <td style="padding:9px 12px;border-bottom:1px solid #E5E7EB;font-size:13px;">${p.codigo}</td>
          <td style="padding:9px 12px;border-bottom:1px solid #E5E7EB;font-size:13px;">${p.nombre}</td>
          <td style="padding:9px 12px;border-bottom:1px solid #E5E7EB;font-size:13px;text-align:center;">${p.cantidad}</td>
          <td style="padding:9px 12px;border-bottom:1px solid #E5E7EB;font-size:13px;text-align:right;">$ ${Number(p.precio_mayorista).toLocaleString('es-AR')}</td>
          <td style="padding:9px 12px;border-bottom:1px solid #E5E7EB;font-size:13px;text-align:right;font-weight:700;">$ ${subtotal.toLocaleString('es-AR')}</td>
        </tr>`;
    }).join('');

    const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.10);">

    <div style="background:#FFE500;padding:20px 28px;display:flex;align-items:center;justify-content:space-between;">
      <img src="https://acdn-us.mitiendanube.com/stores/005/821/939/themes/common/logo-1951200950-1739356298-6be1913107e967b9582522cb6ccf771a1739356298.png?0"
           alt="Snack Fan" style="height:64px;">
      <div style="text-align:right;">
        <div style="font-size:1.3rem;font-weight:900;color:#CC1100;text-transform:uppercase;letter-spacing:1px;">Nuevo pedido</div>
        <div style="font-size:0.82rem;color:#333;margin-top:2px;">Código</div>
        <div style="font-size:1.1rem;font-weight:900;color:#CC1100;">${codigo}</div>
      </div>
    </div>

    <div style="background:#CC1100;padding:7px 28px;font-size:0.72rem;font-weight:800;color:#fff;letter-spacing:2px;text-transform:uppercase;">
      NUEVO PEDIDO DESDE LA WEB &nbsp;·&nbsp; ${fechahora}
    </div>

    <div style="padding:24px 28px;">
      <table style="width:100%;border-collapse:collapse;border:1.5px solid #E5E7EB;border-radius:6px;margin-bottom:24px;">
        <tr>
          <td style="padding:10px 14px;border-bottom:1px solid #E5E7EB;border-right:1px solid #E5E7EB;width:50%;">
            <div style="font-size:0.68rem;font-weight:800;color:#6B7280;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:2px;">👤 Cliente</div>
            <div style="font-size:0.9rem;font-weight:600;">${data.nombre || '—'}</div>
          </td>
          <td style="padding:10px 14px;border-bottom:1px solid #E5E7EB;">
            <div style="font-size:0.68rem;font-weight:800;color:#6B7280;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:2px;">📞 Teléfono</div>
            <div style="font-size:0.9rem;font-weight:600;">${data.telefono || '—'}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:10px 14px;border-bottom:1px solid #E5E7EB;border-right:1px solid #E5E7EB;">
            <div style="font-size:0.68rem;font-weight:800;color:#6B7280;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:2px;">🚚 Tipo de entrega</div>
            <div style="font-size:0.9rem;font-weight:600;">${data.tipo_entrega || '—'}</div>
          </td>
          <td style="padding:10px 14px;border-bottom:1px solid #E5E7EB;">
            <div style="font-size:0.68rem;font-weight:800;color:#6B7280;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:2px;">🗺️ Dirección</div>
            <div style="font-size:0.9rem;font-weight:600;">${data.direccion || '—'}</div>
          </td>
        </tr>
        <tr>
          <td colspan="2" style="padding:10px 14px;">
            <div style="font-size:0.68rem;font-weight:800;color:#6B7280;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:2px;">📝 Observaciones</div>
            <div style="font-size:0.9rem;font-weight:600;">${data.observaciones || '—'}</div>
          </td>
        </tr>
      </table>

      <div style="font-size:0.72rem;font-weight:800;color:#CC1100;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Detalle del pedido</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <thead>
          <tr style="background:#F5F5F5;">
            <th style="padding:9px 12px;font-size:0.72rem;font-weight:800;text-transform:uppercase;color:#6B7280;border-bottom:2px solid #E5E7EB;text-align:left;">Código</th>
            <th style="padding:9px 12px;font-size:0.72rem;font-weight:800;text-transform:uppercase;color:#6B7280;border-bottom:2px solid #E5E7EB;text-align:left;">Descripción</th>
            <th style="padding:9px 12px;font-size:0.72rem;font-weight:800;text-transform:uppercase;color:#6B7280;border-bottom:2px solid #E5E7EB;text-align:center;">Cant.</th>
            <th style="padding:9px 12px;font-size:0.72rem;font-weight:800;text-transform:uppercase;color:#6B7280;border-bottom:2px solid #E5E7EB;text-align:right;">Precio u.</th>
            <th style="padding:9px 12px;font-size:0.72rem;font-weight:800;text-transform:uppercase;color:#6B7280;border-bottom:2px solid #E5E7EB;text-align:right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${filasProductos}
        </tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
        <div style="border:2px solid #E5E7EB;border-radius:6px;overflow:hidden;min-width:200px;">
          <div style="background:#F5F5F5;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:24px;">
            <span style="font-size:0.75rem;font-weight:800;color:#6B7280;text-transform:uppercase;letter-spacing:0.8px;">Total pedido</span>
            <span style="font-size:1.2rem;font-weight:900;color:#CC1100;">$ ${total.toLocaleString('es-AR')}</span>
          </div>
        </div>
      </div>
    </div>

    <div style="border-top:1.5px solid #E5E7EB;background:#F5F5F5;padding:14px 28px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:0.75rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;">Snack Fan Distribuidora</span>
      <span style="font-size:0.72rem;color:#9CA3AF;font-style:italic;">Documento no válido como factura</span>
    </div>

  </div>
</body>
</html>`;

    MailApp.sendEmail({
      to:       DESTINATARIOS,
      subject:  '🛒 Nuevo pedido desde la web — ' + codigo + ' — ' + (data.nombre || ''),
      htmlBody: html,
      name:     'Snack Fan Distribuidora',
    });

  } catch(e) {
    Logger.log('Error al enviar mail de notificación: ' + e.message);
  }
}

// ── Test: ejecutar manualmente para autorizar MailApp ────────
function testMail() {
  const dest = getDestinatarios('Notificacion nuevo envio');
  if (!dest) { Logger.log('No se encontraron destinatarios en la hoja "Datos mail".'); return; }
  MailApp.sendEmail({
    to:       dest,
    subject:  'Test autorización — Snack Fan',
    body:     'Si recibís este mail, el envío automático de pedidos está funcionando.',
    name:     'Snack Fan Distribuidora',
  });
  Logger.log('Mail de prueba enviado a: ' + dest);
}

// ── Genera código SF-YYYYMMDD-NNN buscando en Transactions ───
function generarCodigo(sheetTx) {
  const hoy     = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyyMMdd');
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

// ── Diagnóstico: verificar precios ───────────────────────────
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

// ── Diagnóstico: verificar categorías y cantidades ───────────
function testCategorias() {
  const ss = SpreadsheetApp.openById(APPSHEET_SHEET_ID);

  const sheetCat = ss.getSheetByName(CATEGORIES_TAB);
  if (!sheetCat) { Logger.log('ERROR: No se encontró la pestaña "' + CATEGORIES_TAB + '"'); return; }

  const [catHeaders, ...catRows] = sheetCat.getDataRange().getValues();
  Logger.log('Encabezados Categories: ' + JSON.stringify(catHeaders));
  Logger.log('Índice columna "' + COL_UNIDADES + '": ' + catHeaders.indexOf(COL_UNIDADES));

  catRows.forEach((r, i) => {
    Logger.log('Fila ' + (i+2) + ' — col[0]: "' + r[0] + '" | Category: "' + r[catHeaders.indexOf('Category')] + '" | Unidades raw: "' + r[catHeaders.indexOf(COL_UNIDADES)] + '"');
  });

  const sheetItems = ss.getSheetByName(PRODUCTOS_TAB_NAME);
  const [itemHeaders, ...itemRows] = sheetItems.getDataRange().getValues();
  const idxCat = itemHeaders.indexOf(COL_CATEGORIA);
  const categoriasEnItems = [...new Set(itemRows.map(r => String(r[idxCat]).trim()))];
  Logger.log('Categorías en items: ' + JSON.stringify(categoriasEnItems));
}

// ── Helper: respuesta JSON ────────────────────────────────────
function responder(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
