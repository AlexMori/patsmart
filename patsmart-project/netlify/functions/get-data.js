const axios = require('axios');

let cache = null;
let lastFetch = 0;
const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 ore

exports.handler = async (event, context) => {
    const now = Date.now();

    if (cache && (now - lastFetch < CACHE_DURATION)) {
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cache)
        };
    }

    try {
        const fetchAll = async (url) => {
            let results = [];
            let nextUrl = url;
            while (nextUrl) {
                const res = await axios.get(nextUrl);
                results = results.concat(res.data.items || []);
                nextUrl = res.data.next || null;
            }
            return results;
        };

        // 1. Scarica tutto in parallelo
        const [serviziRaw, struttureRaw, contattiRaw] = await Promise.all([
            fetchAll("https://www.provincia.tn.it/api/openapi/servizi"),
            fetchAll("https://www.provincia.tn.it/api/openapi/amministrazione/strutture-organizzative"),
            fetchAll("https://www.provincia.tn.it/api/openapi/media/classificazioni/punti-di-contatto")
        ]);

        // 2. Mappa contatti
        const contactMap = {};
        contattiRaw.forEach(i => {
            const id = i.id.replace('contactpoint', '');
            contactMap[id] = i.contact || [];
        });

        // 3. Elabora Strutture (Flat e Punti Mappa)
        let flatStrutture = struttureRaw.map(s => {
            const idShort = s.id.replace('structure', '');
            return {
                id: s.id,
                name: s.legal_name || s.name || "Ufficio",
                type: s.type || [],
                desc: s.main_function || s.description || "",
                portalUrl: s.uri ? "https://www.provincia.tn.it/Amministrazione/Strutture-organizzative/" + s.uri.split("#")[1] : "#",
                parentId: s.is_support_unit_of?.[0]?.id || null,
                contacts: contactMap[idShort] || [],
                // Nota: In un ambiente serverless, le chiamate agli indirizzi per ogni marker 
                // andrebbero fatte con attenzione per non superare i timeout (10s).
                // Per ora passiamo i dati base, la mappa userà questi.
                addr: "Sede Centrale / Consultare portale", 
                children: []
            };
        });

        // 4. Costruisci Albero Gerarchico
        const lookup = {};
        flatStrutture.forEach(obj => lookup[obj.id] = obj);
        const tree = [];
        flatStrutture.forEach(obj => {
            if (obj.parentId && lookup[obj.parentId]) {
                lookup[obj.parentId].children.push(obj);
            } else {
                tree.push(obj);
            }
        });

        // 5. Elabora Servizi
        const servizi = serviziRaw.map(s => ({
            id: s.id,
            name: s.name,
            desc: s.description || "",
            tags: s.type || [],
            addressee: s.addressee || [],
            url: s.uri ? "https://www.provincia.tn.it/Servizi/" + s.uri.split("#")[1] : "#",
            officeIds: (s.holds_role_in_time || []).map(r => r.id)
        }));

        cache = { strutture: tree, flatStrutture, servizi, sportelli: [] }; // sportelli può essere popolato filtrando quelli con coordinate
        lastFetch = now;

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cache)
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};