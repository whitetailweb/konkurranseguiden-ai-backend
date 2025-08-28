const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Health check
    if (req.method === 'GET') {
        return res.json({
            status: 'OK',
            service: 'Konkurranseguiden AI Backend',
            aiEnabled: !!process.env.OPENAI_API_KEY,
            timestamp: new Date().toISOString()
        });
    }
    
    // Analyze competition
    if (req.method === 'POST') {
        try {
            const { url, action } = req.body;
            
            if (action === 'analyze' && url) {
                const scrapedData = await scrapeWebsite(url);
                const competitionData = process.env.OPENAI_API_KEY 
                    ? await analyzeWithOpenAI(scrapedData)
                    : createSmartFallback(scrapedData);
                
                return res.json({
                    success: true,
                    competition: competitionData
                });
            } else {
                return res.status(400).json({ error: 'URL and action=analyze required' });
            }
            
        } catch (error) {
            return res.status(500).json({ 
                error: error.message || 'Analysis failed' 
            });
        }
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
};

async function scrapeWebsite(url) {
    const response = await axios.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 15000
    });

    const $ = cheerio.load(response.data);
    $('script, style, nav, footer, header').remove();
    
    const title = $('title').text() || '';
    const content = $('body').text()
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 4000);

    return { url, title: title.trim(), content };
}

async function analyzeWithOpenAI(scrapedData) {
    const prompt = `Analyser denne norske konkurransesiden og returner BARE gyldig JSON:

URL: ${scrapedData.url}
Tittel: ${scrapedData.title}
Innhold: ${scrapedData.content.substring(0, 2000)}

{
    "title": "Konkurransetittel",
    "description": "Kort beskrivelse",
    "prize": "Hva kan man vinne",
    "organizer": "Arrangør",
    "deadline": "YYYY-MM-DD",
    "category": "teknologi/reise/gaming/sport/mat/annet",
    "image": "Passende emoji 📱💻🏝️🎮⚽🍕🎁",
    "type": "gratis"
}`;

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: "gpt-3.5-turbo",
        messages: [
            { role: "system", content: "Returner kun gyldig JSON." },
            { role: "user", content: prompt }
        ],
        max_tokens: 500,
        temperature: 0.1
    }, {
        headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    const aiResponse = response.data.choices[0].message.content.trim();
    const competitionData = JSON.parse(aiResponse.replace(/```json|```/g, '').trim());
    
    competitionData.id = Date.now();
    competitionData.addedDate = new Date().toISOString();
    competitionData.sourceUrl = scrapedData.url;
    competitionData.aiParsed = true;
    
    return competitionData;
}

function createSmartFallback(scrapedData) {
    const title = (scrapedData.title || 'Ny konkurranse').substring(0, 80);
    const content = scrapedData.content.toLowerCase();
    const hostname = new URL(scrapedData.url).hostname.replace('www.', '');
    
    let category = 'annet';
    let image = '🎁';
    
    if (content.includes('iphone') || content.includes('tech') || content.includes('mobil')) {
        category = 'teknologi'; image = '📱';
    } else if (content.includes('reise') || content.includes('ferie')) {
        category = 'reise'; image = '✈️';
    } else if (content.includes('gaming') || content.includes('spill')) {
        category = 'gaming'; image = '🎮';
    }
    
    return {
        id: Date.now(),
        title: title,
        description: 'Se konkurransesiden for detaljer',
        prize: 'Se konkurransesiden for premie',
        organizer: hostname.charAt(0).toUpperCase() + hostname.slice(1),
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        category: category,
        image: image,
        type: 'gratis',
        addedDate: new Date().toISOString(),
        sourceUrl: scrapedData.url,
        aiParsed: false
    };
}
