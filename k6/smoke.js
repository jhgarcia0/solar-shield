import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '10s',
};

// sobrescreva com BASE_URL=http://nginx ao rodar dentro do Docker
const BASE_URL = __ENV.BASE_URL || 'http://localhost';

export default function () {
  const res = http.get(`${BASE_URL}/api/alerts`);

  check(res, {
    'GET /api/alerts retorna 200': r => r.status === 200,
    'resposta contém campo data': r => JSON.parse(r.body).data !== undefined,
  });

  sleep(1);
}
