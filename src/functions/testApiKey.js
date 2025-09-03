const { app } = require('@azure/functions');

app.http('testEnv', {
  methods: ['GET'],
  authLevel: 'function',
  handler: async (req, context) => {
    return {
      status: 200,
      body: `WEATHER_API_KEY is: ${process.env.WEATHER_API_KEY || 'undefined'}`
    };
  }
});
