const axios = require('axios');

let cache = null;
let lastFetch = 0;
const CACHE_DURATION = 6 * 60 * 60 * 1000; 

exports.handler = async (event, context) => {
    const now = Date.now();
    if (cache && (now - lastFetch < CACHE_DURATION)) {
        return { statusCode: 200, body: JSON.stringify(cache) };
    }

    try {
        const fastFetch = async (url) => {
            const res = await axios.get(url, { timeout: 8000 });
            return res.data;
        };

        const [serviziData, struttureData, contattiData] = await Promise.all([
            fastFetch("https://www.provincia.tn.it/api/openapi/servizi"),
            fastFetch("https://www.provincia.tn.it/api/openapi/amministrazione/strutture-organizzative"),
            fastFetch("https://www.provincia.tn.it/api/openapi/media/classificazioni/punti-di-contatto")
        ]);

        const contactMap = {};
        (contattiData.items || []).forEach(i => {
            contactMap[i.id.replace('contactpoint', '')] = i.contact || [];
        });

        const flatStrutture = (struttureData.items || []).map(s => ({
            id: s.id,
            name: s.legal_name || s.name || "Ufficio",
            type: s.type || [],
            desc: s.main_function || s.description || "",
            portalUrl: s.uri ? "https://www.provincia.tn.it/Amministrazione/Strutture-organizzative/" + s.uri.split("#")[1] : "#",
            parentId: s.is_support_unit_of?.[0]?.id || null,
            contacts: contactMap[s.id.replace('structure', '')] || [],
            addr: "Consultare portale per indirizzo",
            children: []
        }));

        const lookup = {};
        flatStrutture.forEach(obj => lookup[obj.id] = obj);
        const tree = flatStrutture.filter(obj => {
            if (obj.parentId && lookup[obj.parentId]) {
                lookup[obj.parentId].children.push(obj);
                return false;
            }
            return true;
        });

        const servizi = (serviziData.items || []).map(s => ({
            id: s.id,
            name: s.name,
            desc: s.description || "",
            tags: s.type || [],
            addressee: s.addressee || [],
            url: s.uri ? "https://www.provincia.tn.it/Servizi/" + s.uri.split("#")[1] : "#",
            officeIds: (s.holds_role_in_time || []).map(r => r.id)
        }));

        cache = { strutture: tree, flatStrutture, servizi, sportelli: [] };
        lastFetch = now;

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify(cache)
        };

    } catch (error) {
        console.error("Errore Fetch:", error.message);
        return { 
            statusCode: 500, 
            body: JSON.stringify({ error: "Le API Trentino sono lente. Riprova." }) 
        };
    }
};
