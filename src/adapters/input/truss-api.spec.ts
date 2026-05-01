import TrussApi from './truss-api';
import type { ApiSearchFilter } from '../../models/types';

describe('TrussApi (SDK-backed)', () => {
  class MockTrussApiError extends Error {
    public status: number;
    public response: { data: unknown; headers: Record<string, string> };

    constructor(message: string, response: { status: number; data: unknown; headers?: Record<string, string> }) {
      super(message);
      this.status = response.status;
      this.response = {
        data: response.data,
        headers: response.headers ?? {},
      };
    }
  }

  const mockSearchProducts = jest.fn();
  const mockHttpPost = jest.fn();

  function makeApi(): TrussApi {
    const api = new TrussApi('k') as unknown as {
      sdk?: { TrussApiError: typeof MockTrussApiError };
      trussClient?: { search: { products: typeof mockSearchProducts } };
      httpClient?: { post: typeof mockHttpPost };
    };
    api.sdk = { TrussApiError: MockTrussApiError };
    api.trussClient = { search: { products: mockSearchProducts } };
    api.httpClient = { post: mockHttpPost };
    return api as unknown as TrussApi;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.TRUSS_API_MAX_RETRIES;
    delete process.env.TRUSS_API_RETRY_BASE_MS;
    delete process.env.TRUSS_API_RETRY_MAX_MS;
    delete process.env.TRUSS_API_RETRY_BUDGET_MS;
    delete process.env.TRUSS_API_PAGE_DELAY_MS;
  });

  it('returns agent data through SDK HttpClient', async () => {
    const payload = {
      apiKey: 'k',
      username: 'user',
      filterName: 'f',
      filter: { category: ['Malware'] },
      runIntervalMinutes: 30,
      serviceName: 'svc',
      serviceUrl: 'https://service',
      serviceKey: 'skey',
      serviceUser: 'suser',
    };
    mockHttpPost.mockResolvedValueOnce({ data: payload });

    const api = makeApi();
    const out = await api.getAgentData('k', 'conf');

    expect(mockHttpPost).toHaveBeenCalledWith('/agent-data', { apiKey: 'k', configName: 'conf' });
    expect(out).toEqual(payload);
  });

  it('paginates product search and maps API products to indicators', async () => {
    process.env.TRUSS_API_PAGE_DELAY_MS = '0';
    const filter: ApiSearchFilter = {
      category: ['Malware'],
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-01-02T00:00:00Z',
    };

    mockSearchProducts
      .mockResolvedValueOnce({
        products: [
          {
            id: 101,
            title: 'A',
            type: 'threat',
            category: 'Malware',
            source: 'source-1',
            pub_date: '2024-01-01T00:00:00Z',
            timestamp: '2024-01-01T00:00:00Z',
            indicators: { ip: ['1.2.3.4'] },
          },
        ],
        total: 2,
        page: 1,
        limit: 1000,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        products: [
          {
            id: 202,
            title: 'B',
            type: 'threat',
            category: 'Phishing',
            source: 'source-2',
            pub_date: '2024-01-01T01:00:00Z',
            timestamp: '2024-01-01T01:00:00Z',
          },
        ],
        total: 2,
        page: 2,
        limit: 1000,
        hasMore: false,
      });

    const api = makeApi();
    const out = await api.searchIndicators(filter);

    expect(mockSearchProducts).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('101');
    expect(out[0].source).toBe('source-1');
    expect(out[1].id).toBe('202');
    expect(out[1].category).toBe('Phishing');
  });

  it('retries retryable 429 once and then succeeds', async () => {
    process.env.TRUSS_API_MAX_RETRIES = '2';
    process.env.TRUSS_API_RETRY_BASE_MS = '1';
    process.env.TRUSS_API_RETRY_MAX_MS = '1';
    process.env.TRUSS_API_RETRY_BUDGET_MS = '1000';
    process.env.TRUSS_API_PAGE_DELAY_MS = '0';

    mockSearchProducts
      .mockRejectedValueOnce(new MockTrussApiError('rate limited', { status: 429, data: { error: 'rl' } }))
      .mockResolvedValueOnce({
        products: [],
        total: 0,
        page: 1,
        limit: 1000,
        hasMore: false,
      });

    const api = makeApi();
    const out = await api.searchIndicators({ days: 1 });

    expect(mockSearchProducts).toHaveBeenCalledTimes(2);
    expect(out).toEqual([]);
  });
});
