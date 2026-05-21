// ── Configuración ─────────────────────────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyRD4JOYyAtXi4-F7aDZ0BCUmruPAOXJhs47PVnz8wNpwINEYwjIlYbu3m0akadYAY9/exec';

// Fallback de cantidades si la categoría no tiene configuración
const CANTIDADES = [0, 1, 6, 12, 24, 48, 72, 96];

// ── Estado de la app ───────────────────────────────────────────
let productosData = [];

// ── Inicialización ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  cargarProductos();
  document.getElementById('pedidoForm').addEventListener('submit', handleSubmit);
});

// ── Carga productos desde Apps Script ─────────────────────────
async function cargarProductos() {
  const contenedor = document.getElementById('productosContenedor');
  contenedor.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      Cargando productos…
    </div>`;

  try {
    const res  = await fetch(APPS_SCRIPT_URL + '?action=productos');
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      contenedor.innerHTML = `<div class="error-state">No hay productos disponibles en este momento.</div>`;
      return;
    }

    productosData = data;
    renderProductos(data, contenedor);
  } catch (err) {
    contenedor.innerHTML = `
      <div class="error-state">
        No se pudo cargar el catálogo. Revisá tu conexión e intentá recargar la página.
      </div>`;
    console.error('Error al cargar productos:', err);
  }
}

// ── Renderiza los productos agrupados por categoría ────────────
function renderProductos(productos, contenedor) {
  const grupos = {};
  productos.forEach(p => {
    if (!grupos[p.categoria]) grupos[p.categoria] = [];
    grupos[p.categoria].push(p);
  });

  contenedor.innerHTML = '';

  Object.entries(grupos).forEach(([categoria, items]) => {
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `<h2 class="card-title">${escapeHtml(categoria)}</h2>
                      <div class="products-list"></div>`;
    const lista = card.querySelector('.products-list');
    items.forEach(p => lista.appendChild(crearFilaProducto(p)));
    contenedor.appendChild(card);
  });
}

// ── Crea una fila de producto con botones de cantidad ──────────
function crearFilaProducto(producto) {
  const row = document.createElement('div');
  row.className = 'product-row';
  row.dataset.codigo    = producto.codigo;
  row.dataset.nombre    = producto.nombre;
  row.dataset.categoria = producto.categoria;
  row.dataset.cantidad  = '0';

  const precioHtml = producto.precio_mayorista
    ? `<span class="product-price">$ ${formatPrecio(producto.precio_mayorista)} <small>c/u</small></span>`
    : '';

  const opciones = producto.cantidades || CANTIDADES;
  const botonesHtml = opciones.map(c =>
    `<button type="button"
             class="qty-btn${c === 0 ? ' qty-btn-zero active' : ''}"
             data-qty="${c}">
       ${c === 0 ? '×' : c}
     </button>`
  ).join('');

  row.innerHTML = `
    <div class="product-info">
      <span class="product-name">${escapeHtml(producto.nombre)}</span>
      ${precioHtml}
    </div>
    <div class="product-qty-row">
      <div class="qty-buttons">${botonesHtml}</div>
      <span class="product-row-total hidden"></span>
    </div>`;

  const totalEl = row.querySelector('.product-row-total');

  row.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      row.querySelectorAll('.qty-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const qty = Number(btn.dataset.qty);
      row.dataset.cantidad = qty;

      if (qty > 0 && producto.precio_mayorista) {
        totalEl.textContent = '= $ ' + formatPrecio(qty * producto.precio_mayorista);
        totalEl.classList.remove('hidden');
      } else {
        totalEl.classList.add('hidden');
      }

      actualizarResumen();
    });
  });

  return row;
}

// ── Actualiza el resumen visible antes del botón ───────────────
function actualizarResumen() {
  const resumen = document.getElementById('resumen');
  const pedido  = obtenerProductosPedido();

  if (pedido.length === 0) {
    resumen.classList.add('hidden');
    return;
  }

  const liItems = pedido.map(p => {
    const subtotalStr = p.precio_mayorista > 0
      ? `$ ${formatPrecio(p.precio_mayorista * p.cantidad)}`
      : '';
    return `<li>
      <span class="resumen-nombre">${escapeHtml(p.nombre)}</span>
      <span class="resumen-qty">${p.cantidad} u.</span>
      <span class="resumen-subtotal">${subtotalStr}</span>
    </li>`;
  }).join('');

  const totalPedido = pedido.reduce((s, p) => s + (p.precio_mayorista || 0) * p.cantidad, 0);
  const totalHtml = totalPedido > 0
    ? `<div class="resumen-grand-total">
         <span class="resumen-total-label">Total</span>
         <span></span>
         <span class="resumen-total-amount">$ ${formatPrecio(totalPedido)}</span>
       </div>`
    : '';

  resumen.innerHTML = `
    <p class="resumen-title">Tu pedido</p>
    <ul class="resumen-items">${liItems}</ul>
    ${totalHtml}
    <p class="resumen-count">${pedido.length} producto${pedido.length !== 1 ? 's' : ''} seleccionado${pedido.length !== 1 ? 's' : ''}</p>`;

  resumen.classList.remove('hidden');
}

// ── Devuelve solo los productos con cantidad > 0 ───────────────
function obtenerProductosPedido() {
  return Array.from(document.querySelectorAll('.product-row'))
    .map(row => {
      const meta = productosData.find(p => p.codigo === row.dataset.codigo);
      return {
        codigo:           row.dataset.codigo,
        nombre:           row.dataset.nombre,
        categoria:        row.dataset.categoria,
        cantidad:         Number(row.dataset.cantidad || 0),
        precio_mayorista: meta?.precio_mayorista || 0,
      };
    })
    .filter(p => p.cantidad > 0);
}

// ── Envío del formulario ───────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  limpiarErrores();

  const nombre       = document.getElementById('nombre').value.trim();
  const telefono     = document.getElementById('telefono').value.trim();
  const tipo_entrega = document.getElementById('tipo_entrega').value;
  const productos    = obtenerProductosPedido();
  let valido         = true;

  if (!nombre) {
    mostrarErrorCampo('nombre', 'El nombre es obligatorio.');
    valido = false;
  }

  if (productos.length === 0) {
    mostrarErrorBanner('Seleccioná al menos un producto antes de enviar.');
    valido = false;
  }

  if (!valido) {
    document.querySelector('.error, .form-error-banner')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const btn = document.getElementById('btnEnviar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-inline"></span>Enviando…';

  const payload = {
    nombre,
    telefono,
    tipo_entrega,
    direccion:     document.getElementById('direccion').value.trim(),
    observaciones: document.getElementById('observaciones').value.trim(),
    productos,
  };

  try {
    let codigoPedido = null;
    let enviado      = false;

    try {
      const res  = await fetch(APPS_SCRIPT_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'text/plain' },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        codigoPedido = data.codigo;
        enviado      = true;
      } else {
        throw new Error(data.error || 'Respuesta inesperada del servidor');
      }
    } catch (corsErr) {
      console.warn('Reintentando sin CORS:', corsErr.message);
      await fetch(APPS_SCRIPT_URL, {
        method:  'POST',
        mode:    'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body:    JSON.stringify(payload),
      });
      enviado = true;
    }

    if (enviado) {
      mostrarModal(codigoPedido);
    }

  } catch (err) {
    mostrarErrorBanner('Hubo un error al enviar el pedido. Revisá tu conexión e intentá de nuevo.');
    console.error('Error al enviar:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar Pedido';
  }
}

// ── Modal de confirmación ──────────────────────────────────────
function mostrarModal(codigo) {
  document.getElementById('orderCode').textContent = codigo;
  document.getElementById('successModal').classList.remove('hidden');
}

function cerrarModal() {
  document.getElementById('successModal').classList.add('hidden');
  document.getElementById('pedidoForm').reset();
  document.querySelectorAll('.product-row').forEach(row => {
    row.dataset.cantidad = '0';
    row.querySelectorAll('.qty-btn').forEach(b => b.classList.remove('active'));
    const zeroBtn = row.querySelector('.qty-btn-zero');
    if (zeroBtn) zeroBtn.classList.add('active');
  });
  actualizarResumen();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Helpers de validación ──────────────────────────────────────
function limpiarErrores() {
  document.querySelectorAll('.field-error').forEach(el => el.remove());
  document.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
  document.querySelectorAll('.form-error-banner').forEach(el => el.remove());
}

function mostrarErrorCampo(id, mensaje) {
  const input = document.getElementById(id);
  input.classList.add('error');
  const err = document.createElement('span');
  err.className   = 'field-error';
  err.textContent = mensaje;
  input.parentElement.appendChild(err);
}

function mostrarErrorBanner(mensaje) {
  const banner = document.createElement('div');
  banner.className   = 'form-error-banner';
  banner.textContent = mensaje;
  document.getElementById('resumen').before(banner);
}

// ── Formato de precio (estilo AR: $1.250) ─────────────────────
function formatPrecio(n) {
  return Number(n).toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// ── Utilidad: escapar HTML ─────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
