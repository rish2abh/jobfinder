import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from './embedding.service';

// Mock axios
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock chromadb
const mockUpsert = jest.fn().mockResolvedValue(undefined);
const mockQuery = jest.fn();
const mockGet = jest.fn();
const mockDelete = jest.fn().mockResolvedValue(undefined);
const mockGetOrCreateCollection = jest.fn().mockResolvedValue({
  upsert: mockUpsert,
  query: mockQuery,
  get: mockGet,
  delete: mockDelete,
});

jest.mock('chromadb', () => ({
  ChromaClient: jest.fn().mockImplementation(() => ({
    getOrCreateCollection: mockGetOrCreateCollection,
  })),
  IncludeEnum: {
    distances: 'distances',
    documents: 'documents',
    embeddings: 'embeddings',
    metadatas: 'metadatas',
    uris: 'uris',
  },
}));

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddingService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'OLLAMA_URL') return 'http://localhost:11434';
              if (key === 'CHROMADB_URL') return 'http://localhost:8000';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<EmbeddingService>(EmbeddingService);
    await service.onModuleInit();

    jest.clearAllMocks();
    // Re-assign mock since clearAllMocks resets them
    mockGetOrCreateCollection.mockResolvedValue({
      upsert: mockUpsert,
      query: mockQuery,
      get: mockGet,
      delete: mockDelete,
    });
  });

  describe('generateEmbedding', () => {
    it('should return embedding on successful Ollama call', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      mockedAxios.post.mockResolvedValueOnce({
        data: { embedding: mockEmbedding },
      });

      const result = await service.generateEmbedding('test text');

      expect(result).toEqual(mockEmbedding);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:11434/api/embeddings',
        { model: 'nomic-embed-text', prompt: 'test text' },
        { headers: { 'Content-Type': 'application/json' }, timeout: 60_000 },
      );
    });

    it('should retry 3 times on failure then return null', async () => {
      mockedAxios.post
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Server error'));

      // Override delay to speed up test
      jest.spyOn(service as any, 'delay').mockResolvedValue(undefined);

      const result = await service.generateEmbedding('test text');

      expect(result).toBeNull();
      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
    });

    it('should succeed on second attempt after first failure', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      mockedAxios.post
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({ data: { embedding: mockEmbedding } });

      jest.spyOn(service as any, 'delay').mockResolvedValue(undefined);

      const result = await service.generateEmbedding('test text');

      expect(result).toEqual(mockEmbedding);
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    it('should return null when Ollama returns empty embedding', async () => {
      mockedAxios.post
        .mockResolvedValueOnce({ data: { embedding: [] } })
        .mockResolvedValueOnce({ data: { embedding: [] } })
        .mockResolvedValueOnce({ data: { embedding: [] } });

      jest.spyOn(service as any, 'delay').mockResolvedValue(undefined);

      const result = await service.generateEmbedding('test text');

      expect(result).toBeNull();
    });
  });

  describe('upsertProfileEmbedding', () => {
    it('should generate embedding and store in ChromaDB profiles collection', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      mockedAxios.post.mockResolvedValueOnce({
        data: { embedding: mockEmbedding },
      });

      const result = await service.upsertProfileEmbedding(
        'user-123',
        'profile text',
        { skills: 'javascript,typescript' },
      );

      expect(result).toBe(true);
      expect(mockGetOrCreateCollection).toHaveBeenCalledWith({
        name: 'profiles',
        embeddingFunction: null,
        metadata: { 'hnsw:space': 'cosine' },
      });
      expect(mockUpsert).toHaveBeenCalledWith({
        ids: ['user-123'],
        embeddings: [mockEmbedding],
        metadatas: [{ userId: 'user-123', skills: 'javascript,typescript' }],
        documents: ['profile text'],
      });
    });

    it('should return false when embedding generation fails', async () => {
      mockedAxios.post
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'));

      jest.spyOn(service as any, 'delay').mockResolvedValue(undefined);

      const result = await service.upsertProfileEmbedding(
        'user-123',
        'profile text',
      );

      expect(result).toBe(false);
      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });

  describe('upsertJobEmbeddings', () => {
    it('should batch embed and store jobs', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      mockedAxios.post.mockResolvedValue({
        data: { embedding: mockEmbedding },
      });

      const jobs = [
        { jobId: 'job-1', text: 'Job description 1', metadata: { title: 'Dev' } },
        { jobId: 'job-2', text: 'Job description 2', metadata: { title: 'Eng' } },
      ];

      const result = await service.upsertJobEmbeddings(jobs);

      expect(result).toEqual({ embedded: 2, failed: 0 });
      expect(mockUpsert).toHaveBeenCalledWith({
        ids: ['job-1', 'job-2'],
        embeddings: [mockEmbedding, mockEmbedding],
        metadatas: [
          { jobId: 'job-1', title: 'Dev' },
          { jobId: 'job-2', title: 'Eng' },
        ],
        documents: ['Job description 1', 'Job description 2'],
      });
    });

    it('should count failed embeddings when Ollama fails', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      mockedAxios.post
        .mockResolvedValueOnce({ data: { embedding: mockEmbedding } })
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'));

      jest.spyOn(service as any, 'delay').mockResolvedValue(undefined);

      const jobs = [
        { jobId: 'job-1', text: 'Description 1' },
        { jobId: 'job-2', text: 'Description 2' },
      ];

      const result = await service.upsertJobEmbeddings(jobs);

      expect(result.embedded).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  describe('querySimilarity', () => {
    it('should return similarity scores for matching job IDs', async () => {
      const profileEmbedding = [0.1, 0.2, 0.3];
      mockGet.mockResolvedValueOnce({
        embeddings: [profileEmbedding],
        ids: ['user-123'],
      });
      mockQuery.mockResolvedValueOnce({
        ids: [['job-1', 'job-2', 'job-3']],
        distances: [[0.2, 0.5, 1.0]],
      });

      const result = await service.querySimilarity('user-123', ['job-1', 'job-3']);

      expect(result).toHaveLength(2);
      expect(result[0].jobId).toBe('job-1');
      expect(result[0].similarity).toBeCloseTo(0.9, 5); // 1 - 0.2/2 = 0.9
      expect(result[1].jobId).toBe('job-3');
      expect(result[1].similarity).toBeCloseTo(0.5, 5); // 1 - 1.0/2 = 0.5
    });

    it('should return null when profile embedding is not found', async () => {
      mockGet.mockResolvedValueOnce({
        embeddings: [],
        ids: [],
      });

      const result = await service.querySimilarity('user-123', ['job-1']);

      expect(result).toBeNull();
    });

    it('should return null on ChromaDB error', async () => {
      mockGet.mockRejectedValueOnce(new Error('ChromaDB down'));

      const result = await service.querySimilarity('user-123', ['job-1']);

      expect(result).toBeNull();
    });
  });

  describe('deleteProfileEmbedding', () => {
    it('should delete embedding from ChromaDB profiles collection', async () => {
      const result = await service.deleteProfileEmbedding('user-123');

      expect(result).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith({ ids: ['user-123'] });
    });

    it('should return false on deletion error', async () => {
      mockDelete.mockRejectedValueOnce(new Error('Delete failed'));

      const result = await service.deleteProfileEmbedding('user-123');

      expect(result).toBe(false);
    });
  });

  describe('splitIntoBatches', () => {
    it('should split array into batches of specified size', () => {
      const items = [1, 2, 3, 4, 5, 6, 7];
      const batches = service.splitIntoBatches(items, 3);

      expect(batches).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    });

    it('should return empty array for empty input', () => {
      const batches = service.splitIntoBatches([], 50);

      expect(batches).toEqual([]);
    });

    it('should return single batch when items fewer than batch size', () => {
      const items = [1, 2, 3];
      const batches = service.splitIntoBatches(items, 50);

      expect(batches).toEqual([[1, 2, 3]]);
    });
  });
});
