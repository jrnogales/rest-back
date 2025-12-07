// src/services/bancoService.js
import fetch from 'node-fetch';

//
// =============================================
// CONFIG
// =============================================
// URL base del banco
const BANK_BASE_URL =
  process.env.BANK_BASE_URL || 'http://mibanca.runasp.net/api';

// CUENTA DE LA AGENCIA DONDE SE RECIBE EL PAGO
// 👉 AQUÍ ESTÁ LA CORRECCIÓN: 299
const CUENTA_AGENCIA =
  process.env.BANK_CUENTA_AGENCIA || '299';


//
// =============================================
// PAGO AL BANCO
// =============================================
//
// body esperado por el servicio:
// {
//   "cuenta_origen": "123",
//   "cuenta_destino": "299",
//   "monto": 50.00
// }
//
export async function realizarPagoBanco({ cuentaOrigen, monto }) {
  if (!cuentaOrigen) {
    throw new Error('cuentaOrigen es requerida');
  }
  if (!monto || Number(monto) <= 0) {
    throw new Error('monto inválido');
  }

  const numMonto = Number(monto);

  const body = {
    cuenta_origen: String(cuentaOrigen),
    cuenta_destino: String(CUENTA_AGENCIA), // ⬅️ 299
    monto: numMonto
  };

  const url = `${BANK_BASE_URL}/transacciones`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.mensaje || `Error del banco (${response.status})`
    );
  }

  return data; // ejemplo: { id: 10, cuenta_origen: "...", cuenta_destino: "299", monto: 50 }
}
