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
      const replyToken = event.replyToken;
      const itemCode = event.message.text.trim();

      try {
        const apiUrl = `http://223.27.194.89:8083/itemlocation/selectbyitemcode?compcode=100&branchcode=06&itemcode=${encodeURIComponent(itemCode)}`;
        const response = await axios.get(apiUrl);
        const data = response.data;

        // Sum onhand by whCode
        const stockByWh = {};
        data.forEach(entry => {
          const wh = entry.whCode;
          const onhand = Number(entry.onhand);
          if (!stockByWh[wh]) stockByWh[wh] = 0;
          stockByWh[wh] += onhand;
        });

        // Format reply
        let message = `Stock for ${itemCode}:\n`;
        for (const [wh, qty] of Object.entries(stockByWh)) {
          message += `${wh}: ${qty} unit${qty !== 1 ? 's' : ''}\n`;
        }

        if (Object.keys(stockByWh).length === 0) {
          message = `No stock found for ${itemCode}`;
        }

        // Send reply to user
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
            messages: [{ type: 'text', text: `Error checking stock for ${itemCode}.` }]
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
