# Tierras EC

Orientación informativa sobre terrenos, lotes, adjudicaciones y tierras
comunales en Ecuador. Responde citando los artículos en los que se basa.

**No es asesoría legal.** No redacta demandas ni escrituras, no predice
resultados y no reemplaza a un abogado.

## Cómo funciona

1. El usuario elige dónde está el terreno: comuna ancestral, zona urbana,
   zona rural, o "no estoy seguro".
2. La consulta se busca por palabras clave contra `data/corpus.json`.
3. Los artículos más relevantes se inyectan en el prompt.
4. La IA responde **solo** con esos artículos. Si no están, lo dice.

El paso 3 es lo que separa esta app de un chatbot que inventa leyes.

## Estructura

```
index.html                   Interfaz
assets/style.css             Tokens y estilos
assets/app.js                Clasificador, sinónimos, recuperador y envío
data/corpus.json             Artículos estructurados por norma
data/comunas-dmq.json        73 comunas del Distrito, por zona y parroquia
data/consultas-quito.json    Enlaces oficiales (IRM, ICUS, Tu Ciudad en Línea)
data/system-prompt.md        Reglas de respuesta y límites
worker/worker.js             Proxy de Cloudflare (protege la clave)
sw.js                        Service worker
```

## Consultas prediales

La app **no consulta predios**. Los sistemas del Municipio exigen código de
verificación y no tienen API pública. Lo que hace es entregar el enlace del
IRM y decirle a la persona qué campo mirar para su caso.

El IRM trae el ETAM calculado por predio, el área según escritura, el área
gráfica y si el predio está en derechos y acciones. Con esos cuatro campos se
resuelve la mayoría de consultas sobre excedentes y particiones.

## Sinónimos

El recuperador incluye un mapa que traduce cómo habla el ciudadano a cómo habla
la ley: "mi terreno mide más que la escritura" tiene que encontrar *excedente*;
"me dejaron cuidando" tiene que encontrar *mero tenedor*. Sin esa capa, esas
consultas no devuelven nada útil.

Cuando aparezca una forma de preguntar que no encuentra su artículo, agregarla
ahí antes que tocar el corpus.

## Los tres regímenes

No se mezclan. Una respuesta correcta en uno es errónea en otro.

| Régimen | Norma | Entidad |
|---|---|---|
| Comunal | Constitución 57, Ley de Comunas, LOTRTA | MAG |
| Urbano | COOTAD, ordenanza municipal | GAD municipal (en Quito, UERB) |
| Rural estatal | LOTRTA | MAG |
| Privado sin título | Código Civil, COGEP | Juez civil |

La comuna puede estar en zona urbana. Eso no la saca del régimen comunal.

## Desplegar

**Interfaz** — GitHub Pages sobre la rama `main`.

**Proxy** — obligatorio antes de publicar:

```bash
npm create cloudflare@latest tierras-proxy
# pegar worker/worker.js en src/index.js
npx wrangler secret put API_KEY
npx wrangler deploy
```

Copiar la URL resultante en `WORKER_URL` de `assets/app.js` y agregar el
dominio de Pages a `ORIGENES` en el worker.

Sin el proxy, la clave queda visible en el código fuente.

## Mantener el corpus

Cada artículo lleva un campo `verificado`. En `false`, el recuperador no lo
sirve: el contenido está confirmado pero el número de artículo aún no se
cotejó contra el texto oficial.

Pendientes registrados en `meta.pendientes` del corpus.

Revisar cada trimestre: las ordenanzas municipales cambian y hay reformas
en trámite. Al actualizar el corpus, subir la versión de `CACHE` en `sw.js`.

## Advertencia sobre la ley en papel

El corpus recoge lo que dicen las normas. Algunas figuras existen en el
reglamento pero no operan en la práctica — comuneros de toda la vida no
conocen la "certificación de uso y usufructo", y lo que sí manejan es el
**certificado de cabildo**.

Cuando alguien que vive el trámite diga que algo no funciona así, corregir
el corpus. Vale más que la fuente oficial.
