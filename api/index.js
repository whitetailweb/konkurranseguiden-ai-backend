// api/index.js - Oppdatert for tekstanalyse
const axios = require('axios');

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method === 'GET') {
        return res.json({
            status: 'OK',
            service: 'Konkurranseguiden AI Backend - Text Analysis',
            aiEnabled: !!process.env.OPENAI_API_KEY,
            timestamp: new Date().toISOString()
        });
    }
    
    if (req.method === 'POST') {
        try {
            const { action, url, text, manualOverrides } = req.body;
            
            if (action === 'analyzeText' && url && text) {
                console.log('Analyzing text for:', url);
                
                // Analyze text with AI or fallback
                const competitionData = process.env.OPENAI_API_KEY 
                    ? await analyzeTextWithAI(text, url, manualOverrides)
                    : createFallbackFromText(text, url, manualOverrides);
                
                return res.json({
                    success: true,
                    competition: competitionData
                });
            }
            
            // Keep old URL scraping for backward compatibility
            if (action === 'analyze' && url) {
                return res.json({
                    success: false,
                    error: 'URL-basert analyse er deaktivert. Bruk tekstanalyse i admin-panelet.'
                });
            }
            
            return res.status(400).json({ error: 'Missing required parameters' });
            
        } catch (error) {
            console.error('Analysis error:', error);
            return res.status(500).json({ 
                error: error.message || 'Analysis failed' 
            });
        }
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
};

// AI text analysis function
async function analyzeTextWithAI(text, url, manualOverrides = {}) {
    try {
        const prompt = `Analyser denne norske konkurranseteksten og returner JSON med konkurransedata.

KONKURRANSETEKST:
${text.substring(0, 4000)}

URL: ${url}

Instruksjoner:
1. Finn den eksakte tittelen fra teksten
2. Identifiser arrangør/firma
3. Finn premie/gevinst med verdi hvis oppgitt
4. Finn sluttdato/frist
5. Bestem kategori basert på premien
6. Velg passende emoji for premien

RETURNER KUN DETTE JSON-OBJEKTET:
{
    "title": "Eksakt tittel fra teksten",
    "description": "Kort beskrivelse av konkurransene",
    "prize": "Konkret premie med verdi hvis oppgitt",
    "organizer": "Arrangør/firma navn",
    "deadline": "YYYY-MM-DD",
    "category": "teknologi/reise/gaming/sport/mat/annet",
    "image": "Passende emoji for premien",
    "type": "gratis"
}`;

        console.log('Calling OpenAI for text analysis...');
        
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini",
            messages: [
                { 
                    role: "system", 
                    content: "Du analyserer norske konkurranser. Returner kun gyldig JSON basert på den oppgitte teksten." 
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
        console.log('AI response received, length:', aiResponse.length);
        
        // Clean JSON
        let cleanedResponse = aiResponse
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
        
        // Find JSON boundaries
        const jsonStart = cleanedResponse.indexOf('{');
        const jsonEnd = cleanedResponse.lastIndexOf('}') + 1;
        
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
            cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd);
        }
        
        const competitionData = JSON.parse(cleanedResponse);
        
        // Apply manual overrides
        if (manualOverrides.title) competitionData.title = manualOverrides.title;
        if (manualOverrides.organizer) competitionData.organizer = manualOverrides.organizer;
        if (manualOverrides.prize) competitionData.prize = manualOverrides.prize;
        if (manualOverrides.deadline) competitionData.deadline = manualOverrides.deadline;
        if (manualOverrides.category) competitionData.category = manualOverrides.category;
        if (manualOverrides.type) competitionData.type = manualOverrides.type;
        
        // Add metadata
        competitionData.id = Date.now();
        competitionData.addedDate = new Date().toISOString();
        competitionData.sourceUrl = url;
        competitionData.aiParsed = true;
        
        // Validate and clean
        return validateCompetitionData(competitionData);
        
    } catch (error) {
        console.error('AI text analysis failed:', error.message);
        return createFallbackFromText(text, url, manualOverrides);
    }
}

// Fallback text analysis without AI
function createFallbackFromText(text, url, manualOverrides = {}) {
    const hostname = new URL(url).hostname.replace('www.', '');
    const textLower = text.toLowerCase();
    
    // Extract title - look for patterns
    let title = manualOverrides.title || extractTitle(text) || `${hostname} konkurranse`;
    
    // Extract prize
    let prize = manualOverrides.prize || extractPrize(text) || 'Se konkurransesiden for premieinformasjon';
    
    // Extract organizer
    let organizer = manualOverrides.organizer || extractOrganizer(text, hostname) || hostname;
    
    // Determine category and emoji
    let category = manualOverrides.category || 'annet';
    let image = '🎁';
    
    if (textLower.includes('ikea')) {
        organizer = organizer || 'Ikea';
        image = '🏠';
    } else if (textLower.includes('iphone') || textLower.includes('apple')) {
        category = 'teknologi';
        image = '📱';
    } else if (textLower.includes('reise') || textLower.includes('ferie')) {
        category = 'reise';
        image = '✈️';
    }
    
    // Extract deadline
    let deadline = manualOverrides.deadline || extractDeadline(text) || 
                   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    return {
        id: Date.now(),
        title: title.substring(0, 80),
        description: `Konkurranse fra ${organizer}. Se lenken for fullstendige detaljer.`,
        prize: prize.substring(0, 100),
        organizer: organizer.substring(0, 50),
        deadline: deadline,
        category: category,
        image: image,
        type: manualOverrides.type || 'gratis',
        addedDate: new Date().toISOString(),
        sourceUrl: url,
        aiParsed: false
    };
}

// Helper functions for text extraction
function extractTitle(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5);
    
    // Look for lines with competition keywords
    const competitionLines = lines.filter(line => {
        const lower = line.toLowerCase();
        return lower.includes('vinn') || lower.includes('konkurranse') || 
               lower.includes('premie') || lower.includes('gavekort');
    });
    
    return competitionLines[0] || lines[0] || null;
}

function extractPrize(text) {
    const prizePatterns = [
        /vinn\s+([^.!?\n]{10,80})/i,
        /premie[^.!?\n]{0,20}([^.!?\n]{10,80})/i,
        /gavekort[^.!?\n]{0,50}/i,
        /(\d+\s*kr[^.!?\n]{0,30})/i
    ];
    
    for (const pattern of prizePatterns) {
        const match = text.match(pattern);
        if (match) {
            return match[0].trim();
        }
    }
    
    return null;
}

function extractOrganizer(text, hostname) {
    const lines = text.split('\n').map(l => l.trim());
    
    // Look for organizer patterns
    const organizerPatterns = [
        /arrangør[:\s]+([^\n.!?]{2,30})/i,
        /av\s+([A-ZÆØÅ][a-zæøåA-ZÆØÅ\s]{2,30})/,
        /(ikea|apple|samsung|nintendo|sony|microsoft|google)/i
    ];
    
    for (const pattern of organizerPatterns) {
        const match = text.match(pattern);
        if (match) {
            return match[1] ? match[1].trim() : match[0].trim();
        }
    }
    
    return hostname.charAt(0).toUpperCase() + hostname.slice(1);
}

function extractDeadline(text) {
    const datePatterns = [
        /(\d{1,2})\.\s*(\w+)\s*(\d{4})/i, // 15. oktober 2025
        /(\d{4})-(\d{1,2})-(\d{1,2})/,    // 2025-10-15
        /(\d{1,2})\/(\d{1,2})\/(\d{4})/   // 15/10/2025
    ];
    
    for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match) {
            try {
                if (pattern.source.includes('\\w+')) {
                    // Handle Norwegian month names
                    const monthMap = {
                        'januar': '01', 'februar': '02', 'mars': '03', 'april': '04',
                        'mai': '05', 'juni': '06', 'juli': '07', 'august': '08',
                        'september': '09', 'oktober': '10', 'november': '11', 'desember': '12'
                    };
                    const month = monthMap[match[2].toLowerCase()];
                    if (month) {
                        return `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
                    }
                }
                // Handle other formats...
                return new Date(match[0]).toISOString().split('T')[0];
            } catch (e) {
                continue;
            }
        }
    }
    
    return null;
}

function validateCompetitionData(data) {
    // Ensure required fields
    if (!data.title || data.title.length < 3) {
        data.title = 'Ny konkurranse';
    }
    
    if (!data.organizer || data.organizer.length < 2) {
        data.organizer = 'Ukjent arrangør';
    }
    
    // Validate deadline
    const deadlineDate = new Date(data.deadline);
    const today = new Date();
    const oneYearFromNow = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000);
    
    if (deadlineDate <= today || deadlineDate > oneYearFromNow || isNaN(deadlineDate)) {
        data.deadline = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }
    
    // Validate category
    const validCategories = ['teknologi', 'reise', 'gaming', 'sport', 'mat', 'annet'];
    if (!validCategories.includes(data.category)) {
        data.category = 'annet';
    }
    
    return data;
}
