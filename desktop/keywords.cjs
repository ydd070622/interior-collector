function parseKeywords(value){if(typeof value!=='string')return [];return [...new Set(value.split(/[；;]/).map(s=>s.trim()).filter(Boolean))];}module.exports={parseKeywords};
