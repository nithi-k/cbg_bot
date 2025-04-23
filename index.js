const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// LINE credentials
const CHANNEL_SECRET = '30a5026799257744c6b46f02c7c70543';
const CHANNEL_ACCESS_TOKEN = 'hybpljdf5wtfttwWD01HvOIwrg2aAvez0wGK/obXJXXgWpu64ZbbaJB6spQ3VgcT21Ogb1MBIu8oeskvpV8S7bp0SoV/1mnstEg4rl+k1I8xqPsrypahTlt7x/sT7wCf2HMW7rpxnp+X6rCTBmGXEgdB04t89/1O/w1cDnyilFU=';

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

      // 🍍 Stock check logic
      try {
        const itemCode = userMessage;
        const apiUrl = `http://223.27.194.89:8083/itemlocation/selectbyitemcode?compcode=100&branchcode=06&itemcode=${encodeURIComponent(itemCode)}`;
        const response = await axios.get(apiUrl);
        const data = response.data;

        const stockByWh = {};
        data.forEach(entry => {
          const wh = entry.whCode;
          const onhand = Number(entry.onhand);
          if (!stockByWh[wh]) stockByWh[wh] = 0;
          stockByWh[wh] += onhand;
        });

        let message = `Stock for ${itemCode}:\n`;
        for (const [wh, qty] of Object.entries(stockByWh)) {
          message += `${wh}: ${qty} unit${qty !== 1 ? 's' : ''}\n`;
        }

        if (Object.keys(stockByWh).length === 0) {
          message = `No stock found for ${itemCode}`;
        }

        await axios.post(
          'https://api.line.me/v2/bot/message/reply',
          {
            replyToken,
            messages: [{ type: 'text', text: message }]
          },
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
            messages: [{ type: 'text', text: `Error checking stock for ${userMessage}.` }]
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

app.listen(3000, () => {
  console.log('🚀 Server running at http://localhost:3000');
});

// Optional route for health check
app.get('/ping', (req, res) => {
  res.send('🏓 Pong!');
});

// Self-ping every 10 minutes to keep Render app awake
const SELF_URL = 'https://cbg-bot.onrender.com/ping';

setInterval(() => {
  console.log('⏱️ Pinging self to stay awake...');
  https.get(SELF_URL, (res) => {
    console.log(`✅ Self-ping status: ${res.statusCode}`);
  }).on('error', (err) => {
    console.error('⚠️ Self-ping failed:', err.message);
  });
}, 600000); // 10 minutes