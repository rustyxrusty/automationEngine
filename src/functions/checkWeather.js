const { app } = require('@azure/functions');
const fetch      = require('node-fetch');

app.http('checkWeather', {
  methods: ['GET', 'POST'],
  authLevel: 'function',
  handler: async (req, context) => {
    // 1) Try GET param
    let city = req.query.get('city');

    // 2) If not in query, try POST body
    if (!city && req.method === 'POST') {
      try {
        const text = await req.text();            // get raw body
        const body = text ? JSON.parse(text) : {}; 
        city = body.city;
      } catch {
        // ignore JSON parse errors
      }
    }

    // 3) Default
    city = city || 'Sydney';

    context.log(`checkWeather called with city="${city}"`);

    // 4) Call external API
    const apiKey = process.env.WEATHER_API_KEY;
    const url    = `https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${encodeURIComponent(city)}`;
    const res    = await fetch(url);
    const weather = await res.json();
    const condition = weather.current?.condition?.text?.toLowerCase() || '';

    context.log("Weather API condition:", condition);

    return {
      status: 200,
      body: JSON.stringify({
        message: `Checked weather for ${city}. Condition: ${condition}.`
      })
    };
  }
});
