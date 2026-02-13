const { getStore } = require('@netlify/blobs');
const axios = require('axios');

exports.handler = async (event, context) => {
    const store = getStore({
        name: 'pat_data_v2', 
        siteID: process.env.NETLIFY_SITE_ID,
        token: process.env.NETLIFY_AUTH_TOKEN,
    });

    let persistedData;
    try {
        const saved = await store.get('global_cache', { type: 'json' });
        persistedData = saved || { 
            servizi: [], strutture: [], flatStrutture: [], sportelli: [],
            nextServizi: "https://www.provincia.tn.it/api/openapi/servizi",
            nextStrutture: "https://www.provincia.tn.it/api/openapi/amministrazione/strutture-organizzative"
        };
    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: "Errore accesso Blobs" }) };
    }

    const isForce = event.queryStringParameters?.force === 'true';

    if (isForce) {
        try {
            if (persistedData.nextServizi) {
                const res = await axios.get(persistedData.nextServizi, { timeout: 9000 });
                const rawItems = res.data.items || [];
                
                const cleanItems = rawItems.map(s => ({
                    id: s.id,
                    name: s.name,
                    desc: (s.abstract || s.content || "").replace(/<[^>]*>?/gm, '').substring(0, 300) + "...",
                    url: s.url,
                    tags: s.tags || [],
                    addressee: s.addressee || []
                }));

                const combined = [...persistedData.servizi, ...cleanItems];
                persistedData.servizi = Array.from(new Map(combined.map(item => [item.id, item])).values());
                persistedData.nextServizi = res.data.next;
            }

            if (persistedData.nextStrutture && persistedData.strutture.length === 0) {
                const res = await axios.get(persistedData.nextStrutture);
                const rawStrutture = res.data.items || [];
                
                const cleanStr = (items) => items.map(n => ({
                    id: n.id,
                    name: n.name,
                    desc: (n.abstract || "").substring(0, 150),
                    addr: n.address?.address || "",
                    type: n.type || [],
                    contacts: (n.contacts || []).map(c => ({ type: c.type, value: c.value })),
                    children: n.children ? cleanStr(n.children) : []
                }));

                persistedData.strutture = cleanStr(rawStrutture);
                
                const flatten = (items) => {
                    let flat = [];
                    items.forEach(i => {
                        flat.push({ id: i.id, name: i.name, addr: i.addr });
                        if(i.children) flat = [...flat, ...flatten(i.children)];
                    });
                    return flat;
                };
                persistedData.flatStrutture = flatten(persistedData.strutture);
                persistedData.nextStrutture = res.data.next;
            }

            await store.setJSON('global_cache', persistedData);
        } catch (err) {
            console.error(err.message);
        }
    }

    return {
        statusCode: 200,
        headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*" 
        },
        body: JSON.stringify(persistedData)
    };
};
