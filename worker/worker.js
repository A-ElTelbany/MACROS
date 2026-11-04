/*
 * Macro Log photo reader (Cloudflare Worker).
 * Holds the Anthropic API key so it never appears in the app.
 * Secrets to add in Cloudflare: ANTHROPIC_API_KEY and APP_PASSCODE.
 * Optional variables: ALLOWED_ORIGIN (default https://a-eltelbany.github.io), MODEL.
 */
const SYSTEM = `You read food photos for a personal macro tracker used in Qatar.
Reply with ONLY a JSON object, no other text:
{"items":[{"name":string,"serving":string,"basis":"serving"|"100g","kcal":number,"protein":number,"carbs":number,"fat":number,"sugar":number,"estimated":boolean}],"note":string}
Rules:
- Nutrition facts label: copy the printed values exactly. If both per-serving and per-100g columns exist, use per serving and put the serving size in "serving" (for example "1 bar (60 g)"). Use the product name on the pack. estimated=false.
- Menu, delivery-app screen or recipe card that prints nutrition values: one item per dish with those values, estimated=false.
- A prepared meal or food with no numbers: estimate ONE portion as shown, estimated=true, and say in "note" what you assumed.
- If a label gives only per-100g values, use basis "100g" and serving "per 100 g".
- At most 8 items. Macros in grams. Use 0 for sugar if it is not shown or not applicable. Round kcal to a whole number and grams to one decimal.
- If the image is not food or is unreadable, return {"items":[],"note":"short reason"}.
- "note" is one short sentence.`;

export default {
  async fetch(request, env) {
    const allowed = env.ALLOWED_ORIGIN || 'https://a-eltelbany.github.io';
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': origin === allowed ? origin : allowed,
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Passcode',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Vary': 'Origin'
    };
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!env.APP_PASSCODE || !env.ANTHROPIC_API_KEY) return json({ error: 'The Worker is missing its secrets.' }, 500);
    if (request.headers.get('X-App-Passcode') !== env.APP_PASSCODE) return json({ error: 'Wrong passcode.' }, 401);
    if (request.method === 'GET') return json({ ok: true });
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'Bad request.' }, 400); }
    const okType = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (typeof body.image !== 'string' || body.image.length < 100 || body.image.length > 5500000) return json({ error: 'Photo is missing or too large.' }, 400);
    const mediaType = okType.indexOf(body.mediaType) >= 0 ? body.mediaType : 'image/jpeg';
    const hint = typeof body.hint === 'string' ? body.hint.slice(0, 200) : '';

    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: env.MODEL || 'claude-sonnet-5-5',
          max_tokens: 1200,
          system: SYSTEM,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: body.image } },
            { type: 'text', text: hint ? 'The user says this is: ' + hint + '. Read the photo and return the JSON.' : 'Read the photo and return the JSON.' }
          ] }]
        })
      });
    } catch (e) { return json({ error: 'Could not reach Claude.' }, 502); }
    if (!res.ok) return json({ error: 'Claude returned an error (' + res.status + '). Check your API credit.' }, 502);

    let text = '';
    try { const j = await res.json(); text = (j.content || []).map(c => c.text || '').join(''); } catch (e) { return json({ error: 'Unreadable reply.' }, 502); }
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b <= a) return json({ error: 'Could not read that photo. Try a clearer one.' }, 422);
    let out;
    try { out = JSON.parse(text.slice(a, b + 1)); } catch (e) { return json({ error: 'Could not read that photo. Try a clearer one.' }, 422); }
    const num = (v) => { const n = Number(v); return isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : 0; };
    const items = (Array.isArray(out.items) ? out.items : []).slice(0, 8).map(it => ({
      name: String(it.name || '').slice(0, 120),
      serving: String(it.serving || '').slice(0, 60),
      basis: it.basis === '100g' ? '100g' : 'serving',
      kcal: Math.round(num(it.kcal)), protein: num(it.protein), carbs: num(it.carbs), fat: num(it.fat), sugar: num(it.sugar),
      estimated: !!it.estimated
    })).filter(it => it.name && it.kcal >= 0);
    return json({ items, note: String(out.note || '').slice(0, 200) });
  }
};
