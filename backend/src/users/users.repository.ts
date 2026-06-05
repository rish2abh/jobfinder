import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateUserDto } from './dto/create-user.dto';
import { User, UserDocument, UserProfile } from './user.schema';
import type { UpdateProfileDto } from './dto/update-profile.dto';

type ResumeData = {
  parsedJson: any;
  rawText: string;
  cloudinaryUrl: string;
  cloudinaryId: string;
};

@Injectable()
export class UsersRepository {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async create(createUserDto: CreateUserDto) {
    const createdUser = new this.userModel(createUserDto);
    return createdUser.save();
  }

  async findById(id: string) {
    return this.userModel.findById(id).exec();
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({ email: email.toLowerCase().trim() }).exec();
  }

  async saveResume(user: UserDocument, resumeData: ResumeData) {
    try {
      const hasPrevious = user.resume && Object.keys(user.resume).length > 0;
      if (hasPrevious) {
        const prev = {
          parsedJson:   user.resume,
          rawText:      user.resumeRawText      || null,
          cloudinaryUrl: user.resumeCloudinaryUrl || null,
          cloudinaryId:  user.resumeCloudinaryId  || null,
          savedAt:      new Date(),
        };
        if (!Array.isArray(user.resumeVersions)) user.resumeVersions = [] as any;
        user.resumeVersions.push(prev as any);
      }

      user.resume              = resumeData.parsedJson;
      user.resumeRawText       = resumeData.rawText;
      user.resumeCloudinaryUrl = resumeData.cloudinaryUrl;
      user.resumeCloudinaryId  = resumeData.cloudinaryId;

      return user.save();
    } catch {
      user.resume              = resumeData.parsedJson;
      user.resumeRawText       = resumeData.rawText;
      user.resumeCloudinaryUrl = resumeData.cloudinaryUrl;
      user.resumeCloudinaryId  = resumeData.cloudinaryId;
      return user.save();
    }
  }

  async updateProfile(
    user: UserDocument,
    updates: Partial<UserProfile>,
    topLevelUpdates?: Partial<{ name: string; email: string }>,
  ) {
    // Merge profile fields (deep merge for nested objects, replace for arrays)
    const current: UserProfile = (user.profile as UserProfile) ?? {};
    const merged: UserProfile  = { ...current, ...updates, updatedAt: new Date() };

    // Use $set so Mongoose marks the subdocument as modified
    return this.userModel
      .findByIdAndUpdate(
        user._id,
        {
          $set: {
            profile: merged,
            ...(topLevelUpdates?.name  ? { name:  topLevelUpdates.name  } : {}),
            ...(topLevelUpdates?.email ? { email: topLevelUpdates.email } : {}),
          },
        },
        { new: true },
      )
      .exec();
  }
}
