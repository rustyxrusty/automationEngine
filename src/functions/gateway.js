const { app } = require('@azure/functions');
const jwt     = require('jsonwebtoken');
// ------ ACL helper --------------------------------
let ACL = {};
try {
    ACL = JSON.parse(process.env.FUNCTION_ACL_JSON || '{}');



} catch { /* keep empty object on parse error */ }

/** @param {string} tenantId @param {string} func */
function isAllowed(tenantId, func) {
    return ACL[tenantId]?.includes(func);
}
const PUBLIC_KEY = process.env.JWT_PUBLIC_KEY;
const HOST       = process.env.WEBSITE_HOSTNAME;

/** @param {import('@azure/functions').HttpRequest} req */
function verifyJWT(req) {
  const raw = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!raw) throw new Error('missing bearer');

  // cast to JwtPayload so tenantId etc. are recognised
  return /** @type {import('jsonwebtoken').JwtPayload} */ (
    jwt.verify(raw, PUBLIC_KEY, { algorithms: ['RS256'], audience: 'poool-users' })
  );
}

function headersToObject(h) {
  const o = {}; h.forEach((v, k) => (o[k] = v)); return o;
}

app.http('gateway', {
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  authLevel: 'anonymous',
  route: 'gateway/{func}',
  /** @param {import('@azure/functions').HttpRequest} req
      @param {import('@azure/functions').InvocationContext} ctx */
  handler: async (req, ctx) => {
    try {
      const claims     = verifyJWT(req);

      const funcName   = /** @type {any} */ (ctx).bindingData?.func ?? req.params.func;

      // ACL check - block if tenant is not allowed to use function
      if (!isAllowed(claims.tid ?? claims.tenantId, funcName)) {
        ctx.log(`Forbidden: tenant ${claims.tid} not allowed to call ${funcName}`);
        return {status: 403, body: 'Forbidden'};
      }

      const funcKey    = process.env[`KEY_${funcName}`];
      if (!funcKey) return { status: 404, body: `unknown function ${funcName}` };

      const target = `https://${HOST}/api/${funcName}?code=${funcKey}`;
      const resp   = await fetch(target, {
        method : req.method,
        headers: { ...headersToObject(req.headers), 'x-tenantid': String(claims.tenantId ?? '') },
        body   : ['GET','HEAD'].includes(req.method) ? undefined : await req.text()
      });

      return { status: resp.status, body: await resp.text() };

    } catch (err) {
      ctx.log(`Gateway error: ${(/** @type {Error} */ (err)).message}`);
      return { status: 401, body: 'Unauthorized' };
    }
  }
});
