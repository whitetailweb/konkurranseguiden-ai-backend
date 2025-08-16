// api/index.js - Hovedfil for Vercel (erstatt analyze.js)
const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Handle GET request (health check)
    if (req.method === 'GET') {
        return res.json({
            status: 'OK',
            service: 'Konkurranseguiden AI Backend',
            aiEnabled: !!process.env.OPENAI_API_KEY,
            timestamp: new Date().toISOString()
        });
    }
    
    // Handle POST request (analyze)
    if (req.method === 'POST') {
        try {
            const { url, action } = req.body;
            
            if (action === 'analyze' && url) {
                console.log('Analyzing:', url);
                
                // Scrape website
                const scrapedData = await scrapeWebsite(url);
                
                // Analyze with AI or fallback
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
            console.error('Analysis error:', error);
            return res.status(500).json({ 
                error: error.message || 'Analysis failed' 
            });
        }
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
};

// Web scraping function
async function scrapeWebsite(url) {
    try {
        console.log('Scraping:', url);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 15000,
            maxRedirects: 5
        });

        const $ = cheerio.load(response.data);
        
        // Clean content
        $('script, style, nav, footer, header, .advertisement, .ads').remove();
        
        const title = $('title').text() || $('h1').first().text() || '';
        const content = $('body').text()
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 4000);

        console.log('Scraped title:', title.substring(0, 100));
        return { url, title: title.trim(), content };
        
    } catch (error) {
        console.error('Scraping error:', error.message);
        throw new Error(`Could not access website: ${error.message}`);
    }
}

// AI Analysis with OpenAI
async function analyzeWithOpenAI(scrapedData) {
    try {
        const prompt = `Analyser denne norske konkurransesiden og returner BARE gyldig JSON uten andre kommentarer:

URL: ${scrapedData.url}
Tittel: ${scrapedData.title}
Innhold: ${scrapedData.content.substring(0, 2000)}

Struktur:
{
    "title": "Konkurransetittel (max 80 tegn)",
    "description": "Kort beskrivelse av konkurransene",
    "prize": "Hva kan man vinne",
    "organizer": "Arrangør/firma",
    "deadline": "YYYY-MM-DD (gjett realistisk dato hvis ikke oppgitt)",
    "category": "teknologi/reise/gaming/sport/mat/annet",
    "image": "Passende emoji som 📱💻🏝️🎮⚽🍕🎁",
    "type": "gratis"
}`;

        console.log('Calling OpenAI...');
        
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-3.5-turbo",
            messages: [
                { 
                    role: "system", 
                    content: "Du er ekspert på å analysere norske konkurranser. Returner ALLTID kun gyldig JSON uten markdown eller andre formateringer." 
                },
                { role: "user", content: prompt }
            ],
            max_tokens: 500,
            temperature: 0.1
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const aiResponse = response.data.choices[0].message.content.trim();
        console.log('AI response:', aiResponse.substring(0, 200));
        
        // Clean JSON response
        const cleanedResponse = aiResponse
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
        
        const competitionData = JSON.parse(cleanedResponse);
        
        // Add metadata
        competitionData.id = Date.now();
        competitionData.addedDate = new Date().toISOString();
        competitionData.sourceUrl = scrapedData.url;
        competitionData.aiParsed = true;
        
        console.log('AI analysis complete:', competitionData.title);
        return competitionData;
        
    } catch (error) {
        console.error('AI analysis failed:', error.message);
        // Fallback to smart analysis
        return createSmartFallback(scrapedData);
    }
}

// Smart fallback without AI
function createSmartFallback(scrapedData) {
    const title = (scrapedData.title || 'Ny konkurranse').substring(0, 80);
    const content = scrapedData.content.toLowerCase();
    const hostname = new URL(scrapedData.url).hostname.replace('www.', '');
    
    // Smart category detection
    let category = 'annet';
    let image = '🎁';
    
    if (content.includes('iphone') || content.includes('samsung') || content.includes('mobil') || content.includes('tech') || content.includes('pc') || content.includes('laptop')) {
        category = 'teknologi';
        image = '📱';
    } else if (content.includes('reise') || content.includes('ferie') || content.includes('tur') || content.includes('hotell') || content.includes('fly')) {
        category = 'reise';
        image = '✈️';
    } else if (content.includes('gaming') || content.includes('spill') || content.includes('playstation') || content.includes('xbox') || content.includes('nintendo')) {
        category = 'gaming';
        image = '🎮';
    } else if (content.includes('sport') || content.includes('trening') || content.includes('fotball') || content.includes('ski')) {
        category = 'sport';
        image = '⚽';
    } else if (content.includes('mat') || content.includes('restaurant') || content.includes('kaffe') || content.includes('pizza')) {
        category = 'mat';
        image = '🍕';
    }
    
    return {
        id: Date.now(),
        title: title,
        description: 'Se konkurransesiden for fullstendige detaljer og regler',
        prize: 'Se konkurransesiden for premieinformasjon',
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