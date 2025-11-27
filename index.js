const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
const https = require('https');

const app = express();
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// LINE credentials
const CHANNEL_SECRET = '30a5026799257744c6b46f02c7c70543';
const CHANNEL_ACCESS_TOKEN = 'hybpljdf5wtfttwWD01HvOIwrg2aAvez0wGK/obXJXXgWpu64ZbbaJB6spQ3VgcT21Ogb1MBIu8oeskvpV8S7bp0SoV/1mnstEg4rl+k1I8xqPsrypahTlt7x/sT7wCf2HMW7rpxnp+X6rCTBmGXEgdB04t89/1O/w1cDnyilFU=';

// ----- helpers -----
const apiBase =
  'http://223.27.194.89:8083/itemlocation/selectbyitemcode?compcode=100&itemcode=';

const fetchStockForCode = async (code) => {
  const url = `${apiBase}${encodeURIComponent(code)}`;
  const { data } = await axios.get(url);
  const byWh = {};
  let total = 0;

  (data || []).forEach((entry) => {
    const wh = String(entry.whCode || '').trim() || 'UNKNOWN';
    const onhand = Number(entry.onhand || 0);
    byWh[wh] = (byWh[wh] || 0) + onhand;
    total += onhand;
  });

  return { code, total, byWh };
};

/* ----------------------------------------------------
   OPTIMIZED SIZE MAP
---------------------------------------------------- */

// Shared sizes for common types
const COMMON_SIZES = Object.freeze([
  'xs', 's', 'm', 'l', 'xl', 'xxl', '3xl', '4xl'
]);

const COMMON_SIZE_TYPES = [
  'fo', 'foc', 'focp', 'fohz', 'fok',
  'fopa', 'fopk', 'fopo', 'fvcp', 'lo', 'vo',

  // Added FM.BHZ*** codes
  'FM.BHZ016',
  'FM.BHZ037',
  'FM.BHZ042',
  'FM.BHZ053',
  'FM.BHZ068',
  'FM.BHZ069',
  'FM.BHZ070',
  'FM.BHZ072',
  'FM.BHZ073',
  'FM.BHZ075',
  'FM.BHZ080',
  'FM.BHZ083',
  'FM.BHZ090',
  'FM.BHZ094',
  'FM.BHZ100',
  'FM.BHZ101',
  'FM.BHZ108',
  'FM.BHZ115',
  'FM.BHZ118',
  'FM.BHZ122',
  'FM.BHZ125',
  'FM.BHZ129',
  'FM.BHZ130',
  'FM.BHZ136',
  'FM.BHZ137',
  'FM.BHZ138',
  'FM.BHZ139',
  'FM.BHZ140',
  'FM.BHZ141',
  'FM.BHZ151',
  'FM.BHZ169',
  'FM.BHZ195',
  'FM.BHZ196',
  'FM.BHZ201',
  'FM.BHZ202',
  'FM.BHZ206',
  'FM.BHZ227'
];

// Construct repeated mappings automatically
const COMMON_TYPE_MAP = Object.fromEntries(
  COMMON_SIZE_TYPES.map(t => [t, COMMON_SIZES])
);

// Final SIZE_MAP
const SIZE_MAP = {
  ag180: ['s', 'm', 'l', 'xl', 'xxl', '3xl', '4xl'],
  ag210: ['xs', 's', 'm', 'l', 'xl', 'xxl', '3xl', '4xl', '5xl'],
  ag240: ['m', 'l', 'xl', 'xxl', '3xl', '4xl', '5xl'],
  ag2310: ['m', 'l', 'xl', 'xxl', '3xl', '4xl'],

  // Insert all common types
  ...COMMON_TYPE_MAP,
};

const parseAllPattern = (text) => {
  const parts = text.split('-').map(s => s.trim()).filter(Boolean);
  if (parts.length < 3) return null;

  const maybeAll = parts[parts.length - 1].toLowerCase();
  if (maybeAll !== 'all') return null;

  const type = parts[0].toLowerCase();
  const color = parts.slice(1, parts.length - 1).join('-');

  if (!SIZE_MAP[type]) return { type, color, sizes: null };
  return { type, color, sizes: SIZE_MAP[type] };
};

const buildAllCodes = ({ type, color, sizes }) =>
  sizes.map(sz => `${type.toUpperCase()}-${color}-${sz}`);

const stringifyByWh = (byWh, indent = '   ') => {
  const entries = Object.entries(byWh).filter(([, qty]) => qty > 0);
  if (!entries.length) return '';
  return '\n' + entries.map(([wh, q]) => `${indent}${wh}: ${q} units`).join('\n');
};

// ----- main handler -----
app.post('/linebot', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  const hash = crypto
    .createHmac('SHA256', CHANNEL_SECRET)
    .update(req.rawBody)
    .digest('base64');

  if (hash !== signature) {
    console.error('❌ Invalid signature!');
    return res.sendStatus(403);
  }

  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text.trim();
      const lowerMessage = userMessage.toLowerCase();
      const replyToken = event.replyToken;

      try {
        /* ----------------------------------------------------
           HANDLE ALL-SIZE REQUESTS
        ---------------------------------------------------- */
        const allReq = parseAllPattern(lowerMessage);
        if (allReq) {
          const { type, color, sizes } = allReq;

          if (!SIZE_MAP[type]) {
            const msg = `Unknown shirt type "${type.toUpperCase()}". Supported types: ${Object.keys(SIZE_MAP).join(', ').toUpperCase()}`;
            await axios.post(
              'https://api.line.me/v2/bot/message/reply',
              { replyToken, messages: [{ type: 'text', text: msg }] },
              {
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`
                }
              }
            );
            continue;
          }

          const codes = buildAllCodes({ type, color, sizes });
          const results = await Promise.all(codes.map(fetchStockForCode));

          let message = `Stock for ${type.toUpperCase()}-${color}-ALL\n`;
          let anyStockFound = false;

          for (let i = 0; i < results.length; i++) {
            const sizeLabel = sizes[i].toUpperCase();
            const r = results[i];
            if (r.total > 0) anyStockFound = true;

            message += `\n${sizeLabel}: ${r.total} unit${r.total !== 1 ? 's' : ''}`;
            const whLines = stringifyByWh(r.byWh);
            if (whLines) message += whLines;
            message += '\n';
          }

          if (!anyStockFound) {
            message += `\nNo stock found for any size.`;
          }

          await axios.post(
            'https://api.line.me/v2/bot/message/reply',
            { replyToken, messages: [{ type: 'text', text: message }] },
            {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`
              }
            }
          );

          console.log(`✅ Replied with ALL-sizes stock for ${type.toUpperCase()}-${color}`);
          continue;
        }

        /* ----------------------------------------------------
           SINGLE PRODUCT CODE
        ---------------------------------------------------- */
        const itemCode = userMessage;
        const apiUrl = `${apiBase}${encodeURIComponent(itemCode)}`;
        const response = await axios.get(apiUrl);
        const data = response.data;

        const stockByWh = {};
        let total = 0;

        data.forEach(entry => {
          const wh = entry.whCode;
          const onhand = Number(entry.onhand);
          stockByWh[wh] = (stockByWh[wh] || 0) + onhand;
          total += onhand;
        });

        let message = `Stock for ${itemCode}:\n${total} unit${total !== 1 ? 's' : ''}`;
        const whLines = stringifyByWh(stockByWh);
        if (whLines) message += whLines;

        if (total === 0) {
          message = `No stock found for ${itemCode}`;
        }

        await axios.post(
          'https://api.line.me/v2/bot/message/reply',
          { replyToken, messages: [{ type: 'text', text: message }] },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`
            }
          }
        );

        console.log(`✅ Replied with stock info for ${itemCode}`);
      } catch (err) {
        console.error('❌ Error fetching or replying:', err.message);
        await axios.post(
          'https://api.line.me/v2/bot/message/reply',
          {
            replyToken,
            messages: [{ type: 'text', text: `Error checking stock for "${userMessage}".` }]
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`
            }
          }
        );
      }
    }
  }

  res.sendStatus(200);
});

// ----- server + health check -----
app.listen(3000, () => {
  console.log('🚀 Server running at http://localhost:3000');
});

app.get('/ping', (req, res) => {
  res.send('🏓 Pong!');
});

// Self-ping every 10 minutes to keep Render awake
const SELF_URL = 'https://cbg-bot.onrender.com/ping';
setInterval(() => {
  console.log('⏱️ Pinging self to stay awake...');
  https.get(SELF_URL, (res) => {
    console.log(`✅ Self-ping status: ${res.statusCode}`);
  }).on('error', (err) => {
    console.error('⚠️ Self-ping failed:', err.message);
  });
}, 600000);
