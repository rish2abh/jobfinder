import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { TemplateGeneratorService } from './template-generator.service';
import { EmailTemplate } from './email-template.schema';

// Mock axios at module level
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TemplateGeneratorService', () => {
  let service: TemplateGeneratorService;
  let mockModel: any;

  const groupId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const userProfile = {
    name: 'John Doe',
    headline: 'Full Stack Developer',
    skills: ['TypeScript', 'Node.js', 'React'],
    location: 'New York',
  };

  beforeEach(async () => {
    mockModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateGeneratorService,
        {
          provide: getModelToken(EmailTemplate.name),
          useValue: mockModel,
        },
      ],
    }).compile();

    service = module.get<TemplateGeneratorService>(TemplateGeneratorService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('generateTemplate', () => {
    it('should return cached template if one exists', async () => {
      const cachedTemplate = {
        _id: new Types.ObjectId(),
        groupId,
        userId,
        subject: 'Cached subject',
        body: 'Cached body',
        generatedBy: 'ai',
        cachedAt: new Date(),
      };
      mockModel.findOne.mockResolvedValue(cachedTemplate);

      const result = await service.generateTemplate(
        groupId,
        userId,
        'company',
        'Google',
        userProfile,
      );

      expect(result).toBe(cachedTemplate);
      expect(mockModel.findOne).toHaveBeenCalledWith({ groupId });
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should call Ollama and save template on cache miss', async () => {
      mockModel.findOne.mockResolvedValue(null);
      const savedTemplate = {
        _id: new Types.ObjectId(),
        groupId,
        userId,
        subject: 'Great opportunity',
        body: 'Hi {{name}}, I noticed your work at {{company}}.',
        generatedBy: 'ai',
        cachedAt: new Date(),
      };
      mockModel.findOneAndUpdate.mockResolvedValue(savedTemplate);

      mockedAxios.post.mockResolvedValue({
        data: {
          response: '{"subject": "Great opportunity", "body": "Hi {{name}}, I noticed your work at {{company}}."}',
        },
      });

      const result = await service.generateTemplate(
        groupId,
        userId,
        'company',
        'Google',
        userProfile,
      );

      expect(result).toBe(savedTemplate);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { groupId },
        expect.objectContaining({
          groupId,
          userId,
          generatedBy: 'ai',
        }),
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    });

    it('should fall back to manual template if Ollama fails', async () => {
      mockModel.findOne.mockResolvedValue(null);
      const fallbackTemplate = {
        _id: new Types.ObjectId(),
        groupId,
        userId,
        subject: '',
        body: '',
        generatedBy: 'manual',
        cachedAt: new Date(),
      };
      mockModel.findOneAndUpdate.mockResolvedValue(fallbackTemplate);

      mockedAxios.post.mockRejectedValue(new Error('Connection refused'));

      const result = await service.generateTemplate(
        groupId,
        userId,
        'title',
        'Backend Developer',
        userProfile,
      );

      expect(result).toBe(fallbackTemplate);
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { groupId },
        expect.objectContaining({
          generatedBy: 'manual',
          subject: '',
          body: '',
        }),
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    });

    it('should truncate subject to 200 chars and body to 2000 chars', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockModel.findOneAndUpdate.mockImplementation((_filter, update, _opts) => {
        return Promise.resolve({ _id: new Types.ObjectId(), ...update });
      });

      const longSubject = 'A'.repeat(300);
      const longBody = 'B'.repeat(4000);
      mockedAxios.post.mockResolvedValue({
        data: {
          response: JSON.stringify({ subject: longSubject, body: longBody }),
        },
      });

      await service.generateTemplate(groupId, userId, 'company', 'X', userProfile);

      const updateArg = mockModel.findOneAndUpdate.mock.calls[0][1];
      expect(updateArg.subject.length).toBe(200);
      expect(updateArg.body.length).toBe(2000);
    });

    it('should pass optional userPrompt to Ollama', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockModel.findOneAndUpdate.mockResolvedValue({
        _id: new Types.ObjectId(),
        groupId,
        userId,
        subject: 'Test',
        body: 'Test body',
        generatedBy: 'ai',
        cachedAt: new Date(),
      });

      mockedAxios.post.mockResolvedValue({
        data: {
          response: '{"subject": "Test", "body": "Test body"}',
        },
      });

      await service.generateTemplate(
        groupId,
        userId,
        'title',
        'PM',
        userProfile,
        'Focus on product management experience',
      );

      const promptArg = (mockedAxios.post.mock.calls[0][1] as any).prompt;
      expect(promptArg).toContain('Focus on product management experience');
    });
  });

  describe('saveManualTemplate', () => {
    it('should save a manual template', async () => {
      const savedTemplate = {
        _id: new Types.ObjectId(),
        groupId,
        userId,
        subject: 'Manual subject',
        body: 'Manual body',
        generatedBy: 'manual',
        cachedAt: new Date(),
      };
      mockModel.findOneAndUpdate.mockResolvedValue(savedTemplate);

      const result = await service.saveManualTemplate(
        groupId,
        userId,
        'Manual subject',
        'Manual body',
      );

      expect(result).toBe(savedTemplate);
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { groupId },
        expect.objectContaining({
          subject: 'Manual subject',
          body: 'Manual body',
          generatedBy: 'manual',
        }),
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    });

    it('should truncate manual input to max lengths', async () => {
      mockModel.findOneAndUpdate.mockImplementation((_filter, update, _opts) => {
        return Promise.resolve({ _id: new Types.ObjectId(), ...update });
      });

      const longSubject = 'S'.repeat(500);
      const longBody = 'B'.repeat(5000);

      await service.saveManualTemplate(groupId, userId, longSubject, longBody);

      const updateArg = mockModel.findOneAndUpdate.mock.calls[0][1];
      expect(updateArg.subject.length).toBe(200);
      expect(updateArg.body.length).toBe(2000);
    });
  });
});
