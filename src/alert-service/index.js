'use strict';

const express = require('express');
const amqplib = require('amqplib');
const redis = require('redis');

const app = express();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const QUEUE_NAME = 'space_events';
const CACHE_KEY = 'alerts:list';
const CACHE_TTL = 30; // segundos
const PORT = process.env.PORT || 3002;

// estado em memória (suficiente pro escopo do projeto)
const alerts = [];
const processedIds = new Set(); // controle de idempotência

let redisClient = null;

async function connectRedis() {
  redisClient = redis.createClient({ url: REDIS_URL });
  redisClient.on('error', err => console.error('[alert-service] redis error:', err.message));
  await redisClient.connect();
  console.log('[alert-service] conectado ao Redis');
}

async function connectRabbitMQ(retries = 10) {
  for (let i = 1; i <= retries; i++) {
    try {
      const conn = await amqplib.connect(RABBITMQ_URL);
      const channel = await conn.createChannel();
      await channel.assertQueue(QUEUE_NAME, { durable: true });

      channel.consume(QUEUE_NAME, async (msg) => {
        if (!msg) return;

        const event = JSON.parse(msg.content.toString());

        // RN3 - idempotência: descarta duplicatas pelo event_id
        if (processedIds.has(event.event_id)) {
          console.log(`[alert-service] DUPLICATA descartada: ${event.event_id}`);
          channel.ack(msg);
          return;
        }

        processedIds.add(event.event_id);
        alerts.push(event);

        // invalida o cache quando um novo alerta chega
        await redisClient.del(CACHE_KEY).catch(() => {});

        console.log(`[alert-service] alerta armazenado: ${event.event_id} | ${event.severity}`);
        if (event.emergencyNotification) {
          console.log(`[alert-service] ** EMERGENCIA ** ${event.event_id} - kp=${event.kpIndex}`);
        }

        channel.ack(msg);
      });

      console.log('[alert-service] conectado ao RabbitMQ, consumindo fila...');
      return;
    } catch (err) {
      console.log(`[alert-service] RabbitMQ não disponível, tentativa ${i}/${retries}...`);
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// Cache-Aside: tenta Redis primeiro, senão serve da memória e atualiza o cache
app.get('/alerts', async (req, res) => {
  try {
    const cached = await redisClient.get(CACHE_KEY);

    if (cached) {
      console.log('[alert-service] cache HIT');
      const data = JSON.parse(cached);
      return res.json({ source: 'cache', count: data.length, data });
    }

    console.log('[alert-service] cache MISS');
    await redisClient.set(CACHE_KEY, JSON.stringify(alerts), { EX: CACHE_TTL });

    res.json({ source: 'store', count: alerts.length, data: alerts });
  } catch (err) {
    console.error('[alert-service] erro no GET /alerts:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'alert-service' }));

async function start() {
  await connectRedis();
  await connectRabbitMQ();
  app.listen(PORT, () => console.log(`[alert-service] rodando na porta ${PORT}`));
}

start().catch(err => {
  console.error('[alert-service] falha fatal:', err.message);
  process.exit(1);
});
