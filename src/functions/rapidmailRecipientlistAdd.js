
const { app } = require('@azure/functions');
const fetch   = global.fetch;     // native in Node 18

app.http('rapidmailRecipientlistAdd', {
  methods: ['POST'],
  authLevel: 'function',
  route:   'rapidmailRecipientlistAdd',
  handler: async (req, ctx) => {
    const raw  = await req.text();
    const data = raw ? JSON.parse(raw) : {};

    if (!data.recipientlist_id || !data.email) {
      return badRequest('recipientlist_id and email are required');
    }

    const { RAPIDMAIL_API_USER: user,
            RAPIDMAIL_API_PASSWORD: pass,
            RAPIDMAIL_API_URL: base} = process.env;

    if (!user || !pass) {
      return fail(500, 'Server misconfiguration – missing RAPIDMAIL creds');
    }

    const url  = `${base.replace(/\/+$/, '')}/recipients`;
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');

    try {
      const r   = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          Accept:         'application/json',
        },
        body: JSON.stringify(data),
      });

      const txt = await r.text();
      return { status: r.status, headers:{'Content-Type':'application/json'}, body: txt };

    } catch (e) {
      ctx.error('Rapidmail call failed', e);
      return fail(502, e.message);
    }
  }
});

const fail = (s,m) => ({ status:s, headers:{'Content-Type':'application/json'}, body:JSON.stringify({error:m})});
const badRequest = fail;
