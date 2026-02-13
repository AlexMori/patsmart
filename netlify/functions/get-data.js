const { getStore } = require('@netlify/blobs');
const axios = require('axios');

exports.handler = async (event, context) => {
    const store = getStore({
        name: 'pat_data_store',
        siteID: process.env.NETLIFY_SITE_ID,
        token: process.env.NETLIFY_AUTH_TOKEN,
    });

    let persistedData;
    try {
        const saved = await store.get('global_cache', { type: 'json' });
        
        persistedData = saved || { 
            servizi: [], strutture: [], flatStrutture: [], sportelli: [],
            nextServizi: "https://www.provincia.tn.it/api/openapi/servizi",
            nextStrutture: "https://www.provincia.tn.it/api/openapi/amministrazione/strutture-organizzative",
            lastUpdate: 0
        };
        
        console.log(`Dati recuperati. Servizi in DB: ${persistedData.servizi.length}`);
    } catch (e) {
        console.error("Errore critico accesso Blobs:", e.message);
        return { statusCode: 500, body: "Impossibile accedere al database" };
    }

    const isCron = event.headers['user-agent']?.includes('cron') || event.queryStringParameters?.force === 'true';

    if (isCron || persistedData.servizi.length === 0) {
        try {
            const fetchBatch = async (url) => {
                const res = await axios.get(url, { timeout: 8000 });
                return { items: res.data.items || [], next: res.data.next || null };
            };

            if (persistedData.nextServizi) {
                const batch = await fetchBatch(persistedData.nextServizi);
                const combined = [...persistedData.servizi, ...batch.items];
                persistedData.servizi = Array.from(new Map(combined.map(item => [item.id, item])).values());
                persistedData.nextServizi = batch.next;
            }

            await store.setJSON('global_cache', persistedData);
            console.log("Database aggiornato con successo!");
        } catch (err) {
            console.error("Errore durante l'aggiornamento dati:", err.message);
        }
    }

    return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(persistedData)
    };
};
