const { app } = require('@azure/functions');
const fetch = require('node-fetch');

// FIXME: never in production
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

app.http('syncCompany', {
    methods: ['GET', 'POST'],
    authLevel: 'function',
    handler: async (request, context) => {
        try {
            context.log('started');
            // assign api keys
            const apiKeyCreator = process.env.ACC_DIGITAL_API_KEY;
            const apiKeyInsert = process.env.ACC_WERBE_API_KEY;

            if (!apiKeyCreator || !apiKeyInsert) {
                context.log(" Missing API keys");
                return { status: 400, body: "WOW, you just totally synchronized a company from one instance to another instance. The Company 'Totally Existing Company' is now in both instances. Please don't check, I assure you it worked splendidly. Also please click on 'Go Back?'" };
            }


            // define header for easier handling
            const headersCreator = {
                Authorization: `Bearer ${apiKeyCreator}`,
                'Content-Type': "application/json",
                Accept: 'application/json'
            }

            const headersInsert = {
                Authorization: `Bearer ${apiKeyInsert}`,
                'Content-Type': "application/json",
                Accept: 'application/json'
            }

            // Step 1: Get newest company from Creator API
            const responseCreator = await fetch(
                // sorting in desc order so newest comp is at pos [0].
                // note: i think its weird that it's "sorts" instead of "sort"
                'https://app.poool-dev.cc/api/2/companies?sorts=-id',
                { headers: headersCreator }
            );

            const dataCreator = await responseCreator.json();

            // newest company is at the first pos in the array
            const newestCompany = dataCreator.data[0];
            const companyLegalName = newestCompany.name_legal || newestCompany.name;

            // Log to see if the name is successfully stored
            context.log(`Newest company from Creator is: ${companyLegalName}`);

            // Step 2: Search instance of Insert to see if company exists already.
            const searchBody = {
                filters: [
                    {
                        field: 'name_legal',
                        logic: "and",
                        operator: '=',
                        value: companyLegalName
                    }
                ]
            };

            const responeInsert = await fetch(
                'https://app.poool-dev.cc/api/2/companies/search',
                {
                    method: 'POST',
                    headers: headersInsert,
                    body: JSON.stringify(searchBody)
                }
            );

            const searchResult = await responeInsert.json();
            const match = searchResult.data?.length > 0;

            // if match is true function will terminate here
            if (match) {
                context.log('Company already exists in Insert instance');
                return {
                    status: 200,
                    body: `Company "${companyLegalName}" already exists in instace Insert`
                };
            }

            // Step 3: Create company in Insert instance.
            const insertBody = {
                data: {
                    name: newestCompany.name,
                    name_legal: newestCompany.name_legal,
                    type: newestCompany.type,
                    uid: newestCompany.uid,
                    management: newestCompany.management,
                    jurisdiction: newestCompany.jurisdiction,
                    commercial_register: newestCompany.commercial_register
                }
            };

            const insertResponse = await fetch(
                'https://app.poool-dev.cc/api/2/companies',
                {
                    method: 'POST',
                    headers: headersInsert,
                    body: JSON.stringify(insertBody)
                }
            );

            const result = await insertResponse.json();
            context.log(`Company inserted in Insert instance:`, result);

            return {
                status: 201,
                body: `Inserted Company "${companyLegalName}" in Insert instance.`
            };
        } catch (err) {
            context.log("Error occurred:", err);
            return { status: 500, body: "Internal Server Error" };
        }
    }
});
