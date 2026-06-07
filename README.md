# 🛡️ Solar Shield

Sistema de microsserviços que ingere dados reais da NASA (DONKI), classifica tempestades geomagnéticas e dispara alertas para operadores de infraestrutura crítica.

**Global Solution 2026.1 · FIAP · Microservice and Web Engineering**

---

## Arquitetura

```mermaid
graph LR
    C(["👤 Client"]) -->|HTTP :80| N["🌐 Nginx\nAPI Gateway\nRate Limit: 10 r/s"]
    N -->|"POST /api/ingest/gst"| I["⚙️ Ingestor\n:3001"]
    N -->|"GET /api/alerts"| A["📡 Alert Service\n:3002"]
    I -->|"retry + backoff"| D[("🛸 NASA DONKI\nAPI")]
    I -->|"publish event"| Q[("🐇 RabbitMQ\n:5672")]
    Q -->|"consume + idempotência"| A
    A <-->|"Cache-Aside\nTTL: 30s"| R[("🔴 Redis\n:6379")]
```

---

## Serviços

| Serviço | Porta | Responsabilidade |
|---------|-------|-----------------|
| `ingestor` | 3001 | Busca dados da NASA DONKI, classifica severidade (RN1) e publica no RabbitMQ |
| `alert-service` | 3002 | Consome a fila, aplica idempotência por `event_id` (RN3) e expõe os alertas |
| `nginx` | 80 | API Gateway — proxy reverso com rate limiting (10 req/s) |
| `rabbitmq` | 5672 / 15672 | Broker de mensagens (producer + consumer) |
| `redis` | 6379 | Cache com TTL para o endpoint de alertas |

---

## Cache TTL

O endpoint `GET /api/alerts` usa o padrão **Cache-Aside** com TTL de **30 segundos**. Justificativa: eventos de clima espacial do NASA DONKI são atualizados em intervalos de horas, portanto 30 segundos reduz significativamente a carga no serviço sem expor dados desatualizados ao operador.

---

## Como rodar

### Pré-requisitos

- Docker
- Docker Compose

### Subir a infraestrutura

```bash
git clone <url-do-repositorio>
cd solar-shield
docker-compose up --build
```

> Aguarde ~20s para o RabbitMQ inicializar completamente antes de disparar requisições.

---

## Endpoints

| Método | Rota | Serviço | Descrição |
|--------|------|---------|-----------|
| `POST` | `/api/ingest/gst` | ingestor | Busca eventos GST da NASA (últimos 7 dias) e publica na fila |
| `GET` | `/api/alerts` | alert-service | Lista os alertas classificados (com cache Redis) |

### Exemplos de uso

```bash
# 1. Disparar ingestão da NASA
curl -X POST http://localhost/api/ingest/gst

# 2. Consultar alertas — primeira chamada (cache MISS)
curl http://localhost/api/alerts

# 3. Consultar novamente — segunda chamada (cache HIT)
curl http://localhost/api/alerts
```

Observe no log do `alert-service` as linhas `cache HIT` e `cache MISS`.

---

## Regras de Negócio

**RN1 — Severidade de tempestade geomagnética:**

| Índice Kp | Severidade | emergencyNotification |
|-----------|------------|----------------------|
| Kp ≤ 4 | `low` | `false` |
| 5 ≤ Kp ≤ 7 | `moderate` | `false` |
| Kp ≥ 8 | `severe` | `true` |

**RN3 — Idempotência:**
- Eventos com o mesmo `event_id` recebidos mais de uma vez são descartados
- Um log de duplicata é registrado no console do `alert-service`

---

## Testes unitários

```bash
cd tests
npm install
npm test
```

Cobre RN1 (3 cenários de severidade) e RN3 (rejeição de duplicata).

---

## Smoke test k6

```bash
# com k6 instalado localmente (infraestrutura rodando)
k6 run k6/smoke.js

# via Docker (na mesma rede dos containers)
docker run --rm -i --network solar-shield_default \
  -e BASE_URL=http://nginx \
  grafana/k6 run - < k6/smoke.js
```

O resultado de uma execução está em `k6/result.txt`.

---

## Rate Limiting

O Nginx limita **10 requisições por segundo por IP**, com burst de 5. Requisições que excedem o limite recebem HTTP **429 Too Many Requests**.

Para testar:

```bash
# dispara 20 requisições em paralelo para ver o rate limiting em ação
for i in $(seq 1 20); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost/api/alerts & done; wait
```

---

## RabbitMQ Management UI

Acesse `http://localhost:15672` (login: `guest` / senha: `guest`) para visualizar:
- A fila `space_events`
- Mensagens publicadas e consumidas
- Taxa de throughput

---

## Resiliência

O **Ingestor** usa retry com backoff exponencial na chamada à NASA:

- Tentativa 1 → espera 1s
- Tentativa 2 → espera 2s
- Tentativa 3 → erro propagado

Ambos os serviços também reentam a conexão com o RabbitMQ durante o startup, com 10 tentativas e intervalo de 3s entre cada uma.

---

## Equipe

| Nome | GitHub |
|------|--------|
| João Henrique Garcia | [@jhgarcia0](https://github.com/jhgarcia0) |
| Mateus Bessornia | [@mbessornia](https://github.com/mbessornia) |
| Luan Rodrigues | [@LuanRodrigues15](https://github.com/LuanRodrigues15) |

**FIAP · Global Solution 2026.1 · Microservice and Web Engineering**
