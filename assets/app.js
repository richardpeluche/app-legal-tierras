/* Tierras EC — lógica de la aplicación
   Flujo: clasificar → recuperar artículos del corpus → enviar al Worker → responder.
   La IA nunca responde de memoria: solo con los artículos que le inyectamos. */

const WORKER_URL = 'https://TU-WORKER.workers.dev'; // ← reemplazar tras desplegar

let CORPUS = null;
let COMUNAS = null;
let CONSULTAS = null;
let SYSTEM = '';
let ruta = null;
let historial = [];

const $ = s => document.querySelector(s);

/* ── Carga de datos ────────────────────────────── */
async function cargar() {
  try {
    const [c, k, q, s] = await Promise.all([
      fetch('data/corpus.json').then(r => r.json()),
      fetch('data/comunas-dmq.json').then(r => r.json()),
      fetch('data/consultas-quito.json').then(r => r.json()),
      fetch('data/system-prompt.md').then(r => r.text())
    ]);
    CORPUS = c; COMUNAS = k; CONSULTAS = q;
    SYSTEM = s + '\n\n## Enlaces oficiales de consulta predial (Quito)\n\n' +
             JSON.stringify(q, null, 1);
    $('#fechaCorte').textContent = formatearFecha(c.meta.fecha_corte);
  } catch (e) {
    console.error('No se pudieron cargar los datos:', e);
    $('#aceptar').disabled = true;
    $('#aceptar').textContent = 'Error al cargar — recargue la página';
  }
}

function formatearFecha(iso) {
  const m = ['enero','febrero','marzo','abril','mayo','junio','julio',
             'agosto','septiembre','octubre','noviembre','diciembre'];
  const [a, mm, d] = iso.split('-');
  return `${+d} de ${m[+mm - 1]} de ${a}`;
}

/* ── Recuperador ───────────────────────────────────
   Puntúa cada artículo contra las palabras de la consulta.
   Nunca sirve artículos con verificado:false. */
const VACIAS = new Set(['de','la','el','los','las','un','una','y','o','que','en',
  'a','mi','se','por','para','con','del','al','es','son','como','si','no','me',
  'lo','su','sus','le','ya','pero','cuando','donde','quien','tengo','tiene']);

const PESO_RUTA = {
  comuna:  ['comuna','comunero','cabildo','ancestral','comunal','minga','sindico','asamblea'],
  urbana:  ['urbano','barrio','lotizacion','municipio','asentamiento','mostrenco','excedente'],
  rural:   ['rural','finca','agrario','chacra','posesion agraria','mag','adjudicacion'],
  duda:    []
};

function normalizar(t) {
  return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/* Puente entre cómo habla el ciudadano y cómo habla la ley.
   Sin esto, "mi terreno mide más que la escritura" no encuentra "excedente". */
const SINONIMOS = {
  'excedente diferencia etam medicion cabida area':
    ['mide mas','mide menos','sobra','mas grande','mas pequeno','no cuadra',
     'no coincide','diferencia','metros de mas','le falta','area real'],
  'prescripcion extraordinaria posesion quince':
    ['muchos anos','toda la vida','desde siempre','vivo hace','anos viviendo',
     'nadie reclama','abandonado','quedarme con'],
  'mero tenedor arrendatario':
    ['cuidando','cuidador','me dejaron cuidando','pago arriendo','arrendado',
     'prestado','me prestaron'],
  'invasion posesion violenta clandestina':
    ['invasores','invadieron','se metieron','entraron','tomaron el terreno',
     'ocuparon','traficantes'],
  'titularizacion escritura titulo inscrito':
    ['sin papeles','no tengo escritura','no tengo papeles','sin escrituras',
     'legalizar','papeles del terreno','poner a mi nombre'],
  'particion herencia proindiviso derechos acciones':
    ['herederos','heredamos','herede','repartir','dividir entre','mis hermanos',
     'murio mi papa','murio mi mama','sucesion'],
  'fraccionamiento lote minimo subdivision':
    ['dividir mi terreno','partir el lote','sacar un lote','separar un pedazo'],
  'comuna comunal cabildo ancestral':
    ['la comuna','del cabildo','somos comuneros','tierra de la comuna',
     'compañeros','asamblea','minga','sindico'],
  'adjudicacion posesion agraria estatal':
    ['terreno del estado','tierra baldia','tierras del gobierno','del mag',
     'finca sin papeles']
};

/* Expande la consulta con los términos legales equivalentes. */
function expandir(consulta) {
  const q = normalizar(consulta);
  let extra = [];
  for (const [terminos, frases] of Object.entries(SINONIMOS)) {
    if (frases.some(f => q.includes(normalizar(f)))) extra.push(terminos);
  }
  return extra.length ? consulta + ' ' + extra.join(' ') : consulta;
}

function recuperar(consultaOriginal, n = 8) {
  const consulta = expandir(consultaOriginal);
  const palabras = normalizar(consulta).split(/\W+/)
    .filter(p => p.length > 3 && !VACIAS.has(p));
  const sesgo = PESO_RUTA[ruta] || [];

  return CORPUS.articulos
    .filter(a => a.verificado !== false)
    .map(a => {
      const temas = normalizar((a.temas || []).join(' '));
      const titulo = normalizar(a.titulo);
      const heno = normalizar(
        [a.titulo, (a.temas || []).join(' '), a.contenido,
         a.implicacion_practica || ''].join(' ')
      );
      let score = 0;
      palabras.forEach(p => {
        if (heno.includes(p))   score += 3;
        if (temas.includes(p))  score += 4;
        if (titulo.includes(p)) score += 3;
      });
      sesgo.forEach(s => { if (heno.includes(s)) score += 2; });
      return { a, score };
    })
    .filter(x => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, n)
    .map(x => x.a);
}

/* Si la consulta menciona una parroquia con comuna, se lo avisamos al modelo
   para que PREGUNTE. Nunca para que afirme que el predio es comunal. */
function detectarComunas(consulta) {
  if (!COMUNAS) return '';
  const q = normalizar(consulta);
  const hits = COMUNAS.comunas.filter(c =>
    (c.parroquia && q.includes(normalizar(c.parroquia))) ||
    q.includes(normalizar(c.nombre))
  );
  if (!hits.length) return '';
  const lista = hits.map(c => `${c.nombre} (parroquia ${c.parroquia || '—'})`).join('; ');
  return `\nAviso al asistente: la consulta menciona una parroquia o sector con ` +
         `comunas registradas: ${lista}. PREGUNTE al usuario si su terreno está ` +
         `dentro de la comuna. No lo afirme.\n`;
}

function bloqueCorpus(arts) {
  if (!arts.length) return '<corpus>(sin coincidencias)</corpus>';
  return '<corpus>\n' + arts.map(a =>
    `[${a.norma} — Art. ${a.articulo}] ${a.titulo}\n${a.contenido}` +
    (a.implicacion_practica ? `\nNota práctica: ${a.implicacion_practica}` : '')
  ).join('\n\n') + '\n</corpus>';
}

/* ── Render ────────────────────────────────────── */
const ETIQUETA = {
  comuna: 'Comuna ancestral',
  urbana: 'Zona urbana',
  rural:  'Zona rural',
  duda:   'Por determinar'
};

const SUGERENCIAS = {
  comuna: ['¿Puedo vender mi lote en la comuna?',
           '¿Qué papel me da el cabildo?',
           'Heredé de mi padre, ¿qué hago?',
           'Entraron a un terreno de la comuna'],
  urbana: ['Mi barrio no tiene escrituras',
           'Mi terreno mide más que la escritura',
           'Somos herederos y queremos dividir'],
  rural:  ['Tengo 10 años en un terreno del Estado',
           'Compré una posesión, ¿cuánto espero?',
           '¿Puedo dividir mi finca?'],
  duda:   ['No sé si mi barrio es comuna',
           '¿Cómo averiguo qué tipo de suelo es?']
};

function escapar(t) {
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

/* Convierte citas de artículos en chips y URLs en enlaces. */
function formatear(t) {
  return escapar(t)
    .replace(/\b(Arts?\.\s?[\d.]+(?:\s?(?:y|al|-)\s?[\d.]+)?\s+(?:de\s+la\s+)?[A-ZÁÉÍÓÚ][\wÁÉÍÓÚÑ.-]*(?:\s+[A-ZÁÉÍÓÚ][\wÁÉÍÓÚÑ.-]*)?)/g,
             '<span class="cita">$1</span>')
    .replace(/(https?:\/\/[^\s<)]+)/g,
             '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/^\s*⚠️?\s?(.+)$/gm, '<div class="alerta">$1</div>')
    .split('\n\n').map(p => p.startsWith('<div') ? p : `<p>${p}</p>`).join('');
}

function burbuja(texto, clase) {
  const d = document.createElement('div');
  d.className = `msg ${clase}`;
  d.innerHTML = clase === 'msg-app' ? formatear(texto) : escapar(texto);
  $('#hilo').appendChild(d);
  d.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return d;
}

function pintarSugerencias() {
  const cont = $('#sugeridas');
  cont.innerHTML = '';
  (SUGERENCIAS[ruta] || []).forEach(s => {
    const b = document.createElement('button');
    b.className = 'sug';
    b.textContent = s;
    b.onclick = () => { $('#pregunta').value = s; enviar(); };
    cont.appendChild(b);
  });
}

/* ── Envío ─────────────────────────────────────── */
async function enviar() {
  const q = $('#pregunta').value.trim();
  if (!q || !CORPUS) return;

  $('#pregunta').value = '';
  $('#pregunta').style.height = 'auto';
  $('#enviar').disabled = true;
  burbuja(q, 'msg-user');

  const cargando = document.createElement('div');
  cargando.className = 'pensando';
  cargando.innerHTML = '<span></span><span></span><span></span>';
  $('#hilo').appendChild(cargando);
  cargando.scrollIntoView({ behavior: 'smooth', block: 'end' });

  const arts = recuperar(q);
  const contexto = `Ruta seleccionada por el usuario: ${ETIQUETA[ruta]}.\n` +
                   detectarComunas(q) + '\n' +
                   bloqueCorpus(arts) + `\n\nConsulta: ${q}`;

  historial.push({ role: 'user', content: contexto });

  try {
    const r = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: SYSTEM, messages: historial.slice(-8) })
    });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    const texto = (data.content || [])
      .filter(b => b.type === 'text').map(b => b.text).join('\n');

    cargando.remove();
    burbuja(texto, 'msg-app');
    historial.push({ role: 'assistant', content: texto });
  } catch (e) {
    cargando.remove();
    historial.pop();
    respuestaSinIA(arts);        // respaldo: mostrar los artículos encontrados
  } finally {
    $('#enviar').disabled = false;
    $('#pregunta').focus();
  }
}

/* ── Respaldo sin IA ───────────────────────────────
   Si el Worker no responde (sin conexión o sin desplegar), no dejamos al
   usuario en blanco: mostramos los artículos que el recuperador encontró,
   con su texto y su nota práctica. No redacta ni interpreta: solo cita. */
function respuestaSinIA(arts) {
  if (!arts || !arts.length) {
    burbuja('No pude conectarme al servicio y tampoco encontré artículos que ' +
            'se ajusten a su consulta. Intente describir su caso con otras ' +
            'palabras, o consulte a un abogado.', 'msg-app');
    return;
  }

  const cont = document.createElement('div');
  cont.className = 'msg msg-app';

  let html = '<p><strong>No hay conexión con el servicio, así que le muestro ' +
             'directamente lo que dice la ley sobre su caso.</strong> Este es ' +
             'el texto de las normas, sin explicación adicional:</p>';

  arts.forEach(a => {
    const cita = `Art. ${a.articulo} ${a.norma}`;
    html += `<div class="ficha">` +
            `<span class="cita">${escapar(cita)}</span> ` +
            `<span class="ficha-tit">${escapar(a.titulo)}</span>` +
            `<p class="ficha-txt">${escapar(a.contenido)}</p>` +
            (a.implicacion_practica
              ? `<p class="ficha-nota">En la práctica: ${escapar(a.implicacion_practica)}</p>`
              : '') +
            `</div>`;
  });

  html += '<div class="alerta">Información general basada en la normativa ' +
          'vigente al ' + (CORPUS ? formatearFecha(CORPUS.meta.fecha_corte) : '') +
          '. No sustituye la asesoría de un abogado.</div>';

  cont.innerHTML = html;
  $('#hilo').appendChild(cont);
  cont.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

/* ── Eventos ───────────────────────────────────── */
$('#aceptar').onclick = () => {
  $('#gate').hidden = true;
  $('#rutas').hidden = false;
};

document.querySelectorAll('.parcela').forEach(b => {
  b.onclick = () => {
    ruta = b.dataset.ruta;
    $('#rutas').hidden = true;
    $('#chat').hidden = false;
    $('#rutaActiva').textContent = ETIQUETA[ruta];
    $('#hilo').innerHTML = '';
    historial = [];
    pintarSugerencias();

    if (ruta === 'duda') {
      burbuja('Vamos a ubicarlo. Primero: ¿en el sector donde está el terreno ' +
              'hay cabildo, presidente o síndico?', 'msg-app');
    } else {
      burbuja('Cuénteme su caso. Mientras más detalles me dé sobre el terreno y ' +
              'los papeles que tiene, más precisa será la orientación.', 'msg-app');
    }
    $('#pregunta').focus();
  };
});

$('#volver').onclick = () => {
  $('#chat').hidden = true;
  $('#rutas').hidden = false;
  ruta = null;
  historial = [];
};

$('#form').onsubmit = e => { e.preventDefault(); enviar(); };

$('#pregunta').addEventListener('input', e => {
  e.target.style.height = 'auto';
  e.target.style.height = e.target.scrollHeight + 'px';
});

$('#pregunta').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
});

cargar();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
