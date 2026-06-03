'use strict';

const express = require('express');
const amqplib = require('amqplib');

const app = express();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const QUEUE_NAME = 'space_events';
const PORT = process.env.PORT || 3002;

// estado em memória (suficiente pro escopo do projeto)
const alerts = [];
const processedIds = new Set(); // controle de idempotência

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

app.get('/alerts', (req, res) => {
  res.json({ source: 'store', count: alerts.length, data: alerts });
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'alert-service' }));

async function start() {
  await connectRabbitMQ();
  app.listen(PORT, () => console.log(`[alert-service] rodando na porta ${PORT}`));
}

start().catch(err => {
  console.error('[alert-service] falha fatal:', err.message);
  process.exit(1);
});
