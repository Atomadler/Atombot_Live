const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const express = require('express');
const axios = require('axios');
const xml2js = require('xml2js');
require('dotenv').config();

const xmlParser = new xml2js.Parser();
const app = express();

// Express JSON & Raw Body Middleware (für Webhook-Signatur-Prüfungen)
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

// ==========================================
// 1. KANAL & SOCIAL MEDIA KONFIGURATION
// ==========================================

// Discord Channel-IDs
const CHANNEL_TWITCH_LIVE   = '1535265228261171292';
const CHANNEL_TIKTOK_LIVE   = '1535277286046179449';
const CHANNEL_YT_LIVE       = '1535276104103886878';

// Getrennte Video-Upload Kanäle
const CHANNEL_YT_VIDEO      = '1535281529620529253'; // Passe dies bei Bedarf an deinen YouTube Video Channel an
const CHANNEL_TIKTOK_VIDEO  = '1535281621169864754'; // Passe dies bei Bedarf an deinen TikTok Video Channel an

// Account-Namen & IDs
const TIKTOK_USERNAME      = 'Atomadler';
const TWITCH_USERNAME      = 'Atomadler';
const YOUTUBE_CHANNEL_ID   = 'UCH5q8Z0dHOILWwMk7CVs_bg';

// Pings
const PING_STREAMS = '@everyone';
const PING_VIDEOS  = '@everyone';

const PORT = process.env.PORT || 10000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

// Health-Check für Render
app.get('/', (req, res) => {
    res.send('Atombot Live Server läuft!');
});

// ==========================================
// 2. TWITCH EVENTSUB WEBHOOK
// ==========================================
app.post('/api/twitch/webhook', async (req, res) => {
    const messageType = req.headers['twitch-eventsub-message-type'];

    // Webhook Verifizierung von Twitch
    if (messageType === 'webhook_callback_verification') {
        return res.status(200).send(req.body.challenge);
    }

    // Wenn ein Stream gestartet wird
    if (messageType === 'notification') {
        const event = req.body.event;
        console.log(`[Twitch Webhook] Stream gestartet von: ${event.broadcaster_user_name}`);

        const url = `https://twitch.tv/${event.broadcaster_user_login}`;
        await sendStreamEmbed(
            CHANNEL_TWITCH_LIVE,
            `🟣 ${event.broadcaster_user_name} ist jetzt LIVE auf Twitch!`,
            `Der Stream läuft! Seid dabei:`,
            url,
            0x9146FF
        );

        return res.status(200).end();
    }

    res.status(200).end();
});

async function registerTwitchWebhook(broadcasterName) {
    try {
        const tokenRes = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: process.env.TWITCH_CLIENT_ID,
                client_secret: process.env.TWITCH_CLIENT_SECRET,
                grant_type: 'client_credentials'
            }
        });
        const accessToken = tokenRes.data.access_token;

        const userRes = await axios.get(`https://api.twitch.tv/helix/users?login=${broadcasterName}`, {
            headers: {
                'Client-ID': process.env.TWITCH_CLIENT_ID,
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!userRes.data.data.length) return;
        const broadcasterUserId = userRes.data.data[0].id;

        const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/api/twitch/webhook`;

        await axios.post('https://api.twitch.tv/helix/eventsub/subscriptions', {
            type: 'stream.online',
            version: '1',
            condition: { broadcaster_user_id: broadcasterUserId },
            transport: {
                method: 'webhook',
                callback: webhookUrl,
                secret: 'EinSicheresGeheimnisFuerTwitch123'
            }
        }, {
            headers: {
                'Client-ID': process.env.TWITCH_CLIENT_ID,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`✅ [Twitch] EventSub erfolgreich registriert für: ${broadcasterName}`);
    } catch (err) {
        if (err.response && err.response.status === 409) {
            console.log(`ℹ️ [Twitch] Webhook für ${broadcasterName} bereits registriert.`);
        } else {
            console.error('❌ [Twitch] Registrierungsfehler:', err.response ? err.response.data : err.message);
        }
    }
}

// ==========================================
// 3. YOUTUBE LIVE & VIDEO WEBHOOK
// ==========================================
app.get('/api/youtube/webhook', (req, res) => {
    const challenge = req.query['hub.challenge'];
    if (challenge) {
        console.log('✅ [YouTube] Webhook erfolgreich verifiziert!');
        return res.status(200).send(challenge);
    }
    res.status(400).send('Keine Challenge übergeben');
});

app.post('/api/youtube/webhook', express.text({ type: '*/*' }), async (req, res) => {
    res.status(200).end();

    try {
        const result = await xmlParser.parseStringPromise(req.body);
        if (result.feed && result.feed.entry) {
            const entry = result.feed.entry[0];
            const videoId = entry['yt:videoId'][0];
            const videoTitle = entry.title[0];
            const channelTitle = entry.author[0].name[0];
            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

            const apiKey = process.env.YOUTUBE_API_KEY;
            if (apiKey) {
                const ytRes = await axios.get(`https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${videoId}&key=${apiKey}`);
                const item = ytRes.data.items[0];

                if (item && item.snippet) {
                    const isLive = item.snippet.liveBroadcastContent === 'live';

                    if (isLive) {
                        // YouTube Stream
                        await sendStreamEmbed(
                            CHANNEL_YT_LIVE,
                            `🔴 ${channelTitle} ist jetzt LIVE auf YouTube!`,
                            `**${videoTitle}**\n\nEin neuer Stream hat begonnen. Schaltet ein!`,
                            videoUrl,
                            0xFF0000
                        );
                    } else if (item.snippet.liveBroadcastContent === 'none') {
                        // YouTube Upload
                        await sendMediaEmbed(
                            CHANNEL_YT_VIDEO,
                            `🎬 Neues YouTube-Video online!`,
                            `**${videoTitle}**\n\nSchaut es euch jetzt an und lasst gerne ein Like da!`,
                            videoUrl,
                            PING_VIDEOS,
                            0xFF0000
                        );
                    }
                }
            }
        }
    } catch (err) {
        console.error('[YouTube Webhook] Fehler:', err.message);
    }
});

async function registerYouTubeWebhook(youtubeChannelId) {
    try {
        const hubUrl = 'https://pubsubhubbub.appspot.com/subscribe';
        const callbackUrl = `${process.env.RENDER_EXTERNAL_URL}/api/youtube/webhook`;
        const topicUrl = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${youtubeChannelId}`;

        const params = new URLSearchParams();
        params.append('hub.callback', callbackUrl);
        params.append('hub.mode', 'subscribe');
        params.append('hub.topic', topicUrl);
        params.append('hub.verify', 'asynchronous');

        await axios.post(hubUrl, params);
        console.log(`✅ [YouTube] Webhook-Abo angefordert für Kanal: ${youtubeChannelId}`);
    } catch (err) {
        console.error('❌ [YouTube] Registrierungsfehler:', err.message);
    }
}

// ==========================================
// 4. TIKTOK WEBHOOKS (Bspw. via Zapier / RSS)
// ==========================================
// Zeitstempel für Duplikatsperren (über den Routen definieren)
let lastTikTokLiveTime = 0;
let lastTikTokVideoTime = 0;

// ==========================================
// 1. TIKTOK LIVE WEBHOOK
// ==========================================
app.post('/api/tiktok/webhook', async (req, res) => {
    const now = Date.now();
    
    // Sperre: Wenn der Live-Ping weniger als 6 Stunden her ist, ignorieren
    if (now - lastTikTokLiveTime < 6 * 60 * 60 * 1000) {
        console.log("ℹ️ TikTok-Live-Webhook empfangen, aber wegen Duplikatsperre ignoriert.");
        return res.status(200).send("Ignored duplicate live");
    }

    const { title, streamUrl, username } = req.body;
    
    // --- DEIN BESTEHENDER DISCORD-EMBED CODE FÜR LIVE ---
    // ...

    lastTikTokLiveTime = now;
    return res.status(200).send("Notification sent");
});

// ==========================================
// 2. TIKTOK VIDEO UPLOAD WEBHOOK
// ==========================================
app.post('/api/tiktok/video-webhook', async (req, res) => {
    const now = Date.now();
    
    // Sperre: Wenn der Video-Ping weniger als 6 Stunden her ist, ignorieren
    if (now - lastTikTokVideoTime < 6 * 60 * 60 * 1000) {
        console.log("ℹ️ TikTok-Video-Webhook empfangen, aber wegen Duplikatsperre ignoriert.");
        return res.status(200).send("Ignored duplicate video");
    }

    const { title, videoUrl, username } = req.body;

    // --- DEIN BESTEHENDER DISCORD-EMBED CODE FÜR VIDEOS ---
    // ...

    lastTikTokVideoTime = now;
    return res.status(200).send("Notification sent");
});
// Endpoint für TikTok Live
app.post('/api/tiktok/webhook', express.json(), async (req, res) => {
    const { title, url, author } = req.body;
    const streamUrl = url || `https://www.tiktok.com/@${TIKTOK_USERNAME}/live`;

    await sendStreamEmbed(
        CHANNEL_TIKTOK_LIVE,
        `🔴 ${author || TIKTOK_USERNAME} ist jetzt LIVE auf TikTok!`,
        title || `Schaut vorbei und bringt Stimmung in den Chat!`,
        streamUrl,
        0xFF0050
    );

    res.status(200).json({ status: 'ok' });
});

// Endpoint für TikTok Video Uploads
app.post('/api/tiktok/video-webhook', express.json(), async (req, res) => {
    const { title, videoUrl } = req.body;
    const targetUrl = videoUrl || `https://www.tiktok.com/@${TIKTOK_USERNAME}`;

    await sendMediaEmbed(
        CHANNEL_TIKTOK_VIDEO,
        `📱 Neues TikTok-Video online!`,
        title || `Ein neues Video ist da! Reinschauen, liken und teilen! 🚀`,
        targetUrl,
        PING_VIDEOS,
        0x00F2FE
    );

    res.status(200).json({ status: 'ok' });
});

// ==========================================
// 5. HELPER-FUNKTIONEN ZUM SENDEN
// ==========================================
async function sendStreamEmbed(channelId, title, desc, url, color) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return console.error(`Kanal ${channelId} nicht gefunden.`);

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(desc)
            .setURL(url)
            .setColor(color)
            .setTimestamp();

        const button = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Zum Stream 🚀')
                .setStyle(ButtonStyle.Link)
                .setURL(url)
        );

        await channel.send({ content: PING_STREAMS, embeds: [embed], components: [button] });
    } catch (err) {
        console.error('Fehler beim Senden des Stream-Embeds:', err.message);
    }
}

async function sendMediaEmbed(channelId, title, desc, url, ping, color) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return console.error(`Kanal ${channelId} nicht gefunden.`);

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(desc)
            .setURL(url)
            .setColor(color)
            .setTimestamp();

        const button = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Jetzt ansehen 🍿')
                .setStyle(ButtonStyle.Link)
                .setURL(url)
        );

        await channel.send({ content: ping, embeds: [embed], components: [button] });
    } catch (err) {
        console.error('Fehler beim Senden des Video-Embeds:', err.message);
    }
}

// ==========================================
// 6. BOT BOOTSTRAP
// ==========================================
client.once('ready', () => {
    console.log(`✅ Atombot Live ist online als: ${client.user.tag}`);

    // Webhooks registrieren
    if (process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET) {
        registerTwitchWebhook(TWITCH_USERNAME);
    }
    if (YOUTUBE_CHANNEL_ID) {
        registerYouTubeWebhook(YOUTUBE_CHANNEL_ID);
    }
});

app.listen(PORT, () => {
    console.log(`🌐 Webhook-Server hört auf Port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);