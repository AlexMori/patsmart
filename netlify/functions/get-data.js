const { getStore } = require('@netlify/blobs');
const axios = require('axios');

exports.handler = async (event, context) => {
    const store = getStore({
        name: 'pat_data_v4', 
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
            nextContatti: "https://www.provincia.tn.it/api/openapi/media/classificazioni/punti-di-contatto",
            mappaContatti: {}
        };
    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: "Errore Blobs" }) };
    }

    const isForce = event.queryStringParameters?.force === 'true';

    if (isForce) {
        try {
            if (persistedData.nextContatti) {
                const res = await axios.get(persistedData.nextContatti);
                (res.data.items || []).forEach(c => {
                    const match = c.id.match(/\d+/);
                    if (match) {
                        const numericId = match[0];
                        persistedData.mappaContatti[numericId] = c.contacts || [];
                    }
                });
                persistedData.nextContatti = res.data.next;
            }

            if (persistedData.servizi.length === 0) {
                const res = await axios.get(persistedData.nextServizi);
                persistedData.servizi = (res.data.items || []).map(s => ({
                    id: s.id,
                    name: s.name,
                    desc: (s.abstract || s.content || "").replace(/<[^>]*>?/gm, '').substring(0, 200),
                    url: s.url,
                    tags: s.tags || [],
                    addressee: s.addressee || []
                }));
            }

            if (persistedData.strutture.length === 0) {
                const res = await axios.get(persistedData.nextStrutture);
                const cleanStr = (items) => items.map(n => {
                    const numericId = String(n.id).match(/\d+/) ? String(n.id).match(/\d+/)[0] : n.id;
                    const extraContacts = persistedData.mappaContatti[numericId] || [];
                    
                    return {
                        id: n.id,
                        name: n.name,
                        addr: n.address?.address || "",
                        type: n.type || [],
                        contacts: [...(n.contacts || []), ...extraContacts].map(c => ({ type: c.type, value: c.value })),
                        children: n.children ? cleanStr(n.children) : []
                    };
                });
                persistedData.strutture = cleanStr(res.data.items || []);
                
                const flatten = (items) => {
                    let flat = [];
                    items.forEach(i => {
                        flat.push({ id: i.id, name: i.name, contacts: i.contacts });
                        if(i.children) flat = [...flat, ...flatten(i.children)];
                    });
                    return flat;
                };
                persistedData.flatStrutture = flatten(persistedData.strutture);
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
