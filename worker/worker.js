/* Worker de Cloudflare — proxy hacia la API.
 *
 * Existe por una sola razón: GitHub Pages es estático. Si la clave de API va
 * en el HTML, cualquiera la lee en el código fuente y consume el saldo.
 * La clave vive aquí, como variable de entorno, y nunca llega al navegador.
 *
 * Desplegar:
 *   1. npm create cloudflare@latest tierras-proxy
 *   2. Pegar este archivo en src/index.js
 *   3. npx wrangler secret put API_KEY
 *   4. npx wrangler deploy
 *   5. Copiar la URL resultante en WORKER_URL de assets/app.js
 */

const ORIGENES = [
  'https://richardpeluche.github.io',
  'http://localhost:8000'
];

export default {
  async fetch(req, env) {
    const origen = req.headers.get('Origin') || '';
    const permitido = ORIGENES.includes(origen);

    const cors = {
      'Access-Control-Allow-Origin': permitido ? origen : ORIGENES[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') {
      return json({ error: 'Solo se aceptan peticiones POST.' }, 405, cors);
    }
    if (!permitido) {
      return json({ error: 'Origen no autorizado.' }, 403, cors);
    }

    let cuerpo;
    try {
      cuerpo = await req.json();
    } catch {
      return json({ error: 'El cuerpo de la petición no es JSON válido.' }, 400, cors);
    }

    const { system, messages } = cuerpo;
    if (!system || !Array.isArray(messages) || !messages.length) {
      return json({ error: 'Faltan los campos system o messages.' }, 400, cors);
    }

    // Tope defensivo: sin esto, una consulta larga puede costar de más.
    const recortados = messages.slice(-8).map(m => ({
      role: m.role,
      content: String(m.content).slice(0, 12000)
    }));

    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1400,
          temperature: 0.2,      // consultas legales: nada de creatividad
          system,
          messages: recortados
        })
      });

      if (!r.ok) {
        console.error('Error de la API:', r.status, await r.text());
        return json({ error: 'El servicio no está disponible en este momento.' }, 502, cors);
      }
      return json(await r.json(), 200, cors);
    } catch (e) {
      console.error('Fallo de red:', e);
      return json({ error: 'No se pudo contactar al servicio.' }, 502, cors);
    }
  }
};

function json(datos, estado, cors) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}
