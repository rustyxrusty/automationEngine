const { app } = require('@azure/functions');
const fetch   = global.fetch;   // Node 18+

// regex god
const EMAIL_REGEX = /^[A-Za-z0-9._'%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

app.http('rapidmailSyncPerson', {
  methods: ['POST'],
  authLevel: 'function',
  route:   'rapidmailSyncPerson',
  handler: async (req, ctx) => {
    ctx.log('➡️ rapidmailSyncPerson handler start');

    // 1) parse the raw body
    const raw = await req.text();
    ctx.log('📥 Raw body:', raw);
    let body;
    try {
      body = raw ? JSON.parse(raw) : {};
      ctx.log('📦 Parsed body:', body);
    } catch (err) {
      ctx.log('❌ JSON parse error:', err);
      return badRequest('Invalid JSON');
    }

    // 2) pull out your two IDs + webhookData
    let { tagId, recipientlistId, webhookData } = body;

    // —— UNWRAP any accidental double-nesting —— TODO: maybe make this clearer or remove 
    if (webhookData && webhookData.webhookData) {
      ctx.log('🔄 Unwrapping nested webhookData…');
      webhookData = webhookData.webhookData;
    }

    ctx.log(`🔖 tagId=${tagId}, recipientlistId=${recipientlistId}`);
    if (!tagId || !recipientlistId) {
      ctx.log('❌ Missing tagId or recipientlistId');
      return badRequest('tagId and recipientlistId required');
    }

    // 3) prepare Rapidmail credentials
    const {
      RAPIDMAIL_API_USER:     user,
      RAPIDMAIL_API_PASSWORD: pass,
      RAPIDMAIL_API_URL:      base = 'https://apiv3.emailsys.net/v1' // TODO: add in env
    } = process.env;
    if (!user || !pass) {
      ctx.log('❌ Missing Rapidmail API credentials');
      return fail(500, 'Missing Rapidmail API credentials');
    }
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');
    ctx.log('🔑 Prepared Basic auth');

    // 4) fetch existing recipients once
    const listUrl = `${base}/recipients?recipientlist_id=${recipientlistId}`;
    ctx.log('🔍 Fetching existing recipients from', listUrl);
    let listJson;
    try {
      const listRes  = await fetch(listUrl, {
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }
      });
      listJson = await listRes.json().catch(() => ({}));
    } catch (err) {
      ctx.log('❌ Error fetching list members:', err);
      return fail(502, 'Failed to fetch existing recipients');
    }
    const existing = new Set(
      (listJson._embedded?.recipients || []).map(r => r.email)
    );
    ctx.log(`👥 Existing emails count: ${existing.size}`);

    // 5) decide whom to sync
    let personsToSync;
    // person.changed trigger
    if (webhookData?.data) {
      ctx.log('📬 Detected webhookData → single-person path');
      const p = webhookData.data;
      // comparing tag ids
      const hasTag = Array.isArray(p.tags) && p.tags.some(t => t.id === tagId);
      if (!hasTag) {
        ctx.log(`⚠️ Person ${p.id} does not have tag ${tagId}, skipping`);
        return { status: 200, jsonBody: { added: 0, reason: 'tag not present' } };
      }
      personsToSync = [{
        id:        p.id,
        firstname: p.firstname || '',
        lastname:  p.lastname  || '',
        contacts:  p.contacts  || []
      }];
    } else {
      ctx.log('🧪 No webhookData → bulk-mock path');
      personsToSync = [
        { id:4, firstname:"René", lastname:"Krasselt", contacts:[{title:"E-Mail",value:"renedeveloped@cool.com"}] },
        { id:5, firstname:"Pascal", lastname:"Hollmann", contacts:[{title:"E-Mail",value:"passi@passt.com"}] },
        { id:6, firstname:"Marina", lastname:"Steidl", contacts:[
            {title:"Festnetz",value:"+43…"},
            {title:"E-Mail",value:"ok@marina.com"},
            {title:"E-Mail",value:"not@ok.com"}
          ]
        },
        { id:7, firstname:"Judith", lastname:"Winkler", contacts:[{title:"E-Mail",value:"hellome@judith.com"}] },
        { id:9, firstname:"Der erste", lastname:"Benutzer D", contacts:[
            {title:"E-Mail",value:"diese@mail.com"},
            {title:"Handy",value:"+43…"},
            {title:"E-Mail",value:"nope@not.com"}
          ]
        },
      ];
    }
    ctx.log(`👥 Will sync ${personsToSync.length} person(s)`);

    // 6) loop and POST any new, valid e-mail
    let added = 0;
    for (const p of personsToSync) {
      const email = p.contacts.find(c => c.title.toLowerCase() === 'e-mail')?.value;
      ctx.log(`🔄 Processing person ${p.id}, email='${email}'`);
      if (!email || existing.has(email) || !EMAIL_REGEX.test(email)) {
        ctx.log(email
          ? existing.has(email)
            ? '🔁 Already in list, skipping'
            : '❌ Invalid format, skipping'
          : '⚠️ No e-mail contact, skipping'
        );
        continue;
      }

      // add them
      ctx.log(`✉️ Adding valid email ${email}`);
      let res, text;
      try {
        res = await fetch(`${base}/recipients`, {
          method:  'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type':'application/json',
            Accept:        'application/json'
          },
          body: JSON.stringify({
            recipientlist_id: recipientlistId,
            status:           'active',
            mailtype:         'text',
            email,
            firstname:        p.firstname,
            lastname:         p.lastname
          })
        });
        text = await res.text().catch(()=>'<no body>');
      } catch (err) {
        ctx.log('❌ Network error adding recipient:', err);
        continue;
      }

      ctx.log(`📤 POST status=${res.status}, body=${text.slice(0,300)}`);
      if (res.ok) {
        added++;
        existing.add(email);
        ctx.log('🎉 Successfully added');
      } else {
        ctx.log('⚠️ Failed to add:', text);
      }
    }

    ctx.log(`🏁 Sync complete. Added ${added}`);
    return {
      status: 200,
      headers: { 'Content-Type':'application/json' },
      body:    JSON.stringify({ added })
    };
  }
});

const fail       = (s,m) => ({ status:s, headers:{'Content-Type':'application/json'}, body:JSON.stringify({ error:m }) });
const badRequest = m     => fail(400,m);
