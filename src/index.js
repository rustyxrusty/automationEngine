const { app } = require('@azure/functions');

// Load all function modules
require('./functions/syncCompany');
require('./functions/testApiKey');
require('./functions/rapidmailSyncPerson');
require('./functions/rapidmailCleanupUnsubscribes');
require('./functions/rapidmailRecipientlistAdd');
require('./functions/checkWeather'); 
require('./functions/gateway');

app.setup({
  enableHttpStream: true,
});
