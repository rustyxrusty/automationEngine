const { app } = require('@azure/functions');
const fetch = global.fetch; // Node 18+

app.http('rapidmailCleanupUnsubscribes', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'rapidmailCleanupUnsubscribes',
  handler: async (req, ctx) => {
    ctx.log('➡️ rapidmailCleanupUnsubscribes start');

    // 1) parse + validate s
    let body;
    try {
      body = await req.json();
      ctx.log('📦 Received body:', JSON.stringify(body));
    } catch (err) {
      ctx.log('❌ Invalid JSON', err);
      return { status: 400, body: 'Invalid JSON' };
    }
    // @ts-ignore
    const { tagId, recipientlistId } = body;
    if (typeof tagId !== 'number' || typeof recipientlistId !== 'number') {
      ctx.log('❌ tagId and recipientlistId must be numbers');
      return { status: 400, body: 'tagId and recipientlistId must be numbers' };
    }

    // 2) fetch unsubscribes from Rapidmail
    const { RAPIDMAIL_API_USER: user, RAPIDMAIL_API_PASSWORD: pass, RAPIDMAIL_API_URL: base = 'https://apiv3.emailsys.net/v1' } = process.env;
    if (!user || !pass) {
      ctx.log('❌ Missing Rapidmail creds');
      return { status: 500, body: 'Missing Rapidmail creds' };
    }
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');
    const deletedUrl = `${base}/recipients?recipientlist_id=${recipientlistId}&status[]=deleted&page=1&per_page=1000`;
    let delJson;
    try {
      const res = await fetch(deletedUrl, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
      ctx.log('🔍 Rapidmail status:', res.status);
      delJson = await res.json();
    } catch (err) {
      ctx.log('❌ Error fetching unsubscribes', err);
      return { status: 502, body: 'Failed to fetch unsubscribes' };
    }
    const emails = (delJson._embedded?.recipients || []).map(r => r.email);
    ctx.log(`👥 Found ${emails.length} deleted emails`, emails);

    // 3) loop through each, remove tag in Poool
    const YOUR_API_BASE = process.env.POOOL_API_BASE || 'https://app.poool-dev.cc/api/2';
    const BEARER = process.env.POOOL_API_TEST_RAPID;
    if (!BEARER) {
      ctx.log('❌ Missing Poool API token');
      return { status: 500, body: 'Missing internal API token' };
    }

    let cleaned = 0;
    for (const email of emails) {
      ctx.log(`\n🔎 Searching Poool for ${email}`);
      let searchJson;
      try {
        const sr = await fetch(`${YOUR_API_BASE}/persons/search`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${BEARER}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: [{ field: 'contacts.value', operator: '=', value: email, logic: 'and' }]
          })
        });
        ctx.log('🔎 Search status:', sr.status);
        searchJson = await sr.json();
      } catch (err) {
        ctx.log(`❌ Search error for ${email}`, err);
        continue;
      }

      const persons = searchJson.data || [];
      ctx.log(`🔎 Persons found:`, persons.length);
      if (!persons.length) {
        ctx.log(`⚠️ No match for ${email}`);
        continue;
      }

      const person = persons[0];
      ctx.log(`ℹ️ Full person record:`, JSON.stringify(person));
      const oldTags = (person.tags || []).map(t => t.id);
      if (!oldTags.includes(tagId)) {
        ctx.log(`ℹ️ Person ${person.id} already clean, skipping.`);
        continue;
      }
      const newTags = oldTags.filter(id => id !== tagId);

      // build PATCH with wrapper + app_version
      const patchBody = {
        data: {
          company_id:  person.company_id,
          firstname:   person.firstname  || '',
          lastname:    person.lastname   || '',
          tags:        newTags,
          app_version: person.app_version
        }
      };

      try {
        const pr = await fetch(`${YOUR_API_BASE}/persons/${person.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${BEARER}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(patchBody)
        });
        const text = await pr.text();
        ctx.log('✏️ PATCH status:', pr.status, 'body:', text);
        if (pr.ok) {
          cleaned++;
          ctx.log(`✅ Removed tag ${tagId} from person ${person.id}`);
        } else {
          ctx.log(`⚠️ Failed to patch ${person.id}`);
        }
      } catch (err) {
        ctx.log(`❌ Network error patching ${person.id}`, err);
      }
    }

    ctx.log(`🏁 Done — total cleaned=${cleaned}`);
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cleaned })
    };
  }
});
