// ── Configuración ─────────────────────────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyRD4JOYyAtXi4-F7aDZ0BCUmruPAOXJhs47PVnz8wNpwINEYwjIlYbu3m0akadYAY9/exec';

// Fallback de cantidades si la categoría no tiene configuración
const CANTIDADES = [0, 1, 6, 12, 24, 48, 72, 96];

// Clave del borrador guardado en el navegador
const BORRADOR_KEY   = 'snackfan_pedido_borrador';
const CAMPOS_CLIENTE = ['nombre', 'telefono', 'tipo_entrega', 'direccion', 'observaciones'];

// ── Estado de la app ───────────────────────────────────────────
let productosData = [];
// ID del intento de envío. Se mantiene mientras el pedido no cambie,
// así un reintento no crea un pedido duplicado en el servidor.
let pedidoId = null;
let enviando = false;
let envioVisible = false;

// ── Inicialización ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pedidoForm').addEventListener('submit', handleSubmit);

  // El buscador queda fijo justo debajo del encabezado (que también es fijo)
  const ajustarAlturaHeader = () => {
    const h = document.querySelector('.header').offsetHeight;
    document.documentElement.style.setProperty('--header-h', h + 'px');
  };
  const header = document.querySelector('.header');
  ajustarAlturaHeader();
  window.addEventListener('resize', ajustarAlturaHeader);
  if (window.ResizeObserver) new ResizeObserver(ajustarAlturaHeader).observe(header);

  // Encabezado compacto al bajar. Umbrales distintos para achicar y
  // agrandar, así no titila cerca del límite.
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y > 100) header.classList.add('compact');
    else if (y < 10) header.classList.remove('compact');
  }, { passive: true });

  // La barra del total se oculta cuando el resumen ya está a la vista
  const seccionEnvio = document.querySelector('.submit-section');
  if (window.IntersectionObserver) {
    new IntersectionObserver(([entry]) => {
      envioVisible = entry.isIntersecting;
      actualizarBarra();
    }).observe(seccionEnvio);
  }
  document.getElementById('btnVerPedido').addEventListener('click', () => {
    seccionEnvio.scrollIntoView({ behavior: 'smooth', block: 'end' });
  });

  // Cualquier cambio en los datos del cliente se guarda en el borrador
  CAMPOS_CLIENTE.forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      pedidoId = null;
      guardarBorrador();
    });
  });

  document.getElementById('buscador').addEventListener('input', e => filtrarProductos(e.target.value));
  document.getElementById('buscadorLimpiar').addEventListener('click', () => {
    const input = document.getElementById('buscador');
    input.value = '';
    filtrarProductos('');
    input.focus();
  });
  document.getElementById('btnDescartar').addEventListener('click', descartarBorrador);

  const borrador = leerBorrador();
  if (borrador) restaurarCamposCliente(borrador);

  cargarProductos(borrador);
});

// ── Carga productos desde Apps Script ─────────────────────────
async function cargarProductos(borrador) {
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
    document.getElementById('buscadorCard').classList.remove('hidden');
    if (borrador) restaurarCantidades(borrador);
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
    card.className = 'card product-category';
    card.innerHTML = `<h2 class="card-title">${escapeHtml(categoria)}</h2>
                      <div class="products-list"></div>`;
    const lista = card.querySelector('.products-list');
    items.forEach(p => lista.appendChild(crearFilaProducto(p)));
    contenedor.appendChild(card);
  });

  const vacio = document.createElement('div');
  vacio.id = 'sinResultados';
  vacio.className = 'card empty-search hidden';
  contenedor.appendChild(vacio);
}

// ── Crea una fila de producto con botones de cantidad ──────────
function crearFilaProducto(producto) {
  const row = document.createElement('div');
  row.className = 'product-row';
  row.dataset.codigo    = producto.codigo;
  row.dataset.nombre    = producto.nombre;
  row.dataset.categoria = producto.categoria;
  row.dataset.busqueda  = normalizar(producto.nombre + ' ' + producto.codigo + ' ' + producto.categoria);
  row.dataset.cantidad  = '0';

  const precioHtml = producto.precio_mayorista
    ? `<span class="product-price">$ ${formatPrecio(producto.precio_mayorista)} <small>c/u</small></span>`
    : '';

  const opciones = producto.cantidades || CANTIDADES;
  const botonesHtml = opciones.map(c =>
    `<button type="button"
             class="qty-btn${c === 0 ? ' qty-btn-zero active' : ''}"
             data-qty="${c}"
             aria-label="${c === 0 ? 'Quitar ' + escapeHtml(producto.nombre) : c + ' unidades'}">
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

  row.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setCantidad(row, Number(btn.dataset.qty));
      pedidoId = null;
      actualizarResumen();
      guardarBorrador();
    });
  });

  return row;
}

// ── Marca una cantidad en una fila y actualiza su subtotal ─────
function setCantidad(row, qty) {
  const btn = row.querySelector(`.qty-btn[data-qty="${qty}"]`);
  if (!btn) return false;

  row.querySelectorAll('.qty-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  row.dataset.cantidad = qty;
  row.classList.toggle('selected', qty > 0);

  const producto = productosData.find(p => p.codigo === row.dataset.codigo);
  const totalEl  = row.querySelector('.product-row-total');
  if (qty > 0 && producto?.precio_mayorista) {
    totalEl.textContent = '= $ ' + formatPrecio(qty * producto.precio_mayorista);
    totalEl.classList.remove('hidden');
  } else {
    totalEl.classList.add('hidden');
  }
  return true;
}

// ── Buscador ───────────────────────────────────────────────────
function filtrarProductos(texto) {
  const terminos = normalizar(texto).split(/\s+/).filter(Boolean);
  let visibles = 0;

  document.querySelectorAll('.product-category').forEach(card => {
    let visiblesCat = 0;
    card.querySelectorAll('.product-row').forEach(row => {
      const coincide = terminos.every(t => row.dataset.busqueda.includes(t));
      row.classList.toggle('hidden', !coincide);
      if (coincide) visiblesCat++;
    });
    card.classList.toggle('hidden', visiblesCat === 0);
    visibles += visiblesCat;
  });

  const vacio = document.getElementById('sinResultados');
  if (vacio) {
    vacio.textContent = `No encontramos productos para "${texto.trim()}".`;
    vacio.classList.toggle('hidden', visibles > 0 || terminos.length === 0);
  }
  document.getElementById('buscadorLimpiar').classList.toggle('hidden', texto === '');
}

// Minúsculas y sin acentos, para que "turron" encuentre "Turrón"
function normalizar(str) {
  return String(str).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ── Actualiza el resumen visible antes del botón ───────────────
function actualizarResumen() {
  const resumen = document.getElementById('resumen');
  const pedido  = obtenerProductosPedido();

  actualizarBarra(pedido);

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

// ── Barra fija con cantidad de productos y total ───────────────
function actualizarBarra(pedido = obtenerProductosPedido()) {
  const barra   = document.getElementById('barraPedido');
  const hayItems = pedido.length > 0;

  if (hayItems) {
    const total = pedido.reduce((s, p) => s + (p.precio_mayorista || 0) * p.cantidad, 0);
    const unidades = pedido.reduce((s, p) => s + p.cantidad, 0);
    document.getElementById('barraCantidad').textContent =
      `${pedido.length} producto${pedido.length !== 1 ? 's' : ''} · ${unidades} u.`;
    document.getElementById('barraTotal').textContent = total > 0 ? '$ ' + formatPrecio(total) : '';
  }

  barra.classList.toggle('oculta', !hayItems || envioVisible);
  document.body.classList.toggle('con-barra', hayItems);
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
  if (enviando) return;
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

  // Mismo ID mientras el pedido no cambie: si el primer intento sí se
  // grabó pero la respuesta no llegó, el reintento no lo duplica.
  if (!pedidoId) {
    pedidoId = generarId();
    guardarBorrador();
  }

  const btn = document.getElementById('btnEnviar');
  enviando = true;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-inline"></span>Enviando…';

  const payload = {
    pedido_id:     pedidoId,
    nombre,
    telefono,
    tipo_entrega,
    direccion:     document.getElementById('direccion').value.trim(),
    observaciones: document.getElementById('observaciones').value.trim(),
    productos,
  };

  try {
    const res  = await fetch(APPS_SCRIPT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();

    if (!data.success || !data.codigo) {
      throw new Error(data.error || 'Respuesta inesperada del servidor');
    }

    borrarBorrador();
    mostrarModal(data.codigo);
  } catch (err) {
    // No se reenvía en silencio: el cliente reintenta con el mismo ID.
    mostrarErrorBanner('No pudimos confirmar tu pedido. Revisá tu conexión y tocá "Enviar pedido" de nuevo. Si ya se había registrado, no se va a duplicar.');
    document.querySelector('.form-error-banner')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    console.error('Error al enviar:', err);
  } finally {
    enviando = false;
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
  vaciarPedido();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Deja el formulario en blanco, sin productos elegidos
function vaciarPedido() {
  document.getElementById('pedidoForm').reset();
  document.querySelectorAll('.product-row').forEach(row => setCantidad(row, 0));
  document.getElementById('buscador').value = '';
  filtrarProductos('');
  pedidoId = null;
  limpiarErrores();
  actualizarResumen();
}

// ── Borrador en el navegador ───────────────────────────────────
function guardarBorrador() {
  const cantidades = {};
  document.querySelectorAll('.product-row').forEach(row => {
    const qty = Number(row.dataset.cantidad || 0);
    if (qty > 0) cantidades[row.dataset.codigo] = qty;
  });

  const campos = {};
  CAMPOS_CLIENTE.forEach(id => { campos[id] = document.getElementById(id).value; });

  const vacio = Object.keys(cantidades).length === 0 && Object.values(campos).every(v => !v.trim());
  if (vacio) return borrarBorrador();

  try {
    localStorage.setItem(BORRADOR_KEY, JSON.stringify({ campos, cantidades, pedidoId, guardado: Date.now() }));
  } catch (_) { /* navegador sin almacenamiento: se sigue sin borrador */ }
}

function leerBorrador() {
  try {
    const raw = localStorage.getItem(BORRADOR_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function borrarBorrador() {
  try { localStorage.removeItem(BORRADOR_KEY); } catch (_) { /* nada */ }
  document.getElementById('avisoBorrador').classList.add('hidden');
}

function restaurarCamposCliente(borrador) {
  CAMPOS_CLIENTE.forEach(id => {
    if (borrador.campos?.[id]) document.getElementById(id).value = borrador.campos[id];
  });
  pedidoId = borrador.pedidoId || null;
}

function restaurarCantidades(borrador) {
  let recuperados = 0;
  Object.entries(borrador.cantidades || {}).forEach(([codigo, qty]) => {
    const row = Array.from(document.querySelectorAll('.product-row'))
      .find(r => r.dataset.codigo === codigo);
    if (row && setCantidad(row, qty)) recuperados++;
  });
  actualizarResumen();

  const hayCampos = Object.values(borrador.campos || {}).some(v => v && v.trim());
  if (recuperados > 0 || hayCampos) {
    document.getElementById('avisoBorrador').classList.remove('hidden');
  }
}

function descartarBorrador() {
  vaciarPedido();
  borrarBorrador();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function generarId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
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
