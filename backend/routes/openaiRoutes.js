const express = require('express');
const router = express.Router();
const { OpenAI } = require('openai');
const { protect } = require('../middleware/authMiddleware');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Helper to check API Key
const checkApiKey = (res) => {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
        res.status(500).json({ 
            error: 'OpenAI API Key is missing or not configured. Please add your key to the backend .env file.' 
        });
        return false;
    }
    return true;
};

// Generate Text (GPT)
router.post('/generate-text', protect, async (req, res) => {
    const { prompt, currentData } = req.body;

    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    if (!checkApiKey(res)) return;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant for an SNS card generator. Generate 2 distinct sets of speaker details based on the prompt. Return ONLY a JSON object with a 'results' field containing an array of 2 objects, each with 'name', 'designation', and 'company' fields."
                },
                {
                    role: "user",
                    content: `Current data: ${JSON.stringify(currentData)}. Prompt: ${prompt}`
                }
            ],
            response_format: { type: "json_object" }
        });

        const content = response.choices[0].message.content;
        console.log('GPT Response:', content);
        const generatedData = JSON.parse(content);
        res.json(generatedData.results || []);
    } catch (err) {
        console.error('OpenAI GPT Error Details:', err.message || err);
        res.status(500).json({ 
            error: `OpenAI GPT Error: ${err.message || 'Unknown error'}`,
            details: err.response?.data || null
        });
    }
});

// Generate Background (DALL-E)
router.post('/generate-background', protect, async (req, res) => {
    const { prompt } = req.body;

    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    if (!checkApiKey(res)) return;

    try {
        console.log('Generating Background 1...');
        const response = await openai.images.generate({
            model: "dall-e-3",
            prompt: `A professional, high-quality, abstract or thematic background for a speaker's social media card. Prompt: ${prompt}. Aspect ratio: 1:1. Style: modern, premium web design style.`,
            n: 1,
            size: "1024x1024",
        });

        console.log('Generating Background 2...');
        const response2 = await openai.images.generate({
            model: "dall-e-3",
            prompt: `Another professional background variation for a speaker's social media card. Prompt: ${prompt}. Aspect ratio: 1:1. Style: modern, premium web design style.`,
            n: 1,
            size: "1024x1024",
        });

        res.json([response.data[0].url, response2.data[0].url]);
    } catch (err) {
        console.error('OpenAI DALL-E Error Details:', err.message || err);
        res.status(500).json({ 
            error: `OpenAI DALL-E Error: ${err.message || 'Unknown error'}`,
            details: err.response?.data || null
        });
    }
});

// Auto-Generate SNS Card (One-click: GPT design + DALL-E background)
router.post('/auto-generate-sns', protect, async (req, res) => {
    const { speaker, event, canvasSize, skipBackground } = req.body;

    if (!speaker) return res.status(400).json({ error: 'Speaker data is required' });
    if (!checkApiKey(res)) return;

    const size = canvasSize || { width: 1080, height: 1080 };
    const scaleFactor = Math.min(size.width, size.height) / 1080;
    const eventColors = event ? {
        primary: event.primary_color || '#FFD700',
        secondary: event.secondary_color || '#FFFFFF',
        accent: event.accent_color || '#CCCCCC'
    } : { primary: '#FFD700', secondary: '#FFFFFF', accent: '#CCCCCC' };

    // Fallback design if GPT fails (quota/rate limit)
    const fallbackDesign = {
        design: {
            elements: {
                name: { color: eventColors.primary, fontSize: Math.round(42 * scaleFactor), fontFamily: 'Montserrat', fontWeight: '800', textDecoration: 'none', letterSpacing: 1 },
                designation: { color: eventColors.secondary, fontSize: Math.round(22 * scaleFactor), fontFamily: 'Montserrat', fontWeight: '500', textDecoration: 'none', letterSpacing: 0 },
                company: { color: eventColors.accent, fontSize: Math.round(18 * scaleFactor), fontFamily: 'Montserrat', fontWeight: '500', textDecoration: 'none', letterSpacing: 0 }
            },
            positions: {
                photo: { x: 0.05, y: 0.2 },
                name: { x: 0.45, y: 0.35 },
                designation: { x: 0.45, y: 0.5 },
                company: { x: 0.45, y: 0.6 }
            },
            bgOverlay: { color: '#000000', opacity: 0.5 },
            bgPosition: 'center',
            photoSettings: { size: Math.round(380 * scaleFactor) }
        },
        background: null,
        message: 'Generated a default design using event brand colors (AI quota limit reached). You can refine it using the chat below.'
    };

    let gptResult = null;

    // Step 1: Generate design layout using GPT
    try {
        console.log('Auto-generating SNS card for:', speaker.name);

        const designResponse = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are an expert SNS Card Designer. Generate a complete, professional speaker card design in one shot.

You will receive speaker details (name, designation, company, topic) and event details (title, colors, venue).

Return a JSON object with:
1. "design": Complete card design with these fields:
   - "elements": {
       "name": { color, fontSize, fontFamily, fontWeight, textDecoration, letterSpacing },
       "designation": { color, fontSize, fontFamily, fontWeight, textDecoration, letterSpacing },
       "company": { color, fontSize, fontFamily, fontWeight, textDecoration, letterSpacing }
     }
     You may also add custom text elements with keys starting with "custom_" that have: { text, color, fontSize, fontFamily, fontWeight, textDecoration, letterSpacing, isCustom: true }
     For example, add the speaker's topic as a custom element if provided.
   - "positions": { photo: {x, y}, name: {x, y}, designation: {x, y}, company: {x, y} } (x,y are 0-1 percentages)
   - "bgOverlay": { color (hex), opacity (0-1) }
   - "bgPosition": "center" | "top" | "bottom"
   - "photoSettings": { size: number } (typically 300-500 based on canvas)

2. "backgroundPrompt": A detailed DALL-E prompt to generate a matching professional background image for this card. Include the event theme, industry, and mood. Make it abstract and professional — no text or faces in the background.

3. "message": A friendly message describing the design choices you made.

Design Rules:
- Use premium fonts: Montserrat, Poppins, Playfair Display, Raleway, or Inter
- Create strong visual hierarchy: name should be largest and boldest
- Position elements for clean readability — no overlapping
- Use event brand colors if provided, otherwise pick a professional palette
- Always add a bgOverlay for text legibility over photo backgrounds
- Scale font sizes proportionally to canvas size (base: 1080x1080)
- For portrait layouts, place photo in upper portion and text below
- For landscape, consider side-by-side photo and text layouts`
                },
                {
                    role: "user",
                    content: JSON.stringify({
                        speaker: {
                            name: speaker.name,
                            designation: speaker.designation,
                            company: speaker.company,
                            topic: speaker.topic || null,
                            category: speaker.category || null
                        },
                        event: event ? {
                            title: event.title,
                            description: event.description,
                            venue: event.venue,
                            primaryColor: event.primary_color,
                            secondaryColor: event.secondary_color,
                            accentColor: event.accent_color,
                            fontFamily: event.font_family
                        } : null,
                        canvasSize: size
                    })
                }
            ],
            response_format: { type: "json_object" }
        });

        gptResult = JSON.parse(designResponse.choices[0].message.content);
        console.log('GPT Design generated');
    } catch (gptErr) {
        console.error('GPT design generation failed:', gptErr.message);
        // Return fallback design instead of failing entirely
        return res.json(fallbackDesign);
    }

    // Step 2: Generate background image with DALL-E (optional)
    let backgroundUrl = null;
    if (!skipBackground && gptResult.backgroundPrompt) {
        try {
            console.log('Generating DALL-E background...');
            const bgResponse = await openai.images.generate({
                model: "dall-e-3",
                prompt: gptResult.backgroundPrompt,
                n: 1,
                size: "1024x1024",
            });
            backgroundUrl = bgResponse.data[0].url;
            console.log('DALL-E background generated');
        } catch (dalleErr) {
            console.error('DALL-E generation failed, continuing without background:', dalleErr.message);
        }
    }

    res.json({
        design: gptResult.design,
        background: backgroundUrl,
        message: gptResult.message || 'Your SNS card has been auto-generated!'
    });
});

module.exports = router;
