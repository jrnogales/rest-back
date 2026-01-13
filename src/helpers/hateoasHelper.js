// src/helpers/hateoasHelper.js

export function generarLinksPaquete(baseUrl, idPaquete) {
  return [
    {
      href: `${baseUrl}/api/v2/paquetes/${idPaquete}`,
      rel: 'self',
      method: 'GET'
    },
    {
      href: `${baseUrl}/api/v2/paquetes/pre-reserva`,
      rel: 'create-hold',
      method: 'POST'
    }
  ];
}

export function generarLinksHold(baseUrl, idHold) {
  return [
    {
      href: `${baseUrl}/api/v2/paquetes/reserva`,
      rel: 'confirm-reservation',
      method: 'POST'
    },
    {
      href: `${baseUrl}/api/v2/paquetes/${idHold}/reserva`,
      rel: 'get-reservation',
      method: 'GET'
    }
  ];
}

export function generarLinksReserva(baseUrl, idReserva, uriFactura) {
  const links = [
    {
      href: `${baseUrl}/api/v2/paquetes/${idReserva}/reserva`,
      rel: 'self',
      method: 'GET'
    }
  ];

  if (uriFactura) {
    links.push({
      href: uriFactura,
      rel: 'invoice',
      method: 'GET'
    });
  }

  return links;
}
