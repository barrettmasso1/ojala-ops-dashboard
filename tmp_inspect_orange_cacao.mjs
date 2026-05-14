import fs from 'node:fs';

const imagePath = '/home/ubuntu/upload/e297376a-3e81-4996-9cb2-8b91e7ce897e.jpeg';
const mimeType = 'image/jpeg';
const data = fs.readFileSync(imagePath).toString('base64');
const dataUrl = `data:${mimeType};base64,${data}`;

const flavors = [
  'Vanilla','Chocolate','Cinnamon','Peanut Butter','Coffee','Ginger','Lemon','Mint Chip','Cookies and Cream','Passion Fruit','Pistachio','Strawberry','Sweet Potato','Watermelon','Mint','Ruby Port','Soursop','Orange Cacao','Banana','Flavor of the Day'
];

const payload = {
  model: 'gemini-2.5-flash',
  messages: [
    {
      role: 'system',
      content: 'You extract gelato inventory data from a single photo. Each photo can show one pan, two pans of the same flavor, or one small pan plus one large pan of the same flavor on a single scale. When exactly one pan is visible, default it to a small pan unless the image is unmistakably a large pan. When two pans are visible, report whether they are two small pans, two large pans, or one small plus one large. Return one flavor name, the small-pan count, the large-pan count, and the combined gross weight in kilograms. If anything is unclear, lower confidence and explain briefly in warning.'
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `This is a single gelato pan photo for a pilot inventory workflow. Identify the flavor label, read the scale display in kilograms, and count whether the image shows one small pan, one large pan, two small pans, two large pans, or one small plus one large pan of the same flavor. Known common flavors include: ${flavors.join(', ')}. Use a custom flavor only when the label clearly shows something else. If the scale, label, or pan sizes are unclear, return the best visible answer, set confidence to low, and explain the problem in warning.`
        },
        {
          type: 'image_url',
          image_url: {
            url: dataUrl,
            detail: 'high'
          }
        }
      ]
    }
  ],
  max_tokens: 32768,
  thinking: { budget_tokens: 128 },
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'gelato_photo_extraction',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          flavor: { type: 'string' },
          small_pan_count: { type: 'number', minimum: 0, maximum: 2 },
          large_pan_count: { type: 'number', minimum: 0, maximum: 2 },
          gross_weight_kg: { type: 'number', minimum: 0 },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          warning: { type: 'string' }
        },
        required: ['flavor','small_pan_count','large_pan_count','gross_weight_kg','confidence','warning'],
        additionalProperties: false
      }
    }
  }
};

const apiUrl = `${(process.env.BUILT_IN_FORGE_API_URL || 'https://forge.manus.im').replace(/\/$/, '')}/v1/chat/completions`;
const apiKey = process.env.BUILT_IN_FORGE_API_KEY;
if (!apiKey) throw new Error('Missing BUILT_IN_FORGE_API_KEY');

const response = await fetch(apiUrl, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify(payload),
});

const text = await response.text();
console.log(text);
