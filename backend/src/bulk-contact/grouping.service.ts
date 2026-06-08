import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BulkContact, BulkContactDocument } from './bulk-contact.schema';
import { ContactGroup, ContactGroupDocument } from './contact-group.schema';

@Injectable()
export class GroupingService {
  constructor(
    @InjectModel(ContactGroup.name)
    private contactGroupModel: Model<ContactGroupDocument>,
  ) {}

  /**
   * Group contacts by their title field value.
   * Contacts with empty/missing title go into an "Uncategorized" group.
   */
  async groupByTitle(
    userId: Types.ObjectId,
    contacts: BulkContactDocument[],
  ): Promise<ContactGroupDocument[]> {
    return this.groupByField(userId, contacts, 'title');
  }

  /**
   * Group contacts by their company field value.
   * Contacts with empty/missing company go into an "Uncategorized" group.
   */
  async groupByCompany(
    userId: Types.ObjectId,
    contacts: BulkContactDocument[],
  ): Promise<ContactGroupDocument[]> {
    return this.groupByField(userId, contacts, 'company');
  }

  /**
   * Internal method that groups contacts by a specified field,
   * stores group metadata in the ContactGroups collection,
   * and ensures the union of all groups equals the complete contact list.
   */
  private async groupByField(
    userId: Types.ObjectId,
    contacts: BulkContactDocument[],
    field: 'title' | 'company',
  ): Promise<ContactGroupDocument[]> {
    const groups = new Map<string, Types.ObjectId[]>();

    for (const contact of contacts) {
      const value = contact[field]?.trim() || 'Uncategorized';
      if (!groups.has(value)) {
        groups.set(value, []);
      }
      groups.get(value).push(contact._id as Types.ObjectId);
    }

    // Remove existing groups for this user and groupType to avoid stale data
    await this.contactGroupModel.deleteMany({ userId, groupType: field });

    // Create new group documents
    const groupDocs: ContactGroupDocument[] = [];
    for (const [groupValue, contactIds] of groups.entries()) {
      const doc = await this.contactGroupModel.findOneAndUpdate(
        { userId, groupType: field, groupValue },
        {
          userId,
          groupType: field,
          groupValue,
          contactIds,
          createdAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      groupDocs.push(doc);
    }

    return groupDocs;
  }
}
