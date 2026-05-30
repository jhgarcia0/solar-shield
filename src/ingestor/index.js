'use strict';

const express = require('express');
const axios = require('axios');
const amqplib = require('amqplib');

const app = express();
app.use(express.json());

const NASA_API_KEY = process.env.NASA_API_KEY || 'DEMO_KEY';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const QUEUE_NAME = 'space_events';
const PORT = process.env.PORT || 3001;

let mqChannel = null;

// RN1 - classifica severidade pelo índice Kp
function classifySeverity(kpIndex) {
  if (kpIndex <= 4) return { severity: 'low', emergencyNotification: false };
  if (kpIndex <= 7) return { severity: 'moderate', emergencyNotification: false };
  return { severity: 'severe', emergencyNotification: true };
}

// conecta ao RabbitMQ com retry (ele demora um pouco pra subir)
async function connectRabbitMQ(retries = 10) {
  for (let i = 1; i <= retries; i++) {
    try {
      const conn = await amqplib.connect(RABBITMQ_URL);
      mqChannel = await conn.createChannel();
      await mqChannel.assertQueue(QUEUE_NAME, { durable: true });
      console.log('[ingestor] conectado ao RabbitMQ');
      return;
    } catch (err) {
      console.log(`[ingestor] RabbitMQ não disponível, tentativa ${i}/${retries}...`);
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

app.post('/ingest/gst', async (req, res) => {
  try {
    // busca eventos dos últimos 7 dias
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const startDate = since.toISOString().split('T')[0];

    const url = `https://api.nasa.gov/DONKI/GST?startDate=${startDate}&api_key=${NASA_API_KEY}`;
    console.log(`[ingestor] buscando dados da NASA a partir de ${startDate}...`);

    const response = await axios.get(url, { timeout: 10000 });
    const events = response.data;

    if (!events || events.length === 0) {
      return res.json({ message: 'nenhum evento GST encontrado no período', published: 0 });
    }

    let published = 0;
    for (const event of events) {
      const kpValues = event.allKpIndex || [];
      const maxKp = kpValues.length > 0
        ? Math.max(...kpValues.map(k => k.kpIndex))
        : 0;

      const { severity, emergencyNotification } = classifySeverity(maxKp);

      const message = {
        event_id: event.gstID,
        startTime: event.startTime,
        kpIndex: maxKp,
        severity,
        emergencyNotification,
        ingestedAt: new Date().toISOString(),
      };

      mqChannel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(message)), { persistent: true });
      published++;
      console.log(`[ingestor] publicado: ${event.gstID} | kp=${maxKp} | severity=${severity}`);
    }

    res.json({ message: 'ingestão concluída', published });
  } catch (err) {
    console.error('[ingestor] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'ingestor' }));

async function start() {
  await connectRabbitMQ();
  app.listen(PORT, () => console.log(`[ingestor] rodando na porta ${PORT}`));
}

start().catch(err => {
  console.error('[ingestor] falha fatal:', err.message);
  process.exit(1);
});
