// Testes unitários — RN1 e RN3
// Rodar com: npm test

// lógica de negócio (idêntica à dos serviços)
function classifySeverity(kpIndex) {
  if (kpIndex <= 4) return { severity: 'low', emergencyNotification: false };
  if (kpIndex <= 7) return { severity: 'moderate', emergencyNotification: false };
  return { severity: 'severe', emergencyNotification: true };
}

function tryProcess(processedIds, eventId) {
  if (processedIds.has(eventId)) {
    console.log(`[log duplicata] evento ${eventId} já processado, descartando`);
    return false;
  }
  processedIds.add(eventId);
  return true;
}

// -----------------------------------------------------------------------

// Teste 1 - RN1: classificação de severidade por índice Kp
test('RN1 - classifica corretamente a severidade pelo índice Kp', () => {
  // baixo
  expect(classifySeverity(0)).toEqual({ severity: 'low', emergencyNotification: false });
  expect(classifySeverity(4)).toEqual({ severity: 'low', emergencyNotification: false });

  // moderado
  expect(classifySeverity(5)).toEqual({ severity: 'moderate', emergencyNotification: false });
  expect(classifySeverity(7)).toEqual({ severity: 'moderate', emergencyNotification: false });

  // severo
  expect(classifySeverity(8)).toEqual({ severity: 'severe', emergencyNotification: true });
  expect(classifySeverity(9)).toEqual({ severity: 'severe', emergencyNotification: true });
});

// Teste 2 - RN1: emergencyNotification só é true quando severe
test('RN1 - emergencyNotification é true apenas para severity "severe"', () => {
  expect(classifySeverity(4).emergencyNotification).toBe(false);
  expect(classifySeverity(7).emergencyNotification).toBe(false);
  expect(classifySeverity(8).emergencyNotification).toBe(true);
});

// Teste 3 - RN3: idempotência rejeita event_id duplicado
test('RN3 - evento com event_id duplicado deve ser descartado', () => {
  const processedIds = new Set();

  const first = tryProcess(processedIds, 'GST-2024-001');
  expect(first).toBe(true); // primeira vez: processado

  const duplicate = tryProcess(processedIds, 'GST-2024-001');
  expect(duplicate).toBe(false); // duplicata: descartada

  // evento diferente deve ser aceito normalmente
  const other = tryProcess(processedIds, 'GST-2024-002');
  expect(other).toBe(true);

  expect(processedIds.size).toBe(2); // só dois IDs únicos
});
