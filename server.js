// server.js - AI Backend for Konkurranseguiden
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// OpenAI API configuration (erstatt med din API-nøkkel)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'din-openai-api-nokkel-her';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Path to competitions JSON file
const COMPETITIONS_FILE = path.join(__dirname, 'data', 'competitions.json');

// Ensure data directory exists
async function ensureDataDirectory() {
    try {
        await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
    } catch (err) {
        console.log('Data directory already exists');
    }
}

// Load existing competitions
async function loadCompetitions() {
    try {
        const data = await fs.readFile(COMPETITIONS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.log('No existing competitions file, starting fresh');
        return [];
    }
}

// Save competitions to JSON file
async function saveCompetitions(competitions) {
    try {
        await fs.writeFile(COMPETITIONS_FILE, JSON.stringify(competitions, null, 2));
        console.log('Competitions saved successfully');
    } catch (err) {
        console.error('Error saving competitions:', err);
    }
}

// Web scraping function
async function scrapeWebsite(url) {
    try {
        console.log(`Scraping website: ${url}`);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        
        // Extract text content, removing scripts and styles
        $('script, style, nav, footer, header').remove();
        
        const textContent = $('body').text()
            .replace(/\s+/g, ' ')
            .replace(/\n+/g, ' ')
            .trim()
            .substring(0, 4000); // Limit text length for API

        console.log('Website scraped successfully');
        return {
            url: url,
            title: $('title').text() || '',
            content: textContent
        };
        
    } catch (error) {
        console.error('Scraping error:', error.message);
        throw new Error('Could not access the website. Please check the URL.');
    }
}

// AI Analysis function using OpenAI GPT
async function analyzeCompetitionWithAI(scrapedData) {
    const prompt = `
Analyser denne konkurransesiden og trekk ut følgende informasjon på norsk. 
Hvis informasjon ikke er tilgjengelig, bruk "Ikke oppgitt".

Nettside URL: ${scrapedData.url}
Innhold: ${scrapedData.content}

Returner BARE et gyldig JSON-objekt med denne strukturen:
{
    "title": "Konkurransetittel",
    "description": "Kort beskrivelse av konkurransene",
    "prize": "Hva kan man vinne",
    "organizer": "Hvem arrangerer konkurransene", 
    "deadline": "YYYY-MM-DD format (gjett rimelig dato hvis ikke oppgitt)",
    "category": "teknologi/reise/gaming/sport/mat/annet",
    "requirements": "Krav for deltakelse",
    "howToParticipate": "Hvordan delta",
    "image": "Passende emoji for premien (📱💻🏝️🎮 etc)",
    "type": "gratis eller siste_sjanse"
}`;

    try {
        console.log('Sending request to OpenAI...');
        
        const response = await axios.post(OPENAI_API_URL, {
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system", 
                    content: "Du er en ekspert på å analysere konkurransesider og trekke ut strukturert informasjon. Returner alltid gyldig JSON."
                },
                {
                    role: "user", 
                    content: prompt
                }
            ],
            max_tokens: 500,
            temperature: 0.3
        }, {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const aiResponse = response.data.choices[0].message.content.trim();
        console.log('AI Response received');
        
        // Parse JSON response from AI
        const competitionData = JSON.parse(aiResponse);
        
        // Add metadata
        competitionData.id = Date.now();
        competitionData.addedDate = new Date().toISOString();
        competitionData.sourceUrl = scrapedData.url;
        
        return competitionData;
        
    } catch (error) {
        console.error('AI Analysis error:', error.message);
        
        // Fallback response if AI fails
        return {
            id: Date.now(),
            title: scrapedData.title || "Ny konkurranse",
            description: "Konkurranse funnet - sjekk lenken for detaljer",
            prize: "Se konkurransesiden",
            organizer: "Ikke oppgitt",
            deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now
            category: "annet",
            requirements: "Se konkurransesiden",
            howToParticipate: "Klikk på lenken for å delta",
            image: "🎁",
            type: "gratis",
            addedDate: new Date().toISOString(),
            sourceUrl: scrapedData.url,
            aiParsed: false
        };
    }
}

// Routes

// Get all competitions
app.get('/api/competitions', async (req, res) => {
    try {
        const competitions = await loadCompetitions();
        res.json(competitions);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load competitions' });
    }
});

// Add new competition via AI analysis
app.post('/api/competitions/analyze', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        console.log('Starting analysis for:', url);

        // Step 1: Scrape the website
        const scrapedData = await scrapeWebsite(url);
        
        // Step 2: Analyze with AI
        const competitionData = await analyzeCompetitionWithAI(scrapedData);
        
        // Step 3: Load existing competitions and add new one
        const competitions = await loadCompetitions();
        competitions.unshift(competitionData); // Add to beginning of array
        
        // Step 4: Save updated competitions
        await saveCompetitions(competitions);
        
        console.log('Competition added successfully:', competitionData.title);
        
        res.json({
            success: true,
            competition: competitionData,
            message: 'Konkurranse analysert og lagt til!'
        });
        
    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to analyze competition' 
        });
    }
});

// Delete competition
app.delete('/api/competitions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let competitions = await loadCompetitions();
        
        competitions = competitions.filter(comp => comp.id !== parseInt(id));
        await saveCompetitions(competitions);
        
        res.json({ success: true, message: 'Competition deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete competition' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        aiEnabled: !!OPENAI_API_KEY && OPENAI_API_KEY !== 'din-openai-api-nokkel-her'
    });
});

// Start server
async function startServer() {
    await ensureDataDirectory();
    
    app.listen(PORT, () => {
        console.log(`🚀 Konkurranseguiden AI Backend running on port ${PORT}`);
        console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
        
        if (!OPENAI_API_KEY || OPENAI_API_KEY === 'din-openai-api-nokkel-her') {
            console.log('⚠️  Warning: OpenAI API key not configured. Set OPENAI_API_KEY environment variable.');
        } else {
            console.log('✅ AI functionality enabled with OpenAI GPT');
        }
    });
}

startServer().catch(console.error);