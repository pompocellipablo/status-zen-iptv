/** Page slices the already filtered and sorted client list for desktop and mobile. */
export const CLIENTS_PER_PAGE = 25;

export function paginateClients<T>(
  clients: readonly T[],
  requestedPage: number,
  pageSize = CLIENTS_PER_PAGE,
) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new RangeError('O tamanho da página deve ser um inteiro positivo.');
  }
  const count = clients.length;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const page = Number.isSafeInteger(requestedPage)
    ? Math.min(Math.max(1, requestedPage), totalPages)
    : 1;
  const startIndex = (page - 1) * pageSize;
  return {
    page,
    totalPages,
    count,
    first: count === 0 ? 0 : startIndex + 1,
    last: Math.min(count, startIndex + pageSize),
    rows: clients.slice(startIndex, startIndex + pageSize),
  };
}
