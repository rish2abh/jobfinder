import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { GroupingService } from './grouping.service';
import { ContactGroup } from './contact-group.schema';

describe('GroupingService', () => {
  let service: GroupingService;
  let mockModel: any;

  const userId = new Types.ObjectId();

  beforeEach(async () => {
    mockModel = {
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      findOneAndUpdate: jest.fn().mockImplementation((_filter, update, _opts) => {
        return Promise.resolve({
          _id: new Types.ObjectId(),
          ...update,
        });
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupingService,
        {
          provide: getModelToken(ContactGroup.name),
          useValue: mockModel,
        },
      ],
    }).compile();

    service = module.get<GroupingService>(GroupingService);
  });

  function makeContact(overrides: Partial<{ title: string; company: string }> = {}) {
    return {
      _id: new Types.ObjectId(),
      userId,
      name: 'Test User',
      email: 'test@example.com',
      title: overrides.title ?? 'Engineer',
      company: overrides.company ?? 'Acme',
      sourceFile: 'contacts.csv',
      uploadedAt: new Date(),
    } as any;
  }

  describe('groupByTitle', () => {
    it('should group contacts by title', async () => {
      const contacts = [
        makeContact({ title: 'Engineer' }),
        makeContact({ title: 'Engineer' }),
        makeContact({ title: 'Designer' }),
      ];

      const result = await service.groupByTitle(userId, contacts);

      expect(mockModel.deleteMany).toHaveBeenCalledWith({ userId, groupType: 'title' });
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });

    it('should put contacts with empty title into Uncategorized', async () => {
      const contacts = [
        makeContact({ title: '' }),
        makeContact({ title: undefined }),
        makeContact({ title: 'Engineer' }),
      ];

      await service.groupByTitle(userId, contacts);

      const calls = mockModel.findOneAndUpdate.mock.calls;
      const groupValues = calls.map((c) => c[1].groupValue);
      expect(groupValues).toContain('Uncategorized');
      expect(groupValues).toContain('Engineer');
    });

    it('should include all contacts with no loss or duplication', async () => {
      const contacts = [
        makeContact({ title: 'A' }),
        makeContact({ title: 'B' }),
        makeContact({ title: 'A' }),
        makeContact({ title: 'C' }),
      ];

      await service.groupByTitle(userId, contacts);

      const calls = mockModel.findOneAndUpdate.mock.calls;
      const allContactIds = calls.flatMap((c) => c[1].contactIds);
      const originalIds = contacts.map((c) => c._id);

      expect(allContactIds).toHaveLength(originalIds.length);
      for (const id of originalIds) {
        expect(allContactIds).toContainEqual(id);
      }
    });
  });

  describe('groupByCompany', () => {
    it('should group contacts by company', async () => {
      const contacts = [
        makeContact({ company: 'Google' }),
        makeContact({ company: 'Google' }),
        makeContact({ company: 'Amazon' }),
      ];

      const result = await service.groupByCompany(userId, contacts);

      expect(mockModel.deleteMany).toHaveBeenCalledWith({ userId, groupType: 'company' });
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });

    it('should put contacts with empty company into Uncategorized', async () => {
      const contacts = [
        makeContact({ company: '' }),
        makeContact({ company: 'Google' }),
      ];

      await service.groupByCompany(userId, contacts);

      const calls = mockModel.findOneAndUpdate.mock.calls;
      const groupValues = calls.map((c) => c[1].groupValue);
      expect(groupValues).toContain('Uncategorized');
      expect(groupValues).toContain('Google');
    });

    it('should ensure union of all groups equals complete contact list', async () => {
      const contacts = [
        makeContact({ company: 'X' }),
        makeContact({ company: 'Y' }),
        makeContact({ company: 'X' }),
      ];

      await service.groupByCompany(userId, contacts);

      const calls = mockModel.findOneAndUpdate.mock.calls;
      const allContactIds = calls.flatMap((c) => c[1].contactIds);
      const originalIds = contacts.map((c) => c._id);

      expect(allContactIds).toHaveLength(originalIds.length);
      for (const id of originalIds) {
        expect(allContactIds).toContainEqual(id);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty contacts array', async () => {
      const result = await service.groupByTitle(userId, []);

      expect(mockModel.deleteMany).toHaveBeenCalled();
      expect(mockModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(result).toHaveLength(0);
    });

    it('should handle all contacts in one group', async () => {
      const contacts = [
        makeContact({ title: 'Same' }),
        makeContact({ title: 'Same' }),
        makeContact({ title: 'Same' }),
      ];

      const result = await service.groupByTitle(userId, contacts);

      expect(result).toHaveLength(1);
      const calls = mockModel.findOneAndUpdate.mock.calls;
      expect(calls[0][1].contactIds).toHaveLength(3);
    });

    it('should trim whitespace from field values', async () => {
      const contacts = [
        makeContact({ title: '  Engineer  ' }),
        makeContact({ title: 'Engineer' }),
      ];

      await service.groupByTitle(userId, contacts);

      const calls = mockModel.findOneAndUpdate.mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][1].groupValue).toBe('Engineer');
    });
  });
});
