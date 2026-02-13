const { getStore } = require('@netlify/blobs');
const axios = require('axios');

exports.handler = async (event, context) => {
    const store = getStore('pat_data_store');
    
    let persistedData = await store.get('global_cache', { type: 'json' }) || { 
        servizi: [], strutture: [], flatStrutture: [], sportelli: [],
        nextServizi: "https://www.provincia.tn.it/api/openapi/servizi",
        nextStrutture: "https://www.provincia.tn.it/api/openapi/amministrazione/strutture-organizzative",
        lastUpdate: 0
    };

    const now = Date.now();
    const isCron = event.headers['user-agent']?.includes('cron') || event.queryStringParameters.force === 'true';

    if (!isCron && persistedData.servizi.length > 0) {
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(persistedData)
        };
    }
    
    try {
        const fetchBatch = async (startUrl, limit = 3) => {
            let items = [];
            let next = startUrl;
            for (let i = 0; i < limit && next; i++) {
                const res = await axios.get(next, { timeout: 8000 });
                items = items.concat(res.data.items || []);
                next = res.data.next || null;
            }
            return { items, next };
        };

        if (persistedData.nextServizi) {
            const batch = await fetchBatch(persistedData.nextServizi);
            persistedData.servizi = [...new Map([...persistedData.servizi, ...batch.items].map(item => [item.id, item])).values()];
            persistedData.nextServizi = batch.next;
        }

        if (persistedData.nextStrutture) {
            const batch = await fetchBatch(persistedData.nextStrutture);
            
            const processedItems = batch.items.map(s => {
                let lat = null, lng = null, address = "Indirizzo non disponibile";
                if (s.has_spatial_coverage?.[0]?.has_address) {
                    const addr = s.has_spatial_coverage[0].has_address;
                    lat = parseFloat(addr.latitude); lng = parseFloat(addr.longitude);
                    address = addr.address || address;
                }
                return { ...s, lat, lng, address };
            });

            persistedData.flatStrutture = [...new Map([...persistedData.flatStrutture, ...processedItems].map(item => [item.id, item])).values()];
            persistedData.nextStrutture = batch.next;
        }

        if (!persistedData.nextServizi && !persistedData.nextStrutture) {
            persistedData.lastUpdate = now;
        }

        await store.setJSON('global_cache', persistedData);

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(persistedData)
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
